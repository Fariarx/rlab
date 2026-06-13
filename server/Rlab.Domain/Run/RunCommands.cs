using Rlab.Domain.Metadata;

namespace Rlab.Domain.Run;

[RlabCommand("run.start", Version = 1)]
public sealed record StartRun(
    string RunId,
    string ConversationId,
    string UserMessageId,
    string AgentMessageId,
    string Prompt,
    string Agent,
    string Model,
    string Reasoning,
    string Mode);

[RlabCommand("run.recordOutput", Version = 1)]
public sealed record RecordRunOutput(string RunId, string ConversationId, RunOutputEvent Event);

[RlabCommand("run.requestApproval", Version = 1)]
public sealed record RequestApproval(string RunId, string ConversationId, string InputId, string InputType);

[RlabCommand("run.decideApproval", Version = 1)]
public sealed record DecideApproval(string RunId, string ConversationId, string InputId, string Decision);

[RlabCommand("run.provideInput", Version = 1)]
public sealed record ProvideRunInput(string RunId, string ConversationId, string InputId, string Value);

[RlabCommand("run.cancel", Version = 1)]
public sealed record CancelRun(string RunId, string ConversationId, string? Reason);

[RlabCommand("run.complete", Version = 1)]
public sealed record CompleteRun(string RunId, string ConversationId, RunOutputEvent? Event = null);

[RlabCommand("run.fail", Version = 1)]
public sealed record FailRun(string RunId, string ConversationId, string Error);
