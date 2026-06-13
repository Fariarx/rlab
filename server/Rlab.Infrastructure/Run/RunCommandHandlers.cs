using Rlab.Domain.Contracts;
using Rlab.Domain.Generated;
using Rlab.Domain.Run;
using Rlab.Domain.Workspace;
using Rlab.Infrastructure.Aggregates;
using Rlab.Infrastructure.Commands;

namespace Rlab.Infrastructure.Run;

public sealed class StartRunHandler : RlabCommandHandler<StartRun>
{
    private readonly IRlabAggregateRepository _aggregates;
    private readonly IRlabCommandEventStore _eventStore;

    public StartRunHandler(IRlabAggregateRepository aggregates, IRlabCommandEventStore eventStore)
    {
        _aggregates = aggregates;
        _eventStore = eventStore;
    }

    public override async ValueTask<RlabResult<RlabCommandResult>> HandleAsync(RlabCommandEnvelope envelope, StartRun command, CancellationToken cancellationToken)
    {
        var conversationStream = RlabGeneratedRegistry.ConversationStream(command.ConversationId);
        var conversation = await _aggregates.LoadAsync<ConversationAggregate>(conversationStream, cancellationToken).ConfigureAwait(false);
        var conversationDecision = conversation.Decide(command);
        if (conversationDecision.IsFailure)
        {
            return conversationDecision.ErrorOf<RlabCommandResult>();
        }

        var runStream = RlabGeneratedRegistry.RunStream(command.RunId);
        var run = await _aggregates.LoadAsync<RunAggregate>(runStream, cancellationToken).ConfigureAwait(false);
        var runDecision = run.Decide(command, DateTimeOffset.UtcNow);
        if (runDecision.IsFailure)
        {
            return runDecision.ErrorOf<RlabCommandResult>();
        }

        return await _eventStore.AppendAsync(envelope, [
            new RlabEventBatch(conversationStream, conversation.Version, conversationDecision.Value),
            new RlabEventBatch(runStream, run.Version, runDecision.Value)
        ], cancellationToken).ConfigureAwait(false);
    }
}

public sealed class RecordRunOutputHandler : RlabCommandHandler<RecordRunOutput>
{
    private readonly IRlabAggregateRepository _aggregates;
    private readonly IRlabCommandEventStore _eventStore;

    public RecordRunOutputHandler(IRlabAggregateRepository aggregates, IRlabCommandEventStore eventStore)
    {
        _aggregates = aggregates;
        _eventStore = eventStore;
    }

    public override async ValueTask<RlabResult<RlabCommandResult>> HandleAsync(RlabCommandEnvelope envelope, RecordRunOutput command, CancellationToken cancellationToken)
    {
        var runStream = RlabGeneratedRegistry.RunStream(command.RunId);
        var run = await _aggregates.LoadAsync<RunAggregate>(runStream, cancellationToken).ConfigureAwait(false);
        return await run
            .Decide(command)
            .BindAsync(events => _eventStore.AppendAsync(envelope, [
                new RlabEventBatch(runStream, run.Version, events)
            ], cancellationToken))
            .ConfigureAwait(false);
    }
}

public sealed class RequestApprovalHandler : RlabCommandHandler<RequestApproval>
{
    private readonly IRlabAggregateRepository _aggregates;
    private readonly IRlabCommandEventStore _eventStore;

    public RequestApprovalHandler(IRlabAggregateRepository aggregates, IRlabCommandEventStore eventStore)
    {
        _aggregates = aggregates;
        _eventStore = eventStore;
    }

    public override async ValueTask<RlabResult<RlabCommandResult>> HandleAsync(RlabCommandEnvelope envelope, RequestApproval command, CancellationToken cancellationToken)
    {
        var runStream = RlabGeneratedRegistry.RunStream(command.RunId);
        var run = await _aggregates.LoadAsync<RunAggregate>(runStream, cancellationToken).ConfigureAwait(false);
        return await run
            .Decide(command)
            .BindAsync(events => _eventStore.AppendAsync(envelope, [
                new RlabEventBatch(runStream, run.Version, events)
            ], cancellationToken))
            .ConfigureAwait(false);
    }
}

public sealed class DecideApprovalHandler : RlabCommandHandler<DecideApproval>
{
    private readonly IRlabAggregateRepository _aggregates;
    private readonly IRlabCommandEventStore _eventStore;

    public DecideApprovalHandler(IRlabAggregateRepository aggregates, IRlabCommandEventStore eventStore)
    {
        _aggregates = aggregates;
        _eventStore = eventStore;
    }

    public override async ValueTask<RlabResult<RlabCommandResult>> HandleAsync(RlabCommandEnvelope envelope, DecideApproval command, CancellationToken cancellationToken)
    {
        var runStream = RlabGeneratedRegistry.RunStream(command.RunId);
        var run = await _aggregates.LoadAsync<RunAggregate>(runStream, cancellationToken).ConfigureAwait(false);
        return await run
            .Decide(command)
            .BindAsync(events => _eventStore.AppendAsync(envelope, [
                new RlabEventBatch(runStream, run.Version, events)
            ], cancellationToken))
            .ConfigureAwait(false);
    }
}

public sealed class ProvideRunInputHandler : RlabCommandHandler<ProvideRunInput>
{
    private readonly IRlabAggregateRepository _aggregates;
    private readonly IRlabCommandEventStore _eventStore;

    public ProvideRunInputHandler(IRlabAggregateRepository aggregates, IRlabCommandEventStore eventStore)
    {
        _aggregates = aggregates;
        _eventStore = eventStore;
    }

