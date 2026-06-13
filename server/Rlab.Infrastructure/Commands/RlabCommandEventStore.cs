using JasperFx.Events;
using Marten;
using Rlab.Domain.Contracts;
using Rlab.Infrastructure.Projections;

namespace Rlab.Infrastructure.Commands;

public sealed record RlabEventBatch(string StreamName, long? ExpectedVersion, IReadOnlyList<object> Events);

public sealed record RlabCommandResultDocument
{
    public string Id { get; init; } = "";
    public string CommandId { get; init; } = "";
    public string PayloadHash { get; init; } = "";
    public long GlobalPosition { get; init; }
    public DateTimeOffset RecordedAt { get; init; }
}

public interface IRlabCommandEventStore
{
    ValueTask<RlabResult<RlabCommandResult>> AppendAsync(RlabCommandEnvelope envelope, IReadOnlyList<RlabEventBatch> batches, CancellationToken cancellationToken);
}

public sealed class RlabCommandEventStore : IRlabCommandEventStore
{
    private readonly IDocumentSession _session;
    private readonly IRlabProjectionService _projectionService;

    public RlabCommandEventStore(IDocumentSession session, IRlabProjectionService projectionService)
    {
        _session = session;
        _projectionService = projectionService;
    }

    public async ValueTask<RlabResult<RlabCommandResult>> AppendAsync(RlabCommandEnvelope envelope, IReadOnlyList<RlabEventBatch> batches, CancellationToken cancellationToken)
    {
        var payloadHash = RlabCommandPayloadHasher.Compute(envelope);
        var existing = await _session.LoadAsync<RlabCommandResultDocument>(envelope.CommandId, cancellationToken).ConfigureAwait(false);
        if (existing is not null)
        {
            if (!string.Equals(existing.PayloadHash, payloadHash, StringComparison.Ordinal))
            {
                return $"Command '{envelope.CommandId}' was already recorded with different payload.".AsFailure<RlabCommandResult>();
            }

            return new RlabCommandResult(envelope.CommandId, existing.GlobalPosition).AsSuccess();
        }

        if (batches.Count == 0 || batches.All(batch => batch.Events.Count == 0))
        {
            return $"Command '{envelope.CommandId}' did not produce events.".AsFailure<RlabCommandResult>();
        }

        _session.CorrelationId = envelope.CorrelationId ?? envelope.CommandId;
        _session.CausationId = envelope.CausationId ?? envelope.CommandId;
        _session.LastModifiedBy = envelope.Actor ?? envelope.ClientId;
        _session.SetHeader("rlab.commandId", envelope.CommandId);
        _session.SetHeader("rlab.clientId", envelope.ClientId);
        _session.SetHeader("rlab.commandType", envelope.Type);
        _session.SetHeader("rlab.commandVersion", envelope.Version);

        var appendedEvents = new List<IEvent>();
        var domainEvents = new List<object>();
        foreach (var batch in batches)
        {
            var events = batch.Events.Where(@event => @event is not null).ToArray();
            if (events.Length == 0)
            {
                continue;
            }

            domainEvents.AddRange(events);
            var streamAction = batch.ExpectedVersion is { } expectedVersion
                ? _session.Events.Append(batch.StreamName, expectedVersion, events)
                : _session.Events.Append(batch.StreamName, events);
            appendedEvents.AddRange(streamAction.Events);
        }

        var globalPosition = appendedEvents.Select(@event => @event.Sequence).DefaultIfEmpty(0).Max();

        _session.Store(new RlabCommandResultDocument
        {
            Id = envelope.CommandId,
            CommandId = envelope.CommandId,
            PayloadHash = payloadHash,
            GlobalPosition = globalPosition,
            RecordedAt = DateTimeOffset.UtcNow
        });

        await _projectionService.ApplyAsync(_session, domainEvents, globalPosition, cancellationToken).ConfigureAwait(false);
        await _session.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        return new RlabCommandResult(envelope.CommandId, globalPosition).AsSuccess();
    }

}
