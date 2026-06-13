using System.Text.Json;

namespace Rlab.Domain.Contracts;

public sealed record RlabQueryEnvelope(string QueryId, string Type, int Version, JsonElement Data);

public interface IRlabQueryHandler
{
    Type QueryType { get; }

    ValueTask<object> HandleAsync(object query, CancellationToken cancellationToken);
}

public interface IRlabQueryHandler<in TQuery, TResult>
{
    ValueTask<TResult> HandleAsync(TQuery query, CancellationToken cancellationToken);
}

public abstract class RlabQueryHandler<TQuery, TResult> : IRlabQueryHandler, IRlabQueryHandler<TQuery, TResult>
    where TQuery : notnull
    where TResult : notnull
{
    public Type QueryType => typeof(TQuery);

    public async ValueTask<object> HandleAsync(object query, CancellationToken cancellationToken)
    {
        if (query is not TQuery typedQuery)
        {
            throw new InvalidOperationException($"Query handler expected {typeof(TQuery).FullName}, got {query.GetType().FullName}.");
        }

        return await HandleAsync(typedQuery, cancellationToken).ConfigureAwait(false);
    }

    public abstract ValueTask<TResult> HandleAsync(TQuery query, CancellationToken cancellationToken);
}
