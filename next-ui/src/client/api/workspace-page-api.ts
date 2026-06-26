import { formatClock24 } from "../../lib/time-format";
import type { ApprovalDecision } from "../../domain/agent-types";
import type { AgentRateLimitMap } from "../../lib/agent-limits";
import type { ComposerPluginLink } from "../../lib/rlab-plugins";
import type { VoiceProviderId } from "../../lib/voice-providers";
import type { ChatMessage } from "../../domain/agent-types";
import { isRecord, payloadErrorMessage, readJsonPayload, responseErrorMessage } from "./http";

export const CLI_UPDATE_POLL_MS = 5 * 60_000;

export type WakeupTrigger =
  | { readonly type: "time"; readonly fireAtMs: number }
  | { readonly type: "cron"; readonly cron: string; readonly nextFireMs: number }
  | { readonly type: "script"; readonly script: string; readonly intervalSeconds?: number; readonly cron?: string; readonly nextCheckMs: number; readonly lastCheckedAtMs?: number; readonly lastExitCode?: number; readonly lastError?: string };

export interface WakeupSummary {
  readonly id: string;
  readonly conversationId: string;
  readonly agent: string;
  readonly prompt: string;
  readonly reason?: string;
  readonly trigger: WakeupTrigger;
}

export interface PendingTurnQueueSnapshot {
  readonly conversationId: string;
  readonly paused: boolean;
  readonly resumeAtMs?: number;
  readonly messages: readonly ChatMessage[];
  readonly items: readonly PendingQueueItem[];
}

export type PendingQueueItemState = "queued" | "dispatching" | "paused" | "waiting_wakeup";

interface PendingQueueItemBase {
  readonly id: string;
  readonly conversationId: string;
  readonly position: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly state: PendingQueueItemState;
  readonly runId?: string;
  readonly nextDispatchAtMs?: number;
}

export interface PendingQueueMessageItem extends PendingQueueItemBase {
  readonly kind: "message";
  readonly message: ChatMessage;
  readonly origin: string;
}

export interface PendingQueueGoalItem extends PendingQueueItemBase {
  readonly kind: "goal";
  readonly description: string;
  readonly origin: string;
  readonly dispatchCount: number;
}

export interface PendingTrackerTask {
  readonly id: string;
  readonly text: string;
  readonly done: boolean;
  readonly completedAtMs?: number;
}

export interface PendingQueueTrackerItem extends PendingQueueItemBase {
  readonly kind: "tracker";
  readonly title?: string;
  readonly tasks: readonly PendingTrackerTask[];
  readonly origin: string;
  readonly dispatchCount: number;
}

export interface PendingQueueWakeupItem extends PendingQueueItemBase {
  readonly kind: "wakeup";
  readonly wakeupId: string;
  readonly agent?: string;
  readonly prompt: string;
  readonly reason?: string;
  readonly trigger?: WakeupTrigger;
}

export type PendingQueueItem = PendingQueueMessageItem | PendingQueueGoalItem | PendingQueueTrackerItem | PendingQueueWakeupItem;

export interface CliUpdateInfo {
  readonly agent: string;
  readonly agentName: string;
  readonly packageName: string;
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly command: string;
}

export interface CliUpdateSnapshot {
  readonly checkedAt: number;
  readonly checking: boolean;
  readonly updates: readonly CliUpdateInfo[];
  readonly errors: Record<string, string>;
}

export interface AgentLimitSnapshot {
  readonly limits: AgentRateLimitMap;
  readonly refreshError?: string;
}

export interface VoiceProviderConfigInfo {
  readonly envVar: string;
  readonly configured: boolean;
}

export interface VoiceConfigSnapshot {
  readonly providers: Partial<Record<VoiceProviderId, VoiceProviderConfigInfo>>;
}

