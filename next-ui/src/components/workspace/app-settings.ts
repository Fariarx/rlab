import { type AgentProfile } from "../agent/agents";

export type ThemeMode = "dark" | "light" | "high-contrast";
export type Locale = "en" | "ru";
export type DensityMode = "comfortable" | "compact";
export type AgentAccessMode = "read-only" | "read-write";

export interface AppearanceSettings {
  readonly density: DensityMode;
  readonly reduceMotion: boolean;
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
    theme: "dark",
  },
  general: {
    confirmDestructiveActions: true,
    desktopNotifications: true,
    locale: "ru",
    telemetry: false,
  },
  agents: {
    accessMode: "read-only",
    defaultProfile: {
      agent: "claude-code",
      variant: "DEFAULT",
    },
  },
};

export function cloneAppSettings(settings: AppSettings): AppSettings {
  return {
    appearance: { ...settings.appearance },
    general: { ...settings.general },
    agents: {
      accessMode: settings.agents.accessMode ?? defaultAppSettings.agents.accessMode,
      defaultProfile: { ...settings.agents.defaultProfile },
    },
  };
}

export function mergeAppSettings(current: AppSettings, patch: AppSettingsPatch): AppSettings {
  return {
    appearance: {
      ...current.appearance,
      ...patch.appearance,
    },
    general: {
      ...current.general,
      ...patch.general,
    },
    agents: {
      ...current.agents,
      ...patch.agents,
      accessMode: patch.agents?.accessMode ?? current.agents.accessMode ?? defaultAppSettings.agents.accessMode,
      defaultProfile: patch.agents?.defaultProfile ? { ...patch.agents.defaultProfile } : { ...current.agents.defaultProfile },
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

export function isAgentAccessMode(value: unknown): value is AgentAccessMode {
  return value === "read-only" || value === "read-write";
}

function isAgentProfile(value: unknown): value is AgentProfile {
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.agent === "claude-code" ||
      value.agent === "codex" ||
      value.agent === "gemini" ||
      value.agent === "amp" ||
      value.agent === "opencode" ||
      value.agent === "cursor" ||
      value.agent === "qwen" ||
      value.agent === "copilot" ||
      value.agent === "droid") &&
    typeof value.variant === "string"
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
    isLocale(general.locale) &&
    typeof general.desktopNotifications === "boolean" &&
    typeof general.confirmDestructiveActions === "boolean" &&
    typeof general.telemetry === "boolean" &&
    (agents.accessMode === undefined || isAgentAccessMode(agents.accessMode)) &&
    isAgentProfile(agents.defaultProfile)
  );
}
