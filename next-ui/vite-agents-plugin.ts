import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { request as httpRequest, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import type { ModelInfo as AnthropicModelInfo } from "@anthropic-ai/sdk/resources/models";
import { query, type CanUseTool, type EffortLevel, type Options as ClaudeQueryOptions, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { CronExpressionParser } from "cron-parser";
import * as pty from "node-pty";
import { chromium, type Browser, type BrowserContext, type ConsoleMessage, type Frame, type FrameLocator, type Locator, type Page, type Request as PlaywrightRequest } from "playwright";
import type { Plugin, ViteDevServer, PreviewServer } from "vite";
import { parseGitStatusPorcelain, parseNumstatTotals } from "./src/lib/git-status";
import { normalizeAgentToolOutput, truncateAgentToolOutput } from "./src/lib/agent-output";
import { conversationPreviewSnippet, previewSnippet } from "./src/lib/conversation-preview";
import { formatClock24, formatDateTime24 } from "./src/lib/time-format";
import {
  accumulateRunEvent,
  createRunEventAccumulator,
  runEventAccumulatorHasOutput,
  runEventBlocks,
  type RunEvent as SharedRunEvent,
  type RunEventAccumulator,
} from "./src/lib/run-event-accumulator";
import { attachPtyTerminalWebSockets, PtyTerminalManager } from "./src/server/pty-terminal";
import { attachExactApiRoutes, methodOnly, type ApiHandler, type ExactApiRoute } from "./src/server/api-router";
import {
  cloneAppSettings,
  defaultAppSettings,
  type Locale,
} from "./src/lib/app-settings";
import { getVoiceProvider, isVoiceProviderId, VOICE_PROVIDERS, type VoiceProviderId } from "./src/lib/voice-providers";
import { buildEmptyWorkspaceState, buildInitialWorkspaceState, cloneWorkspaceState, type WorkspaceState } from "./src/lib/workspace-state";
import { parseWorkspaceMutationRequestBody, workspaceMutationBadRequestMessages } from "./src/lib/workspace-mutations";
import {
  applyWorkspaceDbMutations,
  initWorkspaceDb,
  initializeWorkspaceStateInDb,
  readConversation,
  readMessage,
  readMessageBlocks,
  readSelectedConversationId,
  readThreadFromDb,
  readWorkspaceRevision,
  readWorkspaceStateFromDb,
  updateConversationData,
  upsertAgentMessageForUserTurn,
  upsertMessage,
  workspaceDbHasState,
  WorkspaceRevisionConflictError,
  type WorkspaceDbMutation,
} from "./workspace-db";
import {
  AGENTS,
  agentProfileEquals,
  claudeAgentNameFromMode,
  DEFAULT_AGENT_OPTION_ID,
  getAgent,
  isDirectAgentModeValue,
  isDirectAgentModelValue,
  isAgentId,
  isAgentAccessMode,
  normalizeAgentProfile,
  resolveAgentModeValue,
  resolveAgentModelValue,
  resolveAgentReasoningValue,
  type AgentId,
  type AgentAccessMode,
  type AgentOption,
  type AgentProfile,
  type VisibleAgentId,
} from "./src/lib/agent-catalog";
import {
  type AgentBlock,
  type ChatMessage,
  type ComposerDraft,
  type ConversationSummary,
  type ConversationStatus,
  type DiffBlock,
  type PlanBlock,
  type Project,
  type RunState,
  type RunUsage,
  type SearchBlock,
} from "./src/domain/agent-types";
import { pickDirectoryPathFromSystemDialog } from "./src/server/directory-picker";
export {
  parseAnthropicModelInfos,
  parseClaudeAgentsOutput,
  parseClaudeCliModelAliasesSource,
  parseCodexModelsOutput,
  parseGeminiCliModelConfigSource,
  parseOpenCodeAgentsOutput,
  parseOpenCodeModelsOutput,
  uniqueAgentOptions,
} from "./src/server/agent-model-discovery";
import {
  parseAnthropicModelInfos,
  parseClaudeAgentsOutput,
  parseClaudeCliModelAliasesSource,
  parseCodexModelsOutput,
  parseGeminiCliModelConfigSource,
  parseOpenCodeAgentsOutput,
  parseOpenCodeModelsOutput,
  uniqueAgentOptions,
} from "./src/server/agent-model-discovery";

export { parseGitStatusPorcelain } from "./src/lib/git-status";

// `node:sqlite` is a built-in runtime dependency used by workspace-db too.
// Keep it behind process.getBuiltinModule so Vite/Vitest do not try to bundle it.
const { DatabaseSync: NodeSqliteDatabaseSync } = process.getBuiltinModule("node:sqlite");

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
const WORKSPACE_DB_FILE = join(WORKSPACE_STATE_DIR, "workspace.db");
const RUN_AUDIT_FILE = join(WORKSPACE_STATE_DIR, "run-audit.ndjson");
const SCHEDULED_WAKEUPS_FILE = join(WORKSPACE_STATE_DIR, "scheduled-wakeups.json");
const ATTACHMENTS_DIR = join(WORKSPACE_STATE_DIR, "attachments");
const AMP_READ_ONLY_SETTINGS_FILE = join(WORKSPACE_STATE_DIR, "amp-read-only-settings.json");
// Account rate-limit snapshots survive restarts here so the composer keeps
// showing the last-known 5h/weekly windows instead of going blank on reboot.
const AGENT_LIMITS_FILE = join(WORKSPACE_STATE_DIR, "agent-limits.json");
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_JSON_BODY_BYTES = 40 * 1024 * 1024;
export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
export const BROWSER_ACTION_TIMEOUT_MS = 5000;
const BROWSER_EVAL_SCRIPT_MAX_CHARS = 8000;
const AGENT_CONFIG_FILE = join(WORKSPACE_STATE_DIR, "agent-config.json");
const BACKGROUND_RUN_PERSIST_INTERVAL_MS = 1000;
const STREAM_HEARTBEAT_INTERVAL_MS = 10_000;
const DEFAULT_BROWSER_BRIDGE_ORIGIN = "http://127.0.0.1:4280";
const terminalManager = new PtyTerminalManager();
const terminalWebSocketServers = new WeakSet<object>();

interface Detect {
  readonly bins: readonly string[];
  /** Runtime is provided by an installed SDK dependency, not a PATH binary. */
  readonly sdkRuntime?: boolean;
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
  readonly modelDiscoveryError?: string;
}

const AGENT_RUNTIME_DETECTION: Record<VisibleAgentId, Omit<Detect, "bins">> = {
  "claude-code": { sdkRuntime: true, env: ["ANTHROPIC_API_KEY"], hasAuth: hasClaudeStoredAuth },
  codex: { env: ["OPENAI_API_KEY", "CODEX_API_KEY"], hasAuth: hasCodexStoredAuth },
  gemini: { env: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_API_KEY"], hasAuth: hasGeminiStoredAuth },
  opencode: {},
};

const DETECT = {} as Record<VisibleAgentId, Detect>;
for (const agent of AGENTS) {
  DETECT[agent.id] = { bins: agent.cliBins, ...AGENT_RUNTIME_DETECTION[agent.id] };
}

const RUNNABLE_AGENT_IDS: ReadonlySet<string> = new Set(AGENTS.filter((agent) => agent.runAdapter).map((agent) => agent.id));

const INSTALL_COMMANDS: Partial<Record<VisibleAgentId, readonly string[]>> = {
  "claude-code": ["npm", "install", "@anthropic-ai/claude-agent-sdk@latest", "@anthropic-ai/sdk@latest"],
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
  return isAgentId(agent) ? (INSTALL_COMMANDS[agent] ?? null) : null;
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

function firstConfiguredEnvValue(envNames: readonly string[], config: AgentSecretConfig, env: NodeJS.ProcessEnv): string | undefined {
  for (const envName of envNames) {
    const value = configuredEnvValueFrom(envName, config, env);
    if (value && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function claudeHome(): string {
  return process.env.CLAUDE_HOME ?? join(homedir(), ".claude");
}

function hasClaudeStoredAuth(): boolean {
  const credentialsFile = join(claudeHome(), ".credentials.json");
  if (!existsSync(credentialsFile)) {
    return false;
  }
  try {
    const parsed = JSON.parse(readFileSync(credentialsFile, "utf8").replace(/^\uFEFF/, "")) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.claudeAiOauth)) {
      return false;
    }
    const oauth = parsed.claudeAiOauth;
    return (
      typeof oauth.accessToken === "string" &&
      oauth.accessToken.trim().length > 0 &&
      typeof oauth.refreshToken === "string" &&
      oauth.refreshToken.trim().length > 0
    );
  } catch {
    return false;
  }
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

function agentProcessSpawnOptions(options: NonNullable<Parameters<typeof spawn>[2]>): NonNullable<Parameters<typeof spawn>[2]> {
  return process.platform === "win32" ? options : { ...options, detached: true };
}

function terminateAgentProcessTree(child: ReturnType<typeof spawn>, signal: NodeJS.Signals = "SIGTERM"): void {
  if (child.exitCode !== null || child.pid === undefined) {
    return;
  }
  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
    if (child.exitCode === null) {
      try {
        child.kill(signal);
      } catch {
        // already gone
      }
    }
  }
}

const MODEL_DISCOVERY_TIMEOUT_MS = 5_000;
const ANTHROPIC_MODEL_API_KEY_ENV = ["ANTHROPIC_API_KEY"] as const;
const OPENCODE_DISCOVERY_TIMEOUT_MS = 15_000;
const AGENT_DETECTION_CACHE_TTL_MS = 5 * 60_000;
const CLI_UPDATE_CHECK_INTERVAL_MS = 60 * 60_000;
const CLI_UPDATE_CHECK_TIMEOUT_MS = 20_000;
const DISCOVERY_OUTPUT_LIMIT_CHARS = 1_000_000;
const STDERR_TAIL_LIMIT_CHARS = 4_000;

function geminiCliPackageRootFromBin(resolvedBin: string): string | null {
  const directRoot = join(dirname(resolvedBin), "node_modules", "@google", "gemini-cli");
  if (existsSync(join(directRoot, "package.json"))) {
    return directRoot;
  }
  let realBin: string;
  try {
    realBin = realpathSync(resolvedBin);
  } catch {
    realBin = resolvedBin;
  }
  const parts = realBin.split(/[\\/]/);
  for (let i = 0; i < parts.length - 2; i += 1) {
    if (parts[i] === "node_modules" && parts[i + 1] === "@google" && parts[i + 2] === "gemini-cli") {
      const root = parts.slice(0, i + 3).join(process.platform === "win32" ? "\\" : "/");
      return root.length > 0 ? root : null;
    }
  }
  return null;
}

async function parseGeminiCliInstalledModelOptionsAsync(resolvedBin: string): Promise<TextDiscoveryResult & { readonly models: readonly AgentOption[] }> {
  const root = geminiCliPackageRootFromBin(resolvedBin);
  if (!root) {
    return { output: null, error: `${basename(resolvedBin)} package root was not found`, models: [] };
  }
  const bundleDir = join(root, "bundle");
  if (!existsSync(bundleDir)) {
    return { output: null, error: `${basename(resolvedBin)} bundle directory was not found`, models: [] };
  }
  let entries: string[];
  try {
    entries = (await readdir(bundleDir)).filter((name) => name.endsWith(".js")).sort();
  } catch (error) {
    return { output: null, error: `${basename(resolvedBin)} bundle directory could not be read: ${errorMessage(error)}`, models: [] };
  }
  const sources = await Promise.all(
    entries.map(async (entry) => {
      const file = join(bundleDir, entry);
      try {
        const source = await readFile(file, "utf8");
        return source.includes("modelDefinitions") && source.includes("isVisible") ? source : null;
      } catch {
        return null;
      }
    }),
  );
  const models = uniqueAgentOptions(sources.flatMap((source) => (source ? parseGeminiCliModelConfigSource(source) : [])));
  return models.length > 0
    ? { output: null, error: null, models }
    : { output: null, error: `${basename(resolvedBin)} installed model config did not expose visible models`, models: [] };
}

async function parseClaudeCliInstalledModelAliasesAsync(resolvedBin: string): Promise<TextDiscoveryResult & { readonly models: readonly AgentOption[] }> {
  let source: string;
  try {
    source = await readFile(resolvedBin, "latin1");
  } catch (error) {
    return { output: null, error: `${basename(resolvedBin)} model aliases could not be read: ${errorMessage(error)}`, models: [] };
  }
  const models = parseClaudeCliModelAliasesSource(source);
  return models.length > 0 ? { output: null, error: null, models } : { output: null, error: `${basename(resolvedBin)} installed model aliases were not found`, models: [] };
}

interface TextDiscoveryResult {
  readonly output: string | null;
  readonly error: string | null;
}

function appendLimitedText(current: string, chunk: string, maxChars: number): string {
  const next = `${current}${chunk}`;
  return next.length > maxChars ? next.slice(next.length - maxChars) : next;
}

function runResolvedBinTextAsync(
  resolvedBin: string,
  args: readonly string[],
  options: Pick<NonNullable<Parameters<typeof spawn>[2]>, "cwd" | "env"> = {},
  timeoutMs = MODEL_DISCOVERY_TIMEOUT_MS,
): Promise<TextDiscoveryResult> {
  const launch = resolveLaunchCommand(resolvedBin, args);
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let child: ReturnType<typeof spawn> | null = null;
    const finish = (result: TextDiscoveryResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child) {
          terminateAgentProcessTree(child);
        }
      } catch {
        // process may not have launched yet
      }
    }, timeoutMs);

    try {
      child = spawn(launch.command, launch.args, agentProcessSpawnOptions({ ...options, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }));
    } catch (error) {
      finish({ output: null, error: `${basename(resolvedBin)} ${args.join(" ")} failed: ${errorMessage(error)}` });
      return;
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendLimitedText(stdout, chunk.toString("utf8"), DISCOVERY_OUTPUT_LIMIT_CHARS);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendLimitedText(stderr, chunk.toString("utf8"), STDERR_TAIL_LIMIT_CHARS);
    });
    child.on("error", (error) => {
      finish({ output: null, error: `${basename(resolvedBin)} ${args.join(" ")} failed: ${error.message}` });
    });
    child.on("close", (code, signal) => {
      if (timedOut) {
        finish({ output: null, error: `${basename(resolvedBin)} ${args.join(" ")} timed out after ${timeoutMs}ms` });
        return;
      }
      if (code !== 0) {
        const detail = stderr.trim().split(/\r?\n/)[0] || (signal ? `terminated by ${signal}` : `exited with status ${code ?? "unknown"}`);
        finish({ output: null, error: `${basename(resolvedBin)} ${args.join(" ")} failed: ${detail}` });
        return;
      }
      const output = stdout.trim();
      finish({ output: output.length > 0 ? output : null, error: null });
    });
  });
}

