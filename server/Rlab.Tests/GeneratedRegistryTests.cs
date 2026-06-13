using System.Text.Json;
using Rlab.Domain.Generated;
using Rlab.Domain.Metadata;
using Rlab.Domain.Run;
using Rlab.Domain.Workspace;
using Shouldly;

namespace Rlab.Tests;

public sealed class GeneratedRegistryTests
{
    [Fact]
    public void Registry_contains_unique_wire_name_versions()
    {
        var registry = RlabGeneratedRegistry.Create();

        registry.Models
            .GroupBy(model => $"{model.Kind}:{model.WireName}:v{model.Version}", StringComparer.Ordinal)
            .Where(group => group.Count() > 1)
            .ShouldBeEmpty();
    }

    [Fact]
    public void Registry_contains_core_commands_events_queries_and_projections()
    {
        var registry = RlabGeneratedRegistry.Create();

        registry.Find(RlabModelKind.Command, "run.start", 1).ShouldNotBeNull();
        registry.Find(RlabModelKind.Command, "workspace.createConversation", 1).ShouldNotBeNull();
        registry.Find(RlabModelKind.Event, "run.started", 1).ShouldNotBeNull();
        registry.Find(RlabModelKind.Event, "conversation.messageAppended", 1).ShouldNotBeNull();
        registry.Find(RlabModelKind.Event, "conversation.runStarted", 1).ShouldNotBeNull();
        registry.Find(RlabModelKind.Query, "workspace.snapshot", 1).ShouldNotBeNull();
        registry.Find(RlabModelKind.Projection, "run-view", 1).ShouldNotBeNull();
        registry.Find(RlabModelKind.Aggregate, "conversation", 1).ShouldNotBeNull();
    }

    [Fact]
    public void Aggregate_descriptor_lists_apply_event_types()
    {
        var registry = RlabGeneratedRegistry.Create();

        var run = registry.Aggregates.Single(model => model.WireName == "run");
        run.HandledEventClrTypes.ShouldContain(typeof(RunStarted).FullName);
        run.HandledEventClrTypes.ShouldContain(typeof(RunCancelled).FullName);

        var workspace = registry.Aggregates.Single(model => model.WireName == "workspace");
        workspace.HandledEventClrTypes.ShouldContain(typeof(SelectedConversationSet).FullName);

        var conversation = registry.Aggregates.Single(model => model.WireName == "conversation");
        conversation.HandledEventClrTypes.ShouldContain(typeof(ConversationCreated).FullName);
        conversation.HandledEventClrTypes.ShouldContain(typeof(MessageAppended).FullName);
    }

    [Fact]
    public void Generated_resolver_and_deserializer_are_model_driven()
    {
        RlabGeneratedRegistry.ResolveType(typeof(StartRun).FullName!).ShouldBe(typeof(StartRun));

        var payload = JsonSerializer.SerializeToElement(new
        {
            runId = "run-1",
            conversationId = "conv-1",
            userMessageId = "user-1",
            agentMessageId = "agent-1",
            prompt = "hello",
            agent = "codex",
            model = "gpt",
            reasoning = "medium",
            mode = "workspace"
        }, new JsonSerializerOptions(JsonSerializerDefaults.Web));

        var command = RlabGeneratedRegistry.DeserializeModel(
            RlabModelKind.Command,
            "run.start",
            1,
            payload,
            new JsonSerializerOptions(JsonSerializerDefaults.Web));

        command.ShouldBeOfType<StartRun>();
    }

    [Fact]
    public void Projection_appliers_are_generated_from_domain_types()
    {
        RlabGeneratedRegistry.ProjectionApplierTypes.ShouldContain(typeof(ConversationCreatedProjectionApplier));
        RlabGeneratedRegistry.ProjectionApplierTypes.ShouldContain(typeof(MessageAppendedProjectionApplier));
        RlabGeneratedRegistry.ProjectionApplierTypes.ShouldContain(typeof(ConversationRunStartedProjectionApplier));
        RlabGeneratedRegistry.ProjectionApplierTypes.ShouldContain(typeof(RunStartedProjectionApplier));
        RlabGeneratedRegistry.ProjectionApplierTypes.ShouldContain(typeof(RunCancelledProjectionApplier));
    }
}
