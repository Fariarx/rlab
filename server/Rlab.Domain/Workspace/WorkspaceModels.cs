using System.Text.Json;

namespace Rlab.Domain.Workspace;

public sealed record ChatMessage(
    string Id,
    string Role,
    string? Text = null,
    IReadOnlyList<JsonElement>? Blocks = null,
    string? Time = null,
    long? StartedAtMs = null,
    JsonElement? Profile = null,
    decimal? CostUsd = null,
    JsonElement? Usage = null);

public sealed record ConversationSummary(
    string Id,
    string Title,
    string Snippet,
    string Time,
    string Status,
    string Agent,
    string? ActiveRunId = null,
    bool Archived = false,
    bool Pinned = false);

public sealed record ProjectSummary(string Id, string Name, string? Path, IReadOnlyList<ConversationSummary> Conversations);

public sealed record ComposerDraft(string Text, IReadOnlyList<string> Attachments);

public sealed record WorkspaceSettings(string Locale = "en");

public sealed record WorkspaceView
{
    public string Id { get; init; } = "workspace";
    public IReadOnlyList<ConversationSummary> Chats { get; init; } = [];
    public IReadOnlyList<ProjectSummary> Projects { get; init; } = [];
    public IReadOnlyDictionary<string, ComposerDraft> ComposerDrafts { get; init; } = new Dictionary<string, ComposerDraft>();
    public string SelectedId { get; init; } = "";
    public WorkspaceSettings Settings { get; init; } = new();
    public long UpdatedGlobalPosition { get; init; }
}

public sealed record ConversationView
{
    public string Id { get; init; } = "";
    public string? ProjectId { get; init; }
    public ConversationSummary Summary { get; init; } = new("", "", "", "", "idle", "codex");
    public long UpdatedGlobalPosition { get; init; }
}

public sealed record ThreadMessageView
{
    public string Id { get; init; } = "";
    public string ConversationId { get; init; } = "";
    public int Position { get; init; }
    public ChatMessage Message { get; init; } = new("", "user");
    public long UpdatedGlobalPosition { get; init; }
}
