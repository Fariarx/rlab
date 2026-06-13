using Rlab.Domain.Contracts;

namespace Rlab.Domain.Workspace;

public sealed class ConversationCreatedProjectionApplier : RlabProjectionApplier<ConversationCreated>
{
    public override async ValueTask ApplyAsync(
        IRlabProjectionWriter writer,
        ConversationCreated @event,
        RlabProjectionContext context,
        CancellationToken cancellationToken)
    {
        var summary = new ConversationSummary(
            @event.ConversationId,
            @event.Title,
            "",
            @event.Time,
            "idle",
            @event.Agent);

        writer.Store(new ConversationView
        {
            Id = @event.ConversationId,
            ProjectId = @event.ProjectId,
            Summary = summary,
            UpdatedGlobalPosition = context.GlobalPosition
        });

        var workspace = await WorkspaceProjectionHelpers.LoadWorkspaceAsync(writer, cancellationToken).ConfigureAwait(false);
        var chats = workspace.Chats.Where(chat => chat.Id != @event.ConversationId).ToList();
        chats.Insert(0, summary);
        writer.Store(workspace with
        {
            Chats = chats,
            SelectedId = @event.ConversationId,
            UpdatedGlobalPosition = context.GlobalPosition
        });
    }
}

public sealed class MessageAppendedProjectionApplier : RlabProjectionApplier<MessageAppended>
{
    public override async ValueTask ApplyAsync(
        IRlabProjectionWriter writer,
        MessageAppended @event,
        RlabProjectionContext context,
        CancellationToken cancellationToken)
    {
        var position = await writer.CountAsync<ThreadMessageView>(
            message => message.ConversationId == @event.ConversationId,
            cancellationToken).ConfigureAwait(false);

        writer.Store(new ThreadMessageView
        {
            Id = @event.Message.Id,
            ConversationId = @event.ConversationId,
            Position = position,
            Message = @event.Message,
            UpdatedGlobalPosition = context.GlobalPosition
        });

        var conversation = await writer.LoadAsync<ConversationView>(@event.ConversationId, cancellationToken).ConfigureAwait(false);
        if (conversation is null)
        {
            throw new InvalidOperationException($"Conversation projection '{@event.ConversationId}' does not exist.");
        }

        var snippet = @event.Message.Text ?? conversation.Summary.Snippet;
        var summary = conversation.Summary with
        {
            Snippet = snippet,
            Time = @event.Message.Time ?? conversation.Summary.Time
        };
        writer.Store(conversation with { Summary = summary, UpdatedGlobalPosition = context.GlobalPosition });

        var workspace = await WorkspaceProjectionHelpers.LoadWorkspaceAsync(writer, cancellationToken).ConfigureAwait(false);
        writer.Store(workspace with
        {
            Chats = workspace.Chats.Select(chat => chat.Id == summary.Id ? summary : chat).ToList(),
            UpdatedGlobalPosition = context.GlobalPosition
        });
    }
}

public sealed class SelectedConversationSetProjectionApplier : RlabProjectionApplier<SelectedConversationSet>
{
    public override async ValueTask ApplyAsync(
        IRlabProjectionWriter writer,
        SelectedConversationSet @event,
        RlabProjectionContext context,
        CancellationToken cancellationToken)
    {
        var workspace = await WorkspaceProjectionHelpers.LoadWorkspaceAsync(writer, cancellationToken).ConfigureAwait(false);
        writer.Store(workspace with { SelectedId = @event.ConversationId, UpdatedGlobalPosition = context.GlobalPosition });
    }
}

public sealed class ConversationRunStartedProjectionApplier : RlabProjectionApplier<ConversationRunStarted>
{
    public override async ValueTask ApplyAsync(
        IRlabProjectionWriter writer,
        ConversationRunStarted @event,
        RlabProjectionContext context,
        CancellationToken cancellationToken)
    {
        var conversation = await WorkspaceProjectionHelpers.LoadConversationAsync(writer, @event.ConversationId, cancellationToken).ConfigureAwait(false);
        var summary = conversation.Summary with
        {
            Status = "running",
            ActiveRunId = @event.RunId
        };

        writer.Store(conversation with { Summary = summary, UpdatedGlobalPosition = context.GlobalPosition });
        await WorkspaceProjectionHelpers.StoreWorkspaceSummaryAsync(writer, summary, context.GlobalPosition, cancellationToken).ConfigureAwait(false);
    }
}

public sealed class ConversationRunFinishedProjectionApplier : RlabProjectionApplier<ConversationRunFinished>
{
    public override async ValueTask ApplyAsync(
        IRlabProjectionWriter writer,
        ConversationRunFinished @event,
        RlabProjectionContext context,
        CancellationToken cancellationToken)
    {
        var conversation = await WorkspaceProjectionHelpers.LoadConversationAsync(writer, @event.ConversationId, cancellationToken).ConfigureAwait(false);
        var summary = conversation.Summary with
        {
            Status = @event.Status,
            ActiveRunId = null
        };

        writer.Store(conversation with { Summary = summary, UpdatedGlobalPosition = context.GlobalPosition });
        await WorkspaceProjectionHelpers.StoreWorkspaceSummaryAsync(writer, summary, context.GlobalPosition, cancellationToken).ConfigureAwait(false);
    }
}

internal static class WorkspaceProjectionHelpers
{
    private const string WorkspaceId = "workspace";

    public static async ValueTask<WorkspaceView> LoadWorkspaceAsync(IRlabProjectionWriter writer, CancellationToken cancellationToken)
    {
        return await writer.LoadAsync<WorkspaceView>(WorkspaceId, cancellationToken).ConfigureAwait(false) ?? new WorkspaceView();
    }

    public static async ValueTask<ConversationView> LoadConversationAsync(
        IRlabProjectionWriter writer,
        string conversationId,
        CancellationToken cancellationToken)
    {
        return await writer.LoadAsync<ConversationView>(conversationId, cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidOperationException($"Conversation projection '{conversationId}' does not exist.");
    }

    public static async ValueTask StoreWorkspaceSummaryAsync(
        IRlabProjectionWriter writer,
        ConversationSummary summary,
        long globalPosition,
        CancellationToken cancellationToken)
    {
        var workspace = await LoadWorkspaceAsync(writer, cancellationToken).ConfigureAwait(false);
        writer.Store(workspace with
        {
            Chats = workspace.Chats.Select(chat => chat.Id == summary.Id ? summary : chat).ToList(),
            UpdatedGlobalPosition = globalPosition
        });
    }
}
