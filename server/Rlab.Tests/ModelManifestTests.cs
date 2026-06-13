using System.Collections.Immutable;
using Rlab.Domain.Generated;
using Rlab.Domain.Metadata;
using Rlab.Infrastructure.Models;
using Shouldly;

namespace Rlab.Tests;

public sealed class ModelManifestTests
{
    [Fact]
    public void Missing_stored_manifest_is_compatible_additive()
    {
        var service = CreateService();
        var current = service.CreateCurrentManifest(DateTimeOffset.UnixEpoch);

        var comparison = service.Compare(null, current);

        comparison.Compatibility.ShouldBe(RlabModelCompatibility.CompatibleAdditive);
        comparison.CanServe.ShouldBeTrue();
    }

    [Fact]
    public void Projection_hash_change_marks_projection_stale()
    {
        var service = CreateService();
        var current = service.CreateCurrentManifest(DateTimeOffset.UnixEpoch);
        var stored = current with
        {
            Models = current.Models
                .Select(model => model.WireName == "run-view" ? model with { SchemaHash = "old-hash" } : model)
                .ToImmutableArray()
        };

        var comparison = service.Compare(stored, current);

        comparison.Compatibility.ShouldBe(RlabModelCompatibility.ProjectionRebuildRequired);
        comparison.StaleProjectionNames.ShouldContain("run-view");
    }

    [Fact]
    public void Event_hash_change_without_version_bump_is_incompatible()
    {
        var service = CreateService();
        var current = service.CreateCurrentManifest(DateTimeOffset.UnixEpoch);
        var stored = current with
        {
            Models = current.Models
                .Select(model => model.Kind == RlabModelKind.Event && model.WireName == "run.started" ? model with { SchemaHash = "old-hash" } : model)
                .ToImmutableArray()
        };

        var comparison = service.Compare(stored, current);

        comparison.Compatibility.ShouldBe(RlabModelCompatibility.Incompatible);
        comparison.Messages.ShouldContain(message => message.Contains("no upcaster chain", StringComparison.Ordinal));
    }

    [Fact]
    public void Event_version_change_requires_complete_upcaster_chain()
    {
        var stored = new RlabModelManifest(RlabModelManifest.CurrentManifestVersion, DateTimeOffset.UnixEpoch, [
            Entry(RlabModelKind.Event, "run.started", 1, "old")
        ]);
        var current = new RlabModelManifest(RlabModelManifest.CurrentManifestVersion, DateTimeOffset.UnixEpoch, [
            Entry(RlabModelKind.Event, "run.started", 2, "new")
        ]);

        var service = CreateService(new FakeUpcaster("run.started", 1, 2));
        var comparison = service.Compare(stored, current);

        comparison.Compatibility.ShouldBe(RlabModelCompatibility.CompatibleAdditive);
        comparison.CanServe.ShouldBeTrue();
    }

    private static RlabModelManifestService CreateService(params IRlabEventUpcaster[] upcasters)
    {
        return new RlabModelManifestService(
            RlabGeneratedRegistry.Create(),
            new RlabEventUpcasterRegistry(upcasters));
    }

    private static RlabModelManifestEntry Entry(RlabModelKind kind, string wireName, int version, string schemaHash)
    {
        return new RlabModelManifestEntry(
            kind,
            wireName,
            version,
            "Rlab.Tests.Fake",
            schemaHash,
            ImmutableArray<string>.Empty,
            ImmutableArray<string>.Empty);
    }

    private sealed record FakeUpcaster(string WireName, int FromVersion, int ToVersion) : IRlabEventUpcaster;
}
