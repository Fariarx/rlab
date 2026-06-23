import type { ChatMessage } from "../../domain/agent-types";
import type { ConversationResource, ResourceKind } from "../../lib/conversation-resources";
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

export interface ConversationResourcesPayload {
  readonly resources: readonly ConversationResource[];
}

export interface WorkspaceChangeEvent {
  readonly revision: number;
  readonly reason?: string;
  readonly conversationIds?: readonly string[];
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

function parseWorkspaceChangeEvent(payload: unknown): WorkspaceChangeEvent | null {
  if (!isRecord(payload) || typeof payload.revision !== "number") {
    return null;
  }
  const conversationIds = Array.isArray(payload.conversationIds) ? payload.conversationIds.filter((id): id is string => typeof id === "string" && id.length > 0) : undefined;
  return {
    revision: payload.revision,
    ...(typeof payload.reason === "string" ? { reason: payload.reason } : {}),
    ...(conversationIds && conversationIds.length > 0 ? { conversationIds } : {}),
  };
}

export function subscribeWorkspaceEvents({
  onEvent,
  onError,
}: {
  readonly onEvent: (event: WorkspaceChangeEvent) => void;
  readonly onError?: (error: Error) => void;
}): () => void {
  if (typeof EventSource === "undefined") {
    return () => undefined;
  }
  const source = new EventSource("/api/workspace/events");
  const handleEvent = (event: MessageEvent<string>) => {
    try {
      const parsed = parseWorkspaceChangeEvent(JSON.parse(event.data) as unknown);
      if (parsed) {
        onEvent(parsed);
      }
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };
  source.addEventListener("workspace", handleEvent);
  source.onerror = () => {
    onError?.(new Error("Workspace event stream disconnected."));
  };
  return () => {
    source.removeEventListener("workspace", handleEvent);
    source.close();
  };
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

function parseResourceKind(value: unknown): ResourceKind | null {
  return value === "image" || value === "link" || value === "file" ? value : null;
}

function parseResourceOrigin(value: unknown): ConversationResource["origin"] | null {
  return value === "user" || value === "agent" ? value : null;
}

function parseConversationResource(value: unknown, index: number): ConversationResource {
  if (!isRecord(value)) {
    throw new Error(`Resource ${index} is not an object.`);
  }
  const kind = parseResourceKind(value.kind);
  const origin = parseResourceOrigin(value.origin);
  if (!kind) {
    throw new Error(`Resource ${index} has an invalid kind.`);
  }
  if (typeof value.id !== "string" || typeof value.url !== "string" || typeof value.label !== "string") {
    throw new Error(`Resource ${index} is missing id, url, or label.`);
  }
  if (!origin) {
    throw new Error(`Resource ${index} has an invalid origin.`);
  }
  if (value.time !== undefined && typeof value.time !== "string") {
    throw new Error(`Resource ${index} has an invalid time.`);
  }
  return {
    id: value.id,
    kind,
    url: value.url,
    label: value.label,
    origin,
    ...(value.time === undefined ? {} : { time: value.time }),
  };
}

function validateConversationResources(payload: unknown): ConversationResourcesPayload {
  if (!isRecord(payload) || !Array.isArray(payload.resources)) {
    throw new Error("Resources response is missing resources.");
  }
  return {
    resources: payload.resources.map((resource, index) => parseConversationResource(resource, index)),
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

export async function loadConversationResources(conversationId: string, options: { readonly signal?: AbortSignal } = {}): Promise<readonly ConversationResource[]> {
  const params = new URLSearchParams({ conversationId });
  const response = await fetch(`/api/resources?${params.toString()}`, { cache: "no-store", signal: options.signal });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `Resources load failed (${response.status})`));
  }
  return validateConversationResources(await response.json()).resources;
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
