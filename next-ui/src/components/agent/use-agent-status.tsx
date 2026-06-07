import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { makeAutoObservable, runInAction } from "mobx";
import { observer } from "mobx-react-lite";
import { AGENTS, AGENT_STATUS, STATIC_AGENT_CLI_INFO, type AgentCliInfo, type AgentCliMap, type AgentId, type AgentOption, type AgentSystemStatus } from "./agents";

type StatusMap = Partial<Record<AgentId, AgentSystemStatus>>;
type AgentApiValue = AgentSystemStatus | AgentCliInfo;
type AgentApiPayload = Partial<Record<AgentId, AgentApiValue>>;
const AGENT_STATUS_RETRY_MS = 15_000;

interface AgentStatusValue {
  readonly agents: AgentCliMap | null;
  readonly live: boolean;
  readonly strict: boolean;
  readonly error: string | null;
  readonly reload: () => void;
}

const AgentStatusContext = createContext<AgentStatusValue>({
  agents: STATIC_AGENT_CLI_INFO,
  live: false,
  strict: false,
  error: null,
  reload: () => undefined,
});

const AGENT_IDS = new Set<AgentId>(AGENTS.map((agent) => agent.id));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgentId(value: string): value is AgentId {
  return AGENT_IDS.has(value as AgentId);
}

