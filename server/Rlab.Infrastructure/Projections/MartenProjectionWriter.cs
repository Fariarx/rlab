using System.Linq.Expressions;
using Marten;
using Marten.Linq;
using Rlab.Domain.Contracts;

namespace Rlab.Infrastructure.Projections;

public sealed class MartenProjectionWriter : IRlabProjectionWriter
{
    private readonly IDocumentSession _session;

    public MartenProjectionWriter(IDocumentSession session)
    {
        _session = session;
    }

    public async ValueTask<TDocument?> LoadAsync<TDocument>(string id, CancellationToken cancellationToken)
        where TDocument : class
    {
        return await _session.LoadAsync<TDocument>(id, cancellationToken).ConfigureAwait(false);
    }

    public async ValueTask<int> CountAsync<TDocument>(
        Expression<Func<TDocument, bool>> predicate,
        CancellationToken cancellationToken)
        where TDocument : class
    {
        return await _session.Query<TDocument>()
            .Where(predicate)
            .CountAsync(cancellationToken)
            .ConfigureAwait(false);
    }

    public void Store<TDocument>(TDocument document)
        where TDocument : class
    {
        _session.Store(document);
    }
}
