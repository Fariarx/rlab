using Rlab.Domain.Metadata;

namespace Rlab.Domain.Workspace;

[RlabCommand("workspace.createConversation", Version = 1)]
public sealed record CreateConversation(string ConversationId, string Title, string Agent, string? ProjectId = null);

[RlabCommand("workspace.appendUserMessage", Version = 1)]
public sealed record AppendUserMessage(string ConversationId, string MessageId, string Text, string Time);

[RlabCommand("workspace.selectConversation", Version = 1)]
public sealed record SelectConversation(string ConversationId);
