using System.Text.Json;

namespace Rlab.Domain.Contracts;

public sealed record RlabCommandEnvelope(
    string CommandId,
    string ClientId,
    string Type,
    int Version,
    JsonElement Data,
    string? CorrelationId = null,
    string? CausationId = null,
    string? Actor = null);

public sealed record RlabCommandRequest(IReadOnlyList<RlabCommandEnvelope> Commands);

public sealed record RlabCommandResult(string CommandId, long GlobalPosition);

public sealed record RlabCommandResponse(bool Ok, string Checkpoint, IReadOnlyList<RlabCommandResult> Results, string? Error = null);

public interface IRlabCommandHandler
{
    Type CommandType { get; }

    ValueTask<RlabResult<RlabCommandResult>> HandleAsync(RlabCommandEnvelope envelope, object command, CancellationToken cancellationToken);
}

public interface IRlabCommandHandler<in TCommand>
{
    ValueTask<RlabResult<RlabCommandResult>> HandleAsync(RlabCommandEnvelope envelope, TCommand command, CancellationToken cancellationToken);
}

public abstract class RlabCommandHandler<TCommand> : IRlabCommandHandler, IRlabCommandHandler<TCommand>
    where TCommand : notnull
{
    public Type CommandType => typeof(TCommand);

    public ValueTask<RlabResult<RlabCommandResult>> HandleAsync(RlabCommandEnvelope envelope, object command, CancellationToken cancellationToken)
    {
        if (command is not TCommand typedCommand)
        {
            throw new InvalidOperationException($"Command handler expected {typeof(TCommand).FullName}, got {command.GetType().FullName}.");
        }

        return HandleAsync(envelope, typedCommand, cancellationToken);
    }

    public abstract ValueTask<RlabResult<RlabCommandResult>> HandleAsync(RlabCommandEnvelope envelope, TCommand command, CancellationToken cancellationToken);
}
