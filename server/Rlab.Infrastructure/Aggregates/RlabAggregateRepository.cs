using Marten;
using Marten.Linq;
using Rlab.Domain.Contracts;

namespace Rlab.Infrastructure.Aggregates;

public interface IRlabAggregateRepository
{
    ValueTask<TAggregate> LoadAsync<TAggregate>(string streamName, CancellationToken cancellationToken)
        where TAggregate : IRlabAggregate, new();
}

public sealed class RlabAggregateRepository : IRlabAggregateRepository
{
    private readonly IQuerySession _session;

    public RlabAggregateRepository(IQuerySession session)
    {
        _session = session;
    }

    public async ValueTask<TAggregate> LoadAsync<TAggregate>(string streamName, CancellationToken cancellationToken)
        where TAggregate : IRlabAggregate, new()
    {
        var aggregate = new TAggregate();
        var events = await _session.Events.QueryAllRawEvents()
            .Where(@event => @event.StreamKey == streamName)
            .OrderBy(@event => @event.Version)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        foreach (var @event in events)
        {
            if (@event.Data is not null)
            {
                aggregate.Apply(@event.Data);
            }
        }

        return aggregate;
    }
}
