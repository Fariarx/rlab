using Marten;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Rlab.Infrastructure.Projections;

namespace Rlab.Infrastructure.Models;

public sealed class RlabModelStartupValidator : IHostedService
{
    private readonly IDocumentStore _store;
    private readonly RlabModelManifestService _manifestService;
    private readonly IRlabProjectionMaintenance _projectionMaintenance;
    private readonly IRlabProjectionService _projectionService;
    private readonly ILogger<RlabModelStartupValidator> _logger;

    public RlabModelStartupValidator(
        IDocumentStore store,
        RlabModelManifestService manifestService,
        IRlabProjectionMaintenance projectionMaintenance,
        IRlabProjectionService projectionService,
        ILogger<RlabModelStartupValidator> logger)
    {
        _store = store;
        _manifestService = manifestService;
        _projectionMaintenance = projectionMaintenance;
        _projectionService = projectionService;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Validated {ProjectionApplierCount} RLab projection appliers.", _projectionService.RegisteredApplierCount);

        var current = _manifestService.CreateCurrentManifest();

        await using var session = _store.LightweightSession();
        var storedDocument = await session.LoadAsync<RlabModelManifestDocument>(RlabModelManifest.DocumentId, cancellationToken).ConfigureAwait(false);
        var comparison = _manifestService.Compare(storedDocument?.Manifest, current);

        if (comparison.Compatibility == RlabModelCompatibility.Incompatible)
        {
            throw new RlabModelManifestException(comparison);
        }

        if (comparison.Compatibility == RlabModelCompatibility.ProjectionRebuildRequired)
        {
            _logger.LogWarning("RLab projection manifest mismatch detected. Rebuilding projections: {ProjectionNames}", string.Join(", ", comparison.StaleProjectionNames));
            await _projectionMaintenance.RebuildAsync(comparison.StaleProjectionNames, cancellationToken).ConfigureAwait(false);
        }

        if (comparison.Compatibility != RlabModelCompatibility.UpToDate)
        {
            session.Store(new RlabModelManifestDocument
            {
                Id = RlabModelManifest.DocumentId,
                Manifest = current,
                AppliedAt = DateTimeOffset.UtcNow
            });
            await session.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
