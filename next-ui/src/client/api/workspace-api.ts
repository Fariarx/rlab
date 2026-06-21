import type { ChatMessage } from "../../domain/agent-types";
import type { WorkspaceMutation } from "../../lib/workspace-mutations";
import type { WorkspaceState } from "../../lib/workspace-state";
import { isRecord, responseErrorMessage } from "./http";

export type WorkspaceStatePayload = WorkspaceState & { readonly revision?: number };
export type WorkspaceRevisionPayload = { readonly revision?: number };

export interface ConversationThreadPagePayload {
  readonly messages: readonly ChatMessage[];
  readonly hasMoreBefore: boolean;
  readonly nextBefore?: number;
}

export class WorkspaceMutationConflictError extends Error {
  readonly revision: number;
  readonly workspace: WorkspaceState;

  constructor(message: string, revision: number, workspace: WorkspaceState) {
    super(message);
    this.name = "WorkspaceMutationConflictError";
    this.revision = revision;
    this.workspace = workspace;
  }
}

export class WorkspaceMutationRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceMutationRejectedError";
  }
}

export async function loadWorkspaceState(): Promise<WorkspaceStatePayload> {
  const response = await fetch("/api/workspace", { method: "GET", cache: "no-store" });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `Workspace load failed (${response.status})`));
  }
  return (await response.json()) as WorkspaceStatePayload;
}

export async function loadWorkspaceRevision(): Promise<number> {
  const response = await fetch("/api/workspace/revision", { method: "GET", cache: "no-store" });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `Workspace revision load failed (${response.status})`));
  }
  const payload = (await response.json()) as WorkspaceRevisionPayload;
  if (typeof payload.revision !== "number") {
    throw new Error("Workspace revision response is missing revision.");
  }
  return payload.revision;
}

export async function saveWorkspaceMutations(mutations: readonly WorkspaceMutation[], baseRevision: number): Promise<number | undefined> {
  if (mutations.length === 0) {
    return undefined;
  }
  const response = await fetch("/api/workspace/mutations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mutations, baseRevision }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as unknown;
    if (response.status === 409 && isRecord(payload) && typeof payload.revision === "number" && isRecord(payload.workspace)) {
      const message = typeof payload.error === "string" && payload.error.trim().length > 0 ? payload.error.trim() : "Workspace revision conflict.";
      throw new WorkspaceMutationConflictError(message, payload.revision, payload.workspace as unknown as WorkspaceState);
    }
    if (isRecord(payload) && payload.retryable === false) {
      const message = typeof payload.error === "string" && payload.error.trim().length > 0 ? payload.error.trim() : `Workspace save rejected (${response.status})`;
      throw new WorkspaceMutationRejectedError(message);
    }
    const message = isRecord(payload) && typeof payload.error === "string" && payload.error.trim().length > 0 ? payload.error.trim() : `Workspace save failed (${response.status})`;
    throw new Error(message);
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  return isRecord(payload) && typeof payload.revision === "number" ? payload.revision : undefined;
}

function validateConversationThreadPage(payload: unknown): ConversationThreadPagePayload {
  const page = payload as { readonly messages?: unknown; readonly hasMoreBefore?: unknown; readonly nextBefore?: unknown };
  if (!Array.isArray(page.messages)) {
    throw new Error("Thread response is missing messages.");
  }
  return {
    messages: page.messages as readonly ChatMessage[],
    hasMoreBefore: page.hasMoreBefore === true,
    nextBefore: typeof page.nextBefore === "number" && Number.isFinite(page.nextBefore) ? page.nextBefore : undefined,
  };
}

export async function loadConversationThreadPage(
  conversationId: string,
  options: { readonly before?: number; readonly limit?: number } = {},
): Promise<ConversationThreadPagePayload> {
  const params = new URLSearchParams({ conversationId });
  if (typeof options.before === "number" && Number.isFinite(options.before)) {
    params.set("before", String(Math.trunc(options.before)));
  }
  if (typeof options.limit === "number" && Number.isFinite(options.limit)) {
    params.set("limit", String(Math.trunc(options.limit)));
  }
  const response = await fetch(`/api/thread?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `Thread load failed (${response.status})`));
  }
  return validateConversationThreadPage(await response.json());
}

export async function loadConversationThread(conversationId: string): Promise<readonly ChatMessage[]> {
  const params = new URLSearchParams({ conversationId, full: "1" });
  const response = await fetch(`/api/thread?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `Thread load failed (${response.status})`));
  }
  return validateConversationThreadPage(await response.json()).messages;
}

export async function searchConversationIds(query: string): Promise<readonly string[]> {
  const params = new URLSearchParams({ q: query });
  const response = await fetch(`/api/conversations/search?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `Conversation search failed (${response.status})`));
  }
  const payload = (await response.json()) as { readonly ids?: readonly unknown[] };
  return Array.isArray(payload.ids) ? payload.ids.filter((id): id is string => typeof id === "string") : [];
}
