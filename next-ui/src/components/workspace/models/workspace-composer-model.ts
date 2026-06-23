import type { ChatMessage } from "../../agent";
import type { ComposerVoiceProvider } from "../../agent/composer/composer-model";
import type { PendingQueueWakeupItem, VoiceConfigSnapshot, WakeupSummary } from "../../../client/api/workspace-page-api";
import { wakeupLabel } from "../../../client/api/workspace-page-api";
import { getVoiceProvider, type VoiceSettings } from "../../../lib/voice-providers";
import type { WakeupDetailRow, WakeupTagDetail } from "../../agent/composer/WakeupTile";
import { formatDateTime24 } from "../../../lib/time-format";
import type { Locale } from "../../../lib/app-settings";
import { composerHistoryText } from "../workspace-page-helpers";

export interface ScheduledWakeupComposerTag {
  readonly id: string;
  readonly label: string;
  readonly removeLabel: string;
  readonly onRemove: () => void;
  readonly detail: WakeupTagDetail;
}

export function wakeupTagDetail(wakeup: WakeupSummary, locale: Locale): WakeupTagDetail {
  const ru = locale === "ru";
  const rows: WakeupDetailRow[] = [];
  let script: { readonly label: string; readonly body: string } | undefined;
  let heading: string;
  if (wakeup.trigger.type === "time") {
    heading = ru ? "TaskWakeup · по времени" : "TaskWakeup · time";
    rows.push({ label: ru ? "Сработает" : "Fires at", value: formatDateTime24(new Date(wakeup.trigger.fireAtMs)) });
  } else if (wakeup.trigger.type === "cron") {
    heading = "TaskWakeup · cron";
    rows.push({ label: "Cron", value: wakeup.trigger.cron });
    rows.push({ label: ru ? "Следующий запуск" : "Next run", value: formatDateTime24(new Date(wakeup.trigger.nextFireMs)) });
  } else {
    heading = "TaskWakeup · script";
    rows.push({
      label: ru ? "Расписание" : "Schedule",
      value: wakeup.trigger.cron ? `cron ${wakeup.trigger.cron}` : ru ? `каждые ${wakeup.trigger.intervalSeconds}с` : `every ${wakeup.trigger.intervalSeconds}s`,
    });
    rows.push({ label: ru ? "Следующая проверка" : "Next check", value: formatDateTime24(new Date(wakeup.trigger.nextCheckMs)) });
    if (wakeup.trigger.lastCheckedAtMs !== undefined) {
      rows.push({ label: ru ? "Последняя проверка" : "Last check", value: formatDateTime24(new Date(wakeup.trigger.lastCheckedAtMs)) });
    }
    if (wakeup.trigger.lastError) {
      rows.push({ label: ru ? "Ошибка" : "Error", value: wakeup.trigger.lastError });
    } else if (wakeup.trigger.lastExitCode !== undefined) {
      rows.push({ label: ru ? "Код выхода" : "Exit code", value: String(wakeup.trigger.lastExitCode) });
    }
    script = { label: ru ? "Скрипт" : "Script", body: wakeup.trigger.script };
  }
  rows.push({ label: ru ? "Агент" : "Agent", value: wakeup.agent });
  if (wakeup.reason) {
    rows.push({ label: ru ? "Причина" : "Reason", value: wakeup.reason });
  }
  return { heading, rows, promptLabel: ru ? "Промпт" : "Prompt", prompt: wakeup.prompt, script };
}

export function pendingQueueWakeupLabel(wakeup: PendingQueueWakeupItem, locale: Locale): string {
  return wakeupLabel(
    {
      id: wakeup.wakeupId,
      conversationId: wakeup.conversationId,
      agent: wakeup.agent ?? "agent",
      prompt: wakeup.prompt,
      ...(wakeup.reason ? { reason: wakeup.reason } : {}),
      trigger: wakeup.trigger ?? { type: "time", fireAtMs: wakeup.createdAtMs },
    },
    locale,
  );
}

function singleLineWakeupPart(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function pendingQueueWakeupQueueLabel(wakeup: PendingQueueWakeupItem, locale: Locale): string {
  const detail = pendingQueueWakeupDetail(wakeup, locale);
  const agentLabel = locale === "ru" ? "Агент" : "Agent";
  const reasonLabel = locale === "ru" ? "Причина" : "Reason";
  const detailRows = detail.rows.filter((row) => row.label === agentLabel || row.label === reasonLabel);
  return [
    pendingQueueWakeupLabel(wakeup, locale),
    ...detailRows.map((row) => `${row.label}: ${singleLineWakeupPart(row.value)}`),
    `${detail.promptLabel}: ${singleLineWakeupPart(detail.prompt)}`,
  ]
    .filter((part) => part.trim().length > 0)
    .join(" · ");
}

export function pendingQueueWakeupDetail(wakeup: PendingQueueWakeupItem, locale: Locale): WakeupTagDetail {
  return wakeupTagDetail(
    {
      id: wakeup.wakeupId,
      conversationId: wakeup.conversationId,
      agent: wakeup.agent ?? "agent",
      prompt: wakeup.prompt,
      ...(wakeup.reason ? { reason: wakeup.reason } : {}),
      trigger: wakeup.trigger ?? { type: "time", fireAtMs: wakeup.createdAtMs },
    },
    locale,
  );
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
    detail: wakeupTagDetail(wakeup, locale),
  }));
}
