import type { AgentConfigResponse, VoiceConfigResponse } from "../../client/api/settings-api";
import type { I18nApi } from "../../i18n/I18nProvider";
import type { AppSettingsPatch, DensityMode, Locale, ThemeMode } from "../../lib/app-settings";
import { voiceLanguageForLocale, type VoiceProviderDef, type VoiceProviderId, type VoiceSettings } from "../../lib/voice-providers";
import { defaultProfileForAgent, normalizeAgentProfile, type AgentId, type AgentProfile } from "../agent";
import type { AgentOperationNotice } from "./settings-dialog-store";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function agentOperationNoticeSeverity(notice: AgentOperationNotice | null): "success" | "error" | undefined {
  if (!notice) {
    return undefined;
  }
  return notice.type === "install-completed" || notice.type === "api-key-saved" ? "success" : "error";
}

export function agentOperationNoticeMessage(notice: AgentOperationNotice | null, t: I18nApi["t"]): string | null {
  switch (notice?.type) {
    case "install-completed":
      return t("agentInstallCompleted", { agent: notice.agent, command: notice.command });
    case "install-failed":
      return t("agentInstallFailed", { agent: notice.agent, error: notice.error });
    case "api-key-save-failed":
      return t("agentApiKeySaveFailed", { agent: notice.agent, error: notice.error });
    case "api-key-saved":
      return t("apiKeySaved", { agent: notice.agent });
    default:
      return null;
  }
}

export function agentConfigAfterApiKeySaved(current: AgentConfigResponse, agentId: AgentId): AgentConfigResponse {
  return {
    agents: {
      ...current.agents,
      [agentId]: {
        envVar: current.agents[agentId]?.envVar ?? "",
        configured: true,
      },
    },
  };
}

export function voiceConfigAfterApiKeySaved(current: VoiceConfigResponse, provider: VoiceProviderId, envVar: string): VoiceConfigResponse {
  return {
    providers: {
      ...current.providers,
      [provider]: {
        envVar,
        configured: true,
      },
    },
  };
}

export function defaultAgentProfileSelection(currentProfile: AgentProfile, agent: AgentId): AgentProfile {
  return currentProfile.agent === agent ? normalizeAgentProfile(currentProfile) : defaultProfileForAgent(agent);
}

export function defaultAgentProfileOptionSelection(
  currentProfile: AgentProfile,
  agent: AgentId,
  patch: Partial<Omit<AgentProfile, "agent">>,
): AgentProfile {
  return normalizeAgentProfile({ ...currentProfile, agent, ...patch }, agent);
}

export function appearanceThemePatch(theme: ThemeMode): AppSettingsPatch {
  return { appearance: { theme } };
}

export function appearanceDensityPatch(density: DensityMode): AppSettingsPatch {
  return { appearance: { density } };
}

export function appearanceReduceMotionPatch(reduceMotion: boolean): AppSettingsPatch {
  return { appearance: { reduceMotion } };
}

export function appearanceShowTerminalPatch(showTerminal: boolean): AppSettingsPatch {
  return { appearance: { showTerminal } };
}

export function appearanceReasoningAutoExpandPatch(reasoningAutoExpand: boolean): AppSettingsPatch {
  return { appearance: { reasoningAutoExpand } };
}

export function generalLocalePatch(currentVoice: VoiceSettings, locale: Locale): AppSettingsPatch {
  return { general: { locale, voice: { ...currentVoice, language: voiceLanguageForLocale(locale) } } };
}

export function generalDesktopNotificationsPatch(desktopNotifications: boolean): AppSettingsPatch {
  return { general: { desktopNotifications } };
}

export function generalConfirmDestructiveActionsPatch(confirmDestructiveActions: boolean): AppSettingsPatch {
  return { general: { confirmDestructiveActions } };
}

export function generalTelemetryPatch(telemetry: boolean): AppSettingsPatch {
  return { general: { telemetry } };
}

export function generalPreviewServerHostPatch(previewServerHost: string): AppSettingsPatch {
  return { general: { previewServerHost } };
}

export function generalSystemPromptPatch(systemPrompt: string): AppSettingsPatch {
  return { general: { systemPrompt } };
}

export function generalVoiceProviderPatch(currentVoice: VoiceSettings, provider: VoiceProviderId): AppSettingsPatch {
  return { general: { voice: { ...currentVoice, provider } } };
}

export function generalVoiceLanguagePatch(currentVoice: VoiceSettings, language: string): AppSettingsPatch {
  return { general: { voice: { ...currentVoice, language } } };
}

export interface VoiceProviderUiState {
  readonly configured: boolean;
  readonly selected: boolean;
  readonly showAlpha: boolean;
  readonly showApiKey: boolean;
  readonly status: "idle" | "ok" | "warn";
  readonly statusDetail: string;
  readonly statusLabel: string;
}

export function voiceProviderUiState({
  config,
  provider,
  selectedProvider,
  t,
}: {
  readonly config: VoiceConfigResponse;
  readonly provider: VoiceProviderDef;
  readonly selectedProvider: VoiceProviderId;
  readonly t: I18nApi["t"];
}): VoiceProviderUiState {
  const selected = selectedProvider === provider.id;
  const configured = config.providers[provider.id]?.configured === true || provider.kind !== "cloud";
  const status = provider.id === "none" ? "idle" : configured ? "ok" : "warn";
  const statusLabel = provider.id === "none" ? t("voiceProviderDisabled") : configured ? t("configured") : t("apiKeyRequired");
  return {
    configured,
    selected,
    showAlpha: provider.kind === "cloud",
    showApiKey: provider.kind === "cloud",
    status,
    statusDetail: provider.envVar ? `${statusLabel} · ${provider.envVar}` : statusLabel,
    statusLabel,
  };
}
