import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { query, type CanUseTool, type EffortLevel, type Options as ClaudeQueryOptions, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { chromium, type Browser, type BrowserContext, type ConsoleMessage, type Frame, type FrameLocator, type Locator, type Page, type Request as PlaywrightRequest } from "playwright";
import type { Plugin, ViteDevServer, PreviewServer } from "vite";
import { parseGitStatusPorcelain, parseNumstatTotals } from "./src/lib/git-status";
import { normalizeAgentToolOutput } from "./src/lib/agent-output";
import {
  cloneAppSettings,
  defaultAppSettings,
  isAgentAccessMode,
  isAppSettings,
  type AgentAccessMode,
  type Locale,
} from "./src/lib/app-settings";
import { buildEmptyWorkspaceState, buildInitialWorkspaceState, cloneWorkspaceState, type WorkspaceState } from "./src/lib/workspace-state";
import {
  agentProfileEquals,
  claudeAgentNameFromMode,
  claudeAgentModeId,
  DEFAULT_AGENT_OPTION_ID,
  getAgent,
  isDirectAgentModeValue,
  isDirectAgentModelValue,
  isAgentId,
  normalizeAgentProfile,
  resolveAgentModeValue,
  resolveAgentModelValue,
  resolveAgentReasoningValue,
  type AgentOption,
  type AgentProfile,
} from "./src/lib/agent-catalog";
import {
  type AgentBlock,
  type ChatMessage,
  type CodeBlockData,
  type ConversationStatus,
  type DiffBlock,
  type PlanBlock,
  type RunState,
  type RunUsage,
  type SearchBlock,
  type SuggestedActionsBlock,
} from "./src/components/agent/types";
import { pickDirectoryPathFromSystemDialog } from "./src/server/directory-picker";

export { parseGitStatusPorcelain } from "./src/lib/git-status";

/**
 * Real agent detection. Scans PATH (and required env vars) for each coding
 * agent's CLI and reports its status — the live stand-in for vibe-kanban's
 * executor discovery. Pure filesystem checks, no shell spawning (per AGENTS.md).
 *
 * Exposed at GET /api/agents during `vite dev` and `vite preview`.
 */
type AgentStatus = "available" | "running" | "needs-setup" | "unavailable" | "unsupported";

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
// Persisted workspace state lives under `.data/` next to the plugin by default.
// `RLAB_DATA_DIR` relocates it — useful when running the prod server as a
// service (point it at a writable data volume) and for isolating e2e runs.
const WORKSPACE_STATE_DIR = process.env.RLAB_DATA_DIR
  ? (isAbsolute(process.env.RLAB_DATA_DIR) ? process.env.RLAB_DATA_DIR : resolve(process.cwd(), process.env.RLAB_DATA_DIR))
  : join(PLUGIN_DIR, ".data");
const WORKSPACE_STATE_FILE = join(WORKSPACE_STATE_DIR, "workspace-state.json");
const WORKSPACE_STATE_LOCK_FILE = join(WORKSPACE_STATE_DIR, "workspace-state.lock");
const RUN_AUDIT_FILE = join(WORKSPACE_STATE_DIR, "run-audit.ndjson");
const ATTACHMENTS_DIR = join(WORKSPACE_STATE_DIR, "attachments");
const AMP_READ_ONLY_SETTINGS_FILE = join(WORKSPACE_STATE_DIR, "amp-read-only-settings.json");
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_JSON_BODY_BYTES = 40 * 1024 * 1024;
export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
export const BROWSER_ACTION_TIMEOUT_MS = 5000;
const BROWSER_EVAL_SCRIPT_MAX_CHARS = 8000;
const AGENT_CONFIG_FILE = join(WORKSPACE_STATE_DIR, "agent-config.json");

interface Detect {
  readonly bins: readonly string[];
  /** If set, at least one of these env vars must be present, else `needs-setup`. */
  readonly env?: readonly string[];
  /** Some CLIs, notably Codex, can be fully authenticated via local account state. */
  readonly hasAuth?: () => boolean;
}

interface AgentCliInfo {
  readonly status: AgentStatus;
  readonly bins: readonly string[];
  readonly resolvedBin: string | null;
  readonly runAdapter: boolean;
  readonly selectable: boolean;
  readonly env: readonly string[];
  readonly installCommand: string | null;
  readonly models?: readonly AgentOption[];
  readonly reasoning?: readonly AgentOption[];
  readonly modes?: readonly AgentOption[];
}

// Keys must match AgentId in src/components/agent/agents.ts.
const DETECT: Record<string, Detect> = {
  "claude-code": { bins: ["claude"] },
  codex: { bins: ["codex"], env: ["OPENAI_API_KEY", "CODEX_API_KEY"], hasAuth: hasCodexStoredAuth },
  gemini: { bins: ["gemini"], env: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_API_KEY"], hasAuth: hasGeminiStoredAuth },
  opencode: { bins: ["opencode"] },
};

const RUNNABLE_AGENT_IDS = new Set(["claude-code", "codex", "gemini", "opencode"]);

const INSTALL_COMMANDS: Partial<Record<string, readonly string[]>> = {
  "claude-code": ["npm", "install", "-g", "@anthropic-ai/claude-code@latest"],
  codex: ["npm", "install", "-g", "@openai/codex@latest"],
  gemini: ["npm", "install", "-g", "@google/gemini-cli@latest"],
  opencode: ["npm", "install", "-g", "opencode-ai@latest"],
};

// The in-app Preview tab uses Playwright's Chromium. Only the browser binary is
// installed on demand (the `playwright` package itself is always a dependency).
const PLAYWRIGHT_INSTALL_COMMAND = ["npx", "playwright", "install", "chromium"] as const;

function playwrightBrowserExecutablePath(): string | null {
  try {
    const path = chromium.executablePath();
    return typeof path === "string" && path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

/** True when Playwright's Chromium binary is present so the Preview tab can launch. */
export function isPlaywrightBrowserInstalled(): boolean {
  const path = playwrightBrowserExecutablePath();
  return path != null && existsSync(path);
}

export function visibleAgentDetectionIds(): readonly string[] {
  return Object.keys(DETECT);
}

export function installCommandForAgent(agent: string): readonly string[] | null {
  return INSTALL_COMMANDS[agent] ?? null;
}

export interface AgentSecretConfig {
  readonly env: Record<string, string>;
}

function readAgentSecretConfig(): AgentSecretConfig {
  if (!existsSync(AGENT_CONFIG_FILE)) {
    return { env: {} };
  }
  const parsed = JSON.parse(readFileSync(AGENT_CONFIG_FILE, "utf8").replace(/^\uFEFF/, "")) as unknown;
  if (!isRecord(parsed) || !isRecord(parsed.env)) {
    throw new Error(`${AGENT_CONFIG_FILE} does not contain a valid agent config.`);
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  return { env };
}

export function writeAgentSecretConfig(config: AgentSecretConfig, file = AGENT_CONFIG_FILE): void {
  writeJsonFileAtomic(file, config, 0o600);
}

function configuredEnvValueFrom(envName: string, config: AgentSecretConfig, env: NodeJS.ProcessEnv): string | undefined {
  return env[envName] ?? config.env[envName];
}

function codexHome(): string {
  return process.env.CODEX_HOME ?? join(homedir(), ".codex");
}

function hasCodexStoredAuth(): boolean {
  const authFile = join(codexHome(), "auth.json");
  if (!existsSync(authFile)) {
    return false;
  }
  try {
    const parsed = JSON.parse(readFileSync(authFile, "utf8").replace(/^\uFEFF/, "")) as unknown;
    if (!isRecord(parsed)) {
      return false;
    }
    if (typeof parsed.OPENAI_API_KEY === "string" && parsed.OPENAI_API_KEY.trim().length > 0) {
      return true;
    }
    if (parsed.auth_mode !== "chatgpt" || !isRecord(parsed.tokens)) {
      return false;
    }
    return typeof parsed.tokens.access_token === "string" && parsed.tokens.access_token.trim().length > 0 && typeof parsed.tokens.refresh_token === "string" && parsed.tokens.refresh_token.trim().length > 0;
  } catch {
    return false;
  }
}

function geminiHome(): string {
  return process.env.GEMINI_HOME ?? join(homedir(), ".gemini");
}

export function hasGeminiStoredAuthAt(home: string): boolean {
  const settingsFile = join(home, "settings.json");
  const oauthFile = join(home, "oauth_creds.json");
  if (!existsSync(settingsFile) || !existsSync(oauthFile)) {
    return false;
  }
  try {
    const settings = JSON.parse(readFileSync(settingsFile, "utf8").replace(/^\uFEFF/, "")) as unknown;
    const oauth = JSON.parse(readFileSync(oauthFile, "utf8").replace(/^\uFEFF/, "")) as unknown;
    if (!isRecord(settings) || !isRecord(oauth)) {
      return false;
    }
    const security = isRecord(settings.security) ? settings.security : null;
    const auth = security && isRecord(security.auth) ? security.auth : null;
    if (auth?.selectedType !== "oauth-personal") {
      return false;
    }
    return (
      typeof oauth.access_token === "string" &&
      oauth.access_token.trim().length > 0 &&
      typeof oauth.refresh_token === "string" &&
      oauth.refresh_token.trim().length > 0
    );
  } catch {
    return false;
  }
}

function hasGeminiStoredAuth(): boolean {
  return hasGeminiStoredAuthAt(geminiHome());
}

function hasConfiguredAgentAuth(detect: Detect, config: AgentSecretConfig, env: NodeJS.ProcessEnv = process.env): boolean {
  if (detect.env?.some((name) => configuredEnvValueFrom(name, config, env))) {
    return true;
  }
  return detect.hasAuth?.() === true;
}

export function agentStatusForDetection(detect: Detect, found: boolean, config: AgentSecretConfig, env: NodeJS.ProcessEnv = process.env): AgentStatus {
  if (!found) {
    return "unavailable";
  }
  if (detect.env && !hasConfiguredAgentAuth(detect, config, env)) {
    return "needs-setup";
  }
  return "available";
}

export function resolveBinOnPath(bin: string, pathValue = process.env.PATH ?? "", platform: NodeJS.Platform = process.platform): string | null {
  const dirs = pathValue.split(delimiter).filter(Boolean);
  const exts = platform === "win32" ? [".cmd", ".exe", ".bat", ""] : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, bin + ext);
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        // ignore unreadable PATH entries
      }
    }
  }
  return null;
}

export function shouldUseShellForBin(resolvedBin: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32" && /\.(?:cmd|bat)$/i.test(resolvedBin);
}

function quoteWindowsCommandArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function windowsCommandLine(resolvedBin: string, args: readonly string[]): string {
  return [resolvedBin, ...args].map(quoteWindowsCommandArg).join(" ");
}

function npmShimScriptPath(shim: string): string | null {
  // Shim paths are written with Windows separators (`%dp0%\...`); normalize to
  // forward slashes so basename/join behave consistently on any host.
  const matches = [...shim.matchAll(/"%dp0%\\([^"]+)"/gi)].map((match) => match[1]?.replace(/\\/g, "/")).filter((value): value is string => typeof value === "string" && value.length > 0);
  return matches.find((script) => !/^node(?:\.exe)?$/i.test(basename(script))) ?? null;
}

export function resolveLaunchCommand(resolvedBin: string, args: readonly string[], platform: NodeJS.Platform = process.platform): { readonly command: string; readonly args: readonly string[] } {
  if (!shouldUseShellForBin(resolvedBin, platform)) {
    return { command: resolvedBin, args };
  }
  const baseDir = dirname(resolvedBin);
  try {
    const shim = readFileSync(resolvedBin, "utf8");
    const script = npmShimScriptPath(shim);
    if (script) {
      const node = join(baseDir, "node.exe");
      return {
        command: existsSync(node) ? node : "node",
        args: [join(baseDir, script), ...args],
      };
    }
  } catch {
    // Fall through to cmd.exe for non-npm command shims.
  }
  return { command: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", windowsCommandLine(resolvedBin, args)] };
}

export function resolveInstallLaunch(installCommand: readonly string[], pathValue = process.env.PATH ?? "", platform: NodeJS.Platform = process.platform): { readonly command: string; readonly args: readonly string[]; readonly displayCommand: string } | null {
  const resolvedBin = resolveBinOnPath(installCommand[0], pathValue, platform);
  if (!resolvedBin) {
    return null;
  }
  return { ...resolveLaunchCommand(resolvedBin, installCommand.slice(1), platform), displayCommand: installCommand.join(" ") };
}

export function resolveAgentInstallLaunch(agent: string, pathValue = process.env.PATH ?? "", platform: NodeJS.Platform = process.platform): { readonly command: string; readonly args: readonly string[]; readonly displayCommand: string } | null {
  const installCommand = installCommandForAgent(agent);
  if (!installCommand) {
    return null;
  }
  return resolveInstallLaunch(installCommand, pathValue, platform);
}

function spawnResolvedBin(resolvedBin: string, args: readonly string[], options: NonNullable<Parameters<typeof spawn>[2]>): ReturnType<typeof spawn> {
  const launch = resolveLaunchCommand(resolvedBin, args);
  return spawn(launch.command, launch.args, options);
}

const MODEL_DISCOVERY_TIMEOUT_MS = 5_000;
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

function uniqueAgentOptions(options: readonly AgentOption[]): AgentOption[] {
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

function runResolvedBinText(resolvedBin: string, args: readonly string[]): string | null {
  const launch = resolveLaunchCommand(resolvedBin, args);
  const result = spawnSync(launch.command, launch.args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: MODEL_DISCOVERY_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") {
    return null;
  }
  const output = result.stdout.trim();
  return output.length > 0 ? output : null;
}

function discoveredAgentOptions(id: string, resolvedBin: string | null): Pick<AgentCliInfo, "models" | "reasoning" | "modes"> {
  if (!resolvedBin) {
    return {};
  }
  if (id === "opencode") {
    const modelOutput = runResolvedBinText(resolvedBin, ["models"]);
    const agentOutput = runResolvedBinText(resolvedBin, ["agent", "list"]);
    const models = modelOutput ? parseOpenCodeModelsOutput(modelOutput) : [];
    const modes = agentOutput ? parseOpenCodeAgentsOutput(agentOutput) : [];
    return {
      ...(models.length > 0 ? { models } : {}),
      ...(modes.length > 0 ? { modes } : {}),
    };
  }
  if (id === "claude-code") {
    const agentOutput = runResolvedBinText(resolvedBin, ["agents"]);
    const modes = agentOutput ? parseClaudeAgentsOutput(agentOutput) : [];
    return modes.length > 0 ? { modes } : {};
  }
  if (id === "codex") {
    const output = runResolvedBinText(resolvedBin, ["debug", "models"]);
    const parsed = output ? parseCodexModelsOutput(output) : { models: [], reasoning: [] };
    return {
      ...(parsed.models.length > 0 ? { models: parsed.models } : {}),
      ...(parsed.reasoning.length > 0 ? { reasoning: parsed.reasoning } : {}),
    };
  }
  return {};
}

function resolvedDetectBin(detect: Detect, pathValue = process.env.PATH ?? "", platform: NodeJS.Platform = process.platform): string | null {
  for (const bin of detect.bins) {
    const resolved = resolveBinOnPath(bin, pathValue, platform);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

export function agentCliInfoForDetection(
  id: string,
  detect: Detect,
  config: AgentSecretConfig,
  env: NodeJS.ProcessEnv = process.env,
  pathValue = process.env.PATH ?? "",
  platform: NodeJS.Platform = process.platform,
): AgentCliInfo {
  const resolvedBin = resolvedDetectBin(detect, pathValue, platform);
  const found = resolvedBin !== null;
  const runAdapter = RUNNABLE_AGENT_IDS.has(id);
  const status = found && !runAdapter ? "unsupported" : agentStatusForDetection(detect, found, config, env);
  return {
    status,
    bins: detect.bins,
    resolvedBin,
    runAdapter,
    selectable: status !== "unavailable" && status !== "unsupported",
    env: detect.env ?? [],
    installCommand: installCommandForAgent(id)?.join(" ") ?? null,
    ...discoveredAgentOptions(id, resolvedBin),
  };
}

function detectAgents(): Record<string, AgentCliInfo> {
  const result: Record<string, AgentCliInfo> = {};
  const config = readAgentSecretConfig();
  for (const [id, cfg] of Object.entries(DETECT)) {
    result[id] = agentCliInfoForDetection(id, cfg, config);
  }
  return result;
}

/* --------------------------- Server workspace state -------------------------- */

export interface JsonBodyAccumulator {
  readonly body: string;
  readonly bytes: number;
}

function jsonBodyTooLargeMessage(maxBytes: number): string {
  return `JSON request body exceeds ${maxBytes} bytes.`;
}

export function appendJsonBodyChunk(accumulator: JsonBodyAccumulator, chunk: Buffer | string, maxBytes = MAX_JSON_BODY_BYTES): JsonBodyAccumulator {
  const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  const bytes = accumulator.bytes + Buffer.byteLength(text, "utf8");
  if (bytes > maxBytes) {
    throw new Error(jsonBodyTooLargeMessage(maxBytes));
  }
  return { body: accumulator.body + text, bytes };
}

export function jsonBodyReadErrorStatus(error: unknown): 413 | 500 {
  return /^JSON request body exceeds \d+ bytes\.$/.test(errorMessage(error)) ? 413 : 500;
}

function readJsonBody(req: IncomingMessage, res: ServerResponse, onDone: (body: string) => void): void {
  let accumulator: JsonBodyAccumulator = { body: "", bytes: 0 };
  let finished = false;
  req.on("data", (chunk: Buffer | string) => {
    if (finished) {
      return;
    }
    try {
      accumulator = appendJsonBodyChunk(accumulator, chunk);
    } catch (error) {
      finished = true;
      sendJson(res, jsonBodyReadErrorStatus(error), { error: errorMessage(error) });
    }
  });
  req.on("end", () => {
    if (finished) {
      return;
    }
    finished = true;
    onDone(accumulator.body);
  });
  req.on("error", (error) => {
    if (finished) {
      return;
    }
    finished = true;
    sendJson(res, jsonBodyReadErrorStatus(error), { error: errorMessage(error) });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface BrowserSessionPayload {
  readonly sessionId: string;
  readonly url: string;
}

export interface BrowserStorageSnapshot {
  readonly localStorage: Record<string, string>;
  readonly sessionStorage: Record<string, string>;
}

export interface BrowserSyncPayload extends BrowserSessionPayload, BrowserStorageSnapshot {}

export interface BrowserDirtyPayload {
  readonly sessionId: string;
  readonly reason: string;
  readonly url?: string;
}

type BrowserActionRole = Parameters<Page["getByRole"]>[0];
type BrowserWaitForState = "visible" | "hidden" | "attached" | "detached";

interface BrowserActionFrameTarget {
  readonly framePath?: readonly string[];
}

export type BrowserActionTarget =
  | (BrowserActionFrameTarget & { readonly selector: string })
  | (BrowserActionFrameTarget & { readonly role: BrowserActionRole; readonly name?: string })
  | (BrowserActionFrameTarget & { readonly text: string })
  | (BrowserActionFrameTarget & { readonly label: string });

export type BrowserActionPayload =
  | { readonly sessionId: string; readonly tabId?: string; readonly type: "navigate"; readonly url: string }
  | { readonly sessionId: string; readonly tabId?: string; readonly type: "go-back" }
  | { readonly sessionId: string; readonly tabId?: string; readonly type: "go-forward" }
  | { readonly sessionId: string; readonly tabId?: string; readonly type: "refresh" }
  | { readonly sessionId: string; readonly tabId?: string; readonly type: "scroll"; readonly deltaY: number; readonly target?: BrowserActionTarget }
  | ({ readonly sessionId: string; readonly tabId?: string; readonly type: "click" } & ({ readonly x: number; readonly y: number } | { readonly target: BrowserActionTarget }))
  | { readonly sessionId: string; readonly tabId?: string; readonly type: "fill"; readonly text: string; readonly target: BrowserActionTarget }
  | { readonly sessionId: string; readonly tabId?: string; readonly type: "clear"; readonly target: BrowserActionTarget }
  | { readonly sessionId: string; readonly tabId?: string; readonly type: "check"; readonly target: BrowserActionTarget }
  | { readonly sessionId: string; readonly tabId?: string; readonly type: "uncheck"; readonly target: BrowserActionTarget }
  | ({ readonly sessionId: string; readonly tabId?: string; readonly type: "select"; readonly target: BrowserActionTarget } & ({ readonly value: string } | { readonly label: string }))
  | ({ readonly sessionId: string; readonly tabId?: string; readonly type: "wait-for" } & ({ readonly target: BrowserActionTarget; readonly state: BrowserWaitForState } | { readonly urlIncludes: string }))
  | { readonly sessionId: string; readonly tabId?: string; readonly type: "hover"; readonly target: BrowserActionTarget }
  | { readonly sessionId: string; readonly tabId?: string; readonly type: "type"; readonly text: string; readonly selector?: string; readonly target?: BrowserActionTarget }
  | { readonly sessionId: string; readonly tabId?: string; readonly type: "press"; readonly key: string; readonly target?: BrowserActionTarget }
  | { readonly sessionId: string; readonly tabId?: string; readonly type: "eval"; readonly script: string }
  | { readonly sessionId: string; readonly tabId: string; readonly type: "select-tab" };

export interface BrowserPreviewTab {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly active: boolean;
}

export type BrowserPreviewEventType =
  | "session.created"
  | "tab.created"
  | "tab.selected"
  | "tab.closed"
  | "navigation.started"
  | "navigation.done"
  | "action.navigate"
  | "action.go-back"
  | "action.go-forward"
  | "action.refresh"
  | "action.scroll"
  | "action.click"
  | "action.fill"
  | "action.clear"
  | "action.check"
  | "action.uncheck"
  | "action.select"
  | "action.wait-for"
  | "action.hover"
  | "action.type"
  | "action.press"
  | "action.eval"
  | "action.failed"
  | "console.error"
  | "page.error"
  | "network.failed";

export interface BrowserPreviewEvent {
  readonly id: number;
  readonly sessionId: string;
  readonly tabId: string;
  readonly type: BrowserPreviewEventType;
  readonly label: string;
  readonly detail?: string;
  readonly url?: string;
  readonly title?: string;
  readonly point?: { readonly x: number; readonly y: number };
  readonly deltaY?: number;
  readonly target?: BrowserActionTarget;
  readonly selector?: string;
  readonly text?: string;
  readonly key?: string;
  readonly script?: string;
  readonly at: string;
}

export type BrowserPreviewFreshness = "synced" | "dirty" | "blocked" | "syncing" | "error";

export interface BrowserPreviewActionResult {
  readonly ok: boolean;
  readonly action: BrowserActionPayload["type"];
  readonly target?: string;
  readonly value?: unknown;
  readonly text?: string;
  readonly error?: string;
  readonly activeElement?: BrowserPreviewActiveElement;
}

export interface BrowserPreviewActiveElement {
  readonly tag: string;
  readonly role?: string;
  readonly label?: string;
  readonly text: string;
}

export interface BrowserPreviewSnapshot {
  readonly sessionId: string;
  readonly activeTabId: string;
  readonly tabs: readonly BrowserPreviewTab[];
  readonly latestEvent?: BrowserPreviewEvent;
  readonly freshness: BrowserPreviewFreshness;
  readonly freshnessReason?: string;
  readonly url: string;
  readonly title: string;
  readonly screenshot: string;
  readonly viewport: {
    readonly width: number;
    readonly height: number;
  };
  readonly updatedAt: string;
}

export interface BrowserPreviewState {
  readonly sessionId: string;
  readonly activeTabId: string;
  readonly tabs: readonly BrowserPreviewTab[];
  readonly latestEvent?: BrowserPreviewEvent;
  readonly freshness: BrowserPreviewFreshness;
  readonly freshnessReason?: string;
  readonly url: string;
  readonly title: string;
  readonly domTargets: readonly BrowserPreviewDomTarget[];
  readonly actionResult?: BrowserPreviewActionResult;
  readonly viewport: {
    readonly width: number;
    readonly height: number;
  };
  readonly updatedAt: string;
}

export interface BrowserPreviewDomTarget {
  readonly framePath?: readonly string[];
  readonly selector: string;
  readonly tag: string;
  readonly role?: string;
  readonly label?: string;
  readonly text: string;
  readonly href?: string;
  readonly testId?: string;
  readonly ariaName?: string;
  readonly editable?: boolean;
  readonly disabled?: boolean;
  readonly visible?: boolean;
  readonly value?: string;
  readonly checked?: boolean;
  readonly selectedOptions?: readonly string[];
  readonly placeholder?: string;
  readonly ordinal?: number;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

interface BrowserPreviewSession {
  readonly id: string;
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly pages: Map<string, Page>;
  readonly pageIds: Map<Page, string>;
  readonly events: BrowserPreviewEvent[];
  readonly clients: Set<ServerResponse>;
  activeTabId: string;
  nextTabId: number;
  nextEventId: number;
  lastActiveAt: number;
  freshness: BrowserPreviewFreshness;
  freshnessReason?: string;
  dirtyUrl?: string;
}

const BROWSER_PREVIEW_VIEWPORT = { width: 1280, height: 720 } as const;
const BROWSER_PREVIEW_EVENT_LIMIT = 80;
const BROWSER_PREVIEW_SESSION_ID_PATTERN = /^[a-zA-Z0-9_.:-]{1,160}$/;
// A session with no connected viewers (SSE clients) is closed after this idle
// window so headless Chromium processes don't leak. Swept lazily on each
// ensureBrowserPreviewSession() — no module-level timer (that would keep the
// test process alive and hang CI; see AGENTS.md).
const BROWSER_PREVIEW_IDLE_MS = 5 * 60_000;
let browserPreviewSessions = new Map<string, BrowserPreviewSession>();

function sweepIdleBrowserPreviewSessions(now: number): void {
  for (const [id, session] of browserPreviewSessions) {
    if (session.clients.size === 0 && now - session.lastActiveAt > BROWSER_PREVIEW_IDLE_MS) {
      browserPreviewSessions.delete(id);
      void session.browser.close().catch(() => undefined);
    }
  }
}

function normalizeBrowserPreviewSessionId(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    throw new Error("Browser session id is required.");
  }
  if (!BROWSER_PREVIEW_SESSION_ID_PATTERN.test(raw)) {
    throw new Error("Browser session id must contain only letters, numbers, dots, colons, underscores, and dashes.");
  }
  return raw;
}

function optionalBrowserPreviewTabId(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    throw new Error("Browser tab id must be a non-empty string.");
  }
  return raw;
}

function normalizeBrowserPreviewUrl(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    throw new Error("Browser URL is required.");
  }
  if (raw.toLowerCase() === "about:blank") {
    return "about:blank";
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Browser URL must be an absolute http(s) URL or about:blank.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Browser URL must be an absolute http(s) URL or about:blank.");
  }
  return parsed.toString();
}

export function parseBrowserSessionPayload(body: string): BrowserSessionPayload {
  const parsed = parseJsonObjectPayload(body, "Invalid browser session payload.");
  return { sessionId: normalizeBrowserPreviewSessionId(parsed.sessionId), url: normalizeBrowserPreviewUrl(parsed.url) };
}

function parseBrowserStoragePayload(value: unknown): Record<string, string> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error("Browser storage payload must be an object.");
  }
  const result: Record<string, string> = {};
  for (const [key, storageValue] of Object.entries(value)) {
    if (typeof storageValue !== "string") {
      throw new Error("Browser storage values must be strings.");
    }
    result[key] = storageValue;
  }
  return result;
}

export function parseBrowserSyncPayload(body: string): BrowserSyncPayload {
  const parsed = parseJsonObjectPayload(body, "Invalid browser sync payload.");
  return {
    sessionId: normalizeBrowserPreviewSessionId(parsed.sessionId),
    url: normalizeBrowserPreviewUrl(parsed.url),
    localStorage: parseBrowserStoragePayload(parsed.localStorage),
    sessionStorage: parseBrowserStoragePayload(parsed.sessionStorage),
  };
}

export function parseBrowserDirtyPayload(body: string): BrowserDirtyPayload {
  const parsed = parseJsonObjectPayload(body, "Invalid browser dirty payload.");
  const reason = optionalNonEmptyString(parsed.reason);
  if (!reason) {
    throw new Error("Browser dirty reason is required.");
  }
  const url = parsed.url === undefined ? undefined : normalizeBrowserPreviewUrl(parsed.url);
  return {
    sessionId: normalizeBrowserPreviewSessionId(parsed.sessionId),
    reason,
    ...(url ? { url } : {}),
  };
}

function optionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalBrowserActionFramePath(value: unknown): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("Browser action framePath must be an array of selectors.");
  }
  const framePath = value.map((item) => (typeof item === "string" ? item.trim() : ""));
  if (framePath.some((item) => item.length === 0)) {
    throw new Error("Browser action framePath selectors must be non-empty strings.");
  }
  return framePath;
}

function parseBrowserActionTarget(value: unknown): BrowserActionTarget | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error("Browser action target must be an object.");
  }
  const selector = optionalNonEmptyString(value.selector);
  const role = optionalNonEmptyString(value.role);
  const text = optionalNonEmptyString(value.text);
  const label = optionalNonEmptyString(value.label);
  const framePath = optionalBrowserActionFramePath(value.framePath);
  const frameTarget = framePath ? { framePath } : {};
  const locatorCount = [selector, role, text, label].filter((item) => item !== undefined).length;
  if (locatorCount !== 1) {
    throw new Error("Browser action target must include exactly one locator.");
  }
  if (selector) {
    return { ...frameTarget, selector };
  }
  if (role) {
    const name = optionalNonEmptyString(value.name);
    return name ? { ...frameTarget, role: role as BrowserActionRole, name } : { ...frameTarget, role: role as BrowserActionRole };
  }
  if (text) {
    return { ...frameTarget, text };
  }
  if (label) {
    return { ...frameTarget, label };
  }
  throw new Error("Browser action target must include exactly one locator.");
}

function requireBrowserActionTarget(value: unknown, message: string): BrowserActionTarget {
  const target = parseBrowserActionTarget(value);
  if (!target) {
    throw new Error(message);
  }
  return target;
}

function parseBrowserWaitForState(value: unknown): BrowserWaitForState {
  const state = optionalNonEmptyString(value) ?? "visible";
  if (state === "visible" || state === "hidden" || state === "attached" || state === "detached") {
    return state;
  }
  throw new Error("Browser wait-for state must be visible, hidden, attached, or detached.");
}

export function parseBrowserActionPayload(body: string): BrowserActionPayload {
  const parsed = parseJsonObjectPayload(body, "Invalid browser action payload.");
  const type = typeof parsed.type === "string" ? parsed.type.trim() : "";
  const sessionId = normalizeBrowserPreviewSessionId(parsed.sessionId);
  const tabId = optionalBrowserPreviewTabId(parsed.tabId);
  if (!type) {
    throw new Error("Browser action type is required.");
  }
  if (type === "navigate") {
    return { sessionId, tabId, type: "navigate", url: normalizeBrowserPreviewUrl(parsed.url) };
  }
  if (type === "go-back") {
    return { sessionId, tabId, type: "go-back" };
  }
  if (type === "go-forward") {
    return { sessionId, tabId, type: "go-forward" };
  }
  if (type === "refresh") {
    return { sessionId, tabId, type: "refresh" };
  }
  if (type === "scroll") {
    if (typeof parsed.deltaY !== "number" || !Number.isFinite(parsed.deltaY)) {
      throw new Error("Browser scroll deltaY is required.");
    }
    const target = parseBrowserActionTarget(parsed.target);
    return target ? { sessionId, tabId, type: "scroll", deltaY: parsed.deltaY, target } : { sessionId, tabId, type: "scroll", deltaY: parsed.deltaY };
  }
  if (type === "click") {
    const target = parseBrowserActionTarget(parsed.target);
    const x = typeof parsed.x === "number" && Number.isFinite(parsed.x) ? parsed.x : undefined;
    const y = typeof parsed.y === "number" && Number.isFinite(parsed.y) ? parsed.y : undefined;
    const hasPoint = x !== undefined && y !== undefined;
    if (target && hasPoint) {
      throw new Error("Browser click must use either target or x and y.");
    }
    if (target) {
      return { sessionId, tabId, type: "click", target };
    }
    if (!hasPoint) {
      throw new Error("Browser click target or x and y are required.");
    }
    return { sessionId, tabId, type: "click", x, y };
  }
  if (type === "fill") {
    if (typeof parsed.text !== "string") {
      throw new Error("Browser fill text is required.");
    }
    return { sessionId, tabId, type: "fill", text: parsed.text, target: requireBrowserActionTarget(parsed.target, "Browser fill target is required.") };
  }
  if (type === "clear") {
    return { sessionId, tabId, type: "clear", target: requireBrowserActionTarget(parsed.target, "Browser clear target is required.") };
  }
  if (type === "check") {
    return { sessionId, tabId, type: "check", target: requireBrowserActionTarget(parsed.target, "Browser check target is required.") };
  }
  if (type === "uncheck") {
    return { sessionId, tabId, type: "uncheck", target: requireBrowserActionTarget(parsed.target, "Browser uncheck target is required.") };
  }
  if (type === "select") {
    const target = requireBrowserActionTarget(parsed.target, "Browser select target is required.");
    const value = optionalNonEmptyString(parsed.value);
    const label = optionalNonEmptyString(parsed.label);
    if (value && label) {
      throw new Error("Browser select must use either value or label.");
    }
    if (value) {
      return { sessionId, tabId, type: "select", target, value };
    }
    if (label) {
      return { sessionId, tabId, type: "select", target, label };
    }
    throw new Error("Browser select value or label is required.");
  }
  if (type === "wait-for") {
    const target = parseBrowserActionTarget(parsed.target);
    const urlIncludes = optionalNonEmptyString(parsed.urlIncludes);
    if (target && urlIncludes) {
      throw new Error("Browser wait-for must use either target or urlIncludes.");
    }
    if (target) {
      return { sessionId, tabId, type: "wait-for", target, state: parseBrowserWaitForState(parsed.state) };
    }
    if (urlIncludes) {
      return { sessionId, tabId, type: "wait-for", urlIncludes };
    }
    throw new Error("Browser wait-for target or urlIncludes is required.");
  }
  if (type === "hover") {
    return { sessionId, tabId, type: "hover", target: requireBrowserActionTarget(parsed.target, "Browser hover target is required.") };
  }
  if (type === "type") {
    if (typeof parsed.text !== "string" || parsed.text.length === 0) {
      throw new Error("Browser type text is required.");
    }
    const target = parseBrowserActionTarget(parsed.target);
    const selector = optionalNonEmptyString(parsed.selector);
    if (target && selector) {
      throw new Error("Browser type target must be provided only once.");
    }
    if (target) {
      return { sessionId, tabId, type: "type", text: parsed.text, target };
    }
    return selector ? { sessionId, tabId, type: "type", text: parsed.text, selector } : { sessionId, tabId, type: "type", text: parsed.text };
  }
  if (type === "press") {
    if (typeof parsed.key !== "string" || parsed.key.trim().length === 0) {
      throw new Error("Browser key is required.");
    }
    const target = parseBrowserActionTarget(parsed.target);
    return target ? { sessionId, tabId, type: "press", key: parsed.key.trim(), target } : { sessionId, tabId, type: "press", key: parsed.key.trim() };
  }
  if (type === "eval") {
    if (typeof parsed.script !== "string" || parsed.script.trim().length === 0) {
      throw new Error("Browser eval script is required.");
    }
    if (parsed.script.length > BROWSER_EVAL_SCRIPT_MAX_CHARS) {
      throw new Error(`Browser eval script must be ${BROWSER_EVAL_SCRIPT_MAX_CHARS} characters or less.`);
    }
    return { sessionId, tabId, type: "eval", script: parsed.script };
  }
  if (type === "select-tab") {
    if (!tabId) {
      throw new Error("Browser tab id is required.");
    }
    return { sessionId, tabId, type: "select-tab" };
  }
  throw new Error(`Unsupported browser action '${type}'.`);
}

