import { agentRunPluginById, defineAgentRunPlugin, type AgentRunPlugin } from "./run-plugin";

type AgentRunAdapter<TContext> = Omit<AgentRunPlugin<TContext>, "id" | "runtime">;

export interface AgentRunAdapters<TContext> {
  readonly claudeCode: AgentRunAdapter<TContext>;
  readonly codex: AgentRunAdapter<TContext>;
  readonly gemini: AgentRunAdapter<TContext>;
  readonly openCode: AgentRunAdapter<TContext>;
}

export function createAgentRunPlugins<TContext>(adapters: AgentRunAdapters<TContext>): readonly AgentRunPlugin<TContext>[] {
  return [
    defineAgentRunPlugin<TContext>({
      id: "claude-code",
      runtime: "sdk",
      ...adapters.claudeCode,
    }),
    defineAgentRunPlugin<TContext>({
      id: "codex",
      runtime: "server",
      ...adapters.codex,
    }),
    defineAgentRunPlugin<TContext>({
      id: "gemini",
      runtime: "cli",
      ...adapters.gemini,
    }),
    defineAgentRunPlugin<TContext>({
      id: "opencode",
      runtime: "server",
      ...adapters.openCode,
    }),
  ];
}

export function createAgentRunPluginRegistry<TContext>(adapters: AgentRunAdapters<TContext>): ReadonlyMap<string, AgentRunPlugin<TContext>> {
  return agentRunPluginById(createAgentRunPlugins(adapters));
}
