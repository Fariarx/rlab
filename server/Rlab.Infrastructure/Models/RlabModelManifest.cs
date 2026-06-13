using System.Collections.Immutable;
using System.Text.Json;
using Rlab.Domain.Metadata;

namespace Rlab.Infrastructure.Models;

public sealed record RlabModelManifest(
    int Version,
    DateTimeOffset GeneratedAt,
    ImmutableArray<RlabModelManifestEntry> Models)
{
    public const int CurrentManifestVersion = 1;
    public const string DocumentId = "current";
}

public sealed record RlabModelManifestEntry(
    RlabModelKind Kind,
    string WireName,
    int Version,
    string ClrType,
    string SchemaHash,
    ImmutableArray<string> Dependencies,
    ImmutableArray<string> HandledEventClrTypes);

public sealed record RlabModelManifestDocument
{
    public string Id { get; init; } = RlabModelManifest.DocumentId;
    public RlabModelManifest Manifest { get; init; } = new(RlabModelManifest.CurrentManifestVersion, DateTimeOffset.UnixEpoch, []);
    public DateTimeOffset AppliedAt { get; init; } = DateTimeOffset.UtcNow;
}

public enum RlabModelCompatibility
{
    UpToDate,
    CompatibleAdditive,
    ProjectionRebuildRequired,
    Incompatible
}

public sealed record RlabModelManifestComparison(
    RlabModelCompatibility Compatibility,
    ImmutableArray<string> Messages,
    ImmutableArray<string> StaleProjectionNames)
{
    public bool CanServe => Compatibility is RlabModelCompatibility.UpToDate or RlabModelCompatibility.CompatibleAdditive;
}

public sealed class RlabModelManifestException : Exception
{
    public RlabModelManifestException(RlabModelManifestComparison comparison)
        : base(CreateMessage(comparison))
    {
        Comparison = comparison;
    }

    public RlabModelManifestComparison Comparison { get; }

    private static string CreateMessage(RlabModelManifestComparison comparison)
    {
        var message = string.Join(Environment.NewLine, comparison.Messages);
        return string.IsNullOrWhiteSpace(message) ? "RLab model manifest is incompatible." : message;
    }
}

public static class RlabModelManifestJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };
}
