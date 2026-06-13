using System.Text.Json;
using Rlab.Domain.Contracts;
using Rlab.Infrastructure.Commands;
using Shouldly;

namespace Rlab.Tests;

public sealed class CommandIdempotencyTests
{
    [Fact]
    public void Payload_hash_is_stable_for_same_command_payload()
    {
        var envelope = Envelope("command-1", "Test");
        var equivalent = Envelope("command-1", "Test");

        RlabCommandPayloadHasher.Compute(envelope).ShouldBe(RlabCommandPayloadHasher.Compute(equivalent));
    }

    [Fact]
    public void Payload_hash_changes_when_command_payload_changes()
    {
        var first = Envelope("command-1", "First");
        var second = Envelope("command-1", "Second");

        RlabCommandPayloadHasher.Compute(first).ShouldNotBe(RlabCommandPayloadHasher.Compute(second));
    }

    private static RlabCommandEnvelope Envelope(string commandId, string title)
    {
        var data = JsonSerializer.SerializeToElement(new
        {
            conversationId = "conv-1",
            title,
            agent = "codex",
            projectId = (string?)null
        }, new JsonSerializerOptions(JsonSerializerDefaults.Web));

        return new RlabCommandEnvelope(commandId, "client-1", "workspace.createConversation", 1, data);
    }
}