const browserPreviewBadRequestMessages = new Set([
  "Invalid browser session payload.",
  "Invalid browser sync payload.",
  "Invalid browser dirty payload.",
  "Invalid browser action payload.",
  "Browser session id is required.",
  "Browser session id must contain only letters, numbers, dots, colons, underscores, and dashes.",
  "Browser tab id must be a non-empty string.",
  "Browser tab id is required.",
  "Browser dirty reason is required.",
  "Browser URL is required.",
  "Browser URL must be an absolute http(s) URL or about:blank.",
  "Browser storage payload must be an object.",
  "Browser storage values must be strings.",
  "Browser action type is required.",
  "Browser scroll deltaY is required.",
  "Browser click x and y are required.",
  "Browser click target or x and y are required.",
  "Browser click must use either target or x and y.",
  "Browser action target must be an object.",
  "Browser action target must include exactly one locator.",
  "Browser action framePath must be an array of selectors.",
  "Browser action framePath selectors must be non-empty strings.",
  "Browser fill text is required.",
  "Browser fill target is required.",
  "Browser clear target is required.",
  "Browser check target is required.",
  "Browser uncheck target is required.",
  "Browser select target is required.",
  "Browser select must use either value or label.",
  "Browser select value or label is required.",
  "Browser wait-for state must be visible, hidden, attached, or detached.",
  "Browser wait-for must use either target or urlIncludes.",
  "Browser wait-for target or urlIncludes is required.",
  "Browser hover target is required.",
  "Browser type text is required.",
  "Browser type target must be provided only once.",
  "Browser key is required.",
  "Browser eval script is required.",
  `Browser eval script must be ${BROWSER_EVAL_SCRIPT_MAX_CHARS} characters or less.`,
]);

function browserPreviewErrorStatus(error: unknown): 400 | 500 {
  const message = errorMessage(error);
  return error instanceof SyntaxError ||
    browserPreviewBadRequestMessages.has(message) ||
    message.startsWith("Unsupported browser action ") ||
    message.startsWith("Browser tab is not active:")
    ? 400
    : 500;
}

function trimBrowserPreviewEvents(events: BrowserPreviewEvent[]): void {
  if (events.length > BROWSER_PREVIEW_EVENT_LIMIT) {
    events.splice(0, events.length - BROWSER_PREVIEW_EVENT_LIMIT);
  }
}

function writeBrowserPreviewSseEvent(res: ServerResponse, event: BrowserPreviewEvent): void {
  res.write(`id: ${event.id}\n`);
  res.write("event: browser\n");
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function emitBrowserPreviewEvent(
  session: BrowserPreviewSession,
  input: Omit<BrowserPreviewEvent, "id" | "sessionId" | "at">,
): BrowserPreviewEvent {
  const event: BrowserPreviewEvent = {
    ...input,
    id: session.nextEventId,
    sessionId: session.id,
    at: new Date().toISOString(),
  };
  session.nextEventId += 1;
  session.events.push(event);
  trimBrowserPreviewEvents(session.events);
  for (const client of session.clients) {
    writeBrowserPreviewSseEvent(client, event);
  }
  return event;
}

async function browserPreviewPageTitle(page: Page): Promise<string> {
  if (page.isClosed()) {
    return "";
  }
  return page.title();
}

function emitBrowserPreviewPageEvent(session: BrowserPreviewSession, page: Page, type: BrowserPreviewEventType, label: string, detail?: string): void {
  const tabId = session.pageIds.get(page);
  if (!tabId || page.isClosed()) {
    return;
  }
  void (async () => {
    emitBrowserPreviewEvent(session, {
      tabId,
      type,
      label,
      detail,
      url: page.url(),
      title: await browserPreviewPageTitle(page),
    });
  })();
}

function registerBrowserPreviewPage(session: BrowserPreviewSession, page: Page): string {
  const existingId = session.pageIds.get(page);
  if (existingId) {
    return existingId;
  }
  const tabId = `tab-${session.nextTabId}`;
  session.nextTabId += 1;
  session.pages.set(tabId, page);
  session.pageIds.set(page, tabId);
  page.on("domcontentloaded", () => emitBrowserPreviewPageEvent(session, page, "navigation.done", "DOM loaded", page.url()));
  page.on("load", () => emitBrowserPreviewPageEvent(session, page, "navigation.done", "Page loaded", page.url()));
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") {
      emitBrowserPreviewPageEvent(session, page, "console.error", "Console error", message.text());
    }
  });
  page.on("pageerror", (error: Error) => emitBrowserPreviewPageEvent(session, page, "page.error", "Page error", error.message));
  page.on("requestfailed", (request: PlaywrightRequest) => {
    const failure = request.failure();
    emitBrowserPreviewPageEvent(session, page, "network.failed", "Network failed", `${request.method()} ${request.url()}${failure?.errorText ? ` · ${failure.errorText}` : ""}`);
  });
  page.on("close", () => {
    session.pages.delete(tabId);
    session.pageIds.delete(page);
    emitBrowserPreviewEvent(session, { tabId, type: "tab.closed", label: "Tab closed" });
    if (session.activeTabId === tabId) {
      session.activeTabId = session.pages.keys().next().value ?? "";
    }
  });
  emitBrowserPreviewEvent(session, { tabId, type: "tab.created", label: "Tab created", url: page.url() });
  return tabId;
}

function currentBrowserPreviewSession(sessionId: string): BrowserPreviewSession | null {
  const session = browserPreviewSessions.get(sessionId);
  if (!session) {
    return null;
  }
  if (!session.browser.isConnected()) {
    browserPreviewSessions.delete(sessionId);
    return null;
  }
  for (const [tabId, page] of session.pages) {
    if (page.isClosed()) {
      session.pages.delete(tabId);
      session.pageIds.delete(page);
    }
  }
  if (session.pages.size === 0) {
    browserPreviewSessions.delete(sessionId);
    void session.browser.close();
    return null;
  }
  if (!session.pages.has(session.activeTabId)) {
    session.activeTabId = session.pages.keys().next().value ?? "";
  }
  session.lastActiveAt = Date.now();
  return session;
}

async function ensureBrowserPreviewSession(sessionId: string): Promise<BrowserPreviewSession> {
  sweepIdleBrowserPreviewSessions(Date.now());
  const current = currentBrowserPreviewSession(sessionId);
  if (current) {
    return current;
  }
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: BROWSER_PREVIEW_VIEWPORT });
  const session: BrowserPreviewSession = {
    id: sessionId,
    browser,
    context,
    pages: new Map(),
    pageIds: new Map(),
    events: [],
    clients: new Set(),
    activeTabId: "",
    nextTabId: 1,
    nextEventId: 1,
    lastActiveAt: Date.now(),
    freshness: "synced",
  };
  context.on("page", (page) => {
    const tabId = registerBrowserPreviewPage(session, page);
    session.activeTabId = tabId;
  });
  const page = await context.newPage();
  const tabId = registerBrowserPreviewPage(session, page);
  session.activeTabId = tabId;
  browserPreviewSessions.set(sessionId, session);
  emitBrowserPreviewEvent(session, { tabId, type: "session.created", label: "Browser session created" });
  return session;
}

function browserPreviewPageFor(session: BrowserPreviewSession, tabId?: string): Page {
  const targetTabId = tabId ?? session.activeTabId;
  const page = session.pages.get(targetTabId);
  if (!page || page.isClosed()) {
    throw new Error(`Browser tab is not active: ${targetTabId || "-"}.`);
  }
  return page;
}

async function browserPreviewTabs(session: BrowserPreviewSession): Promise<readonly BrowserPreviewTab[]> {
  const tabs: BrowserPreviewTab[] = [];
  for (const [id, page] of session.pages) {
    if (!page.isClosed()) {
      tabs.push({ id, url: page.url(), title: await browserPreviewPageTitle(page), active: id === session.activeTabId });
    }
  }
  return tabs;
}

function browserPreviewDomTargetPriority(target: BrowserPreviewDomTarget): number {
  const tag = target.tag.toLowerCase();
  const role = target.role?.toLowerCase() ?? "";
  if (tag === "input" || tag === "textarea" || tag === "select" || role === "textbox" || role === "searchbox" || role === "combobox") {
    return 0;
  }
  if (tag === "button" || tag === "a" || role === "button" || role === "link" || role === "menuitem" || role === "option") {
    return 1;
  }
  if (role.length > 0 || target.label !== undefined) {
    return 2;
  }
  return 3;
}

export function prioritizeBrowserPreviewDomTargets(targets: readonly BrowserPreviewDomTarget[], limit = 80): readonly BrowserPreviewDomTarget[] {
  return targets
    .map((target, index) => ({ target, index, priority: browserPreviewDomTargetPriority(target) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.target);
}

async function browserPreviewFrameElementSelector(frame: Frame): Promise<string> {
  const frameElement = await frame.frameElement();
  return frameElement.evaluate((node): string => {
    const element = node as Element;
    const quoteAttribute = (name: string, value: string) => `[${name}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
    const escapeIdent = (value: string) => {
      if (globalThis.CSS?.escape) {
        return globalThis.CSS.escape(value);
      }
      return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
    };
    if (element.id) {
      return `#${escapeIdent(element.id)}`;
    }
    const testId = element.getAttribute("data-testid") ?? element.getAttribute("data-test");
    if (testId) {
      return quoteAttribute(element.hasAttribute("data-testid") ? "data-testid" : "data-test", testId);
    }
    const name = element.getAttribute("name");
    if (name) {
      return `${element.tagName.toLowerCase()}${quoteAttribute("name", name)}`;
    }
    const title = element.getAttribute("title");
    if (title) {
      return `${element.tagName.toLowerCase()}${quoteAttribute("title", title)}`;
    }
    const parent = element.parentElement;
    if (!parent) {
      return element.tagName.toLowerCase();
    }
    const sameTagSiblings = Array.from(parent.children).filter((child) => child.tagName === element.tagName);
    const index = sameTagSiblings.indexOf(element) + 1;
    return sameTagSiblings.length > 1 ? `${element.tagName.toLowerCase()}:nth-of-type(${index})` : element.tagName.toLowerCase();
  });
}

async function browserPreviewFramePath(frame: Frame): Promise<readonly string[]> {
  const path: string[] = [];
  let current: Frame | null = frame;
  while (current?.parentFrame()) {
    path.unshift(await browserPreviewFrameElementSelector(current));
    current = current.parentFrame();
  }
  return path;
}

async function browserPreviewDomTargetsForFrame(frame: Frame, framePath: readonly string[]): Promise<readonly BrowserPreviewDomTarget[]> {
  if (frame.url() === "about:blank") {
    return [];
  }
  return frame.evaluate((currentFramePath): BrowserPreviewDomTarget[] => {
    const clip = (value: string, maxLength: number) => {
      const clipped = value.replace(/\s+/g, " ").trim();
      return clipped.length > maxLength ? `${clipped.slice(0, maxLength - 1)}…` : clipped;
    };
    const quoteAttribute = (name: string, value: string) => `[${name}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
    const escapeIdent = (value: string) => {
      if (globalThis.CSS?.escape) {
        return globalThis.CSS.escape(value);
      }
      return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
    };
    const selectorFor = (element: Element): string => {
      if (element.id) {
        return `#${escapeIdent(element.id)}`;
      }
      const testId = element.getAttribute("data-testid") ?? element.getAttribute("data-test");
      if (testId) {
        return quoteAttribute(element.hasAttribute("data-testid") ? "data-testid" : "data-test", testId);
      }
      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel) {
        return `${element.tagName.toLowerCase()}${quoteAttribute("aria-label", ariaLabel)}`;
      }
      const name = element.getAttribute("name");
      if (name && /^(input|textarea|select|button)$/i.test(element.tagName)) {
        return `${element.tagName.toLowerCase()}${quoteAttribute("name", name)}`;
      }
      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current !== document.documentElement && parts.length < 4) {
        const tag = current.tagName.toLowerCase();
        const parent: Element | null = current.parentElement;
        if (!parent) {
          parts.unshift(tag);
          break;
        }
        const currentTagName = current.tagName;
        const sameTagSiblings = (Array.from(parent.children) as Element[]).filter((child) => child.tagName === currentTagName);
        const index = sameTagSiblings.indexOf(current) + 1;
        parts.unshift(sameTagSiblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
        current = parent;
      }
      return parts.join(" > ");
    };
    const implicitRoleFor = (element: Element): string | undefined => {
      const tag = element.tagName.toLowerCase();
      if (tag === "button") {
        return "button";
      }
      if (tag === "a" && element.hasAttribute("href")) {
        return "link";
      }
      if (tag === "textarea") {
        return "textbox";
      }
      if (tag === "select") {
        return "combobox";
      }
      if (tag === "summary") {
        return "button";
      }
      if (element instanceof HTMLInputElement) {
        if (element.type === "checkbox" || element.type === "radio") {
          return element.type;
        }
        if (element.type === "button" || element.type === "submit" || element.type === "reset") {
          return "button";
        }
        return "textbox";
      }
      return undefined;
    };
    const labelFor = (element: Element): string | undefined => {
      const ariaLabel = clip(element.getAttribute("aria-label") ?? "", 100);
      if (ariaLabel) {
        return ariaLabel;
      }
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        const label = clip(Array.from(element.labels ?? []).map((item) => item.textContent ?? "").join(" "), 100);
        if (label) {
          return label;
        }
        const placeholder = "placeholder" in element ? clip(String(element.placeholder ?? ""), 100) : "";
        if (placeholder) {
          return placeholder;
        }
      }
      return clip(element.getAttribute("title") ?? "", 100) || undefined;
    };
    const elements = Array.from(
      document.querySelectorAll(
        [
          "a[href]",
          "button",
          "input",
          "textarea",
          "select",
          "iframe",
          "frame",
          "summary",
          "[role]",
          "[tabindex]",
          "[aria-label]",
          "[data-testid]",
          "[data-test]",
          '[contenteditable="true"]',
        ].join(","),
      ),
    );
    const targets: BrowserPreviewDomTarget[] = [];
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") {
        continue;
      }
      const disabled = element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement ? element.disabled : element.getAttribute("aria-disabled") === "true";
      const editable =
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement ||
        (element instanceof HTMLInputElement && element.type !== "button" && element.type !== "submit" && element.type !== "reset" && element.type !== "checkbox" && element.type !== "radio") ||
        (element instanceof HTMLElement && element.isContentEditable);
      const placeholder = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? clip(element.placeholder, 120) : undefined;
      const value =
        element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
          ? clip(element.value, 120)
          : undefined;
      const href = element instanceof HTMLAnchorElement ? clip(element.href, 240) : undefined;
      const testId = clip(element.getAttribute("data-testid") ?? element.getAttribute("data-test") ?? "", 120) || undefined;
      const ariaName = clip(element.getAttribute("aria-label") ?? "", 120) || undefined;
      const checked = element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio") ? element.checked : undefined;
      const selectedOptions =
        element instanceof HTMLSelectElement ? Array.from(element.selectedOptions).map((option) => clip(option.value || option.label || option.textContent || "", 120)) : undefined;
      targets.push({
        ...(currentFramePath.length > 0 ? { framePath: currentFramePath } : {}),
        selector: selectorFor(element),
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role") ?? implicitRoleFor(element),
        label: labelFor(element),
        text: clip(element.textContent ?? "", 120),
        ...(href ? { href } : {}),
        ...(testId ? { testId } : {}),
        ...(ariaName ? { ariaName } : {}),
        editable,
        disabled,
        visible: true,
        ...(value !== undefined ? { value } : {}),
        ...(checked !== undefined ? { checked } : {}),
        ...(selectedOptions ? { selectedOptions } : {}),
        ...(placeholder ? { placeholder } : {}),
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      });
    }
    return targets;
  }, framePath);
}

async function browserPreviewDomTargets(page: Page): Promise<readonly BrowserPreviewDomTarget[]> {
  if (page.url() === "about:blank") {
    return [];
  }
  const targets: BrowserPreviewDomTarget[] = [];
  for (const frame of page.frames()) {
    const framePath = frame === page.mainFrame() ? [] : await browserPreviewFramePath(frame);
    targets.push(...(await browserPreviewDomTargetsForFrame(frame, framePath)));
  }
  const orderedTargets = targets.map((target, index) => (target.ordinal === undefined ? { ...target, ordinal: index } : target));
  return prioritizeBrowserPreviewDomTargets(orderedTargets);
}

async function browserPreviewSnapshot(session: BrowserPreviewSession, tabId?: string): Promise<BrowserPreviewSnapshot> {
  const page = browserPreviewPageFor(session, tabId);
  const activeTabId = session.pageIds.get(page) ?? session.activeTabId;
  session.activeTabId = activeTabId;
  const viewport = page.viewportSize() ?? BROWSER_PREVIEW_VIEWPORT;
  const screenshot = await page.screenshot({ type: "png", fullPage: false });
  return {
    sessionId: session.id,
    activeTabId,
    tabs: await browserPreviewTabs(session),
    latestEvent: session.events.at(-1),
    freshness: session.freshness,
    ...(session.freshnessReason ? { freshnessReason: session.freshnessReason } : {}),
    url: page.url(),
    title: await browserPreviewPageTitle(page),
    screenshot: `data:image/png;base64,${screenshot.toString("base64")}`,
    viewport,
    updatedAt: new Date().toISOString(),
  };
}

async function browserPreviewState(session: BrowserPreviewSession, tabId?: string, actionResult?: BrowserPreviewActionResult): Promise<BrowserPreviewState> {
  const page = browserPreviewPageFor(session, tabId);
  const activeTabId = session.pageIds.get(page) ?? session.activeTabId;
  session.activeTabId = activeTabId;
  const viewport = page.viewportSize() ?? BROWSER_PREVIEW_VIEWPORT;
  return {
    sessionId: session.id,
    activeTabId,
    tabs: await browserPreviewTabs(session),
    latestEvent: session.events.at(-1),
    freshness: session.freshness,
    ...(session.freshnessReason ? { freshnessReason: session.freshnessReason } : {}),
    url: page.url(),
    title: await browserPreviewPageTitle(page),
    domTargets: await browserPreviewDomTargets(page),
    ...(actionResult ? { actionResult } : {}),
    viewport,
    updatedAt: new Date().toISOString(),
  };
}

function markBrowserPreviewFreshness(session: BrowserPreviewSession, freshness: BrowserPreviewFreshness, reason?: string, dirtyUrl?: string): void {
  session.freshness = freshness;
  if (reason) {
    session.freshnessReason = reason;
  } else {
    delete session.freshnessReason;
  }
  if (dirtyUrl) {
    session.dirtyUrl = dirtyUrl;
  } else {
    delete session.dirtyUrl;
  }
}

function markBrowserPreviewSynced(session: BrowserPreviewSession): void {
  markBrowserPreviewFreshness(session, "synced");
}

function markBrowserPreviewDirty(session: BrowserPreviewSession, payload: BrowserDirtyPayload): void {
  const lowerReason = payload.reason.toLowerCase();
  const freshness: BrowserPreviewFreshness = lowerReason.includes("cross-origin") || lowerReason.includes("storage blocked") ? "blocked" : "dirty";
  markBrowserPreviewFreshness(session, freshness, payload.reason, payload.url);
}

async function navigateBrowserPreview(session: BrowserPreviewSession, page: Page, url: string): Promise<void> {
  const tabId = session.pageIds.get(page) ?? registerBrowserPreviewPage(session, page);
  emitBrowserPreviewEvent(session, { tabId, type: "navigation.started", label: "Navigation started", url });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  emitBrowserPreviewEvent(session, { tabId, type: "navigation.done", label: "Navigation finished", url: page.url(), title: await browserPreviewPageTitle(page) });
}

export async function applyBrowserStorageSnapshot(page: Pick<Page, "evaluate" | "url">, storage: BrowserStorageSnapshot): Promise<void> {
  if (Object.keys(storage.localStorage).length === 0 && Object.keys(storage.sessionStorage).length === 0) {
    return;
  }
  if (page.url() === "about:blank") {
    return;
  }
  await page.evaluate(({ localStorage: localStorageItems, sessionStorage: sessionStorageItems }) => {
    for (const [key, value] of Object.entries(localStorageItems)) {
      window.localStorage.setItem(key, value);
    }
    for (const [key, value] of Object.entries(sessionStorageItems)) {
      window.sessionStorage.setItem(key, value);
    }
  }, storage);
}

function isWorkspaceState(value: unknown): value is WorkspaceState {
  if (!isRecord(value)) {
    return false;
  }
  return (
    Array.isArray(value.chats) &&
    Array.isArray(value.projects) &&
    isRecord(value.threads) &&
    isRecord(value.composerDrafts) &&
    typeof value.selectedId === "string" &&
    isAppSettings(value.settings)
  );
}

function isWorkspaceStateWithoutComposerDrafts(value: unknown): value is Omit<WorkspaceState, "composerDrafts"> {
  if (!isRecord(value)) {
    return false;
  }
  return (
    Array.isArray(value.chats) &&
    Array.isArray(value.projects) &&
    isRecord(value.threads) &&
    value.composerDrafts === undefined &&
    typeof value.selectedId === "string" &&
    isAppSettings(value.settings)
  );
}

function isLegacyWorkspaceState(value: unknown): value is Omit<WorkspaceState, "settings" | "composerDrafts"> {
  if (!isRecord(value)) {
    return false;
  }
  return (
    Array.isArray(value.chats) &&
    Array.isArray(value.projects) &&
    isRecord(value.threads) &&
    typeof value.selectedId === "string" &&
    value.composerDrafts === undefined &&
    value.settings === undefined
  );
}

type WorkspaceConversation = WorkspaceState["chats"][number];

const legacySeedCopy: Record<string, { readonly title: string; readonly snippet: string }> = {
  "chat-2": { title: "Draft release notes for 0.1.69", snippet: "Writing the changelog…" },
  "chat-3": { title: "Postgres vs SQLite for us", snippet: "Needs input: expected QPS?" },
  "chat-1": { title: "Explain our auth flow", snippet: "Walked through the token lifecycle" },
  "chat-5": { title: "Summarize incident #4127", snippet: "Failed to fetch the log bundle" },
  "chat-4": { title: "Brainstorm onboarding copy", snippet: "Draft saved" },
  "c-flaky": { title: "Flaky auth.login test", snippet: "Switched the suite to fake timers" },
  "c-jwt": { title: "Rotate JWT secrets", snippet: "Waiting for approval to deploy" },
  "c-rl": { title: "Rate-limit middleware", snippet: "Shipped · 6 files changed" },
  "c-theme": { title: "Dark / light theme tokens", snippet: "All tokens migrated" },
  "c-virt": { title: "Virtualize the board list", snippet: "Draft — not started" },
  "c-toast": { title: "Fix toast stacking", snippet: "Build failed on CI step 3" },
  "c-tf": { title: "Terraform drift", snippet: "Needs input: 2 resources to destroy" },
  "c-node": { title: "Bump Node to 22", snippet: "Queued behind the release" },
};

const legacyServiceSnippetRu: Record<string, string> = {
  Done: "Готово",
  "Run failed": "Запуск завершился с ошибкой",
  "Run canceled": "Запуск остановлен",
};

function seedConversationById(state: WorkspaceState): Map<string, WorkspaceConversation> {
  return new Map([...state.chats, ...state.projects.flatMap((project) => project.conversations)].map((conversation) => [conversation.id, conversation]));
}

function migrateConversationProfile(conversation: WorkspaceConversation, fresh: WorkspaceConversation | undefined): Pick<WorkspaceConversation, "agent" | "profile"> {
  const profile = normalizeAgentProfile(conversation.profile, conversation.agent);
  if (
    legacySeedCopy[conversation.id] &&
    fresh?.profile &&
    profile.agent === fresh.profile.agent &&
    profile.model === "default" &&
    profile.reasoning === "default" &&
    profile.mode === "default" &&
    !agentProfileEquals(profile, fresh.profile)
  ) {
    return { agent: fresh.profile.agent, profile: normalizeAgentProfile(fresh.profile, fresh.profile.agent) };
  }
  return { agent: profile.agent, profile };
}

function migrateSeedConversation(conversation: WorkspaceConversation, freshById: ReadonlyMap<string, WorkspaceConversation>, locale: WorkspaceState["settings"]["general"]["locale"]): WorkspaceConversation {
  const legacy = legacySeedCopy[conversation.id];
  const fresh = freshById.get(conversation.id);
  const seedSnippet = legacy && fresh && conversation.snippet === legacy.snippet ? fresh.snippet : conversation.snippet;
  const snippet = locale === "ru" ? legacyServiceSnippetRu[seedSnippet] ?? seedSnippet : seedSnippet;
  const profile = migrateConversationProfile(conversation, fresh);
  const next: WorkspaceConversation = {
    ...conversation,
    ...profile,
    title: legacy && fresh && conversation.title === legacy.title ? fresh.title : conversation.title,
    snippet,
  };
  return next.title === conversation.title && next.snippet === conversation.snippet && next.agent === conversation.agent && next.profile === conversation.profile ? conversation : next;
}

function shouldMigrateSeedThread(conversationId: string, messages: WorkspaceState["threads"][string] | undefined): boolean {
  if (!legacySeedCopy[conversationId] || !messages || messages.length !== 2) {
    return false;
  }
  const serialized = JSON.stringify(messages);
  return (
    serialized.includes("On it. I'll work on") ||
    serialized.includes("Scoping “") ||
    serialized.includes("Draft release notes for 0.1.69 from the merged PRs.") ||
    serialized.includes("Investigate the flaky `auth.login` test")
  );
}

export function migrateSeedWorkspaceState(state: WorkspaceState): WorkspaceState {
  const fresh = buildInitialWorkspaceState();
  const freshById = seedConversationById(fresh);
  let changed = false;

  const chats = state.chats.map((conversation) => {
    const migrated = migrateSeedConversation(conversation, freshById, state.settings.general.locale);
    changed ||= migrated !== conversation;
    return migrated;
  });

  const projects = state.projects.map((project) => {
    const conversations = project.conversations.map((conversation) => {
      const migrated = migrateSeedConversation(conversation, freshById, state.settings.general.locale);
      changed ||= migrated !== conversation;
      return migrated;
    });
    return conversations === project.conversations ? project : { ...project, conversations };
  });

  const freshThreads = fresh.threads;
  const threads = { ...state.threads };
  for (const conversationId of Object.keys(freshThreads)) {
    if (shouldMigrateSeedThread(conversationId, state.threads[conversationId])) {
      threads[conversationId] = freshThreads[conversationId];
      changed = true;
    }
  }

  return changed ? { ...state, chats, projects, threads } : state;
}

const interruptedRunSnippet: Record<Locale, string> = {
  en: "Background run interrupted",
  ru: "Фоновый запуск прерван",
};

const serverRunSnippets: Record<Locale, Record<"runCanceledSnippet" | "runDoneSnippet" | "runFailedSnippet" | "runNeedsInputSnippet", string>> = {
  en: {
    runCanceledSnippet: "Run canceled",
    runDoneSnippet: "Done",
    runFailedSnippet: "Run failed",
    runNeedsInputSnippet: "Needs input",
  },
  ru: {
    runCanceledSnippet: "Запуск остановлен",
    runDoneSnippet: "Готово",
    runFailedSnippet: "Запуск завершился с ошибкой",
    runNeedsInputSnippet: "Ждёт ввод",
  },
};

function serverRunSnippet(locale: Locale, key: keyof (typeof serverRunSnippets)[Locale]): string {
  return serverRunSnippets[locale][key];
}

function reconcileConversationRun(conversation: WorkspaceConversation, activeRunIds: ReadonlySet<string>, locale: Locale): WorkspaceConversation {
  if (!conversation.activeRunId || activeRunIds.has(conversation.activeRunId)) {
    return conversation;
  }
  if (conversation.status !== "running" && conversation.status !== "waiting") {
    return conversation;
  }
  return {
    ...conversation,
    activeRunId: undefined,
    status: "error",
    snippet: interruptedRunSnippet[locale],
  };
}

function settleLiveBlock(block: AgentBlock): AgentBlock {
  if (block.kind === "reasoning" && block.active) {
    return { ...block, active: false };
  }
  if (block.kind === "text" && block.streaming) {
    return { ...block, streaming: false };
  }
  return block;
}

function settleLiveThreadWithStatus(messages: readonly ChatMessage[], statusBlock: Extract<AgentBlock, { kind: "status" }>): ChatMessage[] {
  const lastAgentIndex = messages.findLastIndex((message) => message.role === "agent");
  if (lastAgentIndex < 0) {
    return [...messages];
  }
  const message = messages[lastAgentIndex];
  const blocks = message.blocks ?? [];
  const hasStatus = blocks.some((block) => block.kind === "status" && block.level === statusBlock.level && block.text === statusBlock.text);
  const settledBlocks = blocks.map(settleLiveBlock);
  const nextBlocks = hasStatus ? settledBlocks : [...settledBlocks, statusBlock];
  return messages.map<ChatMessage>((item, index) => (index === lastAgentIndex ? { ...message, blocks: nextBlocks } : item));
}

function settleInterruptedThread(messages: readonly ChatMessage[], locale: Locale): ChatMessage[] {
  return settleLiveThreadWithStatus(messages, { kind: "status", level: "error", text: interruptedRunSnippet[locale] });
}

export function reconcileStaleBackgroundRuns(state: WorkspaceState, activeRunIds: ReadonlySet<string>): WorkspaceState {
  let changed = false;
  const locale = state.settings.general.locale;
  const staleConversationIds = new Set<string>();
  const reconcile = (conversation: WorkspaceConversation): WorkspaceConversation => {
    const reconciled = reconcileConversationRun(conversation, activeRunIds, locale);
    if (reconciled !== conversation) {
      changed = true;
      staleConversationIds.add(conversation.id);
    }
    return reconciled;
  };
  const chats = state.chats.map(reconcile);
  const projects = state.projects.map((project) => {
    const conversations = project.conversations.map(reconcile);
    return conversations === project.conversations ? project : { ...project, conversations };
  });
  if (!changed) {
    return state;
  }
  const threads = { ...state.threads };
  for (const conversationId of staleConversationIds) {
    threads[conversationId] = settleInterruptedThread(threads[conversationId] ?? [], locale);
  }
  return { ...state, chats, projects, threads };
}

export function cancelBackgroundRunState(state: WorkspaceState, runId: string): WorkspaceState {
  const locale = state.settings.general.locale;
  const snippet = serverRunSnippet(locale, "runCanceledSnippet");
  const canceledConversationIds = new Set<string>();
  const cancelConversation = (conversation: WorkspaceConversation): WorkspaceConversation => {
    if (conversation.activeRunId !== runId || (conversation.status !== "running" && conversation.status !== "waiting")) {
      return conversation;
    }
    canceledConversationIds.add(conversation.id);
    return {
      ...conversation,
      activeRunId: undefined,
      status: "idle",
      snippet,
    };
  };

  const chats = state.chats.map(cancelConversation);
  const projects = state.projects.map((project) => ({
    ...project,
    conversations: project.conversations.map(cancelConversation),
  }));
  if (canceledConversationIds.size === 0) {
    return state;
  }

  const statusBlock: Extract<AgentBlock, { kind: "status" }> = { kind: "status", level: "warn", text: snippet };
  const threads = { ...state.threads };
  for (const conversationId of canceledConversationIds) {
    threads[conversationId] = settleLiveThreadWithStatus(state.threads[conversationId] ?? [], statusBlock);
  }
  return { ...state, chats, projects, threads };
}

export interface BackgroundRunCancelStateResult {
  readonly state: WorkspaceState;
  readonly canceled: boolean;
  readonly hadHandle: boolean;
}

export function cancelBackgroundRunRequestState(state: WorkspaceState, runId: string, hadHandle: boolean): BackgroundRunCancelStateResult {
  const canceledState = cancelBackgroundRunState(state, runId);
  return {
    state: canceledState,
    canceled: hadHandle || canceledState !== state,
    hadHandle,
  };
}

/** Demo conversations are seeded only in development or with RLAB_DEMO=1; a
 *  production server starts with a clean, empty workspace. */
function isDemoWorkspaceEnabled(): boolean {
  return process.env.RLAB_DEMO === "1" || process.env.NODE_ENV === "development";
}

function readWorkspaceState(): WorkspaceState {
  if (!existsSync(WORKSPACE_STATE_FILE)) {
    const seed = isDemoWorkspaceEnabled() ? buildInitialWorkspaceState() : buildEmptyWorkspaceState();
    const initial = normalizeSeedProjectPaths(seed);
    writeWorkspaceState(initial);
    return initial;
  }
  const parsed = JSON.parse(readFileSync(WORKSPACE_STATE_FILE, "utf8").replace(/^\uFEFF/, "")) as unknown;
  if (isWorkspaceState(parsed)) {
    const normalized = reconcileStaleBackgroundRuns(normalizeSeedProjectPaths(migrateSeedWorkspaceState(cloneWorkspaceState(parsed))), new Set(backgroundRunHandles.keys()));
    if (JSON.stringify(normalized) !== JSON.stringify(parsed)) {
      writeWorkspaceState(normalized);
    }
    return normalized;
  }
  if (isWorkspaceStateWithoutComposerDrafts(parsed)) {
    const migrated: WorkspaceState = {
      ...parsed,
      composerDrafts: {},
    };
    const normalized = reconcileStaleBackgroundRuns(normalizeSeedProjectPaths(migrateSeedWorkspaceState(cloneWorkspaceState(migrated))), new Set(backgroundRunHandles.keys()));
    writeWorkspaceState(normalized);
    return normalized;
  }
  if (isLegacyWorkspaceState(parsed)) {
    const migrated: WorkspaceState = {
      ...parsed,
      composerDrafts: {},
      settings: cloneAppSettings(defaultAppSettings),
    };
    const normalized = reconcileStaleBackgroundRuns(normalizeSeedProjectPaths(migrateSeedWorkspaceState(migrated)), new Set(backgroundRunHandles.keys()));
    writeWorkspaceState(normalized);
    return normalized;
  }
  throw new Error(`${WORKSPACE_STATE_FILE} does not contain a valid workspace state.`);
}

let atomicJsonWriteSeq = 0;

function atomicJsonTempFile(file: string): string {
  atomicJsonWriteSeq += 1;
  return `${file}.${process.pid}.${Date.now()}.${atomicJsonWriteSeq}.tmp`;
}

function storageReplaceSleepSync(delayMs: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}

function isRetryableStorageReplaceError(error: unknown): boolean {
  return isRecord(error) && (error.code === "EPERM" || error.code === "EACCES" || error.code === "EBUSY");
}

function replaceStorageFile(tempFile: string, file: string): void {
  const delays = [20, 50, 100, 200] as const;
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(tempFile, file);
      return;
    } catch (error) {
      if (attempt >= delays.length || !isRetryableStorageReplaceError(error)) {
        throw error;
      }
      storageReplaceSleepSync(delays[attempt]);
    }
  }
}

