using Rlab.Domain.Metadata;

namespace Rlab.Domain.Run;

[RlabEvent("run.requested", Version = 1)]
public sealed record RunRequested(
    string RunId,
    string ConversationId,
    string UserMessageId,
    string AgentMessageId,
    string Prompt,
    string Agent,
    string Model,
    string Reasoning,
    string Mode);

[RlabEvent("run.started", Version = 1)]
public sealed record RunStarted(string RunId, string ConversationId, string UserMessageId, string AgentMessageId, DateTimeOffset StartedAt);

[RlabEvent("run.outputRecorded", Version = 1)]
public sealed record RunOutputRecorded(string RunId, string ConversationId, RunOutputEvent Event);

[RlabEvent("run.waitingForInput", Version = 1)]
public sealed record RunWaitingForInput(string RunId, string ConversationId, string InputId, string InputType);

[RlabEvent("run.inputProvided", Version = 1)]
public sealed record RunInputProvided(string RunId, string ConversationId, string InputId, string Value);

[RlabEvent("run.completed", Version = 1)]
public sealed record RunCompleted(string RunId, string ConversationId, RunOutputEvent? Event);

[RlabEvent("run.failed", Version = 1)]
public sealed record RunFailed(string RunId, string ConversationId, string Error);

[RlabEvent("run.cancelled", Version = 1)]
public sealed record RunCancelled(string RunId, string ConversationId, string? Reason);
