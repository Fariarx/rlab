import { DEFAULT_AGENT_OPTION_ID, resolveAgentModelValue, type AgentProfile } from "./agent-catalog";

/** Best-effort context-window sizes (in tokens) per model family, used by the
 *  composer's context gauge to show how full the window is. Matched by name
 *  because the agents report free-form model ids; returns undefined when the
 *  model is unknown so the gauge is hidden rather than guessing. Callers should
 *  resolve catalog "default" aliases before calling this. */
const CONTEXT_WINDOWS: ReadonlyArray<readonly [RegExp, number]> = [
  [/sonnet.*\[1m\]|context-1m/i, 1_000_000],
  [/opus|sonnet|haiku|claude/i, 200_000],
  [/gemini/i, 1_000_000],
  [/gpt-5|codex|^o[0-9]/i, 272_000],
  [/deepseek|mimo|nemotron|qwen|kimi|big-pickle|grok/i, 256_000],
];

export function contextWindowForModel(model: string | undefined): number | undefined {
  if (!model || model === "default") {
    return undefined;
  }
  for (const [pattern, window] of CONTEXT_WINDOWS) {
    if (pattern.test(model)) {
      return window;
    }
  }
  return undefined;
}

export function contextWindowForAgentProfile(profile: AgentProfile): number | undefined {
  const model = resolveAgentModelValue(profile.agent, profile.model) ?? (profile.model === DEFAULT_AGENT_OPTION_ID ? profile.agent : profile.model);
  return contextWindowForModel(model);
}

export type ContextSeverity = "ok" | "warn" | "full";

/** Classify how full a context window is, for the composer gauge + over-limit
 *  warning. `warn` once ≥80% full; `full` at/past 100% — the conversation has
 *  outgrown the window and should be compacted. */
export function contextSeverity(ratio: number): ContextSeverity {
  if (ratio >= 1) {
    return "full";
  }
  if (ratio >= 0.8) {
    return "warn";
  }
  return "ok";
}

/** Compact token count for display, e.g. 152_340 → "152k", 1_240 → "1.2k". */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) {
    return String(tokens);
  }
  if (tokens < 100_000) {
    return `${(tokens / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  if (tokens < 1_000_000) {
    return `${Math.round(tokens / 1000)}k`;
  }
  return `${(tokens / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
}