export function writeJsonFileAtomic(file: string, value: unknown, mode?: number): void {
  mkdirSync(dirname(file), { recursive: true });
  const tempFile = atomicJsonTempFile(file);
  if (existsSync(file)) {
    copyFileSync(file, `${file}.bak`);
  }
  try {
    writeFileSync(tempFile, `${JSON.stringify(value, null, 2)}\n`, mode === undefined ? "utf8" : { encoding: "utf8", mode });
    if (mode !== undefined) {
      chmodSync(tempFile, mode);
    }
    replaceStorageFile(tempFile, file);
    if (mode !== undefined) {
      chmodSync(file, mode);
    }
  } finally {
    if (existsSync(tempFile)) {
      unlinkSync(tempFile);
    }
  }
}

export function withStorageFileLock<T>(lockFile: string, fn: () => T): T {
  mkdirSync(dirname(lockFile), { recursive: true });
  let fd: number | null = null;
  try {
    fd = openSync(lockFile, "wx");
  } catch (error) {
    if (isRecord(error) && error.code === "EEXIST") {
      throw new Error("Storage state is locked.");
    }
    throw error;
  }
  try {
    return fn();
  } finally {
    closeSync(fd);
    unlinkSync(lockFile);
  }
}

function writeWorkspaceState(state: WorkspaceState): void {
  withStorageFileLock(WORKSPACE_STATE_LOCK_FILE, () => writeJsonFileAtomic(WORKSPACE_STATE_FILE, state));
}

export function storageHealthSnapshot(): {
  readonly storage: { readonly ok: boolean; readonly stateFile: string; readonly lockFile: string; readonly backupFile: string; readonly error?: string };
  readonly agents: { readonly visible: readonly string[] };
  readonly browser: { readonly installed: boolean };
} {
  const browser = { installed: isPlaywrightBrowserInstalled() };
  try {
    mkdirSync(WORKSPACE_STATE_DIR, { recursive: true });
    if (existsSync(WORKSPACE_STATE_FILE)) {
      JSON.parse(readFileSync(WORKSPACE_STATE_FILE, "utf8").replace(/^\uFEFF/, "")) as unknown;
    }
    return {
      storage: {
        ok: true,
        stateFile: WORKSPACE_STATE_FILE,
        lockFile: WORKSPACE_STATE_LOCK_FILE,
        backupFile: `${WORKSPACE_STATE_FILE}.bak`,
      },
      agents: { visible: visibleAgentDetectionIds() },
      browser,
    };
  } catch (error) {
    return {
      storage: {
        ok: false,
        stateFile: WORKSPACE_STATE_FILE,
        lockFile: WORKSPACE_STATE_LOCK_FILE,
        backupFile: `${WORKSPACE_STATE_FILE}.bak`,
        error: errorMessage(error),
      },
      agents: { visible: visibleAgentDetectionIds() },
      browser,
    };
  }
}

const SENSITIVE_AUDIT_KEYS = new Set(["prompt", "apiKey", "dataBase64", "content"]);

export function appendRunAuditEvent(file: string, event: Record<string, unknown> & { readonly type: string }): void {
  mkdirSync(dirname(file), { recursive: true });
  const sanitized: Record<string, unknown> = { timestamp: new Date().toISOString() };
  for (const [key, value] of Object.entries(event)) {
    if (!SENSITIVE_AUDIT_KEYS.has(key)) {
      sanitized[key] = value;
    }
  }
  appendFileSync(file, `${JSON.stringify(sanitized)}\n`, "utf8");
}

export function readRunAuditEvents(file = RUN_AUDIT_FILE): readonly Record<string, unknown>[] {
  if (!existsSync(file)) {
    return [];
  }
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown)
    .filter(isRecord);
}

const SEED_PLACEHOLDER_PROJECT_PATHS = new Set(["/root/workspace/rlab", "/root/workspace/rlab/next-ui"]);

function normalizeSeedProjectPaths(state: WorkspaceState): WorkspaceState {
  const workspaceRoot = dirname(PLUGIN_DIR);
  const seedProjectPaths: Record<string, string> = {
    "auth-service": workspaceRoot,
    "web-ui": PLUGIN_DIR,
    infra: workspaceRoot,
  };
  let changed = false;
  const projects = state.projects.map((project) => {
    const canonical = seedProjectPaths[project.id];
    if (!canonical || project.path === canonical) {
      return project;
    }
    // Heal seed projects whose stored path is a placeholder or no longer exists
    // on disk (e.g. state copied from another machine / a previous platform),
    // but leave user-customized valid paths untouched.
    if (!project.path || SEED_PLACEHOLDER_PROJECT_PATHS.has(project.path) || !existsSync(project.path)) {
      changed = true;
      return { ...project, path: canonical };
    }
    return project;
  });
  return changed ? { ...state, projects } : state;
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", JSON_CONTENT_TYPE);
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

export function workspacePutErrorStatus(error: unknown): 400 | 500 {
  return error instanceof SyntaxError ? 400 : 500;
}

export function attachmentUploadErrorStatus(error: unknown): 400 | 500 {
  return error instanceof SyntaxError ? 400 : 500;
}

const agentConfigBadRequestMessages = new Set(["Invalid agent config payload.", "Agent id is required.", "API key is required."]);
const agentInstallBadRequestMessages = new Set(["Invalid agent install payload.", "Agent id is required."]);

export function agentConfigErrorStatus(error: unknown): 400 | 500 {
  return error instanceof SyntaxError || agentConfigBadRequestMessages.has(errorMessage(error)) ? 400 : 500;
}

export function agentInstallErrorStatus(error: unknown): 400 | 500 {
  return error instanceof SyntaxError || agentInstallBadRequestMessages.has(errorMessage(error)) ? 400 : 500;
}

const projectDirectoryBadRequestMessages = new Set(["Invalid project directory payload.", "Project path is required.", "Project directory is required."]);

const runControlBadRequestMessages = new Set([
  "Approval id is required.",
  "Invalid approval decision.",
  "Input request id is required.",
  "Selected options must be a string array.",
  "At least one selected option is required.",
  "Selected options do not match the pending question.",
  "Run id is required.",
]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function projectDirectoryErrorStatus(error: unknown): 400 | 500 {
  return error instanceof SyntaxError || projectDirectoryBadRequestMessages.has(errorMessage(error)) ? 400 : 500;
}

export function runControlErrorStatus(error: unknown): 400 | 404 | 500 {
  if (error instanceof SyntaxError) {
    return 400;
  }
  const message = errorMessage(error);
  if (message.startsWith("No pending approval request") || message.startsWith("No pending input request")) {
    return 404;
  }
  return runControlBadRequestMessages.has(message) ? 400 : 500;
}

function directoryName(path: string): string {
  return basename(path.replace(/[\\/]+$/g, "")) || path;
}

export function parseProjectDirectoryPayload(body: string, field: "cwd" | "path", requiredMessage: string): string {
  const parsed = JSON.parse(body || "{}") as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Invalid project directory payload.");
  }
  const value = typeof parsed[field] === "string" ? parsed[field].trim() : "";
  if (!value) {
    throw new Error(requiredMessage);
  }
  return value;
}

export interface AttachmentUploadPayload {
  readonly name: string;
  readonly mimeType?: string;
  readonly dataBase64: string;
}

export function parseAttachmentUploadPayload(body: string): AttachmentUploadPayload {
  const parsed = JSON.parse(body || "{}") as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Invalid attachment upload payload.");
  }
  const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
  if (!name || typeof parsed.dataBase64 !== "string") {
    throw new Error("Attachment name and data are required.");
  }
  const mimeType = typeof parsed.mimeType === "string" ? parsed.mimeType : undefined;
  return mimeType ? { name, mimeType, dataBase64: parsed.dataBase64 } : { name, dataBase64: parsed.dataBase64 };
}

export interface AgentConfigPayload {
  readonly agent: string;
  readonly apiKey: string;
}

export function parseAgentConfigPayload(body: string): AgentConfigPayload {
  const parsed = JSON.parse(body || "{}") as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Invalid agent config payload.");
  }
  const agent = typeof parsed.agent === "string" ? parsed.agent.trim() : "";
  if (!agent) {
    throw new Error("Agent id is required.");
  }
  if (!isAgentId(agent)) {
    throw new Error(`Agent ${agent} is not supported.`);
  }
  const apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "";
  if (!apiKey) {
    throw new Error("API key is required.");
  }
  return { agent, apiKey };
}

export interface AgentInstallPayload {
  readonly agent: string;
}

export function parseAgentInstallPayload(body: string): AgentInstallPayload {
  const parsed = JSON.parse(body || "{}") as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Invalid agent install payload.");
  }
  const agent = typeof parsed.agent === "string" ? parsed.agent.trim() : "";
  if (!agent) {
    throw new Error("Agent id is required.");
  }
  if (!isAgentId(agent)) {
    throw new Error(`Agent ${agent} is not supported.`);
  }
  return { agent };
}

const SKIPPED_FILE_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".next"]);

export function listMentionableFiles(tree: Readonly<Record<string, readonly string[]>>, root: string, limit = 120): string[] {
  const files: string[] = [];
  const visit = (dir: string, prefix: string) => {
    if (files.length >= limit) {
      return;
    }
    const entries = tree[dir] ?? [];
    for (const entry of entries) {
      if (files.length >= limit) {
        return;
      }
      if (SKIPPED_FILE_DIRS.has(entry)) {
        continue;
      }
      const child = `${dir.replace(/\/+$/g, "")}/${entry}`;
      const relative = prefix ? `${prefix}/${entry}` : entry;
      if (tree[child]) {
        visit(child, relative);
      } else {
        files.push(relative);
      }
    }
  };
  visit(root.replace(/\\/g, "/").replace(/\/+$/g, ""), "");
  return files.sort((a, b) => a.localeCompare(b));
}

function listMentionableFilesFromDisk(root: string, limit = 120): string[] {
  const files: string[] = [];
  const visit = (dir: string, prefix: string) => {
    if (files.length >= limit) {
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (files.length >= limit) {
        return;
      }
      if (entry.isDirectory()) {
        if (!SKIPPED_FILE_DIRS.has(entry.name)) {
          visit(join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
        }
      } else if (entry.isFile()) {
        files.push(prefix ? `${prefix}/${entry.name}` : entry.name);
      }
    }
  };
  visit(root, "");
  return files.sort((a, b) => a.localeCompare(b));
}

function handleBrowserSession(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    void (async () => {
      try {
        const payload = parseBrowserSessionPayload(body);
        const session = await ensureBrowserPreviewSession(payload.sessionId);
        const page = browserPreviewPageFor(session);
        await navigateBrowserPreview(session, page, payload.url);
        markBrowserPreviewSynced(session);
        sendJson(res, 200, await browserPreviewSnapshot(session));
      } catch (error) {
        sendJson(res, browserPreviewErrorStatus(error), { error: errorMessage(error) });
      }
    })();
  });
}

function handleBrowserSync(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    void (async () => {
      try {
        const payload = parseBrowserSyncPayload(body);
        const session = await ensureBrowserPreviewSession(payload.sessionId);
        const page = browserPreviewPageFor(session);
        await navigateBrowserPreview(session, page, payload.url);
        await applyBrowserStorageSnapshot(page, payload);
        markBrowserPreviewSynced(session);
        sendJson(res, 200, await browserPreviewSnapshot(session));
      } catch (error) {
        sendJson(res, browserPreviewErrorStatus(error), { error: errorMessage(error) });
      }
    })();
  });
}

function handleBrowserBridgeSync(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    void (async () => {
      try {
        const payload = parseBrowserSyncPayload(body);
        const session = await ensureBrowserPreviewSession(payload.sessionId);
        const page = browserPreviewPageFor(session);
        await navigateBrowserPreview(session, page, payload.url);
        await applyBrowserStorageSnapshot(page, payload);
        markBrowserPreviewSynced(session);
        sendJson(res, 200, await browserPreviewState(session));
      } catch (error) {
        sendJson(res, browserPreviewErrorStatus(error), { error: errorMessage(error) });
      }
    })();
  });
}

function handleBrowserDirty(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    void (async () => {
      try {
        const payload = parseBrowserDirtyPayload(body);
        const session = currentBrowserPreviewSession(payload.sessionId);
        if (!session) {
          sendJson(res, 404, { error: "No browser preview session is active." });
          return;
        }
        markBrowserPreviewDirty(session, payload);
        sendJson(res, 200, await browserPreviewState(session));
      } catch (error) {
        sendJson(res, browserPreviewErrorStatus(error), { error: errorMessage(error) });
      }
    })();
  });
}

function handleBrowserAction(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    void (async () => {
      try {
        const action = parseBrowserActionPayload(body);
        const result = await applyBrowserAction(action);
        sendJson(res, 200, await browserPreviewSnapshot(result.session, result.tabId));
      } catch (error) {
        sendJson(res, browserPreviewErrorStatus(error), { error: errorMessage(error) });
      }
    })();
  });
}

function browserActionTargetDescription(target: BrowserActionTarget): string {
  const framePath = target.framePath?.length ? `framePath=${target.framePath.join(" > ")} ` : "";
  if ("selector" in target) {
    return `${framePath}selector=${target.selector}`;
  }
  if ("role" in target) {
    return target.name ? `${framePath}role=${target.role} name=${target.name}` : `${framePath}role=${target.role}`;
  }
  if ("text" in target) {
    return `${framePath}text=${target.text}`;
  }
  return `${framePath}label=${target.label}`;
}

function browserActionTargetSelector(target: BrowserActionTarget | undefined): string | undefined {
  return target && "selector" in target ? target.selector : undefined;
}

function browserActionPayloadTargetDescription(action: BrowserActionPayload): string | undefined {
  if ("target" in action && action.target) {
    return browserActionTargetDescription(action.target);
  }
  if (action.type === "navigate") {
    return `url=${action.url}`;
  }
  if (action.type === "wait-for" && "urlIncludes" in action) {
    return `urlIncludes=${action.urlIncludes}`;
  }
  if (action.type === "type" && action.selector) {
    return `selector=${action.selector}`;
  }
  if (action.type === "click" && "x" in action) {
    return `point=x${action.x},y${action.y}`;
  }
  return undefined;
}

type BrowserActionLocatorScope = Pick<Page | FrameLocator, "locator" | "getByRole" | "getByText" | "getByLabel" | "frameLocator">;

function browserActionLocatorScope(page: Page, target: BrowserActionTarget): BrowserActionLocatorScope {
  let scope: BrowserActionLocatorScope = page;
  for (const frameSelector of target.framePath ?? []) {
    scope = scope.frameLocator(frameSelector);
  }
  return scope;
}

function browserActionLocator(page: Page, target: BrowserActionTarget): Locator {
  const scope = browserActionLocatorScope(page, target);
  if ("selector" in target) {
    return scope.locator(target.selector).first();
  }
  if ("role" in target) {
    return target.name ? scope.getByRole(target.role, { name: target.name, exact: true }).first() : scope.getByRole(target.role).first();
  }
  if ("text" in target) {
    return scope.getByText(target.text, { exact: true }).first();
  }
  return scope.getByLabel(target.label, { exact: true }).first();
}

function browserActionTargetForKeyboard(action: Extract<BrowserActionPayload, { readonly type: "type" | "press" }>): BrowserActionTarget | undefined {
  if (action.target) {
    return action.target;
  }
  if (action.type === "type" && action.selector) {
    return { selector: action.selector };
  }
  return undefined;
}

async function browserActionPoint(locator: Locator): Promise<{ readonly x: number; readonly y: number } | undefined> {
  await locator.waitFor({ state: "visible", timeout: BROWSER_ACTION_TIMEOUT_MS });
  const box = await locator.boundingBox();
  if (!box) {
    return undefined;
  }
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
}

export function browserPreviewActionFailureResult(action: BrowserActionPayload, error: unknown): BrowserPreviewActionResult {
  const target = browserActionPayloadTargetDescription(action);
  const rawError = errorMessage(error);
  const isTimeout = /timeout|timed out/i.test(rawError);
  return {
    ok: false,
    action: action.type,
    ...(target ? { target } : {}),
    error: isTimeout && target ? `Target not found within ${BROWSER_ACTION_TIMEOUT_MS}ms: ${target}` : rawError,
  };
}

async function browserPreviewActiveElement(page: Page): Promise<BrowserPreviewActiveElement | undefined> {
  if (page.url() === "about:blank") {
    return undefined;
  }
  return page.evaluate((): BrowserPreviewActiveElement | undefined => {
    const element = document.activeElement;
    if (!element) {
      return undefined;
    }
    const clip = (value: string) => {
      const normalized = value.replace(/\s+/g, " ").trim();
      return normalized.length > 240 ? `${normalized.slice(0, 239)}…` : normalized;
    };
    return {
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role") ?? undefined,
      label: element.getAttribute("aria-label") ?? undefined,
      text: clip(element.textContent ?? ""),
    };
  });
}

async function browserPreviewActionSuccessResult(page: Page, action: BrowserActionPayload, value?: unknown): Promise<BrowserPreviewActionResult> {
  const text = value === undefined ? undefined : clip(value, 1000);
  const target = browserActionPayloadTargetDescription(action);
  return {
    ok: true,
    action: action.type,
    ...(target ? { target } : {}),
    ...(value === undefined ? {} : { value }),
    ...(text === undefined ? {} : { text }),
    ...(action.type === "select-tab" ? {} : { activeElement: await browserPreviewActiveElement(page) }),
  };
}

