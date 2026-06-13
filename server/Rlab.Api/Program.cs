using System.Text.Json;
using Marten;
using Marten.Linq;
using Rlab.Domain.Contracts;
using Rlab.Domain.Metadata;
using Rlab.Domain.Run;
using Rlab.Domain.Workspace;
using Rlab.Infrastructure;
using Rlab.Infrastructure.Contracts;
using Rlab.Infrastructure.Commands;
using Rlab.Infrastructure.Models;
using Rlab.Infrastructure.Projections;
using Rlab.Infrastructure.Queries;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://127.0.0.1:4280");

builder.Services.AddRlabInfrastructure(builder.Configuration);
builder.Services.Configure<RlabContractExportOptions>(options =>
{
    options.Enabled = true;
    options.OutputPath = Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "..", "..", "next-ui", "src", "generated", "rlab-api.ts"));
});
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
});

var app = builder.Build();

var frontendDist = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "..", "..", "next-ui", "dist"));
if (Directory.Exists(frontendDist))
{
    app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(frontendDist) });
    app.UseStaticFiles(new StaticFileOptions { FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(frontendDist) });
    app.MapFallbackToFile("index.html", new StaticFileOptions { FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(frontendDist) });
}

app.MapGet("/api/health", (RlabModelRegistry registry) => Results.Ok(new
{
    ok = true,
    storage = "marten",
    activeEventStore = "postgres",
    modelCount = registry.Models.Length
}));

app.MapGet("/api/models/manifest", (RlabModelManifestService manifests) =>
{
    return Results.Json(manifests.CreateCurrentManifest(), RlabModelManifestJson.Options);
});

app.MapPost("/api/commands", async (RlabCommandRequest request, RlabCommandDispatcher dispatcher, CancellationToken cancellationToken) =>
{
    try
    {
        var response = await dispatcher.DispatchAsync(request, cancellationToken).ConfigureAwait(false);
        return response.Ok ? Results.Ok(response) : Results.BadRequest(response);
    }
    catch (InvalidOperationException exception)
    {
        return Results.BadRequest(new { ok = false, error = exception.Message });
    }
});

app.MapPost("/api/queries", async (RlabQueryEnvelope request, RlabQueryDispatcher dispatcher, CancellationToken cancellationToken) =>
{
    try
    {
        return Results.Ok(await dispatcher.DispatchAsync(request, cancellationToken).ConfigureAwait(false));
    }
    catch (InvalidOperationException exception)
    {
        return Results.BadRequest(new { ok = false, error = exception.Message });
    }
});

app.MapGet("/api/state/snapshot", async (IQuerySession session, CancellationToken cancellationToken) =>
{
    var snapshot = await session.LoadAsync<WorkspaceView>("workspace", cancellationToken).ConfigureAwait(false) ?? new WorkspaceView();
    return Results.Ok(snapshot);
});

app.MapGet("/api/state/thread", async (string conversationId, IQuerySession session, CancellationToken cancellationToken) =>
{
    var messages = await session.Query<ThreadMessageView>()
        .Where(message => message.ConversationId == conversationId)
        .OrderBy(message => message.Position)
        .ToListAsync(cancellationToken)
        .ConfigureAwait(false);

    return Results.Ok(new WorkspaceThreadResult(conversationId, messages));
});

app.MapGet("/api/runs/active", async (IQuerySession session, CancellationToken cancellationToken) =>
{
    var runs = await session.Query<RunView>()
        .Where(run => run.Status == "requested" || run.Status == "running" || run.Status == "waiting")
        .OrderBy(run => run.UpdatedGlobalPosition)
        .ToListAsync(cancellationToken)
        .ConfigureAwait(false);

    return Results.Ok(new ActiveRunsResult(runs));
});

