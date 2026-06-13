using Rlab.Domain.Metadata;

namespace Rlab.Domain.Workspace;

[RlabQuery("workspace.snapshot", Version = 1)]
public sealed record WorkspaceSnapshotQuery;

[RlabQuery("workspace.thread", Version = 1)]
public sealed record WorkspaceThreadQuery(string ConversationId);
