using Rlab.Domain.Contracts;
using Rlab.Domain.Generated;
using Rlab.Domain.Workspace;
using Rlab.Infrastructure.Aggregates;
using Rlab.Infrastructure.Commands;

namespace Rlab.Infrastructure.Workspace;

public sealed class CreateConversationHandler : RlabCommandHandler<CreateConversation>
{
    private readonly IRlabAggregateRepository _aggregates;
    private readonly IRlabCommandEventStore _eventStore;

    public CreateConversationHandler(IRlabAggregateRepository aggregates, IRlabCommandEventStore eventStore)
    {
        _aggregates = aggregates;
        _eventStore = eventStore;
    }

    public override async ValueTask<RlabResult<RlabCommandResult>> HandleAsync(RlabCommandEnvelope envelope, CreateConversation command, CancellationToken cancellationToken)
    {
        var conversationStream = RlabGeneratedRegistry.ConversationStream(command.ConversationId);
        var conversation = await _aggregates.LoadAsync<ConversationAggregate>(conversationStream, cancellationToken).ConfigureAwait(false);
        var conversationDecision = conversation.Decide(command, DateTimeOffset.UtcNow);
        if (conversationDecision.IsFailure)
        {
            return conversationDecision.ErrorOf<RlabCommandResult>();
        }

        var workspaceStream = RlabGeneratedRegistry.WorkspaceStream();
        var workspace = await _aggregates.LoadAsync<WorkspaceAggregate>(workspaceStream, cancellationToken).ConfigureAwait(false);
        var workspaceDecision = workspace.Decide(new SelectConversation(command.ConversationId));
        if (workspaceDecision.IsFailure)
        {
            return workspaceDecision.ErrorOf<RlabCommandResult>();
        }

        return await _eventStore.AppendAsync(envelope, [
            new RlabEventBatch(conversationStream, conversation.Version, conversationDecision.Value),
            new RlabEventBatch(workspaceStream, workspace.Version, workspaceDecision.Value)
        ], cancellationToken).ConfigureAwait(false);
    }
}

public sealed class AppendUserMessageHandler : RlabCommandHandler<AppendUserMessage>
{
    private readonly IRlabAggregateRepository _aggregates;
    private readonly IRlabCommandEventStore _eventStore;

    public AppendUserMessageHandler(IRlabAggregateRepository aggregates, IRlabCommandEventStore eventStore)
    {
        _aggregates = aggregates;
        _eventStore = eventStore;
    }

    public override async ValueTask<RlabResult<RlabCommandResult>> HandleAsync(RlabCommandEnvelope envelope, AppendUserMessage command, CancellationToken cancellationToken)
    {
        var conversationStream = RlabGeneratedRegistry.ConversationStream(command.ConversationId);
        var conversation = await _aggregates.LoadAsync<ConversationAggregate>(conversationStream, cancellationToken).ConfigureAwait(false);
        return await conversation
            .Decide(command)
            .BindAsync(events => _eventStore.AppendAsync(envelope, [
                new RlabEventBatch(conversationStream, conversation.Version, events)
            ], cancellationToken))
            .ConfigureAwait(false);
    }
}

public sealed class SelectConversationHandler : RlabCommandHandler<SelectConversation>
{
    private readonly IRlabAggregateRepository _aggregates;
    private readonly IRlabCommandEventStore _eventStore;

    public SelectConversationHandler(IRlabAggregateRepository aggregates, IRlabCommandEventStore eventStore)
    {
        _aggregates = aggregates;
        _eventStore = eventStore;
    }

    public override async ValueTask<RlabResult<RlabCommandResult>> HandleAsync(RlabCommandEnvelope envelope, SelectConversation command, CancellationToken cancellationToken)
    {
        var conversation = await _aggregates.LoadAsync<ConversationAggregate>(
            RlabGeneratedRegistry.ConversationStream(command.ConversationId),
            cancellationToken).ConfigureAwait(false);
        var exists = conversation.ConfirmCreated(command.ConversationId);
        if (exists.IsFailure)
        {
            return exists.ErrorOf<RlabCommandResult>();
        }

        var workspaceStream = RlabGeneratedRegistry.WorkspaceStream();
        var workspace = await _aggregates.LoadAsync<WorkspaceAggregate>(workspaceStream, cancellationToken).ConfigureAwait(false);
        return await workspace.Decide(command)
            .BindAsync(events => _eventStore.AppendAsync(envelope, [
                new RlabEventBatch(workspaceStream, workspace.Version, events)
            ], cancellationToken))
            .ConfigureAwait(false);
    }
}
