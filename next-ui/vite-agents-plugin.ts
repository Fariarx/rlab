import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { query, type CanUseTool, type EffortLevel, type Options as ClaudeQueryOptions, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { Plugin, ViteDevServer, PreviewServer } from "vite";
import { parseGitStatusPorcelain } from "./src/lib/git-status";
import {
  cloneAppSettings,
  defaultAppSettings,
  isAgentAccessMode,
  isAppSettings,
  type AgentAccessMode,
  type Locale,
} from "./src/components/workspace/app-settings";
import { buildInitialWorkspaceState, cloneWorkspaceState, type WorkspaceState } from "./src/components/workspace/workspace-state";
import { agentProfileEquals, getAgent, isAgentId, normalizeAgentProfile, type AgentProfile } from "./src/components/agent/agents";
import {
  type AgentBlock,
  type ChatMessage,
  type CodeBlockData,
  type DiffBlock,
  type PlanBlock,
  type RunState,
  type RunUsage,
  type SearchBlock,
  type SuggestedActionsBlock,
} from "./src/components/agent/types";
import { translate } from "./src/i18n/I18nProvider";
import { pickDirectoryPathFromSystemDialog } from "../src/server/directory-picker";

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
const WORKSPACE_STATE_DIR = join(PLUGIN_DIR, ".data");
const WORKSPACE_STATE_FILE = join(WORKSPACE_STATE_DIR, "workspace-state.json");
const ATTACHMENTS_DIR = join(WORKSPACE_STATE_DIR, "attachments");
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_JSON_BODY_BYTES = 40 * 1024 * 1024;
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
}

