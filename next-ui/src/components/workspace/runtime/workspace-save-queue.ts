import { applyWorkspaceMutationsToState, parseWorkspaceMutation, type WorkspaceMutation } from "../../../lib/workspace-mutations";
import { cloneWorkspaceState, type WorkspaceState } from "../../../lib/workspace-state";
import { saveWorkspaceMutations, WorkspaceMutationConflictError, WorkspaceMutationRejectedError } from "../../../client/api/workspace-api";
import { mergeRemoteWorkspaceShell } from "../models/workspace-server-sync-model";
import type { RemoteWorkspaceShellMerge } from "../models/workspace-server-sync-model";
import type { RunMessageHandle } from "../models/workspace-run-state";
import { preserveLiveActiveRunMessages, withoutStaleActiveRunMessageMutations } from "../models/workspace-run-state";
import { workspaceConversations } from "../models/workspace-state-utils";

const WORKSPACE_SAVE_DEBOUNCE_MS = 250;
const WORKSPACE_SAVE_RETRY_MS = 2_000;
const WORKSPACE_PENDING_MUTATIONS_STORAGE_KEY = "rlab.workspace.pendingMutations.v1";

export interface WorkspaceSaveQueueHost {
  readonly activeRuns: ReadonlyMap<string, RunMessageHandle>;
  readonly applyRemoteMergedState?: (state: WorkspaceState, merge: RemoteWorkspaceShellMerge) => void;
  readonly applyServerState: (state: WorkspaceState) => void;
  readonly getLoadError: () => string | null;
  readonly getRevision: () => number;
  readonly getState: () => WorkspaceState;
  readonly setLoadError: (error: string | null) => void;
  readonly setRevision: (revision: number) => void;
}

function workspaceMutationStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readPersistedWorkspaceMutations(): WorkspaceMutation[] {
  const storage = workspaceMutationStorage();
  if (!storage) {
    return [];
  }
  const raw = storage.getItem(WORKSPACE_PENDING_MUTATIONS_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("Workspace pending mutation log is invalid.");
    }
    return parsed.map(parseWorkspaceMutation);
  } catch {
    storage.removeItem(WORKSPACE_PENDING_MUTATIONS_STORAGE_KEY);
    return [];
  }
}