async function evaluateBrowserPreviewScript(page: Page, script: string): Promise<unknown> {
  const evaluation = page.evaluate(async (source): Promise<unknown> => {
    const simplify = (value: unknown, depth: number): unknown => {
      if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
      }
      if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
        return String(value);
      }
      if (value instanceof Element) {
        return {
          tag: value.tagName.toLowerCase(),
          id: value.id || undefined,
          role: value.getAttribute("role") ?? undefined,
          label: value.getAttribute("aria-label") ?? undefined,
          text: value.textContent?.replace(/\s+/g, " ").trim().slice(0, 240) ?? "",
        };
      }
      if (depth <= 0) {
        return Array.isArray(value) ? `[array:${value.length}]` : "[object]";
      }
      if (Array.isArray(value)) {
        return value.slice(0, 40).map((item) => simplify(item, depth - 1));
      }
      if (typeof value === "object") {
        const output: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
          output[key] = simplify(item, depth - 1);
        }
        return output;
      }
      return String(value);
    };
    const raw: unknown = (0, eval)(source);
    return simplify(await Promise.resolve(raw), 4);
  }, script);
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Browser eval timed out after ${BROWSER_ACTION_TIMEOUT_MS}ms.`)), BROWSER_ACTION_TIMEOUT_MS);
  });
  return Promise.race([evaluation, timeout]);
}

async function applyBrowserAction(action: BrowserActionPayload): Promise<{ readonly session: BrowserPreviewSession; readonly tabId?: string; readonly actionResult?: BrowserPreviewActionResult }> {
  const session = await ensureBrowserPreviewSession(action.sessionId);
  if (action.type === "select-tab") {
    const selectedPage = browserPreviewPageFor(session, action.tabId);
    session.activeTabId = action.tabId;
    emitBrowserPreviewEvent(session, {
      tabId: action.tabId,
      type: "tab.selected",
      label: "Tab selected",
      url: selectedPage.url(),
      title: await browserPreviewPageTitle(selectedPage),
    });
    return { session, tabId: action.tabId, actionResult: await browserPreviewActionSuccessResult(selectedPage, action) };
  }
  const page = browserPreviewPageFor(session, action.tabId);
  const tabId = session.pageIds.get(page) ?? session.activeTabId;
  if (action.type === "navigate") {
    emitBrowserPreviewEvent(session, { tabId, type: "action.navigate", label: "Navigate", detail: action.url, url: action.url });
    await navigateBrowserPreview(session, page, action.url);
    markBrowserPreviewSynced(session);
  } else if (action.type === "go-back") {
    emitBrowserPreviewEvent(session, { tabId, type: "action.go-back", label: "Back" });
    await page.goBack({ waitUntil: "domcontentloaded", timeout: BROWSER_ACTION_TIMEOUT_MS });
    emitBrowserPreviewEvent(session, { tabId, type: "navigation.done", label: "Back finished", url: page.url(), title: await browserPreviewPageTitle(page) });
  } else if (action.type === "go-forward") {
    emitBrowserPreviewEvent(session, { tabId, type: "action.go-forward", label: "Forward" });
    await page.goForward({ waitUntil: "domcontentloaded", timeout: BROWSER_ACTION_TIMEOUT_MS });
    emitBrowserPreviewEvent(session, { tabId, type: "navigation.done", label: "Forward finished", url: page.url(), title: await browserPreviewPageTitle(page) });
  } else if (action.type === "refresh") {
    emitBrowserPreviewEvent(session, { tabId, type: "action.refresh", label: "Refresh" });
    await page.reload({ waitUntil: "domcontentloaded", timeout: BROWSER_ACTION_TIMEOUT_MS });
  } else if (action.type === "scroll") {
    if (action.target) {
      const locator = browserActionLocator(page, action.target);
      emitBrowserPreviewEvent(session, {
        tabId,
        type: "action.scroll",
        label: "Scroll",
        detail: `${browserActionTargetDescription(action.target)} · deltaY=${action.deltaY}`,
        deltaY: action.deltaY,
        target: action.target,
        selector: browserActionTargetSelector(action.target),
      });
      await locator.waitFor({ state: "visible", timeout: BROWSER_ACTION_TIMEOUT_MS });
      await locator.evaluate((element, deltaY) => {
        if (!(element instanceof HTMLElement)) {
          throw new Error("Browser scroll target must be an HTMLElement.");
        }
        element.scrollBy({ top: deltaY, left: 0, behavior: "auto" });
      }, action.deltaY);
    } else {
      emitBrowserPreviewEvent(session, { tabId, type: "action.scroll", label: "Scroll", detail: `deltaY=${action.deltaY}`, deltaY: action.deltaY });
      await page.mouse.wheel(0, action.deltaY);
    }
  } else if (action.type === "click") {
    if ("target" in action) {
      const locator = browserActionLocator(page, action.target);
      emitBrowserPreviewEvent(session, {
        tabId,
        type: "action.click",
        label: "Click",
        detail: browserActionTargetDescription(action.target),
        target: action.target,
        selector: browserActionTargetSelector(action.target),
        point: await browserActionPoint(locator),
      });
      await locator.click({ timeout: BROWSER_ACTION_TIMEOUT_MS });
    } else {
      emitBrowserPreviewEvent(session, { tabId, type: "action.click", label: "Click", detail: `x=${action.x} y=${action.y}`, point: { x: action.x, y: action.y } });
      await page.mouse.click(action.x, action.y);
    }
  } else if (action.type === "fill") {
    const locator = browserActionLocator(page, action.target);
    emitBrowserPreviewEvent(session, {
      tabId,
      type: "action.fill",
      label: "Fill",
      detail: `${browserActionTargetDescription(action.target)} · ${action.text}`,
      target: action.target,
      selector: browserActionTargetSelector(action.target),
      text: action.text,
    });
    await locator.fill(action.text, { timeout: BROWSER_ACTION_TIMEOUT_MS });
  } else if (action.type === "clear") {
    const locator = browserActionLocator(page, action.target);
    emitBrowserPreviewEvent(session, {
      tabId,
      type: "action.clear",
      label: "Clear",
      detail: browserActionTargetDescription(action.target),
      target: action.target,
      selector: browserActionTargetSelector(action.target),
    });
    await locator.fill("", { timeout: BROWSER_ACTION_TIMEOUT_MS });
  } else if (action.type === "check") {
    const locator = browserActionLocator(page, action.target);
    emitBrowserPreviewEvent(session, {
      tabId,
      type: "action.check",
      label: "Check",
      detail: browserActionTargetDescription(action.target),
      target: action.target,
      selector: browserActionTargetSelector(action.target),
    });
    await locator.check({ timeout: BROWSER_ACTION_TIMEOUT_MS });
  } else if (action.type === "uncheck") {
    const locator = browserActionLocator(page, action.target);
    emitBrowserPreviewEvent(session, {
      tabId,
      type: "action.uncheck",
      label: "Uncheck",
      detail: browserActionTargetDescription(action.target),
      target: action.target,
      selector: browserActionTargetSelector(action.target),
    });
    await locator.uncheck({ timeout: BROWSER_ACTION_TIMEOUT_MS });
  } else if (action.type === "select") {
    const locator = browserActionLocator(page, action.target);
    const option = "value" in action ? action.value : action.label;
    emitBrowserPreviewEvent(session, {
      tabId,
      type: "action.select",
      label: "Select",
      detail: `${browserActionTargetDescription(action.target)} · ${option}`,
      target: action.target,
      selector: browserActionTargetSelector(action.target),
      text: option,
    });
    if ("value" in action) {
      await locator.selectOption(action.value, { timeout: BROWSER_ACTION_TIMEOUT_MS });
    } else {
      await locator.selectOption({ label: action.label }, { timeout: BROWSER_ACTION_TIMEOUT_MS });
    }
  } else if (action.type === "wait-for") {
    if ("target" in action) {
      const locator = browserActionLocator(page, action.target);
      emitBrowserPreviewEvent(session, {
        tabId,
        type: "action.wait-for",
        label: "Wait for target",
        detail: `${browserActionTargetDescription(action.target)} · ${action.state}`,
        target: action.target,
        selector: browserActionTargetSelector(action.target),
      });
      await locator.waitFor({ state: action.state, timeout: BROWSER_ACTION_TIMEOUT_MS });
    } else {
      emitBrowserPreviewEvent(session, {
        tabId,
        type: "action.wait-for",
        label: "Wait for URL",
        detail: `urlIncludes=${action.urlIncludes}`,
      });
      await page.waitForURL((url) => url.href.includes(action.urlIncludes), { timeout: BROWSER_ACTION_TIMEOUT_MS });
    }
  } else if (action.type === "hover") {
    const locator = browserActionLocator(page, action.target);
    emitBrowserPreviewEvent(session, {
      tabId,
      type: "action.hover",
      label: "Hover",
      detail: browserActionTargetDescription(action.target),
      target: action.target,
      selector: browserActionTargetSelector(action.target),
      point: await browserActionPoint(locator),
    });
    await locator.hover({ timeout: BROWSER_ACTION_TIMEOUT_MS });
  } else if (action.type === "type") {
    const target = browserActionTargetForKeyboard(action);
    emitBrowserPreviewEvent(session, {
      tabId,
      type: "action.type",
      label: "Type",
      detail: target ? `${browserActionTargetDescription(target)} · ${action.text}` : action.text,
      target,
      selector: browserActionTargetSelector(target),
      text: action.text,
    });
    if (target) {
      await browserActionLocator(page, target).click({ timeout: BROWSER_ACTION_TIMEOUT_MS });
    }
    await page.keyboard.type(action.text);
  } else if (action.type === "press") {
    const target = browserActionTargetForKeyboard(action);
    emitBrowserPreviewEvent(session, {
      tabId,
      type: "action.press",
      label: "Press key",
      detail: target ? `${browserActionTargetDescription(target)} · ${action.key}` : action.key,
      target,
      selector: browserActionTargetSelector(target),
      key: action.key,
    });
    if (target) {
      await browserActionLocator(page, target).press(action.key, { timeout: BROWSER_ACTION_TIMEOUT_MS });
    } else {
      await page.keyboard.press(action.key);
    }
  } else if (action.type === "eval") {
    const value = await evaluateBrowserPreviewScript(page, action.script);
    const resultText = clip(value, 1000);
    emitBrowserPreviewEvent(session, {
      tabId,
      type: "action.eval",
      label: "Eval",
      detail: resultText || clip(action.script, 120),
      script: action.script,
      text: resultText,
    });
    return { session, tabId, actionResult: await browserPreviewActionSuccessResult(page, action, value) };
  }
  return { session, tabId, actionResult: await browserPreviewActionSuccessResult(page, action) };
}

function emitBrowserPreviewActionFailure(session: BrowserPreviewSession, action: BrowserActionPayload, tabId: string, actionResult: BrowserPreviewActionResult): void {
  emitBrowserPreviewEvent(session, {
    tabId,
    type: "action.failed",
    label: "Action failed",
    detail: actionResult.target ? `${actionResult.target} · ${actionResult.error ?? ""}` : actionResult.error,
    target: "target" in action ? action.target : undefined,
    selector: "target" in action ? browserActionTargetSelector(action.target) : undefined,
    text: actionResult.error,
  });
}

async function staleBrowserPreviewActionResult(
  session: BrowserPreviewSession,
  action: BrowserActionPayload,
  tabId: string,
  message: string,
): Promise<{ readonly session: BrowserPreviewSession; readonly tabId: string; readonly actionResult: BrowserPreviewActionResult }> {
  const actionResult = browserPreviewActionFailureResult(action, new Error(message));
  emitBrowserPreviewActionFailure(session, action, tabId, actionResult);
  return { session, tabId, actionResult };
}

async function applyBrowserBridgeAction(action: BrowserActionPayload): Promise<{ readonly session: BrowserPreviewSession; readonly tabId?: string; readonly actionResult?: BrowserPreviewActionResult }> {
  const session = await ensureBrowserPreviewSession(action.sessionId);
  if (action.type === "select-tab") {
    return applyBrowserAction(action);
  }
  const page = browserPreviewPageFor(session, action.tabId);
  const tabId = session.pageIds.get(page) ?? session.activeTabId;
  if (session.freshness === "dirty") {
    if (!session.dirtyUrl) {
      return staleBrowserPreviewActionResult(session, action, tabId, "Preview mirror is stale; manual sync required.");
    }
    markBrowserPreviewFreshness(session, "syncing", session.freshnessReason, session.dirtyUrl);
    await navigateBrowserPreview(session, page, session.dirtyUrl);
    markBrowserPreviewSynced(session);
  } else if (session.freshness === "blocked" || session.freshness === "error") {
    return staleBrowserPreviewActionResult(session, action, tabId, "Preview mirror is stale; manual sync required.");
  } else if (session.freshness === "syncing") {
    return staleBrowserPreviewActionResult(session, action, tabId, "Preview mirror is syncing; retry after sync finishes.");
  }
  return applyBrowserAction(action);
}

function handleBrowserBridgeAction(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    void (async () => {
      let action: BrowserActionPayload;
      try {
        action = parseBrowserActionPayload(body);
      } catch (error) {
        sendJson(res, browserPreviewErrorStatus(error), { error: errorMessage(error) });
        return;
      }
      try {
        const result = await applyBrowserBridgeAction(action);
        sendJson(res, 200, await browserPreviewState(result.session, result.tabId, result.actionResult));
      } catch (error) {
        const session = currentBrowserPreviewSession(action.sessionId);
        if (!session) {
          sendJson(res, browserPreviewErrorStatus(error), { error: errorMessage(error) });
          return;
        }
        const tabId = action.tabId && session.pages.has(action.tabId) ? action.tabId : session.activeTabId;
        const actionResult = browserPreviewActionFailureResult(action, error);
        emitBrowserPreviewActionFailure(session, action, tabId, actionResult);
        sendJson(res, 200, await browserPreviewState(session, tabId, actionResult));
      }
    })();
  });
}

function browserPreviewQuery(req: IncomingMessage): { readonly sessionId: string; readonly tabId?: string } {
  const parsed = new URL(req.url ?? "", "http://localhost");
  return {
    sessionId: normalizeBrowserPreviewSessionId(parsed.searchParams.get("sessionId")),
    tabId: optionalBrowserPreviewTabId(parsed.searchParams.get("tabId") ?? undefined),
  };
}

function handleBrowserSnapshot(req: IncomingMessage, res: ServerResponse): void {
  void (async () => {
    try {
      const query = browserPreviewQuery(req);
      const session = currentBrowserPreviewSession(query.sessionId);
      if (!session) {
        sendJson(res, 404, { error: "No browser preview session is active." });
        return;
      }
      sendJson(res, 200, await browserPreviewSnapshot(session, query.tabId));
    } catch (error) {
      sendJson(res, browserPreviewErrorStatus(error), { error: errorMessage(error) });
    }
  })();
}

function handleBrowserBridgeSnapshot(req: IncomingMessage, res: ServerResponse): void {
  void (async () => {
    try {
      const query = browserPreviewQuery(req);
      const session = currentBrowserPreviewSession(query.sessionId);
      if (!session) {
        sendJson(res, 404, { error: "No browser preview session is active." });
        return;
      }
      sendJson(res, 200, await browserPreviewState(session, query.tabId));
    } catch (error) {
      sendJson(res, browserPreviewErrorStatus(error), { error: errorMessage(error) });
    }
  })();
}

function handleBrowserEvents(req: IncomingMessage, res: ServerResponse): void {
  void (async () => {
    try {
      const query = browserPreviewQuery(req);
      const session = await ensureBrowserPreviewSession(query.sessionId);
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
      for (const event of session.events) {
        writeBrowserPreviewSseEvent(res, event);
      }
      const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000);
      session.clients.add(res);
      req.on("close", () => {
        clearInterval(heartbeat);
        session.clients.delete(res);
        res.end();
      });
    } catch (error) {
      sendJson(res, browserPreviewErrorStatus(error), { error: errorMessage(error) });
    }
  })();
}

function handleWorkspace(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === "GET") {
    try {
      sendJson(res, 200, readWorkspaceState());
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (req.method === "PUT") {
    readJsonBody(req, res, (body) => {
      try {
        const parsed = JSON.parse(body) as unknown;
        if (!isWorkspaceState(parsed)) {
          sendJson(res, 400, { error: "Invalid workspace state payload." });
          return;
        }
        const normalized = mergeWorkspacePutState(normalizeSeedProjectPaths(cloneWorkspaceState(parsed)), readWorkspaceState());
        writeWorkspaceState(normalized);
        sendJson(res, 200, normalized);
      } catch (error) {
        sendJson(res, workspacePutErrorStatus(error), { error: error instanceof Error ? error.message : String(error) });
      }
    });
    return;
  }

  res.statusCode = 405;
  res.end();
}

function handleFolderPicker(_req: IncomingMessage, res: ServerResponse): void {
  try {
    const path = pickDirectoryPathFromSystemDialog({ cwd: process.cwd() });
    sendJson(res, 200, path ? { path, name: directoryName(path) } : { path: null });
  } catch (error) {
    sendJson(res, 503, { error: error instanceof Error ? error.message : String(error) });
  }
}

function handleFolderInfo(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    try {
      const path = parseProjectDirectoryPayload(body, "path", "Project path is required.");
      if (!existsSync(path) || !statSync(path).isDirectory()) {
        sendJson(res, 400, { error: `Project directory does not exist: ${path}` });
        return;
      }
      sendJson(res, 200, { path, name: directoryName(path) });
    } catch (error) {
      sendJson(res, projectDirectoryErrorStatus(error), { error: errorMessage(error) });
    }
  });
}

/** Lists immediate subdirectories of a folder so the project dialog can offer an
 *  in-app folder browser — the OS file dialog (zenity) can't open on a headless
 *  server. Defaults to the home directory. */
function handleListDirectories(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    try {
      const raw = isRecord(body) && typeof body.path === "string" ? body.path.trim() : "";
      const base = raw ? resolve(raw) : homedir();
      if (!existsSync(base) || !statSync(base).isDirectory()) {
        sendJson(res, 400, { error: `Not a directory: ${base}` });
        return;
      }
      let entries: Array<{ readonly name: string; readonly path: string }> = [];
      try {
        entries = readdirSync(base, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
          .map((entry) => ({ name: entry.name, path: join(base, entry.name) }))
          .sort((a, b) => a.name.localeCompare(b.name));
      } catch {
        // Unreadable (permission denied) — show the folder with no children.
      }
      const parent = dirname(base);
      sendJson(res, 200, { path: base, parent: parent !== base ? parent : null, name: directoryName(base), entries });
    } catch (error) {
      sendJson(res, 500, { error: errorMessage(error) });
    }
  });
}

function handleProjectFiles(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    try {
      const cwd = parseProjectDirectoryPayload(body, "cwd", "Project directory is required.");
      if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
        sendJson(res, 400, { error: `Project directory does not exist: ${cwd}` });
        return;
      }
      sendJson(res, 200, { files: listMentionableFilesFromDisk(cwd) });
    } catch (error) {
      sendJson(res, projectDirectoryErrorStatus(error), { error: errorMessage(error) });
    }
  });
}

function handleAttachmentUpload(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    try {
      const parsed = parseAttachmentUploadPayload(body);
      const buffer = Buffer.from(parsed.dataBase64, "base64");
      if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
        sendJson(res, 413, { error: "Attachment exceeds the 25MB limit." });
        return;
      }
      mkdirSync(ATTACHMENTS_DIR, { recursive: true });
      const safeName = parsed.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80) || "file";
      const fileName = `${Math.random().toString(36).slice(2, 10)}-${safeName}`;
      const filePath = join(ATTACHMENTS_DIR, fileName);
      writeFileSync(filePath, buffer);
      sendJson(res, 200, { path: filePath, name: parsed.name, mimeType: parsed.mimeType ?? "application/octet-stream" });
    } catch (error) {
      sendJson(res, attachmentUploadErrorStatus(error), { error: errorMessage(error) });
    }
  });
}

const LOCAL_FILE_CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  json: "application/json; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  log: "text/plain; charset=utf-8",
};

/** Serves a local file (agent screenshot, pasted attachment) so the browser can
 *  render it. Read-only; resolves symlinks and refuses directories. The tool is
 *  a local, single-user app bound to localhost, matching the existing Git/file
 *  viewers that already read arbitrary files in the workspace. */
function handleLocalFile(req: IncomingMessage, res: ServerResponse): void {
  try {
    const url = new URL(req.url ?? "", "http://localhost");
    const requested = url.searchParams.get("path") ?? "";
    if (!requested || !isAbsolute(requested)) {
      sendJson(res, 400, { error: "An absolute file path is required." });
      return;
    }
    const realPath = resolve(requested);
    if (!existsSync(realPath)) {
      sendJson(res, 404, { error: "File not found." });
      return;
    }
    const stat = statSync(realPath);
    if (!stat.isFile()) {
      sendJson(res, 400, { error: "Not a file." });
      return;
    }
    if (stat.size > MAX_ATTACHMENT_BYTES) {
      sendJson(res, 413, { error: "File is too large to preview." });
      return;
    }
    const ext = (realPath.split(".").pop() ?? "").toLowerCase();
    const contentType = LOCAL_FILE_CONTENT_TYPES[ext] ?? "application/octet-stream";
    const download = url.searchParams.get("download") === "1";
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader("Cache-Control", "private, max-age=60");
    if (download || contentType === "application/octet-stream") {
      res.setHeader("Content-Disposition", `attachment; filename="${basename(realPath).replace(/[^a-zA-Z0-9._-]+/g, "_")}"`);
    }
    res.end(readFileSync(realPath));
  } catch (error) {
    sendJson(res, 500, { error: errorMessage(error) });
  }
}

const DIST_INDEX_FILE = join(PLUGIN_DIR, "dist", "index.html");

/** A build identity derived from the served index.html (it references the hashed
 *  asset bundles, so it changes exactly when a new build is deployed). The client
 *  polls this and reloads when it changes, so a long-lived SPA tab can't keep
 *  running stale JS after a deploy. Falls back to "dev" when there is no dist. */
function handleVersion(_req: IncomingMessage, res: ServerResponse): void {
  try {
    const stat = statSync(DIST_INDEX_FILE);
    sendJson(res, 200, { version: `${Math.round(stat.mtimeMs)}-${stat.size}` });
  } catch {
    sendJson(res, 200, { version: "dev" });
  }
}

/** Returns the latest known account rate-limit snapshot per agent (keyed by
 *  agent id). Empty until an agent reports one during a run. */
function handleAgentLimits(_req: IncomingMessage, res: ServerResponse): void {
  sendJson(res, 200, { limits: Object.fromEntries(latestAgentLimits.entries()) });
}

function handleAgentConfig(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === "GET") {
    try {
      const config = readAgentSecretConfig();
      const agents = Object.fromEntries(
        Object.entries(DETECT)
          .filter(([, detect]) => detect.env?.[0])
          .map(([agent, detect]) => {
            const envVar = detect.env?.[0] ?? "";
            return [agent, { envVar, configured: hasConfiguredAgentAuth(detect, config) }];
          }),
      );
      sendJson(res, 200, { agents });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (req.method === "PUT") {
    readJsonBody(req, res, (body) => {
      try {
        const { agent, apiKey } = parseAgentConfigPayload(body);
        const envVar = DETECT[agent]?.env?.[0];
        if (!envVar) {
          sendJson(res, 400, { error: `Agent ${agent} does not accept API key configuration.` });
          return;
        }
        const config = readAgentSecretConfig();
        writeAgentSecretConfig({ env: { ...config.env, [envVar]: apiKey } });
        sendJson(res, 200, { ok: true, agent, envVar, configured: true });
      } catch (error) {
        sendJson(res, agentConfigErrorStatus(error), { error: errorMessage(error) });
      }
    });
    return;
  }

  res.statusCode = 405;
  res.end();
}

// Run an install command to completion and only respond once we know whether it
// actually succeeded — so the UI can report real success/failure and refresh
// agent/browser status afterwards (rather than reporting a fire-and-forget spawn).
function runInstallToCompletion(launch: { readonly command: string; readonly args: readonly string[]; readonly displayCommand: string }, res: ServerResponse, extra: Record<string, unknown> = {}): void {
  let responded = false;
  const respond = (status: number, payload: unknown) => {
    if (responded) {
      return;
    }
    responded = true;
    sendJson(res, status, payload);
  };
  let stderrTail = "";
  const child = spawn(launch.command, [...launch.args], {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrTail = `${stderrTail}${chunk.toString("utf8")}`.slice(-4000);
  });
  child.on("error", (error) => {
    respond(500, { error: error.message, command: launch.displayCommand, ...extra });
  });
  child.on("close", (code) => {
    if (code === 0) {
      respond(200, { ok: true, command: launch.displayCommand, ...extra });
      return;
    }
    respond(500, { error: stderrTail.trim() || `Install command exited with code ${code ?? "unknown"}.`, command: launch.displayCommand, ...extra });
  });
}

function handleAgentInstall(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    try {
      const { agent } = parseAgentInstallPayload(body);
      const command = INSTALL_COMMANDS[agent];
      if (!command) {
        sendJson(res, 400, { error: `No install command is configured for ${agent}.` });
        return;
      }
      const launch = resolveAgentInstallLaunch(agent);
      if (!launch) {
        sendJson(res, 500, { error: `Install executable ${command[0]} was not found on PATH.` });
        return;
      }
      runInstallToCompletion(launch, res, { agent });
    } catch (error) {
      sendJson(res, agentInstallErrorStatus(error), { error: errorMessage(error) });
    }
  });
}

function handlePlaywrightInstall(_req: IncomingMessage, res: ServerResponse): void {
  if (isPlaywrightBrowserInstalled()) {
    sendJson(res, 200, { ok: true, alreadyInstalled: true, command: PLAYWRIGHT_INSTALL_COMMAND.join(" ") });
    return;
  }
  const launch = resolveInstallLaunch([...PLAYWRIGHT_INSTALL_COMMAND]);
  if (!launch) {
    sendJson(res, 500, { error: `Install executable ${PLAYWRIGHT_INSTALL_COMMAND[0]} was not found on PATH.` });
    return;
  }
  runInstallToCompletion(launch, res, { installed: true });
}

function handleRunApproval(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    try {
      const decision = parseRunApprovalPayload(body);
      const resolved = resolvePendingRunApproval(decision);
      appendRunAuditEvent(RUN_AUDIT_FILE, { type: "approval_decision", id: resolved.id, decision: resolved.decision });
      writeWorkspaceState(applyRunApprovalDecisionState(readWorkspaceState(), resolved));
      sendJson(res, 200, resolved);
    } catch (error) {
      sendJson(res, runControlErrorStatus(error), { error: errorMessage(error) });
    }
  });
}

function handleRunInput(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    try {
      const selection = parseRunInputPayload(body);
      const resolved = resolvePendingRunInput(selection);
      writeWorkspaceState(applyRunInputSelectionState(readWorkspaceState(), resolved));
      sendJson(res, 200, resolved);
    } catch (error) {
      sendJson(res, runControlErrorStatus(error), { error: errorMessage(error) });
    }
  });
}

function handleGitStatus(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    try {
      const { cwd } = parseGitCwdPayload(body);
      const validation = validateGitCwd(cwd);
      if (validation) {
        sendJson(res, 400, { error: validation });
        return;
      }

      respondWithGitStatus(cwd, res);
    } catch (error) {
      sendJson(res, gitErrorStatus(error), { error: errorMessage(error) });
    }
  });
}

interface GitCommandResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly error: string;
}

function validateGitCwd(cwd: string): string | null {
  if (!cwd) {
    return "Project directory is required.";
  }
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    return `Project directory does not exist: ${cwd}`;
  }
  return null;
}

function validateGitPath(path: string): string | null {
  if (!path) {
    return "Git file path is required.";
  }
  if (path.includes("\0")) {
    return "Git file path contains an invalid null byte.";
  }
  return null;
}

function parseJsonObjectPayload(body: string, errorMessage: string): Record<string, unknown> {
  const parsed = JSON.parse(body || "{}") as unknown;
  if (!isRecord(parsed)) {
    throw new Error(errorMessage);
  }
  return parsed;
}

const gitBadRequestMessages = new Set([
  "Invalid git request payload.",
  "Project directory is required.",
  "Git file path is required.",
  "Git file path contains an invalid null byte.",
  "Commit message is required.",
]);

export function gitErrorStatus(error: unknown): 400 | 500 {
  return error instanceof SyntaxError || gitBadRequestMessages.has(errorMessage(error)) ? 400 : 500;
}

export function gitPushRequestErrorStatus(error: unknown): 400 | 500 {
  return gitErrorStatus(error);
}

export function parseGitCwdPayload(body: string): { readonly cwd: string } {
  const parsed = parseJsonObjectPayload(body, "Invalid git request payload.");
  const cwd = typeof parsed.cwd === "string" ? parsed.cwd.trim() : "";
  if (!cwd) {
    throw new Error("Project directory is required.");
  }
  return { cwd };
}

export function parseGitFilePayload(body: string): { readonly cwd: string; readonly path: string; readonly mode: "staged" | "worktree" } {
  const parsed = parseJsonObjectPayload(body, "Invalid git request payload.");
  const cwd = typeof parsed.cwd === "string" ? parsed.cwd.trim() : "";
  const path = typeof parsed.path === "string" ? parsed.path.trim() : "";
  if (!cwd) {
    throw new Error("Project directory is required.");
  }
  const pathError = validateGitPath(path);
  if (pathError) {
    throw new Error(pathError);
  }
  return { cwd, path, mode: parsed.mode === "staged" ? "staged" : "worktree" };
}

export function parseGitCommitPayload(body: string): { readonly cwd: string; readonly message: string } {
  const parsed = parseJsonObjectPayload(body, "Invalid git request payload.");
  const cwd = typeof parsed.cwd === "string" ? parsed.cwd.trim() : "";
  if (!cwd) {
    throw new Error("Project directory is required.");
  }
  const message = typeof parsed.message === "string" ? parsed.message.trim() : "";
  if (!message) {
    throw new Error("Commit message is required.");
  }
  return { cwd, message };
}

export function buildGitCommitArgs(message: string): string[] {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error("Commit message is required.");
  }
  return ["commit", "-m", trimmed];
}

export function buildGitPushArgs(): string[] {
  return ["push"];
}

function runGit(cwd: string, args: readonly string[], onDone: (result: GitCommandResult) => void): void {
  const child = spawn("git", ["-C", cwd, ...args], {
    cwd,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (!child.stdout || !child.stderr) {
    onDone({ ok: false, stdout: "", error: "Git command streams are unavailable." });
    return;
  }

  let stdout = "";
  let stderr = "";
  let done = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.on("error", (error) => {
    if (!done) {
      done = true;
      onDone({ ok: false, stdout, error: error.message });
    }
  });
  child.on("close", (code) => {
    if (done) {
      return;
    }
    done = true;
    if (code !== 0) {
      onDone({ ok: false, stdout, error: stderr.trim() || `git ${args[0] ?? "command"} exited with code ${code ?? "unknown"}.` });
      return;
    }
    onDone({ ok: true, stdout, error: "" });
  });
}

function respondWithGitStatus(cwd: string, res: ServerResponse): void {
  runGit(cwd, ["status", "--porcelain=v1", "-b"], (statusResult) => {
    if (!statusResult.ok) {
      sendJson(res, 500, { error: statusResult.error });
      return;
    }
    const payload = parseGitStatusPorcelain(statusResult.stdout);
    // A second cheap pass for unstaged line totals (the header badge shows +/-).
    runGit(cwd, ["diff", "--numstat"], (numstatResult) => {
      const totals = numstatResult.ok ? parseNumstatTotals(numstatResult.stdout) : { additions: 0, deletions: 0 };
      // A third pass for the latest commit hash and title shown in the Git panel header.
      runGit(cwd, ["log", "-1", "--pretty=format:%h\n%s"], (logResult) => {
        const lines = logResult.ok ? logResult.stdout.split("\n") : [];
        const commitHash = lines[0]?.trim() || undefined;
        const commitTitle = lines.slice(1).join("\n").trim() || undefined;
        sendJson(res, 200, { ...payload, unstagedAdditions: totals.additions, unstagedDeletions: totals.deletions, commitHash, commitTitle });
      });
    });
  });
}

function sendGitStatusAfterMutation(cwd: string, res: ServerResponse): void {
  respondWithGitStatus(cwd, res);
}

function runGitP(cwd: string, args: readonly string[]): Promise<GitCommandResult> {
  return new Promise((resolve) => runGit(cwd, args, resolve));
}

/** Creates an isolated git worktree off the current HEAD on a fresh branch. The
 *  worktree dir lives in a sibling `<repo>.worktrees/` folder so it never shows
 *  up as an untracked path inside the repo itself. */
function handleGitWorktreeCreate(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    void (async () => {
      try {
        const parsed = parseJsonObjectPayload(body, "Invalid git request payload.");
        const cwd = typeof parsed.cwd === "string" ? parsed.cwd : "";
        const cwdError = validateGitCwd(cwd);
        if (cwdError) {
          sendJson(res, 400, { error: cwdError });
          return;
        }
        const leaf = `wt-${Date.now().toString(36)}`;
        const branch = `kanban/${leaf}`;
        const path = join(dirname(cwd), `${basename(cwd)}.worktrees`, leaf);
        const result = await runGitP(cwd, ["worktree", "add", "-b", branch, path]);
        if (!result.ok) {
          sendJson(res, 500, { error: result.error });
          return;
        }
        sendJson(res, 200, { path, branch });
      } catch (error) {
        sendJson(res, gitErrorStatus(error), { error: errorMessage(error) });
      }
    })();
  });
}

/** Commits any pending work in the worktree, merges its branch into the base
 *  repo's current branch, then removes the worktree and deletes the branch. */
function handleGitWorktreeMerge(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    void (async () => {
      try {
        const parsed = parseJsonObjectPayload(body, "Invalid git request payload.");
        const base = typeof parsed.base === "string" ? parsed.base : "";
        const worktreePath = typeof parsed.worktreePath === "string" ? parsed.worktreePath : "";
        const baseError = validateGitCwd(base);
        if (baseError) {
          sendJson(res, 400, { error: baseError });
          return;
        }
        const wtError = validateGitCwd(worktreePath);
        if (wtError) {
          sendJson(res, 400, { error: wtError });
          return;
        }
        const branchResult = await runGitP(worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"]);
        if (!branchResult.ok) {
          sendJson(res, 500, { error: branchResult.error });
          return;
        }
        const branch = branchResult.stdout.trim();
        // Stage + commit any pending work (a no-op commit just fails harmlessly).
        await runGitP(worktreePath, ["add", "-A"]);
        await runGitP(worktreePath, ["commit", "-m", "Kanban: worktree changes"]);
        const mergeResult = await runGitP(base, ["merge", "--no-ff", "-m", `Kanban: merge ${branch}`, branch]);
        if (!mergeResult.ok) {
          // Leave the worktree intact so the user can resolve and retry.
          sendJson(res, 409, { error: mergeResult.error });
          return;
        }
        await runGitP(base, ["worktree", "remove", "--force", worktreePath]);
        await runGitP(base, ["branch", "-D", branch]);
        sendGitStatusAfterMutation(base, res);
      } catch (error) {
        sendJson(res, gitErrorStatus(error), { error: errorMessage(error) });
      }
    })();
  });
}

function handleGitDiff(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    try {
      const { cwd, path, mode } = parseGitFilePayload(body);
      const cwdError = validateGitCwd(cwd);
      if (cwdError) {
        sendJson(res, 400, { error: cwdError });
        return;
      }
      const args = mode === "staged" ? ["diff", "--cached", "--", path] : ["diff", "--", path];
      runGit(cwd, args, (result) => {
        if (!result.ok) {
          sendJson(res, 500, { error: result.error });
          return;
        }
        sendJson(res, 200, { path, mode, diff: result.stdout });
      });
    } catch (error) {
      sendJson(res, gitErrorStatus(error), { error: errorMessage(error) });
    }
  });
}

function handleGitStage(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    try {
      const { cwd, path } = parseGitFilePayload(body);
      const cwdError = validateGitCwd(cwd);
      if (cwdError) {
        sendJson(res, 400, { error: cwdError });
        return;
      }
      runGit(cwd, ["add", "--", path], (result) => {
        if (!result.ok) {
          sendJson(res, 500, { error: result.error });
          return;
        }
        sendGitStatusAfterMutation(cwd, res);
      });
    } catch (error) {
      sendJson(res, gitErrorStatus(error), { error: errorMessage(error) });
    }
  });
}

function handleGitUnstage(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    try {
      const { cwd, path } = parseGitFilePayload(body);
      const cwdError = validateGitCwd(cwd);
      if (cwdError) {
        sendJson(res, 400, { error: cwdError });
        return;
      }
      runGit(cwd, ["restore", "--staged", "--", path], (result) => {
        if (!result.ok) {
          sendJson(res, 500, { error: result.error });
          return;
        }
        sendGitStatusAfterMutation(cwd, res);
      });
    } catch (error) {
      sendJson(res, gitErrorStatus(error), { error: errorMessage(error) });
    }
  });
}

function handleGitCommit(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    try {
      const { cwd, message } = parseGitCommitPayload(body);
      const cwdError = validateGitCwd(cwd);
      if (cwdError) {
        sendJson(res, 400, { error: cwdError });
        return;
      }
      const args = buildGitCommitArgs(message);
      runGit(cwd, args, (result) => {
        if (!result.ok) {
          sendJson(res, 500, { error: result.error });
          return;
        }
        sendGitStatusAfterMutation(cwd, res);
      });
    } catch (error) {
      sendJson(res, gitErrorStatus(error), { error: errorMessage(error) });
    }
  });
}

function handleGitInit(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    try {
      const { cwd } = parseGitCwdPayload(body);
      const cwdError = validateGitCwd(cwd);
      if (cwdError) {
        sendJson(res, 400, { error: cwdError });
        return;
      }
      // `git init` is idempotent — initialises a repo with Git's defaults.
      runGit(cwd, ["init"], (result) => {
        if (!result.ok) {
          sendJson(res, 500, { error: result.error });
          return;
        }
        sendGitStatusAfterMutation(cwd, res);
      });
    } catch (error) {
      sendJson(res, gitErrorStatus(error), { error: errorMessage(error) });
    }
  });
}

function handleGitPush(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    try {
      const { cwd } = parseGitCwdPayload(body);
      const cwdError = validateGitCwd(cwd);
      if (cwdError) {
        sendJson(res, 400, { error: cwdError });
        return;
      }
      runGit(cwd, buildGitPushArgs(), (result) => {
        if (!result.ok) {
          sendJson(res, 500, { error: result.error });
          return;
        }
        sendGitStatusAfterMutation(cwd, res);
      });
    } catch (error) {
      sendJson(res, gitPushRequestErrorStatus(error), { error: errorMessage(error) });
    }
  });
}

function parseTerminalPayload(body: string): { readonly cwd: string; readonly command: string } {
  const parsed = parseJsonObjectPayload(body, "Invalid terminal request payload.");
  const cwd = typeof parsed.cwd === "string" ? parsed.cwd.trim() : "";
  const command = typeof parsed.command === "string" ? parsed.command : "";
  if (!cwd) {
    throw new Error("Project directory is required.");
  }
  if (!command.trim()) {
    throw new Error("Command is required.");
  }
  return { cwd, command };
}

/** Runs one shell command in the chat folder and streams its output as NDJSON
 *  ({type:"out"|"err",chunk} … {type:"exit",code}). Stateless per command — an
 *  explicit user-driven shell, so a real (login) shell is fine here. */
function handleTerminal(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    let cwd: string;
    let command: string;
    try {
      ({ cwd, command } = parseTerminalPayload(body));
      const cwdError = validateGitCwd(cwd);
      if (cwdError) {
        sendJson(res, 400, { error: cwdError });
        return;
      }
    } catch (error) {
      sendJson(res, gitErrorStatus(error), { error: errorMessage(error) });
      return;
    }

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-store");
    const write = (event: Record<string, unknown>) => {
      res.write(`${JSON.stringify(event)}\n`);
    };

    const shell = process.env.SHELL || "/bin/bash";
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(shell, ["-lc", command], { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      write({ type: "err", chunk: error instanceof Error ? error.message : String(error) });
      write({ type: "exit", code: 1 });
      res.end();
      return;
    }
    let done = false;
    child.stdout?.on("data", (chunk: Buffer) => write({ type: "out", chunk: chunk.toString() }));
    child.stderr?.on("data", (chunk: Buffer) => write({ type: "err", chunk: chunk.toString() }));
    child.on("error", (error) => write({ type: "err", chunk: error.message }));
    child.on("close", (code) => {
      done = true;
      write({ type: "exit", code: code ?? 0 });
      res.end();
    });
    // Abort the command only if the client disconnects before it finishes (the
    // request stream closing on its own must not kill a still-running command).
    res.on("close", () => {
      if (!done && !child.killed) {
        child.kill();
      }
    });
  });
}

/* ------------------------------ Real agent run ------------------------------ */

export type RunEvent =
  | { type: "start" }
  | { type: "reasoning"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; summary?: string; args?: Record<string, string> }
  | { type: "tool_result"; id: string; ok: boolean; output: string }
  | { type: "diff"; id?: string; file: string; additions: number; deletions: number; lines: DiffBlock["lines"] }
  | { type: "plan"; id?: string; steps: PlanBlock["steps"] }
  | { type: "code"; language: string; code: string }
  | { type: "search"; id?: string; query: string; state: RunState; results?: SearchBlock["results"] }
  | { type: "suggested"; actions: SuggestedActionsBlock["actions"] }
  | { type: "approval"; id: string; title: string; detail?: string }
  | { type: "options"; id: string; prompt: string; multi?: boolean; options: ReadonlyArray<{ readonly id: string; readonly label: string; readonly description?: string }> }
  | { type: "status"; level: "info" | "ok" | "warn" | "error"; text: string }
  | { type: "error"; text: string }
  | { type: "session"; id: string }
  | { type: "done"; costUsd?: number; usage?: RunUsage };

type ApprovalDecision = "approved" | "rejected";

interface RunApprovalDecision {
  readonly id: string;
  readonly decision: ApprovalDecision;
}

interface RunInputSelection {
  readonly id: string;
  readonly selected: readonly string[];
}

interface RunCancelRequest {
  readonly runId: string;
}

interface RunRequest {
  readonly agent: string;
  readonly model: string;
  readonly reasoning: string;
  readonly mode: AgentProfile["mode"];
  readonly prompt: string;
  readonly accessMode: AgentAccessMode;
  /** Native session id to resume (same agent continuing the conversation). */
  readonly resume?: string;
  /** Server-assigned session id for a NEW session (agents that let us set it,
   *  e.g. Gemini `--session-id`). Agents that mint their own id ignore this. */
  readonly sessionId?: string;
}

/** The latest account rate-limit snapshot reported by an agent, surfaced in the
 *  composer. Claude emits `rate_limit` stream events; Codex answers an
 *  `account/rateLimits/read` request. Fields are optional — each agent reports
 *  a different subset. */
interface AgentRateLimit {
  readonly updatedAt: number;
  /** "allowed" while under the limit (Claude). */
  readonly status?: string;
  /** Window the snapshot describes, e.g. "five_hour" / "weekly" (Claude). */
  readonly windowType?: string;
  /** Epoch seconds when the current window resets (Claude). */
  readonly resetsAt?: number;
  /** Percent of the primary/secondary window used (Codex). */
  readonly usedPercent?: number;
  readonly secondaryPercent?: number;
  /** Subscription plan label (Codex). */
  readonly plan?: string;
}

const latestAgentLimits = new Map<string, AgentRateLimit>();

function recordClaudeRateLimit(agent: string, info: Record<string, unknown>): void {
  const rateLimitType = typeof info.rateLimitType === "string" ? info.rateLimitType : undefined;
  latestAgentLimits.set(agent, {
    updatedAt: Date.now(),
    status: typeof info.status === "string" ? info.status : undefined,
    // Normalize the various weekly windows to "weekly"; keep five_hour as-is.
    windowType: rateLimitType ? (rateLimitType.startsWith("seven_day") ? "weekly" : rateLimitType) : undefined,
    resetsAt: typeof info.resetsAt === "number" ? info.resetsAt : undefined,
    usedPercent: typeof info.utilization === "number" ? info.utilization : undefined,
  });
}

interface RunArgsRequest {
  readonly prompt: string;
  readonly model?: string;
  readonly reasoning?: string;
  readonly mode?: AgentProfile["mode"];
  readonly accessMode?: AgentAccessMode;
  readonly resume?: string;
  readonly sessionId?: string;
}

// The in-app Preview tab is native iframe UI for the user; the /bridge endpoints
// expose the Playwright mirror to agents with a dirty-aware freshness contract.

export interface BackgroundRunBinding {
  readonly conversationId: string;
  readonly runId: string;
  readonly userMessageId: string;
  readonly userMessageTime: string;
  readonly agentMessageId: string;
  readonly agentMessageTime: string;
}

export interface ActiveBackgroundRunSnapshot {
  readonly runId: string;
  readonly conversationId: string;
  readonly userMessageId: string;
  readonly agentMessageId: string;
  readonly startedAt: string;
}

export interface ActiveBackgroundRunUpdate {
  readonly runId: string;
  readonly conversationId: string;
  readonly agentMessageId: string;
  readonly status: ConversationStatus;
  readonly snippet: string;
  readonly time: string;
  readonly done: boolean;
  readonly blocks: readonly AgentBlock[];
  readonly costUsd?: number;
  readonly usage?: RunUsage;
}

type BackgroundRunSubscriber = (update: ActiveBackgroundRunUpdate) => void;

export interface BackgroundRunHandle {
  readonly binding: BackgroundRunBinding;
  readonly startedAt: string;
  readonly cancel: () => void;
  subscribers?: Set<BackgroundRunSubscriber>;
}

interface StreamingTool {
  id: string;
  name: string;
  summary?: string;
  args?: Record<string, string>;
  state: "running" | "ok" | "error";
  output?: string;
}

interface StreamingSearch {
  id?: string;
  query: string;
  state: RunState;
  results: SearchBlock["results"];
}

interface StreamingPlan {
  id?: string;
  steps: PlanBlock["steps"];
}

interface BackgroundRunAccumulator {
  reasoning: string;
  hasReasoning: boolean;
  started: boolean;
  text: string;
  hasText: boolean;
  readonly tools: StreamingTool[];
  // Reasoning, narration text, tools, searches, and code in arrival order, so the
  // UI can render them interleaved chronologically. Mirrors the frontend
  // accumulator in run-agent.ts; both MUST stay in sync or reloaded (persisted)
  // conversations render differently from the live ones.
  readonly timeline: Array<
    | { kind: "reasoning"; text: string }
    | { kind: "text"; text: string }
    | { readonly kind: "tool"; readonly tool: StreamingTool }
    | { readonly kind: "search"; readonly search: StreamingSearch }
    | { readonly kind: "code"; readonly data: CodeBlockData }
  >;
  readonly diffs: DiffBlock[];
  readonly plans: StreamingPlan[];
  readonly codes: CodeBlockData[];
  readonly searches: StreamingSearch[];
  readonly suggested: SuggestedActionsBlock[];
  readonly approvals: Array<{ id: string; title: string; detail?: string }>;
  readonly options: Array<{ id: string; prompt: string; multi?: boolean; options: ReadonlyArray<{ readonly id: string; readonly label: string; readonly description?: string }> }>;
  readonly statuses: Array<{ level: "warn" | "error"; text: string }>;
  costUsd?: number;
  usage?: RunUsage;
  done: boolean;
  readonly start: number;
}

interface RunSpec {
  readonly bin: string;
  readonly env?: readonly string[];
  readonly args: (request: RunRequest) => string[];
  readonly createTranslator: () => (line: string) => RunEvent[];
}

const CLAUDE_SAFE_READ_TOOLS = ["Read", "Glob", "Grep", "LS"] as const;
const CLAUDE_READ_ONLY_TOOLS = [...CLAUDE_SAFE_READ_TOOLS, "AskUserQuestion"] as const;
const CLAUDE_EFFORT_LEVELS = new Set<EffortLevel>(["low", "medium", "high", "xhigh", "max"]);
const CLAUDE_CHAT_UI_SYSTEM_PROMPT = [
  "When you need user input that blocks progress, use the AskUserQuestion tool instead of asking as plain text.",
  "Use AskUserQuestion for concrete choices, clarifying questions, or option selection that the chat UI should render as interactive controls.",
  "Do not create a numbered question list in prose when the question can be represented with AskUserQuestion options.",
].join("\n");
const CODEX_PLAN_PROMPT_PREFIX = [
  "Plan mode is active.",
  "Do not modify files or run commands that write to the filesystem.",
  "Inspect the workspace as needed, then respond with a concise implementation plan.",
  "",
].join("\n");

function browserBridgeOrigin(req: IncomingMessage): string {
  const host = typeof req.headers.host === "string" && req.headers.host.trim().length > 0 ? req.headers.host.trim() : "localhost:5187";
  const forwardedProto = typeof req.headers["x-forwarded-proto"] === "string" ? req.headers["x-forwarded-proto"].split(",")[0]?.trim() : "";
  const protocol = forwardedProto === "https" ? "https" : "http";
  return `${protocol}://${host}`;
}

function browserBridgePromptAppendix(sessionId: string, origin: string): string {
  return [
    "",
    "<browser-preview-bridge>",
    "The app's Preview tab is a native iframe for the user and a Playwright mirror for you. Use the bridge only when the task asks you to inspect or operate the in-app browser.",
    `Base URL: ${origin}`,
    `sessionId: ${sessionId}`,
    `Snapshot: GET ${origin}/api/browser/bridge/snapshot?sessionId=${encodeURIComponent(sessionId)}`,
    `Action: POST ${origin}/api/browser/bridge/action with JSON {"sessionId":"${sessionId}","type":"..."}.`,
    "Always read snapshot.domTargets first and choose typed actions from DOM targets before coordinates.",
    "Freshness contract: snapshot.freshness is synced, dirty, blocked, syncing, or error. If an action returns actionResult.ok=false, read actionResult.error and refresh the snapshot. Do not treat bridge failures as permission denials.",
    "If actionResult.error says the preview mirror is stale or manual sync is required, stop browser actions and ask the user to sync Preview.",
    "Preferred action order: fill, check, uncheck, select, click, press, scroll, wait-for. Use type only to append text. Use x/y coordinates only for canvas or custom widgets without a DOM target.",
    "Tabs: use snapshot.activeTabId and snapshot.tabs. Use select-tab before intentionally working in a non-active tab; include tabId only for that explicit tab.",
    "Supported actions: navigate, go-back, go-forward, refresh, scroll, click, fill, clear, check, uncheck, select, wait-for, hover, type, press, eval, select-tab.",
    "Example fill: {\"sessionId\":\"...\",\"type\":\"fill\",\"target\":{\"selector\":\"textarea\"},\"text\":\"hello\"}.",
    "Example wait: {\"sessionId\":\"...\",\"type\":\"wait-for\",\"target\":{\"role\":\"button\",\"name\":\"Save\"},\"state\":\"visible\"}.",
    "</browser-preview-bridge>",
  ].join("\n");
}

function appendBrowserBridgePrompt(prompt: string, binding: BackgroundRunBinding | null, origin: string): string {
  return binding ? `${prompt}${browserBridgePromptAppendix(binding.conversationId, origin)}` : prompt;
}

function profileForArgs(agent: AgentProfile["agent"], request: RunArgsRequest): AgentProfile {
  return normalizeAgentProfile(
    {
      agent,
      model: request.model ?? "default",
      reasoning: request.reasoning ?? "default",
      mode: request.mode ?? "default",
    },
    agent,
  );
}

function modelForProfile(profile: AgentProfile): string | undefined {
  return resolveAgentModelValue(profile.agent, profile.model) ?? (profile.model !== DEFAULT_AGENT_OPTION_ID && isDirectAgentModelValue(profile.agent, profile.model) ? profile.model : undefined);
}

function reasoningForProfile(profile: AgentProfile): string | undefined {
  return resolveAgentReasoningValue(profile.agent, profile.reasoning);
}

function modeForProfile(profile: AgentProfile): string | undefined {
  return resolveAgentModeValue(profile.agent, profile.mode) ?? (profile.mode !== DEFAULT_AGENT_OPTION_ID && isDirectAgentModeValue(profile.agent, profile.mode) ? profile.mode : undefined);
}

function asClaudeEffort(value: string | undefined): EffortLevel | undefined {
  return value && CLAUDE_EFFORT_LEVELS.has(value as EffortLevel) ? (value as EffortLevel) : undefined;
}

function codexPromptForMode(prompt: string, mode: string | undefined): string {
  return mode === "plan" ? `${CODEX_PLAN_PROMPT_PREFIX}${prompt}` : prompt;
}

function requestedProfileError(agent: AgentProfile["agent"], model: string, reasoning: string, mode: AgentProfile["mode"]): string | null {
  const def = getAgent(agent);
  if (!def.models.some((option) => option.id === model) && !isDirectAgentModelValue(agent, model)) {
    return `Unknown model '${model}' for ${agent}.`;
  }
  if (!def.reasoning.some((option) => option.id === reasoning)) {
    return `Unknown reasoning '${reasoning}' for ${agent}.`;
  }
  if (!def.modes.some((option) => option.id === mode) && !isDirectAgentModeValue(agent, mode)) {
    return `Unknown work mode '${mode}' for ${agent}.`;
  }
  return null;
}

