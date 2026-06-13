using System.Collections.Immutable;
using Rlab.Domain.Metadata;

namespace Rlab.Infrastructure.Models;

public sealed class RlabModelManifestService
{
    private readonly RlabModelRegistry _registry;
    private readonly IRlabEventUpcasterRegistry _upcasters;

    public RlabModelManifestService(RlabModelRegistry registry, IRlabEventUpcasterRegistry upcasters)
    {
        _registry = registry;
        _upcasters = upcasters;
    }

    public RlabModelManifest CreateCurrentManifest(DateTimeOffset? generatedAt = null)
    {
        var entries = _registry.Models
            .OrderBy(model => model.Kind)
            .ThenBy(model => model.WireName, StringComparer.Ordinal)
            .ThenBy(model => model.Version)
            .Select(model => new RlabModelManifestEntry(
                model.Kind,
                model.WireName,
                model.Version,
                model.ClrType,
                model.SchemaHash,
                model.Dependencies,
                model.HandledEventClrTypes))
            .ToImmutableArray();

        return new RlabModelManifest(
            RlabModelManifest.CurrentManifestVersion,
            generatedAt ?? DateTimeOffset.UtcNow,
            entries);
    }

    public RlabModelManifestComparison Compare(RlabModelManifest? stored, RlabModelManifest current)
    {
        if (stored is null)
        {
            return new RlabModelManifestComparison(
                RlabModelCompatibility.CompatibleAdditive,
                ImmutableArray.Create("No stored model manifest was found. Current manifest can be applied."),
                ImmutableArray<string>.Empty);
        }

        var messages = ImmutableArray.CreateBuilder<string>();
        var staleProjections = ImmutableArray.CreateBuilder<string>();
        var compatibility = RlabModelCompatibility.UpToDate;

        var currentByIdentity = current.Models.ToDictionary(Identity, StringComparer.Ordinal);
        var storedByIdentity = stored.Models.ToDictionary(Identity, StringComparer.Ordinal);
        var currentByKindAndWire = current.Models
            .GroupBy(KindAndWire, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.OrderByDescending(model => model.Version).ToArray(), StringComparer.Ordinal);

        foreach (var storedModel in stored.Models)
        {
            if (!currentByIdentity.TryGetValue(Identity(storedModel), out var currentModel))
            {
                if (currentByKindAndWire.TryGetValue(KindAndWire(storedModel), out var renamedVersions) && renamedVersions.Length == 1)
                {
                    var renamedVersion = renamedVersions[0];
                    if (storedModel.Kind == RlabModelKind.Event && _upcasters.HasChain(storedModel.WireName, storedModel.Version, renamedVersion.Version))
                    {
                        messages.Add($"Event '{storedModel.WireName}' moved from v{storedModel.Version} to v{renamedVersion.Version} and has a complete upcaster chain.");
                        compatibility = Max(compatibility, RlabModelCompatibility.CompatibleAdditive);
                    }
                    else if (storedModel.Kind == RlabModelKind.Projection)
                    {
                        messages.Add($"Projection '{storedModel.WireName}' version changed from v{storedModel.Version} to v{renamedVersion.Version} and must be rebuilt.");
                        staleProjections.Add(storedModel.WireName);
                        compatibility = Max(compatibility, RlabModelCompatibility.ProjectionRebuildRequired);
                    }
                    else
                    {
                        messages.Add($"{storedModel.Kind} '{storedModel.WireName}' version changed from v{storedModel.Version} to v{renamedVersion.Version} without a registered upgrader.");
                        compatibility = RlabModelCompatibility.Incompatible;
                    }
                }
                else
                {
                    messages.Add($"Stored model '{Identity(storedModel)}' is missing from current code manifest.");
                    compatibility = RlabModelCompatibility.Incompatible;
                }

                continue;
            }

            if (storedModel.SchemaHash == currentModel.SchemaHash)
            {
                continue;
            }

            if (storedModel.Kind == RlabModelKind.Projection)
            {
                messages.Add($"Projection '{storedModel.WireName}' schema changed and must be rebuilt.");
                staleProjections.Add(storedModel.WireName);
                compatibility = Max(compatibility, RlabModelCompatibility.ProjectionRebuildRequired);
                continue;
            }

            if (storedModel.Kind == RlabModelKind.Event)
            {
                if (currentModel.Version > storedModel.Version && _upcasters.HasChain(storedModel.WireName, storedModel.Version, currentModel.Version))
                {
                    messages.Add($"Event '{storedModel.WireName}' changed and has a complete upcaster chain.");
                    compatibility = Max(compatibility, RlabModelCompatibility.CompatibleAdditive);
                }
                else
                {
                    messages.Add($"Event '{storedModel.WireName}' changed but no upcaster chain exists from v{storedModel.Version} to v{currentModel.Version}.");
                    compatibility = RlabModelCompatibility.Incompatible;
                }

                continue;
            }

            messages.Add($"{storedModel.Kind} '{storedModel.WireName}' schema hash changed without a version bump.");
            compatibility = RlabModelCompatibility.Incompatible;
        }

        foreach (var currentModel in current.Models)
        {
            if (storedByIdentity.ContainsKey(Identity(currentModel)))
            {
                continue;
            }

            messages.Add($"New {currentModel.Kind} '{currentModel.WireName}' v{currentModel.Version} was added.");
            compatibility = Max(compatibility, RlabModelCompatibility.CompatibleAdditive);
        }

        return new RlabModelManifestComparison(
            compatibility,
            messages.ToImmutable(),
            staleProjections.ToImmutable());
    }

    private static string Identity(RlabModelManifestEntry model) => $"{model.Kind}:{model.WireName}:v{model.Version}";

    private static string KindAndWire(RlabModelManifestEntry model) => $"{model.Kind}:{model.WireName}";

    private static RlabModelCompatibility Max(RlabModelCompatibility left, RlabModelCompatibility right) =>
        (RlabModelCompatibility)Math.Max((int)left, (int)right);
}

public interface IRlabEventUpcaster
{
    string WireName { get; }
    int FromVersion { get; }
    int ToVersion { get; }
}

public interface IRlabEventUpcasterRegistry
{
    bool HasChain(string wireName, int fromVersion, int toVersion);
}

public sealed class RlabEventUpcasterRegistry : IRlabEventUpcasterRegistry
{
    private readonly IReadOnlyCollection<IRlabEventUpcaster> _upcasters;

    public RlabEventUpcasterRegistry(IEnumerable<IRlabEventUpcaster> upcasters)
    {
        _upcasters = upcasters.ToArray();
    }

    public bool HasChain(string wireName, int fromVersion, int toVersion)
    {
        if (fromVersion == toVersion)
        {
            return true;
        }

        var current = fromVersion;
        while (current < toVersion)
        {
            var next = _upcasters
                .Where(upcaster => upcaster.WireName == wireName && upcaster.FromVersion == current)
                .Select(upcaster => upcaster.ToVersion)
                .Distinct()
                .ToArray();

            if (next.Length != 1 || next[0] <= current)
            {
                return false;
            }

            current = next[0];
        }

        return current == toVersion;
    }
}