export async function loadProjectFiles(cwd: string): Promise<readonly string[]> {
  const response = await fetch("/api/project-files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  const payload = await readJsonPayload<{ readonly files?: string[]; readonly error?: string }>(response);
  if (!response.ok) {
    throw new Error(payloadErrorMessage(payload, `Project files load failed (${response.status})`));
  }
  return Array.isArray(payload.files) ? payload.files : [];
}

export async function loadAppVersion(): Promise<string | null> {
  const response = await fetch("/api/version", { method: "GET", cache: "no-store" });
  if (!response.ok) {
    return null;
  }
  const payload = await readJsonPayload<{ readonly version?: string }>(response);
  return typeof payload.version === "string" && payload.version.length > 0 ? payload.version : null;
}

export async function submitRunApproval(id: string, decision: ApprovalDecision): Promise<void> {
  const response = await fetch("/api/run-approval", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, decision }),
  });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `Approval decision failed (${response.status})`));
  }
}

export async function submitRunInput(id: string, selected: readonly string[]): Promise<void> {
  const response = await fetch("/api/run-input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, selected }),
  });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `Option selection failed (${response.status})`));
  }
}

function normalizePendingTurnQueue(payload: unknown, conversationId: string): PendingTurnQueueSnapshot {
  if (!isRecord(payload) || !isRecord(payload.queue)) {
    return { conversationId, paused: false, messages: [], items: [] };
  }
  const queue = payload.queue;
  const rawMessages = Array.isArray(queue.messages) ? queue.messages : [];
  const rawItems = Array.isArray(queue.items) ? queue.items : [];
  return {
    conversationId: typeof queue.conversationId === "string" ? queue.conversationId : conversationId,
    paused: queue.paused === true,
    ...(typeof queue.resumeAtMs === "number" && Number.isFinite(queue.resumeAtMs) ? { resumeAtMs: queue.resumeAtMs } : {}),
    messages: rawMessages.filter(isRecord).map((message) => message as unknown as ChatMessage),
    items: rawItems.filter(isRecord).map((item) => item as unknown as PendingQueueItem),
  };
}

export async function loadPendingTurnQueue(conversationId: string): Promise<PendingTurnQueueSnapshot> {
  const query = new URLSearchParams({ conversationId });
  const response = await fetch(`/api/queue?${query.toString()}`, { method: "GET", cache: "no-store" });
  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw new Error(payloadErrorMessage(payload, `Queue load failed (${response.status})`));
  }
  return normalizePendingTurnQueue(payload, conversationId);
}

export interface PendingQueueEnqueueOptions {
  readonly pauseQueue?: boolean;
}

export interface PendingGoalEnqueueOptions extends PendingQueueEnqueueOptions {
  readonly afterItemId?: string | null;
}

export async function enqueuePendingTurn(conversationId: string, text: string, options: PendingQueueEnqueueOptions = {}): Promise<PendingTurnQueueSnapshot> {
  const response = await fetch("/api/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "enqueue", conversationId, text, ...(options.pauseQueue ? { pauseQueue: true } : {}) }),
  });
  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw new Error(payloadErrorMessage(payload, `Queue enqueue failed (${response.status})`));
  }
  return normalizePendingTurnQueue(payload, conversationId);
}

export async function cancelPendingTurn(conversationId: string, messageId: string): Promise<PendingTurnQueueSnapshot> {
  const response = await fetch("/api/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "cancel", conversationId, messageId }),
  });
  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw new Error(payloadErrorMessage(payload, `Queue cancel failed (${response.status})`));
  }
  return normalizePendingTurnQueue(payload, conversationId);
}

export async function enqueuePendingGoal(conversationId: string, description: string, options: PendingGoalEnqueueOptions = {}): Promise<PendingTurnQueueSnapshot> {
  const response = await fetch("/api/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "enqueueGoal",
      conversationId,
      description,
      ...(options.afterItemId === undefined ? {} : { afterItemId: options.afterItemId }),
      ...(options.pauseQueue ? { pauseQueue: true } : {}),
    }),
  });
  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw new Error(payloadErrorMessage(payload, `Queue goal enqueue failed (${response.status})`));
  }
  return normalizePendingTurnQueue(payload, conversationId);
}

export async function cancelPendingQueueItem(conversationId: string, itemId: string): Promise<PendingTurnQueueSnapshot> {
  const response = await fetch("/api/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "cancelItem", conversationId, itemId }),
  });
  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw new Error(payloadErrorMessage(payload, `Queue item cancel failed (${response.status})`));
  }
  return normalizePendingTurnQueue(payload, conversationId);
}

