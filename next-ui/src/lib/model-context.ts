/** Best-effort context-window sizes (in tokens) per model family, used by the
 *  composer's context gauge to show how full the window is. Matched by name
 *  because the agents report free-form model ids; returns undefined when the
 *  model is unknown (or "default", where the concrete model isn't resolved
 *  client-side) so the gauge degrades to a plain token count. */
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
