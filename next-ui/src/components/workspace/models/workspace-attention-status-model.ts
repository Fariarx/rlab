import type { ConversationSummary } from "../../agent";
import { dark } from "../../../theme/tokens";

export type WorkspaceAttentionStatus = "error" | "action" | "working" | "done";

export function workspaceAttentionStatus(conversations: readonly ConversationSummary[]): WorkspaceAttentionStatus | null {
  if (conversations.some((conversation) => conversation.status === "error" && conversation.unread === true)) {
    return "error";
  }
  if (conversations.some((conversation) => conversation.status === "waiting" && conversation.unread === true)) {
    return "action";
  }
  if (conversations.some((conversation) => conversation.status === "running")) {
    return "working";
  }
  if (conversations.some((conversation) => conversation.status === "done" && conversation.unread === true)) {
    return "done";
  }
  return null;
}

const STATUS_COLOR: Record<WorkspaceAttentionStatus, string> = {
  error: dark.status.error.main,
  action: dark.status.warn.main,
  working: dark.status.running.main,
  done: dark.status.ok.main,
};

const STATUS_RING: Record<WorkspaceAttentionStatus, string> = {
  error: dark.status.error.border,
  action: dark.status.warn.border,
  working: dark.status.running.border,
  done: dark.status.ok.border,
};

export function workspaceAttentionStatusAnimates(status: WorkspaceAttentionStatus): boolean {
  return status !== "done";
}

function wave(progress: number): { readonly radius: string; readonly opacity: string } {
  const radius = 8.25 + progress * 6.75;
  const opacity = Math.max(0, 0.58 * (1 - progress));
  return { radius: radius.toFixed(2), opacity: opacity.toFixed(2) };
}

export function workspaceAttentionFaviconHref(status: WorkspaceAttentionStatus, animated: boolean, frame = 0): string {
  const color = STATUS_COLOR[status];
  const ring = STATUS_RING[status];
  const shouldAnimate = animated && workspaceAttentionStatusAnimates(status);
  const normalizedFrame = ((frame % 12) + 12) % 12;
  const progressA = normalizedFrame / 12;
  const progressB = (progressA + 0.5) % 1;
  const firstWave = wave(progressA);
  const secondWave = wave(progressB);
  const dotPulse = shouldAnimate ? 0.5 + Math.sin(progressA * Math.PI * 2) * 0.5 : 0;
  const dotRadius = (7.35 + dotPulse * 0.6).toFixed(2);
  const dotOpacity = (0.92 + dotPulse * 0.08).toFixed(2);
  const waves = shouldAnimate
    ? `<circle cx="16" cy="16" r="${firstWave.radius}" fill="none" stroke="${color}" stroke-width="2.4" opacity="${firstWave.opacity}"/><circle cx="16" cy="16" r="${secondWave.radius}" fill="none" stroke="${color}" stroke-width="2.4" opacity="${secondWave.opacity}"/>`
    : "";
  const staticRing = shouldAnimate ? "" : `<circle cx="16" cy="16" r="9.75" fill="none" stroke="${ring}" stroke-width="2" opacity="${status === "done" ? "0.5" : "0.35"}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="transparent"/>${waves}${staticRing}<circle cx="16" cy="16" r="${shouldAnimate ? dotRadius : "7.5"}" fill="${color}" opacity="${shouldAnimate ? dotOpacity : "0.96"}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