function isAgentSystemStatus(value: unknown): value is AgentSystemStatus {
  return value === "available" || value === "running" || value === "needs-setup" || value === "unavailable" || value === "unsupported";
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isAgentOption(value: unknown): value is AgentOption {
  return isRecord(value) && typeof value.id === "string" && typeof value.label === "string" && (value.value === undefined || typeof value.value === "string");
}

function agentOptions(value: unknown): readonly AgentOption[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Array.isArray(value) && value.every(isAgentOption) ? value : undefined;
}

function isAgentCliInfo(value: unknown): value is AgentCliInfo {
  return (
    isRecord(value) &&
    isAgentSystemStatus(value.status) &&
    Array.isArray(value.bins) &&
    value.bins.every((item) => typeof item === "string") &&
    (typeof value.resolvedBin === "string" || value.resolvedBin === null) &&
    typeof value.runAdapter === "boolean" &&
    typeof value.selectable === "boolean" &&
    Array.isArray(value.env) &&
    value.env.every((item) => typeof item === "string") &&
    (typeof value.installCommand === "string" || value.installCommand === null) &&
    (value.models === undefined || agentOptions(value.models) !== undefined) &&
    (value.reasoning === undefined || agentOptions(value.reasoning) !== undefined) &&
    (value.modes === undefined || agentOptions(value.modes) !== undefined)
  );
}

function cliInfoFromStatus(id: AgentId, status: AgentSystemStatus): AgentCliInfo {
  const baseline = STATIC_AGENT_CLI_INFO[id];
  return {
    ...baseline,
    status,
    selectable: status !== "unavailable" && status !== "unsupported",
  };
}

function normalizeAgentPayload(payload: unknown): AgentCliMap {
  if (!isRecord(payload)) {
    throw new Error("Agent detection response is invalid.");
  }
  const result: AgentCliMap = {};
  for (const [id, value] of Object.entries(payload)) {
    if (!isAgentId(id)) {
      continue;
    }
    if (isAgentSystemStatus(value)) {
      result[id] = cliInfoFromStatus(id, value);
    } else if (isAgentCliInfo(value)) {
      result[id] = {
        ...value,
        bins: stringArray(value.bins),
        env: stringArray(value.env),
        models: agentOptions(value.models),
        reasoning: agentOptions(value.reasoning),
        modes: agentOptions(value.modes),
      };
    }
  }
  return result;
}

class AgentStatusStore {
  agents: AgentCliMap | null = null;

  error: string | null = null;

  loading = false;

  private requestId = 0;

  private retryTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  get live(): boolean {
    return this.agents != null;
  }

  setStatuses(statuses: StatusMap | null): void {
    this.agents = statuses
      ? Object.fromEntries(
          Object.entries(statuses).map(([id, status]) => [id, isAgentSystemStatus(status) && isAgentId(id) ? cliInfoFromStatus(id, status) : undefined]).filter((entry): entry is [string, AgentCliInfo] => entry[1] !== undefined),
        )
      : null;
  }

  cancel(): void {
    this.requestId += 1;
  }

  mount(): void {
    void this.reload();
    if (!this.retryTimer) {
      this.retryTimer = setInterval(() => {
        if (this.error && !this.loading) {
          void this.reload();
        }
      }, AGENT_STATUS_RETRY_MS);
    }
  }

  unmount(): void {
    this.cancel();
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }

  async reload(): Promise<void> {
    const requestId = this.requestId + 1;
    this.requestId = requestId;
    this.loading = true;
    this.error = null;

    try {
      const agents = await this.load();
      if (this.requestId === requestId) {
        runInAction(() => {
          this.agents = agents;
          this.error = null;
        });
      }
    } catch (error) {
      if (this.requestId === requestId) {
        runInAction(() => {
          this.agents = null;
          this.error = error instanceof Error ? error.message : String(error);
        });
      }
    } finally {
      if (this.requestId === requestId) {
        runInAction(() => {
          this.loading = false;
        });
      }
    }
  }

  private async load(): Promise<AgentCliMap> {
    const response = await fetch("/api/agents");
    if (!response.ok) {
      throw new Error(`Agent detection failed (${response.status})`);
    }
    return normalizeAgentPayload(await response.json());
  }
}

const AgentStatusProviderInner = observer(function AgentStatusProviderInner({
  children,
  store,
}: {
  readonly children: ReactNode;
  readonly store: AgentStatusStore;
}) {
  const reload = useMemo(() => () => {
    void store.reload();
  }, [store]);
  const value = useMemo<AgentStatusValue>(
    () => ({ agents: store.agents, live: store.live, strict: true, error: store.error, reload }),
    [reload, store.agents, store.error, store.live],
  );
  return <AgentStatusContext.Provider value={value}>{children}</AgentStatusContext.Provider>;
});

/**
 * Fetches real agent availability from the dev backend (`/api/agents`, served by
 * vite-agents-plugin) once on mount. The app provider does not invent live
 * statuses; direct component tests without the provider use the static registry.
 */
export function AgentStatusProvider({ children }: { readonly children: ReactNode }) {
  const [store] = useState(() => new AgentStatusStore());

  useEffect(() => {
    store.mount();
    return () => {
      store.unmount();
    };
  }, [store]);

  return <AgentStatusProviderInner store={store}>{children}</AgentStatusProviderInner>;
}

/** Returns a resolver for an agent's system status (live when detected, static otherwise). */
export function useAgentStatus(): (id: AgentId) => AgentSystemStatus {
  const { agents, live, strict } = useContext(AgentStatusContext);
  return (id) => agents?.[id]?.status ?? (live || strict ? "unavailable" : AGENT_STATUS[id]);
}

/** Returns CLI discovery metadata for an agent when available. */
export function useAgentCliInfo(): (id: AgentId) => AgentCliInfo | null {
  const { agents, live, strict } = useContext(AgentStatusContext);
  return (id) => agents?.[id] ?? (live || strict ? null : STATIC_AGENT_CLI_INFO[id]);
}

/** True once real detection results have loaded from the backend. */
export function useAgentStatusLive(): boolean {
  return useContext(AgentStatusContext).live;
}

/** Error from the live agent detection API, surfaced instead of silently falling back. */
export function useAgentStatusError(): string | null {
  return useContext(AgentStatusContext).error;
}

/** Retries the live agent detection API request. */
export function useReloadAgentStatus(): () => void {
  return useContext(AgentStatusContext).reload;
}
