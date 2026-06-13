using System.Text.Json;
using Marten;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;
using Rlab.Domain.Contracts;
using Rlab.Domain.Workspace;
using Rlab.Infrastructure;
using Rlab.Infrastructure.Commands;
using Rlab.Infrastructure.Projections;
using Shouldly;

namespace Rlab.Tests.Integration;

public sealed class MartenEventSourcingIntegrationTests
{
    [PostgresIntegrationFact]
    public async Task Commands_append_events_rebuild_projections_and_replay_global_stream()
    {
        var rootConnectionString = Environment.GetEnvironmentVariable(PostgresIntegration.ConnectionStringEnvironmentVariable);
        rootConnectionString.ShouldNotBeNullOrWhiteSpace();

        var schema = $"rlab_test_{Guid.NewGuid():N}";
        var schemaConnectionString = await CreateSchemaAsync(rootConnectionString!, schema).ConfigureAwait(false);

        try
        {
            await using var provider = BuildProvider(schemaConnectionString);

            await DispatchAsync(provider, "cmd-create", "workspace.createConversation", new
            {
                conversationId = "conv-1",
                title = "Test",
                agent = "codex",
                projectId = (string?)null
            }).ConfigureAwait(false);

            var message = await DispatchAsync(provider, "cmd-message", "workspace.appendUserMessage", new
            {
                conversationId = "conv-1",
                messageId = "msg-1",
                text = "hello",
                time = "time-1"
            }).ConfigureAwait(false);

            message.Ok.ShouldBeTrue();
            message.Results.Single().GlobalPosition.ShouldBeGreaterThan(0);

            var changedPayload = await DispatchAsync(provider, "cmd-message", "workspace.appendUserMessage", new
            {
                conversationId = "conv-1",
                messageId = "msg-2",
                text = "different",
                time = "time-2"
            }).ConfigureAwait(false);

            changedPayload.Ok.ShouldBeFalse();
            changedPayload.Error.ShouldBe("Command 'cmd-message' was already recorded with different payload.");

            await using (var scope = provider.CreateAsyncScope())
            {
                var session = scope.ServiceProvider.GetRequiredService<IQuerySession>();
                var workspace = await session.LoadAsync<WorkspaceView>("workspace").ConfigureAwait(false);
                workspace.ShouldNotBeNull();
                workspace.Chats.Single().Id.ShouldBe("conv-1");

                var thread = await session.Query<ThreadMessageView>()
                    .Where(view => view.ConversationId == "conv-1")
                    .OrderBy(view => view.Position)
                    .ToListAsync()
                    .ConfigureAwait(false);
                thread.Single().Message.Text.ShouldBe("hello");
            }

            await using (var scope = provider.CreateAsyncScope())
            {
                var projections = scope.ServiceProvider.GetRequiredService<IRlabProjectionMaintenance>();
                await projections.RebuildAsync([], CancellationToken.None).ConfigureAwait(false);
            }

            await using (var scope = provider.CreateAsyncScope())
            {
                var session = scope.ServiceProvider.GetRequiredService<IQuerySession>();
                var replayedEvents = await session.Events.QueryAllRawEvents()
                    .Where(@event => @event.Sequence > 0)
                    .OrderBy(@event => @event.Sequence)
                    .ToListAsync()
                    .ConfigureAwait(false);

                replayedEvents.Count.ShouldBeGreaterThanOrEqualTo(3);
                replayedEvents.Select(@event => @event.EventTypeName).ShouldContain("conversation.created");
                replayedEvents.Select(@event => @event.EventTypeName).ShouldContain("conversation.messageAppended");

                var rebuiltWorkspace = await session.LoadAsync<WorkspaceView>("workspace").ConfigureAwait(false);
                rebuiltWorkspace.ShouldNotBeNull();
                rebuiltWorkspace.Chats.Single().Snippet.ShouldBe("hello");
            }
        }
        finally
        {
            await DropSchemaAsync(rootConnectionString!, schema).ConfigureAwait(false);
        }
    }

    private static async ValueTask<RlabCommandResponse> DispatchAsync(
        ServiceProvider provider,
        string commandId,
        string type,
        object data)
    {
        await using var scope = provider.CreateAsyncScope();
        var dispatcher = scope.ServiceProvider.GetRequiredService<RlabCommandDispatcher>();
        var envelope = new RlabCommandEnvelope(
            commandId,
            "integration-client",
            type,
            1,
            JsonSerializer.SerializeToElement(data, new JsonSerializerOptions(JsonSerializerDefaults.Web)));

        return await dispatcher.DispatchAsync(new RlabCommandRequest([envelope]), CancellationToken.None).ConfigureAwait(false);
    }

    private static ServiceProvider BuildProvider(string connectionString)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:RlabPostgres"] = connectionString
            })
            .Build();

        var services = new ServiceCollection();
        services.AddLogging(builder => builder.AddConsole());
        services.AddRlabInfrastructure(configuration);
        return services.BuildServiceProvider(validateScopes: true);
    }

    private static async ValueTask<string> CreateSchemaAsync(string connectionString, string schema)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync().ConfigureAwait(false);
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = $"""CREATE SCHEMA "{schema}";""";
            await command.ExecuteNonQueryAsync().ConfigureAwait(false);
        }

        var builder = new NpgsqlConnectionStringBuilder(connectionString)
        {
            SearchPath = schema
        };
        return builder.ConnectionString;
    }

    private static async ValueTask DropSchemaAsync(string connectionString, string schema)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync().ConfigureAwait(false);
        await using var command = connection.CreateCommand();
        command.CommandText = $"""DROP SCHEMA IF EXISTS "{schema}" CASCADE;""";
        await command.ExecuteNonQueryAsync().ConfigureAwait(false);
    }
}
