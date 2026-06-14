import { applyWorkspaceMutationsToState, type WorkspaceMutation } from "../../../lib/workspace-mutations";
import { cloneWorkspaceState, type WorkspaceState } from "../../../lib/workspace-state";
import { saveWorkspaceMutations, WorkspaceMutationConflictError } from "../../../client/api/workspace-api";
import type { RunMessageHandle } from "../models/workspace-run-state";
import { preserveLiveActiveRunMessages, withoutStaleActiveRunMessageMutations } from "../models/workspace-run-state";

const WORKSPACE_SAVE_DEBOUNCE_MS = 250;
const WORKSPACE_SAVE_RETRY_MS = 2_000;

export interface WorkspaceSaveQueueHost {
  readonly activeRuns: ReadonlyMap<string, RunMessageHandle>;
  readonly applyServerState: (state: WorkspaceState) => void;
  readonly getLoadError: () => string | null;
  readonly getRevision: () => number;
  readonly getState: () => WorkspaceState;
  readonly setLoadError: (error: string | null) => void;
  readonly setRevision: (revision: number) => void;
}

export class WorkspaceSaveQueue {
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private saveRetryTimer: ReturnType<typeof setTimeout> | null = null;

  private pendingMutations: WorkspaceMutation[] = [];

  private pendingSaveUrgent = false;

  private saveInFlight = false;

  constructor(private readonly host: WorkspaceSaveQueueHost) {}

  hasPendingWrites(): boolean {
    return this.pendingMutations.length > 0 || this.saveInFlight || this.saveTimer !== null || this.saveRetryTimer !== null || this.pendingSaveUrgent;
  }

  enqueue(...mutations: WorkspaceMutation[]): void {
    if (mutations.length === 0) {
      return;
    }
    this.pendingMutations.push(...mutations);
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

  private rebaseAfterConflict(error: WorkspaceMutationConflictError, mutations: readonly WorkspaceMutation[]): void {
    const localState = this.host.getState();
    const unsavedMutations = withoutStaleActiveRunMessageMutations(localState, this.host.activeRuns, [...mutations, ...this.pendingMutations]);
    const rebasedState = preserveLiveActiveRunMessages(applyWorkspaceMutationsToState(cloneWorkspaceState(error.workspace), unsavedMutations), localState, this.host.activeRuns);
    this.host.setRevision(error.revision);
    this.host.applyServerState(rebasedState);
    this.pendingMutations = unsavedMutations;
    this.host.setLoadError(null);
    this.pendingSaveUrgent = false;
    this.startSaveRetryTimer();
  }

  private handleSaveFailure(error: unknown, mutations: readonly WorkspaceMutation[]): void {
    if (error instanceof WorkspaceMutationConflictError) {
      this.rebaseAfterConflict(error, mutations);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    this.host.setLoadError(message.startsWith("Workspace save failed") ? message : `Workspace save failed: ${message}`);
    this.pendingMutations = [...mutations, ...this.pendingMutations];
    this.pendingSaveUrgent = false;
    this.startSaveRetryTimer();
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
      this.handleSaveFailure(error, mutations);
    } finally {
      this.saveInFlight = false;
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