function parseAccessMode(value: unknown): AgentAccessMode | null {
  if (value === undefined) {
    return "read-only";
  }
  return isAgentAccessMode(value) ? value : null;
}

interface ParsedRunRequestError {
  readonly ok: false;
  readonly error: string;
}

interface ParsedRunRequestSuccess {
  readonly ok: true;
  readonly agent: string;
  readonly model: string;
  readonly reasoning: string;
  readonly mode: AgentProfile["mode"];
  readonly prompt: string;
  readonly requestedCwd: string;
  readonly accessMode: AgentAccessMode;
  readonly resume: string | undefined;
  readonly accessModeValid: boolean;
  readonly profileValid: boolean;
  readonly profileError: string;
  readonly binding: BackgroundRunBinding | null;
  readonly bindingInvalid: boolean;
}

export type ParsedRunRequestPayload = ParsedRunRequestError | ParsedRunRequestSuccess;

export function parseRunRequestPayload(body: string): ParsedRunRequestPayload {
  let agent = "";
  let model = "default";
  let reasoning = "default";
  let mode: AgentProfile["mode"] = "default";
  let prompt = "";
  let requestedCwd = "";
  let accessMode: AgentAccessMode = "read-only";
  let accessModeValid = true;
  let profileValid = true;
  let profileError = "";
  let binding: BackgroundRunBinding | null = null;
  let bindingInvalid = false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body || "{}") as unknown;
  } catch {
    return { ok: false, error: "Invalid run request payload." };
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: "Invalid run request payload." };
  }
  agent = typeof parsed.agent === "string" ? parsed.agent : "";
  const hasNewProfileFields = typeof parsed.model === "string" || typeof parsed.reasoning === "string" || typeof parsed.mode === "string";
  if (hasNewProfileFields) {
    model = typeof parsed.model === "string" ? parsed.model : "default";
    reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "default";
    mode = typeof parsed.mode === "string" && parsed.mode.trim().length > 0 ? parsed.mode.trim() : "default";
    if (parsed.mode !== undefined && (typeof parsed.mode !== "string" || parsed.mode.trim().length === 0)) {
      profileValid = false;
      profileError = "Invalid mode. Expected a work mode id string.";
    }
  } else if (typeof parsed.variant === "string" && isAgentId(agent)) {
    const legacyProfile = normalizeAgentProfile({ agent, variant: parsed.variant }, agent);
    model = legacyProfile.model;
    reasoning = legacyProfile.reasoning;
    mode = legacyProfile.mode;
  }
  prompt = typeof parsed.prompt === "string" ? parsed.prompt.trim() : "";
  const resume = typeof parsed.resume === "string" && parsed.resume.trim().length > 0 ? parsed.resume.trim() : undefined;
  requestedCwd = typeof parsed.cwd === "string" ? parsed.cwd : "";
  const parsedAccessMode = parseAccessMode(parsed.accessMode);
  if (parsedAccessMode) {
    accessMode = parsedAccessMode;
  } else {
    accessModeValid = false;
  }
  binding = backgroundBindingFromParsed(parsed);
  bindingInvalid =
    !binding &&
    ["conversationId", "runId", "userMessageId", "userMessageTime", "agentMessageId", "agentMessageTime"].some((key) => Object.hasOwn(parsed, key));
  return {
    ok: true,
    agent,
    model,
    reasoning,
    mode,
    prompt,
    requestedCwd,
    accessMode,
    resume,
    accessModeValid,
    profileValid,
    profileError,
    binding,
    bindingInvalid,
  };
}

function claudePermissionModeForRequest(request: RunRequest): ClaudeQueryOptions["permissionMode"] {
  const profile = normalizeAgentProfile(request, "claude-code");
  const mode = modeForProfile(profile);
  if (request.accessMode === "read-only" || mode === "plan") {
    return "plan";
  }
  // Unrestricted is the agent's "do anything" mode: bypass every permission gate
  // so Claude runs tools without surfacing an approval prompt.
  return "bypassPermissions";
}

function claudeToolsForRequest(request: RunRequest): ClaudeQueryOptions["tools"] {
  const profile = normalizeAgentProfile(request, "claude-code");
  const mode = modeForProfile(profile);
  if (request.accessMode === "read-only" || mode === "plan") {
    return [...CLAUDE_READ_ONLY_TOOLS];
  }
  return { type: "preset", preset: "claude_code" };
}

export function buildClaudeSdkOptions(request: RunRequest, cwd: string, abortController: AbortController, canUseTool: CanUseTool): ClaudeQueryOptions {
  const options: ClaudeQueryOptions = {
    abortController,
    allowedTools: [...CLAUDE_SAFE_READ_TOOLS],
    canUseTool,
    cwd,
    // Stream partial messages so the chat renders token-by-token; without this the
    // SDK only emits complete turns and the UI updates in one jump per turn.
    includePartialMessages: true,
    permissionMode: claudePermissionModeForRequest(request),
    systemPrompt: { type: "preset", preset: "claude_code", append: CLAUDE_CHAT_UI_SYSTEM_PROMPT },
    tools: claudeToolsForRequest(request),
  };
  const profile = normalizeAgentProfile(request, "claude-code");
  const model = modelForProfile(profile);
  if (model) {
    options.model = model;
  }
  const effort = asClaudeEffort(reasoningForProfile(profile));
  if (effort) {
    options.effort = effort;
  }
  const agentName = claudeAgentNameFromMode(modeForProfile(profile) ?? "");
  if (agentName) {
    options.agent = agentName;
  }
  if (request.resume) {
    options.resume = request.resume;
  }
  return options;
}

export function buildClaudeRunArgs(request: RunArgsRequest): string[] {
  const profile = profileForArgs("claude-code", request);
  const accessMode = request.accessMode ?? "read-only";
  const mode = modeForProfile(profile);
  const args = ["-p", request.prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
  const model = modelForProfile(profile);
  if (model) {
    args.push("--model", model);
  }
  const effort = reasoningForProfile(profile);
  if (effort) {
    args.push("--effort", effort);
  }
  const agentName = claudeAgentNameFromMode(mode ?? "");
  if (agentName) {
    args.push("--agent", agentName);
  }
  if (accessMode === "read-only" || mode === "plan") {
    args.push("--permission-mode", "plan");
  } else if (accessMode === "unrestricted") {
    // The CLI's "do anything" flag — no permission prompts at all.
    args.push("--dangerously-skip-permissions");
  }
  return args;
}

export function buildCodexRunArgs(request: RunArgsRequest): string[] {
  const profile = profileForArgs("codex", request);
  const accessMode = request.accessMode ?? "read-only";
  const mode = modeForProfile(profile);
  const planMode = mode === "plan";
  const reviewMode = mode === "review";
  // Resume a prior session continues it: `codex exec resume <id> [flags] <prompt>`.
  const args = request.resume ? ["exec", "resume", request.resume, "--json"] : reviewMode ? ["exec", "review", "--json"] : ["exec", "--json"];
  if (planMode) {
    args.push("--sandbox", "read-only");
  } else if (accessMode === "unrestricted") {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else if (!reviewMode) {
    args.push("--sandbox", "read-only");
  }
  args.push("--skip-git-repo-check");
  const model = modelForProfile(profile);
  if (model) {
    args.push("--model", model);
  }
  const reasoning = reasoningForProfile(profile);
  if (reasoning) {
    args.push("-c", `model_reasoning_effort="${reasoning}"`);
  }
  args.push(codexPromptForMode(request.prompt, mode));
  return args;
}

function geminiApprovalModeForRequest(profile: AgentProfile, accessMode: AgentAccessMode): string {
  if (accessMode !== "unrestricted") {
    return "plan";
  }
  const mode = modeForProfile(profile);
  if (mode === "plan" || mode === "auto_edit" || mode === "yolo") {
    return mode;
  }
  return "yolo";
}

export function buildGeminiRunArgs(request: RunArgsRequest): string[] {
  const profile = profileForArgs("gemini", request);
  const accessMode = request.accessMode ?? "read-only";
  const args = ["--prompt", request.prompt, "--output-format", "stream-json", "--approval-mode", geminiApprovalModeForRequest(profile, accessMode), "--skip-trust"];
  // Continue a prior session (--resume <id>) or open a new one with the
  // server-assigned id (--session-id <uuid>) so the client can resume it later.
  if (request.resume) {
    args.push("--resume", request.resume);
  } else if (request.sessionId) {
    args.push("--session-id", request.sessionId);
  }
  const model = modelForProfile(profile);
  if (model) {
    args.push("--model", model);
  }
  return args;
}

export function buildAmpRunArgs(request: RunArgsRequest): string[] {
  const args: string[] = [];
  if ((request.accessMode ?? "read-only") === "unrestricted") {
    args.push("--dangerously-allow-all");
  } else {
    args.push("--settings-file", AMP_READ_ONLY_SETTINGS_FILE);
  }
  args.push("--execute", request.prompt, "--stream-json", "--stream-json-thinking");
  return args;
}

export function buildQwenRunArgs(request: RunArgsRequest): string[] {
  const profile = profileForArgs("qwen", request);
  const accessMode = request.accessMode ?? "read-only";
  const args = ["--prompt", request.prompt, "--output-format", "stream-json", "--include-partial-messages", "--approval-mode", accessMode === "unrestricted" && profile.mode !== "plan" ? "yolo" : "plan"];
  const model = modelForProfile(profile);
  if (model) {
    args.push("--model", model);
  }
  return args;
}

export function buildCursorRunArgs(request: RunArgsRequest): string[] {
  const profile = profileForArgs("cursor", request);
  const args = ["-p", request.prompt, "--output-format", "stream-json"];
  if ((request.accessMode ?? "read-only") === "unrestricted") {
    args.push("--force");
  }
  const model = modelForProfile(profile);
  if (model) {
    args.push("--model", model);
  }
  return args;
}

function ensureAmpReadOnlySettingsFile(): void {
  mkdirSync(WORKSPACE_STATE_DIR, { recursive: true });
  const payload = {
    "amp.tools.disable": [
      "builtin:Bash",
      "builtin:create_file",
      "builtin:edit_file",
      "builtin:undo_edit",
      "Bash",
      "create_file",
      "edit_file",
      "undo_edit",
    ],
  };
  writeFileSync(AMP_READ_ONLY_SETTINGS_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function buildOpenCodeRunArgs(request: RunArgsRequest): string[] {
  const profile = profileForArgs("opencode", request);
  const args = ["run", "--format", "json", "--thinking"];
  // Continue a prior session by id (opencode mints the id; we capture it from the
  // json stream and pass it back here on the next turn).
  if (request.resume) {
    args.push("--session", request.resume);
  }
  if ((request.accessMode ?? "read-only") === "unrestricted") {
    args.push("--dangerously-skip-permissions");
  } else {
    // Read-only: opencode's default `build` agent auto-allows edits/bash, so force
    // the built-in `plan` agent, which denies file writes. (bash isn't fully
    // gated by opencode here, but this is the safe known-good restriction.)
    args.push("--agent", "plan");
  }
  const model = modelForProfile(profile);
  if (model) {
    args.push("--model", model);
  }
  const reasoning = reasoningForProfile(profile);
  if (reasoning) {
    args.push("--variant", reasoning);
  }
  args.push(request.prompt);
  return args;
}

// CLI invocation per agent. Only agents with a real adapter run; others report
// "not wired" so the UI degrades honestly.
const RUN: Record<string, RunSpec> = {
  "claude-code": {
    bin: "claude",
    args: (request) => buildClaudeRunArgs(request),
    createTranslator: createClaudeStreamTranslator,
  },
  codex: {
    bin: "codex",
    env: DETECT.codex.env,
    args: (request) => buildCodexRunArgs(request),
    createTranslator: createCodexStreamTranslator,
  },
  gemini: {
    bin: "gemini",
    env: DETECT.gemini.env,
    args: (request) => buildGeminiRunArgs(request),
    createTranslator: createGeminiStreamTranslator,
  },
  opencode: {
    bin: "opencode",
    args: (request) => buildOpenCodeRunArgs(request),
    createTranslator: createOpenCodeStreamTranslator,
  },
};

export function validateRunAccessModeForAgent(agent: string, accessMode: AgentAccessMode): string | null {
  if (agent === "cursor" && accessMode === "read-only") {
    return "Cursor CLI print mode does not provide a verifiable read-only sandbox. Switch agent access to unrestricted to run Cursor.";
  }
  return null;
}

function clip(value: unknown, max = 600): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s && s.length > max ? `${s.slice(0, max)}…` : (s ?? "");
}

function toArgs(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>).slice(0, 5)) {
    out[k] = clip(v, 160);
  }
  return out;
}

function resultText(content: unknown): string {
  if (typeof content === "string") {
    return normalizeAgentToolOutput(content);
  }
  if (Array.isArray(content)) {
    return normalizeAgentToolOutput(content.map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : clip(c, 120))).join("\n"));
  }
  return normalizeAgentToolOutput(clip(content, 600));
}

function splitDiffLines(value: string): string[] {
  if (value.length === 0) {
    return [];
  }
  return value.replace(/\r\n/g, "\n").split("\n");
}

function editPairToLines(oldText: string, newText: string): DiffBlock["lines"] {
  return [
    ...splitDiffLines(oldText).map((text) => ({ type: "del" as const, text })),
    ...splitDiffLines(newText).map((text) => ({ type: "add" as const, text })),
  ];
}

function parseMultiEditLines(value: string): DiffBlock["lines"] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    const lines: Array<{ readonly type: "add" | "del" | "ctx"; readonly text: string }> = [];
    for (const item of parsed) {
      if (!isRecord(item) || typeof item.old_string !== "string" || typeof item.new_string !== "string") {
        return null;
      }
      lines.push(...editPairToLines(item.old_string, item.new_string));
    }
    return lines;
  } catch {
    return null;
  }
}

