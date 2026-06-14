import { useCallback, useEffect, useRef, useState } from "react";
import type { I18nApi } from "../../../i18n/I18nProvider";
import type { AgentRateLimitMap } from "../../../lib/agent-limits";
import { loadAgentLimits } from "../../../client/api/workspace-page-api";
import type { ToastOptions } from "../../ui";

const AGENT_LIMIT_REFRESH_MIN_INTERVAL_MS = 60_000;
const AGENT_LIMIT_ON_DEMAND_REFRESH_AGENTS = new Set(["claude-code", "codex", "gemini"]);

export interface UseAgentLimitsOptions {
  readonly t: I18nApi["t"];
  readonly toast: (options: ToastOptions) => string;
}

export interface AgentLimitsController {
  readonly limits: AgentRateLimitMap;
  readonly loaded: boolean;
  readonly refreshing: Readonly<Record<string, boolean>>;
  readonly refreshErrors: Readonly<Record<string, string | undefined>>;
  readonly refresh: (agentId: string | undefined, requestRefresh: boolean) => void;
}

export function useAgentLimits({ t, toast }: UseAgentLimitsOptions): AgentLimitsController {
  const [limits, setLimits] = useState<AgentRateLimitMap>({});
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState<Readonly<Record<string, boolean>>>({});
  const [refreshErrors, setRefreshErrors] = useState<Readonly<Record<string, string | undefined>>>({});
  const refreshAttemptRef = useRef<Record<string, number>>({});

  const refresh = useCallback((agentId: string | undefined, requestRefresh: boolean) => {
    const canRequestRefresh = Boolean(requestRefresh && agentId && AGENT_LIMIT_ON_DEMAND_REFRESH_AGENTS.has(agentId));
    if (requestRefresh && agentId && !canRequestRefresh) {
      setRefreshErrors((current) => ({ ...current, [agentId]: undefined }));
    }
    if (canRequestRefresh && agentId) {
      const lastAttempt = refreshAttemptRef.current[agentId] ?? 0;
      if (Date.now() - lastAttempt < AGENT_LIMIT_REFRESH_MIN_INTERVAL_MS) {
        return;
      }
      refreshAttemptRef.current = { ...refreshAttemptRef.current, [agentId]: Date.now() };
      setRefreshing((current) => ({ ...current, [agentId]: true }));
      setRefreshErrors((current) => ({ ...current, [agentId]: undefined }));
    }

    loadAgentLimits(agentId, canRequestRefresh)
      .then((snapshot) => {
        setLimits(snapshot.limits);
        setLoaded(true);
        if (agentId) {
          setRefreshErrors((current) => ({ ...current, [agentId]: snapshot.refreshError }));
        }
      })
      .catch((error: unknown) => {
        setLoaded(true);
        if (agentId) {
          setRefreshErrors((current) => ({
            ...current,
            [agentId]: error instanceof Error ? error.message : t("limitsRefreshError"),
          }));
        } else {
          toast({ message: error instanceof Error ? error.message : t("limitsRefreshError"), severity: "error", duration: 3000 });
        }
      })
      .finally(() => {
        if (agentId) {
          setRefreshing((current) => ({ ...current, [agentId]: false }));
        }
      });
  }, [t, toast]);

  useEffect(() => {
    refresh(undefined, false);
  }, [refresh]);

  return { limits, loaded, refreshing, refreshErrors, refresh };
}
