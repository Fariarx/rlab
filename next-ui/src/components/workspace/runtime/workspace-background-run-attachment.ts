import { attachRunUpdates, loadActiveRuns, type ActiveRunSnapshot, type ActiveRunUpdate } from "../../../client/api/run-agent";
import { isLiveRunStatus } from "../models/workspace-run-state";

export const DEFAULT_BACKGROUND_ATTACH_SILENCE_RECONCILE_MS = 20_000;

export interface RunHandle {
  readonly controller: AbortController;
  readonly runId: string;
  readonly userMessageId: string;
  readonly agentMessageId: string;
  lastUpdateAtMs: number;
  serverOwned: boolean;
  canceled: boolean;
}

export interface AttachWorkspaceBackgroundRunInput {
  readonly run: ActiveRunSnapshot;
  readonly runs: Map<string, RunHandle>;
  readonly applyUpdate: (update: ActiveRunUpdate) => void;
  readonly disconnectedMessage: () => string;
  readonly reconcileBackgroundRuns: () => void;
  readonly setLoadError: (message: string) => void;
  readonly silenceReconcileMs?: number;
  readonly attachRunUpdatesApi?: typeof attachRunUpdates;
  readonly loadActiveRunsApi?: typeof loadActiveRuns;
}

export function attachWorkspaceBackgroundRun({
  run,
  runs,
  applyUpdate,
  disconnectedMessage,
  reconcileBackgroundRuns,
  setLoadError,
  silenceReconcileMs = DEFAULT_BACKGROUND_ATTACH_SILENCE_RECONCILE_MS,
  attachRunUpdatesApi = attachRunUpdates,
  loadActiveRunsApi = loadActiveRuns,
}: AttachWorkspaceBackgroundRunInput): void {
  if (runs.has(run.conversationId)) {
    return;
  }
  const controller = new AbortController();
  const runHandle: RunHandle = {
    controller,
    runId: run.runId,
    userMessageId: run.userMessageId,
    agentMessageId: run.agentMessageId,
    lastUpdateAtMs: Date.now(),
    serverOwned: true,
    canceled: false,
  };
  runs.set(run.conversationId, runHandle);
  let terminalUpdateReceived = false;
  let attachErrorMessage: string | null = null;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;

  const stillCurrent = () => runs.get(run.conversationId) === runHandle && !controller.signal.aborted && !runHandle.canceled;
  const clearSilenceTimer = () => {
    if (silenceTimer !== null) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  };
  const scheduleSilenceReconcile = () => {
    clearSilenceTimer();
    silenceTimer = setTimeout(() => {
      silenceTimer = null;
      if (!stillCurrent()) {
        return;
      }
      void loadActiveRunsApi()
        .then((activeRuns) => {
          if (!stillCurrent()) {
            return;
          }
          if (activeRuns.some((activeRun) => activeRun.runId === run.runId)) {
            scheduleSilenceReconcile();
            return;
          }
          runs.delete(run.conversationId);
          controller.abort();
          reconcileBackgroundRuns();
        })
        .catch((error: unknown) => {
          if (!stillCurrent()) {
            return;
          }
          setLoadError(error instanceof Error ? error.message : String(error));
          scheduleSilenceReconcile();
        });
    }, silenceReconcileMs);
  };

  scheduleSilenceReconcile();
  attachRunUpdatesApi({
    runId: run.runId,
    signal: controller.signal,
    onUpdate: (update) => {
      if (runs.get(run.conversationId) !== runHandle) {
        return;
      }
      terminalUpdateReceived = terminalUpdateReceived || update.done || !isLiveRunStatus(update.status);
      runHandle.lastUpdateAtMs = Date.now();
      applyUpdate(update);
      if (terminalUpdateReceived) {
        clearSilenceTimer();
      } else {
        scheduleSilenceReconcile();
      }
    },
  })
    .catch((error: unknown) => {
      if (controller.signal.aborted || runHandle.canceled) {
        return;
      }
      attachErrorMessage = error instanceof Error ? error.message : String(error);
      setLoadError(attachErrorMessage);
    })
    .finally(() => {
      clearSilenceTimer();
      if (runs.get(run.conversationId) === runHandle) {
        runs.delete(run.conversationId);
      }
      if (!controller.signal.aborted && !runHandle.canceled && !terminalUpdateReceived) {
        setLoadError(attachErrorMessage ?? disconnectedMessage());
        reconcileBackgroundRuns();
      }
    });
}
