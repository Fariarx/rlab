import { applyWorkspaceMutationsToState, type WorkspaceMutation } from "../../src/lib/workspace-mutations";
import type { WorkspaceState } from "../../src/lib/workspace-state";

export interface WorkspaceApiFixture<T extends WorkspaceState = WorkspaceState> {
  readonly state: T;
  readonly revision: number;
  readonly setState: (nextState: T) => void;
  readonly setRevision: (nextRevision: number) => void;
  readonly handle: (input: RequestInfo | URL, init?: RequestInit) => Response | null;
}

export function requestPath(input: RequestInfo | URL | Request): string {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return url.startsWith("/") ? url : new URL(url).pathname + new URL(url).search;
}

export function isWorkspaceMutationRequest(path: string, init: RequestInit | undefined): boolean {
  return path === "/api/workspace/mutations" && init?.method === "POST";
}

export function applyWorkspaceMutationRequest<T extends WorkspaceState>(state: T, init: RequestInit | undefined): T {
  const payload = JSON.parse(String(init?.body ?? "{}")) as { readonly mutations?: readonly WorkspaceMutation[] };
  return applyWorkspaceMutationsToState(state, payload.mutations ?? []) as T;
}

export function createWorkspaceApiFixture<T extends WorkspaceState>(initialState: T, initialRevision = 1): WorkspaceApiFixture<T> {
  let state = initialState;
  let revision = initialRevision;
  return {
    get state() {
      return state;
    },
    get revision() {
      return revision;
    },
    setState(nextState) {
      state = nextState;
    },
    setRevision(nextRevision) {
      revision = nextRevision;
    },
    handle(input, init) {
      const path = requestPath(input);
      const method = init?.method ?? "GET";
      if (path === "/api/workspace" && method === "GET") {
        return Response.json({ ...state, revision });
      }
      if (path === "/api/workspace/revision" && method === "GET") {
        return Response.json({ revision });
      }
      if (path.startsWith("/api/thread?") && method === "GET") {
        const conversationId = new URL(path, "http://localhost").searchParams.get("conversationId") ?? "";
        return Response.json({ messages: state.threads[conversationId] ?? [] });
      }
      if (isWorkspaceMutationRequest(path, init)) {
        state = applyWorkspaceMutationRequest(state, init);
        revision += 1;
        return Response.json({ ok: true, revision });
      }
      return null;
    },
  };
}
