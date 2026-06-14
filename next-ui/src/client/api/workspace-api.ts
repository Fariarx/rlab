import type { ChatMessage } from "../../domain/agent-types";
import type { WorkspaceMutation } from "../../lib/workspace-mutations";
import type { WorkspaceState } from "../../lib/workspace-state";
import { isRecord, responseErrorMessage } from "./http";

export type WorkspaceStatePayload = WorkspaceState & { readonly revision?: number };
export type WorkspaceRevisionPayload = { readonly revision?: number };

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
    if (response.status === 409) {
      const payload = (await response.json().catch(() => null)) as unknown;
      if (isRecord(payload) && typeof payload.revision === "number" && isRecord(payload.workspace)) {
        const message = typeof payload.error === "string" && payload.error.trim().length > 0 ? payload.error.trim() : "Workspace revision conflict.";
        throw new WorkspaceMutationConflictError(message, payload.revision, payload.workspace as unknown as WorkspaceState);
      }
    }
    throw new Error(await responseErrorMessage(response, `Workspace save failed (${response.status})`));
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  return isRecord(payload) && typeof payload.revision === "number" ? payload.revision : undefined;
}

export async function loadConversationThread(conversationId: string): Promise<readonly ChatMessage[]> {
  const response = await fetch(`/api/thread?conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `Thread load failed (${response.status})`));
  }
  const payload = (await response.json()) as { readonly messages?: readonly ChatMessage[] };
  if (!Array.isArray(payload.messages)) {
    throw new Error("Thread response is missing messages.");
  }
  return payload.messages;
}