export async function movePendingQueueItemAfter(conversationId: string, itemId: string, afterItemId: string | null): Promise<PendingTurnQueueSnapshot> {
  const response = await fetch("/api/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "moveAfter", conversationId, itemId, afterItemId }),
  });
  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw new Error(payloadErrorMessage(payload, `Queue item move failed (${response.status})`));
  }
  return normalizePendingTurnQueue(payload, conversationId);
}

export async function setPendingTurnQueuePaused(conversationId: string, paused: boolean, options: { readonly resumeAtMs?: number } = {}): Promise<PendingTurnQueueSnapshot> {
  const response = await fetch("/api/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "setPaused", conversationId, paused, ...(options.resumeAtMs === undefined ? {} : { resumeAtMs: options.resumeAtMs }) }),
  });
  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw new Error(payloadErrorMessage(payload, `Queue pause failed (${response.status})`));
  }
  return normalizePendingTurnQueue(payload, conversationId);
}

export async function sendNextPendingTurn(conversationId: string): Promise<PendingTurnQueueSnapshot> {
  const response = await fetch("/api/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "sendNext", conversationId }),
  });
  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw new Error(payloadErrorMessage(payload, `Queue dispatch failed (${response.status})`));
  }
  return normalizePendingTurnQueue(payload, conversationId);
}

export async function loadCliUpdates(refresh = false): Promise<CliUpdateSnapshot> {
  const response = await fetch(`/api/cli-updates${refresh ? "?refresh=1" : ""}`, { method: "GET", cache: "no-store" });
  const payload = await readJsonPayload<Partial<CliUpdateSnapshot> & { readonly error?: string }>(response);
  if (!response.ok) {
    throw new Error(payloadErrorMessage(payload, `CLI update check failed (${response.status})`));
  }
  return {
    checkedAt: typeof payload.checkedAt === "number" ? payload.checkedAt : 0,
    checking: payload.checking === true,
    updates: Array.isArray(payload.updates) ? payload.updates : [],
    errors: payload.errors && typeof payload.errors === "object" ? payload.errors : {},
  };
}

export async function loadVoiceConfig(): Promise<VoiceConfigSnapshot> {
  const response = await fetch("/api/voice-config", { method: "GET", cache: "no-store" });
  const payload = await readJsonPayload<{ readonly providers?: VoiceConfigSnapshot["providers"]; readonly error?: string }>(response);
  if (!response.ok) {
    throw new Error(payloadErrorMessage(payload, `Voice config load failed (${response.status})`));
  }
  return { providers: payload.providers && typeof payload.providers === "object" ? payload.providers : {} };
}

export async function loadRlabPlugins(): Promise<readonly ComposerPluginLink[]> {
  const response = await fetch("/api/rlab-plugins", { method: "GET", cache: "no-store" });
  const payload = await readJsonPayload<{ readonly plugins?: unknown; readonly error?: string }>(response);
  if (!response.ok) {
    throw new Error(payloadErrorMessage(payload, `rlab plugins load failed (${response.status})`));
  }
  if (!Array.isArray(payload.plugins)) {
    return [];
  }
  return payload.plugins.filter(isRecord).flatMap((plugin) => {
    const { id, label, token } = plugin;
    return typeof id === "string" && typeof label === "string" && typeof token === "string" ? [{ id, label, token }] : [];
  });
}

export async function loadAgentLimits(agent: string | undefined, refresh: boolean): Promise<AgentLimitSnapshot> {
  const params = new URLSearchParams();
  if (refresh && agent) {
    params.set("refresh", "1");
    params.set("agent", agent);
  }
  const response = await fetch(`/api/agent-limits${params.size > 0 ? `?${params.toString()}` : ""}`, { method: "GET", cache: "no-store" });
  const payload = await readJsonPayload<{ readonly limits?: AgentRateLimitMap; readonly refreshError?: string; readonly error?: string }>(response);
  if (!response.ok) {
    throw new Error(payloadErrorMessage(payload, `Agent limits load failed (${response.status})`));
  }
  return { limits: payload.limits ?? {}, refreshError: payload.refreshError };
}

export async function updateAgentCli(agent: string): Promise<void> {
  const response = await fetch("/api/agent-install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent }),
  });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `CLI update failed (${response.status})`));
  }
}

