import { applyWorkspaceMutationsToState, type WorkspaceMutation } from "../../src/lib/workspace-mutations";
import type { WorkspaceState } from "../../src/lib/workspace-state";

export function isWorkspaceMutationRequest(path: string, init: RequestInit | undefined): boolean {
  return path === "/api/workspace/mutations" && init?.method === "POST";
}

export function applyWorkspaceMutationRequest<T extends WorkspaceState>(state: T, init: RequestInit | undefined): T {
  const payload = JSON.parse(String(init?.body ?? "{}")) as { readonly mutations?: readonly WorkspaceMutation[] };
  return applyWorkspaceMutationsToState(state, payload.mutations ?? []) as T;
}
