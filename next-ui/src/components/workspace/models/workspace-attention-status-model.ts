import type { ConversationSummary } from "../../agent";
import { dark } from "../../../theme/tokens";

export type WorkspaceAttentionStatus = "error" | "action" | "working" | "done";

export function workspaceAttentionStatus(conversations: readonly ConversationSummary[]): WorkspaceAttentionStatus | null {
  if (conversations.some((conversation) => conversation.status === "error" && conversation.unread === true)) {
    return "error";
  }
  if (conversations.some((conversation) => conversation.status === "waiting")) {
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

export function workspaceAttentionFaviconHref(status: WorkspaceAttentionStatus, animated: boolean): string {
  const color = STATUS_COLOR[status];
  const ring = STATUS_RING[status];
  const shouldAnimate = animated && status !== "done";
  const pulse = shouldAnimate
    ? '<animate attributeName="r" values="8;9.5;8" dur="1.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.95;0.72;0.95" dur="1.4s" repeatCount="indefinite"/>'
    : "";
  const ringPulse = shouldAnimate
    ? '<animate attributeName="r" values="10;13;10" dur="1.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.55;0;0.55" dur="1.4s" repeatCount="indefinite"/>'
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="transparent"/><circle cx="16" cy="16" r="10" fill="none" stroke="${ring}" stroke-width="2" opacity="${shouldAnimate ? "0.55" : "0"}">${ringPulse}</circle><circle cx="16" cy="16" r="8" fill="${color}" opacity="0.95">${pulse}</circle></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
