import { DEFAULT_PROFILE, isAgentId, normalizeAgentProfile, type AgentProfile } from "./agent-catalog";

export type ThemeMode = "dark" | "light" | "high-contrast";
export type Locale = "en" | "ru";
export type DensityMode = "comfortable" | "compact";
export type AgentAccessMode = "read-only" | "unrestricted";

export const DEFAULT_SIDEBAR_WIDTH = 300;
export const MIN_SIDEBAR_WIDTH = 240;
export const MAX_SIDEBAR_WIDTH = 520;

export interface AppearanceSettings {
  readonly density: DensityMode;
  readonly reduceMotion: boolean;
  /** Auto-expand the reasoning block while the agent is thinking. */
  readonly reasoningAutoExpand: boolean;
  readonly showCost: boolean;
  readonly showTerminal: boolean;
  readonly showTokens: boolean;
  readonly sidebarWidth: number;
  readonly theme: ThemeMode;
}

export interface GeneralSettings {
  readonly confirmDestructiveActions: boolean;
  readonly desktopNotifications: boolean;
  readonly locale: Locale;
  readonly telemetry: boolean;
}

export interface AgentSettings {
  readonly accessMode: AgentAccessMode;
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
    showCost: false,
    showTerminal: false,
    showTokens: true,
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    theme: "dark",
  },
  general: {
    confirmDestructiveActions: true,
    desktopNotifications: true,
    locale: "ru",
    telemetry: false,
  },
  agents: {
    // Default to unrestricted: each agent receives its own "do anything" CLI flag
    // (Claude: bypassPermissions, codex: --dangerously-bypass-approvals-and-sandbox,
    // amp: --dangerously-allow-all, gemini/qwen: yolo, cursor: --force).
    accessMode: "unrestricted",
    defaultProfile: DEFAULT_PROFILE,
  },
};

export function cloneAppSettings(settings: AppSettings): AppSettings {
  const appearance = { ...defaultAppSettings.appearance, ...settings.appearance };
  const general = { ...defaultAppSettings.general, ...settings.general };

  return {
    appearance: { ...appearance, sidebarWidth: normalizeSidebarWidth(appearance.sidebarWidth) },
    general,
    agents: {
      accessMode: isAgentAccessMode(settings.agents.accessMode) ? settings.agents.accessMode : defaultAppSettings.agents.accessMode,
      defaultProfile: normalizeAgentProfile(settings.agents.defaultProfile, defaultAppSettings.agents.defaultProfile.agent),
    },
  };
}

export function mergeAppSettings(current: AppSettings, patch: AppSettingsPatch): AppSettings {
  return {
    appearance: {
      ...current.appearance,
      ...patch.appearance,
      sidebarWidth: normalizeSidebarWidth(patch.appearance?.sidebarWidth ?? current.appearance.sidebarWidth),
    },
    general: {
      ...current.general,
      ...patch.general,
    },
    agents: {
      ...current.agents,
      ...patch.agents,
      accessMode: patch.agents?.accessMode ?? current.agents.accessMode,
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

export function isAgentAccessMode(value: unknown): value is AgentAccessMode {
  return value === "read-only" || value === "unrestricted";
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
    (appearance.showTokens === undefined || typeof appearance.showTokens === "boolean") &&
    (appearance.showCost === undefined || typeof appearance.showCost === "boolean") &&
    (appearance.showTerminal === undefined || typeof appearance.showTerminal === "boolean") &&
    (appearance.reasoningAutoExpand === undefined || typeof appearance.reasoningAutoExpand === "boolean") &&
    (appearance.sidebarWidth === undefined || normalizeSidebarWidth(appearance.sidebarWidth) === appearance.sidebarWidth) &&
    isLocale(general.locale) &&
    typeof general.desktopNotifications === "boolean" &&
    typeof general.confirmDestructiveActions === "boolean" &&
    typeof general.telemetry === "boolean" &&
    (agents.accessMode === undefined || isAgentAccessMode(agents.accessMode)) &&
    isAgentProfile(agents.defaultProfile)
  );
}
