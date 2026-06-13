namespace Rlab.Domain.Contracts;

public interface IRlabAggregate
{
    long Version { get; }

    void Apply(object @event);
}