async function discoverAnthropicModelOptionsAsync(
  config: AgentSecretConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Pick<AgentCliInfo, "models" | "modelDiscoveryError">> {
  const apiKey = firstConfiguredEnvValue(ANTHROPIC_MODEL_API_KEY_ENV, config, env);
  if (!apiKey) {
    return {};
  }
  try {
    const client = new Anthropic({ apiKey, maxRetries: 0, timeout: MODEL_DISCOVERY_TIMEOUT_MS });
    const models: AnthropicModelInfo[] = [];
    for await (const model of client.models.list({ limit: 100 })) {
      models.push(model);
    }
    const parsed = parseAnthropicModelInfos(models);
    return parsed.length > 0 ? { models: parsed } : {};
  } catch (error) {
    return { modelDiscoveryError: `Claude model discovery failed: ${errorMessage(error)}` };
  }
}

async function discoveredAgentOptionsAsync(
  id: string,
  resolvedBin: string | null,
  config: AgentSecretConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Pick<AgentCliInfo, "models" | "reasoning" | "modes" | "modelDiscoveryError">> {
  if (id === "claude-code") {
    return discoverAnthropicModelOptionsAsync(config, env);
  }
  if (!resolvedBin) {
    return {};
  }
  if (id === "opencode") {
    const modelOutput = await runResolvedBinTextAsync(resolvedBin, ["models"], {}, OPENCODE_DISCOVERY_TIMEOUT_MS);
    const agentOutput = await runResolvedBinTextAsync(resolvedBin, ["agent", "list"], {}, OPENCODE_DISCOVERY_TIMEOUT_MS);
    const models = modelOutput.output ? parseOpenCodeModelsOutput(modelOutput.output) : [];
    const modes = agentOutput.output ? parseOpenCodeAgentsOutput(agentOutput.output) : [];
    const modelDiscoveryError = [modelOutput.error, agentOutput.error].filter((error): error is string => error !== null).join("; ");
    return {
      ...(models.length > 0 ? { models } : {}),
      ...(modes.length > 0 ? { modes } : {}),
      ...(modelDiscoveryError.length > 0 ? { modelDiscoveryError } : {}),
    };
  }
  if (id === "codex") {
    const output = await runResolvedBinTextAsync(resolvedBin, ["debug", "models"]);
    const parsed = output.output ? parseCodexModelsOutput(output.output) : { models: [], reasoning: [] };
    return {
      ...(parsed.models.length > 0 ? { models: parsed.models } : {}),
      ...(parsed.reasoning.length > 0 ? { reasoning: parsed.reasoning } : {}),
      ...(output.error ? { modelDiscoveryError: output.error } : {}),
    };
  }
  if (id === "gemini") {
    const parsed = await parseGeminiCliInstalledModelOptionsAsync(resolvedBin);
    return {
      ...(parsed.models.length > 0 ? { models: parsed.models } : {}),
      ...(parsed.error ? { modelDiscoveryError: parsed.error } : {}),
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
  const found = resolvedBin !== null || detect.sdkRuntime === true;
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

let agentDetectionCache: { readonly expiresAt: number; readonly value: Record<string, AgentCliInfo> } | null = null;
let agentDetectionInflight: Promise<Record<string, AgentCliInfo>> | null = null;

function clearAgentDetectionCache(): void {
  agentDetectionCache = null;
  agentDetectionInflight = null;
}

function prewarmAgentDetectionCache(): void {
  void detectAgentsWithLiveModels().catch((error) => {
    console.warn(`[rlab] Agent detection prewarm failed: ${errorMessage(error)}`);
  });
}

async function detectAgentsWithLiveModels(): Promise<Record<string, AgentCliInfo>> {
  const now = Date.now();
  if (agentDetectionCache && agentDetectionCache.expiresAt > now) {
    return agentDetectionCache.value;
  }
  if (agentDetectionInflight) {
    return agentDetectionInflight;
  }
  agentDetectionInflight = detectAgentsWithLiveModelsUncached()
    .then((value) => {
      agentDetectionCache = { value, expiresAt: Date.now() + AGENT_DETECTION_CACHE_TTL_MS };
      return value;
    })
    .finally(() => {
      agentDetectionInflight = null;
    });
  return agentDetectionInflight;
}

async function detectAgentsWithLiveModelsUncached(): Promise<Record<string, AgentCliInfo>> {
  const result: Record<string, AgentCliInfo> = {};
  const config = readAgentSecretConfig();
  await Promise.all(
    Object.entries(DETECT).map(async ([id, cfg]) => {
      const cliInfo = agentCliInfoForDetection(id, cfg, config);
      const discovered = cliInfo.status === "available" ? await discoveredAgentOptionsAsync(id, cliInfo.resolvedBin, config) : {};
      result[id] = { ...cliInfo, ...discovered };
    }),
  );
  return result;
}

export interface CliUpdateInfo {
  readonly agent: string;
  readonly agentName: string;
  readonly packageName: string;
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly command: string;
}

interface CliUpdateSnapshot {
  readonly checkedAt: number;
  readonly checking: boolean;
  readonly updates: readonly CliUpdateInfo[];
  readonly errors: Record<string, string>;
}

let cliUpdateSnapshot: CliUpdateSnapshot = { checkedAt: 0, checking: false, updates: [], errors: {} };
let cliUpdateInflight: Promise<CliUpdateSnapshot> | null = null;
let cliUpdateTimer: ReturnType<typeof setInterval> | null = null;

export function npmPackageNameFromInstallSpec(spec: string): string | null {
  const trimmed = spec.trim();
  if (!trimmed || trimmed.startsWith("-")) {
    return null;
  }
  if (trimmed.startsWith("@")) {
    const secondAt = trimmed.indexOf("@", 1);
    return secondAt > 0 ? trimmed.slice(0, secondAt) : trimmed;
  }
  const at = trimmed.indexOf("@");
  return at > 0 ? trimmed.slice(0, at) : trimmed;
}

function npmPackageNameForAgent(agent: string): string | null {
  const command = installCommandForAgent(agent);
  if (!command || command[0] !== "npm") {
    return null;
  }
  for (let i = command.length - 1; i >= 1; i -= 1) {
    const name = npmPackageNameFromInstallSpec(command[i]);
    if (name) {
      return name;
    }
  }
  return null;
}

function compareSemverish(a: string, b: string): number {
  const parse = (value: string) =>
    value
      .replace(/^[^\d]*/, "")
      .split(/[.+-]/)
      .map((part) => Number.parseInt(part, 10))
      .filter((part) => Number.isFinite(part));
  const left = parse(a);
  const right = parse(b);
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function npmBin(): string | null {
  return resolveBinOnPath("npm");
}

function parseNpmListVersion(output: string, packageName: string): string | null {
  try {
    const parsed = JSON.parse(output) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.dependencies)) {
      return null;
    }
    const dependency = parsed.dependencies[packageName];
    if (!isRecord(dependency) || typeof dependency.version !== "string") {
      return null;
    }
    return dependency.version;
  } catch {
    return null;
  }
}

async function npmText(args: readonly string[]): Promise<TextDiscoveryResult> {
  const bin = npmBin();
  if (!bin) {
    return { output: null, error: "npm executable was not found on PATH." };
  }
  return runResolvedBinTextAsync(bin, args, { cwd: process.cwd(), env: process.env }, CLI_UPDATE_CHECK_TIMEOUT_MS);
}

async function checkCliUpdateForAgent(agent: string): Promise<{ readonly update?: CliUpdateInfo; readonly error?: string }> {
  const packageName = npmPackageNameForAgent(agent);
  if (!packageName) {
    return {};
  }
  const command = installCommandForAgent(agent);
  const agentName = isAgentId(agent) ? getAgent(agent).name : agent;
  if (!command) {
    return {};
  }
  const [installed, latest] = await Promise.all([
    npmText(["list", "-g", packageName, "--json", "--depth=0"]),
    npmText(["view", packageName, "version", "--json"]),
  ]);
  if (!installed.output) {
    return { error: installed.error ?? `${packageName} installed version was not reported by npm.` };
  }
  if (!latest.output) {
    return { error: latest.error ?? `${packageName} latest version was not reported by npm.` };
  }
  const currentVersion = parseNpmListVersion(installed.output, packageName);
  const latestVersion = latest.output.trim().replace(/^"|"$/g, "");
  if (!currentVersion || !latestVersion) {
    return { error: `${packageName} version metadata is invalid.` };
  }
  return compareSemverish(currentVersion, latestVersion) < 0
    ? { update: { agent, agentName, packageName, currentVersion, latestVersion, command: command.join(" ") } }
    : {};
}

async function checkCliUpdatesNow(): Promise<CliUpdateSnapshot> {
  if (cliUpdateInflight) {
    return cliUpdateInflight;
  }
  cliUpdateSnapshot = { ...cliUpdateSnapshot, checking: true };
  cliUpdateInflight = (async () => {
    const updates: CliUpdateInfo[] = [];
    const errors: Record<string, string> = {};
    await Promise.all(
      Object.keys(INSTALL_COMMANDS).map(async (agent) => {
        const result = await checkCliUpdateForAgent(agent);
        if (result.update) {
          updates.push(result.update);
        }
        if (result.error) {
          errors[agent] = result.error;
        }
      }),
    );
    updates.sort((a, b) => a.agentName.localeCompare(b.agentName));
    cliUpdateSnapshot = { checkedAt: Date.now(), checking: false, updates, errors };
    return cliUpdateSnapshot;
  })().finally(() => {
    cliUpdateInflight = null;
  });
  return cliUpdateInflight;
}

function clearCliUpdateSnapshotForAgent(agent: string): void {
  cliUpdateSnapshot = {
    ...cliUpdateSnapshot,
    checkedAt: Date.now(),
    checking: false,
    updates: cliUpdateSnapshot.updates.filter((update) => update.agent !== agent),
    errors: Object.fromEntries(Object.entries(cliUpdateSnapshot.errors).filter(([key]) => key !== agent && key !== "update")),
  };
}

async function recheckCliUpdatesAfterInstall(agent: string): Promise<void> {
  try {
    const snapshot = await checkCliUpdatesNow();
    if (snapshot.updates.some((update) => update.agent === agent)) {
      clearCliUpdateSnapshotForAgent(agent);
    }
  } catch (error) {
    cliUpdateSnapshot = { ...cliUpdateSnapshot, checkedAt: Date.now(), checking: false, errors: { ...cliUpdateSnapshot.errors, update: errorMessage(error) } };
  }
}

function startCliUpdateMonitor(): void {
  void checkCliUpdatesNow().catch((error) => {
    cliUpdateSnapshot = { ...cliUpdateSnapshot, checkedAt: Date.now(), checking: false, errors: { ...cliUpdateSnapshot.errors, monitor: errorMessage(error) } };
  });
  if (cliUpdateTimer) {
    return;
  }
  cliUpdateTimer = setInterval(() => {
    void checkCliUpdatesNow().catch((error) => {
      cliUpdateSnapshot = { ...cliUpdateSnapshot, checkedAt: Date.now(), checking: false, errors: { ...cliUpdateSnapshot.errors, monitor: errorMessage(error) } };
    });
  }, CLI_UPDATE_CHECK_INTERVAL_MS);
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

function reconcileConversationRun(conversation: WorkspaceConversation, activeRunIds: ReadonlySet<string>, snippet: string): WorkspaceConversation {
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
    ...(snippet ? { snippet } : {}),
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

function lastTimelineNonTextBlockIndex(blocks: readonly AgentBlock[]): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.kind === "reasoning" || block.kind === "tool" || block.kind === "command" || block.kind === "search" || block.kind === "code") {
      return index;
    }
  }
  return -1;
}

function settleStoppedRunBlocks(blocks: readonly AgentBlock[]): AgentBlock[] {
  const lastNonTextIndex = lastTimelineNonTextBlockIndex(blocks);
  return blocks.map((block, index) => {
    const settled = settleLiveBlock(block);
    return settled.kind === "text" && index > lastNonTextIndex ? { ...settled, result: true } : settled;
  });
}

function settleLiveThreadWithStatus(messages: readonly ChatMessage[], statusBlock: Extract<AgentBlock, { kind: "status" }>): ChatMessage[] {
  const lastAgentIndex = messages.findLastIndex((message) => message.role === "agent");
  if (lastAgentIndex < 0) {
    return [...messages];
  }
  const message = messages[lastAgentIndex];
  const blocks = message.blocks ?? [];
  const hasStatus = blocks.some((block) => block.kind === "status" && block.level === statusBlock.level && block.text === statusBlock.text);
  const settledBlocks = settleStoppedRunBlocks(blocks);
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
    const snippet = conversationPreviewSnippet(state.threads[conversation.id] ?? [], 60);
    const reconciled = reconcileConversationRun(conversation, activeRunIds, snippet);
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
    if (Object.prototype.hasOwnProperty.call(state.threads, conversationId)) {
      threads[conversationId] = settleInterruptedThread(threads[conversationId] ?? [], locale);
    }
  }
  return { ...state, chats, projects, threads };
}

export function cancelBackgroundRunState(state: WorkspaceState, runId: string): WorkspaceState {
  const locale = state.settings.general.locale;
  const canceledText = serverRunSnippet(locale, "runCanceledSnippet");
  const canceledConversationIds = new Set<string>();
  const cancelConversation = (conversation: WorkspaceConversation): WorkspaceConversation => {
    if (conversation.activeRunId !== runId || (conversation.status !== "running" && conversation.status !== "waiting")) {
      return conversation;
    }
    canceledConversationIds.add(conversation.id);
    const snippet = conversationPreviewSnippet(state.threads[conversation.id] ?? [], 60);
    return {
      ...conversation,
      activeRunId: undefined,
      status: "idle",
      ...(snippet ? { snippet } : {}),
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

  const statusBlock: Extract<AgentBlock, { kind: "status" }> = { kind: "status", level: "warn", text: canceledText };
  const threads = { ...state.threads };
  for (const conversationId of canceledConversationIds) {
    if (Object.prototype.hasOwnProperty.call(state.threads, conversationId)) {
      threads[conversationId] = settleLiveThreadWithStatus(state.threads[conversationId] ?? [], statusBlock);
    }
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

let workspaceDbReady = false;

/** Open the workspace DB once. Runtime workspace state is SQLite-only. */
function ensureWorkspaceDb(): void {
  if (workspaceDbReady) {
    return;
  }
  initWorkspaceDb(WORKSPACE_DB_FILE);
  workspaceDbReady = true;
}

function readWorkspaceState(): WorkspaceState {
  ensureWorkspaceDb();
  if (!workspaceDbHasState()) {
    const initial = normalizeSeedProjectPaths(isDemoWorkspaceEnabled() ? buildInitialWorkspaceState() : buildEmptyWorkspaceState());
    initializeWorkspaceState(initial);
    return initial;
  }
  const raw = readWorkspaceStateFromDb();
  cachedWorkspaceLocale = raw.settings?.general?.locale ?? cachedWorkspaceLocale;
  const normalized = normalizeSeedProjectPaths(migrateSeedWorkspaceState(cloneWorkspaceState(raw)));
  const reconciled = reconcileStaleBackgroundRuns(normalized, new Set(backgroundRunHandles.keys()));
  if (reconciled !== normalized) {
    persistWorkspaceDelta(normalized, reconciled);
  }
  return reconciled;
}

/** The lightweight state the client `GET /api/workspace` returns: the full shell
 *  (conversation summaries, projects, drafts, settings) but only the SELECTED
 *  conversation's message thread. Other threads load lazily via GET /api/thread,
 *  so a giant history is no longer a giant initial payload. */
function readWorkspaceShellForClient(): WorkspaceState {
  ensureWorkspaceDb();
  if (!workspaceDbHasState()) {
    const initial = normalizeSeedProjectPaths(isDemoWorkspaceEnabled() ? buildInitialWorkspaceState() : buildEmptyWorkspaceState());
    initializeWorkspaceState(initial);
    return initial;
  }
  const selectedId = readSelectedConversationId();
  const includeThreadIds = selectedId ? new Set([selectedId]) : new Set<string>();
  const activeRunIds = new Set(backgroundRunHandles.keys());
  const shell = readWorkspaceStateFromDb(includeThreadIds);
  cachedWorkspaceLocale = shell.settings?.general?.locale ?? cachedWorkspaceLocale;
  const normalizedShell = normalizeSeedProjectPaths(shell);
  if (stateHasStaleBackgroundRun(normalizedShell, activeRunIds)) {
    readWorkspaceState();
    return normalizeSeedProjectPaths(readWorkspaceStateFromDb(includeThreadIds));
  }
  return reconcileStaleBackgroundRuns(normalizedShell, activeRunIds);
}

/** A single conversation's full message thread, for lazy loading on open. */
function readClientThread(conversationId: string): { readonly messages: ChatMessage[] } {
  ensureWorkspaceDb();
  return { messages: readThreadFromDb(conversationId) };
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

export function writeJsonFileAtomic(file: string, value: unknown, mode?: number, backup = true): number {
  mkdirSync(dirname(file), { recursive: true });
  const tempFile = atomicJsonTempFile(file);
  // The `.bak` copy is a full multi-MB sync read+write on a large workspace blob;
  // callers on the hot path (background-run snapshots) skip it — the temp+rename
  // below is already atomic, so the live file is never torn.
  if (backup && existsSync(file)) {
    copyFileSync(file, `${file}.bak`);
  }
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  try {
    writeFileSync(tempFile, serialized, mode === undefined ? "utf8" : { encoding: "utf8", mode });
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
  return serialized.length;
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

/** Wall-clock of the last background-run snapshot write, to coalesce persistence
 *  across concurrently streaming runs. */
let lastBackgroundPersistAt = 0;
/** Locale of the persisted settings, cached so the background hot path can build
 *  status snippets without loading the whole workspace. */
let cachedWorkspaceLocale: Locale = "en";

function initializeWorkspaceState(state: WorkspaceState): void {
  ensureWorkspaceDb();
  cachedWorkspaceLocale = state.settings?.general?.locale ?? cachedWorkspaceLocale;
  initializeWorkspaceStateInDb(state);
}

function workspaceProjectMeta(project: WorkspaceState["projects"][number]): Omit<WorkspaceState["projects"][number], "conversations"> {
  const { conversations: _conversations, ...meta } = project;
  return meta;
}

function stateHasStaleBackgroundRun(state: WorkspaceState, activeRunIds: ReadonlySet<string>): boolean {
  return [...state.chats, ...state.projects.flatMap((project) => project.conversations)].some((conversation) => {
    const activeRunId = conversation.activeRunId;
    return activeRunId !== undefined && !activeRunIds.has(activeRunId) && (conversation.status === "running" || conversation.status === "waiting");
  });
}

function persistWorkspaceDelta(before: WorkspaceState, after: WorkspaceState): void {
  const operations: WorkspaceDbMutation[] = [];
  const beforeConversations = workspaceConversationMap(before);
  const afterConversations = workspaceConversationMap(after);
  for (const conversation of beforeConversations.values()) {
    if (!afterConversations.has(conversation.id)) {
      operations.push({ type: "deleteConversation", conversationId: conversation.id });
    }
  }
  for (const project of after.projects) {
    const beforeProject = before.projects.find((item) => item.id === project.id);
    if (!beforeProject || JSON.stringify(workspaceProjectMeta(beforeProject)) !== JSON.stringify(workspaceProjectMeta(project))) {
      operations.push({ type: "upsertProject", project: workspaceProjectMeta(project) });
    }
    for (const conversation of project.conversations) {
      const beforeConversation = beforeConversations.get(conversation.id);
      if (!beforeConversation || JSON.stringify(beforeConversation) !== JSON.stringify(conversation)) {
        operations.push({ type: beforeConversation ? "updateConversation" : "upsertConversation", conversation, projectId: project.id });
      }
    }
  }
  for (const conversation of after.chats) {
    const beforeConversation = beforeConversations.get(conversation.id);
    if (!beforeConversation || JSON.stringify(beforeConversation) !== JSON.stringify(conversation)) {
      operations.push({ type: beforeConversation ? "updateConversation" : "upsertConversation", conversation, projectId: null });
    }
  }
  for (const [conversationId, messages] of Object.entries(after.threads)) {
    const beforeMessages = new Map((before.threads[conversationId] ?? []).map((message) => [message.id, message] as const));
    for (const message of messages) {
      const previous = beforeMessages.get(message.id);
      if (!previous || JSON.stringify(previous) !== JSON.stringify(message)) {
        operations.push({ type: "upsertMessage", conversationId, message });
      }
    }
  }
  if (JSON.stringify(before.settings) !== JSON.stringify(after.settings)) {
    operations.push({ type: "setSettings", settings: after.settings });
  }
  if (before.selectedId !== after.selectedId) {
    operations.push({ type: "setSelectedConversation", conversationId: after.selectedId });
  }
  if (operations.length > 0) {
    cachedWorkspaceLocale = after.settings?.general?.locale ?? cachedWorkspaceLocale;
    applyWorkspaceDbMutations(operations);
  }
}

export function storageHealthSnapshot(): {
  readonly storage: { readonly ok: boolean; readonly stateFile: string; readonly lockFile: string; readonly backupFile: string; readonly error?: string };
  readonly agents: { readonly visible: readonly string[] };
  readonly browser: { readonly installed: boolean };
} {
  const browser = { installed: isPlaywrightBrowserInstalled() };
  try {
    ensureWorkspaceDb();
    workspaceDbHasState();
    return {
      storage: {
        ok: true,
        stateFile: WORKSPACE_DB_FILE,
        lockFile: `${WORKSPACE_DB_FILE}-wal`,
        backupFile: `${WORKSPACE_STATE_FILE}.pre-sqlite`,
      },
      agents: { visible: visibleAgentDetectionIds() },
      browser,
    };
  } catch (error) {
    return {
      storage: {
        ok: false,
        stateFile: WORKSPACE_DB_FILE,
        lockFile: `${WORKSPACE_DB_FILE}-wal`,
        backupFile: `${WORKSPACE_STATE_FILE}.pre-sqlite`,
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

function usageAuditPayload(payload: unknown): unknown {
  try {
    const json = JSON.stringify(payload);
    if (json.length <= 50_000) {
      return payload;
    }
    return { truncated: true, json: json.slice(0, 50_000) };
  } catch {
    return String(payload);
  }
}

function usageDebugEntries(debug: unknown): readonly UsageDebugEntry[] {
  if (debug === undefined) {
    return [];
  }
  const entries = Array.isArray(debug) ? debug : [debug];
  return entries.map((entry) => {
    if (!isRecord(entry) || typeof entry.source !== "string" || !Object.prototype.hasOwnProperty.call(entry, "payload")) {
      throw new Error("Invalid usage debug entry.");
    }
    return { source: entry.source, payload: entry.payload };
  });
}

function isScheduledWakeupTrigger(value: unknown): value is ScheduledWakeupTrigger {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }
  if (value.type === "time") {
    return typeof value.fireAtMs === "number" && Number.isFinite(value.fireAtMs);
  }
  return (
    value.type === "script" &&
    typeof value.script === "string" &&
    value.script.trim().length > 0 &&
    typeof value.intervalSeconds === "number" &&
    Number.isFinite(value.intervalSeconds) &&
    value.intervalSeconds > 0 &&
    typeof value.nextCheckMs === "number" &&
    Number.isFinite(value.nextCheckMs)
  );
}

function isScheduledWakeupRecord(value: unknown): value is ScheduledWakeupRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.createdAtMs === "number" &&
    typeof value.origin === "string" &&
    typeof value.cwd === "string" &&
    typeof value.conversationId === "string" &&
    typeof value.sourceRunId === "string" &&
    isRecord(value.request) &&
    typeof value.request.agent === "string" &&
    typeof value.request.model === "string" &&
    typeof value.request.reasoning === "string" &&
    typeof value.request.mode === "string" &&
    typeof value.request.prompt === "string" &&
    typeof value.request.accessMode === "string" &&
    isScheduledWakeupTrigger(value.trigger)
  );
}

function readScheduledWakeupRecords(file = SCHEDULED_WAKEUPS_FILE): ScheduledWakeupRecord[] {
  if (!existsSync(file)) {
    return [];
  }
  const parsed = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${file} must contain an array of scheduled wakeups.`);
  }
  return parsed.filter(isScheduledWakeupRecord);
}

function writeScheduledWakeupRecords(records: readonly ScheduledWakeupRecord[], file = SCHEDULED_WAKEUPS_FILE): void {
  writeJsonFileAtomic(file, records, 0o600, false);
}

function scheduledWakeupSummaries(conversationId?: string): ScheduledWakeupSummary[] {
  return readScheduledWakeupRecords()
    .filter((record) => !conversationId || record.conversationId === conversationId)
    .map((record) => ({
      id: record.id,
      conversationId: record.conversationId,
      agent: record.request.agent,
      prompt: record.request.prompt,
      reason: record.reason,
      trigger: record.trigger,
    }));
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
  const message = errorMessage(error);
  if (error instanceof SyntaxError || workspaceMutationBadRequestMessages.has(message)) {
    return 400;
  }
  if (
    (message.startsWith("Conversation ") && message.endsWith(" does not exist.")) ||
    (message.startsWith("Project ") && message.endsWith(" does not exist.")) ||
    (message.startsWith("Message ") && message.includes(" already belongs to conversation ")) ||
    message.startsWith("Duplicate message id ")
  ) {
    return 400;
  }
  return 500;
}

export function attachmentUploadErrorStatus(error: unknown): 400 | 500 {
  return error instanceof SyntaxError ? 400 : 500;
}

const agentConfigBadRequestMessages = new Set(["Invalid agent config payload.", "Agent id is required.", "API key is required."]);
const agentInstallBadRequestMessages = new Set(["Invalid agent install payload.", "Agent id is required."]);
const voiceConfigBadRequestMessages = new Set(["Invalid voice provider config payload.", "Voice provider id is required.", "API key is required."]);
const voiceTranscribeBadRequestMessages = new Set(["Invalid voice transcription payload.", "Voice provider id is required.", "Audio data is required."]);

export function agentConfigErrorStatus(error: unknown): 400 | 500 {
  return error instanceof SyntaxError || agentConfigBadRequestMessages.has(errorMessage(error)) ? 400 : 500;
}

export function agentInstallErrorStatus(error: unknown): 400 | 500 {
  return error instanceof SyntaxError || agentInstallBadRequestMessages.has(errorMessage(error)) ? 400 : 500;
}

function voiceConfigErrorStatus(error: unknown): 400 | 500 {
  return error instanceof SyntaxError || voiceConfigBadRequestMessages.has(errorMessage(error)) ? 400 : 500;
}

function voiceTranscribeErrorStatus(error: unknown): 400 | 500 {
  return error instanceof SyntaxError || voiceTranscribeBadRequestMessages.has(errorMessage(error)) ? 400 : 500;
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

export interface VoiceConfigPayload {
  readonly provider: VoiceProviderId;
  readonly apiKey: string;
}

export function parseVoiceConfigPayload(body: string): VoiceConfigPayload {
  const parsed = JSON.parse(body || "{}") as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Invalid voice provider config payload.");
  }
  const provider = typeof parsed.provider === "string" ? parsed.provider.trim() : "";
  if (!provider) {
    throw new Error("Voice provider id is required.");
  }
  if (!isVoiceProviderId(provider) || getVoiceProvider(provider).kind !== "cloud") {
    throw new Error(`Voice provider ${provider} is not supported.`);
  }
  const apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "";
  if (!apiKey) {
    throw new Error("API key is required.");
  }
  return { provider, apiKey };
}

export interface VoiceTranscribePayload {
  readonly provider: VoiceProviderId;
  readonly mimeType: string;
  readonly dataBase64: string;
  readonly language?: string;
}

export function parseVoiceTranscribePayload(body: string): VoiceTranscribePayload {
  const parsed = JSON.parse(body || "{}") as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Invalid voice transcription payload.");
  }
  const provider = typeof parsed.provider === "string" ? parsed.provider.trim() : "";
  if (!provider) {
    throw new Error("Voice provider id is required.");
  }
  if (!isVoiceProviderId(provider) || getVoiceProvider(provider).kind !== "cloud") {
    throw new Error(`Voice provider ${provider} is not supported.`);
  }
  if (typeof parsed.dataBase64 !== "string" || parsed.dataBase64.length === 0) {
    throw new Error("Audio data is required.");
  }
  const mimeType = typeof parsed.mimeType === "string" && parsed.mimeType.trim().length > 0 ? parsed.mimeType.trim() : "audio/webm";
  const language = typeof parsed.language === "string" && parsed.language.trim().length > 0 ? parsed.language.trim() : undefined;
  return language ? { provider, mimeType, dataBase64: parsed.dataBase64, language } : { provider, mimeType, dataBase64: parsed.dataBase64 };
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
  if (session.freshness === "dirty" || session.freshness === "blocked") {
    if (!session.dirtyUrl) {
      return staleBrowserPreviewActionResult(session, action, tabId, "Preview mirror is stale and has no Preview URL to synchronize.");
    }
    markBrowserPreviewFreshness(session, "syncing", session.freshnessReason, session.dirtyUrl);
    await navigateBrowserPreview(session, page, session.dirtyUrl);
    markBrowserPreviewSynced(session);
  } else if (session.freshness === "error") {
    return staleBrowserPreviewActionResult(session, action, tabId, "Preview mirror is in an error state; refresh the snapshot before continuing.");
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
      const session = await ensureBrowserPreviewSession(query.sessionId);
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
      sendJson(res, 200, { ...readWorkspaceShellForClient(), revision: readWorkspaceRevision() });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (req.method === "PUT") {
    sendJson(res, 410, { error: "Full workspace writes are disabled. Use /api/workspace/mutations." });
    return;
  }

  res.statusCode = 405;
  res.end();
}

function handleWorkspaceRevision(_req: IncomingMessage, res: ServerResponse): void {
  try {
    ensureWorkspaceDb();
    sendJson(res, 200, { revision: readWorkspaceRevision() });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

function handleWorkspaceMutations(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    try {
      ensureWorkspaceDb();
      const { mutations, baseRevision } = parseWorkspaceMutationRequestBody(body);
      const revision = applyWorkspaceDbMutations(mutations, { expectedRevision: baseRevision });
      sendJson(res, 200, { ok: true, revision });
    } catch (error) {
      if (error instanceof WorkspaceRevisionConflictError) {
        sendJson(res, 409, {
          error: error.message,
          code: "workspace_revision_conflict",
          expectedRevision: error.expectedRevision,
          revision: error.currentRevision,
          workspace: readWorkspaceState(),
        });
        return;
      }
      sendJson(res, workspacePutErrorStatus(error), { error: errorMessage(error) });
    }
  });
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
      // `body` is the raw request string — parse it (the sibling folder handlers
      // go through parseProjectDirectoryPayload, which does this). Without the
      // parse, isRecord() on a string was always false, so `path` was ignored and
      // every request fell back to homedir() — folder navigation never moved.
      let parsed: unknown = {};
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        parsed = {};
      }
      const raw = isRecord(parsed) && typeof parsed.path === "string" ? parsed.path.trim() : "";
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

function serializedAgentLimits(): Record<string, AgentRateLimit> {
  const limits: Record<string, AgentRateLimit> = {};
  let pruned = false;
  for (const [agent, acc] of latestAgentLimits.entries()) {
    pruned = pruneExpiredLimitWindows(acc) || pruned;
    const snapshot = serializeAgentLimit(acc);
    if (snapshot.windows.length > 0 || snapshot.plan) {
      limits[agent] = snapshot;
    }
  }
  if (pruned) {
    persistAgentLimits();
  }
  return limits;
}

/** Returns the latest known account rate-limit snapshot per agent (keyed by
 *  agent id). With `?refresh=1&agent=<id>`, first asks the agent CLI for a fresh
 *  snapshot, throttled server-side to one attempt per minute per agent. */
async function handleAgentLimits(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const refresh = url.searchParams.get("refresh") === "1";
  const agent = url.searchParams.get("agent") ?? "";
  let refreshError: string | undefined;
  if (refresh) {
    if (!RUNNABLE_AGENT_IDS.has(agent)) {
      sendJson(res, 400, { error: `Unknown agent: ${agent || "(missing)"}.` });
      return;
    }
    refreshError = await refreshAgentLimitsIfDue(agent);
  }
  sendJson(res, 200, { limits: serializedAgentLimits(), ...(refreshError ? { refreshError } : {}) });
}

async function handleCliUpdates(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const refresh = url.searchParams.get("refresh") === "1";
  try {
    const snapshot = refresh ? await checkCliUpdatesNow() : cliUpdateSnapshot;
    sendJson(res, 200, snapshot);
  } catch (error) {
    sendJson(res, 500, { error: errorMessage(error) });
  }
}

function voiceProviderEnv(provider: VoiceProviderId): string | null {
  return getVoiceProvider(provider).envVar ?? null;
}

function configuredVoiceApiKey(provider: VoiceProviderId): string | null {
  const envVar = voiceProviderEnv(provider);
  if (!envVar) {
    return null;
  }
  return configuredEnvValueFrom(envVar, readAgentSecretConfig(), process.env)?.trim() || null;
}

async function responseJson(response: Response): Promise<unknown> {
  return (await response.json().catch(() => ({}))) as unknown;
}

async function responseTextError(response: Response, fallback: string): Promise<string> {
  const payload = await responseJson(response);
  if (isRecord(payload)) {
    for (const key of ["error", "message", "detail"]) {
      const value = payload[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
      if (isRecord(value) && typeof value.message === "string") {
        return value.message;
      }
    }
  }
  return fallback;
}

function audioBlob(payload: VoiceTranscribePayload): Blob {
  return new Blob([Buffer.from(payload.dataBase64, "base64")], { type: payload.mimeType });
}

function twoLetterLanguage(language: string | undefined): string | undefined {
  const value = language?.trim();
  if (!value || value.toLowerCase() === "auto") {
    return undefined;
  }
  return value.split(/[-_]/)[0]?.toLowerCase();
}

async function sleepMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function transcribeOpenAi(payload: VoiceTranscribePayload, apiKey: string): Promise<string> {
  const form = new FormData();
  form.set("model", "gpt-4o-mini-transcribe");
  const language = twoLetterLanguage(payload.language);
  if (language) {
    form.set("language", language);
  }
  form.set("file", audioBlob(payload), `dictation.${payload.mimeType.includes("wav") ? "wav" : "webm"}`);
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) {
    throw new Error(await responseTextError(response, `OpenAI transcription failed (${response.status})`));
  }
  const json = await responseJson(response);
  return isRecord(json) && typeof json.text === "string" ? json.text.trim() : "";
}

async function transcribeGoogle(payload: VoiceTranscribePayload, apiKey: string): Promise<string> {
  const encoding = payload.mimeType.includes("webm") ? "WEBM_OPUS" : payload.mimeType.includes("ogg") ? "OGG_OPUS" : "ENCODING_UNSPECIFIED";
  const response = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": JSON_CONTENT_TYPE },
    body: JSON.stringify({
      config: {
        encoding,
        languageCode: payload.language || "ru-RU",
        enableAutomaticPunctuation: true,
      },
      audio: { content: payload.dataBase64 },
    }),
  });
  if (!response.ok) {
    throw new Error(await responseTextError(response, `Google Speech-to-Text failed (${response.status})`));
  }
  const json = await responseJson(response);
  const results = isRecord(json) && Array.isArray(json.results) ? json.results : [];
  return results
    .map((result) => (isRecord(result) && Array.isArray(result.alternatives) && isRecord(result.alternatives[0]) && typeof result.alternatives[0].transcript === "string" ? result.alternatives[0].transcript : ""))
    .filter(Boolean)
    .join(" ")
    .trim();
}

async function transcribeAssemblyAi(payload: VoiceTranscribePayload, apiKey: string): Promise<string> {
  const upload = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST",
    headers: { authorization: apiKey, "Content-Type": payload.mimeType },
    body: Buffer.from(payload.dataBase64, "base64"),
  });
  if (!upload.ok) {
    throw new Error(await responseTextError(upload, `AssemblyAI upload failed (${upload.status})`));
  }
  const uploadJson = await responseJson(upload);
  const uploadUrl = isRecord(uploadJson) && typeof uploadJson.upload_url === "string" ? uploadJson.upload_url : "";
  if (!uploadUrl) {
    throw new Error("AssemblyAI upload response did not include upload_url.");
  }
  const start = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: { authorization: apiKey, "Content-Type": JSON_CONTENT_TYPE },
    body: JSON.stringify({ audio_url: uploadUrl, punctuate: true, format_text: true, language_detection: !twoLetterLanguage(payload.language), ...(twoLetterLanguage(payload.language) ? { language_code: twoLetterLanguage(payload.language) } : {}) }),
  });
  if (!start.ok) {
    throw new Error(await responseTextError(start, `AssemblyAI transcription failed (${start.status})`));
  }
  const startJson = await responseJson(start);
  const id = isRecord(startJson) && typeof startJson.id === "string" ? startJson.id : "";
  if (!id) {
    throw new Error("AssemblyAI transcription response did not include id.");
  }
  for (let i = 0; i < 30; i += 1) {
    await sleepMs(1000);
    const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${encodeURIComponent(id)}`, { headers: { authorization: apiKey } });
    if (!poll.ok) {
      throw new Error(await responseTextError(poll, `AssemblyAI polling failed (${poll.status})`));
    }
    const json = await responseJson(poll);
    const status = isRecord(json) && typeof json.status === "string" ? json.status : "";
    if (status === "completed") {
      return isRecord(json) && typeof json.text === "string" ? json.text.trim() : "";
    }
    if (status === "error") {
      throw new Error(isRecord(json) && typeof json.error === "string" ? json.error : "AssemblyAI transcription failed.");
    }
  }
  throw new Error("AssemblyAI transcription timed out.");
}

async function transcribeSpeechmatics(payload: VoiceTranscribePayload, apiKey: string): Promise<string> {
  const form = new FormData();
  const language = twoLetterLanguage(payload.language) ?? "auto";
  form.set("config", JSON.stringify({ type: "transcription", transcription_config: { language, operating_point: "enhanced" } }));
  form.set("data_file", audioBlob(payload), "dictation.webm");
  const start = await fetch("https://asr.api.speechmatics.com/v2/jobs/", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!start.ok) {
    throw new Error(await responseTextError(start, `Speechmatics transcription failed (${start.status})`));
  }
  const startJson = await responseJson(start);
  const id = isRecord(startJson) && typeof startJson.id === "string" ? startJson.id : isRecord(startJson) && isRecord(startJson.job) && typeof startJson.job.id === "string" ? startJson.job.id : "";
  if (!id) {
    throw new Error("Speechmatics job response did not include id.");
  }
  for (let i = 0; i < 30; i += 1) {
    await sleepMs(1000);
    const statusResponse = await fetch(`https://asr.api.speechmatics.com/v2/jobs/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!statusResponse.ok) {
      throw new Error(await responseTextError(statusResponse, `Speechmatics polling failed (${statusResponse.status})`));
    }
    const statusJson = await responseJson(statusResponse);
    const status = isRecord(statusJson) && isRecord(statusJson.job) && typeof statusJson.job.status === "string" ? statusJson.job.status : "";
    if (status === "done") {
      const transcript = await fetch(`https://asr.api.speechmatics.com/v2/jobs/${encodeURIComponent(id)}/transcript?format=txt`, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!transcript.ok) {
        throw new Error(await responseTextError(transcript, `Speechmatics transcript download failed (${transcript.status})`));
      }
      return (await transcript.text()).trim();
    }
    if (status === "rejected") {
      throw new Error("Speechmatics rejected the transcription job.");
    }
  }
  throw new Error("Speechmatics transcription timed out.");
}

async function transcribeGladia(payload: VoiceTranscribePayload, apiKey: string): Promise<string> {
  const form = new FormData();
  form.set("audio", audioBlob(payload), "dictation.webm");
  const upload = await fetch("https://api.gladia.io/v2/upload", {
    method: "POST",
    headers: { "x-gladia-key": apiKey },
    body: form,
  });
  if (!upload.ok) {
    throw new Error(await responseTextError(upload, `Gladia upload failed (${upload.status})`));
  }
  const uploadJson = await responseJson(upload);
  const audioUrl = isRecord(uploadJson) && typeof uploadJson.audio_url === "string" ? uploadJson.audio_url : "";
  if (!audioUrl) {
    throw new Error("Gladia upload response did not include audio_url.");
  }
  const language = twoLetterLanguage(payload.language);
  const start = await fetch("https://api.gladia.io/v2/pre-recorded", {
    method: "POST",
    headers: { "x-gladia-key": apiKey, "Content-Type": JSON_CONTENT_TYPE },
    body: JSON.stringify({ audio_url: audioUrl, detect_language: !language, ...(language ? { language } : {}) }),
  });
  if (!start.ok) {
    throw new Error(await responseTextError(start, `Gladia transcription failed (${start.status})`));
  }
  const startJson = await responseJson(start);
  const id = isRecord(startJson) && typeof startJson.id === "string" ? startJson.id : "";
  if (!id) {
    throw new Error("Gladia transcription response did not include id.");
  }
  for (let i = 0; i < 30; i += 1) {
    await sleepMs(1000);
    const poll = await fetch(`https://api.gladia.io/v2/pre-recorded/${encodeURIComponent(id)}`, { headers: { "x-gladia-key": apiKey } });
    if (!poll.ok) {
      throw new Error(await responseTextError(poll, `Gladia polling failed (${poll.status})`));
    }
    const json = await responseJson(poll);
    const status = isRecord(json) && typeof json.status === "string" ? json.status : "";
    if (status === "done") {
      const result = isRecord(json) && isRecord(json.result) ? json.result : {};
      const transcription = isRecord(result) && isRecord(result.transcription) ? result.transcription : {};
      return typeof transcription.full_transcript === "string" ? transcription.full_transcript.trim() : "";
    }
    if (status === "error") {
      throw new Error("Gladia transcription failed.");
    }
  }
  throw new Error("Gladia transcription timed out.");
}

async function transcribeVoice(payload: VoiceTranscribePayload): Promise<string> {
  const apiKey = configuredVoiceApiKey(payload.provider);
  if (!apiKey) {
    throw new Error(`${getVoiceProvider(payload.provider).name} API key is not configured.`);
  }
  switch (payload.provider) {
    case "openai":
      return transcribeOpenAi(payload, apiKey);
    case "google":
      return transcribeGoogle(payload, apiKey);
    case "assemblyai":
      return transcribeAssemblyAi(payload, apiKey);
    case "speechmatics":
      return transcribeSpeechmatics(payload, apiKey);
    case "gladia":
      return transcribeGladia(payload, apiKey);
    default:
      throw new Error(`Voice provider ${payload.provider} is not supported.`);
  }
}

function handleVoiceConfig(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === "GET") {
    try {
      const config = readAgentSecretConfig();
      const providers = Object.fromEntries(
        VOICE_PROVIDERS.map((provider) => [
          provider.id,
          {
            envVar: provider.envVar ?? "",
            configured: provider.kind !== "cloud" || Boolean(provider.envVar && configuredEnvValueFrom(provider.envVar, config, process.env)?.trim()),
          },
        ]),
      );
      sendJson(res, 200, { providers });
    } catch (error) {
      sendJson(res, 500, { error: errorMessage(error) });
    }
    return;
  }

  if (req.method === "PUT") {
    readJsonBody(req, res, (body) => {
      try {
        const { provider, apiKey } = parseVoiceConfigPayload(body);
        const envVar = voiceProviderEnv(provider);
        if (!envVar) {
          sendJson(res, 400, { error: `Voice provider ${provider} does not accept API key configuration.` });
          return;
        }
        const config = readAgentSecretConfig();
        writeAgentSecretConfig({ env: { ...config.env, [envVar]: apiKey } });
        sendJson(res, 200, { ok: true, provider, envVar, configured: true });
      } catch (error) {
        sendJson(res, voiceConfigErrorStatus(error), { error: errorMessage(error) });
      }
    });
    return;
  }

  res.statusCode = 405;
  res.end();
}

function handleVoiceTranscribe(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    void (async () => {
      try {
        const payload = parseVoiceTranscribePayload(body);
        const text = await transcribeVoice(payload);
        sendJson(res, 200, { text });
      } catch (error) {
        sendJson(res, voiceTranscribeErrorStatus(error), { error: errorMessage(error) });
      }
    })();
  });
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
        const envVar = isAgentId(agent) ? DETECT[agent].env?.[0] : undefined;
        if (!envVar) {
          sendJson(res, 400, { error: `Agent ${agent} does not accept API key configuration.` });
          return;
        }
        const config = readAgentSecretConfig();
        writeAgentSecretConfig({ env: { ...config.env, [envVar]: apiKey } });
        clearAgentDetectionCache();
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
function runInstallToCompletion(
  launch: { readonly command: string; readonly args: readonly string[]; readonly displayCommand: string },
  res: ServerResponse,
  extra: Record<string, unknown> = {},
  onSuccess?: () => void,
): void {
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
      onSuccess?.();
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
      const command = installCommandForAgent(agent);
      if (!command) {
        sendJson(res, 400, { error: `No install command is configured for ${agent}.` });
        return;
      }
      const launch = resolveAgentInstallLaunch(agent);
      if (!launch) {
        sendJson(res, 500, { error: `Install executable ${command[0]} was not found on PATH.` });
        return;
      }
      runInstallToCompletion(launch, res, { agent }, () => {
        clearAgentDetectionCache();
        clearCliUpdateSnapshotForAgent(agent);
        void recheckCliUpdatesAfterInstall(agent);
      });
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
      const before = readWorkspaceState();
      persistWorkspaceDelta(before, applyRunApprovalDecisionState(before, resolved));
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
      const before = readWorkspaceState();
      persistWorkspaceDelta(before, applyRunInputSelectionState(before, resolved));
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

function handleGitTree(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    void (async () => {
      try {
        const { cwd } = parseGitCwdPayload(body);
        const validation = validateGitCwd(cwd);
        if (validation) {
          sendJson(res, 400, { error: validation });
          return;
        }

        const result = await runGitP(cwd, [
          "log",
          "--graph",
          "--decorate=short",
          "--all",
          "--date=short",
          "--max-count=160",
          "--pretty=format:%x1f%H%x1f%h%x1f%P%x1f%an%x1f%ad%x1f%D%x1f%s",
        ]);
        if (!result.ok) {
          sendJson(res, 500, { error: result.error });
          return;
        }
        const commits = parseGitGraphLog(result.stdout);
        sendJson(res, 200, { commits, branchHeads: gitGraphBranchHeads(commits) });
      } catch (error) {
        sendJson(res, gitErrorStatus(error), { error: errorMessage(error) });
      }
    })();
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
  "Git branch is required.",
  "Git branch contains an invalid null byte.",
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

export function parseGitCheckoutPayload(body: string): { readonly cwd: string; readonly branch: string } {
  const parsed = parseJsonObjectPayload(body, "Invalid git request payload.");
  const cwd = typeof parsed.cwd === "string" ? parsed.cwd.trim() : "";
  const branch = typeof parsed.branch === "string" ? parsed.branch.trim() : "";
  if (!cwd) {
    throw new Error("Project directory is required.");
  }
  if (!branch) {
    throw new Error("Git branch is required.");
  }
  if (branch.includes("\0")) {
    throw new Error("Git branch contains an invalid null byte.");
  }
  return { cwd, branch };
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
        runGit(cwd, ["branch", "--format=%(refname:short)"], (branchResult) => {
          if (!branchResult.ok) {
            sendJson(res, 500, { error: branchResult.error });
            return;
          }
          const branches = branchResult.stdout
            .split(/\r?\n/)
            .map((branch) => branch.trim())
            .filter((branch) => branch.length > 0);
          const uniqueBranches = Array.from(new Set(branches.includes(payload.branch) || payload.branch === "HEAD" ? branches : [payload.branch, ...branches]));
          sendJson(res, 200, { ...payload, branches: uniqueBranches, unstagedAdditions: totals.additions, unstagedDeletions: totals.deletions, commitHash, commitTitle });
        });
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

interface GitGraphCommitPayload {
  readonly graph: string;
  readonly hash: string;
  readonly shortHash: string;
  readonly parents: readonly string[];
  readonly author: string;
  readonly date: string;
  readonly refs: readonly string[];
  readonly subject: string;
}

interface GitGraphBranchHeadPayload {
  readonly name: string;
  readonly hash: string;
}

export function parseGitGraphLog(output: string): readonly GitGraphCommitPayload[] {
  const commits: GitGraphCommitPayload[] = [];
  for (const line of output.split(/\r?\n/)) {
    const fields = line.split("\u001f");
    if (fields.length < 8) {
      continue;
    }
    const [graph, hash, shortHash, parents, author, date, refs, ...subjectParts] = fields;
    if (!hash) {
      continue;
    }
    const cleanRefs = refs
      .split(",")
      .map((ref) => ref.trim())
      .filter((ref) => ref.length > 0);
    commits.push({
        graph: graph.trimEnd(),
        hash,
        shortHash,
        parents: parents.split(/\s+/).filter((parent) => parent.length > 0),
        author,
        date,
        refs: cleanRefs,
        subject: subjectParts.join("\u001f"),
    });
  }
  return commits;
}

function gitGraphRefName(ref: string): string | null {
  const trimmed = ref.trim();
  if (!trimmed || trimmed === "HEAD") {
    return null;
  }
  const arrowIndex = trimmed.indexOf(" -> ");
  if (arrowIndex >= 0) {
    const target = trimmed.slice(arrowIndex + 4).trim();
    return target.length > 0 ? target : null;
  }
  return trimmed;
}

export function gitGraphBranchHeads(commits: readonly GitGraphCommitPayload[]): readonly GitGraphBranchHeadPayload[] {
  const branchHeads = new Map<string, string>();
  for (const commit of commits) {
    for (const ref of commit.refs) {
      const name = gitGraphRefName(ref);
      if (name && !branchHeads.has(name)) {
        branchHeads.set(name, commit.hash);
      }
    }
  }
  return Array.from(branchHeads, ([name, hash]) => ({ name, hash }));
}

async function listLocalGitBranches(cwd: string): Promise<readonly string[]> {
  const result = await runGitP(cwd, ["branch", "--format=%(refname:short)"]);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.stdout
    .split(/\r?\n/)
    .map((branch) => branch.trim())
    .filter((branch) => branch.length > 0);
}

export function isNoChangesGitCommitResult(result: Pick<GitCommandResult, "stdout" | "error">): boolean {
  const output = `${result.stdout}\n${result.error}`.toLowerCase();
  return output.includes("nothing to commit") || output.includes("no changes added to commit");
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
        const addResult = await runGitP(worktreePath, ["add", "-A"]);
        if (!addResult.ok) {
          sendJson(res, 500, { error: addResult.error });
          return;
        }
        const commitResult = await runGitP(worktreePath, ["commit", "-m", "Kanban: worktree changes"]);
        if (!commitResult.ok && !isNoChangesGitCommitResult(commitResult)) {
          sendJson(res, 500, { error: commitResult.error });
          return;
        }
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

function handleGitCheckout(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    void (async () => {
      try {
        const { cwd, branch } = parseGitCheckoutPayload(body);
        const cwdError = validateGitCwd(cwd);
        if (cwdError) {
          sendJson(res, 400, { error: cwdError });
          return;
        }
        const statusResult = await runGitP(cwd, ["status", "--porcelain=v1"]);
        if (!statusResult.ok) {
          sendJson(res, 500, { error: statusResult.error });
          return;
        }
        if (statusResult.stdout.trim().length > 0) {
          sendJson(res, 409, { error: "Working tree has uncommitted changes." });
          return;
        }
        const branches = await listLocalGitBranches(cwd);
        if (!branches.includes(branch)) {
          sendJson(res, 400, { error: `Git branch not found: ${branch}` });
          return;
        }
        const checkoutResult = await runGitP(cwd, ["checkout", branch]);
        if (!checkoutResult.ok) {
          sendJson(res, 500, { error: checkoutResult.error });
          return;
        }
        sendGitStatusAfterMutation(cwd, res);
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

function optionalPositiveIntegerHeader(req: IncomingMessage, name: string): number | undefined {
  const raw = req.headers[name];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseTerminalSessionRequest(req: IncomingMessage): { readonly cwd: string; readonly cols?: number; readonly rows?: number } {
  const rawCwd = req.headers["x-rlab-terminal-cwd"];
  const cwd = (Array.isArray(rawCwd) ? rawCwd[0] : rawCwd)?.trim() ?? "";
  if (!cwd) {
    throw new Error("Project directory is required.");
  }
  return {
    cwd: resolve(cwd),
    cols: optionalPositiveIntegerHeader(req, "x-rlab-terminal-cols"),
    rows: optionalPositiveIntegerHeader(req, "x-rlab-terminal-rows"),
  };
}

function handleTerminalSession(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === "DELETE") {
    const id = new URL(req.url ?? "/", "http://localhost").searchParams.get("id")?.trim() ?? "";
    if (!id) {
      sendJson(res, 400, { error: "Missing terminal session id." });
      return;
    }
    const closed = terminalManager.close(id);
    sendJson(res, closed ? 200 : 404, closed ? { ok: true } : { error: "Terminal session not found." });
    return;
  }
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end();
    return;
  }
  let cwd: string;
  let cols: number | undefined;
  let rows: number | undefined;
  try {
    ({ cwd, cols, rows } = parseTerminalSessionRequest(req));
    const cwdError = validateGitCwd(cwd);
    if (cwdError) {
      sendJson(res, 400, { error: cwdError });
      return;
    }
  } catch (error) {
    sendJson(res, gitErrorStatus(error), { error: errorMessage(error) });
    return;
  }

  try {
    sendJson(res, 200, terminalManager.create({ cwd, cols, rows }));
  } catch (error) {
    sendJson(res, 500, { error: errorMessage(error) });
  }
}

/* ------------------------------ Real agent run ------------------------------ */

export type RunEvent = SharedRunEvent;

interface UsageDebugEntry {
  readonly source: string;
  readonly payload: unknown;
}

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

type ScheduledWakeupTrigger =
  | { readonly type: "time"; readonly fireAtMs: number }
  | { readonly type: "cron"; readonly cron: string; readonly nextFireMs: number }
  | {
      readonly type: "script";
      readonly script: string;
      readonly intervalSeconds?: number;
      readonly cron?: string;
      readonly nextCheckMs: number;
      readonly lastCheckedAtMs?: number;
      readonly lastExitCode?: number;
      readonly lastError?: string;
    };

interface ScheduledWakeupRecord {
  readonly id: string;
  readonly createdAtMs: number;
  readonly origin: string;
  readonly cwd: string;
  readonly conversationId: string;
  readonly sourceRunId: string;
  readonly sourceToolId?: string;
  readonly reason?: string;
  readonly trigger: ScheduledWakeupTrigger;
  readonly request: RunRequest;
}

export interface ScheduledWakeupSummary {
  readonly id: string;
  readonly conversationId: string;
  readonly agent: string;
  readonly prompt: string;
  readonly reason?: string;
  readonly trigger: ScheduledWakeupTrigger;
}

/** A single rate-limit window. An account can be bounded by several at once —
 *  e.g. Claude/Codex enforce both a rolling 5-hour window and a weekly one — so
 *  each is tracked independently and shown side by side in the composer. */
type RateLimitWindowKind = "five_hour" | "weekly" | "overage" | "daily";

interface RateLimitWindow {
  readonly kind: RateLimitWindowKind;
  /** Optional provider-specific label (Gemini reports separate model-family rows). */
  readonly label?: string;
  /** Percent of this window's allowance used (0–100). */
  readonly usedPercent?: number;
  /** Epoch seconds when this window resets. */
  readonly resetsAt?: number;
  /** Per-window status, e.g. "allowed" / "allowed_warning" / "rejected" (Claude). */
  readonly status?: string;
}

/** The latest account rate-limit snapshot reported by an agent, surfaced in the
 *  composer. Claude emits `rate_limit_event` stream events (one window each);
 *  Codex pushes `account/rateLimits/updated` notifications and answers an
 *  `account/rateLimits/read` request (primary + secondary windows). Fields are
 *  optional — each agent reports a different subset. */
interface AgentRateLimit {
  readonly updatedAt: number;
  /** Most-severe status across all windows. */
  readonly status?: string;
  /** Subscription plan label (Codex). */
  readonly plan?: string;
  /** Every window currently reported, ordered 5h → weekly → overage. */
  readonly windows: readonly RateLimitWindow[];
}

/** Mutable per-agent accumulator. Windows are keyed by kind plus optional label
 *  so repeated events merge, while Gemini can keep separate model-family rows. */
interface AgentLimitAccumulator {
  updatedAt: number;
  plan?: string;
  windows: Map<string, RateLimitWindow>;
}

const latestAgentLimits = new Map<string, AgentLimitAccumulator>();

const WINDOW_ORDER: readonly RateLimitWindowKind[] = ["five_hour", "weekly", "daily", "overage"];
const RATE_LIMIT_WINDOW_KINDS: ReadonlySet<string> = new Set(WINDOW_ORDER);
const AGENT_LIMIT_REFRESH_MIN_INTERVAL_MS = 60_000;
const agentLimitRefreshAttempts = new Map<string, { readonly attemptedAt: number; readonly error?: string }>();

/** Load persisted rate-limit snapshots into the in-memory store on boot, so a
 *  restart doesn't blank the composer's limits until the next run. */
function loadPersistedAgentLimits(): void {
  if (!existsSync(AGENT_LIMITS_FILE)) {
    return;
  }
  try {
    const parsed = JSON.parse(readFileSync(AGENT_LIMITS_FILE, "utf8").replace(/^﻿/, "")) as unknown;
    if (!isRecord(parsed)) {
      return;
    }
    const nowSeconds = Date.now() / 1000;
    for (const [agent, value] of Object.entries(parsed)) {
      if (!isRecord(value)) {
        continue;
      }
      const windows = new Map<string, RateLimitWindow>();
      for (const window of Array.isArray(value.windows) ? value.windows : []) {
        if (isRecord(window) && typeof window.kind === "string" && RATE_LIMIT_WINDOW_KINDS.has(window.kind)) {
          const rateWindow = window as unknown as RateLimitWindow;
          if (!rateLimitWindowExpired(rateWindow, nowSeconds)) {
            windows.set(rateLimitWindowKey(rateWindow), rateWindow);
          }
        }
      }
      latestAgentLimits.set(agent, {
        updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : Date.now(),
        plan: typeof value.plan === "string" ? value.plan : undefined,
        windows,
      });
    }
  } catch {
    // Corrupt/partial file — start fresh; it rewrites on the next event.
  }
}

let agentLimitsSaveTimer: ReturnType<typeof setTimeout> | null = null;
/** Debounced write-through of the limits store (events arrive in bursts). */
function persistAgentLimits(): void {
  if (agentLimitsSaveTimer !== null) {
    return;
  }
  agentLimitsSaveTimer = setTimeout(() => {
    agentLimitsSaveTimer = null;
    try {
      mkdirSync(WORKSPACE_STATE_DIR, { recursive: true });
      const out: Record<string, AgentRateLimit> = {};
      for (const [agent, acc] of latestAgentLimits.entries()) {
        out[agent] = serializeAgentLimit(acc);
      }
      writeFileSync(AGENT_LIMITS_FILE, JSON.stringify(out), "utf8");
    } catch {
      // Best-effort; limits repopulate from live events regardless.
    }
  }, 1000);
}

loadPersistedAgentLimits();
const STATUS_SEVERITY: Record<string, number> = { allowed: 0, allowed_warning: 1, rejected: 2 };

function rateLimitWindowKey(window: Pick<RateLimitWindow, "kind" | "label">): string {
  return window.label ? `${window.kind}:${window.label}` : window.kind;
}

function rateLimitWindowExpired(window: Pick<RateLimitWindow, "resetsAt">, nowSeconds = Date.now() / 1000): boolean {
  return typeof window.resetsAt === "number" && window.resetsAt <= nowSeconds;
}

function pruneExpiredLimitWindows(acc: AgentLimitAccumulator, nowSeconds = Date.now() / 1000): boolean {
  let changed = false;
  for (const [key, window] of acc.windows.entries()) {
    if (rateLimitWindowExpired(window, nowSeconds)) {
      acc.windows.delete(key);
      changed = true;
    }
  }
  return changed;
}

function limitAccumulator(agent: string): AgentLimitAccumulator {
  let acc = latestAgentLimits.get(agent);
  if (!acc) {
    acc = { updatedAt: Date.now(), windows: new Map() };
    latestAgentLimits.set(agent, acc);
  }
  return acc;
}

/** Merge one window into an agent's accumulator, preferring defined fields so a
 *  sparse update never wipes a value reported by an earlier one. */
function upsertLimitWindow(agent: string, window: RateLimitWindow): void {
  const acc = limitAccumulator(agent);
  pruneExpiredLimitWindows(acc);
  if (rateLimitWindowExpired(window)) {
    acc.windows.delete(rateLimitWindowKey(window));
    acc.updatedAt = Date.now();
    persistAgentLimits();
    return;
  }
  const key = rateLimitWindowKey(window);
  const prev = acc.windows.get(key);
  acc.windows.set(key, {
    kind: window.kind,
    label: window.label ?? prev?.label,
    usedPercent: window.usedPercent ?? prev?.usedPercent,
    resetsAt: window.resetsAt ?? prev?.resetsAt,
    status: window.status ?? prev?.status,
  });
  acc.updatedAt = Date.now();
  persistAgentLimits();
}

/** Serialize an accumulator into the API shape: ordered windows + the
 *  most-severe window status as the overall status. */
function serializeAgentLimit(acc: AgentLimitAccumulator): AgentRateLimit {
  const windows = [...acc.windows.values()]
    .filter((window) => !rateLimitWindowExpired(window))
    .sort((a, b) => {
      const order = WINDOW_ORDER.indexOf(a.kind) - WINDOW_ORDER.indexOf(b.kind);
      return order === 0 ? (a.label ?? "").localeCompare(b.label ?? "") : order;
    });
  let status: string | undefined;
  for (const window of windows) {
    if (window.status && (status === undefined || (STATUS_SEVERITY[window.status] ?? 0) > (STATUS_SEVERITY[status] ?? 0))) {
      status = window.status;
    }
  }
  return { updatedAt: acc.updatedAt, plan: acc.plan, status, windows };
}

function recordClaudeRateLimit(agent: string, info: Record<string, unknown>): void {
  const rateLimitType = typeof info.rateLimitType === "string" ? info.rateLimitType : undefined;
  if (!rateLimitType) {
    return;
  }
  // Normalize the various weekly windows (seven_day, seven_day_opus, …) to
  // "weekly"; map five_hour/overage directly. Unknown types are ignored.
  const kind: RateLimitWindowKind | undefined = rateLimitType === "five_hour"
    ? "five_hour"
    : rateLimitType.startsWith("seven_day")
      ? "weekly"
      : rateLimitType === "overage"
        ? "overage"
        : undefined;
  if (!kind) {
    return;
  }
  upsertLimitWindow(agent, {
    kind,
    status: typeof info.status === "string" ? info.status : undefined,
    resetsAt: typeof info.resetsAt === "number" ? info.resetsAt : undefined,
    // Claude reports utilization as a 0–1 fraction (e.g. 0.8 = 80%); our model
    // stores 0–100 like Codex's usedPercent, so scale it up.
    usedPercent: typeof info.utilization === "number" ? info.utilization * 100 : undefined,
  });
}

interface ClaudeOAuthCredentials {
  readonly accessToken: string;
  readonly subscriptionType?: string;
  readonly rateLimitTier?: string;
}

function readClaudeOAuthCredentials(): ClaudeOAuthCredentials {
  const credentialsFile = join(claudeHome(), ".credentials.json");
  const parsed = JSON.parse(readFileSync(credentialsFile, "utf8").replace(/^\uFEFF/, "")) as unknown;
  if (!isRecord(parsed) || !isRecord(parsed.claudeAiOauth)) {
    throw new Error(`${credentialsFile} does not contain Claude OAuth credentials.`);
  }
  const oauth = parsed.claudeAiOauth;
  if (typeof oauth.accessToken !== "string" || oauth.accessToken.trim().length === 0) {
    throw new Error(`${credentialsFile} does not contain a Claude OAuth access token.`);
  }
  return {
    accessToken: oauth.accessToken,
    subscriptionType: typeof oauth.subscriptionType === "string" ? oauth.subscriptionType : undefined,
    rateLimitTier: typeof oauth.rateLimitTier === "string" ? oauth.rateLimitTier : undefined,
  };
}

export function parseClaudeRateLimitStream(output: string): readonly Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isRecord(parsed) && parsed.type === "rate_limit_event" && isRecord(parsed.rate_limit_info)) {
        events.push(parsed.rate_limit_info);
      }
    } catch {
      // Non-JSON terminal noise is ignored; malformed JSON is not a rate-limit event.
    }
  }
  return events;
}

function parseEpochSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

function rateLimitStatusFromPercent(percent: number | undefined): string | undefined {
  if (percent === undefined) {
    return undefined;
  }
  if (percent >= 100) {
    return "rejected";
  }
  if (percent >= 90) {
    return "allowed_warning";
  }
  return "allowed";
}

function claudePlanLabel(credentials: Pick<ClaudeOAuthCredentials, "subscriptionType" | "rateLimitTier">): string | undefined {
  const subscription = credentials.subscriptionType?.trim();
  if (subscription) {
    return `Claude ${subscription.toUpperCase()}`;
  }
  return credentials.rateLimitTier?.trim() || undefined;
}

function claudeUsageWindow(kind: RateLimitWindowKind, value: unknown): RateLimitWindow | null {
  if (!isRecord(value)) {
    return null;
  }
  const usedPercent = typeof value.utilization === "number" && Number.isFinite(value.utilization) ? value.utilization : undefined;
  const resetsAt = parseEpochSeconds(value.resets_at ?? value.resetsAt);
  if (usedPercent === undefined && resetsAt === undefined) {
    return null;
  }
  return { kind, usedPercent, resetsAt, status: rateLimitStatusFromPercent(usedPercent) };
}

export function parseClaudeOAuthUsagePayload(
  payload: unknown,
  credentials: Pick<ClaudeOAuthCredentials, "subscriptionType" | "rateLimitTier"> = {},
): Pick<AgentRateLimit, "plan" | "windows"> {
  if (!isRecord(payload)) {
    return { plan: claudePlanLabel(credentials), windows: [] };
  }
  const windows: RateLimitWindow[] = [];
  const fiveHour = claudeUsageWindow("five_hour", payload.five_hour);
  if (fiveHour) {
    windows.push(fiveHour);
  }
  const weekly = claudeUsageWindow("weekly", payload.seven_day);
  if (weekly) {
    windows.push(weekly);
  }
  const overage = isRecord(payload.extra_usage) ? claudeUsageWindow("overage", payload.extra_usage) : null;
  if (overage) {
    windows.push(overage);
  }
  return { plan: claudePlanLabel(credentials), windows };
}

function stripTerminalAnsi(value: string): string {
  return value
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function parseGeminiDurationSeconds(value: string): number | undefined {
  const matches = [...value.matchAll(/(\d+)\s*([dhm])/gi)];
  if (matches.length === 0) {
    return undefined;
  }
  let seconds = 0;
  for (const match of matches) {
    const amount = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isFinite(amount)) {
      continue;
    }
    const unit = (match[2] ?? "").toLowerCase();
    seconds += unit === "d" ? amount * 86400 : unit === "h" ? amount * 3600 : amount * 60;
  }
  return seconds > 0 ? seconds : undefined;
}

export function parseGeminiModelUsageOutput(output: string, nowMs = Date.now()): Pick<AgentRateLimit, "plan" | "windows"> {
  const clean = stripTerminalAnsi(output).replace(/\r/g, "\n");
  const windows: RateLimitWindow[] = [];
  for (const rawLine of clean.split("\n")) {
    const line = rawLine.replace(/[│|]/g, " ").replace(/\s+/g, " ").trim();
    const match = line.match(/^(.+?)\s*[━─▬=._\-\s]+(\d{1,3})%\s+Resets:\s+.*?(?:\(([^)]*)\))?\s*$/i);
    if (!match) {
      continue;
    }
    const label = match[1]?.trim();
    const usedPercent = Number.parseInt(match[2] ?? "", 10);
    if (!label || !Number.isFinite(usedPercent)) {
      continue;
    }
    const durationSeconds = match[3] ? parseGeminiDurationSeconds(match[3]) : undefined;
    windows.push({
      kind: "daily",
      label,
      usedPercent,
      resetsAt: durationSeconds ? Math.floor((nowMs + durationSeconds * 1000) / 1000) : undefined,
      status: rateLimitStatusFromPercent(usedPercent),
    });
  }
  return { plan: "Gemini CLI", windows };
}

function runGeminiModelUsagePtyAsync(resolvedBin: string, cwd: string, timeoutMs = 25_000): Promise<TextDiscoveryResult> {
  const launch = resolveLaunchCommand(resolvedBin, ["--prompt-interactive", "/model", "--skip-trust"]);
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    let sentModelCommand = false;
    let ptyProcess: pty.IPty | null = null;
    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    const killPtyTree = () => {
      const pid = ptyProcess?.pid;
      try {
        ptyProcess?.kill();
      } catch {
        // already exited
      }
      if (pid === undefined || process.platform === "win32") {
        return;
      }
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // already exited
        }
      }
      setTimeout(() => {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            // already exited
          }
        }
      }, 1_000).unref();
    };
    const finish = (result: TextDiscoveryResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(forceCommandTimer);
      if (closeTimer) {
        clearTimeout(closeTimer);
      }
      killPtyTree();
      resolve(result);
    };
    const sendModelCommand = () => {
      if (sentModelCommand || !ptyProcess) {
        return;
      }
      sentModelCommand = true;
      ptyProcess.write("/model\r");
    };
    const timeoutTimer = setTimeout(() => {
      const parsed = parseGeminiModelUsageOutput(output);
      finish(
        parsed.windows.length > 0
          ? { output, error: null }
          : { output: null, error: `${basename(resolvedBin)} /model timed out before Model usage appeared.` },
      );
    }, timeoutMs);
    const forceCommandTimer = setTimeout(sendModelCommand, 2500);
    try {
      ptyProcess = pty.spawn(launch.command, [...launch.args], {
        name: "xterm-256color",
        cols: 220,
        rows: 45,
        cwd,
        env: process.env,
      });
    } catch (error) {
      finish({ output: null, error: `${basename(resolvedBin)} /model failed: ${errorMessage(error)}` });
      return;
    }
    ptyProcess.onData((chunk) => {
      output = appendLimitedText(output, chunk, DISCOVERY_OUTPUT_LIMIT_CHARS);
      const clean = stripTerminalAnsi(output);
      if (!sentModelCommand && /(?:^|\n)\s*>\s*$/.test(clean)) {
        sendModelCommand();
      }
      if (sentModelCommand && /Model usage/i.test(clean) && /\(Press Esc to close\)/i.test(clean)) {
        ptyProcess?.write("\x1b");
        closeTimer ??= setTimeout(() => finish({ output, error: null }), 500);
      }
    });
    ptyProcess.onExit(() => {
      const parsed = parseGeminiModelUsageOutput(output);
      finish(parsed.windows.length > 0 ? { output, error: null } : { output: null, error: `${basename(resolvedBin)} /model exited before Model usage appeared.` });
    });
  });
}

function recordAgentRateLimitSnapshot(agent: string, snapshot: Pick<AgentRateLimit, "plan" | "windows">): void {
  const acc = limitAccumulator(agent);
  acc.plan = snapshot.plan;
  for (const window of snapshot.windows) {
    upsertLimitWindow(agent, window);
  }
  acc.updatedAt = Date.now();
  persistAgentLimits();
}

async function refreshClaudeRateLimitsFromCli(): Promise<void> {
  const credentials = readClaudeOAuthCredentials();
  const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      Accept: "application/json",
      "User-Agent": "rlab-agent-limits",
    },
  });
  if (!response.ok) {
    throw new Error(`Claude OAuth usage request failed with HTTP ${response.status}.`);
  }
  const payload = (await response.json()) as unknown;
  const snapshot = parseClaudeOAuthUsagePayload(payload, credentials);
  if (snapshot.windows.length === 0) {
    throw new Error("Claude OAuth usage response did not contain rate-limit windows.");
  }
  recordAgentRateLimitSnapshot("claude-code", snapshot);
}

