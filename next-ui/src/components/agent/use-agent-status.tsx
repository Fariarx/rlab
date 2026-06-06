import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { AGENT_STATUS, type AgentId, type AgentSystemStatus } from "./agents";

type StatusMap = Partial<Record<AgentId, AgentSystemStatus>>;

interface AgentStatusValue {
  readonly statuses: StatusMap | null;
  readonly live: boolean;
}

const AgentStatusContext = createContext<AgentStatusValue>({ statuses: null, live: false });

/**
 * Fetches real agent availability from the dev backend (`/api/agents`, served by
 * vite-agents-plugin) once on mount. Falls back to the static demo registry when
 * the endpoint is unavailable (e.g. a static production build).
 */
export function AgentStatusProvider({ children }: { readonly children: ReactNode }) {
  const [statuses, setStatuses] = useState<StatusMap | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/agents")
      .then((r) => (r.ok ? (r.json() as Promise<StatusMap>) : null))
      .then((data) => {
        if (active && data) {
          setStatuses(data);
        }
      })
      .catch(() => {
        /* keep fallback */
      });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<AgentStatusValue>(() => ({ statuses, live: statuses != null }), [statuses]);
  return <AgentStatusContext.Provider value={value}>{children}</AgentStatusContext.Provider>;
}

/** Returns a resolver for an agent's system status (live when detected, static otherwise). */
export function useAgentStatus(): (id: AgentId) => AgentSystemStatus {
  const { statuses } = useContext(AgentStatusContext);
  return (id) => statuses?.[id] ?? AGENT_STATUS[id];
}

/** True once real detection results have loaded from the backend. */
export function useAgentStatusLive(): boolean {
  return useContext(AgentStatusContext).live;
}