    public override async ValueTask<RlabResult<RlabCommandResult>> HandleAsync(RlabCommandEnvelope envelope, ProvideRunInput command, CancellationToken cancellationToken)
    {
        var runStream = RlabGeneratedRegistry.RunStream(command.RunId);
        var run = await _aggregates.LoadAsync<RunAggregate>(runStream, cancellationToken).ConfigureAwait(false);
        return await run
            .Decide(command)
            .BindAsync(events => _eventStore.AppendAsync(envelope, [
                new RlabEventBatch(runStream, run.Version, events)
            ], cancellationToken))
            .ConfigureAwait(false);
    }
}

public sealed class CancelRunHandler : RlabCommandHandler<CancelRun>
{
    private readonly IRlabAggregateRepository _aggregates;
    private readonly IRlabCommandEventStore _eventStore;

    public CancelRunHandler(IRlabAggregateRepository aggregates, IRlabCommandEventStore eventStore)
    {
        _aggregates = aggregates;
        _eventStore = eventStore;
    }

    public override async ValueTask<RlabResult<RlabCommandResult>> HandleAsync(RlabCommandEnvelope envelope, CancelRun command, CancellationToken cancellationToken)
    {
        var runStream = RlabGeneratedRegistry.RunStream(command.RunId);
        var run = await _aggregates.LoadAsync<RunAggregate>(runStream, cancellationToken).ConfigureAwait(false);
        var runDecision = run.Decide(command);
        if (runDecision.IsFailure)
        {
            return runDecision.ErrorOf<RlabCommandResult>();
        }

        var conversationStream = RlabGeneratedRegistry.ConversationStream(command.ConversationId);
        var conversation = await _aggregates.LoadAsync<ConversationAggregate>(conversationStream, cancellationToken).ConfigureAwait(false);
        var conversationDecision = conversation.Decide(command);
        if (conversationDecision.IsFailure)
        {
            return conversationDecision.ErrorOf<RlabCommandResult>();
        }

        return await _eventStore.AppendAsync(envelope, [
            new RlabEventBatch(runStream, run.Version, runDecision.Value),
            new RlabEventBatch(conversationStream, conversation.Version, conversationDecision.Value)
        ], cancellationToken).ConfigureAwait(false);
    }
}

public sealed class CompleteRunHandler : RlabCommandHandler<CompleteRun>
{
    private readonly IRlabAggregateRepository _aggregates;
    private readonly IRlabCommandEventStore _eventStore;

    public CompleteRunHandler(IRlabAggregateRepository aggregates, IRlabCommandEventStore eventStore)
    {
        _aggregates = aggregates;
        _eventStore = eventStore;
    }

    public override async ValueTask<RlabResult<RlabCommandResult>> HandleAsync(RlabCommandEnvelope envelope, CompleteRun command, CancellationToken cancellationToken)
    {
        var runStream = RlabGeneratedRegistry.RunStream(command.RunId);
        var run = await _aggregates.LoadAsync<RunAggregate>(runStream, cancellationToken).ConfigureAwait(false);
        var runDecision = run.Decide(command);
        if (runDecision.IsFailure)
        {
            return runDecision.ErrorOf<RlabCommandResult>();
        }

        var conversationStream = RlabGeneratedRegistry.ConversationStream(command.ConversationId);
        var conversation = await _aggregates.LoadAsync<ConversationAggregate>(conversationStream, cancellationToken).ConfigureAwait(false);
        var conversationDecision = conversation.Decide(command);
        if (conversationDecision.IsFailure)
        {
            return conversationDecision.ErrorOf<RlabCommandResult>();
        }

        return await _eventStore.AppendAsync(envelope, [
            new RlabEventBatch(runStream, run.Version, runDecision.Value),
            new RlabEventBatch(conversationStream, conversation.Version, conversationDecision.Value)
        ], cancellationToken).ConfigureAwait(false);
    }
}

public sealed class FailRunHandler : RlabCommandHandler<FailRun>
{
    private readonly IRlabAggregateRepository _aggregates;
    private readonly IRlabCommandEventStore _eventStore;

    public FailRunHandler(IRlabAggregateRepository aggregates, IRlabCommandEventStore eventStore)
    {
        _aggregates = aggregates;
        _eventStore = eventStore;
    }

    public override async ValueTask<RlabResult<RlabCommandResult>> HandleAsync(RlabCommandEnvelope envelope, FailRun command, CancellationToken cancellationToken)
    {
        var runStream = RlabGeneratedRegistry.RunStream(command.RunId);
        var run = await _aggregates.LoadAsync<RunAggregate>(runStream, cancellationToken).ConfigureAwait(false);
        var runDecision = run.Decide(command);
        if (runDecision.IsFailure)
        {
            return runDecision.ErrorOf<RlabCommandResult>();
        }

        var conversationStream = RlabGeneratedRegistry.ConversationStream(command.ConversationId);
        var conversation = await _aggregates.LoadAsync<ConversationAggregate>(conversationStream, cancellationToken).ConfigureAwait(false);
        var conversationDecision = conversation.Decide(command);
        if (conversationDecision.IsFailure)
        {
            return conversationDecision.ErrorOf<RlabCommandResult>();
        }

        return await _eventStore.AppendAsync(envelope, [
            new RlabEventBatch(runStream, run.Version, runDecision.Value),
            new RlabEventBatch(conversationStream, conversation.Version, conversationDecision.Value)
        ], cancellationToken).ConfigureAwait(false);
    }
}