// Keys must match AgentId in src/components/agent/agents.ts.
const DETECT: Record<string, Detect> = {
  "claude-code": { bins: ["claude"] },
  codex: { bins: ["codex"], env: ["OPENAI_API_KEY", "CODEX_API_KEY"], hasAuth: hasCodexStoredAuth },
  gemini: { bins: ["gemini"], env: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_API_KEY"], hasAuth: hasGeminiStoredAuth },
  amp: { bins: ["amp"], env: ["AMP_API_KEY"] },
  opencode: { bins: ["opencode"] },
  cursor: { bins: ["cursor-agent", "cursor"] },
  qwen: { bins: ["qwen", "qwen-code"], env: ["DASHSCOPE_API_KEY"] },
  copilot: { bins: ["copilot"] },
  droid: { bins: ["droid"], env: ["FACTORY_API_KEY"] },
};

const RUNNABLE_AGENT_IDS = new Set(["claude-code", "codex", "gemini", "opencode"]);

const INSTALL_COMMANDS: Partial<Record<string, readonly string[]>> = {
  "claude-code": ["npm", "install", "-g", "@anthropic-ai/claude-code@latest"],
  codex: ["npm", "install", "-g", "@openai/codex@latest"],
  gemini: ["npm", "install", "-g", "@google/gemini-cli@latest"],
  opencode: ["npm", "install", "-g", "opencode-ai@latest"],
};

export function installCommandForAgent(agent: string): readonly string[] | null {
  return INSTALL_COMMANDS[agent] ?? null;
}

interface AgentSecretConfig {
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

function writeAgentSecretConfig(config: AgentSecretConfig): void {
  mkdirSync(WORKSPACE_STATE_DIR, { recursive: true });
  const tempFile = `${AGENT_CONFIG_FILE}.tmp`;
  writeFileSync(tempFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  renameSync(tempFile, AGENT_CONFIG_FILE);
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

export function resolveAgentInstallLaunch(agent: string, pathValue = process.env.PATH ?? "", platform: NodeJS.Platform = process.platform): { readonly command: string; readonly args: readonly string[]; readonly displayCommand: string } | null {
  const installCommand = installCommandForAgent(agent);
  if (!installCommand) {
    return null;
  }
  const resolvedBin = resolveBinOnPath(installCommand[0], pathValue, platform);
  if (!resolvedBin) {
    return null;
  }
  return { ...resolveLaunchCommand(resolvedBin, installCommand.slice(1), platform), displayCommand: installCommand.join(" ") };
}

function spawnResolvedBin(resolvedBin: string, args: readonly string[], options: NonNullable<Parameters<typeof spawn>[2]>): ReturnType<typeof spawn> {
  const launch = resolveLaunchCommand(resolvedBin, args);
  return spawn(launch.command, launch.args, options);
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
  const chats = state.chats.map((conversation) => {
    const reconciled = reconcileConversationRun(conversation, activeRunIds, locale);
    if (reconciled !== conversation) {
      changed = true;
      staleConversationIds.add(conversation.id);
    }
    return reconciled;
  });
  const projects = state.projects.map((project) => {
    const conversations = project.conversations.map((conversation) => {
      const reconciled = reconcileConversationRun(conversation, activeRunIds, locale);
      if (reconciled !== conversation) {
        changed = true;
        staleConversationIds.add(conversation.id);
      }
      return reconciled;
    });
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
  const snippet = translate(locale, "runCanceledSnippet");
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

function readWorkspaceState(): WorkspaceState {
  if (!existsSync(WORKSPACE_STATE_FILE)) {
    const initial = normalizeSeedProjectPaths(buildInitialWorkspaceState());
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

function writeWorkspaceState(state: WorkspaceState): void {
  mkdirSync(WORKSPACE_STATE_DIR, { recursive: true });
  const tempFile = `${WORKSPACE_STATE_FILE}.tmp`;
  writeFileSync(tempFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(tempFile, WORKSPACE_STATE_FILE);
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
  res.setHeader("Content-Type", "application/json");
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
      let responded = false;
      const respond = (status: number, payload: unknown) => {
        if (responded) {
          return;
        }
        responded = true;
        sendJson(res, status, payload);
      };
      const child = spawn(launch.command, launch.args, {
        cwd: process.cwd(),
        env: process.env,
        shell: false,
        stdio: ["ignore", "ignore", "ignore"],
        windowsHide: true,
      });
      child.on("error", (error) => {
        respond(500, { error: error.message });
      });
      child.on("spawn", () => {
        respond(202, { ok: true, agent, command: launch.displayCommand });
      });
    } catch (error) {
      sendJson(res, agentInstallErrorStatus(error), { error: errorMessage(error) });
    }
  });
}

function handleRunApproval(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, res, (body) => {
    try {
      const decision = parseRunApprovalPayload(body);
      const resolved = resolvePendingRunApproval(decision);
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

      runGit(cwd, ["status", "--porcelain=v1", "-b"], (result) => {
        if (!result.ok) {
          sendJson(res, 500, { error: result.error });
          return;
        }
        sendJson(res, 200, parseGitStatusPorcelain(result.stdout));
      });
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

function sendGitStatusAfterMutation(cwd: string, res: ServerResponse): void {
  runGit(cwd, ["status", "--porcelain=v1", "-b"], (statusResult) => {
    if (!statusResult.ok) {
      sendJson(res, 500, { error: statusResult.error });
      return;
    }
    sendJson(res, 200, parseGitStatusPorcelain(statusResult.stdout));
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
}

interface RunArgsRequest {
  readonly prompt: string;
  readonly model?: string;
  readonly reasoning?: string;
  readonly mode?: AgentProfile["mode"];
  readonly accessMode?: AgentAccessMode;
}

export interface BackgroundRunBinding {
  readonly conversationId: string;
  readonly runId: string;
  readonly userMessageId: string;
  readonly userMessageTime: string;
  readonly agentMessageId: string;
  readonly agentMessageTime: string;
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

function optionValue(agent: AgentProfile["agent"], kind: "models" | "reasoning", id: string): string | undefined {
  const option = getAgent(agent)[kind].find((item) => item.id === id);
  if (!option) {
    return undefined;
  }
  return option.value;
}

function modelForProfile(profile: AgentProfile): string | undefined {
  return optionValue(profile.agent, "models", profile.model);
}

function reasoningForProfile(profile: AgentProfile): string | undefined {
  return optionValue(profile.agent, "reasoning", profile.reasoning);
}

function asClaudeEffort(value: string | undefined): EffortLevel | undefined {
  return value && CLAUDE_EFFORT_LEVELS.has(value as EffortLevel) ? (value as EffortLevel) : undefined;
}

function requestedProfileError(agent: AgentProfile["agent"], model: string, reasoning: string, mode: AgentProfile["mode"]): string | null {
  const def = getAgent(agent);
  if (!def.models.some((option) => option.id === model)) {
    return `Unknown model '${model}' for ${agent}.`;
  }
  if (!def.reasoning.some((option) => option.id === reasoning)) {
    return `Unknown reasoning '${reasoning}' for ${agent}.`;
  }
  if (!def.modes.some((option) => option.id === mode)) {
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
    mode = parsed.mode === "plan" ? "plan" : "default";
    if (parsed.mode !== undefined && parsed.mode !== "default" && parsed.mode !== "plan") {
      profileValid = false;
      profileError = "Invalid mode. Expected default or plan.";
    }
  } else if (typeof parsed.variant === "string" && isAgentId(agent)) {
    const legacyProfile = normalizeAgentProfile({ agent, variant: parsed.variant }, agent);
    model = legacyProfile.model;
    reasoning = legacyProfile.reasoning;
    mode = legacyProfile.mode;
  }
  prompt = typeof parsed.prompt === "string" ? parsed.prompt.trim() : "";
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
    accessModeValid,
    profileValid,
    profileError,
    binding,
    bindingInvalid,
  };
}

function claudePermissionModeForRequest(request: RunRequest): ClaudeQueryOptions["permissionMode"] {
  if (request.accessMode === "read-only" || request.mode === "plan") {
    return "plan";
  }
  return "default";
}

function claudeToolsForRequest(request: RunRequest): ClaudeQueryOptions["tools"] {
  if (request.accessMode === "read-only" || request.mode === "plan") {
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
  return options;
}

export function buildClaudeRunArgs(request: RunArgsRequest): string[] {
  const profile = profileForArgs("claude-code", request);
  const accessMode = request.accessMode ?? "read-only";
  const args = ["-p", request.prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
  const model = modelForProfile(profile);
  if (model) {
    args.push("--model", model);
  }
  const effort = reasoningForProfile(profile);
  if (effort) {
    args.push("--effort", effort);
  }
  args.push("--permission-mode", accessMode === "unrestricted" && profile.mode !== "plan" ? "acceptEdits" : "plan");
  return args;
}

export function buildCodexRunArgs(request: RunArgsRequest): string[] {
  const profile = profileForArgs("codex", request);
  const accessMode = request.accessMode ?? "read-only";
  const args = ["exec", "--json"];
  if (accessMode === "unrestricted") {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
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
  args.push(request.prompt);
  return args;
}

export function buildGeminiRunArgs(request: RunArgsRequest): string[] {
  const profile = profileForArgs("gemini", request);
  const accessMode = request.accessMode ?? "read-only";
  const args = ["--prompt", request.prompt, "--output-format", "stream-json", "--approval-mode", accessMode === "unrestricted" ? "yolo" : "plan", "--skip-trust"];
  const model = modelForProfile(profile);
  if (model) {
    args.push("--model", model);
  }
  return args;
}

export function buildOpenCodeRunArgs(request: RunArgsRequest): string[] {
  const profile = profileForArgs("opencode", request);
  const args = ["run", "--format", "json", "--thinking"];
  if ((request.accessMode ?? "read-only") === "unrestricted") {
    args.push("--dangerously-skip-permissions");
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

export function validateRunAccessModeForAgent(_agent: string, _accessMode: AgentAccessMode): string | null {
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
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : clip(c, 120))).join("\n");
  }
  return clip(content, 600);
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
    if (!isRecord(option) || typeof option.label !== "string" || option.label.trim().length === 0) {
      return null;
    }
    const description = typeof option.description === "string" && option.description.trim().length > 0 ? option.description : undefined;
    options.push(description ? { label: option.label, description } : { label: option.label });
  }
  return options.length > 0 ? options : null;
}

function parseAskUserQuestionInput(input: Record<string, unknown>): readonly AskUserQuestionItem[] | null {
  if (!Array.isArray(input.questions)) {
    return null;
  }
  const questions: AskUserQuestionItem[] = [];
  for (const question of input.questions) {
    if (!isRecord(question) || typeof question.question !== "string" || question.question.trim().length === 0) {
      return null;
    }
    const options = parseAskUserQuestionOptions(question.options);
    if (!options) {
      return null;
    }
    questions.push({
      question: question.question,
      multiSelect: question.multiSelect === true,
      options,
    });
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

export function createRunApprovalHandler(send: (event: RunEvent) => void, scopeId?: string): CanUseTool {
  return (toolName, input, context) => {
    if (toolName === "AskUserQuestion") {
      const inputHandler = createRunInputHandler(input, context, send, scopeId);
      if (inputHandler) {
        return inputHandler;
      }
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

const backgroundRunHandles = new Map<string, { readonly cancel: () => void }>();

function createBackgroundAccumulator(): BackgroundRunAccumulator {
  return {
    reasoning: "",
    hasReasoning: false,
    started: false,
    text: "",
    hasText: false,
    tools: [],
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
  if (accumulator.hasReasoning) {
    blocks.push({
      kind: "reasoning",
      text: accumulator.reasoning,
      active: !accumulator.done,
      duration: accumulator.done ? `${Math.max(1, Math.round((Date.now() - accumulator.start) / 1000))}s` : undefined,
    });
  } else if (accumulator.started && !accumulator.done) {
    blocks.push({ kind: "reasoning", text: "", active: true });
  }
  for (const tool of accumulator.tools) {
    blocks.push(toolToDiffBlock(tool) ?? { kind: "tool", name: tool.name, summary: tool.summary, args: tool.args, state: tool.state, output: tool.output });
  }
  blocks.push(...accumulator.diffs);
  for (const plan of accumulator.plans) {
    blocks.push({ kind: "plan", steps: plan.steps });
  }
  blocks.push(...accumulator.codes);
  for (const search of accumulator.searches) {
    blocks.push({ kind: "search", query: search.query, state: search.state, results: search.results });
  }
  blocks.push(...accumulator.suggested);
  for (const approval of accumulator.approvals) {
    blocks.push({ kind: "approval", id: approval.id, title: approval.title, detail: approval.detail });
  }
  for (const option of accumulator.options) {
    blocks.push({ kind: "options", id: option.id, prompt: option.prompt, multi: option.multi, options: option.options });
  }
  if (accumulator.hasText) {
    blocks.push({ kind: "text", text: accumulator.text, streaming: !accumulator.done });
  }
  for (const status of accumulator.statuses) {
    blocks.push({ kind: "status", level: status.level, text: status.text });
  }
  return blocks;
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
  const snippetSource = textBlock?.kind === "text" ? textBlock.text : translate(locale, "runDoneSnippet");
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

function putBackgroundAgentMessage(state: WorkspaceState, binding: BackgroundRunBinding, blocks: readonly AgentBlock[]): WorkspaceState {
  const messages = state.threads[binding.conversationId] ?? [];
  const previousBlocks = messages.find((message) => message.id === binding.agentMessageId)?.blocks;
  const mergedBlocks = mergeInputBlockState(blocks, previousBlocks);
  const message: ChatMessage = { id: binding.agentMessageId, role: "agent", time: binding.agentMessageTime, blocks: mergedBlocks };
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

function persistBackgroundBlocks(binding: BackgroundRunBinding, blocks: readonly AgentBlock[], patch: Partial<WorkspaceState["chats"][number]> = {}): void {
  const state = readWorkspaceState();
  const withMessage = putBackgroundAgentMessage(state, binding, blocks);
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
    case "reasoning":
      accumulator.started = true;
      accumulator.hasReasoning = true;
      accumulator.reasoning += event.text;
      break;
    case "text":
      accumulator.started = true;
      accumulator.hasText = true;
      accumulator.text += event.text;
      break;
    case "tool": {
      accumulator.started = true;
      const existing = accumulator.tools.find((tool) => tool.id === event.id);
      if (existing) {
        existing.name = event.name;
        existing.summary = event.summary;
        existing.args = event.args;
      } else {
        accumulator.tools.push({ id: event.id, name: event.name, summary: event.summary, args: event.args, state: "running" });
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
    case "code":
      accumulator.started = true;
      accumulator.codes.push({ kind: "code", language: event.language, code: event.code });
      break;
    case "search": {
      accumulator.started = true;
      const existing = event.id ? accumulator.searches.find((item) => item.id === event.id) : accumulator.searches.find((item) => item.query === event.query);
      if (existing) {
        existing.query = event.query;
        existing.state = event.state;
        existing.results = event.results ?? existing.results;
      } else {
        accumulator.searches.push({ id: event.id, query: event.query, state: event.state, results: event.results ?? [] });
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

function applyBackgroundRunEvent(binding: BackgroundRunBinding, accumulator: BackgroundRunAccumulator, event: RunEvent): void {
  accumulateBackgroundRunEvent(accumulator, event);
  const blocks = backgroundBlocks(accumulator);
  const locale = readWorkspaceState().settings.general.locale;
  persistBackgroundBlocks(binding, blocks, blocksNeedInput(blocks) ? { status: "waiting", snippet: translate(locale, "runNeedsInputSnippet"), time: binding.agentMessageTime } : {});
}

export function finishBackgroundRunState(state: WorkspaceState, binding: BackgroundRunBinding, accumulator: BackgroundRunAccumulator, canceled: boolean): WorkspaceState {
  accumulator.done = true;
  let blocks = backgroundBlocks(accumulator);
  const locale = state.settings.general.locale;
  if (canceled) {
    const canceledStatusBlock: AgentBlock = { kind: "status", level: "warn", text: translate(locale, "runCanceledSnippet") };
    const hasCanceledStatus = blocks.some((block) => block.kind === "status" && block.level === canceledStatusBlock.level && block.text === canceledStatusBlock.text);
    blocks = blocks.length === 0 ? [canceledStatusBlock] : hasCanceledStatus ? blocks : [...blocks, canceledStatusBlock];
  }
  const hadError = accumulator.statuses.some((status) => status.level === "error");
  const hadOutput =
    accumulator.hasText ||
    accumulator.hasReasoning ||
    accumulator.tools.length > 0 ||
    accumulator.diffs.length > 0 ||
    accumulator.plans.length > 0 ||
    accumulator.codes.length > 0 ||
    accumulator.searches.length > 0 ||
    accumulator.suggested.length > 0 ||
    accumulator.approvals.length > 0 ||
    accumulator.options.length > 0;
  const warningOnlyFailure = accumulator.statuses.some((status) => status.level === "warn") && !hadOutput;
  const failed = hadError || warningOnlyFailure;
  const waiting = !canceled && !failed && blocksNeedInput(blocks);
  const patch = canceled
    ? { activeRunId: undefined, status: "idle" as const, snippet: translate(locale, "runCanceledSnippet"), time: binding.agentMessageTime }
    : failed
      ? { activeRunId: undefined, status: "error" as const, snippet: translate(locale, "runFailedSnippet"), time: binding.agentMessageTime }
      : waiting
        ? { status: "waiting" as const, snippet: translate(locale, "runNeedsInputSnippet"), time: binding.agentMessageTime }
        : {
            activeRunId: undefined,
            status: "done" as const,
            snippet: snippetFromBlocks(blocks, locale),
            time: binding.agentMessageTime,
            ...(accumulator.costUsd === undefined ? {} : { costUsd: accumulator.costUsd }),
            ...(accumulator.usage === undefined ? {} : { usage: accumulator.usage }),
          };
  return patchWorkspaceConversation(putBackgroundAgentMessage(state, binding, blocks), binding.conversationId, patch);
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

function toolStartEvents(tool: StreamedTool, state: ClaudeStreamState): RunEvent[] {
  state.toolsById.set(tool.id, tool);
  const rich = richToolEvents(tool.id, tool.name, toolInput(tool), "running");
  return rich.length > 0 ? rich : [toolRunEvent(tool)];
}

function toolResultEvents(tool: StreamedTool | undefined, id: string, ok: boolean, output: unknown): RunEvent[] {
  if (tool) {
    const rich = richToolEvents(id, tool.name, toolInput(tool), ok ? "ok" : "error", output);
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
    cacheReadTokens: firstNumber(value, ["cacheReadTokens", "cache_read_tokens", "cachedTokens", "cached_tokens"]) ?? firstNumber(cache, ["read"]),
    cacheWriteTokens: firstNumber(value, ["cacheWriteTokens", "cache_write_tokens"]) ?? firstNumber(cache, ["write"]),
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
      output,
    },
  ];
}

interface CodexStreamState {
  readonly planTextById: Map<string, string>;
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
  const state: CodexStreamState = { planTextById: new Map() };
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
      case "turn.started":
        return [{ type: "status", level: "info", text: "codex turn started" }];
      case "agent_message": {
        const text = textFromUnknown(msg.message ?? msg.delta ?? msg);
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

export function createGeminiStreamTranslator(): (line: string) => RunEvent[] {
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
  if (typeof part.id === "string" && part.id.trim().length > 0) {
    return part.id;
  }
  if (typeof part.callID === "string" && part.callID.trim().length > 0) {
    return part.callID;
  }
  if (typeof part.toolCallID === "string" && part.toolCallID.trim().length > 0) {
    return part.toolCallID;
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

function opencodeSdkEnvelope(msg: Record<string, unknown>): Record<string, unknown> | null {
  if (msg.type === "sdk_event" && isRecord(msg.event)) {
    return msg.event;
  }
  if (msg.type === "SdkEvent" && isRecord(msg.event)) {
    return msg.event;
  }
  return null;
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
    const todoEvents = opencodeTodoEvents(msg);
    if (todoEvents.length > 0) {
      return todoEvents;
    }
    const questionEvents = opencodeQuestionEvents(msg);
    if (questionEvents.length > 0) {
      return questionEvents;
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
  let timedOut = false;
  res.on("close", () => {
    if (!binding && !abortController.signal.aborted) {
      abortController.abort();
    }
  });
  if (binding) {
    backgroundRunHandles.set(binding.runId, {
      cancel: () => {
        if (!abortController.signal.aborted) {
          abortController.abort();
        }
      },
    });
  }
  const translate = createClaudeStreamTranslator();
  const canUseTool = createRunApprovalHandler(send, binding?.runId);
  const timeout = setTimeout(() => {
    timedOut = true;
    send({ type: "error", text: "Run timed out after 120s" });
    abortController.abort();
  }, 120_000);

  try {
    for await (const message of query({ prompt: request.prompt, options: buildClaudeSdkOptions(request, cwd, abortController, canUseTool) })) {
      for (const event of translateSdkMessage(translate, message)) {
        send(event);
      }
    }
  } catch (error) {
    if (!abortController.signal.aborted) {
      send({ type: "error", text: error instanceof Error ? error.message : String(error) });
    }
  } finally {
    clearTimeout(timeout);
    if (binding && accumulator) {
      finishPersistedBackgroundRun(binding, accumulator, abortController.signal.aborted && !timedOut);
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
    const { agent, model, reasoning, mode, prompt, requestedCwd, accessMode, accessModeValid, profileValid, profileError, bindingInvalid } = parsedPayload;
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

    const request: RunRequest = { agent, model, reasoning, mode, prompt, accessMode };
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
    const runEnv = { ...process.env, ...config.env };
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

    if (agent === "claude-code") {
      void runClaudeSdk(request, cwd, res, send, sendDone, sender.end, binding, accumulator);
      return;
    }

    // stdin = /dev/null so the CLI doesn't wait for piped input (it otherwise
    // stalls ~3s: "no stdin data received").
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnResolvedBin(resolvedBin, spec.args(request), { cwd, env: runEnv, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      send({ type: "error", text: error instanceof Error ? `Failed to launch ${spec.bin}: ${error.message}` : `Failed to launch ${spec.bin}` });
      finishAndEnd();
      return;
    }
    let canceled = false;
    if (binding) {
      backgroundRunHandles.set(binding.runId, {
        cancel: () => {
          canceled = true;
          if (child.exitCode === null) {
            child.kill("SIGTERM");
          }
        },
      });
    }
    const translate = spec.createTranslator();

    const timeout = setTimeout(() => {
      send({ type: "error", text: "Run timed out after 120s" });
      child.kill("SIGTERM");
    }, 120_000);

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
            send(event);
          }
        }
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      send({ type: "error", text: `Failed to launch ${spec.bin}: ${err.message}` });
      if (binding && accumulator) {
        finishPersistedBackgroundRun(binding, accumulator, canceled);
        backgroundRunHandles.delete(binding.runId);
      }
      sendDone();
      sender.end();
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0 && stderr) {
        send({ type: "error", text: clip(stderr, 400) });
      }
      if (binding && accumulator) {
        finishPersistedBackgroundRun(binding, accumulator, canceled);
        backgroundRunHandles.delete(binding.runId);
      }
      sendDone();
      sender.end();
    });

    // Abort the child if the client disconnects. Listen on the RESPONSE, not the
    // request — `req`'s "close" fires as soon as the POST body is consumed.
    res.on("close", () => {
      clearTimeout(timeout);
      if (!binding && child.exitCode === null) {
        child.kill("SIGTERM");
      }
    });
  });
}

function attach(server: ViteDevServer | PreviewServer): void {
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
  server.middlewares.use("/api/folder-picker", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleFolderPicker(req, res);
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