function writePersistedWorkspaceMutations(mutations: readonly WorkspaceMutation[]): string | null {
  const storage = workspaceMutationStorage();
  if (!storage) {
    return null;
  }
  try {
    if (mutations.length === 0) {
      storage.removeItem(WORKSPACE_PENDING_MUTATIONS_STORAGE_KEY);
      return null;
    }
    storage.setItem(WORKSPACE_PENDING_MUTATIONS_STORAGE_KEY, JSON.stringify(mutations));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export class WorkspaceSaveQueue {
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private saveRetryTimer: ReturnType<typeof setTimeout> | null = null;

  private pendingMutations: WorkspaceMutation[] = [];

  private saveInFlightMutations: readonly WorkspaceMutation[] = [];

  private pendingSaveUrgent = false;

  private saveInFlight = false;

  constructor(private readonly host: WorkspaceSaveQueueHost) {
    this.pendingMutations = readPersistedWorkspaceMutations();
  }

  hasPendingWrites(): boolean {
    return this.pendingMutations.length > 0 || this.saveInFlight || this.saveTimer !== null || this.saveRetryTimer !== null || this.pendingSaveUrgent;
  }

  enqueue(...mutations: WorkspaceMutation[]): void {
    if (mutations.length === 0) {
      return;
    }
    this.pendingMutations.push(...mutations);
    this.persistMutationLog();
    this.startSaveTimer();
  }

  flushNow(): void {
    this.pendingSaveUrgent = true;
    void this.flush();
  }

  dispose(): void {
    void this.flush();
    if (this.saveRetryTimer) {
      clearTimeout(this.saveRetryTimer);
      this.saveRetryTimer = null;
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  private startSaveTimer(): void {
    if (this.saveTimer !== null || this.saveInFlight) {
      return;
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, WORKSPACE_SAVE_DEBOUNCE_MS);
  }

  private startSaveRetryTimer(): void {
    if (this.saveRetryTimer !== null) {
      return;
    }
    this.saveRetryTimer = setTimeout(() => {
      this.saveRetryTimer = null;
      void this.flush();
    }, WORKSPACE_SAVE_RETRY_MS);
  }

  replayPersistedMutationsAfterServerLoad(): void {
    if (this.pendingMutations.length === 0) {
      return;
    }
    const localState = this.host.getState();
    const unsavedMutations = withoutStaleActiveRunMessageMutations(localState, this.host.activeRuns, this.pendingMutations);
    this.pendingMutations = unsavedMutations;
    this.persistMutationLog();
    if (unsavedMutations.length === 0) {
      return;
    }
    const replayedState = preserveLiveActiveRunMessages(applyWorkspaceMutationsToState(localState, unsavedMutations), localState, this.host.activeRuns);
    this.host.applyServerState(replayedState);
    this.pendingSaveUrgent = false;
    this.startSaveTimer();
  }

  private persistMutationLog(): void {
    const persistError = writePersistedWorkspaceMutations([...this.saveInFlightMutations, ...this.pendingMutations]);
    if (persistError) {
      this.host.setLoadError(`Workspace pending mutations could not be persisted: ${persistError}`);
    }
  }

  private rebaseAfterConflict(error: WorkspaceMutationConflictError, mutations: readonly WorkspaceMutation[]): void {
    const localState = this.host.getState();
    const unsavedMutations = withoutStaleActiveRunMessageMutations(localState, this.host.activeRuns, [...mutations, ...this.pendingMutations]);
    const conflictMerge = mergeRemoteWorkspaceShell({
      current: localState,
      serverState: cloneWorkspaceState(error.workspace),
      preferredSelectedId: localState.selectedId,
      activeRuns: this.host.activeRuns,
    });
    const conflictBase = conflictMerge.state;
    const rebasedState = preserveLiveActiveRunMessages(applyWorkspaceMutationsToState(conflictBase, unsavedMutations), localState, this.host.activeRuns);
    const rebasedConversationIds = new Set(workspaceConversations(rebasedState).map((conversation) => conversation.id));
    const rebasedMerge: RemoteWorkspaceShellMerge = {
      ...conflictMerge,
      state: rebasedState,
      selectedId: rebasedState.selectedId,
      knownConversationIds: rebasedConversationIds,
      stalePreservedThreadIds: new Set([...conflictMerge.stalePreservedThreadIds].filter((id) => rebasedConversationIds.has(id))),
    };
    this.host.setRevision(error.revision);
    if (this.host.applyRemoteMergedState) {
      this.host.applyRemoteMergedState(rebasedState, rebasedMerge);
    } else {
      this.host.applyServerState(rebasedState);
    }
    this.pendingMutations = unsavedMutations;
    this.persistMutationLog();
    this.host.setLoadError(null);
    this.pendingSaveUrgent = false;
    this.startSaveRetryTimer();
  }

  private rejectedSaveMessage(messages: readonly string[]): string {
    const uniqueMessages = [...new Set(messages)];
    if (uniqueMessages.length === 0) {
      return "Workspace save rejected.";
    }
    if (uniqueMessages.length === 1) {
      return `Workspace save rejected: ${uniqueMessages[0]}`;
    }
    return `Workspace save rejected ${uniqueMessages.length} mutations: ${uniqueMessages.join("; ")}`;
  }

  private async salvageRejectedMutations(error: WorkspaceMutationRejectedError, mutations: readonly WorkspaceMutation[]): Promise<boolean> {
    if (mutations.length <= 1) {
      this.host.setLoadError(this.rejectedSaveMessage([error.message]));
      this.pendingSaveUrgent = false;
      return true;
    }
    const rejectedMessages: string[] = [];
    for (let index = 0; index < mutations.length; index += 1) {
      const mutation = mutations[index];
      if (!mutation) {
        continue;
      }
      try {
        const revision = await saveWorkspaceMutations([mutation], this.host.getRevision());
        if (revision !== undefined) {
          this.host.setRevision(revision);
        }
      } catch (salvageError) {
        if (salvageError instanceof WorkspaceMutationRejectedError) {
          rejectedMessages.push(salvageError.message);
          continue;
        }
        const remainingMutations = [mutation, ...mutations.slice(index + 1)];
        if (salvageError instanceof WorkspaceMutationConflictError) {
          this.rebaseAfterConflict(salvageError, remainingMutations);
          return false;
        }
        const message = salvageError instanceof Error ? salvageError.message : String(salvageError);
        this.host.setLoadError(message.startsWith("Workspace save failed") ? message : `Workspace save failed: ${message}`);
        this.pendingMutations = [...remainingMutations, ...this.pendingMutations];
        this.persistMutationLog();
        this.pendingSaveUrgent = false;
        this.startSaveRetryTimer();
        return false;
      }
    }
    this.host.setLoadError(this.rejectedSaveMessage(rejectedMessages.length > 0 ? rejectedMessages : [error.message]));
    this.pendingSaveUrgent = false;
    return true;
  }

  private async handleSaveFailure(error: unknown, mutations: readonly WorkspaceMutation[]): Promise<boolean> {
    if (error instanceof WorkspaceMutationConflictError) {
      this.rebaseAfterConflict(error, mutations);
      return false;
    }
    if (error instanceof WorkspaceMutationRejectedError) {
      return this.salvageRejectedMutations(error, mutations);
    }
    const message = error instanceof Error ? error.message : String(error);
    this.host.setLoadError(message.startsWith("Workspace save failed") ? message : `Workspace save failed: ${message}`);
    this.pendingMutations = [...mutations, ...this.pendingMutations];
    this.persistMutationLog();
    this.pendingSaveUrgent = false;
    this.startSaveRetryTimer();
    return false;
  }

  private async flush(): Promise<void> {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.saveRetryTimer !== null) {
      clearTimeout(this.saveRetryTimer);
      this.saveRetryTimer = null;
    }
    if (this.saveInFlight) {
      this.pendingSaveUrgent = true;
      return;
    }
    if (this.pendingMutations.length === 0) {
      return;
    }
    const mutations = this.pendingMutations;
    this.pendingMutations = [];
    this.pendingSaveUrgent = false;
    this.saveInFlightMutations = mutations;
    this.persistMutationLog();
    this.saveInFlight = true;
    let saveFailed = false;
    try {
      const revision = await saveWorkspaceMutations(mutations, this.host.getRevision());
      if (revision !== undefined) {
        this.host.setRevision(revision);
      }
      if (this.host.getLoadError()?.startsWith("Workspace save failed")) {
        this.host.setLoadError(null);
      }
    } catch (error) {
      saveFailed = true;
      if (await this.handleSaveFailure(error, mutations)) {
        saveFailed = false;
      }
    } finally {
      this.saveInFlight = false;
      this.saveInFlightMutations = [];
      this.persistMutationLog();
      if (this.pendingMutations.length > 0) {
        if (this.pendingSaveUrgent) {
          void this.flush();
        } else if (!saveFailed) {
          this.startSaveTimer();
        }
      }
    }
  }
}
