import type { ModelInfo as AnthropicModelInfo } from "@anthropic-ai/sdk/resources/models";
import {
  claudeAgentModeId,
  claudeAgentNameFromMode,
  DEFAULT_AGENT_OPTION_ID,
  isDirectAgentModelValue,
  type AgentOption,
} from "../lib/agent-catalog";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const REASONING_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

function modelLabelFromValue(value: string): string {
  const leaf = value.split("/").filter(Boolean).at(-1) ?? value;
  const readableLeaf = leaf.replace(/-(\d+)-(\d+)(?=-|$)/g, "-$1.$2");
  return readableLeaf
    .split(/[-_]+/)
    .filter(Boolean)
    .map((token) => {
      const lower = token.toLowerCase();
      const known: Record<string, string> = {
        claude: "Claude",
        codex: "Codex",
        deepseek: "Deepseek",
        flash: "Flash",
        free: "Free",
        fast: "Fast",
        gpt: "GPT",
        haiku: "Haiku",
        mini: "Mini",
        minimax: "MiniMax",
        opus: "Opus",
        sonnet: "Sonnet",
      };
      if (known[lower]) {
        return known[lower];
      }
      if (/^\d+b$/i.test(token)) {
        return token.toUpperCase();
      }
      if (/^\d+(?:\.\d+)+$/.test(token)) {
        return token;
      }
      if (/^v\d/i.test(token)) {
        return `V${token.slice(1)}`;
      }
      if (/^qwen\d*/i.test(token)) {
        return `Qwen${token.slice(4)}`;
      }
      return `${token.slice(0, 1).toUpperCase()}${token.slice(1)}`;
    })
    .join(" ");
}

function reasoningOptionFromEffort(effort: string): AgentOption | null {
  const label = REASONING_LABELS[effort];
  return label ? { id: effort, label, value: effort } : null;
}

export function uniqueAgentOptions(options: readonly AgentOption[]): AgentOption[] {
  const seen = new Set<string>();
  const result: AgentOption[] = [];
  for (const option of options) {
    if (seen.has(option.id)) {
      continue;
    }
    seen.add(option.id);
    result.push(option);
  }
  return result;
}

const OPENCODE_INTERNAL_AGENT_IDS = new Set(["title", "compaction"]);
const CLAUDE_INTERNAL_AGENT_IDS = new Set(["statusline-setup"]);
const CLAUDE_STATIC_AGENT_IDS = new Set(["plan"]);

export function parseOpenCodeModelsOutput(output: string): AgentOption[] {
  return uniqueAgentOptions(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.includes("/") && isDirectAgentModelValue("opencode", line))
      .map((value) => ({ id: value, label: modelLabelFromValue(value), value })),
  );
}

export function parseOpenCodeAgentsOutput(output: string): AgentOption[] {
  return uniqueAgentOptions(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .map((line) => line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s+\((?:primary|subagent)\)/)?.[1] ?? null)
      .filter((id): id is string => id !== null && !OPENCODE_INTERNAL_AGENT_IDS.has(id))
      .map((id) => ({ id, label: modelLabelFromValue(id), value: id })),
  );
}

export function parseClaudeAgentsOutput(output: string): AgentOption[] {
  try {
    const parsed = JSON.parse(output) as unknown;
    if (Array.isArray(parsed)) {
      return uniqueAgentOptions(
        parsed
          .map((item): string | null => {
            if (typeof item === "string") {
              return item;
            }
            if (!isRecord(item)) {
              return null;
            }
            if (typeof item.name === "string") {
              return item.name;
            }
            if (typeof item.id === "string") {
              return item.id;
            }
            return null;
          })
          .filter(
            (id): id is string =>
              id !== null && !CLAUDE_INTERNAL_AGENT_IDS.has(id) && !CLAUDE_STATIC_AGENT_IDS.has(id.toLowerCase()) && claudeAgentNameFromMode(claudeAgentModeId(id)) !== null,
          )
          .map((id) => ({ id: claudeAgentModeId(id), label: modelLabelFromValue(id), value: id })),
      );
    }
  } catch {
    // Older Claude CLIs only print a text table.
  }
  return uniqueAgentOptions(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .map((line) => line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s+·\s+\S+/)?.[1] ?? null)
      .filter(
        (id): id is string =>
          id !== null && !CLAUDE_INTERNAL_AGENT_IDS.has(id) && !CLAUDE_STATIC_AGENT_IDS.has(id.toLowerCase()) && claudeAgentNameFromMode(claudeAgentModeId(id)) !== null,
      )
      .map((id) => ({ id: claudeAgentModeId(id), label: modelLabelFromValue(id), value: id })),
  );
}

export function parseCodexModelsOutput(output: string): { readonly models: readonly AgentOption[]; readonly reasoning: readonly AgentOption[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output) as unknown;
  } catch {
    return { models: [], reasoning: [] };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.models)) {
    return { models: [], reasoning: [] };
  }

  const models: AgentOption[] = [];
  const reasoning: AgentOption[] = [];
  const reasoningSeen = new Set<string>();
  for (const item of parsed.models) {
    if (!isRecord(item) || typeof item.slug !== "string" || !isDirectAgentModelValue("codex", item.slug)) {
      continue;
    }
    models.push({ id: item.slug, label: typeof item.display_name === "string" ? item.display_name : modelLabelFromValue(item.slug), value: item.slug });
    if (Array.isArray(item.supported_reasoning_levels)) {
      for (const level of item.supported_reasoning_levels) {
        if (!isRecord(level) || typeof level.effort !== "string" || reasoningSeen.has(level.effort)) {
          continue;
        }
        const option = reasoningOptionFromEffort(level.effort);
        if (option) {
          reasoningSeen.add(level.effort);
          reasoning.push(option);
        }
      }
    }
  }
  return { models: uniqueAgentOptions(models), reasoning };
}

