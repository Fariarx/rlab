using Rlab.Domain.Contracts;

namespace Rlab.Domain.Run;

public sealed class RunRequestedProjectionApplier : RlabProjectionApplier<RunRequested>
{
    public override ValueTask ApplyAsync(
        IRlabProjectionWriter writer,
        RunRequested @event,
        RlabProjectionContext context,
        CancellationToken cancellationToken)
    {
        writer.Store(new RunView
        {
            Id = @event.RunId,
            ConversationId = @event.ConversationId,
            UserMessageId = @event.UserMessageId,
            AgentMessageId = @event.AgentMessageId,
            Status = "requested",
            UpdatedGlobalPosition = context.GlobalPosition
        });

        return ValueTask.CompletedTask;
    }
}

public sealed class RunStartedProjectionApplier : RlabProjectionApplier<RunStarted>
{
    public override async ValueTask ApplyAsync(
        IRlabProjectionWriter writer,
        RunStarted @event,
        RlabProjectionContext context,
        CancellationToken cancellationToken)
    {
        var run = await RunProjectionHelpers.LoadRunAsync(writer, @event.RunId, cancellationToken).ConfigureAwait(false);
        writer.Store(run with
        {
            ConversationId = @event.ConversationId,
            UserMessageId = @event.UserMessageId,
            AgentMessageId = @event.AgentMessageId,
            Status = "running",
            StartedAt = @event.StartedAt,
            UpdatedGlobalPosition = context.GlobalPosition
        });
    }
}

public sealed class RunOutputRecordedProjectionApplier : RlabProjectionApplier<RunOutputRecorded>
{
    public override async ValueTask ApplyAsync(
        IRlabProjectionWriter writer,
        RunOutputRecorded @event,
        RlabProjectionContext context,
        CancellationToken cancellationToken)
    {
        var run = await RunProjectionHelpers.LoadRunAsync(writer, @event.RunId, cancellationToken).ConfigureAwait(false);
        var events = run.Events.ToList();
        events.Add(@event.Event);
        writer.Store(run with { Events = events, Status = "running", UpdatedGlobalPosition = context.GlobalPosition });
    }
}

public sealed class RunWaitingForInputProjectionApplier : RlabProjectionApplier<RunWaitingForInput>
{
    public override async ValueTask ApplyAsync(
        IRlabProjectionWriter writer,
        RunWaitingForInput @event,
        RlabProjectionContext context,
        CancellationToken cancellationToken)
    {
        var run = await RunProjectionHelpers.LoadRunAsync(writer, @event.RunId, cancellationToken).ConfigureAwait(false);
        writer.Store(run with
        {
            Status = "waiting",
            WaitingInputId = @event.InputId,
            UpdatedGlobalPosition = context.GlobalPosition
        });
    }
}

public sealed class RunInputProvidedProjectionApplier : RlabProjectionApplier<RunInputProvided>
{
    public override async ValueTask ApplyAsync(
        IRlabProjectionWriter writer,
        RunInputProvided @event,
        RlabProjectionContext context,
        CancellationToken cancellationToken)
    {
        var run = await RunProjectionHelpers.LoadRunAsync(writer, @event.RunId, cancellationToken).ConfigureAwait(false);
        writer.Store(run with
        {
            Status = "running",
            WaitingInputId = null,
            UpdatedGlobalPosition = context.GlobalPosition
        });
    }
}

public sealed class RunCompletedProjectionApplier : RlabProjectionApplier<RunCompleted>
{
    public override async ValueTask ApplyAsync(
        IRlabProjectionWriter writer,
        RunCompleted @event,
        RlabProjectionContext context,
        CancellationToken cancellationToken)
    {
        var run = await RunProjectionHelpers.LoadRunAsync(writer, @event.RunId, cancellationToken).ConfigureAwait(false);
        var events = run.Events.ToList();
        if (@event.Event is not null)
        {
            events.Add(@event.Event);
        }

        writer.Store(run with
        {
            Events = events,
            Status = "completed",
            WaitingInputId = null,
            UpdatedGlobalPosition = context.GlobalPosition
        });
    }
}

public sealed class RunFailedProjectionApplier : RlabProjectionApplier<RunFailed>
{
    public override async ValueTask ApplyAsync(
        IRlabProjectionWriter writer,
        RunFailed @event,
        RlabProjectionContext context,
        CancellationToken cancellationToken)
    {
        var run = await RunProjectionHelpers.LoadRunAsync(writer, @event.RunId, cancellationToken).ConfigureAwait(false);
        writer.Store(run with
        {
            Status = "failed",
            Error = @event.Error,
            WaitingInputId = null,
            UpdatedGlobalPosition = context.GlobalPosition
        });
    }
}

public sealed class RunCancelledProjectionApplier : RlabProjectionApplier<RunCancelled>
{
    public override async ValueTask ApplyAsync(
        IRlabProjectionWriter writer,
        RunCancelled @event,
        RlabProjectionContext context,
        CancellationToken cancellationToken)
    {
        var run = await RunProjectionHelpers.LoadRunAsync(writer, @event.RunId, cancellationToken).ConfigureAwait(false);
        writer.Store(run with
        {
            Status = "cancelled",
            WaitingInputId = null,
            UpdatedGlobalPosition = context.GlobalPosition
        });
    }
}

internal static class RunProjectionHelpers
{
    public static async ValueTask<RunView> LoadRunAsync(IRlabProjectionWriter writer, string runId, CancellationToken cancellationToken)
    {
        return await writer.LoadAsync<RunView>(runId, cancellationToken).ConfigureAwait(false) ?? new RunView { Id = runId };
    }
}
