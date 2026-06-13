using System.Text.Json;
using JasperFx;
using JasperFx.Events;
using Marten;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Rlab.Domain.Contracts;
using Rlab.Domain.Generated;
using Rlab.Domain.Metadata;
using Rlab.Domain.Run;
using Rlab.Domain.Workspace;
using Rlab.Infrastructure.Aggregates;
using Rlab.Infrastructure.Commands;
using Rlab.Infrastructure.Contracts;
using Rlab.Infrastructure.Generated;
using Rlab.Infrastructure.Models;
using Rlab.Infrastructure.Projections;
using Rlab.Infrastructure.Queries;

namespace Rlab.Infrastructure;

public static class RlabInfrastructureServiceCollectionExtensions
{
    public static IServiceCollection AddRlabInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("RlabPostgres");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("ConnectionStrings:RlabPostgres is required for the C# + Marten backend.");
        }

        var registry = RlabGeneratedRegistry.Create();
        services.AddSingleton(registry);
        services.AddSingleton(new JsonSerializerOptions(JsonSerializerDefaults.Web));
        services.AddSingleton<IRlabEventUpcasterRegistry, RlabEventUpcasterRegistry>();
        services.AddSingleton<RlabModelManifestService>();
        services.AddSingleton<IRlabTypeScriptContractExporter, RlabTypeScriptContractExporter>();
        services.AddSingleton<IRlabProjectionService, RlabProjectionService>();
        services.AddSingleton<IRlabProjectionMaintenance, RlabProjectionMaintenance>();

        services.AddScoped<IRlabAggregateRepository, RlabAggregateRepository>();
        services.AddScoped<IRlabCommandEventStore, RlabCommandEventStore>();
        services.AddScoped<RlabCommandDispatcher>();
        services.AddScoped<RlabQueryDispatcher>();

        foreach (var projectionApplierType in RlabGeneratedRegistry.ProjectionApplierTypes)
        {
            services.AddSingleton(typeof(IRlabProjectionApplier), projectionApplierType);
        }

        services.AddGeneratedRlabInfrastructureServices();

        services.AddMarten(options =>
        {
            options.Connection(connectionString);
            options.AutoCreateSchemaObjects = AutoCreate.CreateOrUpdate;
            options.Events.MetadataConfig.EnableAll();
            options.Events.AppendMode = EventAppendMode.Rich;

            foreach (var eventDescriptor in registry.Events)
            {
                options.Events.MapEventType(RlabGeneratedRegistry.ResolveType(eventDescriptor.ClrType), eventDescriptor.WireName);
            }

            options.Schema.For<WorkspaceView>().Identity(view => view.Id);
            options.Schema.For<ConversationView>().Identity(view => view.Id);
            options.Schema.For<ThreadMessageView>().Identity(view => view.Id);
            options.Schema.For<RunView>().Identity(view => view.Id);
            options.Schema.For<RlabCommandResultDocument>().Identity(document => document.Id);
            options.Schema.For<RlabModelManifestDocument>().Identity(document => document.Id);
            options.Schema.For<RlabProjectionCheckpointDocument>().Identity(document => document.Id);
        });
        services.MartenDaemonModeIsSolo();
        services.AddHostedService<RlabContractExportHostedService>();
        services.AddHostedService<RlabModelStartupValidator>();

        return services;
    }

}
