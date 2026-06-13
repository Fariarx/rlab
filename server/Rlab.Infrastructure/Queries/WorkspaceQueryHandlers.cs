using Marten;
using Marten.Linq;
using Rlab.Domain.Contracts;
using Rlab.Domain.Workspace;

namespace Rlab.Infrastructure.Queries;

public sealed record WorkspaceThreadResult(string ConversationId, IReadOnlyList<ThreadMessageView> Messages);

public sealed class WorkspaceSnapshotQueryHandler : RlabQueryHandler<WorkspaceSnapshotQuery, WorkspaceView>
{
    private readonly IQuerySession _session;

    public WorkspaceSnapshotQueryHandler(IQuerySession session)
    {
        _session = session;
    }

    public override async ValueTask<WorkspaceView> HandleAsync(WorkspaceSnapshotQuery query, CancellationToken cancellationToken)
    {
        return await _session.LoadAsync<WorkspaceView>("workspace", cancellationToken).ConfigureAwait(false) ?? new WorkspaceView();
    }
}

public sealed class WorkspaceThreadQueryHandler : RlabQueryHandler<WorkspaceThreadQuery, WorkspaceThreadResult>
{
    private readonly IQuerySession _session;

    public WorkspaceThreadQueryHandler(IQuerySession session)
    {
        _session = session;
    }

    public override async ValueTask<WorkspaceThreadResult> HandleAsync(WorkspaceThreadQuery query, CancellationToken cancellationToken)
    {
        var messages = await _session.Query<ThreadMessageView>()
            .Where(message => message.ConversationId == query.ConversationId)
            .OrderBy(message => message.Position)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        return new WorkspaceThreadResult(query.ConversationId, messages);
    }
}