async function refreshGeminiRateLimitsFromCli(): Promise<void> {
  const resolvedBin = resolveBinOnPath("gemini");
  if (!resolvedBin) {
    throw new Error("gemini is not installed on this machine.");
  }
  const output = await runGeminiModelUsagePtyAsync(resolvedBin, process.cwd());
  if (output.error) {
    throw new Error(output.error);
  }
  const snapshot = parseGeminiModelUsageOutput(output.output ?? "");
  if (snapshot.windows.length === 0) {
    throw new Error("Gemini /model output did not contain model usage rows.");
  }
  recordAgentRateLimitSnapshot("gemini", snapshot);
}

async function refreshCodexRateLimitsFromAppServer(): Promise<void> {
  const resolvedBin = resolveBinOnPath("codex", process.env.PATH ?? "");
  if (!resolvedBin) {
    throw new Error("codex is not installed on this machine.");
  }

  const child = spawnResolvedBin(
    resolvedBin,
    ["app-server"],
    agentProcessSpawnOptions({
      cwd: process.cwd(),
      env: { ...process.env, ...readAgentSecretConfig().env, NODE_NO_WARNINGS: "1", NO_COLOR: "1", RUST_LOG: "error" },
      stdio: ["pipe", "pipe", "pipe"],
    }),
  );

  let settled = false;
  let nextId = 0;
  let stdoutBuffer = "";
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  const timeout = setTimeout(() => {
    if (!settled) {
      settled = true;
      for (const { reject } of pending.values()) {
        reject(new Error("codex app-server rate-limit refresh timed out."));
      }
      pending.clear();
      terminateAgentProcessTree(child);
    }
  }, CODEX_APP_SERVER_TIMEOUT_MS);

  const writeMessage = (message: Record<string, unknown>): void => {
    if (child.stdin && !child.stdin.destroyed) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }
  };
  const sendRequest = (method: string, params: Record<string, unknown> | undefined): Promise<Record<string, unknown>> => {
    const id = ++nextId;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      writeMessage({ jsonrpc: "2.0", id, method, params });
    });
  };

  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString("utf8");
    let newline: number;
    while ((newline = stdoutBuffer.indexOf("\n")) >= 0) {
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line) {
        continue;
      }
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isRecord(message) || message.id === undefined || (message.result === undefined && message.error === undefined)) {
        continue;
      }
      const id = typeof message.id === "number" ? message.id : Number(message.id);
      const entry = pending.get(id);
      if (!entry) {
        continue;
      }
      pending.delete(id);
      if (message.error !== undefined) {
        entry.reject(new Error(errorText(isRecord(message.error) ? message.error.message ?? message.error : message.error)));
      } else {
        entry.resolve(isRecord(message.result) ? message.result : {});
      }
    }
  });

  child.on("exit", () => {
    if (settled) {
      return;
    }
    settled = true;
    for (const { reject } of pending.values()) {
      reject(new Error("codex app-server exited during rate-limit refresh."));
    }
    pending.clear();
  });

  try {
    await sendRequest("initialize", {
      clientInfo: { name: "rlab", title: null, version: "0.1.0" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    writeMessage({ jsonrpc: "2.0", method: "initialized" });
    const result = await sendRequest("account/rateLimits/read", undefined);
    if (!isRecord(result.rateLimits)) {
      throw new Error("Codex account/rateLimits/read did not return rateLimits.");
    }
    recordCodexRateLimit("codex", result.rateLimits);
    const snapshot = serializeAgentLimit(limitAccumulator("codex"));
    if (snapshot.windows.length === 0) {
      throw new Error("Codex account/rateLimits/read did not contain rate-limit windows.");
    }
  } finally {
    clearTimeout(timeout);
    settled = true;
    for (const { reject } of pending.values()) {
      reject(new Error("codex app-server rate-limit refresh stopped."));
    }
    pending.clear();
    if (child.exitCode === null) {
      terminateAgentProcessTree(child);
    }
  }
}

async function refreshAgentLimitsFromCli(agent: string): Promise<void> {
  if (agent === "claude-code") {
    await refreshClaudeRateLimitsFromCli();
    return;
  }
  if (agent === "codex") {
    await refreshCodexRateLimitsFromAppServer();
    return;
  }
  if (agent === "gemini") {
    await refreshGeminiRateLimitsFromCli();
    return;
  }
  throw new Error(`${agent} does not expose an on-demand CLI rate-limit refresh.`);
}

async function refreshAgentLimitsIfDue(agent: string): Promise<string | undefined> {
  const now = Date.now();
  const previous = agentLimitRefreshAttempts.get(agent);
  if (previous && now - previous.attemptedAt < AGENT_LIMIT_REFRESH_MIN_INTERVAL_MS) {
    return previous.error;
  }
  agentLimitRefreshAttempts.set(agent, { attemptedAt: now });
  try {
    await refreshAgentLimitsFromCli(agent);
    agentLimitRefreshAttempts.set(agent, { attemptedAt: Date.now() });
    return undefined;
  } catch (error) {
    const message = errorMessage(error);
    agentLimitRefreshAttempts.set(agent, { attemptedAt: Date.now(), error: message });
    return message;
  }
}

/** Map one Codex window (`primary`/`secondary` of a RateLimitSnapshot) into our
 *  model. Codex describes windows by duration: ~300min = 5-hour, ~10080min =
 *  weekly. When the duration is absent we fall back to the slot (primary→5h). */
function recordCodexRateLimitWindow(agent: string, slot: "primary" | "secondary", raw: unknown): void {
  if (!isRecord(raw)) {
    return;
  }
  const mins = typeof raw.windowDurationMins === "number" ? raw.windowDurationMins : undefined;
  const kind: RateLimitWindowKind =
    mins !== undefined ? (mins <= 360 ? "five_hour" : "weekly") : slot === "primary" ? "five_hour" : "weekly";
  upsertLimitWindow(agent, {
    kind,
    usedPercent: typeof raw.usedPercent === "number" ? raw.usedPercent : undefined,
    resetsAt: typeof raw.resetsAt === "number" ? raw.resetsAt : undefined,
  });
}

/** Record a Codex `RateLimitSnapshot` (from `account/rateLimits/read` or a
 *  rolling `account/rateLimits/updated` notification). */
function recordCodexRateLimit(agent: string, snapshot: Record<string, unknown>): void {
  recordCodexRateLimitWindow(agent, "primary", snapshot.primary);
  recordCodexRateLimitWindow(agent, "secondary", snapshot.secondary);
  const plan = typeof snapshot.planType === "string" ? snapshot.planType : undefined;
  if (plan) {
    limitAccumulator(agent).plan = plan;
  }
}

interface RunArgsRequest {
  readonly prompt: string;
  readonly model?: string;
  readonly reasoning?: string;
  readonly mode?: AgentProfile["mode"];
  readonly autoConfirm?: boolean;
  readonly accessMode?: AgentAccessMode;
  readonly resume?: string;
  readonly sessionId?: string;
  readonly autoCompact?: boolean;
  readonly compactWindow?: number;
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
  readonly userMessageId: string;
  readonly agentMessageId: string;
  readonly startedAtMs?: number;
  readonly status: ConversationStatus;
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

interface BackgroundRunAccumulator extends RunEventAccumulator {
  agent?: AgentId;
  lastPersistedAt: number;
  persistTimer: ReturnType<typeof setTimeout> | null;
}

interface RunSpec {
  readonly bin: string;
  readonly env?: readonly string[];
  readonly args: (request: RunRequest) => string[];
  readonly createTranslator: () => (line: string) => RunEvent[];
}

const TASK_WAKEUP_TOOL_NAME = "TaskWakeup";
const CLAUDE_SAFE_READ_TOOLS = ["Read", "Glob", "Grep", "LS"] as const;
const CLAUDE_READ_ONLY_TOOLS = ["Read", "Glob", "Grep", "LS", "AskUserQuestion", TASK_WAKEUP_TOOL_NAME] as const;
const CLAUDE_EFFORT_LEVELS: ReadonlySet<EffortLevel> = new Set(["low", "medium", "high", "xhigh", "max"]);
const RLAB_CHAT_TOOLS_PROMPT = [
  "When you need user input that blocks progress, use the AskUserQuestion tool instead of asking as plain text.",
  "Use AskUserQuestion for concrete choices, clarifying questions, or option selection that the chat UI should render as interactive controls.",
  "Do not create a numbered question list in prose when the question can be represented with AskUserQuestion options.",
  "When you need rlab to wake you later in this same chat for an automation task, use TaskWakeup with the exact follow-up prompt; rlab persists and fires that wakeup server-side.",
  "Use TaskWakeup instead of sleeping, polling inside the agent, or keeping the turn open. After TaskWakeup succeeds, finish the current turn and wait for rlab to re-run you.",
  "TaskWakeup supports delaySeconds/fireAt/cron for time wakeups and script plus intervalSeconds or cron for condition wakeups; the script runs server-side in the project cwd, exit code 0 fires the wakeup, and non-zero exit codes keep polling.",
  "For condition wakeups, write a deterministic shell script in the TaskWakeup input: { prompt, script, intervalSeconds, reason } or { prompt, script, cron, reason }. Do not describe the script in prose instead of calling the tool.",
  "To cancel task wakeups in this chat, call TaskWakeup with action=\"cancel\" and either wakeupId/id or all=true.",
].join("\n");
const CLAUDE_CHAT_UI_SYSTEM_PROMPT = RLAB_CHAT_TOOLS_PROMPT;
interface CodexDynamicToolSpec {
  readonly namespace?: string;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly deferLoading?: boolean;
}

interface RlabPluginLink {
  readonly id: string;
  readonly label: string;
  readonly token: string;
}

const CODEX_RLAB_DYNAMIC_TOOLS: readonly CodexDynamicToolSpec[] = [
  {
    name: TASK_WAKEUP_TOOL_NAME,
    description:
      "Set or cancel a server-side task wakeup in the current rlab chat. To set a wakeup, provide prompt plus delaySeconds, fireAt, cron, or script with intervalSeconds/cron. To cancel, provide action='cancel' plus wakeupId/id or all=true. The script is syntax-checked before acceptance, runs server-side in the project cwd, exit code 0 fires the wakeup, and non-zero keeps polling.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: ["schedule", "cancel"],
          description: "Use 'schedule' or omit for a new wakeup. Use 'cancel' to remove scheduled wakeups.",
        },
        prompt: {
          type: "string",
          description: "Exact follow-up prompt rlab should send when the wakeup fires.",
        },
        reason: {
          type: "string",
          description: "Short human-readable reason shown in audit/status surfaces.",
        },
        delaySeconds: {
          type: "number",
          minimum: 1,
          description: "Wake up after this many seconds.",
        },
        fireAt: {
          type: "string",
          description: "Absolute wakeup time, preferably ISO 8601.",
        },
        cron: {
          type: "string",
          description: "Cron expression for the next wakeup/check. Supports 5-field and 6-field cron expressions.",
        },
        script: {
          type: "string",
          description: "Deterministic shell script to poll in the project cwd. rlab validates shell syntax before accepting it. Exit 0 fires the wakeup; non-zero keeps polling.",
        },
        intervalSeconds: {
          type: "number",
          minimum: 1,
          description: "Polling interval for script wakeups. Use either intervalSeconds or cron with script.",
        },
        wakeupId: {
          type: "string",
          description: "Specific wakeup id to cancel.",
        },
        id: {
          type: "string",
          description: "Alias for wakeupId when cancelling.",
        },
        all: {
          type: "boolean",
          description: "Cancel all wakeups for this chat when action is 'cancel'.",
        },
      },
    },
  },
];

