using System.Text.Json;
using Rlab.Domain.Contracts;
using Rlab.Domain.Generated;
using Rlab.Domain.Metadata;

namespace Rlab.Infrastructure.Queries;

public sealed class RlabQueryDispatcher
{
    private readonly RlabModelRegistry _registry;
    private readonly IReadOnlyDictionary<Type, IRlabQueryHandler> _handlersByQueryType;
    private readonly JsonSerializerOptions _jsonOptions;

    public RlabQueryDispatcher(RlabModelRegistry registry, IEnumerable<IRlabQueryHandler> handlers, JsonSerializerOptions jsonOptions)
    {
        _registry = registry;
        _handlersByQueryType = handlers.ToDictionary(handler => handler.QueryType);
        _jsonOptions = jsonOptions;
    }

    public async ValueTask<object> DispatchAsync(RlabQueryEnvelope envelope, CancellationToken cancellationToken)
    {
        var descriptor = _registry.Find(RlabModelKind.Query, envelope.Type, envelope.Version)
            ?? throw new InvalidOperationException($"Unknown query '{envelope.Type}' v{envelope.Version}.");

        var query = RlabGeneratedRegistry.DeserializeModel(RlabModelKind.Query, descriptor.WireName, descriptor.Version, envelope.Data, _jsonOptions);
        if (!_handlersByQueryType.TryGetValue(query.GetType(), out var handler))
        {
            throw new InvalidOperationException($"No query handler is registered for '{query.GetType().FullName}'.");
        }

        return await handler.HandleAsync(query, cancellationToken).ConfigureAwait(false);
    }
}
