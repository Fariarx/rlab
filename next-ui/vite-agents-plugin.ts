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
import { cloneAppSettings, defaultAppSettings, isAgentAccessMode, isAppSettings, type AgentAccessMode, type Locale } from "./src/components/workspace/app-settings";
import { buildInitialWorkspaceState, cloneWorkspaceState, type WorkspaceState } from "./src/components/workspace/workspace-state";
import { agentProfileEquals, getAgent, isAgentId, normalizeAgentProfile, type AgentProfile } from "./src/components/agent/agents";
import { type AgentBlock, type ChatMessage, type RunUsage } from "./src/components/agent/types";
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

function readJsonBody(req: IncomingMessage, onDone: (body: string) => void): void {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => onDone(body));
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
  "Run failed": "Прогон упал",
  "Run canceled": "Прогон остановлен",
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
  ru: "Фоновый прогон прерван",
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

export function reconcileStaleBackgroundRuns(state: WorkspaceState, activeRunIds: ReadonlySet<string>): WorkspaceState {
  let changed = false;
  const locale = state.settings.general.locale;
  const chats = state.chats.map((conversation) => {
    const reconciled = reconcileConversationRun(conversation, activeRunIds, locale);
    changed ||= reconciled !== conversation;
    return reconciled;
  });
  const projects = state.projects.map((project) => {
    const conversations = project.conversations.map((conversation) => {
      const reconciled = reconcileConversationRun(conversation, activeRunIds, locale);
      changed ||= reconciled !== conversation;
      return reconciled;
    });
    return conversations === project.conversations ? project : { ...project, conversations };
  });
  return changed ? { ...state, chats, projects } : state;
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

function directoryName(path: string): string {
  return basename(path.replace(/[\\/]+$/g, "")) || path;
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
    readJsonBody(req, (body) => {
      try {
        const parsed = JSON.parse(body) as unknown;
        if (!isWorkspaceState(parsed)) {
          sendJson(res, 400, { error: "Invalid workspace state payload." });
          return;
        }
        const normalized = normalizeSeedProjectPaths(cloneWorkspaceState(parsed));
        writeWorkspaceState(normalized);
        sendJson(res, 200, normalized);
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
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
  readJsonBody(req, (body) => {
    try {
      const parsed = JSON.parse(body || "{}") as { path?: string };
      const path = parsed.path?.trim() ?? "";
      if (!path) {
        sendJson(res, 400, { error: "Project path is required." });
        return;
      }
      if (!existsSync(path) || !statSync(path).isDirectory()) {
        sendJson(res, 400, { error: `Project directory does not exist: ${path}` });
        return;
      }
      sendJson(res, 200, { path, name: directoryName(path) });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function handleProjectFiles(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, (body) => {
    try {
      const parsed = JSON.parse(body || "{}") as { cwd?: string };
      const cwd = parsed.cwd?.trim() ?? "";
      if (!cwd) {
        sendJson(res, 400, { error: "Project directory is required." });
        return;
      }
      if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
        sendJson(res, 400, { error: `Project directory does not exist: ${cwd}` });
        return;
      }
      sendJson(res, 200, { files: listMentionableFilesFromDisk(cwd) });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function handleAttachmentUpload(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, (body) => {
    try {
      const parsed = JSON.parse(body || "{}") as { name?: string; mimeType?: string; dataBase64?: string };
      const name = parsed.name?.trim();
      if (!name || typeof parsed.dataBase64 !== "string") {
        sendJson(res, 400, { error: "Attachment name and data are required." });
        return;
      }
      const buffer = Buffer.from(parsed.dataBase64, "base64");
      if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
        sendJson(res, 413, { error: "Attachment exceeds the 25MB limit." });
        return;
      }
      mkdirSync(ATTACHMENTS_DIR, { recursive: true });
      const safeName = name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80) || "file";
      const fileName = `${Math.random().toString(36).slice(2, 10)}-${safeName}`;
      const filePath = join(ATTACHMENTS_DIR, fileName);
      writeFileSync(filePath, buffer);
      sendJson(res, 200, { path: filePath, name, mimeType: parsed.mimeType ?? "application/octet-stream" });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
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
    readJsonBody(req, (body) => {
      try {
        const parsed = JSON.parse(body || "{}") as { agent?: string; apiKey?: string };
        const agent = parsed.agent ?? "";
        const apiKey = parsed.apiKey?.trim() ?? "";
        const envVar = DETECT[agent]?.env?.[0];
        if (!envVar) {
          sendJson(res, 400, { error: `Agent ${agent} does not accept API key configuration.` });
          return;
        }
        if (!apiKey) {
          sendJson(res, 400, { error: "API key is required." });
          return;
        }
        const config = readAgentSecretConfig();
        writeAgentSecretConfig({ env: { ...config.env, [envVar]: apiKey } });
        sendJson(res, 200, { ok: true, agent, envVar, configured: true });
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    });
    return;
  }

  res.statusCode = 405;
  res.end();
}

function handleAgentInstall(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, (body) => {
    try {
      const parsed = JSON.parse(body || "{}") as { agent?: string };
      const agent = parsed.agent ?? "";
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
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function handleRunApproval(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, (body) => {
    try {
      const decision = parseRunApprovalPayload(body);
      sendJson(res, 200, resolvePendingRunApproval(decision));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, message.startsWith("No pending approval request") ? 404 : 400, { error: message });
    }
  });
}

function handleRunInput(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, (body) => {
    try {
      const selection = parseRunInputPayload(body);
      sendJson(res, 200, resolvePendingRunInput(selection));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, message.startsWith("No pending input request") ? 404 : 400, { error: message });
    }
  });
}

function handleGitStatus(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, (body) => {
    try {
      const parsed = JSON.parse(body || "{}") as { cwd?: string };
      const cwd = parsed.cwd?.trim() ?? "";
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
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
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
  readJsonBody(req, (body) => {
    try {
      const parsed = JSON.parse(body || "{}") as { cwd?: string; path?: string; mode?: string };
      const cwd = parsed.cwd?.trim() ?? "";
      const path = parsed.path?.trim() ?? "";
      const mode = parsed.mode === "staged" ? "staged" : "worktree";
      const cwdError = validateGitCwd(cwd);
      const pathError = validateGitPath(path);
      if (cwdError || pathError) {
        sendJson(res, 400, { error: cwdError ?? pathError });
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
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function handleGitStage(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, (body) => {
    try {
      const parsed = JSON.parse(body || "{}") as { cwd?: string; path?: string };
      const cwd = parsed.cwd?.trim() ?? "";
      const path = parsed.path?.trim() ?? "";
      const cwdError = validateGitCwd(cwd);
      const pathError = validateGitPath(path);
      if (cwdError || pathError) {
        sendJson(res, 400, { error: cwdError ?? pathError });
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
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function handleGitUnstage(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, (body) => {
    try {
      const parsed = JSON.parse(body || "{}") as { cwd?: string; path?: string };
      const cwd = parsed.cwd?.trim() ?? "";
      const path = parsed.path?.trim() ?? "";
      const cwdError = validateGitCwd(cwd);
      const pathError = validateGitPath(path);
      if (cwdError || pathError) {
        sendJson(res, 400, { error: cwdError ?? pathError });
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
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function handleGitCommit(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, (body) => {
    try {
      const parsed = JSON.parse(body || "{}") as { cwd?: string; message?: string };
      const cwd = parsed.cwd?.trim() ?? "";
      const cwdError = validateGitCwd(cwd);
      if (cwdError) {
        sendJson(res, 400, { error: cwdError });
        return;
      }
      let args: string[];
      try {
        args = buildGitCommitArgs(parsed.message ?? "");
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
        return;
      }
      runGit(cwd, args, (result) => {
        if (!result.ok) {
          sendJson(res, 500, { error: result.error });
          return;
        }
        sendGitStatusAfterMutation(cwd, res);
      });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function handleGitPush(req: IncomingMessage, res: ServerResponse): void {
  readJsonBody(req, (body) => {
    try {
      const parsed = JSON.parse(body || "{}") as { cwd?: string };
      const cwd = parsed.cwd?.trim() ?? "";
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
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
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

interface BackgroundRunBinding {
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

interface BackgroundRunAccumulator {
  reasoning: string;
  hasReasoning: boolean;
  started: boolean;
  text: string;
  hasText: boolean;
  readonly tools: StreamingTool[];
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
  readonly supportsWritableApprovals: boolean;
  readonly args: (request: RunRequest) => string[];
  readonly createTranslator: () => (line: string) => RunEvent[];
}

const CLAUDE_SAFE_READ_TOOLS = ["Read", "Glob", "Grep", "LS"] as const;
const CLAUDE_EFFORT_LEVELS = new Set<EffortLevel>(["low", "medium", "high", "xhigh", "max"]);

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

function claudePermissionModeForRequest(request: RunRequest): ClaudeQueryOptions["permissionMode"] {
  if (request.accessMode === "read-only" || request.mode === "plan") {
    return "plan";
  }
  return "default";
}

export function buildClaudeSdkOptions(request: RunRequest, cwd: string, abortController: AbortController, canUseTool: CanUseTool): ClaudeQueryOptions {
  const options: ClaudeQueryOptions = {
    abortController,
    allowedTools: [...CLAUDE_SAFE_READ_TOOLS],
    canUseTool,
    cwd,
    permissionMode: claudePermissionModeForRequest(request),
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
  args.push("--permission-mode", accessMode === "read-write" && profile.mode !== "plan" ? "acceptEdits" : "plan");
  return args;
}

export function buildCodexRunArgs(request: RunArgsRequest): string[] {
  const profile = profileForArgs("codex", request);
  const args = ["exec", "--json", "--sandbox", "read-only", "--skip-git-repo-check"];
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
  const args = ["--prompt", request.prompt, "--output-format", "stream-json", "--approval-mode", "plan", "--skip-trust"];
  const model = modelForProfile(profile);
  if (model) {
    args.push("--model", model);
  }
  return args;
}

export function buildOpenCodeRunArgs(request: RunArgsRequest): string[] {
  const profile = profileForArgs("opencode", request);
  const args = ["run", "--format", "json", "--thinking"];
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
    supportsWritableApprovals: true,
    args: (request) => buildClaudeRunArgs(request),
    createTranslator: createClaudeStreamTranslator,
  },
  codex: {
    bin: "codex",
    env: DETECT.codex.env,
    supportsWritableApprovals: false,
    args: (request) => buildCodexRunArgs(request),
    createTranslator: createCodexStreamTranslator,
  },
  gemini: {
    bin: "gemini",
    env: DETECT.gemini.env,
    supportsWritableApprovals: false,
    args: (request) => buildGeminiRunArgs(request),
    createTranslator: createGeminiStreamTranslator,
  },
  opencode: {
    bin: "opencode",
    supportsWritableApprovals: false,
    args: (request) => buildOpenCodeRunArgs(request),
    createTranslator: createOpenCodeStreamTranslator,
  },
};

export function writableRunUnsupportedMessage(agent: string): string {
  return `Writable runs require a live permission bridge. ${agent || "This agent"} does not support interactive approve/deny yet.`;
}

export function validateRunAccessModeForAgent(agent: string, accessMode: AgentAccessMode): string | null {
  if (accessMode !== "read-write") {
    return null;
  }
  const spec = RUN[agent];
  return spec?.supportsWritableApprovals ? null : writableRunUnsupportedMessage(agent);
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

function editPairToLines(oldText: string, newText: string): Array<{ readonly type: "add" | "del" | "ctx"; readonly text: string }> {
  return [
    ...splitDiffLines(oldText).map((text) => ({ type: "del" as const, text })),
    ...splitDiffLines(newText).map((text) => ({ type: "add" as const, text })),
  ];
}

function parseMultiEditLines(value: string): Array<{ readonly type: "add" | "del" | "ctx"; readonly text: string }> | null {
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

function toolToDiffBlock(tool: StreamingTool): AgentBlock | null {
  if (tool.state === "error") {
    return null;
  }
  const args = tool.args;
  const file = args?.file_path ?? args?.path;
  if (!file) {
    return null;
  }
  const normalizedName = tool.name.toLowerCase();
  let lines: Array<{ readonly type: "add" | "del" | "ctx"; readonly text: string }> | null = null;
  if (normalizedName === "write" && typeof args?.content === "string") {
    lines = splitDiffLines(args.content).map((text) => ({ type: "add", text }));
  } else if (normalizedName === "edit" && typeof args?.old_string === "string" && typeof args?.new_string === "string") {
    lines = editPairToLines(args.old_string, args.new_string);
  } else if (normalizedName === "multiedit" && typeof args?.edits === "string") {
    lines = parseMultiEditLines(args.edits);
  }
  if (!lines) {
    return null;
  }
  return {
    kind: "diff",
    file,
    additions: lines.filter((line) => line.type === "add").length,
    deletions: lines.filter((line) => line.type === "del").length,
    lines,
  };
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

function decisionToPermissionResult(decision: RunApprovalDecision, input: Record<string, unknown>): PermissionResult {
  if (decision.decision === "approved") {
    return { behavior: "allow", updatedInput: input, toolUseID: decision.id };
  }
  return { behavior: "deny", message: "User rejected this action.", toolUseID: decision.id };
}

export function resolvePendingRunApproval(decision: RunApprovalDecision): RunApprovalDecision {
  const pending = pendingRunApprovals.get(decision.id);
  if (!pending) {
    throw new Error(`No pending approval request for ${decision.id}.`);
  }
  pending.dispose();
  pending.resolve(decisionToPermissionResult(decision, pending.input));
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

function createRunInputHandler(input: Record<string, unknown>, context: Parameters<CanUseTool>[2], send: (event: RunEvent) => void): Promise<PermissionResult> | null {
  const questions = parseAskUserQuestionInput(input);
  if (!questions) {
    return null;
  }

  return new Promise<PermissionResult>((resolve, reject) => {
    const questionItems: PendingRunInputQuestion[] = questions.map((question, index) => ({
      id: `${context.toolUseID}:q${index}`,
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

export function createRunApprovalHandler(send: (event: RunEvent) => void): CanUseTool {
  return (toolName, input, context) => {
    if (toolName === "AskUserQuestion") {
      const inputHandler = createRunInputHandler(input, context, send);
      if (inputHandler) {
        return inputHandler;
      }
    }

    return new Promise<PermissionResult>((resolve, reject) => {
      const id = context.toolUseID;
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

      pendingRunApprovals.set(id, { input, resolve, reject, dispose });
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

function startPersistedBackgroundRun(binding: BackgroundRunBinding, request: RunRequest): BackgroundRunAccumulator {
  const accumulator = createBackgroundAccumulator();
  const state = ensureBackgroundUserMessage(readWorkspaceState(), binding, request.prompt);
  const started = patchWorkspaceConversation(state, binding.conversationId, {
    activeRunId: binding.runId,
    status: "running",
    snippet: clip(request.prompt, 60),
    time: binding.userMessageTime,
    unread: false,
    costUsd: undefined,
    usage: undefined,
  });
  writeWorkspaceState(putBackgroundAgentMessage(started, binding, backgroundBlocks(accumulator)));
  return accumulator;
}

function applyBackgroundRunEvent(binding: BackgroundRunBinding, accumulator: BackgroundRunAccumulator, event: RunEvent): void {
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
  const blocks = backgroundBlocks(accumulator);
  const locale = readWorkspaceState().settings.general.locale;
  persistBackgroundBlocks(binding, blocks, blocksNeedInput(blocks) ? { status: "waiting", snippet: translate(locale, "runNeedsInputSnippet"), time: binding.agentMessageTime } : {});
}

function finishPersistedBackgroundRun(binding: BackgroundRunBinding, accumulator: BackgroundRunAccumulator, canceled: boolean): void {
  accumulator.done = true;
  let blocks = backgroundBlocks(accumulator);
  const state = readWorkspaceState();
  const locale = state.settings.general.locale;
  if (canceled && blocks.length === 0) {
    blocks = [{ kind: "status", level: "warn", text: translate(locale, "runCanceledSnippet") }];
  }
  const hadError = accumulator.statuses.some((status) => status.level === "error");
  const waiting = !canceled && !hadError && blocksNeedInput(blocks);
  const patch = canceled
    ? { activeRunId: undefined, status: "idle" as const, snippet: translate(locale, "runCanceledSnippet"), time: binding.agentMessageTime }
    : hadError
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
  writeWorkspaceState(patchWorkspaceConversation(putBackgroundAgentMessage(state, binding, blocks), binding.conversationId, patch));
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
    return [toolRunEvent(tool)];
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
    return [toolRunEvent(tool)];
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
        events.push({ type: "tool", id: String(block.id), name: String(block.name), summary: clip((block.input as Record<string, unknown>)?.command ?? (block.input as Record<string, unknown>)?.file_path ?? "", 80), args: toArgs(block.input) });
      }
    }
  } else if (type === "user") {
    const content = ((msg.message as { content?: unknown[] })?.content) ?? [];
    for (const block of content as Array<Record<string, unknown>>) {
      if (block.type === "tool_result") {
        events.push({ type: "tool_result", id: String(block.tool_use_id), ok: block.is_error !== true, output: resultText(block.content) });
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
  const state: ClaudeStreamState = { sawPartialAssistantContent: false, toolsByIndex: new Map() };
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

function codexItemEvents(msg: Record<string, unknown>): RunEvent[] {
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
  return commandExecutionEvents(msg.type, item);
}

export function createCodexStreamTranslator(): (line: string) => RunEvent[] {
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
    const itemEvents = codexItemEvents(msg);
    if (itemEvents.length > 0) {
      return itemEvents;
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
    events.push({
      type: "tool",
      id,
      name,
      summary: clip(summary, 80),
      args: toArgs(tool.args),
    });
    const hasResult = tool.resultDisplay !== undefined || tool.result !== undefined || tool.output !== undefined || tool.status !== undefined;
    if (hasResult) {
      const status = typeof tool.status === "string" ? tool.status.toLowerCase() : "";
      events.push({
        type: "tool_result",
        id,
        ok: status !== "error" && status !== "failed" && status !== "failure",
        output: resultText(tool.resultDisplay ?? tool.result ?? tool.output ?? ""),
      });
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

function opencodeToolEvents(msg: Record<string, unknown>, part: Record<string, unknown>): RunEvent[] {
  const partType = typeof part.type === "string" ? part.type : "";
  if (!partType.toLowerCase().includes("tool")) {
    return [];
  }
  const id = opencodePartId(part, typeof msg.sessionID === "string" ? `opencode-tool-${msg.sessionID}` : "opencode-tool");
  const name = opencodeToolName(part);
  const args = toArgs(part.input ?? part.args);
  const status = typeof part.state === "string" ? part.state.toLowerCase() : typeof part.status === "string" ? part.status.toLowerCase() : "";
  const events: RunEvent[] = [
    {
      type: "tool",
      id,
      name,
      summary: clip(part.description ?? part.title ?? part.command ?? name, 80),
      args,
    },
  ];
  const output = part.output ?? part.result ?? part.error;
  if (output !== undefined || status === "completed" || status === "error" || status === "failed") {
    events.push({
      type: "tool_result",
      id,
      ok: status !== "error" && status !== "failed" && part.error === undefined,
      output: resultText(output ?? ""),
    });
  }
  return events;
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
  const canUseTool = createRunApprovalHandler(send);
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
  readJsonBody(req, (body) => {
    try {
      const request = parseRunCancelPayload(body);
      const handle = backgroundRunHandles.get(request.runId);
      if (!handle) {
        sendJson(res, 404, { error: `No active run for ${request.runId}.` });
        return;
      }
      handle.cancel();
      sendJson(res, 200, { runId: request.runId, canceled: true });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function handleRun(req: IncomingMessage, res: ServerResponse): void {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
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
    try {
      const parsed = JSON.parse(body || "{}") as unknown;
      if (isRecord(parsed)) {
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
      }
    } catch {
      // ignore
    }

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-store");
    const sender = createRunEventSender(res);
    let accumulator: BackgroundRunAccumulator | null = null;
    const send = (event: RunEvent) => {
      sender.send(event);
      if (binding && accumulator) {
        applyBackgroundRunEvent(binding, accumulator, event);
      }
    };
    const sendDone = sender.sendDone;

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
    if (!accessModeValid) {
      send({ type: "error", text: "Invalid accessMode. Expected read-only or read-write." });
      sendDone();
      sender.end();
      return;
    }
    if (!profileValid) {
      send({ type: "error", text: profileError });
      sendDone();
      sender.end();
      return;
    }

    const spec = RUN[agent];
    const resolvedBin = spec ? resolveBinOnPath(spec.bin) : null;
    if (!spec || !resolvedBin || !isAgentId(agent)) {
      send({ type: "start" });
      send({ type: "status", level: "warn", text: spec ? `${spec.bin} is not installed on this machine` : `Running ${agent || "this agent"} is not wired yet` });
      sendDone();
      sender.end();
      return;
    }
    const requestedProfileErrorMessage = requestedProfileError(agent, model, reasoning, mode);
    if (requestedProfileErrorMessage) {
      send({ type: "start" });
      send({ type: "error", text: requestedProfileErrorMessage });
      sendDone();
      sender.end();
      return;
    }
    const accessModeError = validateRunAccessModeForAgent(agent, accessMode);
    if (accessModeError) {
      send({ type: "start" });
      send({ type: "error", text: accessModeError });
      sendDone();
      sender.end();
      return;
    }
    const config = readAgentSecretConfig();
    const runEnv = { ...process.env, ...config.env };
    const detect = DETECT[agent];
    if (spec.env && detect && !hasConfiguredAgentAuth(detect, config, runEnv)) {
      send({ type: "start" });
      send({ type: "status", level: "warn", text: `${agent} needs setup: set one of ${spec.env.join(", ")}` });
      sendDone();
      sender.end();
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
          sendDone();
          sender.end();
          return;
        }
        cwd = requestedCwd;
      } catch (error) {
        send({ type: "start" });
        send({ type: "error", text: error instanceof Error ? error.message : String(error) });
        sendDone();
        sender.end();
        return;
      }
    }
    try {
      mkdirSync(cwd, { recursive: true });
    } catch {
      // ignore
    }

    const request: RunRequest = { agent, model, reasoning, mode, prompt, accessMode };
    if (binding) {
      accumulator = startPersistedBackgroundRun(binding, request);
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
      sendDone();
      sender.end();
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
