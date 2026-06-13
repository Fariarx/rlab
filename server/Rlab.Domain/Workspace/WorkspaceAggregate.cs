using Rlab.Domain.Metadata;
using Rlab.Domain.Contracts;

namespace Rlab.Domain.Workspace;

[RlabAggregate("workspace")]
public sealed class WorkspaceAggregate : IRlabAggregate
{
    public string SelectedId { get; private set; } = "";
    public long Version { get; private set; }

    public RlabResult<IReadOnlyList<object>> Decide(SelectConversation command)
    {
        IReadOnlyList<object> events = [new SelectedConversationSet(command.ConversationId)];
        return events.AsSuccess();
    }

    public void Apply(object @event)
    {
        switch (@event)
        {
            case SelectedConversationSet value:
                Apply(value);
                break;
            default:
                return;
        }

        Version++;
    }

    public void Apply(SelectedConversationSet @event)
    {
        SelectedId = @event.ConversationId;
    }
}