export function codexRlabDynamicTools(): readonly CodexDynamicToolSpec[] {
  return CODEX_RLAB_DYNAMIC_TOOLS;
}

function registeredRlabPluginLinks(): readonly RlabPluginLink[] {
  return [
    { id: "AskUserQuestion", label: "AskUserQuestion", token: "$AskUserQuestion" },
    ...CODEX_RLAB_DYNAMIC_TOOLS.map((tool) => ({ id: tool.name, label: tool.name, token: `$${tool.name}` })),
    { id: "BrowserPreview", label: "BrowserPreview", token: "$BrowserPreview" },
  ];
}

const CODEX_PLAN_PROMPT_PREFIX = [
  "Plan mode is active.",
  "Do not modify files or run commands that write to the filesystem.",
  "Inspect the workspace as needed, then respond with a concise implementation plan.",
  "",
].join("\n");

const GEMINI_PLAN_PROMPT_PREFIX = [
  "Plan mode is active.",
  "Do not modify files or run commands that write to the filesystem.",
  "Inspect the workspace as needed, then respond with a concise implementation plan.",
  "",
].join("\n");

function firstForwardedHeaderValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const first = raw?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : undefined;
}

function envBrowserBridgeOrigin(): string | undefined {
  const raw = process.env.RLAB_BROWSER_BRIDGE_ORIGIN?.trim();
  if (!raw) {
    return undefined;
  }
  const parsed = new URL(raw);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("RLAB_BROWSER_BRIDGE_ORIGIN must be an http(s) URL.");
  }
  return parsed.toString().replace(/\/+$/g, "");
}

