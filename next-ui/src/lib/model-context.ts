import { DEFAULT_AGENT_OPTION_ID, resolveAgentModelValue, type AgentProfile } from "./agent-catalog";

/** Best-effort context-window sizes (in tokens) per model family, used for the
 *  composer over-limit compaction warning. Matched by name because the agents
 *  report free-form model ids; returns undefined when the model is unknown.
 *  Callers should resolve catalog "default" aliases before calling this. */
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
