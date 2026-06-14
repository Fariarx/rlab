import type { ChatMessage } from "../../agent";
import type { ComposerVoiceProvider } from "../../agent/composer/composer-model";
import type { VoiceConfigSnapshot, WakeupSummary } from "../../../client/api/workspace-page-api";
import { wakeupLabel } from "../../../client/api/workspace-page-api";
import { getVoiceProvider, type VoiceSettings } from "../../../lib/voice-providers";
import type { Locale } from "../../../lib/app-settings";
import { composerHistoryText } from "../workspace-page-helpers";

export interface ScheduledWakeupComposerTag {
  readonly id: string;
  readonly label: string;
  readonly removeLabel: string;
  readonly onRemove: () => void;
}

export function composerMessageHistory(messages: readonly ChatMessage[]): readonly string[] {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => composerHistoryText(message.text ?? ""))
    .filter((text) => text.length > 0);
}

export function composerVoiceProvider(settings: VoiceSettings, config: VoiceConfigSnapshot): ComposerVoiceProvider | undefined {
  const selectedVoiceProvider = getVoiceProvider(settings.provider);
  if (selectedVoiceProvider.kind === "none") {
    return undefined;
  }
  return {
    id: selectedVoiceProvider.id,
    name: selectedVoiceProvider.name,
    kind: selectedVoiceProvider.kind,
    language: settings.language,
    configured: selectedVoiceProvider.kind === "cloud" ? config.providers[selectedVoiceProvider.id]?.configured === true : true,
  };
}

export function scheduledWakeupComposerTags({
  locale,
  removeWakeup,
  wakeups,
}: {
  readonly locale: Locale;
  readonly removeWakeup: (id: string) => void;
  readonly wakeups: readonly WakeupSummary[];
}): readonly ScheduledWakeupComposerTag[] {
  return wakeups.map((wakeup) => ({
    id: wakeup.id,
    label: wakeupLabel(wakeup, locale),
    removeLabel: locale === "ru" ? "Убрать запланированную задачу" : "Remove scheduled wakeup",
    onRemove: () => removeWakeup(wakeup.id),
  }));
}
