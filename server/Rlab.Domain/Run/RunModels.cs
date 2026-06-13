namespace Rlab.Domain.Run;

public sealed record RunOutputEvent(string Type, string? Text = null, string? InputId = null, string? InputType = null);

public sealed record RunView
{
    public string Id { get; init; } = "";
    public string ConversationId { get; init; } = "";
    public string UserMessageId { get; init; } = "";
    public string AgentMessageId { get; init; } = "";
    public string Status { get; init; } = "requested";
    public DateTimeOffset? StartedAt { get; init; }
    public IReadOnlyList<RunOutputEvent> Events { get; init; } = [];
    public string? WaitingInputId { get; init; }
    public string? Error { get; init; }
    public long UpdatedGlobalPosition { get; init; }
}
