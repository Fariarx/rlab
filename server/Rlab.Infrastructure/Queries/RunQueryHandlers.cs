using Marten;
using Marten.Linq;
using Rlab.Domain.Contracts;
using Rlab.Domain.Run;

namespace Rlab.Infrastructure.Queries;

public sealed record ActiveRunsResult(IReadOnlyList<RunView> Runs);

public sealed class ActiveRunsQueryHandler : RlabQueryHandler<ActiveRunsQuery, ActiveRunsResult>
{
    private readonly IQuerySession _session;

    public ActiveRunsQueryHandler(IQuerySession session)
    {
        _session = session;
    }

    public override async ValueTask<ActiveRunsResult> HandleAsync(ActiveRunsQuery query, CancellationToken cancellationToken)
    {
        var runs = await _session.Query<RunView>()
            .Where(run => run.Status == "requested" || run.Status == "running" || run.Status == "waiting")
            .OrderBy(run => run.UpdatedGlobalPosition)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        return new ActiveRunsResult(runs);
    }
}
