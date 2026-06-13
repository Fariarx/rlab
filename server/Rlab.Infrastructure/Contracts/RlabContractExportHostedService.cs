using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Rlab.Infrastructure.Contracts;

public sealed record RlabContractExportOptions
{
    public bool Enabled { get; set; } = true;
    public string OutputPath { get; set; } = "";
}

public sealed class RlabContractExportHostedService : IHostedService
{
    private readonly IRlabTypeScriptContractExporter _exporter;
    private readonly IOptions<RlabContractExportOptions> _options;
    private readonly ILogger<RlabContractExportHostedService> _logger;

    public RlabContractExportHostedService(
        IRlabTypeScriptContractExporter exporter,
        IOptions<RlabContractExportOptions> options,
        ILogger<RlabContractExportHostedService> logger)
    {
        _exporter = exporter;
        _options = options;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        var options = _options.Value;
        if (!options.Enabled)
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(options.OutputPath))
        {
            throw new InvalidOperationException("Rlab contracts export is enabled but no output path is configured.");
        }

        var outputPath = Path.GetFullPath(options.OutputPath);
        var directory = Path.GetDirectoryName(outputPath);
        if (string.IsNullOrWhiteSpace(directory))
        {
            throw new InvalidOperationException($"Invalid RLab contracts output path '{outputPath}'.");
        }

        Directory.CreateDirectory(directory);
        await File.WriteAllTextAsync(outputPath, _exporter.Export(), cancellationToken).ConfigureAwait(false);
        _logger.LogInformation("Exported RLab TypeScript contracts to {OutputPath}", outputPath);
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