app.MapGet("/api/runs", async (IQuerySession session, CancellationToken cancellationToken) =>
{
    var runs = await session.Query<RunView>()
        .Where(run => run.Status == "requested" || run.Status == "running" || run.Status == "waiting")
        .OrderBy(run => run.UpdatedGlobalPosition)
        .ToListAsync(cancellationToken)
        .ConfigureAwait(false);

    return Results.Ok(new
    {
        runs = runs.Select(run => new
        {
            runId = run.Id,
            run.ConversationId,
            run.UserMessageId,
            run.AgentMessageId,
            startedAt = (run.StartedAt ?? DateTimeOffset.UnixEpoch).ToString("O")
        })
    });
});

app.MapPost("/api/run-cancel", async (LegacyRunCancelRequest request, IQuerySession session, RlabCommandDispatcher dispatcher, JsonSerializerOptions jsonOptions, CancellationToken cancellationToken) =>
{
    var run = await session.LoadAsync<RunView>(request.RunId, cancellationToken).ConfigureAwait(false);
    if (run is null)
    {
        return Results.NotFound(new { ok = false, error = $"Run '{request.RunId}' was not found." });
    }

    return await DispatchGeneratedCommandAsync(
        "run.cancel",
        1,
        new CancelRun(run.Id, run.ConversationId, request.Reason),
        dispatcher,
        jsonOptions,
        cancellationToken).ConfigureAwait(false);
});

app.MapPost("/api/run-approval", async (LegacyRunApprovalRequest request, IQuerySession session, RlabCommandDispatcher dispatcher, JsonSerializerOptions jsonOptions, CancellationToken cancellationToken) =>
{
    var run = await FindRunWaitingForInputAsync(session, request.Id, cancellationToken).ConfigureAwait(false);
    if (run is null)
    {
        return Results.NotFound(new { ok = false, error = $"No active run is waiting for input '{request.Id}'." });
    }

    return await DispatchGeneratedCommandAsync(
        "run.decideApproval",
        1,
        new DecideApproval(run.Id, run.ConversationId, request.Id, request.Decision),
        dispatcher,
        jsonOptions,
        cancellationToken).ConfigureAwait(false);
});

app.MapPost("/api/run-input", async (LegacyRunInputRequest request, IQuerySession session, RlabCommandDispatcher dispatcher, JsonSerializerOptions jsonOptions, CancellationToken cancellationToken) =>
{
    var run = await FindRunWaitingForInputAsync(session, request.Id, cancellationToken).ConfigureAwait(false);
    if (run is null)
    {
        return Results.NotFound(new { ok = false, error = $"No active run is waiting for input '{request.Id}'." });
    }

    var value = request.Selected.ValueKind == JsonValueKind.Undefined
        ? ""
        : request.Selected.GetRawText();
    return await DispatchGeneratedCommandAsync(
        "run.provideInput",
        1,
        new ProvideRunInput(run.Id, run.ConversationId, request.Id, value),
        dispatcher,
        jsonOptions,
        cancellationToken).ConfigureAwait(false);
});

app.MapGet("/api/projections/status", async (IRlabProjectionMaintenance projections, CancellationToken cancellationToken) =>
{
    return Results.Ok(await projections.GetStatusAsync(cancellationToken).ConfigureAwait(false));
});

app.MapPost("/api/projections/rebuild", async (ProjectionRebuildRequest request, IRlabProjectionMaintenance projections, CancellationToken cancellationToken) =>
{
    await projections.RebuildAsync(request.Names, cancellationToken).ConfigureAwait(false);
    return Results.Ok(new { ok = true });
});