function normalizedToolName(name: string): string {
  return name
    .replace(/^mcp__[^_]+__/, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function firstString(record: Record<string, string> | Record<string, unknown> | undefined, keys: readonly string[]): string | undefined {
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function diffBlockFromLines(file: string, lines: DiffBlock["lines"]): DiffBlock {
  return {
    kind: "diff",
    file,
    additions: lines.filter((line) => line.type === "add").length,
    deletions: lines.filter((line) => line.type === "del").length,
    lines,
  };
}

function parseUnifiedDiffLines(value: string): DiffBlock["lines"] {
  return splitDiffLines(value)
    .filter((line) => !line.startsWith("diff --git ") && !line.startsWith("index ") && !line.startsWith("--- ") && !line.startsWith("+++ ") && !line.startsWith("@@"))
    .map((line) => {
      if (line.startsWith("+")) {
        return { type: "add" as const, text: line.slice(1) };
      }
      if (line.startsWith("-")) {
        return { type: "del" as const, text: line.slice(1) };
      }
      return { type: "ctx" as const, text: line.startsWith(" ") ? line.slice(1) : line };
    });
}

function toolToDiffBlock(tool: StreamingTool): DiffBlock | null {
  if (tool.state === "error") {
    return null;
  }
  const args = tool.args;
  const file = firstString(args, ["file_path", "filePath", "path", "filename", "file"]);
  if (!file) {
    return null;
  }
  const normalizedName = normalizedToolName(tool.name);
  let lines: DiffBlock["lines"] | null = null;
  if ((normalizedName === "write" || normalizedName === "writefile" || normalizedName === "filewrite") && typeof args?.content === "string") {
    lines = splitDiffLines(args.content).map((text) => ({ type: "add", text }));
  } else if (
    (normalizedName === "edit" || normalizedName === "fileedit" || normalizedName === "replace") &&
    typeof args?.old_string === "string" &&
    typeof args?.new_string === "string"
  ) {
    lines = editPairToLines(args.old_string, args.new_string);
  } else if (normalizedName === "multiedit" && typeof args?.edits === "string") {
    lines = parseMultiEditLines(args.edits);
  } else if ((normalizedName === "applypatch" || normalizedName === "patch" || normalizedName === "fileedit") && typeof args?.diff === "string") {
    lines = parseUnifiedDiffLines(args.diff);
  }
  if (!lines) {
    return null;
  }
  return diffBlockFromLines(file, lines);
}

function diffBlockFromToolInput(name: string, input: Record<string, unknown> | undefined): DiffBlock | null {
  const file = firstString(input, ["file_path", "filePath", "path", "filename", "file"]);
  if (!file) {
    return null;
  }
  const normalizedName = normalizedToolName(name);
  let lines: DiffBlock["lines"] | null = null;
  if ((normalizedName === "write" || normalizedName === "writefile" || normalizedName === "filewrite") && typeof input?.content === "string") {
    lines = splitDiffLines(input.content).map((text) => ({ type: "add", text }));
  } else if (
    (normalizedName === "edit" || normalizedName === "fileedit" || normalizedName === "replace") &&
    typeof input?.old_string === "string" &&
    typeof input?.new_string === "string"
  ) {
    lines = editPairToLines(input.old_string, input.new_string);
  } else if (normalizedName === "multiedit" && input?.edits !== undefined) {
    lines = typeof input.edits === "string" ? parseMultiEditLines(input.edits) : parseMultiEditLines(JSON.stringify(input.edits));
  } else if ((normalizedName === "applypatch" || normalizedName === "patch" || normalizedName === "fileedit") && typeof input?.diff === "string") {
    lines = parseUnifiedDiffLines(input.diff);
  }
  return lines ? diffBlockFromLines(file, lines) : null;
}

function toolToDiffEvent(id: string | undefined, name: string, input: Record<string, unknown> | undefined): Extract<RunEvent, { type: "diff" }> | null {
  const block = diffBlockFromToolInput(name, input);
  return block ? { type: "diff", id, file: block.file, additions: block.additions, deletions: block.deletions, lines: block.lines } : null;
}

function todoState(value: unknown): RunState {
  const normalized = typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  if (normalized === "completed" || normalized === "complete" || normalized === "done" || normalized === "ok") {
    return "ok";
  }
  if (normalized === "inprogress" || normalized === "running" || normalized === "active") {
    return "running";
  }
  if (normalized === "error" || normalized === "failed" || normalized === "cancelled" || normalized === "canceled") {
    return "error";
  }
  return "pending";
}

function planStepsFromTodos(value: unknown): PlanBlock["steps"] | null {
  const todos = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.todos) ? value.todos : null;
  if (!todos) {
    return null;
  }
  const steps: Array<{ readonly label: string; readonly state: RunState }> = [];
  for (const todo of todos) {
    if (!isRecord(todo)) {
      continue;
    }
    const label = firstString(todo, ["content", "step", "title", "text", "label"]);
    if (!label) {
      continue;
    }
    steps.push({ label, state: todoState(todo.status) });
  }
  return steps.length > 0 ? steps : null;
}

function planStepsFromText(value: string): PlanBlock["steps"] {
  return value
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^[-*]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .replace(/^\[[ xX-]\]\s+/, "")
        .trim(),
    )
    .filter(Boolean)
    .map((label) => ({ label, state: "pending" as const }));
}

function toolToPlanEvent(id: string | undefined, name: string, input: Record<string, unknown> | undefined): Extract<RunEvent, { type: "plan" }> | null {
  const normalizedName = normalizedToolName(name);
  if (normalizedName === "todowrite" || normalizedName === "todo" || normalizedName === "updatetodo" || normalizedName === "updateplan") {
    const steps = planStepsFromTodos(input);
    return steps ? { type: "plan", id, steps } : null;
  }
  if (normalizedName === "exitplanmode" || normalizedName === "plan" || normalizedName === "planpresentation") {
    const plan = firstString(input, ["plan", "text", "content"]);
    if (plan) {
      return { type: "plan", id, steps: planStepsFromText(plan) };
    }
  }
  return null;
}

function toolToSearchEvent(
  id: string | undefined,
  name: string,
  input: Record<string, unknown> | undefined,
  state: RunState,
  output?: unknown,
): Extract<RunEvent, { type: "search" }> | null {
  const normalizedName = normalizedToolName(name);
  if (normalizedName !== "websearch" && normalizedName !== "search" && normalizedName !== "grep" && normalizedName !== "glob" && normalizedName !== "codesearch") {
    return null;
  }
  const query = firstString(input, ["query", "pattern", "url", "path", "glob"]) ?? name;
  return { type: "search", id, query, state, results: searchResultsFromUnknown(output) };
}

function toolToOptionsEvents(id: string | undefined, name: string, input: Record<string, unknown> | undefined): Array<Extract<RunEvent, { type: "options" }>> {
  const normalizedName = normalizedToolName(name);
  if (normalizedName !== "askuserquestion" && normalizedName !== "question") {
    return [];
  }
  const questions = input ? parseAskUserQuestionInput(input) : null;
  if (!questions) {
    return [];
  }
  return questions.map((question, index) => ({
    type: "options",
    id: `${id ?? "question"}:q${index}`,
    prompt: question.question,
    multi: question.multiSelect,
    options: question.options.map((option) => ({
      id: option.label,
      label: option.label,
      ...(option.description ? { description: option.description } : {}),
    })),
  }));
}

function searchResultsFromUnknown(value: unknown): SearchBlock["results"] {
  const parsed = typeof value === "string" ? parseJsonRecord(value) ?? value : value;
  const results: Array<{ readonly title: string; readonly url: string }> = [];
  const visit = (item: unknown): void => {
    if (results.length >= 6) {
      return;
    }
    if (Array.isArray(item)) {
      for (const entry of item) {
        visit(entry);
      }
      return;
    }
    if (!isRecord(item)) {
      return;
    }
    const url = firstString(item, ["url", "link", "href"]);
    const title = firstString(item, ["title", "name", "label"]) ?? url;
    if (url && title) {
      results.push({ title, url });
    }
    for (const key of ["results", "items", "sources", "citations"]) {
      visit(item[key]);
    }
  };
  visit(parsed);
  return results;
}

function richToolEvents(id: string | undefined, name: string, input: Record<string, unknown> | undefined, state: RunState, output?: unknown): RunEvent[] {
  const events: RunEvent[] = [];
  events.push(...toolToOptionsEvents(id, name, input));
  const plan = toolToPlanEvent(id, name, input);
  if (plan) {
    events.push(plan);
  }
  const diff = state === "error" ? null : toolToDiffEvent(id, name, input);
  if (diff) {
    events.push(diff);
  }
  const search = toolToSearchEvent(id, name, input, state, output);
  if (search) {
    events.push(search);
  }
  return events;
}

/** Tools whose input becomes a file diff. They still need a tool card for the
 *  running→ok lifecycle (a bare diff carries no state), unlike search/plan/option
 *  tools which are fully represented by their own stateful block. */
const DIFF_TOOL_NAMES = new Set(["write", "writefile", "filewrite", "edit", "fileedit", "replace", "multiedit", "applypatch", "patch"]);

function isDiffTool(name: string): boolean {
  return DIFF_TOOL_NAMES.has(normalizedToolName(name));
}

/** AskUserQuestion is owned end-to-end by the canUseTool input handler (it
 *  registers the pending request and emits the interactive options block). The
 *  stream must NOT also translate it, or the user gets a duplicate question whose
 *  answer has no pending request, plus an orphaned "running" tool card. */
function isInputTool(name: string): boolean {
  const normalized = normalizedToolName(name);
  return normalized === "askuserquestion" || normalized === "question";
}

function isApprovalDecision(value: unknown): value is ApprovalDecision {
  return value === "approved" || value === "rejected";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function parseRunApprovalPayload(body: string): RunApprovalDecision {
  const parsed = JSON.parse(body || "{}") as unknown;
  if (!isRecord(parsed) || typeof parsed.id !== "string" || parsed.id.trim().length === 0) {
    throw new Error("Approval id is required.");
  }
  if (!isApprovalDecision(parsed.decision)) {
    throw new Error("Invalid approval decision.");
  }
  return { id: parsed.id.trim(), decision: parsed.decision };
}

export function parseRunInputPayload(body: string): RunInputSelection {
  const parsed = JSON.parse(body || "{}") as unknown;
  if (!isRecord(parsed) || typeof parsed.id !== "string" || parsed.id.trim().length === 0) {
    throw new Error("Input request id is required.");
  }
  if (!isStringArray(parsed.selected)) {
    throw new Error("Selected options must be a string array.");
  }
  const selected = parsed.selected.map((item) => item.trim()).filter(Boolean);
  if (selected.length === 0) {
    throw new Error("At least one selected option is required.");
  }
  return { id: parsed.id.trim(), selected };
}

interface PendingRunApproval {
  readonly toolUseID: string;
  readonly input: Record<string, unknown>;
  readonly resolve: (result: PermissionResult) => void;
  readonly reject: (error: Error) => void;
  readonly dispose: () => void;
}

const pendingRunApprovals = new Map<string, PendingRunApproval>();

interface AskUserQuestionOption {
  readonly label: string;
  readonly description?: string;
}

interface AskUserQuestionItem {
  readonly question: string;
  readonly multiSelect: boolean;
  readonly options: readonly AskUserQuestionOption[];
}

interface PendingRunInputQuestion {
  readonly id: string;
  readonly question: AskUserQuestionItem;
  selected?: readonly string[];
}

interface PendingRunInputGroup {
  readonly toolUseID: string;
  readonly input: Record<string, unknown>;
  readonly questions: readonly PendingRunInputQuestion[];
  readonly resolve: (result: PermissionResult) => void;
  readonly reject: (error: Error) => void;
  readonly dispose: () => void;
}

const pendingRunInputs = new Map<string, PendingRunInputGroup>();

function parseAskUserQuestionOptions(value: unknown): readonly AskUserQuestionOption[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const options: AskUserQuestionOption[] = [];
  for (const option of value) {
    if (typeof option === "string") {
      const label = option.trim();
      if (label.length === 0) {
        return null;
      }
      options.push({ label });
      continue;
    }
    if (!isRecord(option)) {
      return null;
    }
    const label = firstString(option, ["label", "text", "title", "value", "id", "name"]);
    if (!label) {
      return null;
    }
    const description = firstString(option, ["description", "detail", "subtitle", "help"]);
    options.push(description ? { label, description } : { label });
  }
  return options.length > 0 ? options : null;
}

function parseAskUserQuestionItem(question: unknown): AskUserQuestionItem | null {
  if (!isRecord(question)) {
    return null;
  }
  const prompt = firstString(question, ["question", "prompt", "text", "title", "message"]);
  if (!prompt) {
    return null;
  }
  const options = parseAskUserQuestionOptions(question.options ?? question.choices ?? question.values);
  if (!options) {
    return null;
  }
  return {
    question: prompt,
    multiSelect: question.multiSelect === true || question.multi_select === true || question.multi === true || question.multiple === true,
    options,
  };
}

function parseAskUserQuestionInput(input: Record<string, unknown>): readonly AskUserQuestionItem[] | null {
  const source = Array.isArray(input.questions)
    ? input.questions
    : Array.isArray(input.items)
      ? input.items
      : Array.isArray(input.prompts)
        ? input.prompts
        : [input];
  const questions: AskUserQuestionItem[] = [];
  for (const question of source) {
    const parsed = parseAskUserQuestionItem(question);
    if (!parsed) {
      return null;
    }
    questions.push(parsed);
  }
  return questions.length > 0 ? questions : null;
}

function pendingRequestId(scopeId: string | undefined, id: string): string {
  const scope = scopeId?.trim();
  return scope ? `${scope}:${id}` : id;
}

function decisionToPermissionResult(decision: RunApprovalDecision, input: Record<string, unknown>, toolUseID: string): PermissionResult {
  if (decision.decision === "approved") {
    return { behavior: "allow", updatedInput: input, toolUseID };
  }
  return { behavior: "deny", message: "User rejected this action.", toolUseID };
}

export function resolvePendingRunApproval(decision: RunApprovalDecision): RunApprovalDecision {
  const pending = pendingRunApprovals.get(decision.id);
  if (!pending) {
    throw new Error(`No pending approval request for ${decision.id}.`);
  }
  pending.dispose();
  pending.resolve(decisionToPermissionResult(decision, pending.input, pending.toolUseID));
  return decision;
}

function questionAnswer(question: AskUserQuestionItem, selected: readonly string[]): string | readonly string[] {
  return question.multiSelect ? selected : selected[0] ?? "";
}

function runInputAnswers(group: PendingRunInputGroup): Record<string, string | readonly string[]> {
  const answers: Record<string, string | readonly string[]> = {};
  for (const item of group.questions) {
    if (item.selected) {
      answers[item.question.question] = questionAnswer(item.question, item.selected);
    }
  }
  return answers;
}

export function resolvePendingRunInput(selection: RunInputSelection): RunInputSelection {
  const pending = pendingRunInputs.get(selection.id);
  if (!pending) {
    throw new Error(`No pending input request for ${selection.id}.`);
  }
  const question = pending.questions.find((item) => item.id === selection.id);
  if (!question) {
    throw new Error(`No pending input request for ${selection.id}.`);
  }
  const allowedLabels = new Set(question.question.options.map((option) => option.label));
  const selected = selection.selected.filter((label) => allowedLabels.has(label));
  if (selected.length === 0) {
    throw new Error("Selected options do not match the pending question.");
  }
  question.selected = selected;

  if (pending.questions.every((item) => item.selected && item.selected.length > 0)) {
    pending.dispose();
    pending.resolve({
      behavior: "allow",
      updatedInput: {
        ...pending.input,
        answers: runInputAnswers(pending),
      },
      toolUseID: pending.toolUseID,
    });
  }

  return { id: selection.id, selected };
}

export function parseRunCancelPayload(body: string): RunCancelRequest {
  const parsed = JSON.parse(body || "{}") as unknown;
  if (!isRecord(parsed) || typeof parsed.runId !== "string" || parsed.runId.trim().length === 0) {
    throw new Error("Run id is required.");
  }
  return { runId: parsed.runId.trim() };
}

function createRunInputHandler(input: Record<string, unknown>, context: Parameters<CanUseTool>[2], send: (event: RunEvent) => void, scopeId?: string): Promise<PermissionResult> | null {
  const questions = parseAskUserQuestionInput(input);
  if (!questions) {
    return null;
  }

  return new Promise<PermissionResult>((resolve, reject) => {
    const toolRequestId = pendingRequestId(scopeId, context.toolUseID);
    const questionItems: PendingRunInputQuestion[] = questions.map((question, index) => ({
      id: `${toolRequestId}:q${index}`,
      question,
    }));
    const onAbort = () => {
      const activeGroup = pendingRunInputs.get(questionItems[0]?.id ?? "");
      if (activeGroup) {
        activeGroup.dispose();
        activeGroup.reject(new Error(`Input request ${context.toolUseID} was canceled.`));
      }
    };
    const dispose = () => {
      context.signal.removeEventListener("abort", onAbort);
      for (const item of questionItems) {
        pendingRunInputs.delete(item.id);
      }
    };
    const group: PendingRunInputGroup = {
      toolUseID: context.toolUseID,
      input,
      questions: questionItems,
      resolve,
      reject,
      dispose,
    };

    for (const item of questionItems) {
      const replaced = pendingRunInputs.get(item.id);
      if (replaced) {
        replaced.dispose();
        replaced.reject(new Error(`Input request ${item.id} was replaced.`));
      }
      pendingRunInputs.set(item.id, group);
    }
    context.signal.addEventListener("abort", onAbort, { once: true });

    for (const item of questionItems) {
      send({
        type: "options",
        id: item.id,
        prompt: item.question.question,
        multi: item.question.multiSelect,
        options: item.question.options.map((option) => (option.description ? { id: option.label, label: option.label, description: option.description } : { id: option.label, label: option.label })),
      });
    }
  });
}

export function createRunApprovalHandler(send: (event: RunEvent) => void, scopeId?: string, autoApprove = false): CanUseTool {
  return (toolName, input, context) => {
    if (toolName === "AskUserQuestion") {
      const inputHandler = createRunInputHandler(input, context, send, scopeId);
      if (inputHandler) {
        return inputHandler;
      }
    }

    // Unrestricted "do anything" mode: allow every tool without surfacing an
    // approval prompt. Genuine questions (AskUserQuestion above) still reach the
    // user; only the permission gate is bypassed.
    if (autoApprove) {
      return Promise.resolve<PermissionResult>({ behavior: "allow", updatedInput: input, toolUseID: context.toolUseID });
    }

    return new Promise<PermissionResult>((resolve, reject) => {
      const id = pendingRequestId(scopeId, context.toolUseID);
      const replaced = pendingRunApprovals.get(id);
      if (replaced) {
        replaced.dispose();
        replaced.reject(new Error(`Approval request ${id} was replaced.`));
      }

      const detail = context.description ?? approvalDetail(input);
      const onAbort = () => {
        const pending = pendingRunApprovals.get(id);
        if (pending) {
          pending.dispose();
          pending.reject(new Error(`Approval request ${id} was canceled.`));
        }
      };
      const dispose = () => {
        context.signal.removeEventListener("abort", onAbort);
        pendingRunApprovals.delete(id);
      };

      pendingRunApprovals.set(id, { toolUseID: context.toolUseID, input, resolve, reject, dispose });
      context.signal.addEventListener("abort", onAbort, { once: true });
      send(detail ? { type: "approval", id, title: context.title ?? `Approve ${toolName}?`, detail } : { type: "approval", id, title: context.title ?? `Approve ${toolName}?` });
    });
  };
}

const backgroundRunHandles = new Map<string, BackgroundRunHandle>();

export function activeBackgroundRunSnapshotsFromHandles(handles: ReadonlyMap<string, BackgroundRunHandle>): ActiveBackgroundRunSnapshot[] {
  return Array.from(handles.values(), ({ binding, startedAt }) => ({
    runId: binding.runId,
    conversationId: binding.conversationId,
    userMessageId: binding.userMessageId,
    agentMessageId: binding.agentMessageId,
    startedAt,
  }));
}

function activeBackgroundRunSnapshots(): ActiveBackgroundRunSnapshot[] {
  return activeBackgroundRunSnapshotsFromHandles(backgroundRunHandles);
}

function subscribeBackgroundRun(runId: string, subscriber: BackgroundRunSubscriber): (() => void) | null {
  const handle = backgroundRunHandles.get(runId);
  if (!handle) {
    return null;
  }
  handle.subscribers = handle.subscribers ?? new Set<BackgroundRunSubscriber>();
  handle.subscribers.add(subscriber);
  return () => {
    handle.subscribers?.delete(subscriber);
  };
}

function notifyBackgroundRunUpdate(binding: BackgroundRunBinding, done: boolean): void {
  const handle = backgroundRunHandles.get(binding.runId);
  if (!handle?.subscribers || handle.subscribers.size === 0) {
    return;
  }
  const update = activeBackgroundRunUpdateFromState(readWorkspaceState(), binding, done);
  if (!update) {
    return;
  }
  for (const subscriber of handle.subscribers) {
    subscriber(update);
  }
}

function createBackgroundAccumulator(): BackgroundRunAccumulator {
  return {
    reasoning: "",
    hasReasoning: false,
    started: false,
    text: "",
    hasText: false,
    tools: [],
    timeline: [],
    diffs: [],
    plans: [],
    codes: [],
    searches: [],
    suggested: [],
    approvals: [],
    options: [],
    statuses: [],
    done: false,
    start: Date.now(),
  };
}

function backgroundBlocks(accumulator: BackgroundRunAccumulator): AgentBlock[] {
  const blocks: AgentBlock[] = [];
  const plans = accumulator.plans ?? [];
  const diffs = accumulator.diffs ?? [];
  const suggested = accumulator.suggested ?? [];
  // Reasoning, text, tools, searches, and code interleaved in arrival order.
  const timeline = accumulator.timeline ?? [];
  const firstReasoningIdx = timeline.findIndex((item) => item.kind === "reasoning");
  let lastReasoningIdx = -1;
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    if (timeline[i].kind === "reasoning") {
      lastReasoningIdx = i;
      break;
    }
  }
  const reasoningDuration = `${Math.max(1, Math.round((Date.now() - accumulator.start) / 1000))}s`;
  // The final answer is the trailing run of text after the last reasoning/tool;
  // earlier text is narration that stays interleaved with the tools.
  let lastNonTextIdx = -1;
  let lastTextIdx = -1;
  timeline.forEach((item, idx) => {
    if (item.kind === "text") {
      lastTextIdx = idx;
    } else {
      lastNonTextIdx = idx;
    }
  });
  timeline.forEach((item, idx) => {
    if (item.kind === "reasoning") {
      const active = !accumulator.done && idx === lastReasoningIdx;
      blocks.push({ kind: "reasoning", text: item.text, active, duration: accumulator.done && idx === firstReasoningIdx ? reasoningDuration : undefined, ...(active ? { startedAtMs: accumulator.start } : {}) });
    } else if (item.kind === "text") {
      blocks.push({ kind: "text", text: item.text, streaming: !accumulator.done && idx === lastTextIdx, result: idx > lastNonTextIdx });
    } else if (item.kind === "search") {
      const s = item.search;
      blocks.push({ kind: "search", query: s.query, state: s.state, results: s.results });
    } else if (item.kind === "code") {
      blocks.push(item.data);
    } else {
      const tool = item.tool;
      blocks.push(toolToDiffBlock(tool) ?? { kind: "tool", name: tool.name, summary: tool.summary, args: tool.args, state: tool.state, output: tool.output });
    }
  });
  if (timeline.length === 0 && accumulator.started && !accumulator.done) {
    blocks.push({ kind: "reasoning", text: "", active: true, startedAtMs: accumulator.start });
  }
  for (const plan of plans) {
    blocks.push({ kind: "plan", steps: plan.steps });
  }
  blocks.push(...diffs);
  blocks.push(...suggested);
  for (const approval of accumulator.approvals) {
    blocks.push({ kind: "approval", id: approval.id, title: approval.title, detail: approval.detail });
  }
  for (const option of accumulator.options) {
    blocks.push({ kind: "options", id: option.id, prompt: option.prompt, multi: option.multi, options: option.options });
  }
  for (const status of accumulator.statuses) {
    blocks.push({ kind: "status", level: status.level, text: status.text });
  }
  return blocks;
}

function finishBackgroundLiveBlock(block: AgentBlock, state: "ok" | "error"): AgentBlock {
  switch (block.kind) {
    case "reasoning":
      return block.active ? { ...block, active: false } : block;
    case "text":
      return block.streaming ? { ...block, streaming: false } : block;
    case "tool":
    case "command":
    case "search":
      return block.state === "running" ? { ...block, state } : block;
    case "plan":
      return block.steps.some((step) => step.state === "running") ? { ...block, steps: block.steps.map((step) => (step.state === "running" ? { ...step, state } : step)) } : block;
    default:
      return block;
  }
}

function finishBackgroundLiveBlocks(blocks: readonly AgentBlock[], state: "ok" | "error"): AgentBlock[] {
  return blocks.map((block) => finishBackgroundLiveBlock(block, state));
}

function blockNeedsInput(block: AgentBlock): boolean {
  if (block.kind === "approval") {
    return !block.decision;
  }
  if (block.kind === "options") {
    return !block.selected || block.selected.length === 0;
  }
  return false;
}

function blocksNeedInput(blocks: readonly AgentBlock[]): boolean {
  return blocks.some(blockNeedsInput);
}

function mergeInputBlockState(blocks: readonly AgentBlock[], previousBlocks: readonly AgentBlock[] | undefined): AgentBlock[] {
  return blocks.map((block) => {
    if (block.kind === "approval" && block.id) {
      const previous = previousBlocks?.find((item) => item.kind === "approval" && item.id === block.id);
      return previous?.kind === "approval" && previous.decision ? { ...block, decision: previous.decision } : block;
    }
    if (block.kind === "options" && block.id) {
      const previous = previousBlocks?.find((item) => item.kind === "options" && item.id === block.id);
      return previous?.kind === "options" && previous.selected ? { ...block, selected: [...previous.selected] } : block;
    }
    return block;
  });
}

function snippetFromBlocks(blocks: readonly AgentBlock[], locale: Locale): string {
  const textBlock = [...blocks].reverse().find((block) => block.kind === "text" && block.text.trim().length > 0);
  const snippetSource = textBlock?.kind === "text" ? textBlock.text : serverRunSnippet(locale, "runDoneSnippet");
  return clip(snippetSource.replace(/\s+/g, " "), 60);
}

function patchWorkspaceConversation(state: WorkspaceState, id: string, patch: Partial<WorkspaceState["chats"][number]>): WorkspaceState {
  return {
    ...state,
    chats: state.chats.map((conversation) => (conversation.id === id ? { ...conversation, ...patch } : conversation)),
    projects: state.projects.map((project) => ({
      ...project,
      conversations: project.conversations.map((conversation) => (conversation.id === id ? { ...conversation, ...patch } : conversation)),
    })),
  };
}

function serverOwnsBackgroundRun(conversation: WorkspaceConversation): boolean {
  return Boolean(conversation.activeRunId) && (conversation.status === "running" || conversation.status === "waiting");
}

function threadHasMessagesMissingFromCurrent(incoming: WorkspaceState, current: WorkspaceState, conversationId: string): boolean {
  const currentMessageIds = new Set((current.threads[conversationId] ?? []).map((message) => message.id));
  return (incoming.threads[conversationId] ?? []).some((message) => !currentMessageIds.has(message.id));
}

function staleClientStillHasSettledRun(incoming: WorkspaceState, current: WorkspaceState, conversation: WorkspaceConversation, currentConversation: WorkspaceConversation): boolean {
  return (
    Boolean(conversation.activeRunId) &&
    !currentConversation.activeRunId &&
    currentConversation.status !== "running" &&
    currentConversation.status !== "waiting" &&
    !threadHasMessagesMissingFromCurrent(incoming, current, conversation.id)
  );
}

function workspaceConversationMap(state: WorkspaceState): Map<string, WorkspaceConversation> {
  return new Map([...state.chats, ...state.projects.flatMap((project) => project.conversations)].map((conversation) => [conversation.id, conversation]));
}

export function activeBackgroundRunUpdateFromState(state: WorkspaceState, binding: BackgroundRunBinding, done: boolean): ActiveBackgroundRunUpdate | null {
  const conversation = workspaceConversationMap(state).get(binding.conversationId);
  if (!conversation) {
    return null;
  }
  const agentMessage = (state.threads[binding.conversationId] ?? []).find((message) => message.id === binding.agentMessageId);
  const blocks = agentMessage?.blocks ?? [];
  const costUsd = conversation.costUsd ?? agentMessage?.costUsd;
  const usage = conversation.usage ?? agentMessage?.usage;
  return {
    runId: binding.runId,
    conversationId: binding.conversationId,
    agentMessageId: binding.agentMessageId,
    status: conversation.status,
    snippet: conversation.snippet,
    time: conversation.time,
    done,
    blocks,
    ...(costUsd === undefined ? {} : { costUsd }),
    ...(usage === undefined ? {} : { usage }),
  };
}

function mergeServerOwnedRunFields(incoming: WorkspaceConversation, current: WorkspaceConversation): WorkspaceConversation {
  return {
    ...incoming,
    activeRunId: current.activeRunId,
    status: current.status,
    snippet: current.snippet,
    time: current.time,
    costUsd: current.costUsd,
    usage: current.usage,
  };
}

export function mergeWorkspacePutState(incoming: WorkspaceState, current: WorkspaceState): WorkspaceState {
  const currentById = workspaceConversationMap(current);
  const incomingConversationIds = new Set([...incoming.chats, ...incoming.projects.flatMap((project) => project.conversations)].map((conversation) => conversation.id));
  const serverOwnedConversationIds = new Set<string>();
  const mergeConversation = (conversation: WorkspaceConversation): WorkspaceConversation => {
    const currentConversation = currentById.get(conversation.id);
    if (!currentConversation || (!serverOwnsBackgroundRun(currentConversation) && !staleClientStillHasSettledRun(incoming, current, conversation, currentConversation))) {
      return conversation;
    }
    serverOwnedConversationIds.add(conversation.id);
    return mergeServerOwnedRunFields(conversation, currentConversation);
  };
  let chats = incoming.chats.map(mergeConversation);
  let projects = incoming.projects.map((project) => ({
    ...project,
    conversations: project.conversations.map(mergeConversation),
  }));

  for (const conversation of current.chats) {
    if (serverOwnsBackgroundRun(conversation) && !incomingConversationIds.has(conversation.id)) {
      serverOwnedConversationIds.add(conversation.id);
      chats = [conversation, ...chats];
      incomingConversationIds.add(conversation.id);
    }
  }
  for (const currentProject of current.projects) {
    const missingConversations = currentProject.conversations.filter((conversation) => serverOwnsBackgroundRun(conversation) && !incomingConversationIds.has(conversation.id));
    if (missingConversations.length === 0) {
      continue;
    }
    for (const conversation of missingConversations) {
      serverOwnedConversationIds.add(conversation.id);
      incomingConversationIds.add(conversation.id);
    }
    const existingProject = projects.find((project) => project.id === currentProject.id);
    if (existingProject) {
      projects = projects.map((project) => (project.id === currentProject.id ? { ...project, conversations: [...missingConversations, ...project.conversations] } : project));
    } else {
      projects = [{ ...currentProject, conversations: missingConversations }, ...projects];
    }
  }

  const threads = { ...incoming.threads };
  for (const conversationId of serverOwnedConversationIds) {
    threads[conversationId] = current.threads[conversationId] ?? threads[conversationId] ?? [];
  }
  return {
    ...incoming,
    chats,
    projects,
    threads,
  };
}

function patchWorkspaceBlocks(state: WorkspaceState, updateBlock: (block: AgentBlock) => AgentBlock): WorkspaceState {
  const changedConversationIds = new Set<string>();
  let threads: WorkspaceState["threads"] | null = null;

  for (const [conversationId, messages] of Object.entries(state.threads)) {
    let messagesChanged = false;
    const nextMessages = messages.map((message) => {
      if (!message.blocks) {
        return message;
      }
      let blocksChanged = false;
      const blocks = message.blocks.map((block) => {
        const nextBlock = updateBlock(block);
        blocksChanged ||= nextBlock !== block;
        return nextBlock;
      });
      if (!blocksChanged) {
        return message;
      }
      messagesChanged = true;
      return { ...message, blocks };
    });
    if (messagesChanged) {
      threads = threads ?? { ...state.threads };
      threads[conversationId] = nextMessages;
      changedConversationIds.add(conversationId);
    }
  }

  if (!threads) {
    return state;
  }

  let next: WorkspaceState = { ...state, threads };
  for (const conversationId of changedConversationIds) {
    next = patchWorkspaceConversation(next, conversationId, { status: "running" });
  }
  return next;
}

export function applyRunApprovalDecisionState(state: WorkspaceState, decision: RunApprovalDecision): WorkspaceState {
  return patchWorkspaceBlocks(state, (block) => {
    if (block.kind !== "approval" || block.id !== decision.id || block.decision === decision.decision) {
      return block;
    }
    return { ...block, decision: decision.decision };
  });
}

export function applyRunInputSelectionState(state: WorkspaceState, selection: RunInputSelection): WorkspaceState {
  return patchWorkspaceBlocks(state, (block) => {
    if (block.kind !== "options" || block.id !== selection.id || JSON.stringify(block.selected ?? []) === JSON.stringify(selection.selected)) {
      return block;
    }
    return { ...block, selected: [...selection.selected] };
  });
}

function ensureBackgroundUserMessage(state: WorkspaceState, binding: BackgroundRunBinding, prompt: string): WorkspaceState {
  const existing = state.threads[binding.conversationId] ?? [];
  if (existing.some((message) => message.id === binding.userMessageId)) {
    return state;
  }
  const message: ChatMessage = { id: binding.userMessageId, role: "user", text: prompt, time: binding.userMessageTime };
  return {
    ...state,
    threads: {
      ...state.threads,
      [binding.conversationId]: [...existing, message],
    },
  };
}

function putBackgroundAgentMessage(
  state: WorkspaceState,
  binding: BackgroundRunBinding,
  blocks: readonly AgentBlock[],
  metadata: Pick<BackgroundRunAccumulator, "costUsd" | "usage"> = {},
): WorkspaceState {
  const messages = state.threads[binding.conversationId] ?? [];
  const previousBlocks = messages.find((message) => message.id === binding.agentMessageId)?.blocks;
  const mergedBlocks = mergeInputBlockState(blocks, previousBlocks);
  const message: ChatMessage = {
    id: binding.agentMessageId,
    role: "agent",
    time: binding.agentMessageTime,
    blocks: mergedBlocks,
    ...(metadata.costUsd === undefined ? {} : { costUsd: metadata.costUsd }),
    ...(metadata.usage === undefined ? {} : { usage: metadata.usage }),
  };
  return {
    ...state,
    threads: {
      ...state.threads,
      [binding.conversationId]: messages.some((item) => item.id === binding.agentMessageId)
        ? messages.map((item) => (item.id === binding.agentMessageId ? message : item))
        : [...messages, message],
    },
  };
}

function persistBackgroundBlocks(
  binding: BackgroundRunBinding,
  blocks: readonly AgentBlock[],
  patch: Partial<WorkspaceState["chats"][number]> = {},
  metadata: Pick<BackgroundRunAccumulator, "costUsd" | "usage"> = {},
): void {
  const state = readWorkspaceState();
  const withMessage = putBackgroundAgentMessage(state, binding, blocks, metadata);
  writeWorkspaceState(patchWorkspaceConversation(withMessage, binding.conversationId, patch));
}

function startBackgroundRunState(state: WorkspaceState, binding: BackgroundRunBinding, request: RunRequest, accumulator: BackgroundRunAccumulator): WorkspaceState {
  const withUserMessage = ensureBackgroundUserMessage(state, binding, request.prompt);
  const started = patchWorkspaceConversation(withUserMessage, binding.conversationId, {
    activeRunId: binding.runId,
    status: "running",
    snippet: clip(request.prompt, 60),
    time: binding.userMessageTime,
    unread: false,
    costUsd: undefined,
    usage: undefined,
  });
  return putBackgroundAgentMessage(started, binding, backgroundBlocks(accumulator));
}

function startPersistedBackgroundRun(binding: BackgroundRunBinding, request: RunRequest): BackgroundRunAccumulator {
  const accumulator = createBackgroundAccumulator();
  writeWorkspaceState(startBackgroundRunState(readWorkspaceState(), binding, request, accumulator));
  return accumulator;
}

function accumulateBackgroundRunEvent(accumulator: BackgroundRunAccumulator, event: RunEvent): void {
  switch (event.type) {
    case "start":
      accumulator.started = true;
      break;
    case "reasoning": {
      accumulator.started = true;
      accumulator.hasReasoning = true;
      accumulator.reasoning += event.text;
      const last = accumulator.timeline[accumulator.timeline.length - 1];
      if (last && last.kind === "reasoning") {
        last.text += event.text;
      } else {
        accumulator.timeline.push({ kind: "reasoning", text: event.text });
      }
      break;
    }
    case "text": {
      accumulator.started = true;
      accumulator.hasText = true;
      accumulator.text += event.text;
      const last = accumulator.timeline[accumulator.timeline.length - 1];
      if (last && last.kind === "text") {
        last.text += event.text;
      } else {
        accumulator.timeline.push({ kind: "text", text: event.text });
      }
      break;
    }
    case "tool": {
      accumulator.started = true;
      const existing = accumulator.tools.find((tool) => tool.id === event.id);
      if (existing) {
        existing.name = event.name;
        existing.summary = event.summary;
        existing.args = event.args;
      } else {
        const tool: StreamingTool = { id: event.id, name: event.name, summary: event.summary, args: event.args, state: "running" };
        accumulator.tools.push(tool);
        accumulator.timeline.push({ kind: "tool", tool });
      }
      break;
    }
    case "tool_result": {
      accumulator.started = true;
      const tool = accumulator.tools.find((item) => item.id === event.id);
      if (tool) {
        tool.state = event.ok ? "ok" : "error";
        tool.output = event.output;
      }
      break;
    }
    case "diff": {
      accumulator.started = true;
      const block: DiffBlock = { kind: "diff", file: event.file, additions: event.additions, deletions: event.deletions, lines: event.lines };
      const existingIndex = event.id ? accumulator.diffs.findIndex((item) => item.file === event.file) : -1;
      if (existingIndex >= 0) {
        accumulator.diffs[existingIndex] = block;
      } else {
        accumulator.diffs.push(block);
      }
      break;
    }
    case "plan": {
      accumulator.started = true;
      const existing = event.id ? accumulator.plans.find((item) => item.id === event.id) : undefined;
      if (existing) {
        existing.steps = event.steps;
      } else {
        accumulator.plans.push({ id: event.id, steps: event.steps });
      }
      break;
    }
    case "code": {
      accumulator.started = true;
      const data: CodeBlockData = { kind: "code", language: event.language, code: event.code };
      accumulator.codes.push(data);
      accumulator.timeline.push({ kind: "code", data });
      break;
    }
    case "search": {
      accumulator.started = true;
      const existing = event.id ? accumulator.searches.find((item) => item.id === event.id) : accumulator.searches.find((item) => item.query === event.query);
      if (existing) {
        existing.query = event.query;
        existing.state = event.state;
        existing.results = event.results ?? existing.results;
      } else {
        const search: StreamingSearch = { id: event.id, query: event.query, state: event.state, results: event.results ?? [] };
        accumulator.searches.push(search);
        accumulator.timeline.push({ kind: "search", search });
      }
      break;
    }
    case "suggested":
      accumulator.started = true;
      accumulator.suggested.push({ kind: "suggested", actions: event.actions });
      break;
    case "approval":
      accumulator.started = true;
      accumulator.approvals.push({ id: event.id, title: event.title, detail: event.detail });
      break;
    case "options": {
      accumulator.started = true;
      const existing = accumulator.options.find((item) => item.id === event.id);
      if (existing) {
        existing.prompt = event.prompt;
        existing.multi = event.multi;
        existing.options = event.options;
      } else {
        accumulator.options.push({ id: event.id, prompt: event.prompt, multi: event.multi, options: event.options });
      }
      break;
    }
    case "status":
      accumulator.started = true;
      if (event.level === "warn" || event.level === "error") {
        accumulator.statuses.push({ level: event.level, text: event.text });
      }
      break;
    case "error":
      accumulator.started = true;
      accumulator.statuses.push({ level: "error", text: event.text });
      break;
    case "done":
      accumulator.costUsd = event.costUsd;
      accumulator.usage = event.usage;
      return;
  }
}

/** The conversation patch a still-streaming background run writes on every event.
 *
 *  It re-asserts the run as active — both `status` (running, or waiting when a
 *  block needs input) and `activeRunId` — instead of leaving them untouched. A
 *  live run must keep its conversation pinned to its runId and a live status,
 *  otherwise a stale "interrupted" reconcile (one that fired in the window before
 *  this run's handle registered, or against a previous run's id) leaves the
 *  conversation stuck at status "error" while the agent keeps working, and the UI
 *  shows no running indicator or stop button. Re-asserting heals that on the next
 *  event and keeps `reconcileConversationRun` from re-marking a live run. */
export function backgroundRunStatusPatch(
  binding: BackgroundRunBinding,
  blocks: readonly AgentBlock[],
  locale: Locale,
): Partial<WorkspaceState["chats"][number]> {
  return blocksNeedInput(blocks)
    ? { status: "waiting", activeRunId: binding.runId, snippet: serverRunSnippet(locale, "runNeedsInputSnippet"), time: binding.agentMessageTime }
    : { status: "running", activeRunId: binding.runId, time: binding.agentMessageTime };
}

function applyBackgroundRunEvent(binding: BackgroundRunBinding, accumulator: BackgroundRunAccumulator, event: RunEvent): void {
  accumulateBackgroundRunEvent(accumulator, event);
  const blocks = backgroundBlocks(accumulator);
  const locale = readWorkspaceState().settings.general.locale;
  persistBackgroundBlocks(binding, blocks, backgroundRunStatusPatch(binding, blocks, locale), { costUsd: accumulator.costUsd, usage: accumulator.usage });
  notifyBackgroundRunUpdate(binding, false);
}

export function finishBackgroundRunState(state: WorkspaceState, binding: BackgroundRunBinding, accumulator: BackgroundRunAccumulator, canceled: boolean): WorkspaceState {
  accumulator.done = true;
  const locale = state.settings.general.locale;
  const hadError = accumulator.statuses.some((status) => status.level === "error");
  let blocks = finishBackgroundLiveBlocks(backgroundBlocks(accumulator), canceled || hadError ? "error" : "ok");
  if (canceled) {
    const canceledStatusBlock: AgentBlock = { kind: "status", level: "warn", text: serverRunSnippet(locale, "runCanceledSnippet") };
    const hasCanceledStatus = blocks.some((block) => block.kind === "status" && block.level === canceledStatusBlock.level && block.text === canceledStatusBlock.text);
    blocks = blocks.length === 0 ? [canceledStatusBlock] : hasCanceledStatus ? blocks : [...blocks, canceledStatusBlock];
  }
  const hadOutput =
    accumulator.hasText ||
    accumulator.hasReasoning ||
    accumulator.tools.length > 0 ||
    (accumulator.diffs?.length ?? 0) > 0 ||
    (accumulator.plans?.length ?? 0) > 0 ||
    (accumulator.codes?.length ?? 0) > 0 ||
    (accumulator.searches?.length ?? 0) > 0 ||
    (accumulator.suggested?.length ?? 0) > 0 ||
    accumulator.approvals.length > 0 ||
    accumulator.options.length > 0;
  const warningOnlyFailure = accumulator.statuses.some((status) => status.level === "warn") && !hadOutput;
  const failed = hadError || warningOnlyFailure;
  const waiting = !canceled && !failed && blocksNeedInput(blocks);
  const patch = canceled
    ? { activeRunId: undefined, status: "idle" as const, snippet: serverRunSnippet(locale, "runCanceledSnippet"), time: binding.agentMessageTime }
    : failed
      ? { activeRunId: undefined, status: "error" as const, snippet: serverRunSnippet(locale, "runFailedSnippet"), time: binding.agentMessageTime }
      : waiting
        ? { status: "waiting" as const, snippet: serverRunSnippet(locale, "runNeedsInputSnippet"), time: binding.agentMessageTime }
        : {
            activeRunId: undefined,
            status: "done" as const,
            snippet: snippetFromBlocks(blocks, locale),
            time: binding.agentMessageTime,
            ...(accumulator.costUsd === undefined ? {} : { costUsd: accumulator.costUsd }),
            ...(accumulator.usage === undefined ? {} : { usage: accumulator.usage }),
          };
  return patchWorkspaceConversation(putBackgroundAgentMessage(state, binding, blocks, { costUsd: accumulator.costUsd, usage: accumulator.usage }), binding.conversationId, patch);
}

function finishPersistedBackgroundRun(binding: BackgroundRunBinding, accumulator: BackgroundRunAccumulator, canceled: boolean): void {
  writeWorkspaceState(finishBackgroundRunState(readWorkspaceState(), binding, accumulator, canceled));
}

export function settleEarlyBackgroundRunState(
  state: WorkspaceState,
  binding: BackgroundRunBinding,
  request: RunRequest,
  events: readonly RunEvent[],
  canceled = false,
): WorkspaceState {
  const accumulator = createBackgroundAccumulator();
  const started = startBackgroundRunState(state, binding, request, accumulator);
  for (const event of events) {
    accumulateBackgroundRunEvent(accumulator, event);
  }
  return finishBackgroundRunState(started, binding, accumulator, canceled);
}

function backgroundBindingFromParsed(value: Record<string, unknown>): BackgroundRunBinding | null {
  const conversationId = typeof value.conversationId === "string" ? value.conversationId.trim() : "";
  const runId = typeof value.runId === "string" ? value.runId.trim() : "";
  const userMessageId = typeof value.userMessageId === "string" ? value.userMessageId.trim() : "";
  const userMessageTime = typeof value.userMessageTime === "string" ? value.userMessageTime.trim() : "";
  const agentMessageId = typeof value.agentMessageId === "string" ? value.agentMessageId.trim() : "";
  const agentMessageTime = typeof value.agentMessageTime === "string" ? value.agentMessageTime.trim() : "";
  if (!conversationId || !runId || !userMessageId || !userMessageTime || !agentMessageId || !agentMessageTime) {
    return null;
  }
  return { conversationId, runId, userMessageId, userMessageTime, agentMessageId, agentMessageTime };
}

interface StreamedTool {
  readonly id: string;
  readonly name: string;
  readonly input?: Record<string, unknown>;
  inputJson: string;
}

interface ClaudeStreamState {
  sawPartialAssistantContent: boolean;
  readonly toolsByIndex: Map<number, StreamedTool>;
  readonly toolsById: Map<string, StreamedTool>;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function toolRunEvent(tool: StreamedTool): Extract<RunEvent, { type: "tool" }> {
  const parsedInput = tool.inputJson.trim() ? parseJsonRecord(tool.inputJson) : (tool.input ?? {});
  const args = parsedInput ? toArgs(parsedInput) : tool.inputJson.trim() ? { input: clip(tool.inputJson, 160) } : {};
  const summarySource = parsedInput ? (parsedInput.command ?? parsedInput.file_path ?? "") : tool.inputJson;
  return { type: "tool", id: tool.id, name: tool.name, summary: clip(summarySource, 80), args };
}

function toolInput(tool: StreamedTool): Record<string, unknown> | undefined {
  return tool.inputJson.trim() ? parseJsonRecord(tool.inputJson) ?? tool.input : tool.input;
}

/** A running card for a diff tool, with the bulky diff-trigger fields stripped
 *  from its args so the frontend doesn't build a second (clipped) diff from the
 *  card — the backend's own diff event is the single source of truth. */
function diffToolCardEvent(tool: StreamedTool): Extract<RunEvent, { type: "tool" }> {
  const base = toolRunEvent(tool);
  const { old_string, new_string, content, edits, diff, ...rest } = base.args ?? {};
  void old_string;
  void new_string;
  void content;
  void edits;
  void diff;
  return { ...base, args: rest };
}

function toolStartEvents(tool: StreamedTool, state: ClaudeStreamState): RunEvent[] {
  state.toolsById.set(tool.id, tool);
  // The interactive input handler renders this tool; emit nothing from the stream.
  if (isInputTool(tool.name)) {
    return [];
  }
  const rich = richToolEvents(tool.id, tool.name, toolInput(tool), "running");
  // Diff tools (Edit/Write/MultiEdit) need a tool card for the running→ok
  // lifecycle in addition to their diff — a bare diff carries no state, so the
  // card used to hang "running". Search/plan/option tools carry their own state.
  if (isDiffTool(tool.name)) {
    return [diffToolCardEvent(tool), ...rich];
  }
  return rich.length > 0 ? rich : [toolRunEvent(tool)];
}

function toolResultEvents(tool: StreamedTool | undefined, id: string, ok: boolean, output: unknown): RunEvent[] {
  if (tool && isInputTool(tool.name)) {
    // Owned by the input handler — no stream-side card/result to settle.
    return [];
  }
  if (tool) {
    const rich = richToolEvents(id, tool.name, toolInput(tool), ok ? "ok" : "error", output);
    if (isDiffTool(tool.name)) {
      // Settle the diff tool's running card and refresh its diff.
      return [{ type: "tool_result", id, ok, output: resultText(output) }, ...rich];
    }
    if (rich.length > 0) {
      return rich;
    }
  }
  return [{ type: "tool_result", id, ok, output: resultText(output) }];
}

function approvalDetail(input: unknown): string | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  const detail = input.command ?? input.file_path ?? input.path ?? input.description;
  return typeof detail === "string" && detail.trim().length > 0 ? clip(detail, 160) : undefined;
}

function permissionRequestEvent(msg: Record<string, unknown>): Extract<RunEvent, { type: "approval" }> | null {
  if (msg.type !== "permission_request" && msg.type !== "approval") {
    return null;
  }
  const id = typeof msg.id === "string" && msg.id.trim().length > 0 ? msg.id : `approval-${Date.now()}`;
  const toolName = typeof msg.tool_name === "string" ? msg.tool_name : typeof msg.name === "string" ? msg.name : "agent action";
  const title = typeof msg.title === "string" ? msg.title : `Approve ${toolName}?`;
  const detail = typeof msg.detail === "string" ? msg.detail : approvalDetail(msg.input ?? msg.args);
  return detail ? { type: "approval", id, title, detail } : { type: "approval", id, title };
}

function translateClaudeStreamEvent(msg: Record<string, unknown>, state: ClaudeStreamState): RunEvent[] {
  if (!isRecord(msg.event)) {
    return [];
  }

  const event = msg.event;
  const eventType = event.type;
  if (eventType === "content_block_start") {
    state.sawPartialAssistantContent = true;
    const index = typeof event.index === "number" ? event.index : null;
    const block = isRecord(event.content_block) ? event.content_block : null;
    if (index === null || block?.type !== "tool_use") {
      return [];
    }
    const input = isRecord(block.input) ? block.input : {};
    const tool: StreamedTool = {
      id: typeof block.id === "string" ? block.id : `tool-${index}`,
      name: typeof block.name === "string" ? block.name : "tool",
      input,
      inputJson: "",
    };
    state.toolsByIndex.set(index, tool);
    return toolStartEvents(tool, state);
  }

  if (eventType !== "content_block_delta" || !isRecord(event.delta)) {
    return [];
  }

  state.sawPartialAssistantContent = true;
  const delta = event.delta;
  if (delta.type === "text_delta" && typeof delta.text === "string") {
    return [{ type: "text", text: delta.text }];
  }
  if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
    return [{ type: "reasoning", text: delta.thinking }];
  }
  if (delta.type === "input_json_delta" && typeof delta.partial_json === "string" && typeof event.index === "number") {
    const tool = state.toolsByIndex.get(event.index);
    if (!tool) {
      return [];
    }
    tool.inputJson += delta.partial_json;
    return toolStartEvents(tool, state);
  }

  return [];
}

function translateClaudeMessage(msg: Record<string, unknown>, state: ClaudeStreamState): RunEvent[] {
  const events: RunEvent[] = [];
  const approval = permissionRequestEvent(msg);
  if (approval) {
    events.push(approval);
    return events;
  }
  const type = msg.type;

  if (type === "system" && msg.subtype === "init") {
    const model = typeof msg.model === "string" ? msg.model : "agent";
    events.push({ type: "status", level: "info", text: `model · ${model}` });
    if (typeof msg.session_id === "string" && msg.session_id) {
      events.push({ type: "session", id: msg.session_id });
    }
  } else if (type === "system" && msg.subtype === "api_retry") {
    events.push({ type: "status", level: "warn", text: `api retry · ${clip(msg.error ?? msg.message ?? "retrying", 200)}` });
  } else if (type === "stream_event") {
    events.push(...translateClaudeStreamEvent(msg, state));
  } else if (type === "assistant") {
    if (state.sawPartialAssistantContent) {
      return events;
    }
    const content = ((msg.message as { content?: unknown[] })?.content) ?? [];
    for (const block of content as Array<Record<string, unknown>>) {
      if (block.type === "text" && typeof block.text === "string") {
        events.push({ type: "text", text: block.text });
      } else if (block.type === "thinking" && typeof block.thinking === "string") {
        events.push({ type: "reasoning", text: block.thinking });
      } else if (block.type === "tool_use") {
        const tool: StreamedTool = {
          id: String(block.id),
          name: String(block.name),
          input: isRecord(block.input) ? block.input : {},
          inputJson: "",
        };
        events.push(...toolStartEvents(tool, state));
      }
    }
  } else if (type === "user") {
    const content = ((msg.message as { content?: unknown[] })?.content) ?? [];
    for (const block of content as Array<Record<string, unknown>>) {
      if (block.type === "tool_result") {
        const id = String(block.tool_use_id);
        events.push(...toolResultEvents(state.toolsById.get(id), id, block.is_error !== true, block.content));
      }
    }
  } else if (type === "result") {
    if (msg.is_error === true) {
      events.push({ type: "error", text: typeof msg.result === "string" ? msg.result : String(msg.subtype ?? "run failed") });
    }
    events.push({ type: "done", costUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : undefined, usage: runUsageFromRecord(msg.usage) });
  }
  return events;
}

/** Translate Claude `stream-json` lines into normalized events while preserving
 * cross-line state, which is required for partial stream deltas. */
export function createClaudeStreamTranslator(): (line: string) => RunEvent[] {
  const state: ClaudeStreamState = { sawPartialAssistantContent: false, toolsByIndex: new Map(), toolsById: new Map() };
  return (line: string): RunEvent[] => {
    let msg: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed)) {
        return [];
      }
      msg = parsed;
    } catch {
      return [];
    }
    return translateClaudeMessage(msg, state);
  };
}

/** Translate one line without preserving prior partial state. Prefer
 * `createClaudeStreamTranslator` for real streams. */
export function translateClaude(line: string): RunEvent[] {
  return createClaudeStreamTranslator()(line);
}

export function createAmpStreamTranslator(): (line: string) => RunEvent[] {
  return createClaudeStreamTranslator();
}

export function createQwenStreamTranslator(): (line: string) => RunEvent[] {
  const translate = createClaudeStreamTranslator();
  return (line: string): RunEvent[] => {
    const msg = parseJsonRecord(line);
    if (msg?.type === "system" && msg.subtype === "session_start") {
      const model = typeof msg.model === "string" && msg.model.trim().length > 0 ? msg.model : "qwen";
      return [{ type: "status", level: "info", text: `model · ${model}` }];
    }
    return translate(line);
  };
}

interface CursorToolCallEntry {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly result: unknown;
}

function cursorToolNameFromKey(key: string): string {
  const name = key.replace(/ToolCall$/, "");
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function cursorToolCallEntry(value: unknown): CursorToolCallEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  for (const [key, raw] of Object.entries(value)) {
    if (!key.endsWith("ToolCall") || !isRecord(raw)) {
      continue;
    }
    return {
      name: cursorToolNameFromKey(key),
      args: isRecord(raw.args) ? raw.args : {},
      result: raw.result,
    };
  }
  return null;
}

function cursorToolResultPayload(result: unknown): { readonly ok: boolean; readonly output: unknown } {
  if (!isRecord(result)) {
    return { ok: true, output: result };
  }
  if (result.success !== undefined) {
    const success = result.success;
    if (isRecord(success) && typeof success.content === "string") {
      return { ok: true, output: success.content };
    }
    return { ok: true, output: success };
  }
  if (result.error !== undefined) {
    return { ok: false, output: errorText(result.error) };
  }
  return { ok: true, output: result };
}

