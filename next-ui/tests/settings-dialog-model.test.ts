import { describe, expect, it } from "vitest";
import {
  agentConfigAfterApiKeySaved,
  agentOperationNoticeMessage,
  agentOperationNoticeSeverity,
  appearanceDensityPatch,
  appearanceReasoningAutoExpandPatch,
  appearanceReduceMotionPatch,
  appearanceShowTerminalPatch,
  appearanceThemePatch,
  defaultAgentProfileOptionSelection,
  defaultAgentProfileSelection,
  errorMessage,
  generalConfirmDestructiveActionsPatch,
  generalDesktopNotificationsPatch,
  generalLocalePatch,
  generalPreviewServerHostPatch,
  generalQueueInterruptionPauseMsPatch,
  generalSystemPromptPatch,
  generalTelemetryPatch,
  generalVoiceLanguagePatch,
  generalVoiceProviderPatch,
  voiceConfigAfterApiKeySaved,
  voiceProviderUiState,
} from "../src/components/settings/settings-dialog-model";
import type { I18nApi } from "../src/i18n/I18nProvider";
import { getVoiceProvider } from "../src/lib/voice-providers";

const t: I18nApi["t"] = (key, params) => `${key}:${JSON.stringify(params ?? {})}`;

describe("settings-dialog-model", () => {
  it("preserves env var metadata when marking an agent API key as configured", () => {
    expect(agentConfigAfterApiKeySaved({ agents: { codex: { envVar: "OPENAI_API_KEY", configured: false } } }, "codex")).toEqual({
      agents: {
        codex: { envVar: "OPENAI_API_KEY", configured: true },
      },
    });
  });

  it("creates a configured entry when the agent config was absent", () => {
    expect(agentConfigAfterApiKeySaved({ agents: {} }, "codex")).toEqual({
      agents: {
        codex: { envVar: "", configured: true },
      },
    });
  });

  it("marks voice provider API keys as configured using provider metadata", () => {
    expect(voiceConfigAfterApiKeySaved({ providers: {} }, "openai", "OPENAI_API_KEY")).toEqual({
      providers: {
        openai: { envVar: "OPENAI_API_KEY", configured: true },
      },
    });
  });

  it("builds voice provider UI state for disabled and browser providers", () => {
    expect(voiceProviderUiState({ config: { providers: {} }, provider: getVoiceProvider("none"), selectedProvider: "none", t })).toMatchObject({
      configured: true,
      selected: true,
      showAlpha: false,
      showApiKey: false,
      status: "idle",
      statusLabel: "voiceProviderDisabled:{}",
      statusDetail: "voiceProviderDisabled:{}",
    });

    expect(voiceProviderUiState({ config: { providers: {} }, provider: getVoiceProvider("web-speech"), selectedProvider: "none", t })).toMatchObject({
      configured: true,
      selected: false,
      showAlpha: false,
      showApiKey: false,
      status: "ok",
      statusLabel: "configured:{}",
      statusDetail: "configured:{}",
    });
  });

  it("builds voice provider UI state from cloud provider config", () => {
    expect(voiceProviderUiState({ config: { providers: {} }, provider: getVoiceProvider("openai"), selectedProvider: "openai", t })).toMatchObject({
      configured: false,
      selected: true,
      showAlpha: true,
      showApiKey: true,
      status: "warn",
      statusLabel: "apiKeyRequired:{}",
      statusDetail: "apiKeyRequired:{} · OPENAI_API_KEY",
    });

    expect(
      voiceProviderUiState({
        config: { providers: { openai: { envVar: "OPENAI_API_KEY", configured: true } } },
        provider: getVoiceProvider("openai"),
        selectedProvider: "web-speech",
        t,
      }),
    ).toMatchObject({
      configured: true,
      selected: false,
      status: "ok",
      statusLabel: "configured:{}",
      statusDetail: "configured:{} · OPENAI_API_KEY",
    });
  });

  it("maps agent operation notices to severity and localized messages", () => {
    const notice = { type: "install-completed", agent: "Codex", command: "npm install -g @openai/codex" } as const;

    expect(agentOperationNoticeSeverity(notice)).toBe("success");
    expect(agentOperationNoticeMessage(notice, t)).toBe('agentInstallCompleted:{"agent":"Codex","command":"npm install -g @openai/codex"}');
    expect(agentOperationNoticeSeverity({ type: "install-failed", agent: "Codex", error: "offline" })).toBe("error");
    expect(agentOperationNoticeMessage(null, t)).toBeNull();
  });

  it("normalizes unknown errors without throwing", () => {
    expect(errorMessage(new Error("broken"))).toBe("broken");
    expect(errorMessage("plain")).toBe("plain");
  });

  it("builds default agent profile selections from agent catalog rules", () => {
    const current = { agent: "codex", model: "gpt-5.5", reasoning: "high", mode: "default" } as const;

    expect(defaultAgentProfileSelection(current, "codex")).toEqual(current);
    expect(defaultAgentProfileSelection(current, "gemini")).toMatchObject({ agent: "gemini" });
    expect(defaultAgentProfileOptionSelection(current, "codex", { model: "gpt-5.6", reasoning: "medium" })).toEqual({
      agent: "codex",
      model: "gpt-5.6",
      reasoning: "medium",
      mode: "default",
    });
  });

  it("builds appearance settings patches", () => {
    expect(appearanceThemePatch("high-contrast")).toEqual({ appearance: { theme: "high-contrast" } });
    expect(appearanceDensityPatch("compact")).toEqual({ appearance: { density: "compact" } });
    expect(appearanceReduceMotionPatch(true)).toEqual({ appearance: { reduceMotion: true } });
    expect(appearanceShowTerminalPatch(true)).toEqual({ appearance: { showTerminal: true } });
    expect(appearanceReasoningAutoExpandPatch(false)).toEqual({ appearance: { reasoningAutoExpand: false } });
  });

  it("builds general settings patches", () => {
    expect(generalLocalePatch({ provider: "none", language: "ru-RU" }, "en")).toEqual({
      general: { locale: "en", voice: { provider: "none", language: "en-US" } },
    });
    expect(generalDesktopNotificationsPatch(false)).toEqual({ general: { desktopNotifications: false } });
    expect(generalConfirmDestructiveActionsPatch(false)).toEqual({ general: { confirmDestructiveActions: false } });
    expect(generalTelemetryPatch(true)).toEqual({ general: { telemetry: true } });
    expect(generalQueueInterruptionPauseMsPatch(45 * 60_000)).toEqual({ general: { queueInterruptionPauseMs: 45 * 60_000 } });
    expect(generalPreviewServerHostPatch("dev.example.com:8080")).toEqual({ general: { previewServerHost: "dev.example.com:8080" } });
    expect(generalSystemPromptPatch("Be concise.")).toEqual({ general: { systemPrompt: "Be concise." } });
  });

  it("builds voice settings patches without dropping provider or language", () => {
    expect(generalVoiceProviderPatch({ provider: "none", language: "ru-RU" }, "openai")).toEqual({
      general: { voice: { provider: "openai", language: "ru-RU" } },
    });
    expect(generalVoiceLanguagePatch({ provider: "openai", language: "ru-RU" }, "en-US")).toEqual({
      general: { voice: { provider: "openai", language: "en-US" } },
    });
  });
});