export function clearCliUpdateForAgent(snapshot: CliUpdateSnapshot, agent: string): CliUpdateSnapshot {
  return {
    ...snapshot,
    checkedAt: Date.now(),
    updates: snapshot.updates.filter((update) => update.agent !== agent),
    errors: Object.fromEntries(Object.entries(snapshot.errors).filter(([key]) => key !== agent && key !== "update")),
  };
}

export async function loadWakeups(conversationId?: string): Promise<WakeupSummary[]> {
  const query = new URLSearchParams();
  if (conversationId) {
    query.set("conversationId", conversationId);
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const response = await fetch(`/api/wakeups${suffix}`, { method: "GET", cache: "no-store" });
  const payload = await readJsonPayload<{ readonly wakeups?: WakeupSummary[]; readonly error?: string }>(response);
  if (!response.ok) {
    throw new Error(payloadErrorMessage(payload, `Wakeups load failed (${response.status})`));
  }
  return Array.isArray(payload.wakeups) ? payload.wakeups : [];
}

export async function deleteWakeup(conversationId: string, wakeupId: string): Promise<void> {
  const query = new URLSearchParams({ conversationId, id: wakeupId });
  const response = await fetch(`/api/wakeups?${query.toString()}`, { method: "DELETE", cache: "no-store" });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `Wakeup delete failed (${response.status})`));
  }
}

function twoDigit(value: number): string {
  return value.toString().padStart(2, "0");
}

function formatCompactWakeupTime(timestampMs: number, now = new Date()): string {
  const date = new Date(timestampMs);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  const sameDay = sameYear && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay) {
    return formatClock24(date);
  }
  const dayMonth = `${twoDigit(date.getDate())}.${twoDigit(date.getMonth() + 1)}`;
  return `${sameYear ? dayMonth : `${dayMonth}.${date.getFullYear()}`} ${formatClock24(date)}`;
}

function formatShortInterval(seconds: number | undefined, locale: "ru" | "en"): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return undefined;
  }
  if (seconds % 3600 === 0 && seconds >= 3600) {
    const hours = seconds / 3600;
    return locale === "ru" ? `каждые ${hours}ч` : `every ${hours}h`;
  }
  if (seconds % 60 === 0 && seconds >= 60) {
    const minutes = seconds / 60;
    return locale === "ru" ? `каждые ${minutes}м` : `every ${minutes}m`;
  }
  return locale === "ru" ? `каждые ${seconds}с` : `every ${seconds}s`;
}

export function wakeupLabel(wakeup: WakeupSummary, locale: "ru" | "en"): string {
  if (wakeup.trigger.type === "time") {
    return formatCompactWakeupTime(wakeup.trigger.fireAtMs);
  }
  if (wakeup.trigger.type === "cron") {
    return formatCompactWakeupTime(wakeup.trigger.nextFireMs);
  }
  const scriptSchedule = wakeup.trigger.cron ? formatCompactWakeupTime(wakeup.trigger.nextCheckMs) : (formatShortInterval(wakeup.trigger.intervalSeconds, locale) ?? formatCompactWakeupTime(wakeup.trigger.nextCheckMs));
  const base = scriptSchedule || (locale === "ru" ? "по расписанию" : "scheduled");
  if (wakeup.trigger.lastError) {
    return `${base} · ${wakeup.trigger.lastError}`;
  }
  if (wakeup.trigger.lastExitCode !== undefined) {
    return `${base} · exit ${wakeup.trigger.lastExitCode}`;
  }
  return base;
}

export async function createWorktree(cwd: string): Promise<{ readonly path: string; readonly branch: string }> {
  const response = await fetch("/api/git-worktree-create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  const payload = await readJsonPayload<{ readonly path?: string; readonly branch?: string; readonly error?: string }>(response);
  if (!response.ok || !payload.path) {
    throw new Error(payloadErrorMessage(payload, `Worktree create failed (${response.status})`));
  }
  return { path: payload.path, branch: payload.branch ?? "" };
}

export async function mergeWorktree(base: string, worktreePath: string): Promise<void> {
  const response = await fetch("/api/git-worktree-merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base, worktreePath }),
  });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `Worktree merge failed (${response.status})`));
  }
}
