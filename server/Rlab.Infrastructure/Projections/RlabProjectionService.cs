using Marten;
using Rlab.Domain.Contracts;
using Rlab.Domain.Generated;
using Rlab.Domain.Metadata;

namespace Rlab.Infrastructure.Projections;

public interface IRlabProjectionService
{
    int RegisteredApplierCount { get; }

    ValueTask ApplyAsync(IDocumentSession session, IReadOnlyList<object> events, long globalPosition, CancellationToken cancellationToken);
}

public sealed class RlabProjectionService : IRlabProjectionService
{
    private readonly IReadOnlyDictionary<Type, IRlabProjectionApplier> _appliersByEventType;

    public RlabProjectionService(IEnumerable<IRlabProjectionApplier> appliers, RlabModelRegistry registry)
    {
        _appliersByEventType = appliers.ToDictionary(applier => applier.EventType);
        var missingAppliers = registry.Events
            .Select(model => RlabGeneratedRegistry.ResolveType(model.ClrType))
            .Where(eventType => !_appliersByEventType.ContainsKey(eventType))
            .Select(eventType => eventType.FullName)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();

        if (missingAppliers.Length > 0)
        {
            throw new InvalidOperationException($"Projection appliers are missing for events: {string.Join(", ", missingAppliers)}.");
        }
    }

    public int RegisteredApplierCount => _appliersByEventType.Count;

    public async ValueTask ApplyAsync(IDocumentSession session, IReadOnlyList<object> events, long globalPosition, CancellationToken cancellationToken)
    {
        var writer = new MartenProjectionWriter(session);
        var context = new RlabProjectionContext(globalPosition);

        foreach (var @event in events)
        {
            var eventType = @event.GetType();
            if (!_appliersByEventType.TryGetValue(eventType, out var applier))
            {
                throw new InvalidOperationException($"No projection applier is registered for event '{eventType.FullName}'.");
            }

            await applier.ApplyAsync(writer, @event, context, cancellationToken).ConfigureAwait(false);
        }
    }
}