const CLAUDE_CLI_MODEL_ALIASES = [
  { id: "fable", label: "Fable", markers: ["claude-fable-", "Fable 5"] },
  { id: "opus", label: "Opus", markers: ["claude-opus-", "Opus 4"] },
  { id: "sonnet", label: "Sonnet", markers: ["claude-sonnet-", "Sonnet 4"] },
  { id: "haiku", label: "Haiku", markers: ["claude-haiku-", "Haiku 4"] },
] as const;

export function parseClaudeCliModelAliasesSource(source: string): AgentOption[] {
  const models = CLAUDE_CLI_MODEL_ALIASES.filter((alias) => source.includes(alias.id) && alias.markers.some((marker) => source.includes(marker))).map((alias) => ({
    id: alias.id,
    label: alias.label,
    value: alias.id,
  }));
  return models.length > 0 ? [{ id: DEFAULT_AGENT_OPTION_ID, label: "Default" }, ...models] : [];
}

export function parseAnthropicModelInfos(models: readonly AnthropicModelInfo[]): AgentOption[] {
  return uniqueAgentOptions(
    models
      .filter((model) => isDirectAgentModelValue("claude-code", model.id))
      .map((model) => ({ id: model.id, label: model.display_name || modelLabelFromValue(model.id), value: model.id })),
  );
}

function skipJsWhitespaceAndComments(source: string, index: number): number {
  let i = index;
  while (i < source.length) {
    const char = source[i];
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (source.startsWith("//", i)) {
      const next = source.indexOf("\n", i + 2);
      i = next === -1 ? source.length : next + 1;
      continue;
    }
    if (source.startsWith("/*", i)) {
      const next = source.indexOf("*/", i + 2);
      i = next === -1 ? source.length : next + 2;
      continue;
    }
    break;
  }
  return i;
}

function extractJsObjectBody(source: string, openBraceIndex: number): { readonly body: string; readonly end: number } | null {
  if (source[openBraceIndex] !== "{") {
    return null;
  }
  let depth = 0;
  let quote: "\"" | "'" | "`" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = openBraceIndex; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
      }
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return { body: source.slice(openBraceIndex + 1, i), end: i + 1 };
      }
    }
  }
  return null;
}

function readJsObjectKey(source: string, index: number): { readonly key: string; readonly next: number } | null {
  const i = skipJsWhitespaceAndComments(source, index);
  const char = source[i];
  if (char === "\"" || char === "'") {
    let escaped = false;
    for (let j = i + 1; j < source.length; j += 1) {
      const current = source[j];
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === char) {
        return { key: source.slice(i + 1, j), next: j + 1 };
      }
    }
    return null;
  }
  const match = source.slice(i).match(/^([A-Za-z_$][A-Za-z0-9_$.-]*)/);
  return match ? { key: match[1], next: i + match[1].length } : null;
}

export function parseGeminiCliModelConfigSource(source: string): AgentOption[] {
  const options: AgentOption[] = [];
  let searchFrom = 0;
  while (searchFrom < source.length) {
    const keyIndex = source.indexOf("modelDefinitions", searchFrom);
    if (keyIndex === -1) {
      break;
    }
    searchFrom = keyIndex + "modelDefinitions".length;
    const colonIndex = source.indexOf(":", keyIndex);
    if (colonIndex === -1) {
      continue;
    }
    const openIndex = source.indexOf("{", colonIndex);
    if (openIndex === -1) {
      continue;
    }
    const definitions = extractJsObjectBody(source, openIndex);
    if (!definitions) {
      continue;
    }
    let entryIndex = 0;
    while (entryIndex < definitions.body.length) {
      const key = readJsObjectKey(definitions.body, entryIndex);
      if (!key) {
        break;
      }
      let valueIndex = skipJsWhitespaceAndComments(definitions.body, key.next);
      if (definitions.body[valueIndex] !== ":") {
        entryIndex = key.next + 1;
        continue;
      }
      valueIndex = skipJsWhitespaceAndComments(definitions.body, valueIndex + 1);
      if (definitions.body[valueIndex] !== "{") {
        entryIndex = valueIndex + 1;
        continue;
      }
      const value = extractJsObjectBody(definitions.body, valueIndex);
      if (!value) {
        break;
      }
      entryIndex = value.end + 1;
      if (!/\bisVisible\s*:\s*true\b/.test(value.body) || !isDirectAgentModelValue("gemini", key.key)) {
        continue;
      }
      const displayName = value.body.match(/\bdisplayName\s*:\s*["']([^"']+)["']/)?.[1];
      options.push({ id: key.key, label: displayName ?? modelLabelFromValue(key.key), value: key.key });
    }
  }
  return uniqueAgentOptions(options);
}
