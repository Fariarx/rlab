import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../src/components/agent";
import type { VoiceConfigSnapshot, WakeupSummary } from "../src/client/api/workspace-page-api";
import { composerMessageHistory, composerVoiceProvider, scheduledWakeupComposerTags } from "../src/components/workspace/models/workspace-composer-model";

function userMessage(id: string, text: string | undefined): ChatMessage {
  return { id, role: "user", text, time: "12:00" };
}

function agentMessage(id: string): ChatMessage {
  return { id, role: "agent", text: "agent", time: "12:01" };
}

function voiceConfig(configured: boolean): VoiceConfigSnapshot {
  return {
    providers: {
      openai: { envVar: "OPENAI_API_KEY", configured },
    },
  };
}

function wakeup(patch: Partial<WakeupSummary> = {}): WakeupSummary {
  return {
    id: "wakeup-1",
    conversationId: "chat-1",
    agent: "codex",
    prompt: "continue",
    trigger: { type: "time", fireAtMs: Date.UTC(2026, 0, 2, 3, 4) },
    ...patch,
  };
}

describe("workspace-composer-model", () => {
  it("builds composer history from visible user text only", () => {
    expect(
      composerMessageHistory([
        userMessage("u1", "first"),
        agentMessage("a1"),
        userMessage("u2", '<attachment name="secret.txt">hidden</attachment>'),
        userMessage("u3", "with file\n<attachment name=\"secret.txt\">hidden</attachment>"),
      ]),
    ).toEqual(["first", "with file"]);
  });

  it("omits disabled voice providers", () => {
    expect(composerVoiceProvider({ provider: "none", language: "ru-RU" }, voiceConfig(true))).toBeUndefined();
  });

  it("marks browser voice providers as configured without server config", () => {
    expect(composerVoiceProvider({ provider: "web-speech", language: "en-US" }, { providers: {} })).toEqual({
      id: "web-speech",
      name: "Browser Web Speech",
      kind: "browser",
      language: "en-US",
      configured: true,
    });
  });

  it("uses server config for cloud voice providers", () => {
    expect(composerVoiceProvider({ provider: "openai", language: "ru" }, voiceConfig(false))).toMatchObject({
      id: "openai",
      kind: "cloud",
      language: "ru",
      configured: false,
    });
  });

  it("builds scheduled wakeup tags with remove handlers", () => {
    const removeWakeup = vi.fn();
    const tags = scheduledWakeupComposerTags({
      locale: "en",
      removeWakeup,
      wakeups: [wakeup()],
    });

    expect(tags).toHaveLength(1);
    expect(tags[0]?.id).toBe("wakeup-1");
    expect(tags[0]?.label).toContain("TaskWakeup");
    expect(tags[0]?.removeLabel).toBe("Remove scheduled wakeup");

    tags[0]?.onRemove();

    expect(removeWakeup).toHaveBeenCalledWith("wakeup-1");
  });

  it("labels script wakeups by schedule instead of trigger type", () => {
    const tags = scheduledWakeupComposerTags({
      locale: "ru",
      removeWakeup: vi.fn(),
      wakeups: [
        wakeup({
          trigger: {
            type: "script",
            script: "test -f /tmp/ready",
            intervalSeconds: 15,
            nextCheckMs: Date.UTC(2026, 0, 2, 3, 4),
          },
        }),
      ],
    });

    expect(tags[0]?.label).toBe("TaskWakeup: каждые 15с");
    expect(tags[0]?.label).not.toContain("script");
    expect(tags[0]?.detail.rows).toContainEqual({ label: "Расписание", value: "каждые 15с" });
  });
});
