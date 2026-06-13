using Rlab.Domain.Run;
using Rlab.Domain.Workspace;
using Shouldly;

namespace Rlab.Tests;

public sealed class AggregateDecisionTests
{
    [Fact]
    public void Conversation_aggregate_confirms_create_conversation_command()
    {
        var aggregate = new ConversationAggregate();
        var command = new CreateConversation("conv-1", "Test", "codex");

        var decision = aggregate.Decide(command, DateTimeOffset.UnixEpoch);

        decision.IsSuccess.ShouldBeTrue();
        var events = decision.Value;
        events.Count.ShouldBe(1);
        events[0].ShouldBeOfType<ConversationCreated>();
    }

    [Fact]
    public void Conversation_aggregate_rejects_duplicate_conversation()
    {
        var aggregate = new ConversationAggregate();
        aggregate.Apply(new ConversationCreated("conv-1", "Test", "codex", null, "time"));

        var decision = aggregate.Decide(new CreateConversation("conv-1", "Test", "codex"), DateTimeOffset.UnixEpoch);

        decision.IsFailure.ShouldBeTrue();
        decision.Error.Message.ShouldBe("Conversation 'conv-1' already exists.");
    }

    [Fact]
    public void Conversation_aggregate_rejects_message_before_create()
    {
        var aggregate = new ConversationAggregate();

        var decision = aggregate.Decide(new AppendUserMessage("conv-1", "msg-1", "hello", "time"));

        decision.IsFailure.ShouldBeTrue();
        decision.Error.Message.ShouldBe("Conversation 'conv-1' does not exist.");
    }

    [Fact]
    public void Conversation_aggregate_rejects_duplicate_message()
    {
        var aggregate = new ConversationAggregate();
        aggregate.Apply(new ConversationCreated("conv-1", "Test", "codex", null, "time"));
        aggregate.Apply(new MessageAppended("conv-1", new ChatMessage("msg-1", "user", "hello")));

        var decision = aggregate.Decide(new AppendUserMessage("conv-1", "msg-1", "hello", "time"));

        decision.IsFailure.ShouldBeTrue();
        decision.Error.Message.ShouldBe("Message 'msg-1' already exists.");
    }

    [Fact]
    public void Conversation_aggregate_tracks_active_run()
    {
        var aggregate = new ConversationAggregate();
        aggregate.Apply(new ConversationCreated("conv-1", "Test", "codex", null, "time"));

        var started = aggregate.Decide(new StartRun("run-1", "conv-1", "user-1", "agent-1", "prompt", "codex", "gpt", "medium", "workspace"));

        started.IsSuccess.ShouldBeTrue();
        started.Value[0].ShouldBeOfType<ConversationRunStarted>();
        aggregate.Apply((ConversationRunStarted)started.Value[0]);
        aggregate.ActiveRunId.ShouldBe("run-1");

        var duplicate = aggregate.Decide(new StartRun("run-2", "conv-1", "user-2", "agent-2", "prompt", "codex", "gpt", "medium", "workspace"));
        duplicate.IsFailure.ShouldBeTrue();
        duplicate.Error.Message.ShouldBe("Conversation 'conv-1' already has active run 'run-1'.");

        var finished = aggregate.Decide(new CompleteRun("run-1", "conv-1"));
        finished.IsSuccess.ShouldBeTrue();
        finished.Value[0].ShouldBeOfType<ConversationRunFinished>();
    }

    [Fact]
    public void Run_aggregate_confirms_start_command()
    {
        var aggregate = new RunAggregate();
        var command = new StartRun("run-1", "conv-1", "user-1", "agent-1", "prompt", "codex", "gpt", "medium", "workspace");

        var decision = aggregate.Decide(command, DateTimeOffset.UnixEpoch);

        decision.IsSuccess.ShouldBeTrue();
        var events = decision.Value;
        events.Count.ShouldBe(2);
        events[0].ShouldBeOfType<RunRequested>();
        events[1].ShouldBeOfType<RunStarted>();
    }

    [Fact]
    public void Run_aggregate_rejects_cancel_before_start()
    {
        var aggregate = new RunAggregate();

        var decision = aggregate.Decide(new CancelRun("run-1", "conv-1", "no reason"));

        decision.IsFailure.ShouldBeTrue();
        decision.Error.Message.ShouldBe("Run 'run-1' does not exist.");
    }

    [Fact]
    public void Run_aggregate_rejects_output_after_cancel()
    {
        var aggregate = new RunAggregate();
        aggregate.Apply(new RunRequested("run-1", "conv-1", "user-1", "agent-1", "prompt", "codex", "gpt", "medium", "workspace"));
        aggregate.Apply(new RunStarted("run-1", "conv-1", "user-1", "agent-1", DateTimeOffset.UnixEpoch));
        aggregate.Apply(new RunCancelled("run-1", "conv-1", "no reason"));

        var decision = aggregate.Decide(new RecordRunOutput("run-1", "conv-1", new RunOutputEvent("text", "late")));

        decision.IsFailure.ShouldBeTrue();
        decision.Error.Message.ShouldBe("Run 'run-1' is already terminal.");
    }
}
