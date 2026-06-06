import { DEFAULT_PROFILE, isAgentId, normalizeAgentProfile, type AgentProfile } from "../agent/agents";

export type ThemeMode = "dark" | "light" | "high-contrast";
export type Locale = "en" | "ru";
export type DensityMode = "comfortable" | "compact";
export type AgentAccessMode = "read-only" | "unrestricted";

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
    defaultProfile: DEFAULT_PROFILE,
  },
};

export function cloneAppSettings(settings: AppSettings): AppSettings {
  return {
    appearance: { ...settings.appearance },
    general: { ...settings.general },
    agents: {
      accessMode: settings.agents.accessMode,
      defaultProfile: normalizeAgentProfile(settings.agents.defaultProfile),
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
      (value.mode === "default" || value.mode === "plan")) ||
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
    isLocale(general.locale) &&
    typeof general.desktopNotifications === "boolean" &&
    typeof general.confirmDestructiveActions === "boolean" &&
    typeof general.telemetry === "boolean" &&
    (agents.accessMode === undefined || isAgentAccessMode(agents.accessMode)) &&
    isAgentProfile(agents.defaultProfile)
  );
}
