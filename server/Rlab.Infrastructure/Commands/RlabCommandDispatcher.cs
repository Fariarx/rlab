using System.Text.Json;
using Rlab.Domain.Contracts;
using Rlab.Domain.Generated;
using Rlab.Domain.Metadata;

namespace Rlab.Infrastructure.Commands;

public sealed class RlabCommandDispatcher
{
    private readonly RlabModelRegistry _registry;
    private readonly IReadOnlyDictionary<Type, IRlabCommandHandler> _handlersByCommandType;
    private readonly JsonSerializerOptions _jsonOptions;

    public RlabCommandDispatcher(RlabModelRegistry registry, IEnumerable<IRlabCommandHandler> handlers, JsonSerializerOptions jsonOptions)
    {
        _registry = registry;
        _handlersByCommandType = handlers.ToDictionary(handler => handler.CommandType);
        _jsonOptions = jsonOptions;
    }

    public async ValueTask<RlabCommandResponse> DispatchAsync(RlabCommandRequest request, CancellationToken cancellationToken)
    {
        if (request.Commands.Count == 0)
        {
            throw new InvalidOperationException("Command request must contain at least one command.");
        }

        var results = new List<RlabCommandResult>();
        foreach (var envelope in request.Commands)
        {
            var descriptor = _registry.Find(RlabModelKind.Command, envelope.Type, envelope.Version)
                ?? throw new InvalidOperationException($"Unknown command '{envelope.Type}' v{envelope.Version}.");

            var command = RlabGeneratedRegistry.DeserializeModel(RlabModelKind.Command, descriptor.WireName, descriptor.Version, envelope.Data, _jsonOptions);
            if (!_handlersByCommandType.TryGetValue(command.GetType(), out var handler))
            {
                throw new InvalidOperationException($"No command handler is registered for '{command.GetType().FullName}'.");
            }

            var result = await handler.HandleAsync(envelope, command, cancellationToken).ConfigureAwait(false);
            if (result.IsFailure)
            {
                var failedCheckpoint = results.Select(savedResult => savedResult.GlobalPosition).DefaultIfEmpty(0).Max().ToString();
                return new RlabCommandResponse(false, failedCheckpoint, results, result.Error.Message);
            }

            results.Add(result.Value);
        }

        var checkpoint = results.Select(result => result.GlobalPosition).DefaultIfEmpty(0).Max().ToString();
        return new RlabCommandResponse(true, checkpoint, results);
    }
}