app.MapGet("/api/state/events", async (HttpContext httpContext, IQuerySession session, JsonSerializerOptions jsonOptions) =>
{
    httpContext.Response.Headers.ContentType = "text/event-stream";
    httpContext.Response.Headers.CacheControl = "no-cache";

    var lastEventId = httpContext.Request.Headers["Last-Event-ID"].FirstOrDefault();
    var fromQuery = httpContext.Request.Query.TryGetValue("from", out var fromValue) ? fromValue.FirstOrDefault() : null;
    var from = ParseGlobalPosition(lastEventId) ?? ParseGlobalPosition(fromQuery) ?? 0;

    while (!httpContext.RequestAborted.IsCancellationRequested)
    {
        var events = await session.Events.QueryAllRawEvents()
            .Where(@event => @event.Sequence > from)
            .OrderBy(@event => @event.Sequence)
            .Take(500)
            .ToListAsync(httpContext.RequestAborted)
            .ConfigureAwait(false);

        if (events.Count == 0)
        {
            await httpContext.Response.WriteAsync(": heartbeat\n\n", httpContext.RequestAborted).ConfigureAwait(false);
            await httpContext.Response.Body.FlushAsync(httpContext.RequestAborted).ConfigureAwait(false);
            await Task.Delay(TimeSpan.FromSeconds(5), httpContext.RequestAborted).ConfigureAwait(false);
            continue;
        }

        foreach (var @event in events)
        {
            from = @event.Sequence;
            var headers = @event.Headers;
            var payload = new
            {
                type = @event.EventTypeName,
                globalPosition = @event.Sequence,
                streamPosition = @event.Version,
                streamId = @event.StreamId,
                streamKey = @event.StreamKey,
                data = @event.Data,
                commandId = headers is not null && headers.TryGetValue("rlab.commandId", out var commandId) ? commandId?.ToString() : null,
                clientId = headers is not null && headers.TryGetValue("rlab.clientId", out var clientId) ? clientId?.ToString() : null,
                correlationId = @event.CorrelationId,
                causationId = @event.CausationId,
                actor = @event.UserName,
                createdAt = @event.Timestamp
            };

            await httpContext.Response.WriteAsync($"id: {@event.Sequence}\n", httpContext.RequestAborted).ConfigureAwait(false);
            await httpContext.Response.WriteAsync("event: rlab\n", httpContext.RequestAborted).ConfigureAwait(false);
            await httpContext.Response.WriteAsync($"data: {JsonSerializer.Serialize(payload, jsonOptions)}\n\n", httpContext.RequestAborted).ConfigureAwait(false);
        }

        await httpContext.Response.Body.FlushAsync(httpContext.RequestAborted).ConfigureAwait(false);
    }
});

app.Run();

static long? ParseGlobalPosition(string? value)
{
    return long.TryParse(value, out var parsed) && parsed >= 0 ? parsed : null;
}

static async ValueTask<RunView?> FindRunWaitingForInputAsync(IQuerySession session, string inputId, CancellationToken cancellationToken)
{
    return await session.Query<RunView>()
        .Where(run => run.WaitingInputId == inputId && run.Status == "waiting")
        .FirstOrDefaultAsync(cancellationToken)
        .ConfigureAwait(false);
}

static async ValueTask<IResult> DispatchGeneratedCommandAsync(
    string type,
    int version,
    object data,
    RlabCommandDispatcher dispatcher,
    JsonSerializerOptions jsonOptions,
    CancellationToken cancellationToken)
{
    var commandId = $"api-{type.Replace('.', '-')}-{Guid.NewGuid():N}";
    var envelope = new RlabCommandEnvelope(
        commandId,
        "legacy-run-api",
        type,
        version,
        JsonSerializer.SerializeToElement(data, jsonOptions),
        CorrelationId: commandId);
    var response = await dispatcher.DispatchAsync(new RlabCommandRequest([envelope]), cancellationToken).ConfigureAwait(false);
    return response.Ok ? Results.Ok(response) : Results.BadRequest(response);
}

public sealed record ProjectionRebuildRequest(IReadOnlyList<string> Names);

public sealed record LegacyRunCancelRequest(string RunId, string? Reason);

public sealed record LegacyRunApprovalRequest(string Id, string Decision);

public sealed record LegacyRunInputRequest(string Id, JsonElement Selected);

public partial class Program;
