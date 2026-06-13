using System.Linq.Expressions;

namespace Rlab.Domain.Contracts;

public sealed record RlabProjectionContext(long GlobalPosition);

public interface IRlabProjectionWriter
{
    ValueTask<TDocument?> LoadAsync<TDocument>(string id, CancellationToken cancellationToken)
        where TDocument : class;

    ValueTask<int> CountAsync<TDocument>(
        Expression<Func<TDocument, bool>> predicate,
        CancellationToken cancellationToken)
        where TDocument : class;

    void Store<TDocument>(TDocument document)
        where TDocument : class;
}

public interface IRlabProjectionApplier
{
    Type EventType { get; }

    ValueTask ApplyAsync(
        IRlabProjectionWriter writer,
        object @event,
        RlabProjectionContext context,
        CancellationToken cancellationToken);
}

public interface IRlabProjectionApplier<in TEvent>
{
    ValueTask ApplyAsync(
        IRlabProjectionWriter writer,
        TEvent @event,
        RlabProjectionContext context,
        CancellationToken cancellationToken);
}

public abstract class RlabProjectionApplier<TEvent> : IRlabProjectionApplier, IRlabProjectionApplier<TEvent>
    where TEvent : notnull
{
    public Type EventType => typeof(TEvent);

    public ValueTask ApplyAsync(
        IRlabProjectionWriter writer,
        object @event,
        RlabProjectionContext context,
        CancellationToken cancellationToken)
    {
        if (@event is not TEvent typedEvent)
        {
            throw new InvalidOperationException($"Projection applier expected {typeof(TEvent).FullName}, got {@event.GetType().FullName}.");
        }

        return ApplyAsync(writer, typedEvent, context, cancellationToken);
    }

    public abstract ValueTask ApplyAsync(
        IRlabProjectionWriter writer,
        TEvent @event,
        RlabProjectionContext context,
        CancellationToken cancellationToken);
}
