export type VoiceProviderId = "none" | "web-speech" | "assemblyai" | "speechmatics" | "gladia" | "google" | "openai";

export type VoiceProviderKind = "browser" | "cloud" | "none";

export interface VoiceProviderDef {
  readonly id: VoiceProviderId;
  readonly name: string;
  readonly kind: VoiceProviderKind;
  readonly envVar?: string;
  readonly languageHint: string;
}

export interface VoiceSettings {
  readonly provider: VoiceProviderId;
  readonly language: string;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  provider: "none",
  language: "ru-RU",
};

export function voiceLanguageForLocale(locale: "en" | "ru"): string {
  return locale === "en" ? "en-US" : "ru-RU";
}

export const VOICE_PROVIDERS: readonly VoiceProviderDef[] = [
  { id: "none", name: "No voice input", kind: "none", languageHint: "Voice input is hidden." },
  { id: "web-speech", name: "Browser Web Speech", kind: "browser", languageHint: "Uses the browser speech recognizer." },
  { id: "assemblyai", name: "AssemblyAI", kind: "cloud", envVar: "ASSEMBLYAI_API_KEY", languageHint: "Auto-detects by default; optional BCP-47 hint." },
  { id: "speechmatics", name: "Speechmatics", kind: "cloud", envVar: "SPEECHMATICS_API_KEY", languageHint: "Use language codes like ru, en, auto." },
  { id: "gladia", name: "Gladia", kind: "cloud", envVar: "GLADIA_API_KEY", languageHint: "Auto-detects by default; optional language hint." },
  { id: "google", name: "Google Speech-to-Text", kind: "cloud", envVar: "GOOGLE_SPEECH_API_KEY", languageHint: "Use BCP-47 codes like ru-RU or en-US." },
  { id: "openai", name: "OpenAI Speech-to-Text", kind: "cloud", envVar: "OPENAI_API_KEY", languageHint: "Use BCP-47 hints like ru or en." },
];

export function isVoiceProviderId(value: unknown): value is VoiceProviderId {
  return value === "none" || value === "web-speech" || value === "assemblyai" || value === "speechmatics" || value === "gladia" || value === "google" || value === "openai";
}

export function getVoiceProvider(id: VoiceProviderId): VoiceProviderDef {
  return VOICE_PROVIDERS.find((provider) => provider.id === id) ?? VOICE_PROVIDERS[0];
}

export function normalizeVoiceSettings(value: Partial<VoiceSettings> | undefined): VoiceSettings {
  const provider = isVoiceProviderId(value?.provider) ? value.provider : DEFAULT_VOICE_SETTINGS.provider;
  const language = typeof value?.language === "string" && value.language.trim().length > 0 ? value.language.trim() : DEFAULT_VOICE_SETTINGS.language;
  return { provider, language };
}
