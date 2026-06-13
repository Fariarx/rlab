using JasperFx.Events;
using Marten;
using Marten.Linq;
using Rlab.Domain.Metadata;

namespace Rlab.Infrastructure.Projections;

public sealed record RlabProjectionCheckpointDocument
{
    public string Id { get; init; } = "";
    public string ProjectionName { get; init; } = "";
    public int Version { get; init; }
    public string SchemaHash { get; init; } = "";
    public string Status { get; init; } = "healthy";
    public long GlobalPosition { get; init; }
    public DateTimeOffset UpdatedAt { get; init; } = DateTimeOffset.UtcNow;
}

public interface IRlabProjectionMaintenance
{
    ValueTask<IReadOnlyList<RlabProjectionCheckpointDocument>> GetStatusAsync(CancellationToken cancellationToken);
    ValueTask RebuildAsync(IReadOnlyCollection<string> projectionNames, CancellationToken cancellationToken);
}

public sealed class RlabProjectionMaintenance : IRlabProjectionMaintenance
{
    private readonly IDocumentStore _store;
    private readonly RlabModelRegistry _registry;
    private readonly IRlabProjectionService _projectionService;

    public RlabProjectionMaintenance(IDocumentStore store, RlabModelRegistry registry, IRlabProjectionService projectionService)
    {
        _store = store;
        _registry = registry;
        _projectionService = projectionService;
    }

    public async ValueTask<IReadOnlyList<RlabProjectionCheckpointDocument>> GetStatusAsync(CancellationToken cancellationToken)
    {
        await using var session = _store.QuerySession();
        var checkpoints = await session.Query<RlabProjectionCheckpointDocument>()
            .OrderBy(checkpoint => checkpoint.ProjectionName)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        return checkpoints;
    }

    public async ValueTask RebuildAsync(IReadOnlyCollection<string> projectionNames, CancellationToken cancellationToken)
    {
        var targetNames = projectionNames.Count == 0
            ? _registry.Projections.Select(projection => projection.WireName).ToHashSet(StringComparer.Ordinal)
            : projectionNames.ToHashSet(StringComparer.Ordinal);

        await using var cleanup = _store.LightweightSession();
        await MarkAsync(cleanup, targetNames, "rebuilding", 0, cancellationToken).ConfigureAwait(false);
        await DeleteProjectionDocumentsAsync(cleanup, targetNames, cancellationToken).ConfigureAwait(false);
        await cleanup.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        long globalPosition = 0;
        await using var replay = _store.LightweightSession();
        var events = await replay.Events.QueryAllRawEvents()
            .OrderBy(@event => @event.Sequence)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        foreach (var @event in events)
        {
            if (@event.Data is null)
            {
                continue;
            }

            globalPosition = Math.Max(globalPosition, @event.Sequence);
            await _projectionService.ApplyAsync(replay, [@event.Data], @event.Sequence, cancellationToken).ConfigureAwait(false);
        }

        await MarkAsync(replay, targetNames, "healthy", globalPosition, cancellationToken).ConfigureAwait(false);
        await replay.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    private async ValueTask DeleteProjectionDocumentsAsync(IDocumentSession session, IReadOnlySet<string> projectionNames, CancellationToken cancellationToken)
    {
        if (projectionNames.Contains("workspace-view"))
        {
            session.Delete<Rlab.Domain.Workspace.WorkspaceView>("workspace");
        }

        if (projectionNames.Contains("conversation-view"))
        {
            var ids = await session.Query<Rlab.Domain.Workspace.ConversationView>()
                .Select(conversation => conversation.Id)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
            foreach (var id in ids)
            {
                session.Delete<Rlab.Domain.Workspace.ConversationView>(id);
            }
        }

        if (projectionNames.Contains("message-view"))
        {
            var ids = await session.Query<Rlab.Domain.Workspace.ThreadMessageView>()
                .Select(message => message.Id)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
            foreach (var id in ids)
            {
                session.Delete<Rlab.Domain.Workspace.ThreadMessageView>(id);
            }
        }

        if (projectionNames.Contains("run-view"))
        {
            var ids = await session.Query<Rlab.Domain.Run.RunView>()
                .Select(run => run.Id)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
            foreach (var id in ids)
            {
                session.Delete<Rlab.Domain.Run.RunView>(id);
            }
        }
    }

    private async ValueTask MarkAsync(IDocumentSession session, IReadOnlySet<string> projectionNames, string status, long globalPosition, CancellationToken cancellationToken)
    {
        foreach (var projection in _registry.Projections.Where(projection => projectionNames.Contains(projection.WireName)))
        {
            session.Store(new RlabProjectionCheckpointDocument
            {
                Id = projection.WireName,
                ProjectionName = projection.WireName,
                Version = projection.Version,
                SchemaHash = projection.SchemaHash,
                Status = status,
                GlobalPosition = globalPosition,
                UpdatedAt = DateTimeOffset.UtcNow
            });
        }

        await ValueTask.CompletedTask;
    }
}
