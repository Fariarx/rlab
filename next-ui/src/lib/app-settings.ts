import { DEFAULT_PROFILE, isAgentId, normalizeAgentProfile, type AgentProfile } from "./agent-catalog";
import { DEFAULT_VOICE_SETTINGS, normalizeVoiceSettings, voiceLanguageForLocale, type VoiceSettings } from "./voice-providers";

export type ThemeMode = "dark" | "light" | "high-contrast";
export type Locale = "en" | "ru";
export type DensityMode = "comfortable" | "compact";

export const DEFAULT_SIDEBAR_WIDTH = 300;
export const MIN_SIDEBAR_WIDTH = 240;
export const MAX_SIDEBAR_WIDTH = 520;

export interface AppearanceSettings {
  readonly density: DensityMode;
  readonly reduceMotion: boolean;
  /** Auto-expand the reasoning block while the agent is thinking. */
  readonly reasoningAutoExpand: boolean;
  readonly showTerminal: boolean;
  readonly sidebarWidth: number;
  readonly theme: ThemeMode;
}

export interface GeneralSettings {
  readonly confirmDestructiveActions: boolean;
  readonly desktopNotifications: boolean;
  readonly locale: Locale;
  readonly telemetry: boolean;
  /** Optional override for where the Preview reaches the agent's dev servers.
   *  When set, localhost/127.0.0.1 URLs the agent opens are rewritten to this
   *  host (e.g. "203.0.113.10" or "dev.example.com:8080"). Empty ⇒ route such
   *  URLs through rlab's same-origin /preview-proxy instead. */
  readonly previewServerHost: string;
  readonly voice: VoiceSettings;
}

export interface AgentSettings {
  readonly defaultProfile: AgentProfile;
}

export interface AppSettings {
  readonly appearance: AppearanceSettings;
  readonly general: GeneralSettings;
  readonly agents: AgentSettings;
}

export interface AppSettingsPatch {
  readonly appearance?: Partial<AppearanceSettings>;
  readonly general?: Partial<GeneralSettings>;
  readonly agents?: Partial<AgentSettings>;
}

export const defaultAppSettings: AppSettings = {
  appearance: {
    density: "comfortable",
    reduceMotion: false,
    reasoningAutoExpand: true,
    showTerminal: false,
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    theme: "dark",
  },
  general: {
    confirmDestructiveActions: true,
    desktopNotifications: true,
    locale: "ru",
    telemetry: false,
    previewServerHost: "",
    voice: DEFAULT_VOICE_SETTINGS,
  },
  agents: {
    defaultProfile: DEFAULT_PROFILE,
  },
};

export function cloneAppSettings(settings: AppSettings): AppSettings {
  const appearance = { ...defaultAppSettings.appearance, ...settings.appearance };
  const general = { ...defaultAppSettings.general, ...settings.general, voice: normalizeVoiceSettings(settings.general.voice) };

  return {
    appearance: {
      density: appearance.density,
      reduceMotion: appearance.reduceMotion,
      reasoningAutoExpand: appearance.reasoningAutoExpand,
      showTerminal: appearance.showTerminal,
      sidebarWidth: normalizeSidebarWidth(appearance.sidebarWidth),
      theme: appearance.theme,
    },
    general,
    agents: {
      defaultProfile: normalizeAgentProfile(settings.agents.defaultProfile, defaultAppSettings.agents.defaultProfile.agent),
    },
  };
}

export function mergeAppSettings(current: AppSettings, patch: AppSettingsPatch): AppSettings {
  const nextLocale = patch.general?.locale ?? current.general.locale;
  const voicePatch =
    patch.general?.locale !== undefined && patch.general.voice?.language === undefined
      ? { ...patch.general.voice, language: voiceLanguageForLocale(nextLocale) }
      : patch.general?.voice;
  const general = {
    ...current.general,
    ...patch.general,
    voice: normalizeVoiceSettings({ ...current.general.voice, ...voicePatch }),
  };
  return {
    appearance: {
      ...current.appearance,
      ...patch.appearance,
      sidebarWidth: normalizeSidebarWidth(patch.appearance?.sidebarWidth ?? current.appearance.sidebarWidth),
    },
    general,
    agents: {
      ...current.agents,
      ...patch.agents,
      defaultProfile: normalizeAgentProfile(patch.agents?.defaultProfile ?? current.agents.defaultProfile),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "dark" || value === "light" || value === "high-contrast";
}

function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "ru";
}

function isDensityMode(value: unknown): value is DensityMode {
  return value === "comfortable" || value === "compact";
}

export function normalizeSidebarWidth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SIDEBAR_WIDTH;
  }
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(value)));
}

function isAgentProfile(value: unknown): value is AgentProfile {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isAgentId(value.agent) &&
    ((typeof value.model === "string" &&
      typeof value.reasoning === "string" &&
      typeof value.mode === "string" &&
      value.mode.trim().length > 0) ||
      typeof value.variant === "string")
  );
}

export function isAppSettings(value: unknown): value is AppSettings {
  if (!isRecord(value) || !isRecord(value.appearance) || !isRecord(value.general) || !isRecord(value.agents)) {
    return false;
  }
  const { appearance, general, agents } = value;
  return (
    isThemeMode(appearance.theme) &&
    isDensityMode(appearance.density) &&
    typeof appearance.reduceMotion === "boolean" &&
    (appearance.showTerminal === undefined || typeof appearance.showTerminal === "boolean") &&
    (appearance.reasoningAutoExpand === undefined || typeof appearance.reasoningAutoExpand === "boolean") &&
    (appearance.sidebarWidth === undefined || normalizeSidebarWidth(appearance.sidebarWidth) === appearance.sidebarWidth) &&
    isLocale(general.locale) &&
    typeof general.desktopNotifications === "boolean" &&
    typeof general.confirmDestructiveActions === "boolean" &&
    typeof general.telemetry === "boolean" &&
    (general.previewServerHost === undefined || typeof general.previewServerHost === "string") &&
    (general.voice === undefined || isRecord(general.voice)) &&
    isAgentProfile(agents.defaultProfile)
  );
}
