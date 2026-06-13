using Rlab.Domain.Metadata;

namespace Rlab.Domain.Workspace;

[RlabEvent("conversation.created", Version = 1)]
public sealed record ConversationCreated(string ConversationId, string Title, string Agent, string? ProjectId, string Time);

[RlabEvent("conversation.messageAppended", Version = 1)]
public sealed record MessageAppended(string ConversationId, ChatMessage Message);

[RlabEvent("workspace.selectedConversationSet", Version = 1)]
public sealed record SelectedConversationSet(string ConversationId);

[RlabEvent("conversation.runStarted", Version = 1)]
public sealed record ConversationRunStarted(string ConversationId, string RunId, string UserMessageId, string AgentMessageId);

[RlabEvent("conversation.runFinished", Version = 1)]
public sealed record ConversationRunFinished(string ConversationId, string RunId, string Status);
