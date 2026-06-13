using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Rlab.Domain.Generated;
using Rlab.Infrastructure;
using Rlab.Infrastructure.Contracts;
using Rlab.Infrastructure.Models;
using Rlab.Infrastructure.Projections;

var command = args.FirstOrDefault();
var exitCode = command switch
{
    "contracts" => await HandleContractsAsync(args.Skip(1).ToArray()).ConfigureAwait(false),
    "models" => HandleModels(args.Skip(1).ToArray()),
    "projections" => await HandleProjectionsAsync(args.Skip(1).ToArray()).ConfigureAwait(false),
    _ => Usage()
};

return exitCode;

static int Usage()
{
    Console.Error.WriteLine("Usage:");
    Console.Error.WriteLine("  rlab contracts export [--output <path>]");
    Console.Error.WriteLine("  rlab models check");
    Console.Error.WriteLine("  rlab projections status --connection <postgres>");
    Console.Error.WriteLine("  rlab projections rebuild --all --connection <postgres>");
    Console.Error.WriteLine("  rlab projections rebuild --name <projection> --connection <postgres>");
    return 2;
}

static async Task<int> HandleContractsAsync(string[] args)
{
    if (args.FirstOrDefault() != "export")
    {
        return Usage();
    }

    var output = ReadOption(args, "--output") ?? Path.GetFullPath(Path.Combine("..", "..", "next-ui", "src", "generated", "rlab-api.ts"));
    var registry = RlabGeneratedRegistry.Create();
    var exporter = new RlabTypeScriptContractExporter(registry);
    var content = exporter.Export();

    var directory = Path.GetDirectoryName(output);
    if (!string.IsNullOrWhiteSpace(directory))
    {
        Directory.CreateDirectory(directory);
    }

    await File.WriteAllTextAsync(output, content).ConfigureAwait(false);
    Console.WriteLine($"Wrote {output}");
    return 0;
}

static int HandleModels(string[] args)
{
    if (args.FirstOrDefault() != "check")
    {
        return Usage();
    }

    var registry = RlabGeneratedRegistry.Create();
    var service = new RlabModelManifestService(registry, new RlabEventUpcasterRegistry([]));
    var manifest = service.CreateCurrentManifest();
    Console.WriteLine(JsonSerializer.Serialize(manifest, RlabModelManifestJson.Options));
    return 0;
}

static async Task<int> HandleProjectionsAsync(string[] args)
{
    var action = args.FirstOrDefault();
    if (action is not ("status" or "rebuild"))
    {
        return Usage();
    }

    var connection = ReadOption(args, "--connection")
        ?? Environment.GetEnvironmentVariable("ConnectionStrings__RlabPostgres")
        ?? Environment.GetEnvironmentVariable("RlabPostgres");

    if (string.IsNullOrWhiteSpace(connection))
    {
        Console.Error.WriteLine("Postgres connection string is required. Pass --connection or set ConnectionStrings__RlabPostgres.");
        return 2;
    }

    await using var provider = BuildProvider(connection);
    var maintenance = provider.GetRequiredService<IRlabProjectionMaintenance>();

    if (action == "status")
    {
        var status = await maintenance.GetStatusAsync(CancellationToken.None).ConfigureAwait(false);
        Console.WriteLine(JsonSerializer.Serialize(status, RlabModelManifestJson.Options));
        return 0;
    }

    var names = ReadOption(args, "--name") is { } name
        ? new[] { name }
        : args.Contains("--all", StringComparer.Ordinal) ? Array.Empty<string>() : null;

    if (names is null)
    {
        return Usage();
    }

    await maintenance.RebuildAsync(names, CancellationToken.None).ConfigureAwait(false);
    Console.WriteLine("Projection rebuild complete.");
    return 0;
}

static ServiceProvider BuildProvider(string connection)
{
    var configuration = new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:RlabPostgres"] = connection
        })
        .Build();

    var services = new ServiceCollection();
    services.AddLogging();
    services.Configure<RlabContractExportOptions>(options => options.Enabled = false);
    services.AddRlabInfrastructure(configuration);
    return services.BuildServiceProvider(validateScopes: true);
}

static string? ReadOption(string[] args, string name)
{
    for (var index = 0; index < args.Length - 1; index++)
    {
        if (args[index] == name)
        {
            return args[index + 1];
        }
    }

    return null;
}