function isLoopbackHost(host: string): boolean {
  const hostname = host.replace(/^\[/, "").replace(/\](:\d+)?$/, "").replace(/:\d+$/, "");
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function browserBridgeOrigin(req: IncomingMessage): string {
  const configured = envBrowserBridgeOrigin();
  if (configured) {
    return configured;
  }
  const host = firstForwardedHeaderValue(req.headers.host) ?? new URL(DEFAULT_BROWSER_BRIDGE_ORIGIN).host;
  if (isLoopbackHost(host)) {
    return `http://${host}`;
  }
  const forwardedProto = firstForwardedHeaderValue(req.headers["x-forwarded-proto"]);
  const protocol = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : "http";
  return `${protocol}://${host}`;
}

function browserBridgePromptAppendix(sessionId: string, origin: string): string {
  return [
    "",
    "<browser-preview-bridge>",
    "The app's Preview tab is a native iframe for the user and a Playwright mirror for you. Browser actions sent through this bridge are mirrored into the user's Preview tab so the user can open Preview later and see the current browser state without a manual sync.",
    "Use the bridge only when the task asks you to inspect or operate the in-app browser.",
    `Base URL: ${origin}`,
    `sessionId: ${sessionId}`,
    `Snapshot: GET ${origin}/api/browser/bridge/snapshot?sessionId=${encodeURIComponent(sessionId)}`,
    `Action: POST ${origin}/api/browser/bridge/action with JSON {"sessionId":"${sessionId}","type":"..."}.`,
    "Always read snapshot.domTargets first and choose typed actions from DOM targets before coordinates. If the snapshot URL is about:blank or domTargets is empty, navigate to the needed URL first, then read the snapshot again.",
    "Freshness contract: snapshot.freshness is synced, dirty, blocked, syncing, or error. The server automatically resynchronizes dirty/blocked mirrors when it has a Preview URL. If an action returns actionResult.ok=false, read actionResult.error, refresh the snapshot, and report the exact bridge state if it still cannot continue.",
    "Preferred action order: fill, check, uncheck, select, click, press, scroll, wait-for. Use type only to append text. Use x/y coordinates only for canvas or custom widgets without a DOM target.",
    "Tabs: use snapshot.activeTabId and snapshot.tabs. Use select-tab before intentionally working in a non-active tab; include tabId only for that explicit tab.",
    "Supported actions: navigate, go-back, go-forward, refresh, scroll, click, fill, clear, check, uncheck, select, wait-for, hover, type, press, eval, select-tab.",
    "Example fill: {\"sessionId\":\"...\",\"type\":\"fill\",\"target\":{\"selector\":\"textarea\"},\"text\":\"hello\"}.",
    "Example wait: {\"sessionId\":\"...\",\"type\":\"wait-for\",\"target\":{\"role\":\"button\",\"name\":\"Save\"},\"state\":\"visible\"}.",
    "</browser-preview-bridge>",
  ].join("\n");
}

function rlabChatToolsPromptAppendix(): string {
  return [
    "",
    "<rlab-chat-tools>",
    "This rlab chat has server-side tools that are handled by the application, not by the user's project.",
    RLAB_CHAT_TOOLS_PROMPT,
    "Tool names accepted by rlab for task wakeups: TaskWakeup.",
    "</rlab-chat-tools>",
  ].join("\n");
}

export function appendRlabChatToolsPrompt(prompt: string): string {
  return prompt.includes("<rlab-chat-tools>") ? prompt : `${prompt}${rlabChatToolsPromptAppendix()}`;
}

function appendBrowserBridgePrompt(prompt: string, binding: BackgroundRunBinding | null, origin: string): string {
  return binding ? `${prompt}${browserBridgePromptAppendix(binding.conversationId, origin)}` : prompt;
}

export function prepareAgentPrompt(prompt: string, binding: BackgroundRunBinding | null, origin: string): string {
  return appendBrowserBridgePrompt(appendRlabChatToolsPrompt(prompt), binding, origin);
}

function profileForArgs(agent: AgentProfile["agent"], request: RunArgsRequest): AgentProfile {
  return normalizeAgentProfile(
    {
      agent,
      model: request.model ?? "default",
      reasoning: request.reasoning ?? "default",
      mode: request.mode ?? "default",
      autoConfirm: request.autoConfirm,
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

function geminiPromptForMode(prompt: string, mode: string | undefined): string {
  return mode === "plan" ? `${GEMINI_PLAN_PROMPT_PREFIX}${prompt}` : prompt;
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
    return "unrestricted";
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
  readonly autoConfirm: boolean | undefined;
  readonly autoCompact: boolean | undefined;
  readonly compactWindow: number | undefined;
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
  let accessMode: AgentAccessMode = "unrestricted";
  let accessModeValid = true;
  let profileValid = true;
  let profileError = "";
  let binding: BackgroundRunBinding | null = null;
  let bindingInvalid = false;
  let autoConfirm: boolean | undefined;
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
  autoConfirm = typeof parsed.autoConfirm === "boolean" ? parsed.autoConfirm : undefined;
  const autoCompact = typeof parsed.autoCompact === "boolean" ? parsed.autoCompact : undefined;
  const compactWindow =
    typeof parsed.compactWindow === "number" && Number.isFinite(parsed.compactWindow) && parsed.compactWindow > 0 ? Math.floor(parsed.compactWindow) : undefined;
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
    autoConfirm,
    autoCompact,
    compactWindow,
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
  if (request.autoConfirm || profile.autoConfirm) {
    return "auto";
  }
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

export function buildClaudeSdkOptions(
  request: RunRequest,
  cwd: string,
  abortController: AbortController,
  canUseTool: CanUseTool,
  env: NodeJS.ProcessEnv = process.env,
): ClaudeQueryOptions {
  const permissionMode = claudePermissionModeForRequest(request);
  const options: ClaudeQueryOptions = {
    abortController,
    allowedTools: [...CLAUDE_SAFE_READ_TOOLS],
    canUseTool,
    cwd,
    env,
    includePartialMessages: true,
    settings: {
      autoCompactEnabled: request.autoCompact ?? true,
      ...(typeof request.compactWindow === "number" && request.compactWindow > 0 ? { autoCompactWindow: request.compactWindow } : {}),
    },
    permissionMode,
    systemPrompt: { type: "preset", preset: "claude_code", append: CLAUDE_CHAT_UI_SYSTEM_PROMPT },
    tools: claudeToolsForRequest(request),
  };
  if (permissionMode === "bypassPermissions") {
    options.allowDangerouslySkipPermissions = true;
  }
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
  if (request.sessionId) {
    options.sessionId = request.sessionId;
  }
  if (request.resume) {
    options.resume = request.resume;
  }
  return options;
}

export function buildClaudeRunArgs(request: RunArgsRequest): string[] {
  const profile = profileForArgs("claude-code", request);
  const accessMode = request.accessMode ?? "unrestricted";
  const mode = modeForProfile(profile);
  const args = ["-p", request.prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--append-system-prompt", CLAUDE_CHAT_UI_SYSTEM_PROMPT];
  const settings: Record<string, boolean | number> = { autoCompactEnabled: request.autoCompact ?? true };
  if (typeof request.compactWindow === "number" && request.compactWindow > 0) {
    settings.autoCompactWindow = request.compactWindow;
  }
  args.push("--settings", JSON.stringify(settings));
  const model = modelForProfile(profile);
  if (model) {
    args.push("--model", model);
  }
  const effort = asClaudeEffort(reasoningForProfile(profile));
  if (effort) {
    args.push("--effort", effort);
  }
  const agentName = claudeAgentNameFromMode(mode ?? "");
  if (agentName) {
    args.push("--agent", agentName);
  }
  if (accessMode === "read-only" || mode === "plan") {
    args.push("--permission-mode", "plan", "--tools", CLAUDE_READ_ONLY_TOOLS.join(","));
  } else if (request.autoConfirm || profile.autoConfirm) {
    args.push("--permission-mode", "auto");
  } else if (accessMode === "unrestricted") {
    args.push("--dangerously-skip-permissions");
  }
  if (request.sessionId) {
    args.push("--session-id", request.sessionId);
  }
  if (request.resume) {
    args.push("--resume", request.resume);
  }
  return args;
}

export function buildCodexRunArgs(request: RunArgsRequest): string[] {
  const profile = profileForArgs("codex", request);
  const accessMode = request.accessMode ?? "unrestricted";
  const mode = modeForProfile(profile);
  const planMode = mode === "plan";
  const reviewMode = mode === "review";
  // Resume a prior session continues it: `codex exec resume <id> [flags] <prompt>`.
  const args = request.resume ? ["exec", "resume", request.resume, "--json"] : reviewMode ? ["exec", "review", "--json"] : ["exec", "--json"];
  if (planMode) {
    args.push("--sandbox", "read-only");
  } else if (accessMode === "unrestricted") {
    args.push("--sandbox", "danger-full-access");
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

function geminiApprovalModeForRequest(profile: AgentProfile, accessMode: AgentAccessMode, autoConfirm = false): string {
  const mode = modeForProfile(profile);
  if (accessMode !== "unrestricted") {
    return "plan";
  }
  if (mode === "plan") {
    return "plan";
  }
  return autoConfirm || profile.autoConfirm ? "auto_edit" : "yolo";
}

export function buildGeminiRunArgs(request: RunArgsRequest): string[] {
  const profile = profileForArgs("gemini", request);
  const accessMode = request.accessMode ?? "unrestricted";
  const mode = modeForProfile(profile);
  const args = [
    "--prompt",
    geminiPromptForMode(request.prompt, mode),
    "--output-format",
    "stream-json",
    "--approval-mode",
    geminiApprovalModeForRequest(profile, accessMode, request.autoConfirm),
    "--skip-trust",
  ];
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
  if ((request.accessMode ?? "unrestricted") === "unrestricted") {
    args.push("--dangerously-allow-all");
  } else {
    args.push("--settings-file", AMP_READ_ONLY_SETTINGS_FILE);
  }
  args.push("--execute", request.prompt, "--stream-json", "--stream-json-thinking");
  return args;
}

export function buildQwenRunArgs(request: RunArgsRequest): string[] {
  const profile = profileForArgs("qwen", request);
  const accessMode = request.accessMode ?? "unrestricted";
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
  if ((request.accessMode ?? "unrestricted") === "unrestricted") {
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
  const accessMode = request.accessMode ?? "unrestricted";
  const mode = modeForProfile(profile);
  const args = ["run", "--format", "json", "--thinking"];
  // Continue a prior session by id (opencode mints the id; we capture it from the
  // json stream and pass it back here on the next turn).
  if (request.resume) {
    args.push("--session", request.resume);
  }
  if (accessMode === "unrestricted" && mode !== "plan") {
    args.push("--dangerously-skip-permissions");
  } else if (accessMode !== "unrestricted" || mode === "plan") {
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
    return truncateAgentToolOutput(normalizeAgentToolOutput(content));
  }
  if (Array.isArray(content)) {
    return truncateAgentToolOutput(normalizeAgentToolOutput(content.map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : clip(c, 120))).join("\n")));
  }
  return truncateAgentToolOutput(normalizeAgentToolOutput(clip(content, 600)));
}

function completedReasoningText(text: string, completed: boolean): string {
  return completed && text.length > 0 && !/\s$/.test(text) ? `${text}\n` : text;
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

const scheduledWakeupTimers = new Map<string, ReturnType<typeof setTimeout>>();
let scheduledWakeupsStarted = false;
const MAX_WAKEUP_TIMER_DELAY_MS = 2_147_483_647;
const SCRIPT_WAKEUP_TIMEOUT_MS = 30_000;

function wakeupTimerDelay(targetMs: number): number {
  return Math.max(0, Math.min(MAX_WAKEUP_TIMER_DELAY_MS, targetMs - Date.now()));
}

function serverNowLabel(): string {
  return formatClock24();
}

function scheduledWakeupId(): string {
  return `wakeup-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function scheduledRunId(prefix: "run" | "u" | "a"): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function nextCronMs(expression: string, currentDate: number = Date.now()): number {
  return CronExpressionParser.parse(expression, { currentDate }).next().toDate().getTime();
}

function cronValidationError(expression: string): string | null {
  try {
    nextCronMs(expression);
    return null;
  } catch (error) {
    return errorMessage(error);
  }
}

function shellScriptSyntaxError(script: string): string | null {
  const command = process.platform === "win32" ? "bash" : "/bin/sh";
  const result = spawnSync(command, ["-n", "-c", script], { encoding: "utf8", maxBuffer: 64 * 1024 });
  if (result.error) {
    return result.error.message;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    return clip((result.stderr || result.stdout || `exit ${result.status}`).trim(), 300);
  }
  return null;
}

function persistScheduledWakeupMap(records: Iterable<ScheduledWakeupRecord>): void {
  writeScheduledWakeupRecords([...records].sort((a, b) => a.createdAtMs - b.createdAtMs));
}

function readScheduledWakeupMap(): Map<string, ScheduledWakeupRecord> {
  return new Map(readScheduledWakeupRecords().map((record) => [record.id, record]));
}

function clearScheduledWakeupTimer(id: string): void {
  const timer = scheduledWakeupTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    scheduledWakeupTimers.delete(id);
  }
}

function removeScheduledWakeupRecord(id: string): void {
  clearScheduledWakeupTimer(id);
  const records = readScheduledWakeupMap();
  if (records.delete(id)) {
    persistScheduledWakeupMap(records.values());
  }
}

function cancelScheduledWakeups(options: { readonly conversationId?: string; readonly wakeupId?: string; readonly all?: boolean }): number {
  const records = readScheduledWakeupMap();
  const removeIds: string[] = [];
  for (const record of records.values()) {
    if (options.conversationId && record.conversationId !== options.conversationId) {
      continue;
    }
    if (options.wakeupId) {
      if (record.id === options.wakeupId) {
        removeIds.push(record.id);
      }
      continue;
    }
    if (options.all) {
      removeIds.push(record.id);
    }
  }
  for (const id of removeIds) {
    clearScheduledWakeupTimer(id);
    records.delete(id);
  }
  if (removeIds.length > 0) {
    persistScheduledWakeupMap(records.values());
  }
  return removeIds.length;
}

function updateScheduledWakeupRecord(record: ScheduledWakeupRecord): void {
  const records = readScheduledWakeupMap();
  records.set(record.id, record);
  persistScheduledWakeupMap(records.values());
}

function wakeupStatusText(record: ScheduledWakeupRecord, locale: Locale): string {
  if (record.trigger.type === "time") {
    const when = formatDateTime24(new Date(record.trigger.fireAtMs));
    return locale === "ru" ? `TaskWakeup установлен · ${when}` : `TaskWakeup set · ${when}`;
  }
  if (record.trigger.type === "cron") {
    const when = formatDateTime24(new Date(record.trigger.nextFireMs));
    return locale === "ru" ? `TaskWakeup cron · ${when}` : `TaskWakeup cron · ${when}`;
  }
  const schedule = record.trigger.cron ? `cron ${record.trigger.cron}` : `каждые ${record.trigger.intervalSeconds}s`;
  const scheduleEn = record.trigger.cron ? `cron ${record.trigger.cron}` : `every ${record.trigger.intervalSeconds}s`;
  return locale === "ru" ? `TaskWakeup script установлен · ${schedule}` : `TaskWakeup script set · ${scheduleEn}`;
}

function wakeupCancelStatusText(count: number, locale: Locale): string {
  return locale === "ru" ? `TaskWakeup отменён · ${count}` : `TaskWakeup canceled · ${count}`;
}

function shellScriptLaunch(script: string): { readonly command: string; readonly args: readonly string[] } {
  return process.platform === "win32"
    ? { command: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", script] }
    : { command: "/bin/sh", args: ["-lc", script] };
}

function runWakeupScript(record: ScheduledWakeupRecord): Promise<{ readonly ok: boolean; readonly exitCode?: number; readonly error?: string }> {
  if (record.trigger.type !== "script") {
    return Promise.resolve({ ok: true });
  }
  const trigger = record.trigger;
  return new Promise((resolveScript) => {
    const launch = shellScriptLaunch(trigger.script);
    let stderr = "";
    let settled = false;
    let child: ReturnType<typeof spawn> | null = null;
    const finish = (result: { readonly ok: boolean; readonly exitCode?: number; readonly error?: string }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolveScript(result);
    };
    const timeout = setTimeout(() => {
      try {
        if (child) {
          terminateAgentProcessTree(child);
        }
      } catch {
        // already gone
      }
      finish({ ok: false, error: `script timed out after ${Math.round(SCRIPT_WAKEUP_TIMEOUT_MS / 1000)}s` });
    }, SCRIPT_WAKEUP_TIMEOUT_MS);
    try {
      child = spawn(launch.command, [...launch.args], agentProcessSpawnOptions({ cwd: record.cwd, env: { ...process.env, ...readAgentSecretConfig().env }, stdio: ["ignore", "ignore", "pipe"] }));
    } catch (error) {
      finish({ ok: false, error: errorMessage(error) });
      return;
    }
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => finish({ ok: false, error: error.message }));
    child.on("close", (code) => finish({ ok: code === 0, exitCode: code ?? undefined, error: code === 0 ? undefined : clip(stderr.trim() || `exit ${code ?? "unknown"}`, 300) }));
  });
}

function wakeupRequestWithLatestSession(record: ScheduledWakeupRecord): RunRequest {
  ensureWorkspaceDb();
  const conversation = readConversation(record.conversationId);
  const agent = isAgentId(record.request.agent) ? record.request.agent : null;
  const resume = agent ? conversation?.agentSessions?.[agent] : undefined;
  return resume ? { ...record.request, resume } : record.request;
}

async function fireScheduledWakeup(record: ScheduledWakeupRecord): Promise<void> {
  removeScheduledWakeupRecord(record.id);
  const request = wakeupRequestWithLatestSession(record);
  const runId = scheduledRunId("run");
  const userMessageTime = serverNowLabel();
  const body = {
    ...request,
    cwd: record.cwd,
    conversationId: record.conversationId,
    runId,
    userMessageId: scheduledRunId("u"),
    userMessageTime,
    agentMessageId: scheduledRunId("a"),
    agentMessageTime: userMessageTime,
  };
  appendRunAuditEvent(RUN_AUDIT_FILE, {
    type: "wakeup_fired",
    wakeupId: record.id,
    sourceRunId: record.sourceRunId,
    runId,
    conversationId: record.conversationId,
    agent: request.agent,
  });
  try {
    const response = await fetch(`${record.origin}/api/run`, {
      method: "POST",
      headers: { "Content-Type": JSON_CONTENT_TYPE },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${text ? ` ${clip(text, 300)}` : ""}`);
    }
    const reader = response.body?.getReader();
    if (!reader) {
      return;
    }
    for (;;) {
      const { done } = await reader.read();
      if (done) {
        break;
      }
    }
  } catch (error) {
    appendRunAuditEvent(RUN_AUDIT_FILE, {
      type: "wakeup_run_failed",
      wakeupId: record.id,
      sourceRunId: record.sourceRunId,
      conversationId: record.conversationId,
      error: errorMessage(error),
    });
  }
}

async function checkScriptWakeup(record: ScheduledWakeupRecord): Promise<void> {
  if (record.trigger.type !== "script") {
    await fireScheduledWakeup(record);
    return;
  }
  const result = await runWakeupScript(record);
  if (result.ok) {
    await fireScheduledWakeup(record);
    return;
  }
  const nextRecord: ScheduledWakeupRecord = {
    ...record,
    trigger: {
      ...record.trigger,
      nextCheckMs: record.trigger.cron ? nextCronMs(record.trigger.cron) : Date.now() + (record.trigger.intervalSeconds ?? 1) * 1000,
      lastCheckedAtMs: Date.now(),
      ...(result.exitCode === undefined ? {} : { lastExitCode: result.exitCode }),
      ...(result.error ? { lastError: result.error } : {}),
    },
  };
  updateScheduledWakeupRecord(nextRecord);
  armScheduledWakeup(nextRecord);
}

function armScheduledWakeup(record: ScheduledWakeupRecord): void {
  clearScheduledWakeupTimer(record.id);
  const target = record.trigger.type === "time" ? record.trigger.fireAtMs : record.trigger.type === "cron" ? record.trigger.nextFireMs : record.trigger.nextCheckMs;
  scheduledWakeupTimers.set(
    record.id,
    setTimeout(() => {
      scheduledWakeupTimers.delete(record.id);
      void (record.trigger.type === "script" ? checkScriptWakeup(record) : fireScheduledWakeup(record));
    }, wakeupTimerDelay(target)),
  );
}

function ensureScheduledWakeupsStarted(): void {
  if (scheduledWakeupsStarted) {
    return;
  }
  scheduledWakeupsStarted = true;
  for (const record of readScheduledWakeupRecords()) {
    armScheduledWakeup(record);
  }
}

function normalizeWakeupTrigger(event: Extract<RunEvent, { type: "wakeup" }>): ScheduledWakeupTrigger {
  const now = Date.now();
  if (event.script) {
    const scriptError = shellScriptSyntaxError(event.script);
    if (scriptError) {
      throw new Error(`TaskWakeup script syntax error: ${scriptError}`);
    }
    if (event.cron) {
      const cronError = cronValidationError(event.cron);
      if (cronError) {
        throw new Error(`Invalid TaskWakeup cron: ${cronError}`);
      }
    } else if (event.intervalSeconds === undefined || event.intervalSeconds <= 0 || !Number.isFinite(event.intervalSeconds)) {
      throw new Error("Script TaskWakeup requires positive intervalSeconds or cron.");
    }
    let initialCheckMs = event.cron ? nextCronMs(event.cron, now) : now + (event.intervalSeconds ?? 1) * 1000;
    if (event.fireAt) {
      const fireAtMs = Date.parse(event.fireAt);
      if (!Number.isFinite(fireAtMs)) {
        throw new Error(`Invalid TaskWakeup fireAt: ${event.fireAt}`);
      }
      initialCheckMs = fireAtMs;
    } else if (event.delaySeconds !== undefined) {
      if (event.delaySeconds <= 0 || !Number.isFinite(event.delaySeconds)) {
        throw new Error("delaySeconds must be positive.");
      }
      initialCheckMs = now + event.delaySeconds * 1000;
    }
    return { type: "script", script: event.script, ...(event.cron ? { cron: event.cron } : { intervalSeconds: event.intervalSeconds }), nextCheckMs: initialCheckMs };
  }
  if (event.cron) {
    const cronError = cronValidationError(event.cron);
    if (cronError) {
      throw new Error(`Invalid TaskWakeup cron: ${cronError}`);
    }
    return { type: "cron", cron: event.cron, nextFireMs: nextCronMs(event.cron, now) };
  }
  if (event.fireAt) {
    const fireAtMs = Date.parse(event.fireAt);
    if (!Number.isFinite(fireAtMs)) {
      throw new Error(`Invalid TaskWakeup fireAt: ${event.fireAt}`);
    }
    return { type: "time", fireAtMs };
  }
  if (event.delaySeconds === undefined || event.delaySeconds <= 0 || !Number.isFinite(event.delaySeconds)) {
    throw new Error("TaskWakeup requires positive delaySeconds, fireAt, cron, or script.");
  }
  return { type: "time", fireAtMs: now + event.delaySeconds * 1000 };
}

function scheduleWakeupFromRunEvent(
  event: Extract<RunEvent, { type: "wakeup" }>,
  request: RunRequest,
  cwd: string,
  origin: string,
  binding: BackgroundRunBinding | null,
): ScheduledWakeupRecord {
  if (!binding) {
    throw new Error("Wakeup scheduling requires a conversation-bound run.");
  }
  const record: ScheduledWakeupRecord = {
    id: scheduledWakeupId(),
    createdAtMs: Date.now(),
    origin,
    cwd,
    conversationId: binding.conversationId,
    sourceRunId: binding.runId,
    sourceToolId: event.toolId,
    reason: event.reason,
    trigger: normalizeWakeupTrigger(event),
    request: { ...request, prompt: event.prompt },
  };
  const records = readScheduledWakeupMap();
  records.set(record.id, record);
  persistScheduledWakeupMap(records.values());
  armScheduledWakeup(record);
  appendRunAuditEvent(RUN_AUDIT_FILE, {
    type: "wakeup_scheduled",
    wakeupId: record.id,
    sourceRunId: binding.runId,
    conversationId: binding.conversationId,
    agent: request.agent,
    trigger: record.trigger.type,
  });
  return record;
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
  // Build the update from just this run's conversation + agent message — never
  // parse the whole workspace (147+ messages) per event, or 2+ concurrent
  // streams block the event loop and surface as flickering 502s.
  ensureWorkspaceDb();
  const conversation = readConversation(binding.conversationId);
  if (!conversation) {
    return;
  }
  const update = buildActiveRunUpdate(conversation, readMessage(binding.agentMessageId), binding, done);
  for (const subscriber of handle.subscribers) {
    subscriber(update);
  }
}

function createBackgroundAccumulator(): BackgroundRunAccumulator {
  return {
    ...createRunEventAccumulator(),
    lastPersistedAt: 0,
    persistTimer: null,
  };
}

function backgroundBlocks(accumulator: BackgroundRunAccumulator): AgentBlock[] {
  return runEventBlocks(accumulator);
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

function agentBlocksPreviewSnippet(blocks: readonly AgentBlock[]): string {
  return conversationPreviewSnippet([{ id: "agent-preview", role: "agent", blocks }], 60);
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

function patchWorkspaceConversationAgentSession(state: WorkspaceState, id: string, agent: AgentId, sessionId: string): WorkspaceState {
  const conversation = workspaceConversationMap(state).get(id);
  const agentSessions: Partial<Record<AgentId, string>> = { ...(conversation?.agentSessions ?? {}), [agent]: sessionId };
  return patchWorkspaceConversation(state, id, { agentSessions, sessionId, sessionAgent: agent });
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

function threadHasEveryCurrentMessage(incomingThread: readonly ChatMessage[], currentThread: readonly ChatMessage[]): boolean {
  if (currentThread.length === 0) {
    return true;
  }
  let cursor = 0;
  for (const message of incomingThread) {
    if (message.id === currentThread[cursor]?.id) {
      cursor += 1;
      if (cursor === currentThread.length) {
        return true;
      }
    }
  }
  return false;
}

function isPrefixThreadReplacement(incomingThread: readonly ChatMessage[], currentThread: readonly ChatMessage[]): boolean {
  if (incomingThread.length === 0 || incomingThread.length >= currentThread.length) {
    return false;
  }
  return incomingThread.every((message, index) => message.id === currentThread[index]?.id);
}

function shouldPreserveCurrentThreadFromWorkspacePut(incomingThreads: WorkspaceState["threads"], current: WorkspaceState, conversationId: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(incomingThreads, conversationId)) {
    return false;
  }
  const incomingThread = incomingThreads[conversationId] ?? [];
  const currentThread = current.threads[conversationId] ?? [];
  if (currentThread.length === 0) {
    return false;
  }
  if (threadHasEveryCurrentMessage(incomingThread, currentThread) || isPrefixThreadReplacement(incomingThread, currentThread)) {
    return false;
  }
  return true;
}

function backgroundRunStartedAtMs(binding: BackgroundRunBinding): number | undefined {
  const startedAt = backgroundRunHandles.get(binding.runId)?.startedAt;
  if (!startedAt) {
    return undefined;
  }
  const time = Date.parse(startedAt);
  return Number.isNaN(time) ? undefined : time;
}

function buildActiveRunUpdate(conversation: WorkspaceConversation, agentMessage: ChatMessage | undefined, binding: BackgroundRunBinding, done: boolean): ActiveBackgroundRunUpdate {
  const blocks = agentMessage?.blocks ?? [];
  const costUsd = conversation.costUsd ?? agentMessage?.costUsd;
  const usage = conversation.usage ?? agentMessage?.usage;
  const startedAtMs = agentMessage?.startedAtMs ?? backgroundRunStartedAtMs(binding);
  return {
    runId: binding.runId,
    conversationId: binding.conversationId,
    userMessageId: binding.userMessageId,
    agentMessageId: binding.agentMessageId,
    ...(startedAtMs === undefined ? {} : { startedAtMs }),
    status: conversation.status,
    time: conversation.time,
    done,
    blocks,
    ...(costUsd === undefined ? {} : { costUsd }),
    ...(usage === undefined ? {} : { usage }),
  };
}

export function activeBackgroundRunUpdateFromState(state: WorkspaceState, binding: BackgroundRunBinding, done: boolean): ActiveBackgroundRunUpdate | null {
  const conversation = workspaceConversationMap(state).get(binding.conversationId);
  if (!conversation) {
    return null;
  }
  const agentMessage = (state.threads[binding.conversationId] ?? []).find((message) => message.id === binding.agentMessageId);
  return buildActiveRunUpdate(conversation, agentMessage, binding, done);
}

function mergeServerOwnedRunFields(incoming: WorkspaceConversation, current: WorkspaceConversation): WorkspaceConversation {
  const agentSessions: Partial<Record<AgentId, string>> = {
    ...(incoming.agentSessions ?? {}),
    ...(current.agentSessions ?? {}),
  };
  return {
    ...incoming,
    activeRunId: current.activeRunId,
    status: current.status,
    snippet: current.snippet,
    time: current.time,
    costUsd: current.costUsd,
    usage: current.usage,
    agentSessions: Object.keys(agentSessions).length > 0 ? agentSessions : undefined,
    sessionId: current.sessionId ?? incoming.sessionId,
    sessionAgent: current.sessionAgent ?? incoming.sessionAgent,
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
  for (const conversationId of incomingConversationIds) {
    if (shouldPreserveCurrentThreadFromWorkspacePut(threads, current, conversationId)) {
      threads[conversationId] = current.threads[conversationId] ?? threads[conversationId] ?? [];
    }
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

function upsertBoundAgentMessage(messages: readonly ChatMessage[], binding: BackgroundRunBinding, message: ChatMessage): ChatMessage[] {
  const existingIndex = messages.findIndex((item) => item.id === binding.agentMessageId);
  const withoutCurrent = messages.filter((item) => item.id !== binding.agentMessageId);
  const userIndex = withoutCurrent.findIndex((item) => item.id === binding.userMessageId && item.role === "user");
  if (userIndex < 0) {
    return existingIndex >= 0 ? messages.map((item) => (item.id === binding.agentMessageId ? message : item)) : [...messages, message];
  }
  const nextUserIndex = withoutCurrent.findIndex((item, index) => index > userIndex && item.role === "user");
  const staleReplyEnd = nextUserIndex < 0 ? withoutCurrent.length : nextUserIndex;
  return [...withoutCurrent.slice(0, userIndex + 1), message, ...withoutCurrent.slice(staleReplyEnd)];
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
    startedAtMs: backgroundRunStartedAtMs(binding),
    blocks: mergedBlocks,
    ...(metadata.costUsd === undefined ? {} : { costUsd: metadata.costUsd }),
    ...(metadata.usage === undefined ? {} : { usage: metadata.usage }),
  };
  return {
    ...state,
    threads: {
      ...state.threads,
      [binding.conversationId]: upsertBoundAgentMessage(messages, binding, message),
    },
  };
}

function persistBackgroundRunSnapshot(binding: BackgroundRunBinding, accumulator: BackgroundRunAccumulator): void {
  ensureWorkspaceDb();
  // Hot path: upsert ONLY the streamed message + its conversation row, never the
  // whole workspace. mergeInputBlockState preserves any interactive-block state
  // (approvals/options) the previous snapshot already recorded.
  const blocks = mergeInputBlockState(backgroundBlocks(accumulator), readMessageBlocks(binding.agentMessageId));
  const message: ChatMessage = {
    id: binding.agentMessageId,
    role: "agent",
    time: binding.agentMessageTime,
    startedAtMs: accumulator.startMs,
    blocks,
    ...(accumulator.costUsd === undefined ? {} : { costUsd: accumulator.costUsd }),
    ...(accumulator.usage === undefined ? {} : { usage: accumulator.usage }),
  };
  upsertAgentMessageForUserTurn(binding.conversationId, binding.userMessageId, message);
  const conversation = readConversation(binding.conversationId);
  if (conversation) {
    const patched = { ...conversation, ...backgroundRunStatusPatch(binding, blocks) };
    updateConversationData(
      accumulator.agent && accumulator.sessionId
        ? { ...patched, agentSessions: { ...(patched.agentSessions ?? {}), [accumulator.agent]: accumulator.sessionId }, sessionId: accumulator.sessionId, sessionAgent: accumulator.agent }
        : patched,
    );
  }
  const now = Date.now();
  accumulator.lastPersistedAt = now;
  lastBackgroundPersistAt = now;
}

function clearBackgroundRunPersistTimer(accumulator: BackgroundRunAccumulator): void {
  if (!accumulator.persistTimer) {
    return;
  }
  clearTimeout(accumulator.persistTimer);
  accumulator.persistTimer = null;
}

function persistAndNotifyBackgroundRun(binding: BackgroundRunBinding, accumulator: BackgroundRunAccumulator, done: boolean): void {
  clearBackgroundRunPersistTimer(accumulator);
  persistBackgroundRunSnapshot(binding, accumulator);
  notifyBackgroundRunUpdate(binding, done);
}

function shouldPersistBackgroundRunEventImmediately(event: RunEvent): boolean {
  if (event.type === "session") {
    return true;
  }
  if (event.type === "approval" || event.type === "options" || event.type === "error") {
    return true;
  }
  return event.type === "status" && (event.level === "warn" || event.level === "error");
}

function scheduleBackgroundRunPersist(binding: BackgroundRunBinding, accumulator: BackgroundRunAccumulator): void {
  if (accumulator.persistTimer) {
    return;
  }
  // Persists are now cheap per-row upserts, but still coalesce across runs so a
  // burst of tokens from several concurrent streams doesn't write on every tick.
  const interval = BACKGROUND_RUN_PERSIST_INTERVAL_MS;
  const since = Math.min(
    accumulator.lastPersistedAt === 0 ? interval : Date.now() - accumulator.lastPersistedAt,
    lastBackgroundPersistAt === 0 ? interval : Date.now() - lastBackgroundPersistAt,
  );
  const delay = Math.max(0, interval - since);
  accumulator.persistTimer = setTimeout(() => {
    accumulator.persistTimer = null;
    try {
      persistBackgroundRunSnapshot(binding, accumulator);
      notifyBackgroundRunUpdate(binding, false);
    } catch (error) {
      console.error(`[rlab] Failed to persist background run ${binding.runId}: ${errorMessage(error)}`);
    }
  }, delay);
}

function startBackgroundRunState(state: WorkspaceState, binding: BackgroundRunBinding, request: RunRequest, accumulator: BackgroundRunAccumulator): WorkspaceState {
  const agent = isAgentId(request.agent) ? request.agent : undefined;
  accumulator.agent = agent;
  accumulator.sessionId = request.sessionId;
  const withUserMessage = ensureBackgroundUserMessage(state, binding, request.prompt);
  const started = patchWorkspaceConversation(withUserMessage, binding.conversationId, {
    activeRunId: binding.runId,
    status: "running",
    snippet: previewSnippet(request.prompt, 60),
    time: binding.userMessageTime,
    unread: false,
    costUsd: undefined,
    usage: undefined,
  });
  const withSession = agent && request.sessionId ? patchWorkspaceConversationAgentSession(started, binding.conversationId, agent, request.sessionId) : started;
  return putBackgroundAgentMessage(withSession, binding, backgroundBlocks(accumulator));
}

/** A settings object carrying just the persisted locale (the run lifecycle only
 *  reads `settings.general.locale`), so the run start/finish never parse the
 *  whole workspace to learn it. */
function minimalLocaleSettings(): WorkspaceState["settings"] {
  const settings = cloneAppSettings(defaultAppSettings);
  return { ...settings, general: { ...settings.general, locale: cachedWorkspaceLocale } };
}

/** Write back only the ONE conversation + its (single-conversation) thread that a
 *  run-lifecycle step changed — never DELETE+INSERT every message. This is what
 *  keeps run start/finish off the event-loop-blocking full-state rewrite path. */
function persistConversationDelta(state: WorkspaceState, conversationId: string, binding?: BackgroundRunBinding): void {
  const conversation = workspaceConversationMap(state).get(conversationId);
  if (conversation) {
    updateConversationData(conversation);
  }
  for (const message of state.threads[conversationId] ?? []) {
    if (binding && message.id === binding.agentMessageId) {
      upsertAgentMessageForUserTurn(conversationId, binding.userMessageId, message);
    } else {
      upsertMessage(conversationId, message);
    }
  }
}

/** Build a minimal WorkspaceState holding just one conversation + the given
 *  messages of its thread — enough for the run-lifecycle helpers, which only
 *  touch the binding's conversation/messages and the locale. */
function minimalRunState(conversation: WorkspaceConversation | undefined, conversationId: string, messages: ChatMessage[]): WorkspaceState {
  return {
    chats: conversation ? [conversation] : [],
    projects: [],
    threads: { [conversationId]: messages },
    composerDrafts: {},
    selectedId: "",
    settings: minimalLocaleSettings(),
  };
}

function startPersistedBackgroundRun(binding: BackgroundRunBinding, request: RunRequest): BackgroundRunAccumulator {
  const accumulator = createBackgroundAccumulator();
  ensureWorkspaceDb();
  const existing = [readMessage(binding.userMessageId), readMessage(binding.agentMessageId)].filter((message): message is ChatMessage => message !== undefined);
  const minimal = minimalRunState(readConversation(binding.conversationId), binding.conversationId, existing);
  persistConversationDelta(startBackgroundRunState(minimal, binding, request, accumulator), binding.conversationId, binding);
  accumulator.lastPersistedAt = Date.now();
  return accumulator;
}

function accumulateBackgroundRunEvent(accumulator: BackgroundRunAccumulator, event: RunEvent): void {
  accumulateRunEvent(accumulator, event, { formatToolOutput: truncateAgentToolOutput });
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
): Partial<WorkspaceState["chats"][number]> {
  const base = blocksNeedInput(blocks)
    ? { status: "waiting" as const, activeRunId: binding.runId, time: binding.agentMessageTime }
    : { status: "running" as const, activeRunId: binding.runId, time: binding.agentMessageTime };
  const snippet = agentBlocksPreviewSnippet(blocks);
  return snippet ? { ...base, snippet } : base;
}

function applyBackgroundRunEvent(binding: BackgroundRunBinding, accumulator: BackgroundRunAccumulator, event: RunEvent): void {
  accumulateBackgroundRunEvent(accumulator, event);
  if (event.type === "done") {
    return;
  }
  if (shouldPersistBackgroundRunEventImmediately(event)) {
    persistAndNotifyBackgroundRun(binding, accumulator, false);
    return;
  }
  scheduleBackgroundRunPersist(binding, accumulator);
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
  const hadOutput = runEventAccumulatorHasOutput(accumulator);
  const warningOnlyFailure = accumulator.statuses.some((status) => status.level === "warn") && !hadOutput;
  const failed = hadError || warningOnlyFailure;
  const waiting = !canceled && !failed && blocksNeedInput(blocks);
  const withMessage = putBackgroundAgentMessage(state, binding, blocks, { costUsd: accumulator.costUsd, usage: accumulator.usage });
  const snippet = conversationPreviewSnippet(withMessage.threads[binding.conversationId] ?? [], 60);
  const patch = canceled
    ? { activeRunId: undefined, status: "idle" as const, snippet, time: binding.agentMessageTime }
    : failed
      ? { activeRunId: undefined, status: "error" as const, snippet, time: binding.agentMessageTime }
      : waiting
        ? { status: "waiting" as const, snippet, time: binding.agentMessageTime }
        : {
            activeRunId: undefined,
            status: "done" as const,
            snippet,
            time: binding.agentMessageTime,
            ...(accumulator.costUsd === undefined ? {} : { costUsd: accumulator.costUsd }),
            ...(accumulator.usage === undefined ? {} : { usage: accumulator.usage }),
          };
  const withConversation = patchWorkspaceConversation(
    withMessage,
    binding.conversationId,
    patch,
  );
  return accumulator.agent && accumulator.sessionId
    ? patchWorkspaceConversationAgentSession(withConversation, binding.conversationId, accumulator.agent, accumulator.sessionId)
    : withConversation;
}

function finishPersistedBackgroundRun(binding: BackgroundRunBinding, accumulator: BackgroundRunAccumulator, canceled: boolean): void {
  clearBackgroundRunPersistTimer(accumulator);
  ensureWorkspaceDb();
  const conversation = readConversation(binding.conversationId);
  if (!conversation) {
    accumulator.lastPersistedAt = Date.now();
    return;
  }
  const agentMessage = readMessage(binding.agentMessageId);
  const minimal = minimalRunState(conversation, binding.conversationId, agentMessage ? [agentMessage] : []);
  persistConversationDelta(finishBackgroundRunState(minimal, binding, accumulator, canceled), binding.conversationId, binding);
  accumulator.lastPersistedAt = Date.now();
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
  /** True once the turn has emitted any visible block (text/reasoning/tool). A
   *  successful `result` with no produced content (e.g. a `/compact` whose
   *  summary lives in the session, not a chat turn) surfaces its result text so
   *  the bubble is never left empty + perpetually "thinking". */
  producedContent?: boolean;
  readonly toolsByIndex: Map<number, StreamedTool>;
  readonly toolsById: Map<string, StreamedTool>;
  /** input + cache tokens of the most recent assistant model call = how full the
   *  context window is at the end of the turn (the per-call figure, not the
   *  turn-summed usage the result message reports). */
  lastContextTokens?: number;
  readonly usageDebug: UsageDebugEntry[];
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

function numericWakeupField(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isWakeupToolName(name: string): boolean {
  const leaf = name.split("/").at(-1)?.toLowerCase() ?? name.toLowerCase();
  return leaf === "taskwakeup" || leaf === "task_wakeup" || leaf === "rlab_task_wakeup" || leaf === "schedulewakeup" || leaf === "schedule_wakeup" || leaf === "rlab_schedule_wakeup" || leaf === "wakeup";
}

function wakeupInputValidationError(name: string, input: Record<string, unknown> | undefined): string | null {
  if (!isWakeupToolName(name)) {
    return `${name} is not a supported rlab dynamic tool.`;
  }
  if (!input) {
    return `${name} requires a JSON object input.`;
  }
  const action = firstString(input, ["action", "operation", "mode"])?.toLowerCase();
  const cancelRequested = action === "cancel" || action === "delete" || action === "remove" || input.cancel === true || input.cancelled === true || input.canceled === true;
  if (cancelRequested) {
    const wakeupId = firstString(input, ["wakeupId", "wakeup_id", "id"]);
    const target = firstString(input, ["target", "scope"])?.toLowerCase();
    const all = input.all === true || target === "all" || target === "chat";
    return wakeupId || all ? null : `${name} cancellation requires wakeupId/id or all=true.`;
  }
  const prompt = firstString(input, ["prompt", "message", "task"]);
  if (!prompt) {
    return `${name} requires a non-empty prompt.`;
  }
  const delaySeconds = numericWakeupField(input.delaySeconds ?? input.delay_seconds ?? input.delay);
  const fireAt = firstString(input, ["fireAt", "fire_at", "at", "time", "date"]);
  const cron = firstString(input, ["cron", "cronExpression", "cron_expression"]);
  const script = firstString(input, ["script", "conditionScript", "condition_script", "command"]);
  const intervalSeconds = numericWakeupField(input.intervalSeconds ?? input.interval_seconds ?? input.pollSeconds ?? input.poll_seconds);
  if (cron) {
    const cronError = cronValidationError(cron);
    if (cronError) {
      return `${name} cron is invalid: ${cronError}`;
    }
  }
  if (script) {
    const syntaxError = shellScriptSyntaxError(script);
    if (syntaxError) {
      return `${name} script syntax error: ${syntaxError}`;
    }
  }
  if (delaySeconds === undefined && !fireAt && !cron && !script) {
    return `${name} requires delaySeconds, fireAt, cron, or script.`;
  }
  if (script && intervalSeconds === undefined && !cron) {
    return `${name} script trigger requires intervalSeconds or cron.`;
  }
  return null;
}

export function codexDynamicToolCallResponse(params: Record<string, unknown>): Record<string, unknown> {
  const tool = firstString(params, ["tool"]) ?? "";
  const input = isRecord(params.arguments) ? params.arguments : undefined;
  const validationError = wakeupInputValidationError(tool, input);
  if (validationError) {
    return {
      contentItems: [{ type: "inputText", text: validationError }],
      success: false,
    };
  }
  const action = firstString(input, ["action", "operation", "mode"])?.toLowerCase();
  const cancelRequested = action === "cancel" || input?.cancel === true || input?.cancelled === true || input?.canceled === true;
  return {
    contentItems: [
      {
        type: "inputText",
        text: cancelRequested
          ? "rlab accepted the TaskWakeup cancellation. Finish this turn after reporting the cancellation."
          : "rlab accepted the TaskWakeup. Finish this turn now and wait for rlab to re-run you when it fires.",
      },
    ],
    success: true,
  };
}

function wakeupFollowupEvents(id: string, name: string, input: Record<string, unknown> | undefined, ok: boolean): RunEvent[] {
  if (!isWakeupToolName(name)) {
    return [];
  }
  if (!ok) {
    return [{ type: "error", text: `${name} failed; TaskWakeup was not set.` }];
  }
  const validationError = wakeupInputValidationError(name, input);
  if (validationError) {
    return [{ type: "error", text: validationError }];
  }
  const action = firstString(input, ["action", "operation", "mode"])?.toLowerCase();
  const cancelRequested = action === "cancel" || action === "delete" || action === "remove" || input?.cancel === true || input?.cancelled === true || input?.canceled === true;
  if (cancelRequested) {
    const wakeupId = firstString(input, ["wakeupId", "wakeup_id", "id"]);
    const target = firstString(input, ["target", "scope"])?.toLowerCase();
    const all = input?.all === true || target === "all" || target === "chat" || !wakeupId;
    return [{ type: "cancel_wakeup", toolId: id, ...(wakeupId ? { wakeupId } : {}), all, reason: firstString(input, ["reason", "description"]) }];
  }
  const prompt = firstString(input, ["prompt", "message", "task"]);
  if (!prompt) {
    return [{ type: "error", text: `${name} requires a non-empty prompt.` }];
  }
  const delaySeconds = numericWakeupField(input?.delaySeconds ?? input?.delay_seconds ?? input?.delay);
  const fireAt = firstString(input, ["fireAt", "fire_at", "at", "time", "date"]);
  const cron = firstString(input, ["cron", "cronExpression", "cron_expression"]);
  const script = firstString(input, ["script", "conditionScript", "condition_script", "command"]);
  const intervalSeconds = numericWakeupField(input?.intervalSeconds ?? input?.interval_seconds ?? input?.pollSeconds ?? input?.poll_seconds);
  return [
    {
      type: "wakeup",
      toolId: id,
      prompt,
      reason: firstString(input, ["reason", "description"]),
      ...(delaySeconds === undefined ? {} : { delaySeconds }),
      ...(fireAt ? { fireAt } : {}),
      ...(cron ? { cron } : {}),
      ...(script ? { script } : {}),
      ...(intervalSeconds === undefined ? {} : { intervalSeconds }),
    },
  ];
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
    const wakeupEvents = wakeupFollowupEvents(id, tool.name, toolInput(tool), ok);
    if (wakeupEvents.length > 0) {
      return [{ type: "tool_result", id, ok, output: resultText(output) }, ...wakeupEvents];
    }
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
    state.producedContent = true;
    return toolStartEvents(tool, state);
  }

  if (eventType !== "content_block_delta" || !isRecord(event.delta)) {
    return [];
  }

  state.sawPartialAssistantContent = true;
  const delta = event.delta;
  if (delta.type === "text_delta" && typeof delta.text === "string") {
    state.producedContent = true;
    return [{ type: "text", text: delta.text }];
  }
  if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
    state.producedContent = true;
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
  if (type === "rate_limit_event" && isRecord(msg.rate_limit_info)) {
    recordClaudeRateLimit("claude-code", msg.rate_limit_info);
    return events;
  }

  if (type === "system" && msg.subtype === "init") {
    const model = typeof msg.model === "string" ? msg.model : "agent";
    events.push({ type: "status", level: "info", text: `model · ${model}` });
    if (typeof msg.session_id === "string" && msg.session_id) {
      events.push({ type: "session", id: msg.session_id });
    }
  } else if (type === "system" && msg.subtype === "api_retry") {
    events.push({ type: "status", level: "warn", text: `api retry · ${clip(msg.error ?? msg.message ?? "retrying", 200)}` });
  } else if (type === "system" && msg.subtype === "compact_boundary") {
    // A `/compact` (manual or auto) emits only this boundary plus a result with
    // no chat turn. Mark the turn as having produced content and surface a
    // settled "ok" note, so the agent bubble settles with feedback instead of
    // hanging forever on the empty "thinking" placeholder.
    state.producedContent = true;
    const meta = isRecord(msg.compact_metadata) ? msg.compact_metadata : undefined;
    if (meta) {
      state.usageDebug.push({ source: "claude.compact_metadata", payload: meta });
    }
    const pre = meta && typeof meta.pre_tokens === "number" ? meta.pre_tokens : undefined;
    const post = meta && typeof meta.post_tokens === "number" ? meta.post_tokens : undefined;
    if (post !== undefined) {
      state.lastContextTokens = post;
    }
    const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
    const detail = pre !== undefined ? (post !== undefined ? ` · ${k(pre)} → ${k(post)} tokens` : ` · from ${k(pre)} tokens`) : "";
    events.push({ type: "status", level: "ok", text: `context compacted${detail}` });
  } else if (type === "stream_event") {
    events.push(...translateClaudeStreamEvent(msg, state));
  } else if (type === "assistant") {
    // Capture context-window fullness from this call's usage (even when partial
    // deltas already streamed the content) before the early return below.
    const message = isRecord(msg.message) ? msg.message : undefined;
    const usageRec = message && isRecord(message.usage) ? message.usage : undefined;
    if (usageRec) {
      state.usageDebug.push({ source: "claude.assistant.message.usage", payload: usageRec });
      const ctx = (firstNumber(usageRec, ["input_tokens"]) ?? 0) + (firstNumber(usageRec, ["cache_read_input_tokens"]) ?? 0) + (firstNumber(usageRec, ["cache_creation_input_tokens"]) ?? 0);
      if (ctx > 0) {
        state.lastContextTokens = ctx;
      }
    }
    if (state.sawPartialAssistantContent) {
      return events;
    }
    const content = ((msg.message as { content?: unknown[] })?.content) ?? [];
    for (const block of content as Array<Record<string, unknown>>) {
      if (block.type === "text" && typeof block.text === "string") {
        state.producedContent = true;
        events.push({ type: "text", text: block.text });
      } else if (block.type === "thinking" && typeof block.thinking === "string") {
        state.producedContent = true;
        events.push({ type: "reasoning", text: block.thinking });
      } else if (block.type === "tool_use") {
        const tool: StreamedTool = {
          id: String(block.id),
          name: String(block.name),
          input: isRecord(block.input) ? block.input : {},
          inputJson: "",
        };
        state.producedContent = true;
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
    } else if (!state.producedContent && typeof msg.result === "string" && msg.result.trim().length > 0) {
      // The turn finished without any visible block — e.g. `/compact`, whose
      // result message carries a summary/confirmation but no chat turn. Surface
      // it as an "ok" status (which the client renders) so the bubble settles
      // with feedback instead of hanging on an empty "thinking" placeholder.
      events.push({ type: "status", level: "ok", text: msg.result.trim() });
    }
    const baseUsage = runUsageFromRecord(msg.usage);
    const usage = state.lastContextTokens !== undefined ? { ...(baseUsage ?? {}), contextTokens: state.lastContextTokens } : baseUsage;
    if (msg.usage !== undefined) {
      state.usageDebug.push({ source: "claude.result.usage", payload: msg.usage });
    }
    events.push({
      type: "done",
      costUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : undefined,
      usage,
      ...(state.usageDebug.length > 0 ? { usageDebug: state.usageDebug } : {}),
    });
  }
  return events;
}

/** Translate Claude `stream-json` lines into normalized events while preserving
 * cross-line state, which is required for partial stream deltas. */
export function createClaudeStreamTranslator(): (line: string) => RunEvent[] {
  const state: ClaudeStreamState = { sawPartialAssistantContent: false, toolsByIndex: new Map(), toolsById: new Map(), usageDebug: [] };
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
  const compact: RunUsage = {
    ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
    ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
    ...(usage.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
    ...(usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: usage.cacheReadTokens }),
    ...(usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: usage.cacheWriteTokens }),
    ...(usage.contextTokens === undefined ? {} : { contextTokens: usage.contextTokens }),
  };
  return Object.keys(compact).length > 0 ? compact : undefined;
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
      output: resultText(output),
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
    return text ? [{ type: "reasoning", text: completedReasoningText(text, eventType === "item.completed") }] : [];
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
      events.push({ type: "tool_result", id: callId, ok, output: resultText(result ?? "") });
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
        return [
          {
            type: "done",
            usage: runUsageFromRecord(msg.usage),
            ...(msg.usage === undefined ? {} : { usageDebug: { source: "codex-cli.turn.completed.usage", payload: msg.usage } }),
          },
        ];
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
      events.push(...wakeupFollowupEvents(id, name, input, ok));
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
      const usagePayload = msg.stats ?? msg.usage;
      const doneEvent: Extract<RunEvent, { type: "done" }> = {
        type: "done",
        usage: runUsageFromRecord(usagePayload),
        ...(usagePayload === undefined ? {} : { usageDebug: { source: msg.stats === undefined ? "gemini.result.usage" : "gemini.result.stats", payload: usagePayload } }),
      };
      if (msg.status === "success") {
        return [doneEvent];
      }
      return [
        { type: "error", text: errorText(msg.error ?? msg.message ?? msg.status ?? "run failed") },
        doneEvent,
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
            summary: clip(
              part.description ??
                part.title ??
                part.command ??
                stateRecord?.description ??
                stateRecord?.title ??
                firstString(input ?? {}, ["command", "query", "path", "file_path", "filePath"]) ??
                name,
              80,
            ),
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
    events.push(...wakeupFollowupEvents(id, name, input, ok));
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
    events.push(...wakeupFollowupEvents(id, name, input, state === "ok"));
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
        return [
          {
            type: "done",
            costUsd: typeof part.cost === "number" ? part.cost : undefined,
            usage: runUsageFromRecord(part.tokens),
            ...(part.tokens === undefined ? {} : { usageDebug: { source: "opencode.part.step-finish.tokens", payload: part.tokens } }),
          },
        ];
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
          ...(finishPart?.tokens === undefined ? {} : { usageDebug: { source: "opencode.step_finish.tokens", payload: finishPart.tokens } }),
        },
      ];
    }
    return [];
  };
}

function setNdjsonStreamHeaders(res: ServerResponse): void {
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");
}

function startNdjsonHeartbeat(res: ServerResponse): () => void {
  let stopped = false;
  const timer = setInterval(() => {
    if (!stopped && !res.writableEnded) {
      res.write("\n");
    }
  }, STREAM_HEARTBEAT_INTERVAL_MS);
  const cleanup = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    clearInterval(timer);
  };
  res.on("close", cleanup);
  return cleanup;
}

function publicRunEvent(event: RunEvent): RunEvent {
  if (event.type !== "done" || event.usageDebug === undefined) {
    return event;
  }
  const { usageDebug: _usageDebug, ...publicEvent } = event;
  return publicEvent;
}

function createRunEventSender(res: ServerResponse): { readonly send: (event: RunEvent) => void; readonly sendDone: () => void; readonly end: () => void; readonly isClosed: () => boolean } {
  let doneSent = false;
  let closed = false;
  const stopHeartbeat = startNdjsonHeartbeat(res);
  res.on("close", () => {
    closed = true;
    stopHeartbeat();
  });
  const send = (event: RunEvent) => {
    if (event.type === "done") {
      if (doneSent) {
        return;
      }
      doneSent = true;
    }
    if (!closed && !res.writableEnded) {
      res.write(`${JSON.stringify(publicRunEvent(event))}\n`);
    }
  };
  return {
    send,
    sendDone: () => send({ type: "done" }),
    end: () => {
      stopHeartbeat();
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
    return [{ type: "error", text: errorMessage(error) }];
  }
}

async function runClaudeSdk(
  request: RunRequest,
  cwd: string,
  runEnv: NodeJS.ProcessEnv,
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
  const canUseTool = createRunApprovalHandler(send, binding?.runId, claudePermissionModeForRequest(request) === "bypassPermissions");

  try {
    for await (const message of query({ prompt: request.prompt, options: buildClaudeSdkOptions(request, cwd, abortController, canUseTool, runEnv) })) {
      if (message.type === "rate_limit_event" && isRecord(message.rate_limit_info)) {
        recordClaudeRateLimit(request.agent, message.rate_limit_info);
      }
      for (const event of translateSdkMessage(translate, message)) {
        send(event);
      }
    }
  } catch (error) {
    if (!abortController.signal.aborted) {
      send({ type: "error", text: errorMessage(error) });
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
// Heavy agentic tasks (install deps, build, start servers) routinely exceed
// 5 min and got killed mid-command before producing output — match Codex's
// 30-min ceiling so long installs/builds aren't aborted prematurely.
const OPENCODE_RUN_TIMEOUT_MS = 30 * 60_000;

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

export function emitOpenCodeParts(parts: unknown, send: (event: RunEvent) => void): number {
  if (!Array.isArray(parts)) {
    return 0;
  }
  let emitted = 0;
  for (const part of parts) {
    if (!isRecord(part)) {
      continue;
    }
    const sessionId = firstString(part, ["sessionID", "sessionId"]);
    const toolEvents = opencodeToolEvents(sessionId ? { sessionID: sessionId } : {}, part);
    if (toolEvents.length > 0) {
      for (const event of toolEvents) {
        send(event);
        emitted += 1;
      }
      continue;
    }
    if (part.type === "text") {
      const text = textFromUnknown(part.text ?? part);
      if (text.trim().length > 0) {
        send({ type: "text", text });
        emitted += 1;
      }
      continue;
    }
    if (part.type === "reasoning") {
      const text = textFromUnknown(part.text ?? part);
      if (text.trim().length > 0) {
        send({ type: "reasoning", text });
        emitted += 1;
      }
    }
  }
  return emitted;
}

function opencodeDataDir(): string {
  return process.env.OPENCODE_DATA_DIR ?? join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "opencode");
}

function readOpenCodePersistedAssistantParts(sessionId: string, startedAtMs: number): Record<string, unknown>[] {
  const dbPath = join(opencodeDataDir(), "opencode.db");
  if (!existsSync(dbPath)) {
    return [];
  }
  const db = new NodeSqliteDatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `SELECT p.data AS partData, m.data AS messageData
         FROM part p
         JOIN message m ON m.id = p.message_id
         WHERE p.session_id = ? AND p.time_created >= ?
         ORDER BY p.time_created ASC`,
      )
      .all(sessionId, Math.max(0, startedAtMs - 250));
    const parts: Record<string, unknown>[] = [];
    for (const row of rows) {
      if (!isRecord(row) || typeof row.partData !== "string" || typeof row.messageData !== "string") {
        continue;
      }
      const message = parseJsonRecord(row.messageData);
      if (message?.role !== "assistant") {
        continue;
      }
      const part = parseJsonRecord(row.partData);
      if (part) {
        parts.push(part);
      }
    }
    return parts;
  } finally {
    db.close();
  }
}

function openCodeServerErrorText(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause = error.cause;
  if (isRecord(cause)) {
    const detail = firstString(cause, ["code", "message"]);
    if (detail && !error.message.includes(detail)) {
      return `${error.message}: ${detail}`;
    }
  }
  if (cause instanceof Error && cause.message && !error.message.includes(cause.message)) {
    return `${error.message}: ${cause.message}`;
  }
  return error.message;
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
  let timedOut = false;
  const runTimeout = setTimeout(() => {
    if (!abortController.signal.aborted) {
      timedOut = true;
      abortController.abort();
    }
  }, OPENCODE_RUN_TIMEOUT_MS);
  let serverProc: ReturnType<typeof spawn> | null = null;
  let sessionId = request.resume;
  const runStartedAtMs = Date.now();
  try {
    const resolvedBin = resolveBinOnPath("opencode", process.env.PATH ?? "");
    if (!resolvedBin) {
      throw new Error("opencode is not installed (not found on PATH).");
    }
    const password = randomUUID();
    const launch = resolveLaunchCommand(resolvedBin, ["serve", "--hostname", "127.0.0.1", "--port", "0"]);
    serverProc = spawn(launch.command, [...launch.args], agentProcessSpawnOptions({
      cwd,
      env: { ...process.env, ...readAgentSecretConfig().env, OPENCODE_SERVER_USERNAME: "opencode", OPENCODE_SERVER_PASSWORD: password },
      stdio: ["ignore", "pipe", "pipe"],
    }));
    const baseUrl = await waitForOpenCodeServerUrl(serverProc, abortController.signal);
    const headers = { "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` };
    const dir = `directory=${encodeURIComponent(cwd)}`;

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
    const persistedParts = readOpenCodePersistedAssistantParts(sessionId, runStartedAtMs);
    emitOpenCodeParts(persistedParts.length > 0 ? persistedParts : parsed.parts, send);
    const info = isRecord(parsed.info) ? parsed.info : undefined;
    send({
      type: "done",
      costUsd: info && typeof info.cost === "number" ? info.cost : undefined,
      usage: info ? runUsageFromRecord(info.tokens) : undefined,
      ...(info?.tokens === undefined ? {} : { usageDebug: { source: "opencode.server.info.tokens", payload: info.tokens } }),
    });
  } catch (error) {
    let recoveredParts = 0;
    let recoveryError: string | null = null;
    if (sessionId && (timedOut || !abortController.signal.aborted)) {
      try {
        recoveredParts = emitOpenCodeParts(readOpenCodePersistedAssistantParts(sessionId, runStartedAtMs), send);
      } catch (persistedPartsError) {
        recoveryError = openCodeServerErrorText(persistedPartsError);
      }
    }
    const recoverySuffix = recoveryError ? ` Persisted OpenCode parts recovery failed: ${recoveryError}` : "";
    if (timedOut) {
      // Surface the timeout as an error in the chat — otherwise the abort
      // silently swallows it and the agent message hangs empty forever.
      const minutes = Math.round(OPENCODE_RUN_TIMEOUT_MS / 60000);
      send({
        type: "error",
        text:
          recoveredParts > 0
            ? `opencode timed out after ${minutes} min. Partial output was recovered from the OpenCode session.${recoverySuffix}`
            : `opencode timed out after ${minutes} min.${recoverySuffix}`,
      });
    } else if (!abortController.signal.aborted) {
      const text = openCodeServerErrorText(error);
      send({
        type: "error",
        text: recoveredParts > 0 ? `opencode transport failed after partial output: ${text}${recoverySuffix}` : `${text}${recoverySuffix}`,
      });
    }
  } finally {
    clearTimeout(runTimeout);
    if (serverProc) {
      try {
        terminateAgentProcessTree(serverProc);
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
    contextTokens: firstNumber(total, ["contextTokens"]),
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
      return text ? [{ type: "reasoning", text: completedReasoningText(text, completed) }] : [];
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
        events.push({ type: "tool_result", id: callId, ok, output: resultText(firstString(item, ["aggregatedOutput"]) ?? "") });
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
        events.push({ type: "tool_result", id: callId, ok, output: resultText(result ?? "") });
        const input = isRecord(item.input)
          ? item.input
          : isRecord(item.arguments)
            ? item.arguments
            : isRecord(item.args)
              ? item.args
              : isRecord(item.params)
                ? item.params
                : undefined;
        events.push(...wakeupFollowupEvents(callId, tool, input, ok));
      }
      return events;
    }
    case "dynamicToolCall": {
      const namespace = firstString(item, ["namespace"]);
      const tool = firstString(item, ["tool"]) ?? "tool";
      const callId = id ?? `codex-dynamic-${tool}`;
      const input = isRecord(item.arguments) ? item.arguments : undefined;
      const summary = firstString(input, ["prompt", "reason", "script", "fireAt", "fire_at", "command"]) ?? tool;
      const name = namespace ? `${namespace}/${tool}` : tool;
      const events: RunEvent[] = [{ type: "tool", id: callId, name, summary: clip(summary, 120), args: toArgs(input) }];
      if (completed) {
        const status = String(item.status ?? "").toLowerCase();
        const ok = status === "completed" && item.success !== false;
        const output = item.contentItems ?? item.error ?? "";
        events.push({ type: "tool_result", id: callId, ok, output: resultText(output) });
        events.push(...wakeupFollowupEvents(callId, tool, input, ok));
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

function codexCompactionConfigForRequest(request: RunRequest): Record<string, number> | undefined {
  return typeof request.compactWindow === "number" && request.compactWindow > 0
    ? { model_auto_compact_token_limit: request.compactWindow }
    : undefined;
}

/** Sandbox/approval/model/effort + plan-aware prompt for a Codex thread. */
export function buildCodexThreadParams(request: RunRequest): {
  readonly sandbox: "read-only" | "danger-full-access";
  readonly approvalPolicy: "never" | "on-request";
  readonly approvalsReviewer?: "auto_review";
  readonly model?: string;
  readonly effort?: string;
  readonly prompt: string;
  readonly config?: Record<string, number>;
  readonly dynamicTools: readonly CodexDynamicToolSpec[];
} {
  const profile = normalizeAgentProfile(request, "codex");
  const mode = modeForProfile(profile);
  const planMode = mode === "plan";
  const autoConfirm = Boolean(request.autoConfirm || profile.autoConfirm);
  const sandbox = planMode || request.accessMode !== "unrestricted" ? "read-only" : "danger-full-access";
  return {
    sandbox,
    approvalPolicy: autoConfirm && sandbox === "danger-full-access" ? "on-request" : "never",
    ...(autoConfirm && sandbox === "danger-full-access" ? { approvalsReviewer: "auto_review" as const } : {}),
    model: modelForProfile(profile),
    effort: reasoningForProfile(profile),
    prompt: codexPromptForMode(request.prompt, mode),
    config: codexCompactionConfigForRequest(request),
    dynamicTools: codexRlabDynamicTools(),
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
  let timedOut = false;
  const runTimeout = setTimeout(() => {
    if (!abortController.signal.aborted) {
      timedOut = true;
      abortController.abort();
    }
  }, CODEX_RUN_TIMEOUT_MS);

  let child: ReturnType<typeof spawn> | null = null;
  const unrestricted = request.accessMode === "unrestricted";
  const streamedText = new Set<string>();
  const streamedReasoning = new Set<string>();
  let latestUsage: RunUsage | undefined;
  const usageDebug: UsageDebugEntry[] = [];

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

  const handleServerRequest = (id: unknown, method: string, params: Record<string, unknown>): void => {
    // Most runs use approvalPolicy "never"; auto-review runs should route
    // approval requests to Codex's own reviewer. Respond defensively so a stray
    // request never deadlocks the turn.
    let result: Record<string, unknown> = {};
    if (method.endsWith("requestApproval")) {
      result = { decision: unrestricted ? "approved_for_session" : "denied" };
    } else if (method === "item/tool/requestUserInput") {
      result = { answers: {} };
    } else if (method === "item/tool/call") {
      result = codexDynamicToolCallResponse(params);
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
        if (params.tokenUsage !== undefined) {
          usageDebug.push({ source: "codex-app-server.thread/tokenUsage/updated", payload: params.tokenUsage });
        }
        return;
      }
      case "account/rateLimits/updated": {
        // Sparse rolling rate-limit update — merge into the cached snapshot.
        if (isRecord(params.rateLimits)) {
          recordCodexRateLimit(request.agent, params.rateLimits);
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
        send({ type: "done", usage: latestUsage, ...(usageDebug.length > 0 ? { usageDebug } : {}) });
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
    child = spawnResolvedBin(resolvedBin, ["app-server"], agentProcessSpawnOptions({
      cwd,
      env: { ...process.env, ...readAgentSecretConfig().env, NODE_NO_WARNINGS: "1", NO_COLOR: "1", RUST_LOG: "error" },
      stdio: ["pipe", "pipe", "pipe"],
    }));

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
        terminateAgentProcessTree(childProc);
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
          handleServerRequest(msg.id, msg.method, isRecord(msg.params) ? msg.params : {});
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
    const threadParams: Record<string, unknown> = { cwd, sandbox: params.sandbox, approvalPolicy: params.approvalPolicy, dynamicTools: params.dynamicTools };
    if (params.approvalsReviewer) {
      threadParams.approvalsReviewer = params.approvalsReviewer;
    }
    if (params.model) {
      threadParams.model = params.model;
    }
    if (params.config) {
      threadParams.config = params.config;
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
    if (params.approvalsReviewer) {
      turnParams.approvalsReviewer = params.approvalsReviewer;
    }
    if (params.effort) {
      turnParams.effort = params.effort;
    }
    await sendRequest("turn/start", turnParams);

    // Fetch the account rate limits once, fire-and-forget, so the composer has
    // 5-hour + weekly windows even before a rolling `updated` notification.
    void sendRequest("account/rateLimits/read", {})
      .then((result) => {
        if (isRecord(result.rateLimits)) {
          recordCodexRateLimit(request.agent, result.rateLimits);
        }
      })
      .catch(() => {
        // Older codex builds may not implement this method — ignore.
      });

    await turnSettled;
  } catch (error) {
    if (timedOut) {
      send({ type: "error", text: `codex timed out after ${Math.round(CODEX_RUN_TIMEOUT_MS / 60000)} min.` });
    } else if (!abortController.signal.aborted) {
      send({ type: "error", text: error instanceof Error ? error.message : String(error) });
    }
  } finally {
    clearTimeout(runTimeout);
    if (child && child.exitCode === null) {
      try {
        terminateAgentProcessTree(child);
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
          persistWorkspaceDelta(currentState, canceled.state);
          sendJson(res, 200, { runId: request.runId, canceled: true, detached: true });
          return;
        }
        sendJson(res, 404, { error: `No active run for ${request.runId}.` });
        return;
      }
      handle.cancel();
      persistWorkspaceDelta(currentState, canceled.state);
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
  ensureWorkspaceDb();
  const attachConversation = readConversation(handle.binding.conversationId);
  const initial = attachConversation ? buildActiveRunUpdate(attachConversation, readMessage(handle.binding.agentMessageId), handle.binding, false) : null;
  if (!initial) {
    sendJson(res, 409, { error: `Active run ${runId} has no persisted workspace state.` });
    return;
  }

  setNdjsonStreamHeaders(res);
  const sendUpdate = (update: ActiveBackgroundRunUpdate) => {
    if (res.writableEnded) {
      return;
    }
    res.write(`${JSON.stringify({ type: "update", update })}\n`);
  };
  let unsubscribe: (() => void) | null = null;
  let stopHeartbeat: (() => void) | null = null;
  const cleanup = () => {
    stopHeartbeat?.();
    stopHeartbeat = null;
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
  stopHeartbeat = startNdjsonHeartbeat(res);
  res.on("close", cleanup);
  res.flushHeaders();
  sendUpdate(initial);
}

function handleWakeups(req: IncomingMessage, res: ServerResponse): void {
  try {
    const params = new URL(req.url ?? "/", "http://localhost").searchParams;
    if (req.method === "DELETE") {
      const id = params.get("id")?.trim() ?? "";
      const conversationId = params.get("conversationId")?.trim() ?? "";
      if (!id) {
        sendJson(res, 400, { error: "Missing wakeup id." });
        return;
      }
      const canceled = cancelScheduledWakeups({ wakeupId: id, conversationId: conversationId || undefined });
      if (canceled === 0) {
        sendJson(res, 404, { error: "Wakeup not found." });
        return;
      }
      sendJson(res, 200, { ok: true, canceled });
      return;
    }
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end();
      return;
    }
    const conversationId = params.get("conversationId")?.trim() ?? "";
    sendJson(res, 200, { wakeups: scheduledWakeupSummaries(conversationId || undefined) });
  } catch (error) {
    sendJson(res, 500, { error: errorMessage(error) });
  }
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
    if (bodyReadError) {
      sendJson(res, jsonBodyReadErrorStatus(bodyReadError), { error: errorMessage(bodyReadError) });
      return;
    }
    const parsedPayload = parseRunRequestPayload(bodyAccumulator.body);

    if (!parsedPayload.ok) {
      sendJson(res, 400, { error: parsedPayload.error });
      return;
    }
    const { agent, model, reasoning, mode, prompt, requestedCwd, accessMode, resume, autoConfirm, autoCompact, compactWindow, accessModeValid, profileValid, profileError, bindingInvalid } = parsedPayload;
    let binding: BackgroundRunBinding | null = parsedPayload.binding;

    if (!prompt) {
      sendJson(res, 400, { error: "Empty prompt" });
      return;
    }
    if (bindingInvalid) {
      sendJson(res, 400, { error: "Invalid background run binding." });
      return;
    }
    if (!accessModeValid) {
      sendJson(res, 400, { error: "Invalid accessMode. Expected read-only or unrestricted." });
      return;
    }
    if (!profileValid) {
      sendJson(res, 400, { error: profileError });
      return;
    }

    const spec = RUN[agent];
    const usesSdkRuntime = agent === "claude-code";
    const resolvedBin = spec && !usesSdkRuntime ? resolveBinOnPath(spec.bin) : null;
    if (!spec || !isAgentId(agent)) {
      sendJson(res, 400, { error: `Running ${agent || "this agent"} is not wired yet.` });
      return;
    }
    if (!usesSdkRuntime && !resolvedBin) {
      sendJson(res, 503, { error: `${spec.bin} is not installed on this machine.` });
      return;
    }
    const requestedProfileErrorMessage = requestedProfileError(agent, model, reasoning, mode);
    if (requestedProfileErrorMessage) {
      sendJson(res, 400, { error: requestedProfileErrorMessage });
      return;
    }
    const accessModeError = validateRunAccessModeForAgent(agent, accessMode);
    if (accessModeError) {
      sendJson(res, 400, { error: accessModeError });
      return;
    }
    let origin: string;
    try {
      origin = browserBridgeOrigin(req);
    } catch (error) {
      sendJson(res, 500, { error: errorMessage(error) });
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
      sendJson(res, 503, { error: `${agent} needs setup: set one of ${spec.env.join(", ")}.` });
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
          sendJson(res, 400, { error: `Project directory does not exist: ${requestedCwd}` });
          return;
        }
        cwd = requestedCwd;
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
    try {
      mkdirSync(cwd, { recursive: true });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      return;
    }

    setNdjsonStreamHeaders(res);
    const sender = createRunEventSender(res);
    let accumulator: BackgroundRunAccumulator | null = null;
    let requestForWakeups: RunRequest | null = null;
    const send = (event: RunEvent) => {
      if (event.type === "done") {
        for (const entry of usageDebugEntries(event.usageDebug)) {
          appendRunAuditEvent(RUN_AUDIT_FILE, {
            type: "agent_usage_raw",
            agent,
            model,
            runId: binding?.runId,
            conversationId: binding?.conversationId,
            source: entry.source,
            payload: usageAuditPayload(entry.payload),
          });
        }
      }
      if (event.type === "wakeup") {
        const publicEvent: RunEvent = requestForWakeups
          ? (() => {
              try {
                const record = scheduleWakeupFromRunEvent(event, requestForWakeups, cwd, origin, binding);
                return { type: "status", level: "ok", text: wakeupStatusText(record, cachedWorkspaceLocale) };
              } catch (error) {
                return { type: "error", text: errorMessage(error) };
              }
            })()
          : { type: "error", text: "Wakeup scheduling failed: run request is not initialised." };
        sender.send(publicEvent);
        if (binding && accumulator) {
          applyBackgroundRunEvent(binding, accumulator, publicEvent);
        }
        return;
      }
      if (event.type === "cancel_wakeup") {
        const publicEvent: RunEvent = binding
          ? (() => {
              const canceled = cancelScheduledWakeups({ conversationId: binding.conversationId, wakeupId: event.wakeupId, all: event.all ?? !event.wakeupId });
              if (canceled === 0) {
                return { type: "status", level: "warn", text: cachedWorkspaceLocale === "ru" ? "Wakeup не найден." : "Wakeup not found." };
              }
              appendRunAuditEvent(RUN_AUDIT_FILE, {
                type: "wakeup_canceled",
                wakeupId: event.wakeupId,
                sourceRunId: binding.runId,
                conversationId: binding.conversationId,
                count: canceled,
                reason: event.reason,
              });
              return { type: "status", level: "ok", text: wakeupCancelStatusText(canceled, cachedWorkspaceLocale) };
            })()
          : { type: "error", text: "Wakeup cancellation requires a conversation-bound run." };
        sender.send(publicEvent);
        if (binding && accumulator) {
          applyBackgroundRunEvent(binding, accumulator, publicEvent);
        }
        return;
      }
      sender.send(event);
      if (binding && accumulator) {
        applyBackgroundRunEvent(binding, accumulator, event);
      }
    };
    const sendDone = sender.sendDone;
    const finishAndEnd = () => {
      if (binding && accumulator) {
        finishPersistedBackgroundRun(binding, accumulator, false);
      }
      sendDone();
      sender.end();
    };

    // Gemini lets us set a session id for a NEW session; assign one so the client
    // can resume it later. Claude/Codex/OpenCode mint their own and report it back
    // via a "session" event from their stream translators.
    const assignedSessionId = !resume && agent === "gemini" ? randomUUID() : undefined;
    const request: RunRequest = { agent, model, reasoning, mode, prompt, accessMode, resume, sessionId: assignedSessionId, autoConfirm, autoCompact, compactWindow };
    requestForWakeups = request;
    if (assignedSessionId) {
      send({ type: "session", id: assignedSessionId });
    }
    const executionRequest: RunRequest = {
      ...request,
      prompt: prepareAgentPrompt(request.prompt, binding, origin),
    };
    if (binding) {
      accumulator = startPersistedBackgroundRun(binding, request);
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
        autoConfirm,
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
      void runClaudeSdk(executionRequest, cwd, runEnv, res, send, sendDone, sender.end, binding, accumulator);
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

    // stdin = /dev/null so the CLI doesn't wait for piped input (it otherwise
    // stalls ~3s: "no stdin data received").
    let child: ReturnType<typeof spawn>;
    try {
      if (!resolvedBin) {
        send({ type: "error", text: `${spec.bin} is not installed on this machine.` });
        finishAndEnd();
        return;
      }
      child = spawnResolvedBin(resolvedBin, spec.args(executionRequest), agentProcessSpawnOptions({ cwd, env: runEnv, stdio: ["ignore", "pipe", "pipe"] }));
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
            terminateAgentProcessTree(child);
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
      stderr = appendLimitedText(stderr, chunk.toString("utf8"), STDERR_TAIL_LIMIT_CHARS);
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
        terminateAgentProcessTree(child);
      }
    });
  });
}

const PREVIEW_PROXY_PREFIX = "/preview-proxy";

/** Strips a `frame-ancestors` directive so a proxied page can be iframed. */
function stripFrameAncestors(csp: string): string {
  return csp
    .split(";")
    .map((directive) => directive.trim())
    .filter((directive) => directive.length > 0 && !/^frame-ancestors\b/i.test(directive))
    .join("; ");
}

/** Keeps an upstream redirect inside the proxy prefix when it points back at the
 *  proxied dev server (root-relative, or an absolute localhost URL). */
function rewritePreviewProxyLocation(location: string, port: number): string {
  if (location.startsWith(`${PREVIEW_PROXY_PREFIX}/${port}/`)) {
    return location;
  }
  if (location.startsWith("/")) {
    return `${PREVIEW_PROXY_PREFIX}/${port}${location}`;
  }
  try {
    const parsed = new URL(location);
    if (LOCALHOST_PROXY_HOSTS.has(parsed.hostname) && parsed.port === String(port)) {
      return `${PREVIEW_PROXY_PREFIX}/${port}${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // Not an absolute URL — leave it untouched.
  }
  return location;
}

const LOCALHOST_PROXY_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

/** Reverse-proxies `/preview-proxy/<port>/<path>` to `127.0.0.1:<port>` so the
 *  agent's local dev servers are reachable from the user's browser over rlab's
 *  own (same) origin — no extra firewall ports, and no mixed-content blocking
 *  when rlab itself is served over HTTPS. HTML responses get a injected <base>
 *  so root-relative... (relative) asset URLs resolve back through the proxy. */
function handlePreviewProxy(req: IncomingMessage, res: ServerResponse): void {
  const fullPath = (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? "";
  const match = /^\/preview-proxy\/(\d{1,5})(\/.*)?$/.exec(fullPath.split("?")[0] ?? "");
  if (!match) {
    sendJson(res, 400, { error: "Preview proxy path must be /preview-proxy/<port>/<path>." });
    return;
  }
  const port = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    sendJson(res, 400, { error: "Preview proxy port is out of range." });
    return;
  }
  const queryIndex = fullPath.indexOf("?");
  const search = queryIndex >= 0 ? fullPath.slice(queryIndex) : "";
  const targetPath = `${match[2] ?? "/"}${search}`;
  const basePrefix = `${PREVIEW_PROXY_PREFIX}/${port}`;

  // Point Host at the upstream so dev servers with host checks accept it, and
  // request identity encoding so HTML can be rewritten without gunzipping first.
  const headers: Record<string, string | string[] | undefined> = { ...req.headers, host: `127.0.0.1:${port}`, "accept-encoding": "identity" };

  const proxyReq = httpRequest({ host: "127.0.0.1", port, method: req.method, path: targetPath, headers }, (proxyRes) => {
    const outHeaders: Record<string, string | string[]> = { ...proxyRes.headers } as Record<string, string | string[]>;
    delete outHeaders["x-frame-options"];
    delete outHeaders["content-security-policy-report-only"];
    if (typeof outHeaders["content-security-policy"] === "string") {
      outHeaders["content-security-policy"] = stripFrameAncestors(outHeaders["content-security-policy"]);
    }
    if (typeof proxyRes.headers.location === "string") {
      outHeaders.location = rewritePreviewProxyLocation(proxyRes.headers.location, port);
    }
    const contentType = String(proxyRes.headers["content-type"] ?? "");
    if (contentType.includes("text/html")) {
      const chunks: Buffer[] = [];
      proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
      proxyRes.on("end", () => {
        let html = Buffer.concat(chunks).toString("utf8");
        if (!/<base\b/i.test(html)) {
          const baseTag = `<base href="${basePrefix}/">`;
          html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (open) => `${open}${baseTag}`) : `${baseTag}${html}`;
        }
        const body = Buffer.from(html, "utf8");
        delete outHeaders["content-length"];
        outHeaders["content-length"] = String(body.byteLength);
        res.writeHead(proxyRes.statusCode ?? 200, outHeaders);
        res.end(body);
      });
      return;
    }
    res.writeHead(proxyRes.statusCode ?? 200, outHeaders);
    proxyRes.pipe(res);
  });
  proxyReq.on("error", (error) => {
    sendJson(res, 502, { error: `Preview proxy could not reach 127.0.0.1:${port} — ${error instanceof Error ? error.message : String(error)}` });
  });
  req.pipe(proxyReq);
}

function attach(server: ViteDevServer | PreviewServer): void {
  ensureScheduledWakeupsStarted();
  if (server.httpServer && !terminalWebSocketServers.has(server.httpServer)) {
    terminalWebSocketServers.add(server.httpServer);
    attachPtyTerminalWebSockets(server.httpServer as unknown as HttpServer, terminalManager);
  }
  server.middlewares.use(PREVIEW_PROXY_PREFIX, handlePreviewProxy);
  const routes: ExactApiRoute[] = [
    {
      path: "/api/health",
      handler: methodOnly("GET", (_req, res) => {
        const health = storageHealthSnapshot();
        sendJson(res, health.storage.ok ? 200 : 500, health);
      }),
    },
    { path: "/api/browser/session", handler: methodOnly("POST", handleBrowserSession) },
    { path: "/api/browser/sync", handler: methodOnly("POST", handleBrowserSync) },
    { path: "/api/browser/dirty", handler: methodOnly("POST", handleBrowserDirty) },
    { path: "/api/browser/action", handler: methodOnly("POST", handleBrowserAction) },
    { path: "/api/browser/bridge/sync", handler: methodOnly("POST", handleBrowserBridgeSync) },
    { path: "/api/browser/bridge/action", handler: methodOnly("POST", handleBrowserBridgeAction) },
    { path: "/api/browser/bridge/snapshot", handler: methodOnly("GET", handleBrowserBridgeSnapshot) },
    { path: "/api/browser/snapshot", handler: methodOnly("GET", handleBrowserSnapshot) },
    { path: "/api/browser/events", handler: methodOnly("GET", handleBrowserEvents) },
    { path: "/api/workspace/revision", handler: methodOnly("GET", handleWorkspaceRevision) },
    { path: "/api/workspace/mutations", handler: methodOnly("POST", handleWorkspaceMutations) },
    { path: "/api/workspace", handler: handleWorkspace },
    {
      path: "/api/thread",
      handler: methodOnly("GET", (req, res) => {
        try {
          const conversationId = new URL(req.url ?? "/", "http://localhost").searchParams.get("conversationId") ?? "";
          if (!conversationId) {
            sendJson(res, 400, { error: "Missing conversationId." });
            return;
          }
          sendJson(res, 200, readClientThread(conversationId));
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      }),
    },
    {
      path: "/api/agents",
      handler: methodOnly("GET", (_req, res) => {
        void (async () => {
          try {
            sendJson(res, 200, await detectAgentsWithLiveModels());
          } catch (error) {
            sendJson(res, 500, { error: errorMessage(error) });
          }
        })();
      }),
    },
    {
      path: "/api/rlab-plugins",
      handler: methodOnly("GET", (_req, res) => {
        sendJson(res, 200, { plugins: registeredRlabPluginLinks() });
      }),
    },
    { path: "/api/agent-config", handler: handleAgentConfig },
    { path: "/api/voice-config", handler: handleVoiceConfig },
    { path: "/api/voice/transcribe", handler: methodOnly("POST", handleVoiceTranscribe) },
    { path: "/api/agent-install", handler: methodOnly("POST", handleAgentInstall) },
    { path: "/api/playwright-install", handler: methodOnly("POST", handlePlaywrightInstall) },
    { path: "/api/folder-picker", handler: methodOnly("POST", handleFolderPicker) },
    { path: "/api/list-directories", handler: methodOnly("POST", handleListDirectories) },
    { path: "/api/folder-info", handler: methodOnly("POST", handleFolderInfo) },
    { path: "/api/project-files", handler: methodOnly("POST", handleProjectFiles) },
    { path: "/api/attachments", handler: methodOnly("POST", handleAttachmentUpload) },
    { path: "/api/local-file", handler: methodOnly("GET", handleLocalFile) },
    { path: "/api/version", handler: methodOnly("GET", handleVersion) },
    { path: "/api/agent-limits", handler: methodOnly("GET", handleAgentLimits) },
    { path: "/api/cli-updates", handler: methodOnly("GET", handleCliUpdates) },
    { path: "/api/git-status", handler: methodOnly("POST", handleGitStatus) },
    { path: "/api/git-tree", handler: methodOnly("POST", handleGitTree) },
    { path: "/api/git-diff", handler: methodOnly("POST", handleGitDiff) },
    { path: "/api/git-stage", handler: methodOnly("POST", handleGitStage) },
    { path: "/api/git-unstage", handler: methodOnly("POST", handleGitUnstage) },
    { path: "/api/git-commit", handler: methodOnly("POST", handleGitCommit) },
    { path: "/api/git-checkout", handler: methodOnly("POST", handleGitCheckout) },
    { path: "/api/git-push", handler: methodOnly("POST", handleGitPush) },
    { path: "/api/git-worktree-create", handler: methodOnly("POST", handleGitWorktreeCreate) },
    { path: "/api/git-worktree-merge", handler: methodOnly("POST", handleGitWorktreeMerge) },
    { path: "/api/git-init", handler: methodOnly("POST", handleGitInit) },
    { path: "/api/terminal", handler: handleTerminalSession },
    { path: "/api/runs", handler: methodOnly("GET", handleActiveRuns) },
    { path: "/api/wakeups", handler: handleWakeups },
    { path: "/api/run-attach", handler: methodOnly("GET", handleRunAttach) },
    { path: "/api/run", handler: methodOnly("POST", handleRun) },
    { path: "/api/run-approval", handler: methodOnly("POST", handleRunApproval) },
    { path: "/api/run-cancel", handler: methodOnly("POST", handleRunCancel) },
    { path: "/api/run-input", handler: methodOnly("POST", handleRunInput) },
  ];
  attachExactApiRoutes(server, routes);
  prewarmAgentDetectionCache();
  startCliUpdateMonitor();
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
