import type { AgentAccessMode, AgentProfile } from "../../lib/agent-catalog";
import type { RunEvent } from "../../lib/run-event-accumulator";

export interface AgentRunRequest {
  readonly agent: string;
  readonly model: string;
  readonly reasoning: string;
  readonly mode: AgentProfile["mode"];
  readonly prompt: string;
  readonly accessMode: AgentAccessMode;
  /** CLI approval shortcut for agents where auto-confirm is a sandbox setting,
   *  not a chat work mode (Gemini `--approval-mode yolo`). */
  readonly autoConfirm?: boolean;
  /** Native session id to resume (same agent continuing the conversation). */
  readonly resume?: string;
  /** Server-assigned session id for a NEW session (agents that let us set it,
   *  e.g. Gemini `--session-id`). Agents that mint their own id ignore this. */
  readonly sessionId?: string;
  /** Auto-compact the conversation when its context window fills (Claude
   *  `autoCompactEnabled`). Defaults to true when unset. */
  readonly autoCompact?: boolean;
  /** Compaction window override in tokens (Claude `autoCompactWindow`); unset =
   *  the model's full context window. */
  readonly compactWindow?: number;
}

export type AgentStreamTranslator = (line: string) => RunEvent[];

export interface AgentRunPlugin<TContext = unknown> {
  readonly id: string;
  readonly runtime: "sdk" | "server" | "cli";
  readonly bin?: string;
  readonly env?: readonly string[];
  readonly buildArgs?: (request: AgentRunRequest) => readonly string[];
  readonly createTranslator?: () => AgentStreamTranslator;
  readonly run?: (request: AgentRunRequest, context: TContext) => void | Promise<void>;
}

export function defineAgentRunPlugin<TContext>(plugin: AgentRunPlugin<TContext>): AgentRunPlugin<TContext> {
  return plugin;
}

export function agentRunPluginById<TContext>(plugins: readonly AgentRunPlugin<TContext>[]): ReadonlyMap<string, AgentRunPlugin<TContext>> {
  return new Map(plugins.map((plugin) => [plugin.id, plugin]));
}
