using Rlab.Domain.Contracts;
using Rlab.Domain.Metadata;
using Rlab.Domain.Run;

namespace Rlab.Domain.Workspace;

[RlabAggregate("conversation")]
public sealed class ConversationAggregate : IRlabAggregate
{
    public bool IsCreated { get; private set; }
    public string Title { get; private set; } = "";
    public string Agent { get; private set; } = "";
    public string? ProjectId { get; private set; }
    public string Status { get; private set; } = "new";
    public string? ActiveRunId { get; private set; }
    public long Version { get; private set; }
    public HashSet<string> MessageIds { get; } = [];

    public RlabResult<IReadOnlyList<object>> Decide(CreateConversation command, DateTimeOffset now)
    {
        if (IsCreated)
        {
            return $"Conversation '{command.ConversationId}' already exists.".AsFailure<IReadOnlyList<object>>();
        }

        IReadOnlyList<object> events =
        [
            new ConversationCreated(command.ConversationId, command.Title, command.Agent, command.ProjectId, now.ToString("O"))
        ];

        return events.AsSuccess();
    }

    public RlabResult<IReadOnlyList<object>> Decide(AppendUserMessage command)
    {
        var created = ConfirmCreated(command.ConversationId);
        if (created.IsFailure)
        {
            return created.ErrorOf<IReadOnlyList<object>>();
        }

        if (MessageIds.Contains(command.MessageId))
        {
            return $"Message '{command.MessageId}' already exists.".AsFailure<IReadOnlyList<object>>();
        }

        var message = new ChatMessage(command.MessageId, "user", command.Text, Time: command.Time);
        IReadOnlyList<object> events = [new MessageAppended(command.ConversationId, message)];
        return events.AsSuccess();
    }

    public RlabResult<IReadOnlyList<object>> Decide(StartRun command)
    {
        return ConfirmCreated(command.ConversationId)
            .Bind(_ => ConfirmNoActiveRun(command.ConversationId))
            .Map(_ =>
            {
                IReadOnlyList<object> events =
                [
                    new ConversationRunStarted(command.ConversationId, command.RunId, command.UserMessageId, command.AgentMessageId)
                ];
                return events;
            });
    }

    public RlabResult<IReadOnlyList<object>> Decide(CancelRun command)
    {
        return DecideRunFinished(command.ConversationId, command.RunId, "idle");
    }

    public RlabResult<IReadOnlyList<object>> Decide(CompleteRun command)
    {
        return DecideRunFinished(command.ConversationId, command.RunId, "done");
    }

    public RlabResult<IReadOnlyList<object>> Decide(FailRun command)
    {
        return DecideRunFinished(command.ConversationId, command.RunId, "error");
    }

    public RlabResult<RlabUnit> ConfirmCreated(string conversationId)
    {
        if (!IsCreated)
        {
            return $"Conversation '{conversationId}' does not exist.".AsFailure<RlabUnit>();
        }

        return RlabResult.Success();
    }

    public void Apply(object @event)
    {
        switch (@event)
        {
            case ConversationCreated value:
                Apply(value);
                break;
            case MessageAppended value:
                Apply(value);
                break;
            case ConversationRunStarted value:
                Apply(value);
                break;
            case ConversationRunFinished value:
                Apply(value);
                break;
            default:
                return;
        }

        Version++;
    }

    public void Apply(ConversationCreated @event)
    {
        IsCreated = true;
        Title = @event.Title;
        Agent = @event.Agent;
        ProjectId = @event.ProjectId;
        Status = "idle";
    }

    public void Apply(MessageAppended @event)
    {
        MessageIds.Add(@event.Message.Id);
    }

    public void Apply(ConversationRunStarted @event)
    {
        ActiveRunId = @event.RunId;
        Status = "running";
    }

    public void Apply(ConversationRunFinished @event)
    {
        if (ActiveRunId == @event.RunId)
        {
            ActiveRunId = null;
        }

        Status = @event.Status;
    }

    private RlabResult<RlabUnit> ConfirmNoActiveRun(string conversationId)
    {
        if (ActiveRunId is not null)
        {
            return $"Conversation '{conversationId}' already has active run '{ActiveRunId}'.".AsFailure<RlabUnit>();
        }

        return RlabResult.Success();
    }

    private RlabResult<IReadOnlyList<object>> DecideRunFinished(string conversationId, string runId, string status)
    {
        return ConfirmCreated(conversationId)
            .Bind(_ => ConfirmActiveRun(conversationId, runId))
            .Map(_ =>
            {
                IReadOnlyList<object> events = [new ConversationRunFinished(conversationId, runId, status)];
                return events;
            });
    }

    private RlabResult<RlabUnit> ConfirmActiveRun(string conversationId, string runId)
    {
        if (ActiveRunId != runId)
        {
            return $"Conversation '{conversationId}' is not running '{runId}'.".AsFailure<RlabUnit>();
        }

        return RlabResult.Success();
    }
}
