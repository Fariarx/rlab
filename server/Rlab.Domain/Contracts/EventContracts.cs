namespace Rlab.Domain.Contracts;

public sealed record RlabEventMetadata(
    int SchemaVersion,
    string CommandId,
    string ClientId,
    string CorrelationId,
    string? CausationId,
    string? Actor,
    DateTimeOffset CreatedAt);

public sealed record RecordedRlabEvent(
    string Type,
    object Data,
    RlabEventMetadata Metadata,
    string StreamName,
    string StreamPosition,
    string GlobalPosition);
