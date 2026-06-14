import { useCallback, useEffect, useState } from "react";
import type { I18nApi } from "../../../i18n/I18nProvider";
import {
  CLI_UPDATE_POLL_MS,
  clearCliUpdateForAgent,
  loadCliUpdates,
  updateAgentCli,
  type CliUpdateInfo,
  type CliUpdateSnapshot,
} from "../../../client/api/workspace-page-api";
import type { ToastOptions } from "../../ui";

const EMPTY_CLI_UPDATE_SNAPSHOT: CliUpdateSnapshot = { checkedAt: 0, checking: false, updates: [], errors: {} };

export interface UseCliUpdatesOptions {
  readonly reloadAgentStatus: () => void;
  readonly t: I18nApi["t"];
  readonly toast: (options: ToastOptions) => string;
}

export interface CliUpdatesController {
  readonly snapshot: CliUpdateSnapshot;
  readonly busyAgent: string | null;
  readonly updateCli: (update: CliUpdateInfo) => Promise<void>;
}

export function useCliUpdates({ reloadAgentStatus, t, toast }: UseCliUpdatesOptions): CliUpdatesController {
  const [snapshot, setSnapshot] = useState<CliUpdateSnapshot>(EMPTY_CLI_UPDATE_SNAPSHOT);
  const [busyAgent, setBusyAgent] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const refresh = async () => {
      try {
        const nextSnapshot = await loadCliUpdates(false);
        if (alive) {
          setSnapshot(nextSnapshot);
        }
      } catch {
        // The card is for actionable updates, not transient status noise. Manual
        // update failures are surfaced directly in updateCli.
      }
    };
    void refresh();
    timer = setInterval(refresh, CLI_UPDATE_POLL_MS);
    return () => {
      alive = false;
      if (timer) {
        clearInterval(timer);
      }
    };
  }, []);

  const updateCli = useCallback(async (update: CliUpdateInfo) => {
    setBusyAgent(update.agent);
    toast({ message: t("cliUpdateStarted", { agent: update.agentName }), severity: "info", duration: 2500 });
    try {
      await updateAgentCli(update.agent);
      reloadAgentStatus();
      setSnapshot((current) => clearCliUpdateForAgent(current, update.agent));
      const refreshed = await loadCliUpdates(true);
      setSnapshot(
        refreshed.updates.some((candidate) => candidate.agent === update.agent)
          ? clearCliUpdateForAgent(refreshed, update.agent)
          : refreshed,
      );
      toast({ message: t("cliUpdateComplete", { agent: update.agentName }), severity: "success", duration: 2500 });
    } catch (error) {
      toast({ message: t("cliUpdateFailed", { error: error instanceof Error ? error.message : String(error) }), severity: "error", duration: 5000 });
    } finally {
      setBusyAgent(null);
    }
  }, [reloadAgentStatus, t, toast]);

  return { snapshot, busyAgent, updateCli };
}
