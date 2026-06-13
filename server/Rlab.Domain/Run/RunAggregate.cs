using Rlab.Domain.Metadata;
using Rlab.Domain.Contracts;

namespace Rlab.Domain.Run;

[RlabAggregate("run")]
public sealed class RunAggregate : IRlabAggregate
{
    public string Id { get; private set; } = "";
    public string Status { get; private set; } = "new";
    public string? WaitingInputId { get; private set; }
    public long Version { get; private set; }

    public RlabResult<IReadOnlyList<object>> Decide(StartRun command, DateTimeOffset now)
    {
        if (Status != "new")
        {
            return $"Run '{command.RunId}' already exists.".AsFailure<IReadOnlyList<object>>();
        }

        IReadOnlyList<object> events =
        [
            new RunRequested(
                command.RunId,
                command.ConversationId,
                command.UserMessageId,
                command.AgentMessageId,
                command.Prompt,
                command.Agent,
                command.Model,
                command.Reasoning,
                command.Mode),
            new RunStarted(command.RunId, command.ConversationId, command.UserMessageId, command.AgentMessageId, now)
        ];

        return events.AsSuccess();
    }

    public RlabResult<IReadOnlyList<object>> Decide(RecordRunOutput command)
    {
        return ConfirmExists(command.RunId)
            .Bind(_ => ConfirmNotTerminal(command.RunId))
            .Map(_ =>
            {
                IReadOnlyList<object> events = [new RunOutputRecorded(command.RunId, command.ConversationId, command.Event)];
                return events;
            });
    }

    public RlabResult<IReadOnlyList<object>> Decide(RequestApproval command)
    {
        return ConfirmExists(command.RunId)
            .Bind(_ => ConfirmNotTerminal(command.RunId))
            .Map(_ =>
            {
                IReadOnlyList<object> events = [new RunWaitingForInput(command.RunId, command.ConversationId, command.InputId, command.InputType)];
                return events;
            });
    }

    public RlabResult<IReadOnlyList<object>> Decide(DecideApproval command)
    {
        return DecideInputProvided(command.RunId, command.ConversationId, command.InputId, command.Decision);
    }

    public RlabResult<IReadOnlyList<object>> Decide(ProvideRunInput command)
    {
        return DecideInputProvided(command.RunId, command.ConversationId, command.InputId, command.Value);
    }

    public RlabResult<IReadOnlyList<object>> Decide(CancelRun command)
    {
        return ConfirmExists(command.RunId)
            .Bind(_ => ConfirmNotTerminal(command.RunId))
            .Map(_ =>
            {
                IReadOnlyList<object> events = [new RunCancelled(command.RunId, command.ConversationId, command.Reason)];
                return events;
            });
    }

    public RlabResult<IReadOnlyList<object>> Decide(CompleteRun command)
    {
        return ConfirmExists(command.RunId)
            .Bind(_ => ConfirmNotTerminal(command.RunId))
            .Map(_ =>
            {
                IReadOnlyList<object> events = [new RunCompleted(command.RunId, command.ConversationId, command.Event)];
                return events;
            });
    }

    public RlabResult<IReadOnlyList<object>> Decide(FailRun command)
    {
        return ConfirmExists(command.RunId)
            .Bind(_ => ConfirmNotTerminal(command.RunId))
            .Map(_ =>
            {
                IReadOnlyList<object> events = [new RunFailed(command.RunId, command.ConversationId, command.Error)];
                return events;
            });
    }

    private RlabResult<IReadOnlyList<object>> DecideInputProvided(string runId, string conversationId, string inputId, string value)
    {
        return ConfirmExists(runId)
            .Bind(_ => ConfirmNotTerminal(runId))
            .Bind(_ => ConfirmWaitingFor(runId, inputId))
            .Map(_ =>
            {
                IReadOnlyList<object> events = [new RunInputProvided(runId, conversationId, inputId, value)];
                return events;
            });
    }

    public void Apply(object @event)
    {
        switch (@event)
        {
            case RunRequested value:
                Apply(value);
                break;
            case RunStarted value:
                Apply(value);
                break;
            case RunOutputRecorded value:
                Apply(value);
                break;
            case RunWaitingForInput value:
                Apply(value);
                break;
            case RunInputProvided value:
                Apply(value);
                break;
            case RunCompleted value:
                Apply(value);
                break;
            case RunFailed value:
                Apply(value);
                break;
            case RunCancelled value:
                Apply(value);
                break;
            default:
                return;
        }

        Version++;
    }

    public void Apply(RunRequested @event)
    {
        Id = @event.RunId;
        Status = "requested";
    }

    public void Apply(RunStarted @event)
    {
        Id = @event.RunId;
        Status = "running";
    }

    public void Apply(RunOutputRecorded @event)
    {
        Id = @event.RunId;
    }

    public void Apply(RunWaitingForInput @event)
    {
        Id = @event.RunId;
        Status = "waiting";
        WaitingInputId = @event.InputId;
    }

    public void Apply(RunInputProvided @event)
    {
        Id = @event.RunId;
        Status = "running";
        WaitingInputId = null;
    }

    public void Apply(RunCompleted @event)
    {
        Id = @event.RunId;
        Status = "completed";
    }

    public void Apply(RunFailed @event)
    {
        Id = @event.RunId;
        Status = "failed";
    }

    public void Apply(RunCancelled @event)
    {
        Id = @event.RunId;
        Status = "cancelled";
    }

    private RlabResult<RlabUnit> ConfirmExists(string runId)
    {
        if (Status == "new")
        {
            return $"Run '{runId}' does not exist.".AsFailure<RlabUnit>();
        }

        return RlabResult.Success();
    }

    private RlabResult<RlabUnit> ConfirmNotTerminal(string runId)
    {
        if (Status is "completed" or "failed" or "cancelled")
        {
            return $"Run '{runId}' is already terminal.".AsFailure<RlabUnit>();
        }

        return RlabResult.Success();
    }

    private RlabResult<RlabUnit> ConfirmWaitingFor(string runId, string inputId)
    {
        if (WaitingInputId != inputId)
        {
            return $"Run '{runId}' is not waiting for input '{inputId}'.".AsFailure<RlabUnit>();
        }

        return RlabResult.Success();
    }
}
