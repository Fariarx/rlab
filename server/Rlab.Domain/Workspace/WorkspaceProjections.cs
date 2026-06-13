using Rlab.Domain.Metadata;

namespace Rlab.Domain.Workspace;

[RlabProjection("workspace-view", Version = 1, DependsOn = ["conversation.created", "conversation.messageAppended", "conversation.runStarted", "conversation.runFinished", "workspace.selectedConversationSet"])]
public sealed class WorkspaceViewProjection;

[RlabProjection("conversation-view", Version = 1, DependsOn = ["conversation.created", "conversation.runStarted", "conversation.runFinished"])]
public sealed class ConversationViewProjection;

[RlabProjection("message-view", Version = 1, DependsOn = ["conversation.messageAppended"])]
public sealed class MessageViewProjection;