function cursorToolEvents(msg: Record<string, unknown>): RunEvent[] {
  if (msg.type !== "tool_call") {
    return [];
  }
  const tool = cursorToolCallEntry(msg.tool_call);
  if (!tool) {
    return [];
  }
  const id = firstString(msg, ["call_id", "callId", "id"]) ?? "cursor-tool";
  if (msg.subtype === "started") {
    const rich = richToolEvents(id, tool.name, tool.args, "running");
    if (rich.length > 0) {
      return rich;
    }
    return [
      {
        type: "tool",
        id,
        name: tool.name,
        summary: clip(firstString(tool.args, ["command", "query", "path", "file_path", "filePath"]) ?? tool.name, 80),
        args: toArgs(tool.args),
      },
    ];
  }
  if (msg.subtype !== "completed") {
    return [];
  }
  const payload = cursorToolResultPayload(tool.result);
  const rich = richToolEvents(id, tool.name, tool.args, payload.ok ? "ok" : "error", payload.output);
  if (rich.length > 0) {
    return rich;
  }
  return [{ type: "tool_result", id, ok: payload.ok, output: resultText(payload.output) }];
}

export function createCursorStreamTranslator(): (line: string) => RunEvent[] {
  const translate = createClaudeStreamTranslator();
  return (line: string): RunEvent[] => {
    const msg = parseJsonRecord(line);
    if (!msg) {
      return [];
    }
    const toolEvents = cursorToolEvents(msg);
    if (toolEvents.length > 0) {
      return toolEvents;
    }
    return translate(line);
  };
}

function textFromUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(textFromUnknown).filter(Boolean).join("");
  }
  if (isRecord(value)) {
    if (typeof value.text === "string") {
      return value.text;
    }
    if (typeof value.content === "string") {
      return value.content;
    }
    if (Array.isArray(value.content)) {
      return textFromUnknown(value.content);
    }
    if (isRecord(value.message)) {
      return textFromUnknown(value.message);
    }
  }
  return "";
}

function errorText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (isRecord(value) && typeof value.message === "string") {
    return value.message;
  }
  return clip(value, 400);
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function firstNumber(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = positiveNumber(record[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function compactUsage(usage: RunUsage): RunUsage | undefined {
  return usage.totalTokens !== undefined ||
    usage.inputTokens !== undefined ||
    usage.outputTokens !== undefined ||
    usage.reasoningTokens !== undefined ||
    usage.cacheReadTokens !== undefined ||
    usage.cacheWriteTokens !== undefined
    ? usage
    : undefined;
}

function runUsageFromRecord(value: unknown): RunUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const cache = isRecord(value.cache) ? value.cache : {};
  return compactUsage({
    totalTokens: firstNumber(value, ["totalTokens", "total_tokens", "total"]),
    inputTokens: firstNumber(value, ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens", "input"]),
    outputTokens: firstNumber(value, ["outputTokens", "output_tokens", "completionTokens", "completion_tokens", "output"]),
    reasoningTokens: firstNumber(value, ["reasoningTokens", "reasoning_tokens", "thoughtsTokenCount", "thoughts_token_count", "reasoning"]),
    cacheReadTokens: firstNumber(value, ["cacheReadTokens", "cache_read_tokens", "cache_read_input_tokens", "cachedTokens", "cached_tokens", "cached_input_tokens", "cached"]) ?? firstNumber(cache, ["read"]),
    cacheWriteTokens: firstNumber(value, ["cacheWriteTokens", "cache_write_tokens", "cache_creation_input_tokens"]) ?? firstNumber(cache, ["write"]),
  });
}

function commandExecutionEvents(eventType: unknown, item: Record<string, unknown>): RunEvent[] {
  if (item.type !== "command_execution") {
    return [];
  }
  const id = typeof item.id === "string" && item.id.trim().length > 0 ? item.id : `command-${Date.now()}`;
  const command = typeof item.command === "string" ? item.command : "";
  if (eventType === "item.started") {
    return [
      {
        type: "tool",
        id,
        name: "Command",
        summary: clip(command, 80),
        args: command ? { command: clip(command, 160) } : {},
      },
    ];
  }
  if (eventType !== "item.completed") {
    return [];
  }
  const exitCode = typeof item.exit_code === "number" ? item.exit_code : null;
  const status = typeof item.status === "string" ? item.status : "";
  const output = typeof item.aggregated_output === "string" ? item.aggregated_output : "";
  return [
    {
      type: "tool_result",
      id,
      ok: exitCode === 0 || status === "completed" || status === "success",
      output: normalizeAgentToolOutput(output),
    },
  ];
}

interface CodexStreamState {
  readonly planTextById: Map<string, string>;
  sawAgentMessageDelta: boolean;
}

function planEventFromUnknown(id: string | undefined, value: unknown): Extract<RunEvent, { type: "plan" }> | null {
  const steps = planStepsFromTodos(value);
  if (steps) {
    return { type: "plan", id, steps };
  }
  if (isRecord(value)) {
    const nested = value.plan ?? value.todos ?? value.steps;
    const nestedSteps = planStepsFromTodos(nested);
    if (nestedSteps) {
      return { type: "plan", id, steps: nestedSteps };
    }
    const text = firstString(value, ["plan", "text", "content", "delta", "message"]);
    if (text) {
      return { type: "plan", id, steps: planStepsFromText(text) };
    }
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return { type: "plan", id, steps: planStepsFromText(value) };
  }
  return null;
}

function codexPlanDeltaEvent(msg: Record<string, unknown>, state: CodexStreamState): RunEvent[] {
  if (msg.type !== "plan_delta" && msg.type !== "PlanDelta" && msg.type !== "plan.update") {
    return [];
  }
  const id = firstString(msg, ["item_id", "itemId", "id"]) ?? "codex-plan";
  const delta = firstString(msg, ["delta", "text", "content"]);
  if (!delta) {
    return [];
  }
  const next = `${state.planTextById.get(id) ?? ""}${delta}`;
  state.planTextById.set(id, next);
  const event = planEventFromUnknown(id, next);
  return event ? [event] : [];
}

function codexPlanEvents(msg: Record<string, unknown>): RunEvent[] {
  if (msg.type !== "plan_update" && msg.type !== "plan" && msg.type !== "update_plan" && msg.type !== "PlanUpdate") {
    return [];
  }
  const event = planEventFromUnknown(firstString(msg, ["id", "item_id", "itemId"]), msg);
  return event ? [event] : [];
}

function codexSemanticItemEvents(eventType: unknown, item: Record<string, unknown>): RunEvent[] {
  const type = typeof item.type === "string" ? item.type : "";
  const id = firstString(item, ["id", "call_id", "callId", "item_id", "itemId"]);
  if (type === "plan" || type === "plan_update" || type === "todo" || type === "todo_update") {
    const event = planEventFromUnknown(id, item);
    return event ? [event] : [];
  }
  // Codex agent reasoning (thinking) — render as a reasoning block.
  if (type === "reasoning") {
    const text = firstString(item, ["text", "content", "reasoning", "summary"]);
    return text ? [{ type: "reasoning", text }] : [];
  }
  // Codex's plan tracker arrives as `todo_list` with {text, completed} items.
  if (type === "todo_list") {
    const rawItems = Array.isArray(item.items) ? item.items : Array.isArray(item.todos) ? item.todos : [];
    const steps = rawItems
      .filter(isRecord)
      .map((todo) => ({ label: firstString(todo, ["text", "content", "title", "label", "step"]) ?? "", state: (todo.completed === true ? "ok" : "pending") as RunState }))
      .filter((step) => step.label.length > 0);
    return steps.length > 0 ? [{ type: "plan", id, steps }] : [];
  }
  // File edits arrive as {changes:[{path, kind}]} without inline diff content.
  if (type === "file_change") {
    const changes = Array.isArray(item.changes) ? item.changes.filter(isRecord) : [];
    const files = changes
      .map((change) => firstString(change, ["path", "file", "file_path"]))
      .filter((path): path is string => typeof path === "string" && path.length > 0);
    if (files.length === 0) {
      return [];
    }
    return [{ type: "tool", id: id ?? `file-change-${files[0]}`, name: "Edit", summary: files.length === 1 ? files[0] : `${files.length} files changed` }];
  }
  // MCP tool calls — surface the call and its result generically.
  if (type === "mcp_tool_call") {
    const toolName = firstString(item, ["tool", "name"]) ?? "mcp";
    const server = firstString(item, ["server"]);
    const callId = id ?? `mcp-${toolName}`;
    const events: RunEvent[] = [{ type: "tool", id: callId, name: server ? `${server}/${toolName}` : toolName }];
    if (eventType === "item.completed") {
      const status = String(item.status ?? "").toLowerCase();
      const ok = status !== "failed" && status !== "error";
      const result = item.result ?? item.output;
      events.push({ type: "tool_result", id: callId, ok, output: typeof result === "string" ? result : result === undefined ? "" : JSON.stringify(result) });
    }
    return events;
  }
  // Non-fatal error items carry a message we should surface, not drop.
  if (type === "error") {
    const text = firstString(item, ["message", "error", "text"]);
    return text ? [{ type: "error", text }] : [];
  }
  const state: RunState =
    eventType === "item.completed" ? (String(item.status ?? "").toLowerCase() === "failed" || String(item.status ?? "").toLowerCase() === "error" ? "error" : "ok") : "running";
  const name = firstString(item, ["name", "tool", "tool_name", "toolName"]) ?? type;
  const input = isRecord(item.input) ? item.input : item;
  const rich = richToolEvents(id, name, input, state, item.output ?? item.result ?? item.aggregated_output);
  return rich;
}

function codexItemEvents(msg: Record<string, unknown>, state: CodexStreamState): RunEvent[] {
  if (msg.type !== "item.started" && msg.type !== "item.completed") {
    return [];
  }
  if (!isRecord(msg.item)) {
    return [];
  }
  const item = msg.item;
  if (item.type === "agent_message") {
    if (state.sawAgentMessageDelta && msg.type === "item.completed") {
      return [];
    }
    const text = textFromUnknown(item);
    return text ? [{ type: "text", text }] : [];
  }
  const commandEvents = commandExecutionEvents(msg.type, item);
  if (commandEvents.length > 0) {
    return commandEvents;
  }
  const semanticEvents = codexSemanticItemEvents(msg.type, item);
  if (semanticEvents.length > 0) {
    if ((item.type === "plan" || item.type === "plan_update") && firstString(item, ["id"])) {
      const text = firstString(item, ["text", "content", "plan"]);
      if (text) {
        state.planTextById.set(String(firstString(item, ["id"])), text);
      }
    }
    return semanticEvents;
  }
  return [];
}

export function createCodexStreamTranslator(): (line: string) => RunEvent[] {
  const state: CodexStreamState = { planTextById: new Map(), sawAgentMessageDelta: false };
  return (line: string): RunEvent[] => {
    let msg: unknown;
    try {
      msg = JSON.parse(line) as unknown;
    } catch {
      const text = line.trim();
      return text ? [{ type: "text", text }] : [];
    }
    if (!isRecord(msg)) {
      return [];
    }
    const itemEvents = codexItemEvents(msg, state);
    if (itemEvents.length > 0) {
      return itemEvents;
    }
    const planDeltaEvents = codexPlanDeltaEvent(msg, state);
    if (planDeltaEvents.length > 0) {
      return planDeltaEvents;
    }
    const planEvents = codexPlanEvents(msg);
    if (planEvents.length > 0) {
      return planEvents;
    }
    switch (msg.type) {
      case "thread.started":
      case "session.created":
      case "session_configured": {
        const id = firstString(msg, ["thread_id", "session_id", "conversation_id", "threadId", "sessionId", "id"]);
        return id ? [{ type: "session", id }] : [];
      }
      case "turn.started":
        return [{ type: "status", level: "info", text: "codex turn started" }];
      case "agent_message_delta":
      case "agent.message.delta":
      case "message.delta": {
        const text = textFromUnknown(msg.delta ?? msg.text ?? msg.message ?? msg.content);
        if (!text) {
          return [];
        }
        state.sawAgentMessageDelta = true;
        return [{ type: "text", text }];
      }
      case "agent_message": {
        if (state.sawAgentMessageDelta && msg.final !== false) {
          return [];
        }
        const text = textFromUnknown(msg.message ?? msg.delta ?? msg);
        if (typeof msg.delta === "string") {
          state.sawAgentMessageDelta = true;
        }
        return text ? [{ type: "text", text }] : [];
      }
      case "error":
        return [{ type: "error", text: errorText(msg.message ?? msg.error) }];
      case "turn.failed":
        return [{ type: "error", text: errorText(msg.error) }];
      case "turn.completed":
        return [{ type: "done", usage: runUsageFromRecord(msg.usage) }];
      default: {
        const text = textFromUnknown(msg);
        return text ? [{ type: "text", text }] : [];
      }
    }
  };
}

function geminiThoughtText(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((thought) => {
      if (!isRecord(thought)) {
        return "";
      }
      const subject = typeof thought.subject === "string" ? thought.subject.trim() : "";
      const description = typeof thought.description === "string" ? thought.description.trim() : "";
      return [subject, description].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

function geminiToolEvents(value: unknown): RunEvent[] {
  const tools = Array.isArray(value) ? value : isRecord(value) ? [value] : [];
  const events: RunEvent[] = [];
  tools.forEach((tool, index) => {
    if (!isRecord(tool)) {
      return;
    }
    const id =
      typeof tool.callId === "string" && tool.callId.trim().length > 0
        ? tool.callId
        : typeof tool.id === "string" && tool.id.trim().length > 0
          ? tool.id
          : `gemini-tool-${index}`;
    const name = typeof tool.name === "string" && tool.name.trim().length > 0 ? tool.name : "tool";
    const summary = typeof tool.description === "string" && tool.description.trim().length > 0 ? tool.description : name;
    const input = isRecord(tool.args) ? tool.args : undefined;
    const hasResult = tool.resultDisplay !== undefined || tool.result !== undefined || tool.output !== undefined || tool.status !== undefined;
    const status = typeof tool.status === "string" ? tool.status.toLowerCase() : "";
    const ok = status !== "error" && status !== "failed" && status !== "failure";
    const rich = richToolEvents(id, name, input, hasResult ? (ok ? "ok" : "error") : "running", tool.resultDisplay ?? tool.result ?? tool.output);
    if (rich.length > 0) {
      events.push(...rich);
    } else {
      events.push({
        type: "tool",
        id,
        name,
        summary: clip(summary, 80),
        args: toArgs(tool.args),
      });
    }
    if (hasResult) {
      if (rich.length === 0) {
        events.push({
          type: "tool_result",
          id,
          ok,
          output: resultText(tool.resultDisplay ?? tool.result ?? tool.output ?? ""),
        });
      }
    }
  });
  return events;
}

function geminiToolUseId(msg: Record<string, unknown>, fallbackIndex: number): string {
  return firstString(msg, ["tool_id", "callId", "call_id", "id"]) ?? `gemini-tool-${fallbackIndex}`;
}

function geminiToolInput(msg: Record<string, unknown>): Record<string, unknown> | undefined {
  if (isRecord(msg.parameters)) {
    return msg.parameters;
  }
  if (isRecord(msg.args)) {
    return msg.args;
  }
  if (isRecord(msg.input)) {
    return msg.input;
  }
  return undefined;
}

function geminiUpdateTopicReasoning(input: Record<string, unknown> | undefined): RunEvent | null {
  const title = firstString(input, ["title", "topic"]);
  const summary = firstString(input, ["summary", "description"]);
  const intent = firstString(input, ["strategic_intent", "intent"]);
  const text = [title, summary, intent ? `Intent: ${intent}` : undefined].filter(Boolean).join("\n");
  return text ? { type: "reasoning", text } : null;
}

function geminiToolUseEvents(msg: Record<string, unknown>, fallbackIndex: number): RunEvent[] {
  const id = geminiToolUseId(msg, fallbackIndex);
  const name = firstString(msg, ["tool_name", "name"]) ?? "tool";
  const input = geminiToolInput(msg);
  if (normalizedToolName(name) === "updatetopic") {
    const reasoning = geminiUpdateTopicReasoning(input);
    return reasoning ? [reasoning] : [];
  }
  const rich = richToolEvents(id, name, input, "running");
  if (rich.length > 0) {
    return rich;
  }
  const summary = firstString(input, ["description", "summary", "command", "path", "file_path"]) ?? firstString(msg, ["description", "summary"]) ?? name;
  return [{ type: "tool", id, name, summary: clip(summary, 80), args: toArgs(input) }];
}

function geminiToolResultEvents(msg: Record<string, unknown>): RunEvent[] {
  const id = firstString(msg, ["tool_id", "callId", "call_id", "id"]);
  if (!id) {
    return [];
  }
  const status = firstString(msg, ["status"])?.toLowerCase() ?? "";
  const ok = status !== "error" && status !== "failed" && status !== "failure";
  const output = msg.output ?? msg.resultDisplay ?? msg.result ?? msg.content ?? "";
  return [{ type: "tool_result", id, ok, output: resultText(output) }];
}

export function createGeminiStreamTranslator(): (line: string) => RunEvent[] {
  let assistantDeltaText = "";
  let anonymousToolIndex = 0;
  return (line: string): RunEvent[] => {
    let msg: unknown;
    try {
      msg = JSON.parse(line) as unknown;
    } catch {
      const text = line.trim();
      return text ? [{ type: "text", text }] : [];
    }
    if (!isRecord(msg)) {
      return [];
    }
    if (msg.type === "init") {
      const model = typeof msg.model === "string" && msg.model.trim().length > 0 ? msg.model : "gemini";
      return [{ type: "status", level: "info", text: `model · ${model}` }];
    }
    if (msg.type === "message") {
      if (msg.role === "user") {
        return [];
      }
      const text = textFromUnknown(msg.content ?? msg.text ?? msg);
      if (msg.delta === true) {
        assistantDeltaText += text;
        return text ? [{ type: "text", text }] : [];
      }
      if (assistantDeltaText) {
        const previousDeltaText = assistantDeltaText;
        assistantDeltaText = "";
        if (!text || text === previousDeltaText) {
          return [];
        }
        if (text.startsWith(previousDeltaText)) {
          const tail = text.slice(previousDeltaText.length);
          return tail ? [{ type: "text", text: tail }] : [];
        }
      }
      return text ? [{ type: "text", text }] : [];
    }
    if (msg.type === "result") {
      if (msg.status === "success") {
        return [{ type: "done", usage: runUsageFromRecord(msg.stats ?? msg.usage) }];
      }
      return [
        { type: "error", text: errorText(msg.error ?? msg.message ?? msg.status ?? "run failed") },
        { type: "done", usage: runUsageFromRecord(msg.stats ?? msg.usage) },
      ];
    }
    if (msg.type === "tool_group") {
      return geminiToolEvents(msg.tools);
    }
    if (msg.type === "tool") {
      return geminiToolEvents(msg);
    }
    if (msg.type === "tool_use") {
      const index = anonymousToolIndex;
      anonymousToolIndex += 1;
      return geminiToolUseEvents(msg, index);
    }
    if (msg.type === "tool_result") {
      return geminiToolResultEvents(msg);
    }
    const events: RunEvent[] = [];
    const reasoning = geminiThoughtText(msg.thoughts);
    if (reasoning) {
      events.push({ type: "reasoning", text: reasoning });
    }
    const text = textFromUnknown(msg);
    if (text) {
      events.push({ type: "text", text });
    }
    if (events.length > 0) {
      return events;
    }
    if (msg.type === "error" || msg.type === "turn.failed") {
      return [{ type: "error", text: errorText(msg.error ?? msg.message) }];
    }
    return [];
  };
}

function opencodePart(msg: Record<string, unknown>): Record<string, unknown> | null {
  return isRecord(msg.part) ? msg.part : null;
}

function opencodePartId(part: Record<string, unknown>, fallback: string): string {
  if (typeof part.callID === "string" && part.callID.trim().length > 0) {
    return part.callID;
  }
  if (typeof part.toolCallID === "string" && part.toolCallID.trim().length > 0) {
    return part.toolCallID;
  }
  if (typeof part.id === "string" && part.id.trim().length > 0) {
    return part.id;
  }
  return fallback;
}

function opencodeToolName(part: Record<string, unknown>): string {
  if (typeof part.tool === "string" && part.tool.trim().length > 0) {
    return part.tool;
  }
  if (typeof part.name === "string" && part.name.trim().length > 0) {
    return part.name;
  }
  return "tool";
}

function opencodeToolInput(part: Record<string, unknown>): Record<string, unknown> | undefined {
  if (isRecord(part.input)) {
    return part.input;
  }
  if (isRecord(part.args)) {
    return part.args;
  }
  if (isRecord(part.state) && isRecord(part.state.input)) {
    return part.state.input;
  }
  return undefined;
}

function opencodeToolOutput(part: Record<string, unknown>): unknown {
  if (part.output !== undefined || part.result !== undefined || part.error !== undefined) {
    return part.output ?? part.result ?? part.error;
  }
  if (isRecord(part.state)) {
    return part.state.output ?? part.state.result ?? part.state.error;
  }
  return undefined;
}

function opencodeToolEvents(msg: Record<string, unknown>, part: Record<string, unknown>): RunEvent[] {
  const partType = typeof part.type === "string" ? part.type : "";
  if (!partType.toLowerCase().includes("tool")) {
    return [];
  }
  const id = opencodePartId(part, typeof msg.sessionID === "string" ? `opencode-tool-${msg.sessionID}` : "opencode-tool");
  const name = opencodeToolName(part);
  const input = opencodeToolInput(part);
  const args = toArgs(input);
  const stateRecord = isRecord(part.state) ? part.state : null;
  const status =
    typeof part.state === "string"
      ? part.state.toLowerCase()
      : typeof part.status === "string"
        ? part.status.toLowerCase()
        : typeof stateRecord?.status === "string"
          ? stateRecord.status.toLowerCase()
          : "";
  const output = opencodeToolOutput(part);
  const ok = status !== "error" && status !== "failed" && part.error === undefined;
  const rich = richToolEvents(id, name, input, output !== undefined || status === "completed" ? (ok ? "ok" : "error") : "running", output);
  const events: RunEvent[] =
    rich.length > 0
      ? [...rich]
      : [
          {
            type: "tool",
            id,
            name,
            summary: clip(part.description ?? part.title ?? part.command ?? name, 80),
            args,
          },
        ];
  if (output !== undefined || status === "completed" || status === "error" || status === "failed") {
    if (rich.length === 0) {
      events.push({
        type: "tool_result",
        id,
        ok,
        output: resultText(output ?? ""),
      });
    }
  }
  return events;
}

function opencodeLifecycleToolInput(properties: Record<string, unknown>): Record<string, unknown> | undefined {
  if (isRecord(properties.input)) {
    return properties.input;
  }
  if (isRecord(properties.args)) {
    return properties.args;
  }
  if (isRecord(properties.output) && isRecord(properties.output.args)) {
    return properties.output.args;
  }
  return undefined;
}

function opencodeLifecycleToolOutput(properties: Record<string, unknown>): unknown {
  if (properties.result !== undefined || properties.error !== undefined) {
    return properties.result ?? properties.error;
  }
  if (properties.output === undefined) {
    return undefined;
  }
  if (isRecord(properties.output)) {
    return properties.output.result ?? properties.output.output ?? properties.output.error;
  }
  return properties.output;
}

function opencodeToolLifecycleEvents(msg: Record<string, unknown>): RunEvent[] {
  const event = opencodeSdkEnvelope(msg) ?? msg;
  const type = typeof event.type === "string" ? event.type : "";
  if (type !== "tool.execute.before" && type !== "tool_execute_before" && type !== "tool.execute.after" && type !== "tool_execute_after") {
    return [];
  }

  const properties = opencodeEventProperties(event);
  const id = firstString(properties, ["callID", "callId", "toolCallID", "toolCallId", "id"]) ?? "opencode-tool";
  const name = firstString(properties, ["tool", "toolName", "name"]) ?? "tool";
  const input = opencodeLifecycleToolInput(properties);
  const output = type === "tool.execute.after" || type === "tool_execute_after" ? opencodeLifecycleToolOutput(properties) : undefined;
  const status = firstString(properties, ["status", "state"])?.toLowerCase() ?? "";
  const failed = status === "error" || status === "failed" || properties.error !== undefined;
  const state: RunState = output !== undefined || status === "completed" || status === "success" || failed ? (failed ? "error" : "ok") : "running";
  const rich = richToolEvents(id, name, input, state, output);
  if (rich.length > 0) {
    return rich;
  }

  const summary = firstString(properties, ["description", "title", "command"]) ?? firstString(input, ["command", "query", "path", "file_path", "filePath"]) ?? name;
  const events: RunEvent[] = [{ type: "tool", id, name, summary: clip(summary, 80), args: toArgs(input) }];
  if (state === "ok" || state === "error") {
    events.push({ type: "tool_result", id, ok: state === "ok", output: resultText(output ?? "") });
  }
  return events;
}

function opencodeSdkEnvelope(msg: Record<string, unknown>): Record<string, unknown> | null {
  if (msg.type === "sdk_event" && isRecord(msg.event)) {
    return msg.event;
  }
  if (msg.type === "SdkEvent" && isRecord(msg.event)) {
    return msg.event;
  }
  return null;
}

interface OpenCodeStreamState {
  readonly messageRoleByKey: Map<string, string>;
  readonly assistantTextByMessageKey: Map<string, string>;
  readonly assistantReasoningByMessageKey: Map<string, string>;
  sessionEmitted: boolean;
}

/** opencode mints its own session id (`ses_…`), present on every event (top-level
 *  or nested). The first event is a content-free `step_start`, so emitting the
 *  session id there loses nothing. */
function opencodeSessionId(msg: Record<string, unknown>): string | undefined {
  const direct = firstString(msg, ["sessionID", "sessionId"]);
  if (direct) {
    return direct;
  }
  for (const key of ["part", "info", "properties", "message"]) {
    const nested = msg[key];
    if (isRecord(nested)) {
      const id = firstString(nested, ["sessionID", "sessionId"]);
      if (id) {
        return id;
      }
    }
  }
  return undefined;
}

function opencodeEventProperties(event: Record<string, unknown>): Record<string, unknown> {
  return isRecord(event.properties) ? event.properties : event;
}

function opencodeMessageKey(sessionId: string | undefined, messageId: string): string {
  return `${sessionId ?? ""}:${messageId}`;
}

function opencodeSdkMessageEvents(msg: Record<string, unknown>, state: OpenCodeStreamState): RunEvent[] | null {
  const event = opencodeSdkEnvelope(msg) ?? msg;
  const type = typeof event.type === "string" ? event.type : "";
  const properties = opencodeEventProperties(event);

  if (type === "message.updated" || type === "message_updated") {
    const info = isRecord(properties.info) ? properties.info : properties;
    const messageId = firstString(info, ["id", "messageID", "messageId"]);
    const role = firstString(info, ["role"]);
    if (messageId && role) {
      state.messageRoleByKey.set(opencodeMessageKey(firstString(info, ["sessionID", "sessionId"]), messageId), role);
    }
    return [];
  }

  if (type !== "message.part.updated" && type !== "message_part_updated") {
    return null;
  }

  const part = isRecord(properties.part) ? properties.part : null;
  const partType = typeof part?.type === "string" ? part.type : "";
  if (!part || (partType !== "text" && partType !== "reasoning")) {
    return null;
  }
  const messageId = firstString(part, ["messageID", "messageId"]);
  if (!messageId) {
    return [];
  }
  const messageKey = opencodeMessageKey(firstString(part, ["sessionID", "sessionId"]) ?? firstString(properties, ["sessionID", "sessionId"]), messageId);
  if (state.messageRoleByKey.get(messageKey) !== "assistant") {
    return [];
  }

  const delta = typeof properties.delta === "string" ? properties.delta : "";
  const fullText = typeof part.text === "string" ? part.text : "";
  const textByMessageKey = partType === "reasoning" ? state.assistantReasoningByMessageKey : state.assistantTextByMessageKey;
  const previousText = textByMessageKey.get(messageKey) ?? "";
  const eventFromText = (text: string): RunEvent => (partType === "reasoning" ? { type: "reasoning", text } : { type: "text", text });

  if (delta) {
    textByMessageKey.set(messageKey, `${previousText}${delta}`);
    return [eventFromText(delta)];
  }
  if (!fullText || fullText === previousText) {
    return [];
  }
  textByMessageKey.set(messageKey, fullText);
  if (previousText && fullText.startsWith(previousText)) {
    const tail = fullText.slice(previousText.length);
    return tail ? [eventFromText(tail)] : [];
  }
  return [eventFromText(fullText)];
}

function opencodeTodoEvents(msg: Record<string, unknown>): RunEvent[] {
  const envelope = opencodeSdkEnvelope(msg) ?? msg;
  const type = typeof envelope.type === "string" ? envelope.type : "";
  if (type !== "todo.updated" && type !== "todo_updated") {
    return [];
  }
  const properties = isRecord(envelope.properties) ? envelope.properties : envelope;
  const event = planEventFromUnknown("opencode-todo", properties);
  return event ? [event] : [];
}

function opencodeQuestionEvents(msg: Record<string, unknown>): RunEvent[] {
  const envelope = opencodeSdkEnvelope(msg) ?? msg;
  const type = typeof envelope.type === "string" ? envelope.type : "";
  if (type !== "question.asked" && type !== "question_asked") {
    return [];
  }
  const properties = isRecord(envelope.properties) ? envelope.properties : envelope;
  const id = firstString(properties, ["id", "callID", "callId"]) ?? "opencode-question";
  return richToolEvents(id, "question", properties, "running");
}

export function createOpenCodeStreamTranslator(): (line: string) => RunEvent[] {
  const state: OpenCodeStreamState = {
    messageRoleByKey: new Map(),
    assistantTextByMessageKey: new Map(),
    assistantReasoningByMessageKey: new Map(),
    sessionEmitted: false,
  };
  return (line: string): RunEvent[] => {
    let msg: unknown;
    try {
      msg = JSON.parse(line) as unknown;
    } catch {
      const text = line.trim();
      return text ? [{ type: "text", text }] : [];
    }
    if (!isRecord(msg)) {
      return [];
    }
    if (!state.sessionEmitted) {
      const sessionId = opencodeSessionId(msg);
      if (sessionId) {
        state.sessionEmitted = true;
        return [{ type: "session", id: sessionId }];
      }
    }
    const todoEvents = opencodeTodoEvents(msg);
    if (todoEvents.length > 0) {
      return todoEvents;
    }
    const questionEvents = opencodeQuestionEvents(msg);
    if (questionEvents.length > 0) {
      return questionEvents;
    }
    const toolLifecycleEvents = opencodeToolLifecycleEvents(msg);
    if (toolLifecycleEvents.length > 0) {
      return toolLifecycleEvents;
    }
    const sdkMessageEvents = opencodeSdkMessageEvents(msg, state);
    if (sdkMessageEvents) {
      return sdkMessageEvents;
    }
    const part = opencodePart(msg);
    if (part) {
      const toolEvents = opencodeToolEvents(msg, part);
      if (toolEvents.length > 0) {
        return toolEvents;
      }
      if (part.type === "reasoning") {
        const text = textFromUnknown(part.text ?? part);
        return text ? [{ type: "reasoning", text }] : [];
      }
      if (part.type === "text") {
        const text = textFromUnknown(part.text ?? part);
        return text ? [{ type: "text", text }] : [];
      }
      if (part.type === "step-start") {
        return [{ type: "status", level: "info", text: "opencode step started" }];
      }
      if (part.type === "step-finish") {
        return [{ type: "done", costUsd: typeof part.cost === "number" ? part.cost : undefined, usage: runUsageFromRecord(part.tokens) }];
      }
    }
    if (msg.type === "error") {
      return [{ type: "error", text: errorText(msg.error ?? msg.message ?? msg) }];
    }
    if (msg.type === "step_finish") {
      const finishPart = opencodePart(msg);
      return [
        {
          type: "done",
          costUsd: finishPart && typeof finishPart.cost === "number" ? finishPart.cost : undefined,
          usage: finishPart ? runUsageFromRecord(finishPart.tokens) : undefined,
        },
      ];
    }
    return [];
  };
}

function createRunEventSender(res: ServerResponse): { readonly send: (event: RunEvent) => void; readonly sendDone: () => void; readonly end: () => void; readonly isClosed: () => boolean } {
  let doneSent = false;
  let closed = false;
  res.on("close", () => {
    closed = true;
  });
  const send = (event: RunEvent) => {
    if (event.type === "done") {
      if (doneSent) {
        return;
      }
      doneSent = true;
    }
    if (!closed && !res.writableEnded) {
      res.write(`${JSON.stringify(event)}\n`);
    }
  };
  return {
    send,
    sendDone: () => send({ type: "done" }),
    end: () => {
      if (!closed && !res.writableEnded) {
        res.end();
      }
    },
    isClosed: () => closed || res.writableEnded,
  };
}

function translateSdkMessage(translate: (line: string) => RunEvent[], message: unknown): RunEvent[] {
  try {
    return translate(JSON.stringify(message));
  } catch (error) {
    return [{ type: "error", text: error instanceof Error ? error.message : String(error) }];
  }
}

async function runClaudeSdk(
  request: RunRequest,
  cwd: string,
  res: ServerResponse,
  send: (event: RunEvent) => void,
  sendDone: () => void,
  end: () => void,
  binding: BackgroundRunBinding | null,
  accumulator: BackgroundRunAccumulator | null,
): Promise<void> {
  const abortController = new AbortController();
  res.on("close", () => {
    if (!binding && !abortController.signal.aborted) {
      abortController.abort();
    }
  });
  if (binding) {
    backgroundRunHandles.set(binding.runId, {
      binding,
      startedAt: new Date().toISOString(),
      cancel: () => {
        if (!abortController.signal.aborted) {
          abortController.abort();
        }
      },
    });
  }
  const translate = createClaudeStreamTranslator();
  const canUseTool = createRunApprovalHandler(send, binding?.runId, request.accessMode === "unrestricted");

  try {
    for await (const message of query({ prompt: request.prompt, options: buildClaudeSdkOptions(request, cwd, abortController, canUseTool) })) {
      // Capture account rate-limit snapshots Claude emits in the stream so the
      // composer can show the current 5-hour / weekly window state.
      if (message.type === "rate_limit_event" && isRecord(message.rate_limit_info)) {
        recordClaudeRateLimit(request.agent, message.rate_limit_info);
      }
      for (const event of translateSdkMessage(translate, message)) {
        send(event);
      }
    }
  } catch (error) {
    if (!abortController.signal.aborted) {
      send({ type: "error", text: error instanceof Error ? error.message : String(error) });
    }
  } finally {
    if (binding && accumulator) {
      finishPersistedBackgroundRun(binding, accumulator, abortController.signal.aborted);
      notifyBackgroundRunUpdate(binding, true);
      backgroundRunHandles.delete(binding.runId);
    }
    sendDone();
    end();
  }
}

// --- OpenCode via its HTTP server (like vibe-kanban) ------------------------
// `opencode run --format json` drops the assistant text part for some models;
// the `opencode serve` HTTP API returns the full {info, parts} (text included),
// so we drive opencode through a per-run server instead of the CLI run mode.

const OPENCODE_SERVER_TIMEOUT_MS = 20_000;
const OPENCODE_RUN_TIMEOUT_MS = 5 * 60_000;

function waitForOpenCodeServerUrl(proc: ReturnType<typeof spawn>, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout?.off("data", onData);
      proc.off("exit", onExit);
      signal.removeEventListener("abort", onAbort);
    };
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const match = buffer.match(/(https?:\/\/127\.0\.0\.1:\d+)/);
      if (match?.[1]) {
        cleanup();
        resolve(match[1]);
      }
    };
    const onExit = () => {
      cleanup();
      reject(new Error("opencode server exited before reporting a URL"));
    };
    const onAbort = () => {
      cleanup();
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("opencode server did not report a URL in time"));
    }, OPENCODE_SERVER_TIMEOUT_MS);
    proc.stdout?.on("data", onData);
    proc.once("exit", onExit);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function emitOpenCodeParts(parts: unknown, send: (event: RunEvent) => void): void {
  if (!Array.isArray(parts)) {
    return;
  }
  for (const part of parts) {
    if (!isRecord(part)) {
      continue;
    }
    if (part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0) {
      send({ type: "text", text: part.text });
    } else if (part.type === "reasoning" && typeof part.text === "string" && part.text.trim().length > 0) {
      send({ type: "reasoning", text: part.text });
    } else if (part.type === "tool") {
      const callId = firstString(part, ["id", "callID", "call_id"]) ?? `opencode-tool-${firstString(part, ["tool", "name"]) ?? ""}`;
      const name = firstString(part, ["tool", "name"]) ?? "tool";
      send({ type: "tool", id: callId, name });
      const state = isRecord(part.state) ? part.state : undefined;
      if (state && (typeof state.output === "string" || state.status === "completed" || state.status === "error")) {
        send({ type: "tool_result", id: callId, ok: state.status !== "error", output: typeof state.output === "string" ? state.output : "" });
      }
    }
  }
}

async function runOpenCodeServer(
  request: RunRequest,
  cwd: string,
  res: ServerResponse,
  send: (event: RunEvent) => void,
  sendDone: () => void,
  end: () => void,
  binding: BackgroundRunBinding | null,
  accumulator: BackgroundRunAccumulator | null,
): Promise<void> {
  const abortController = new AbortController();
  res.on("close", () => {
    if (!binding && !abortController.signal.aborted) {
      abortController.abort();
    }
  });
  if (binding) {
    backgroundRunHandles.set(binding.runId, {
      binding,
      startedAt: new Date().toISOString(),
      cancel: () => {
        if (!abortController.signal.aborted) {
          abortController.abort();
        }
      },
    });
  }
  const runTimeout = setTimeout(() => {
    if (!abortController.signal.aborted) {
      abortController.abort();
    }
  }, OPENCODE_RUN_TIMEOUT_MS);
  let serverProc: ReturnType<typeof spawn> | null = null;
  try {
    const resolvedBin = resolveBinOnPath("opencode", process.env.PATH ?? "");
    if (!resolvedBin) {
      throw new Error("opencode is not installed (not found on PATH).");
    }
    const password = randomUUID();
    const launch = resolveLaunchCommand(resolvedBin, ["serve", "--hostname", "127.0.0.1", "--port", "0"]);
    serverProc = spawn(launch.command, [...launch.args], {
      cwd,
      env: { ...process.env, ...readAgentSecretConfig().env, OPENCODE_SERVER_USERNAME: "opencode", OPENCODE_SERVER_PASSWORD: password },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const baseUrl = await waitForOpenCodeServerUrl(serverProc, abortController.signal);
    const headers = { "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` };
    const dir = `directory=${encodeURIComponent(cwd)}`;

    let sessionId = request.resume;
    if (!sessionId) {
      const sessionRes = await fetch(`${baseUrl}/session?${dir}`, { method: "POST", headers, body: "{}", signal: abortController.signal });
      if (!sessionRes.ok) {
        throw new Error(`opencode session create failed: HTTP ${sessionRes.status}`);
      }
      const sessionJson = (await sessionRes.json()) as { id?: string };
      sessionId = typeof sessionJson.id === "string" ? sessionJson.id : undefined;
      if (!sessionId) {
        throw new Error("opencode session create returned no id");
      }
    }
    send({ type: "session", id: sessionId });

    const profile = normalizeAgentProfile(request, "opencode");
    const body: Record<string, unknown> = { parts: [{ type: "text", text: request.prompt }] };
    const modelValue = modelForProfile(profile);
    if (modelValue && modelValue.includes("/")) {
      const slash = modelValue.indexOf("/");
      body.model = { providerID: modelValue.slice(0, slash), modelID: modelValue.slice(slash + 1) };
    }
    const reasoning = reasoningForProfile(profile);
    if (reasoning) {
      body.variant = reasoning;
    }
    if (request.accessMode !== "unrestricted") {
      body.agent = "plan";
    }

    const messageRes = await fetch(`${baseUrl}/session/${sessionId}/message?${dir}`, { method: "POST", headers, body: JSON.stringify(body), signal: abortController.signal });
    const rawBody = await messageRes.text();
    if (!messageRes.ok) {
      throw new Error(`opencode message failed: HTTP ${messageRes.status} ${rawBody.slice(0, 200)}`);
    }
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    if (typeof parsed.name === "string" && parsed.data) {
      const detail = isRecord(parsed.data) && typeof parsed.data.message === "string" ? parsed.data.message : "";
      throw new Error(`opencode: ${parsed.name}: ${detail}`);
    }
    emitOpenCodeParts(parsed.parts, send);
    const info = isRecord(parsed.info) ? parsed.info : undefined;
    send({ type: "done", costUsd: info && typeof info.cost === "number" ? info.cost : undefined, usage: info ? runUsageFromRecord(info.tokens) : undefined });
  } catch (error) {
    if (!abortController.signal.aborted) {
      send({ type: "error", text: error instanceof Error ? error.message : String(error) });
    }
  } finally {
    clearTimeout(runTimeout);
    if (serverProc) {
      try {
        serverProc.kill("SIGTERM");
      } catch {
        // already gone
      }
    }
    if (binding && accumulator) {
      finishPersistedBackgroundRun(binding, accumulator, abortController.signal.aborted);
      notifyBackgroundRunUpdate(binding, true);
      backgroundRunHandles.delete(binding.runId);
    }
    sendDone();
    end();
  }
}

// --- Codex via its `app-server` JSON-RPC protocol (like vibe-kanban) ---------
// `codex exec --json` only surfaces a flat event stream. The `codex app-server`
// process speaks newline-delimited JSON-RPC 2.0 over stdin/stdout (bidirectional,
// so it can request approvals), exposing structured thread items, streaming
// deltas, reasoning, plans, and token usage. We drive a per-run app-server and
// translate its notifications into RunEvents. Protocol reference (camelCase, the
// installed codex 0.137): `codex app-server generate-ts`.

const CODEX_APP_SERVER_TIMEOUT_MS = 30_000;
const CODEX_RUN_TIMEOUT_MS = 30 * 60_000;

/** Map a Codex `ThreadTokenUsage` (total breakdown) to our RunUsage shape. */
export function codexAppServerUsage(tokenUsage: unknown): RunUsage | undefined {
  if (!isRecord(tokenUsage)) {
    return undefined;
  }
  const total = isRecord(tokenUsage.total) ? tokenUsage.total : tokenUsage;
  return compactUsage({
    totalTokens: firstNumber(total, ["totalTokens"]),
    inputTokens: firstNumber(total, ["inputTokens"]),
    outputTokens: firstNumber(total, ["outputTokens"]),
    reasoningTokens: firstNumber(total, ["reasoningOutputTokens"]),
    cacheReadTokens: firstNumber(total, ["cachedInputTokens"]),
  });
}

function codexPlanStepState(status: unknown): RunState {
  const value = String(status ?? "").toLowerCase();
  if (value === "completed") {
    return "ok";
  }
  if (value === "inprogress" || value === "in_progress") {
    return "running";
  }
  return "pending";
}

/** Translate a Codex app-server `ThreadItem` (camelCase tags) into RunEvents. */
export function codexAppServerItemEvents(item: Record<string, unknown>, completed: boolean): RunEvent[] {
  const type = typeof item.type === "string" ? item.type : "";
  const id = firstString(item, ["id"]);
  switch (type) {
    case "agentMessage": {
      const text = firstString(item, ["text"]);
      return text ? [{ type: "text", text }] : [];
    }
    case "reasoning": {
      const summary = Array.isArray(item.summary) ? item.summary.filter((s): s is string => typeof s === "string") : [];
      const content = Array.isArray(item.content) ? item.content.filter((s): s is string => typeof s === "string") : [];
      const text = [...summary, ...content].join("\n").trim();
      return text ? [{ type: "reasoning", text }] : [];
    }
    case "plan": {
      const text = firstString(item, ["text"]);
      return text ? [{ type: "plan", id, steps: planStepsFromText(text) }] : [];
    }
    case "commandExecution": {
      const command = firstString(item, ["command"]) ?? "";
      const callId = id ?? `codex-cmd-${command}`;
      const events: RunEvent[] = [{ type: "tool", id: callId, name: "Shell", summary: clip(command, 120) }];
      if (completed) {
        const ok = String(item.status ?? "").toLowerCase() === "completed";
        events.push({ type: "tool_result", id: callId, ok, output: firstString(item, ["aggregatedOutput"]) ?? "" });
      }
      return events;
    }
    case "fileChange": {
      // Model a file change as a tool with a full lifecycle: a running "Edit" on
      // item.started, then a tool_result on item.completed so it settles as soon
      // as the patch applies — not when the whole turn ends. The unified diff is
      // surfaced as a separate diff block for rich rendering once it's known.
      const changes = Array.isArray(item.changes) ? item.changes.filter(isRecord) : [];
      const files = changes.map((change) => firstString(change, ["path"])).filter((path): path is string => typeof path === "string" && path.length > 0);
      const callId = id ?? `codex-file-${files[0] ?? "change"}`;
      const summary = files.length === 0 ? "file change" : files.length === 1 ? files[0] : `${files.length} files changed`;
      const events: RunEvent[] = [{ type: "tool", id: callId, name: "Edit", summary }];
      if (completed) {
        const ok = String(item.status ?? "").toLowerCase() === "completed";
        const output = changes.map((change) => `${firstString(change, ["kind"]) ?? "update"} ${firstString(change, ["path"]) ?? ""}`.trim()).join("\n");
        events.push({ type: "tool_result", id: callId, ok, output });
        for (const change of changes) {
          const file = firstString(change, ["path"]);
          const diffText = firstString(change, ["diff"]);
          if (file && diffText) {
            const block = diffBlockFromLines(file, parseUnifiedDiffLines(diffText));
            events.push({ type: "diff", id: callId, file, additions: block.additions, deletions: block.deletions, lines: block.lines });
          }
        }
      }
      return events;
    }
    case "mcpToolCall": {
      const server = firstString(item, ["server"]);
      const tool = firstString(item, ["tool"]) ?? "mcp";
      const callId = id ?? `codex-mcp-${tool}`;
      const events: RunEvent[] = [{ type: "tool", id: callId, name: server ? `${server}/${tool}` : tool }];
      if (completed) {
        const ok = String(item.status ?? "").toLowerCase() === "completed";
        const result = item.result ?? item.error;
        events.push({ type: "tool_result", id: callId, ok, output: typeof result === "string" ? result : result == null ? "" : clip(JSON.stringify(result), 2000) });
      }
      return events;
    }
    case "webSearch": {
      const query = firstString(item, ["query"]) ?? "";
      return [{ type: "search", id, query, state: completed ? "ok" : "running" }];
    }
    default:
      return [];
  }
}

/** Sandbox/approval/model/effort + plan-aware prompt for a Codex thread. */
function buildCodexThreadParams(request: RunRequest): {
  readonly sandbox: "read-only" | "danger-full-access";
  readonly approvalPolicy: "never";
  readonly model?: string;
  readonly effort?: string;
  readonly prompt: string;
} {
  const profile = normalizeAgentProfile(request, "codex");
  const mode = modeForProfile(profile);
  const planMode = mode === "plan";
  const sandbox = request.accessMode === "unrestricted" && !planMode ? "danger-full-access" : "read-only";
  return {
    sandbox,
    approvalPolicy: "never",
    model: modelForProfile(profile),
    effort: reasoningForProfile(profile),
    prompt: codexPromptForMode(request.prompt, mode),
  };
}

async function runCodexAppServer(
  request: RunRequest,
  cwd: string,
  res: ServerResponse,
  send: (event: RunEvent) => void,
  sendDone: () => void,
  end: () => void,
  binding: BackgroundRunBinding | null,
  accumulator: BackgroundRunAccumulator | null,
): Promise<void> {
  const abortController = new AbortController();
  res.on("close", () => {
    if (!binding && !abortController.signal.aborted) {
      abortController.abort();
    }
  });
  if (binding) {
    backgroundRunHandles.set(binding.runId, {
      binding,
      startedAt: new Date().toISOString(),
      cancel: () => {
        if (!abortController.signal.aborted) {
          abortController.abort();
        }
      },
    });
  }
  const runTimeout = setTimeout(() => {
    if (!abortController.signal.aborted) {
      abortController.abort();
    }
  }, CODEX_RUN_TIMEOUT_MS);

  let child: ReturnType<typeof spawn> | null = null;
  const unrestricted = request.accessMode === "unrestricted";
  const streamedText = new Set<string>();
  const streamedReasoning = new Set<string>();
  let latestUsage: RunUsage | undefined;

  // Minimal newline-delimited JSON-RPC peer over the app-server's stdio.
  let idCounter = 0;
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  let settleTurn: (() => void) | null = null;
  const turnSettled = new Promise<void>((resolve) => {
    settleTurn = resolve;
  });

  const writeMessage = (message: Record<string, unknown>): void => {
    if (child?.stdin && !child.stdin.destroyed) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }
  };
  const sendRequest = (method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const id = ++idCounter;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      writeMessage({ jsonrpc: "2.0", id, method, params });
    });
  };

  const handleServerRequest = (id: unknown, method: string): void => {
    // We run with approvalPolicy "never", so these should not fire. Respond
    // defensively so a stray request never deadlocks the turn.
    let result: Record<string, unknown> = {};
    if (method.endsWith("requestApproval")) {
      result = { decision: unrestricted ? "acceptForSession" : "decline" };
    } else if (method === "item/tool/requestUserInput") {
      result = { answers: {} };
    }
    writeMessage({ jsonrpc: "2.0", id, result });
  };

  const handleNotification = (method: string, params: Record<string, unknown>): void => {
    switch (method) {
      case "item/agentMessage/delta": {
        const itemId = firstString(params, ["itemId"]);
        const delta = firstString(params, ["delta"]);
        if (itemId) {
          streamedText.add(itemId);
        }
        if (delta) {
          send({ type: "text", text: delta });
        }
        return;
      }
      case "item/reasoning/textDelta":
      case "item/reasoning/summaryTextDelta": {
        const itemId = firstString(params, ["itemId"]);
        const delta = firstString(params, ["delta"]);
        if (itemId) {
          streamedReasoning.add(itemId);
        }
        if (delta) {
          send({ type: "reasoning", text: delta });
        }
        return;
      }
      case "turn/plan/updated": {
        const plan = Array.isArray(params.plan) ? params.plan.filter(isRecord) : [];
        const steps = plan
          .map((step) => ({ label: firstString(step, ["step", "text", "label"]) ?? "", state: codexPlanStepState(step.status) }))
          .filter((step) => step.label.length > 0);
        if (steps.length > 0) {
          send({ type: "plan", steps });
        }
        return;
      }
      case "item/started": {
        const item = isRecord(params.item) ? params.item : null;
        if (!item || item.type === "agentMessage" || item.type === "reasoning") {
          return;
        }
        for (const event of codexAppServerItemEvents(item, false)) {
          send(event);
        }
        return;
      }
      case "item/completed": {
        const item = isRecord(params.item) ? params.item : null;
        if (!item) {
          return;
        }
        const itemId = firstString(item, ["id"]);
        if (item.type === "agentMessage" && itemId && streamedText.has(itemId)) {
          return;
        }
        if (item.type === "reasoning" && itemId && streamedReasoning.has(itemId)) {
          return;
        }
        for (const event of codexAppServerItemEvents(item, true)) {
          send(event);
        }
        return;
      }
      case "thread/tokenUsage/updated": {
        const usage = codexAppServerUsage(params.tokenUsage);
        if (usage) {
          latestUsage = usage;
        }
        return;
      }
      case "error": {
        const error = isRecord(params.error) ? params.error : params;
        const text = firstString(error, ["message"]) ?? errorText(params);
        send({ type: "error", text });
        if (params.willRetry !== true) {
          settleTurn?.();
        }
        return;
      }
      case "turn/completed": {
        const turn = isRecord(params.turn) ? params.turn : undefined;
        if (turn && String(turn.status ?? "").toLowerCase() === "failed") {
          const turnError = isRecord(turn.error) ? turn.error : undefined;
          send({ type: "error", text: turnError ? (firstString(turnError, ["message"]) ?? "Codex turn failed") : "Codex turn failed" });
        }
        send({ type: "done", usage: latestUsage });
        settleTurn?.();
        return;
      }
      default:
        return;
    }
  };

  try {
    const resolvedBin = resolveBinOnPath("codex", process.env.PATH ?? "");
    if (!resolvedBin) {
      throw new Error("codex is not installed (not found on PATH).");
    }
    child = spawnResolvedBin(resolvedBin, ["app-server"], {
      cwd,
      env: { ...process.env, ...readAgentSecretConfig().env, NODE_NO_WARNINGS: "1", NO_COLOR: "1", RUST_LOG: "error" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const childProc = child;
    childProc.on("exit", () => {
      for (const { reject } of pending.values()) {
        reject(new Error("codex app-server exited"));
      }
      pending.clear();
      settleTurn?.();
    });
    abortController.signal.addEventListener("abort", () => {
      if (childProc.exitCode === null) {
        childProc.kill("SIGTERM");
      }
      settleTurn?.();
    });

    let buffer = "";
    childProc.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) {
          continue;
        }
        let msg: unknown;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (!isRecord(msg)) {
          continue;
        }
        if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
          const id = typeof msg.id === "number" ? msg.id : Number(msg.id);
          const entry = pending.get(id);
          if (entry) {
            pending.delete(id);
            if (msg.error !== undefined) {
              entry.reject(new Error(errorText(isRecord(msg.error) ? msg.error.message ?? msg.error : msg.error)));
            } else {
              entry.resolve(isRecord(msg.result) ? msg.result : {});
            }
          }
        } else if (typeof msg.method === "string" && msg.id !== undefined) {
          handleServerRequest(msg.id, msg.method);
        } else if (typeof msg.method === "string") {
          handleNotification(msg.method, isRecord(msg.params) ? msg.params : {});
        }
      }
    });

    const initTimeout = setTimeout(() => {
      if (!abortController.signal.aborted) {
        abortController.abort();
      }
    }, CODEX_APP_SERVER_TIMEOUT_MS);
    try {
      await sendRequest("initialize", {
        clientInfo: { name: "rlab", title: null, version: "0.1.0" },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      writeMessage({ jsonrpc: "2.0", method: "initialized" });
    } finally {
      clearTimeout(initTimeout);
    }

    const params = buildCodexThreadParams(request);
    const threadParams: Record<string, unknown> = { cwd, sandbox: params.sandbox, approvalPolicy: params.approvalPolicy };
    if (params.model) {
      threadParams.model = params.model;
    }
    const startResponse = request.resume
      ? await sendRequest("thread/resume", { threadId: request.resume, ...threadParams })
      : await sendRequest("thread/start", threadParams);
    const thread = isRecord(startResponse.thread) ? startResponse.thread : undefined;
    const threadId = thread ? firstString(thread, ["id"]) : undefined;
    if (!threadId) {
      throw new Error("codex app-server did not return a thread id");
    }
    send({ type: "session", id: threadId });

    const turnParams: Record<string, unknown> = {
      threadId,
      input: [{ type: "text", text: params.prompt, text_elements: [] }],
      approvalPolicy: params.approvalPolicy,
    };
    if (params.effort) {
      turnParams.effort = params.effort;
    }
    await sendRequest("turn/start", turnParams);

    await turnSettled;
  } catch (error) {
    if (!abortController.signal.aborted) {
      send({ type: "error", text: error instanceof Error ? error.message : String(error) });
    }
  } finally {
    clearTimeout(runTimeout);
    if (child && child.exitCode === null) {
      try {
        child.kill("SIGTERM");
      } catch {
        // already gone
      }
    }
    if (binding && accumulator) {
      finishPersistedBackgroundRun(binding, accumulator, abortController.signal.aborted);
      notifyBackgroundRunUpdate(binding, true);
      backgroundRunHandles.delete(binding.runId);
    }
    sendDone();
    end();
  }
}

function handleRunCancel(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    try {
      const request = parseRunCancelPayload(body);
      const handle = backgroundRunHandles.get(request.runId);
      const currentState = readWorkspaceState();
      const canceled = cancelBackgroundRunRequestState(currentState, request.runId, Boolean(handle));
      if (!handle) {
        if (canceled.canceled) {
          writeWorkspaceState(canceled.state);
          sendJson(res, 200, { runId: request.runId, canceled: true, detached: true });
          return;
        }
        sendJson(res, 404, { error: `No active run for ${request.runId}.` });
        return;
      }
      handle.cancel();
      writeWorkspaceState(canceled.state);
      sendJson(res, 200, { runId: request.runId, canceled: true });
    } catch (error) {
      sendJson(res, runControlErrorStatus(error), { error: errorMessage(error) });
    }
  });
}

function handleActiveRuns(_req: IncomingMessage, res: ServerResponse): void {
  sendJson(res, 200, { runs: activeBackgroundRunSnapshots() });
}

function handleRunAttach(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "", "http://localhost");
  const runId = url.searchParams.get("runId")?.trim() ?? "";
  if (!runId) {
    sendJson(res, 400, { error: "runId is required." });
    return;
  }
  const handle = backgroundRunHandles.get(runId);
  if (!handle) {
    sendJson(res, 404, { error: `No active run for ${runId}.` });
    return;
  }
  const initial = activeBackgroundRunUpdateFromState(readWorkspaceState(), handle.binding, false);
  if (!initial) {
    sendJson(res, 409, { error: `Active run ${runId} has no persisted workspace state.` });
    return;
  }

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-store");
  const sendUpdate = (update: ActiveBackgroundRunUpdate) => {
    if (res.writableEnded) {
      return;
    }
    res.write(`${JSON.stringify({ type: "update", update })}\n`);
  };
  let unsubscribe: (() => void) | null = null;
  const cleanup = () => {
    unsubscribe?.();
    unsubscribe = null;
  };
  const subscriber: BackgroundRunSubscriber = (update) => {
    sendUpdate(update);
    if (update.done && !res.writableEnded) {
      cleanup();
      res.end();
    }
  };
  unsubscribe = subscribeBackgroundRun(runId, subscriber);
  if (!unsubscribe) {
    sendJson(res, 404, { error: `No active run for ${runId}.` });
    return;
  }
  res.on("close", cleanup);
  sendUpdate(initial);
}

function handleRun(req: IncomingMessage, res: ServerResponse): void {
  let bodyAccumulator: JsonBodyAccumulator = { body: "", bytes: 0 };
  let bodyReadError: Error | null = null;
  req.on("data", (chunk: Buffer | string) => {
    if (bodyReadError) {
      return;
    }
    try {
      bodyAccumulator = appendJsonBodyChunk(bodyAccumulator, chunk);
    } catch (error) {
      bodyReadError = error instanceof Error ? error : new Error(String(error));
    }
  });
  req.on("end", () => {
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-store");
    const sender = createRunEventSender(res);
    let accumulator: BackgroundRunAccumulator | null = null;
    let binding: BackgroundRunBinding | null = null;
    const send = (event: RunEvent) => {
      sender.send(event);
      if (binding && accumulator) {
        applyBackgroundRunEvent(binding, accumulator, event);
      }
    };
    const sendDone = sender.sendDone;

    if (bodyReadError) {
      res.statusCode = jsonBodyReadErrorStatus(bodyReadError);
      send({ type: "error", text: errorMessage(bodyReadError) });
      sendDone();
      sender.end();
      return;
    }
    const parsedPayload = parseRunRequestPayload(bodyAccumulator.body);

    if (!parsedPayload.ok) {
      send({ type: "error", text: parsedPayload.error });
      sendDone();
      sender.end();
      return;
    }
    const { agent, model, reasoning, mode, prompt, requestedCwd, accessMode, resume, accessModeValid, profileValid, profileError, bindingInvalid } = parsedPayload;
    binding = parsedPayload.binding;

    if (!prompt) {
      send({ type: "error", text: "Empty prompt" });
      sendDone();
      sender.end();
      return;
    }
    if (bindingInvalid) {
      send({ type: "error", text: "Invalid background run binding." });
      sendDone();
      sender.end();
      return;
    }

    // Gemini lets us set a session id for a NEW session; assign one so the client
    // can resume it later. Claude/Codex/OpenCode mint their own and report it back
    // via a "session" event from their stream translators.
    const assignedSessionId = !resume && agent === "gemini" ? randomUUID() : undefined;
    const request: RunRequest = { agent, model, reasoning, mode, prompt, accessMode, resume, sessionId: assignedSessionId };
    if (assignedSessionId) {
      send({ type: "session", id: assignedSessionId });
    }
    const origin = browserBridgeOrigin(req);
    const executionRequest: RunRequest = {
      ...request,
      prompt: appendBrowserBridgePrompt(request.prompt, binding, origin),
    };
    if (binding) {
      accumulator = startPersistedBackgroundRun(binding, request);
    }
    const finishAndEnd = () => {
      if (binding && accumulator) {
        finishPersistedBackgroundRun(binding, accumulator, false);
      }
      sendDone();
      sender.end();
    };

    if (!accessModeValid) {
      send({ type: "error", text: "Invalid accessMode. Expected read-only or unrestricted." });
      finishAndEnd();
      return;
    }
    if (!profileValid) {
      send({ type: "error", text: profileError });
      finishAndEnd();
      return;
    }

    const spec = RUN[agent];
    const resolvedBin = spec ? resolveBinOnPath(spec.bin) : null;
    if (!spec || !resolvedBin || !isAgentId(agent)) {
      send({ type: "start" });
      send({ type: "status", level: "warn", text: spec ? `${spec.bin} is not installed on this machine` : `Running ${agent || "this agent"} is not wired yet` });
      finishAndEnd();
      return;
    }
    const requestedProfileErrorMessage = requestedProfileError(agent, model, reasoning, mode);
    if (requestedProfileErrorMessage) {
      send({ type: "start" });
      send({ type: "error", text: requestedProfileErrorMessage });
      finishAndEnd();
      return;
    }
    const accessModeError = validateRunAccessModeForAgent(agent, accessMode);
    if (accessModeError) {
      send({ type: "start" });
      send({ type: "error", text: accessModeError });
      finishAndEnd();
      return;
    }
    const config = readAgentSecretConfig();
    const runEnv = {
      ...process.env,
      ...config.env,
      ...(binding
        ? {
            RLAB_BROWSER_BASE_URL: origin,
            RLAB_BROWSER_SESSION_ID: binding.conversationId,
          }
        : {}),
    };
    const detect = DETECT[agent];
    if (spec.env && detect && !hasConfiguredAgentAuth(detect, config, runEnv)) {
      send({ type: "start" });
      send({ type: "status", level: "warn", text: `${agent} needs setup: set one of ${spec.env.join(", ")}` });
      finishAndEnd();
      return;
    }

    // Use the requested working directory when it's a real directory (so the
    // agent reads/operates on real project files); otherwise a temp scratch dir.
    // Default permission mode is kept (read tools work; edits/bash are denied),
    // so pointing at a real repo stays safe.
    let cwd = join(tmpdir(), "rlab-agent-scratch");
    if (requestedCwd) {
      try {
        if (!existsSync(requestedCwd) || !statSync(requestedCwd).isDirectory()) {
          send({ type: "start" });
          send({ type: "error", text: `Project directory does not exist: ${requestedCwd}` });
          finishAndEnd();
          return;
        }
        cwd = requestedCwd;
      } catch (error) {
        send({ type: "start" });
        send({ type: "error", text: error instanceof Error ? error.message : String(error) });
        finishAndEnd();
        return;
      }
    }
    try {
      mkdirSync(cwd, { recursive: true });
    } catch {
      // ignore
    }

    send({ type: "start" });
    if (cwd !== join(tmpdir(), "rlab-agent-scratch")) {
      send({ type: "status", level: "info", text: `cwd · ${cwd}` });
    }
    send({ type: "status", level: "info", text: `access · ${accessMode}` });
    try {
      appendRunAuditEvent(RUN_AUDIT_FILE, {
        type: "run_started",
        agent,
        model,
        reasoning,
        mode,
        accessMode,
        cwd,
        runId: binding?.runId,
        conversationId: binding?.conversationId,
        prompt,
      });
    } catch (error) {
      send({ type: "error", text: `Failed to write run audit event: ${errorMessage(error)}` });
      finishAndEnd();
      return;
    }

    if (agent === "claude-code") {
      void runClaudeSdk(executionRequest, cwd, res, send, sendDone, sender.end, binding, accumulator);
      return;
    }

    if (agent === "opencode") {
      void runOpenCodeServer(executionRequest, cwd, res, send, sendDone, sender.end, binding, accumulator);
      return;
    }

    if (agent === "codex") {
      void runCodexAppServer(executionRequest, cwd, res, send, sendDone, sender.end, binding, accumulator);
      return;
    }

    if (agent === "amp" && accessMode === "read-only") {
      try {
        ensureAmpReadOnlySettingsFile();
      } catch (error) {
        send({ type: "error", text: error instanceof Error ? `Failed to prepare Amp read-only settings: ${error.message}` : "Failed to prepare Amp read-only settings" });
        finishAndEnd();
        return;
      }
    }

    // stdin = /dev/null so the CLI doesn't wait for piped input (it otherwise
    // stalls ~3s: "no stdin data received").
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnResolvedBin(resolvedBin, spec.args(executionRequest), { cwd, env: runEnv, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      send({ type: "error", text: error instanceof Error ? `Failed to launch ${spec.bin}: ${error.message}` : `Failed to launch ${spec.bin}` });
      finishAndEnd();
      return;
    }
    let canceled = false;
    if (binding) {
      backgroundRunHandles.set(binding.runId, {
        binding,
        startedAt: new Date().toISOString(),
        cancel: () => {
          canceled = true;
          if (child.exitCode === null) {
            child.kill("SIGTERM");
          }
        },
      });
    }
    let pendingDoneEvent: RunEvent | null = null;
    const sendFinalDone = () => {
      if (pendingDoneEvent) {
        send(pendingDoneEvent);
      } else {
        sendDone();
      }
    };
    const translate = spec.createTranslator();

    let buffer = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) {
          for (const event of translate(line)) {
            if (event.type === "done") {
              pendingDoneEvent = event;
            } else {
              send(event);
            }
          }
        }
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      send({ type: "error", text: `Failed to launch ${spec.bin}: ${err.message}` });
      if (binding && accumulator) {
        finishPersistedBackgroundRun(binding, accumulator, canceled);
        notifyBackgroundRunUpdate(binding, true);
        backgroundRunHandles.delete(binding.runId);
      }
      sendFinalDone();
      sender.end();
    });
    child.on("close", (code) => {
      if (code !== 0 && stderr) {
        send({ type: "error", text: clip(stderr, 400) });
      }
      if (binding && accumulator) {
        finishPersistedBackgroundRun(binding, accumulator, canceled);
        notifyBackgroundRunUpdate(binding, true);
        backgroundRunHandles.delete(binding.runId);
      }
      // Flush the buffered terminal `done` (it carries usage/cost) on normal exit;
      // a bare sendDone() here dropped token/cost stats for codex & gemini.
      sendFinalDone();
      sender.end();
    });

    // Abort the child if the client disconnects. Listen on the RESPONSE, not the
    // request — `req`'s "close" fires as soon as the POST body is consumed.
    res.on("close", () => {
      if (!binding && child.exitCode === null) {
        child.kill("SIGTERM");
      }
    });
  });
}

function attach(server: ViteDevServer | PreviewServer): void {
  server.middlewares.use("/api/health", (_req, res) => {
    const health = storageHealthSnapshot();
    sendJson(res, health.storage.ok ? 200 : 500, health);
  });
  server.middlewares.use("/api/browser/session", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleBrowserSession(req, res);
  });
  server.middlewares.use("/api/browser/sync", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleBrowserSync(req, res);
  });
  server.middlewares.use("/api/browser/dirty", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleBrowserDirty(req, res);
  });
  server.middlewares.use("/api/browser/action", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleBrowserAction(req, res);
  });
  server.middlewares.use("/api/browser/bridge/sync", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleBrowserBridgeSync(req, res);
  });
  server.middlewares.use("/api/browser/bridge/action", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleBrowserBridgeAction(req, res);
  });
  server.middlewares.use("/api/browser/bridge/snapshot", (req, res) => {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleBrowserBridgeSnapshot(req, res);
  });
  server.middlewares.use("/api/browser/snapshot", (req, res) => {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleBrowserSnapshot(req, res);
  });
  server.middlewares.use("/api/browser/events", (req, res) => {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleBrowserEvents(req, res);
  });
  server.middlewares.use("/api/workspace", handleWorkspace);
  server.middlewares.use("/api/agents", (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(detectAgents()));
  });
  server.middlewares.use("/api/agent-config", handleAgentConfig);
  server.middlewares.use("/api/agent-install", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleAgentInstall(req, res);
  });
  server.middlewares.use("/api/playwright-install", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handlePlaywrightInstall(req, res);
  });
  server.middlewares.use("/api/folder-picker", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleFolderPicker(req, res);
  });
  server.middlewares.use("/api/list-directories", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleListDirectories(req, res);
  });
  server.middlewares.use("/api/folder-info", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleFolderInfo(req, res);
  });
  server.middlewares.use("/api/project-files", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleProjectFiles(req, res);
  });
  server.middlewares.use("/api/attachments", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleAttachmentUpload(req, res);
  });
  server.middlewares.use("/api/local-file", (req, res) => {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleLocalFile(req, res);
  });
  server.middlewares.use("/api/version", (req, res) => {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleVersion(req, res);
  });
  server.middlewares.use("/api/agent-limits", (req, res) => {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleAgentLimits(req, res);
  });
  server.middlewares.use("/api/git-status", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleGitStatus(req, res);
  });
  server.middlewares.use("/api/git-diff", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleGitDiff(req, res);
  });
  server.middlewares.use("/api/git-stage", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleGitStage(req, res);
  });
  server.middlewares.use("/api/git-unstage", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleGitUnstage(req, res);
  });
  server.middlewares.use("/api/git-commit", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleGitCommit(req, res);
  });
  server.middlewares.use("/api/git-push", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleGitPush(req, res);
  });
  server.middlewares.use("/api/git-worktree-create", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleGitWorktreeCreate(req, res);
  });
  server.middlewares.use("/api/git-worktree-merge", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleGitWorktreeMerge(req, res);
  });
  server.middlewares.use("/api/git-init", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleGitInit(req, res);
  });
  server.middlewares.use("/api/terminal", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleTerminal(req, res);
  });
  server.middlewares.use("/api/runs", (req, res) => {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleActiveRuns(req, res);
  });
  server.middlewares.use("/api/run-attach", (req, res) => {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleRunAttach(req, res);
  });
  server.middlewares.use("/api/run", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleRun(req, res);
  });
  server.middlewares.use("/api/run-approval", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleRunApproval(req, res);
  });
  server.middlewares.use("/api/run-cancel", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleRunCancel(req, res);
  });
  server.middlewares.use("/api/run-input", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleRunInput(req, res);
  });
}

export function agentsApiPlugin(): Plugin {
  return {
    name: "rlab:agents-api",
    configureServer(server) {
      attach(server);
    },
    configurePreviewServer(server) {
      attach(server);
    },
  };
}
