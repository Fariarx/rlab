import AddIcon from "@mui/icons-material/Add";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatOutlined";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import MenuIcon from "@mui/icons-material/Menu";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import OpenInBrowserIcon from "@mui/icons-material/OpenInBrowser";
import TerminalIcon from "@mui/icons-material/Terminal";
import SearchIcon from "@mui/icons-material/Search";
import SettingsIcon from "@mui/icons-material/Settings";
import SystemUpdateAltIcon from "@mui/icons-material/SystemUpdateAlt";
import {
  Alert,
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Drawer,
  Menu,
  MenuItem,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { type DragEvent, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { I18nProvider, useI18n } from "../../i18n/I18nProvider";
import { normalizeExternalUrl } from "../../lib/external-url";
import { formatDateTime24 } from "../../lib/time-format";
import { contextWindowForAgentProfile } from "../../lib/model-context";
import type { HashRoute } from "../../lib/use-hash-route";
import { getVoiceProvider, type VoiceProviderId } from "../../lib/voice-providers";
import {
  type AgentProfile,
  type ApprovalDecision,
  AGENTS,
  type AgentRateLimitMap,
  AgentBadge,
  AgentPicker,
  Composer,
  type ComposerHandle,
  Conversation,
  ConversationList,
  ConversationSearch,
  DEFAULT_AGENT_OPTION_ID,
  DEFAULT_PROFILE,
  type DiffBlock,
  getAgent,
  normalizeAgentProfile,
  messageToPlainText,
  type ChatMessage,
  type ComposerDraft,
  type ComposerPluginLink,
  type ConversationStatus,
  type ConversationSummary,
  type ConversationView,
  type ReviewCommentEntry,
  useAgentCliInfo,
  useAgentStatus,
  useAgentStatusError,
  useAgentStatusLive,
  useReloadAgentStatus,
  accessModeForAgentProfile,
  agentProfileEquals,
  agentProfileLabels,
} from "../agent";
import { dropIn } from "../agent/anim";
import { SettingsDialog } from "../settings/SettingsDialog";
import { Button, EmptyState, IconButton, useToast } from "../ui";
import { CommandPalette, type CommandPaletteItem } from "./CommandPalette";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { BrowserPreview, type BrowserActivityEvent } from "./BrowserPreview";
import { type DiffCommentApi, GitView } from "./GitPanel";
import { ResourcesPanel } from "./ResourcesPanel";
import { TerminalView } from "./TerminalView";
import { WorkspaceUiProvider, type WorkspaceUiApi } from "./workspace-ui";
import { DEFAULT_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, normalizeSidebarWidth } from "./app-settings";
import { conversationProfile, type Workspace, useWorkspace } from "./use-workspace";

const COMPOSER_DRAFT_SAVE_DELAY_MS = 350;
const EMPTY_COMPOSER_DRAFT: ComposerDraft = { text: "", attachments: [] };
const CLI_UPDATE_POLL_MS = 5 * 60_000;
const AGENT_LIMIT_REFRESH_MIN_INTERVAL_MS = 60_000;
const AGENT_LIMIT_ON_DEMAND_REFRESH_AGENTS = new Set(["claude-code", "codex", "gemini"]);
const AGENT_AUTO_CONFIRM_AGENTS = new Set(["claude-code", "codex", "gemini"]);

const CONVERSATION_VIEWS = new Set<ConversationView>(["chat", "git", "resources", "preview", "terminal"]);

function normalizeConversationView(view: ConversationView | undefined, terminalEnabled: boolean): ConversationView {
  if (!view || !CONVERSATION_VIEWS.has(view)) {
    return "chat";
  }
  return view === "terminal" && !terminalEnabled ? "chat" : view;
}

type WakeupTrigger =
  | { readonly type: "time"; readonly fireAtMs: number }
  | { readonly type: "cron"; readonly cron: string; readonly nextFireMs: number }
  | { readonly type: "script"; readonly script: string; readonly intervalSeconds?: number; readonly cron?: string; readonly nextCheckMs: number; readonly lastCheckedAtMs?: number; readonly lastExitCode?: number; readonly lastError?: string };

interface WakeupSummary {
  readonly id: string;
  readonly conversationId: string;
  readonly agent: string;
  readonly prompt: string;
  readonly reason?: string;
  readonly trigger: WakeupTrigger;
}

interface CliUpdateInfo {
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

interface AgentLimitSnapshot {
  readonly limits: AgentRateLimitMap;
  readonly refreshError?: string;
}

interface VoiceProviderConfigInfo {
  readonly envVar: string;
  readonly configured: boolean;
}

interface VoiceConfigSnapshot {
  readonly providers: Partial<Record<VoiceProviderId, VoiceProviderConfigInfo>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function loadAgentLimits(agent: string | undefined, refresh: boolean): Promise<AgentLimitSnapshot> {
  const params = new URLSearchParams();
  if (refresh && agent) {
    params.set("refresh", "1");
    params.set("agent", agent);
  }
  const response = await fetch(`/api/agent-limits${params.size > 0 ? `?${params.toString()}` : ""}`, { method: "GET", cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as { limits?: AgentRateLimitMap; refreshError?: string; error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Agent limits load failed (${response.status})`);
  }
  return { limits: payload.limits ?? {}, refreshError: payload.refreshError };
}

async function loadCliUpdates(refresh = false): Promise<CliUpdateSnapshot> {
  const response = await fetch(`/api/cli-updates${refresh ? "?refresh=1" : ""}`, { method: "GET", cache: "no-store" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `CLI update check failed (${response.status})`);
  }
  const payload = (await response.json()) as Partial<CliUpdateSnapshot>;
  return {
    checkedAt: typeof payload.checkedAt === "number" ? payload.checkedAt : 0,
    checking: payload.checking === true,
    updates: Array.isArray(payload.updates) ? payload.updates : [],
    errors: payload.errors && typeof payload.errors === "object" ? payload.errors : {},
  };
}

async function loadVoiceConfig(): Promise<VoiceConfigSnapshot> {
  const response = await fetch("/api/voice-config", { method: "GET", cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as { providers?: VoiceConfigSnapshot["providers"]; error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Voice config load failed (${response.status})`);
  }
  return { providers: payload.providers && typeof payload.providers === "object" ? payload.providers : {} };
}

async function loadRlabPlugins(): Promise<readonly ComposerPluginLink[]> {
  const response = await fetch("/api/rlab-plugins", { method: "GET", cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as { plugins?: unknown; error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `rlab plugins load failed (${response.status})`);
  }
  if (!Array.isArray(payload.plugins)) {
    return [];
  }
  return payload.plugins.filter(isRecord).flatMap((plugin) => {
    const { id, label, token } = plugin;
    return typeof id === "string" && typeof label === "string" && typeof token === "string" ? [{ id, label, token }] : [];
  });
}

async function updateAgentCli(agent: string): Promise<void> {
  const response = await fetch("/api/agent-install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `CLI update failed (${response.status})`);
  }
}

function clearCliUpdateForAgent(snapshot: CliUpdateSnapshot, agent: string): CliUpdateSnapshot {
  return {
    ...snapshot,
    checkedAt: Date.now(),
    updates: snapshot.updates.filter((update) => update.agent !== agent),
    errors: Object.fromEntries(Object.entries(snapshot.errors).filter(([key]) => key !== agent && key !== "update")),
  };
}

async function loadWakeups(conversationId?: string): Promise<WakeupSummary[]> {
  const query = new URLSearchParams();
  if (conversationId) {
    query.set("conversationId", conversationId);
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const response = await fetch(`/api/wakeups${suffix}`, { method: "GET", cache: "no-store" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Wakeups load failed (${response.status})`);
  }
  const payload = (await response.json()) as { wakeups?: WakeupSummary[] };
  return Array.isArray(payload.wakeups) ? payload.wakeups : [];
}

async function deleteWakeup(conversationId: string, wakeupId: string): Promise<void> {
  const query = new URLSearchParams({ conversationId, id: wakeupId });
  const response = await fetch(`/api/wakeups?${query.toString()}`, { method: "DELETE", cache: "no-store" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Wakeup delete failed (${response.status})`);
  }
}

function wakeupLabel(wakeup: WakeupSummary, locale: "ru" | "en"): string {
  if (wakeup.trigger.type === "time") {
    const when = formatDateTime24(new Date(wakeup.trigger.fireAtMs));
    return locale === "ru" ? `TaskWakeup: ${when}` : `TaskWakeup: ${when}`;
  }
  if (wakeup.trigger.type === "cron") {
    const when = formatDateTime24(new Date(wakeup.trigger.nextFireMs));
    return locale === "ru" ? `TaskWakeup cron: ${when}` : `TaskWakeup cron: ${when}`;
  }
  const scriptSchedule = wakeup.trigger.cron ? `cron ${wakeup.trigger.cron}` : locale === "ru" ? `каждые ${wakeup.trigger.intervalSeconds}s` : `every ${wakeup.trigger.intervalSeconds}s`;
  const base = `TaskWakeup script: ${scriptSchedule}`;
  if (wakeup.trigger.lastError) {
    return `${base} · ${wakeup.trigger.lastError}`;
  }
  if (wakeup.trigger.lastExitCode !== undefined) {
    return `${base} · exit ${wakeup.trigger.lastExitCode}`;
  }
  return base;
}

async function createWorktree(cwd: string): Promise<{ readonly path: string; readonly branch: string }> {
  const response = await fetch("/api/git-worktree-create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  const payload = (await response.json().catch(() => ({}))) as { path?: string; branch?: string; error?: string };
  if (!response.ok || !payload.path) {
    throw new Error(payload.error ?? `Worktree create failed (${response.status})`);
  }
  return { path: payload.path, branch: payload.branch ?? "" };
}

async function mergeWorktree(base: string, worktreePath: string): Promise<void> {
  const response = await fetch("/api/git-worktree-merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base, worktreePath }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Worktree merge failed (${response.status})`);
  }
}

// The sidebar title bar and the chat pane header share one fixed height so the
// two columns line up across the top.
const HEADER_MIN_HEIGHT = 53;
// Shared horizontal inset for the sidebar so the title and the list below it
// keep an even left/right margin.
const SIDEBAR_INSET = 1.5;
// Max width for the centered thread/composer content. The scroll container
// itself is full-width so its scrollbar sits at the screen edge.
const THREAD_MAX_WIDTH = 1040;
const THREAD_PADDING_X = { xs: 2, sm: 3 } as const;
const WORKSPACE_ERROR_ALERT_SX = {
  alignItems: "center",
  "& .MuiAlert-message": {
    display: "flex",
    alignItems: "center",
    minHeight: 32,
  },
  "& .MuiAlert-action": {
    alignItems: "center",
    pt: 0,
  },
} as const;

/** The visible text of a sent user message (attachment blocks and file-link
 *  markdown removed) for ArrowUp history recall. */
function composerHistoryText(raw: string): string {
  return raw
    .replace(/<attachment\s+name="[^"]*"[^>]*>[\s\S]*?<\/attachment>/g, "")
    .replace(/!?\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, _label, target: string) => (/[\\/]/.test(target) || /\.[a-z0-9]{1,8}$/i.test(target) ? "" : whole))
    .trim();
}

function buildComposerLabel(profile: AgentProfile): string {
  const agent = getAgent(profile.agent);
  const labels = agentProfileLabels(profile);
  if (labels.length === 0) {
    return agent?.short ?? profile.agent;
  }
  return labels.join(" · ");
}

function liveModesOrCatalog<T extends { readonly id: string }>(catalogOptions: readonly T[], liveOptions: readonly T[] | undefined): readonly T[] {
  if (!liveOptions?.length) {
    return catalogOptions;
  }
  const seen = new Set(catalogOptions.map((option) => option.id));
  const merged = [...catalogOptions];
  for (const option of liveOptions) {
    if (!seen.has(option.id)) {
      seen.add(option.id);
      merged.push(option);
    }
  }
  return merged;
}

function projectForConversation(workspace: Workspace, conversationId: string): { readonly id: string; readonly name: string } | null {
  const project = workspace.projects.find((item) => item.conversations.some((conversation) => conversation.id === conversationId));
  return project ? { id: project.id, name: project.name } : null;
}

function routeForConversation(workspace: Workspace, conversationId: string): HashRoute {
  const project = projectForConversation(workspace, conversationId);
  return project ? { kind: "project", projectId: project.id, conversationId } : { kind: "chat", conversationId };
}

function workspaceConversations(workspace: Workspace): readonly ConversationSummary[] {
  return [...workspace.chats, ...workspace.projects.flatMap((project) => project.conversations)];
}

function firstVisibleConversationId(workspace: Workspace): string {
  const conversations = workspaceConversations(workspace);
  return conversations.find((conversation) => !conversation.archived)?.id ?? conversations[0]?.id ?? "";
}

function latestAgentDiffBlocks(messages: readonly ChatMessage[]): readonly DiffBlock[] {
  const lastAgentMessage = [...messages].reverse().find((message) => message.role === "agent" && message.blocks?.some((block) => block.kind === "diff"));
  return lastAgentMessage?.blocks?.filter((block): block is DiffBlock => block.kind === "diff") ?? [];
}

function messageHasLiveAgentWork(message: ChatMessage): boolean {
  if (message.role !== "agent") {
    return false;
  }
  return Boolean(
    message.blocks?.some((block) => {
      switch (block.kind) {
        case "reasoning":
          return block.active === true;
        case "text":
          return block.streaming === true;
        case "tool":
        case "command":
        case "search":
          return block.state === "running";
        case "plan":
          return block.steps.some((step) => step.state === "running");
        default:
          return false;
      }
    }),
  );
}

function conversationHasActiveWork(conversation: ConversationSummary | null, messages: readonly ChatMessage[]): boolean {
  return Boolean(
    conversation &&
      (conversation.activeRunId ||
        messages.some(messageHasLiveAgentWork)),
  );
}

function runToastForStatus(status: ConversationStatus, title: string, t: ReturnType<typeof useI18n>["t"]) {
  if (status === "done") {
    return { message: t("runCompletedToast", { title }), severity: "success" as const };
  }
  if (status === "waiting") {
    return { message: t("runNeedsInputToast", { title }), severity: "warning" as const };
  }
  if (status === "error") {
    return { message: t("runFailedToast", { title }), severity: "error" as const };
  }
  return null;
}

function runNotificationForStatus(status: ConversationStatus, title: string, t: ReturnType<typeof useI18n>["t"]) {
  if (status === "done") {
    return { title: t("runCompletedNotificationTitle"), body: title };
  }
  if (status === "waiting") {
    return { title: t("runNeedsInputNotificationTitle"), body: title };
  }
  if (status === "error") {
    return { title: t("runFailedNotificationTitle"), body: title };
  }
  return null;
}

function showDesktopNotification(enabled: boolean, notification: { readonly title: string; readonly body: string } | null): void {
  if (!enabled || notification == null || typeof Notification === "undefined" || Notification.permission !== "granted") {
    return;
  }
  new Notification(notification.title, { body: notification.body });
}

export function WorkspacePage() {
  const workspace = useWorkspace();

  return (
    <I18nProvider locale={workspace.settings.general.locale}>
      <WorkspacePageView workspace={workspace} />
    </I18nProvider>
  );
}

export function WorkspacePageView({
  workspace: ws,
  route,
  onNavigate,
}: {
  readonly workspace: Workspace;
  readonly route?: HashRoute;
  readonly onNavigate?: (route: HashRoute) => void;
}) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const statusOf = useAgentStatus();
  const cliInfoOf = useAgentCliInfo();
  const agentStatusLive = useAgentStatusLive();
  const agentStatusError = useAgentStatusError();
  const reloadAgentStatus = useReloadAgentStatus();
  const lastWorkspaceErrorToast = useRef<string | null>(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [profile, setProfile] = useState<AgentProfile>(ws.settings.agents.defaultProfile ?? DEFAULT_PROFILE);
  const [pickerOpen, setPickerOpen] = useState(false);
  // The "+" button opens this menu to pick where a new chat lives (a standalone
  // simple chat, or one of the projects). The chat is created immediately on
  // pick — there's no draft/prelude step.
  const [newChatMenuAnchor, setNewChatMenuAnchor] = useState<HTMLElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [view, setView] = useState<ConversationView>("chat");
  // A URL requested from a chat link's "open in preview"; handed to BrowserPreview
  // via a nonce so re-opening the same link re-triggers the load.
  const [browserOpenRequest, setBrowserOpenRequest] = useState<{ readonly url: string; readonly nonce: number }>({ url: "", nonce: 0 });
  // External "open in Git" target + a nonce so re-clicking the same file re-jumps.
  const [gitFocus, setGitFocus] = useState<{ readonly path: string; readonly nonce: number }>({ path: "", nonce: 0 });
  // Bumped to force the Git view to re-fetch status (after a worktree op).
  const [gitReloadSignal, setGitReloadSignal] = useState(0);
  const [worktreeBusy, setWorktreeBusy] = useState(false);
  const [cliUpdateSnapshot, setCliUpdateSnapshot] = useState<CliUpdateSnapshot>({ checkedAt: 0, checking: false, updates: [], errors: {} });
  const [cliUpdateBusyAgent, setCliUpdateBusyAgent] = useState<string | null>(null);
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfigSnapshot>({ providers: {} });
  const [registeredPlugins, setRegisteredPlugins] = useState<readonly ComposerPluginLink[]>([]);
  // Unstaged line totals for the header Git-tab badge, reported by the Git view.
  const [gitUnstaged, setGitUnstaged] = useState<{ readonly additions: number; readonly deletions: number }>({ additions: 0, deletions: 0 });
  // Height of the composer's floating tags row; the thread/Git content reserves
  // matching bottom space so the (still-floating) tags never hide content.
  const [composerTagsHeight, setComposerTagsHeight] = useState(0);
  // How far the multiline-input overlay rises above the single-row baseline.
  const [composerOverlayLift, setComposerOverlayLift] = useState(0);
  // Measured height of the floating composer dock (input bar + its outer gap).
  // The thread/Git content reserves matching bottom space so nothing hides
  // behind the now-floating composer.
  const [composerDockHeight, setComposerDockHeight] = useState(0);
  const composerDockRef = useRef<HTMLDivElement | null>(null);
  const contentBottomInset = composerDockHeight + (composerTagsHeight > 0 ? composerTagsHeight + 22 : 0) + composerOverlayLift;
  const showTerminal = ws.settings.appearance.showTerminal ?? false;
  // The terminal has its own command input; the browser preview still uses the
  // composer menu for browser-agent activity.
  const composerVisible = view !== "terminal";
  const [browserActivityEvents, setBrowserActivityEvents] = useState<readonly BrowserActivityEvent[]>([]);
  const showView = useCallback((next: ConversationView) => {
    setView(next);
    if (ws.find(ws.selectedId)) {
      ws.setConversationView(ws.selectedId, next);
    }
  }, [ws]);
  // Pending code-review comments, attached to diff lines in the Git view and sent
  // to the thread as one block (without starting an agent run).
  const [reviewComments, setReviewComments] = useState<readonly ReviewCommentEntry[]>([]);
  const reviewSeq = useRef(0);
  const review: DiffCommentApi = {
    comments: reviewComments,
    onAddComment: (file, line, lineText, body) =>
      setReviewComments((prev) => [...prev, { id: `rc-${++reviewSeq.current}`, file, line, lineText, body }]),
    onUpdateComment: (id, body) => setReviewComments((prev) => prev.map((comment) => (comment.id === id ? { ...comment, body } : comment))),
    onDeleteComment: (id) => setReviewComments((prev) => prev.filter((comment) => comment.id !== id)),
  };
  const sendReviewComments = () => {
    if (selected && reviewComments.length > 0) {
      ws.addReviewComments(ws.selectedId, reviewComments);
      setReviewComments([]);
      showView("chat");
    }
  };
  const [mentionableFiles, setMentionableFiles] = useState<readonly string[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => normalizeSidebarWidth(ws.settings.appearance.sidebarWidth));
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [paneDragDepth, setPaneDragDepth] = useState(0);
  const paneDragging = paneDragDepth > 0;
  const composerRef = useRef<ComposerHandle | null>(null);
  const notifiableRuns = useRef(new Set<string>());
  const previousStatuses = useRef(new Map<string, ConversationStatus>());
  const sidebarWidthRef = useRef(sidebarWidth);
  const sidebarShellRef = useRef<HTMLDivElement | null>(null);
  const sidebarInnerRef = useRef<HTMLDivElement | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingDraftSaves = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingDraftValues = useRef(new Map<string, ComposerDraft>());

  const selected = ws.find(ws.selectedId);
  const messages = ws.threads[ws.selectedId] ?? [];
  const [wakeups, setWakeups] = useState<readonly WakeupSummary[]>([]);
  const selectedWakeups = useMemo(() => (selected ? wakeups.filter((wakeup) => wakeup.conversationId === selected.id) : []), [selected, wakeups]);
  const wakeupConversationIds = useMemo(() => new Set(wakeups.map((wakeup) => wakeup.conversationId)), [wakeups]);
  const [agentLimits, setAgentLimits] = useState<AgentRateLimitMap>({});
  const [agentLimitsLoaded, setAgentLimitsLoaded] = useState(false);
  const [agentLimitRefreshing, setAgentLimitRefreshing] = useState<Readonly<Record<string, boolean>>>({});
  const [agentLimitRefreshErrors, setAgentLimitRefreshErrors] = useState<Readonly<Record<string, string | undefined>>>({});
  const agentLimitRefreshAttemptRef = useRef<Record<string, number>>({});
  const refreshAgentLimits = useCallback((agentId: string | undefined, requestRefresh: boolean) => {
    const canRequestRefresh = Boolean(requestRefresh && agentId && AGENT_LIMIT_ON_DEMAND_REFRESH_AGENTS.has(agentId));
    if (requestRefresh && agentId && !canRequestRefresh) {
      setAgentLimitRefreshErrors((current) => ({ ...current, [agentId]: undefined }));
    }
    if (canRequestRefresh && agentId) {
      const lastAttempt = agentLimitRefreshAttemptRef.current[agentId] ?? 0;
      if (Date.now() - lastAttempt < AGENT_LIMIT_REFRESH_MIN_INTERVAL_MS) {
        return;
      }
      agentLimitRefreshAttemptRef.current = { ...agentLimitRefreshAttemptRef.current, [agentId]: Date.now() };
      setAgentLimitRefreshing((current) => ({ ...current, [agentId]: true }));
      setAgentLimitRefreshErrors((current) => ({ ...current, [agentId]: undefined }));
    }

    loadAgentLimits(agentId, canRequestRefresh)
      .then((snapshot) => {
        setAgentLimits(snapshot.limits);
        setAgentLimitsLoaded(true);
        if (agentId) {
          setAgentLimitRefreshErrors((current) => ({ ...current, [agentId]: snapshot.refreshError }));
        }
      })
      .catch((error: unknown) => {
        setAgentLimitsLoaded(true);
        if (agentId) {
          setAgentLimitRefreshErrors((current) => ({
            ...current,
            [agentId]: error instanceof Error ? error.message : t("limitsRefreshError"),
          }));
        } else {
          toast({ message: error instanceof Error ? error.message : t("limitsRefreshError"), severity: "error", duration: 3000 });
        }
      })
      .finally(() => {
        if (agentId) {
          setAgentLimitRefreshing((current) => ({ ...current, [agentId]: false }));
        }
      });
  }, [t, toast]);

  const refreshVoiceConfig = useCallback(() => {
    loadVoiceConfig()
      .then(setVoiceConfig)
      .catch((error: unknown) => {
        setVoiceConfig({ providers: {} });
        toast({ message: error instanceof Error ? error.message : String(error), severity: "error", duration: 3000 });
      });
  }, [toast]);
  // Sent user messages (oldest first) for ArrowUp/ArrowDown recall in the
  // composer; attachment blocks / file-link markdown are stripped to the visible
  // text, and blank entries dropped.
  const messageHistory = useMemo(
    () =>
      messages
        .filter((message) => message.role === "user")
        .map((message) => composerHistoryText(message.text ?? ""))
        .filter((text) => text.length > 0),
    [messages],
  );
  const selectedHasActiveWork = conversationHasActiveWork(selected, messages);
  const lastTurnDiffs = useMemo(() => latestAgentDiffBlocks(messages), [messages]);
  const composerDraft = ws.composerDrafts[ws.selectedId] ?? { text: "", attachments: [] };
  const selectedVoiceProvider = getVoiceProvider(ws.settings.general.voice.provider);
  const composerVoiceProvider =
    selectedVoiceProvider.kind === "none"
      ? undefined
      : {
          id: selectedVoiceProvider.id,
          name: selectedVoiceProvider.name,
          kind: selectedVoiceProvider.kind,
          language: ws.settings.general.voice.language,
          configured: selectedVoiceProvider.kind === "cloud" ? voiceConfig.providers[selectedVoiceProvider.id]?.configured === true : true,
        };
  const selectedCwd = ws.cwdOf(ws.selectedId);
  const terminalCwd = selected ? (selectedCwd ?? ".") : undefined;
  useEffect(() => {
    refreshAgentLimits(undefined, false);
  }, [refreshAgentLimits]);

  useEffect(() => {
    refreshVoiceConfig();
  }, [refreshVoiceConfig]);

  useEffect(() => {
    let canceled = false;
    loadRlabPlugins()
      .then((plugins) => {
        if (!canceled) {
          setRegisteredPlugins(plugins);
        }
      })
      .catch((error: unknown) => {
        if (!canceled) {
          setRegisteredPlugins([]);
          toast({ message: error instanceof Error ? error.message : String(error), severity: "error", duration: 3000 });
        }
      });
    return () => {
      canceled = true;
    };
  }, [toast]);

  useEffect(() => {
    let canceled = false;
    const refresh = () => {
      loadWakeups()
        .then((items) => {
          if (!canceled) {
            setWakeups(items);
          }
        })
        .catch(() => {
          if (!canceled) {
            setWakeups([]);
          }
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [selected?.id, selected?.status, messages.length]);
  const removeWakeup = (wakeupId: string) => {
    if (!selected) {
      return;
    }
    const conversationId = selected.id;
    setWakeups((current) => current.filter((wakeup) => wakeup.id !== wakeupId));
    deleteWakeup(conversationId, wakeupId).catch((error: unknown) => {
      loadWakeups()
        .then((items) => setWakeups(items))
        .catch(() => setWakeups([]));
      toast({ message: error instanceof Error ? error.message : String(error), severity: "error", duration: 3000 });
    });
  };
  const sendBrowserAnnotation = (message: string) => {
    if (!selected) {
      return;
    }
    notifiableRuns.current.add(ws.selectedId);
    ws.sendMessage(ws.selectedId, message);
    showView("chat");
  };
  // Workspace navigation handed to deeply nested chat components (markdown links,
  // resource rows) through context — see workspace-ui.tsx.
  const uiApi = useMemo<WorkspaceUiApi>(
    () => ({
      openPreview: (url: string) => {
        // Bare-domain links (vitest.dev/api) must be upgraded to an absolute URL
        // before the browser preview, which only accepts http(s)/about:blank.
        const target = normalizeExternalUrl(url) ?? url;
        setBrowserOpenRequest((prev) => ({ url: target, nonce: prev.nonce + 1 }));
        showView("preview");
      },
      openGitFile: (file: string) => {
        setGitFocus((prev) => ({ path: file, nonce: prev.nonce + 1 }));
        showView("git");
      },
    }),
    [showView],
  );
  const activeCwd = selectedCwd;
  const headerTitle = selected?.title ?? t("noConversation");
  const profileAccessMode = accessModeForAgentProfile(profile);
  const selectedBasePath = ws.basePathOf(ws.selectedId);
  // Worktree controls for the Git tab. Only for a real project conversation (a
  // base repo path exists); agent run permissions are now selected per chat.
  const worktreeApi = selected && selectedBasePath
    ? {
        active: true,
        inWorktree: Boolean(selected.worktreePath),
        busy: worktreeBusy,
        onCreate: () => {
          const conversationId = selected.id;
          const basePath = selectedBasePath;
          setWorktreeBusy(true);
          createWorktree(basePath)
            .then(({ path }) => {
              ws.setWorktree(conversationId, path);
              setGitReloadSignal((value) => value + 1);
              toast({ message: t("worktreeCreatedToast"), severity: "success", duration: 2500 });
            })
            .catch((error) => toast({ message: error instanceof Error ? error.message : String(error), severity: "error", duration: 3500 }))
            .finally(() => setWorktreeBusy(false));
        },
        onMerge: () => {
          const conversationId = selected.id;
          const basePath = selectedBasePath;
          const worktreePath = selected.worktreePath;
          if (!worktreePath) {
            return;
          }
          setWorktreeBusy(true);
          mergeWorktree(basePath, worktreePath)
            .then(() => {
              ws.setWorktree(conversationId, undefined);
              setGitReloadSignal((value) => value + 1);
              toast({ message: t("worktreeMergedToast"), severity: "success", duration: 2500 });
            })
            .catch((error) => toast({ message: error instanceof Error ? error.message : String(error), severity: "error", duration: 4000 }))
            .finally(() => setWorktreeBusy(false));
        },
      }
    : undefined;
  const mode = ws.settings.appearance.theme;
  const routeKind = route?.kind;
  const routeProjectId = route?.kind === "project" ? route.projectId : undefined;
  const routeConversationId = route?.kind === "chat" || route?.kind === "project" ? route.conversationId : undefined;
  const noAgentsAvailable = agentStatusLive && AGENTS.every((agent) => statusOf(agent.id) !== "available" && statusOf(agent.id) !== "running");
  const workspaceHydrating = !ws.loaded;

  const cancelDraftSave = (id: string) => {
    const timer = pendingDraftSaves.current.get(id);
    if (timer) {
      clearTimeout(timer);
      pendingDraftSaves.current.delete(id);
    }
  };

  const flushDraftSave = (id: string) => {
    const draft = pendingDraftValues.current.get(id);
    if (!draft) {
      cancelDraftSave(id);
      return;
    }
    cancelDraftSave(id);
    pendingDraftValues.current.delete(id);
    ws.updateComposerDraft(id, draft);
  };

  const scheduleDraftSave = (id: string, draft: ComposerDraft) => {
    pendingDraftValues.current.set(id, {
      text: draft.text,
      attachments: draft.attachments.map((attachment) => ({ ...attachment })),
    });
    cancelDraftSave(id);
    pendingDraftSaves.current.set(id, setTimeout(() => flushDraftSave(id), COMPOSER_DRAFT_SAVE_DELAY_MS));
  };

  useEffect(() => {
    return () => {
      for (const id of Array.from(pendingDraftValues.current.keys())) {
        flushDraftSave(id);
      }
      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!ws.loadError) {
      lastWorkspaceErrorToast.current = null;
      return;
    }
    if (lastWorkspaceErrorToast.current === ws.loadError) {
      return;
    }
    lastWorkspaceErrorToast.current = ws.loadError;
    toast({ message: t("workspaceError", { error: ws.loadError }), severity: "error", duration: 5000 });
  }, [t, toast, ws.loadError]);

  useEffect(() => {
    if (selected) {
      setProfile(conversationProfile(selected));
    } else {
      setProfile(ws.settings.agents.defaultProfile);
    }
  }, [selected, ws.settings.agents.defaultProfile]);

  // Track the floating composer's height so the thread reserves matching bottom
  // space (it scrolls behind the composer instead of being pushed up by it). The
  // composer is unmounted in the terminal/preview views, where the inset is 0.
  useLayoutEffect(() => {
    const node = composerDockRef.current;
    if (!composerVisible || !node) {
      setComposerDockHeight(0);
      return;
    }
    const update = () => setComposerDockHeight(node.offsetHeight);
    update();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [composerVisible]);

  useLayoutEffect(() => {
    setView(normalizeConversationView(selected?.view, showTerminal));
  }, [selected?.id, selected?.view, showTerminal]);

  useEffect(() => {
    if (!showTerminal && view === "terminal") {
      showView("chat");
    }
  }, [showTerminal, showView, view]);

  useEffect(() => {
    let alive = true;
    if (!activeCwd) {
      setMentionableFiles([]);
      return;
    }

    fetch("/api/project-files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: activeCwd }),
    })
      .then(async (response) => {
        const payload = (await response.json()) as { files?: string[]; error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? t("projectFilesUnavailable"));
        }
        if (alive) {
          setMentionableFiles(payload.files ?? []);
        }
      })
      .catch((error) => {
        if (alive) {
          setMentionableFiles([]);
          toast({ message: error instanceof Error ? error.message : String(error), severity: "error", duration: 3000 });
        }
      });

    return () => {
      alive = false;
    };
  }, [activeCwd, t, toast]);

  // Detect a redeploy: poll the server's build version and, when it changes,
  // prompt to reload. A long-lived SPA tab navigates via hash routes and never
  // re-fetches the bundle on its own, so without this it keeps running stale JS
  // after a deploy (the source of "still broken" reports after a fix shipped).
  useEffect(() => {
    let baseline: string | null = null;
    let prompted = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const check = async () => {
      try {
        const response = await fetch("/api/version", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const { version } = (await response.json()) as { version?: string };
        if (!version || version === "dev") {
          return;
        }
        if (baseline === null) {
          baseline = version;
        } else if (version !== baseline && !prompted) {
          prompted = true;
          toast({
            message: t("newVersionAvailable"),
            severity: "info",
            duration: 0,
            action: (
              <Button variant="subtle" size="small" onClick={() => window.location.reload()}>
                {t("reloadApp")}
              </Button>
            ),
          });
        }
      } catch {
        // Offline / transient — ignore and retry on the next tick.
      }
    };
    void check();
    timer = setInterval(check, 60_000);
    return () => {
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [t, toast]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const refresh = async () => {
      try {
        const snapshot = await loadCliUpdates(false);
        if (alive) {
          setCliUpdateSnapshot(snapshot);
        }
      } catch {
        // The card is for actionable updates, not transient status noise. Manual
        // update failures are surfaced directly in handleCliUpdate.
      }
    };
    void refresh();
    timer = setInterval(refresh, CLI_UPDATE_POLL_MS);
    return () => {
      alive = false;
      if (timer) {
        clearInterval(timer);
      }
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useLayoutEffect(() => {
    const projectConversationId = routeProjectId
      ? ws.projects.find((project) => project.id === routeProjectId)?.conversations[0]?.id
      : undefined;
    const targetConversationId = routeConversationId ?? (routeKind === "project" ? projectConversationId : undefined);

    if ((routeKind === "chat" || routeKind === "project") && targetConversationId) {
      const conv = ws.find(targetConversationId);
      if (!conv) {
        const fallbackId = firstVisibleConversationId(ws);
        if (fallbackId) {
          onNavigate?.(routeForConversation(ws, fallbackId));
          if (ws.selectedId !== fallbackId) {
            ws.select(fallbackId);
          }
        } else {
          onNavigate?.({ kind: "home" });
        }
        return;
      }
      if (ws.selectedId !== targetConversationId) {
        ws.select(targetConversationId);
      }
      setProfile((current) => {
        const nextProfile = conversationProfile(conv);
        return agentProfileEquals(current, nextProfile) ? current : nextProfile;
      });
    }
  }, [routeKind, routeProjectId, routeConversationId, ws.chats, ws.projects, ws.selectedId, ws.select, ws.find, onNavigate]);

  useEffect(() => {
    const conversations = workspaceConversations(ws);
    const nextStatuses = new Map(conversations.map((conversation) => [conversation.id, conversation.status]));
    for (const conversation of conversations) {
      const previousStatus = previousStatuses.current.get(conversation.id);
      const activeRunStatusChanged =
        previousStatus !== undefined &&
        previousStatus !== conversation.status &&
        (previousStatus === "running" || previousStatus === "waiting") &&
        conversation.status !== "running";
      if (
        activeRunStatusChanged &&
        notifiableRuns.current.has(conversation.id)
      ) {
        if (conversation.status !== "waiting") {
          notifiableRuns.current.delete(conversation.id);
        }
        // A plain "done" on the conversation you're already looking at is just
        // noise — you can see the result. Only surface done for background runs;
        // keep error / needs-input notifications everywhere (they're actionable).
        const isForeground = conversation.id === ws.selectedId;
        const skip = conversation.status === "done" && isForeground;
        if (!skip) {
          const runToast = runToastForStatus(conversation.status, conversation.title, t);
          if (runToast) {
            toast({ ...runToast, duration: 3500 });
          }
          showDesktopNotification(ws.settings.general.desktopNotifications, runNotificationForStatus(conversation.status, conversation.title, t));
        }
      }
    }
    previousStatuses.current = nextStatuses;
  }, [ws.chats, ws.projects, ws.selectedId, ws.settings.general.desktopNotifications, t, toast]);

  const openConversation = (id: string, updateRoute = true) => {
    ws.select(id);
    const conv = ws.find(id);
    if (conv) {
      setProfile(conversationProfile(conv));
    }
    if (updateRoute) {
      onNavigate?.(routeForConversation(ws, id));
    }
    setDrawerOpen(false);
    setRunKey((k) => k + 1);
  };

  const navigateAfterConversationRemoval = (nextConversationId: string) => {
    if (nextConversationId && ws.find(nextConversationId)) {
      onNavigate?.(routeForConversation(ws, nextConversationId));
    } else {
      onNavigate?.({ kind: "home" });
    }
    setRunKey((k) => k + 1);
  };

  const removeConversation = (id: string) => {
    cancelDraftSave(id);
    pendingDraftValues.current.delete(id);
    notifiableRuns.current.delete(id);
    const nextConversationId = ws.remove(id);
    navigateAfterConversationRemoval(nextConversationId);
  };

  // Create a new conversation immediately (no draft/prelude step) and focus the
  // composer so the user can start typing right away. `projectId` undefined ⇒ a
  // standalone simple chat; otherwise the chat is created inside that project.
  const createConversation = (projectId?: string) => {
    const newProfile = ws.settings.agents.defaultProfile ?? DEFAULT_PROFILE;
    setProfile(newProfile);
    const id = projectId ? ws.newProjectChat(projectId, newProfile) : ws.newChat(newProfile);
    setNewChatMenuAnchor(null);
    setDrawerOpen(false);
    setView("chat");
    ws.setConversationView(id, "chat");
    setRunKey((k) => k + 1);
    onNavigate?.(routeForConversation(ws, id));
    // Defer focus until the freshly-created conversation's composer has mounted.
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const submitComposerText = (text: string) => {
    const activeConversation = ws.find(ws.selectedId);
    let targetId = activeConversation?.id ?? "";
    if (!targetId) {
      const newProfile = ws.settings.agents.defaultProfile ?? DEFAULT_PROFILE;
      const projectId = routeKind === "project" && routeProjectId && ws.projects.some((project) => project.id === routeProjectId) ? routeProjectId : undefined;
      setProfile(newProfile);
      targetId = projectId ? ws.newProjectChat(projectId, newProfile) : ws.newChat(newProfile);
      setView("chat");
      ws.setConversationView(targetId, "chat");
      setRunKey((k) => k + 1);
      onNavigate?.(routeForConversation(ws, targetId));
    }
    pendingDraftValues.current.delete(targetId);
    cancelDraftSave(targetId);
    ws.updateComposerDraft(targetId, EMPTY_COMPOSER_DRAFT);
    notifiableRuns.current.add(targetId);
    ws.sendMessage(targetId, text);
  };

  const handleCliUpdate = async (update: CliUpdateInfo) => {
    setCliUpdateBusyAgent(update.agent);
    toast({ message: t("cliUpdateStarted", { agent: update.agentName }), severity: "info", duration: 2500 });
    try {
      await updateAgentCli(update.agent);
      reloadAgentStatus();
      setCliUpdateSnapshot((snapshot) => clearCliUpdateForAgent(snapshot, update.agent));
      const refreshed = await loadCliUpdates(true);
      setCliUpdateSnapshot((snapshot) =>
        refreshed.updates.some((candidate) => candidate.agent === update.agent)
          ? clearCliUpdateForAgent(refreshed, update.agent)
          : refreshed,
      );
      toast({ message: t("cliUpdateComplete", { agent: update.agentName }), severity: "success", duration: 2500 });
    } catch (error) {
      toast({ message: t("cliUpdateFailed", { error: error instanceof Error ? error.message : String(error) }), severity: "error", duration: 5000 });
    } finally {
      setCliUpdateBusyAgent(null);
    }
  };

  const openPicker = () => {
    setPickerOpen(true);
  };

  const openKit = () => {
    if (onNavigate) {
      onNavigate({ kind: "kit" });
      return;
    }

    window.location.hash = "#/kit";
  };

  // The picker now only switches the agent (for the draft or the open
  // conversation); new chats default to the configured agent.
  const handlePicked = (picked: AgentProfile) => {
    setProfile(picked);
    if (selected) {
      ws.setConversationProfile(ws.selectedId, picked);
    }
  };

  const supportedModes = useMemo<readonly { readonly id: string; readonly label: string }[]>(() => {
    const def = getAgent(profile.agent);
    const cliModes = cliInfoOf(profile.agent)?.modes;
    const sourceModes = cliModes && cliModes.length > 0 ? cliModes : def.modes;
    return sourceModes
      .filter((mode) => mode.id !== DEFAULT_AGENT_OPTION_ID && mode.id !== "auto" && mode.id !== "bypass-permissions")
      .map((mode) => ({
        id: mode.id,
        label: mode.id === "plan" ? t("agentModePlan") : mode.label,
      }));
  }, [cliInfoOf, profile.agent, t]);
  const handleModeChange = (modeId: string) => {
    const next = normalizeAgentProfile({ ...profile, mode: modeId });
    setProfile(next);
    if (selected) {
      ws.setConversationProfile(ws.selectedId, next);
    }
  };
  const handleAutoConfirmChange = (enabled: boolean) => {
    const next = normalizeAgentProfile({ ...profile, autoConfirm: enabled });
    setProfile(next);
    if (selected) {
      ws.setConversationProfile(ws.selectedId, next);
    }
  };

  const persistedSidebarWidth = normalizeSidebarWidth(ws.settings.appearance.sidebarWidth);
  useEffect(() => {
    if (isResizingSidebar || sidebarWidthRef.current === persistedSidebarWidth) {
      return;
    }
    sidebarWidthRef.current = persistedSidebarWidth;
    setSidebarWidth(persistedSidebarWidth);
  }, [isResizingSidebar, persistedSidebarWidth]);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
    if (sidebarShellRef.current) {
      sidebarShellRef.current.style.width = sidebarCollapsed ? "0px" : `${sidebarWidth}px`;
    }
    if (sidebarInnerRef.current) {
      sidebarInnerRef.current.style.width = `${sidebarWidth}px`;
    }
  }, [sidebarCollapsed, sidebarWidth]);

  const startSidebarResize = (event: ReactMouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidthRef.current;
    let latestWidth = startWidth;
    setIsResizingSidebar(true);
    const applyWidth = (next: number) => {
      latestWidth = next;
      sidebarWidthRef.current = next;
      if (resizeFrameRef.current != null) {
        return;
      }
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        if (sidebarShellRef.current) {
          sidebarShellRef.current.style.width = `${sidebarWidthRef.current}px`;
        }
        if (sidebarInnerRef.current) {
          sidebarInnerRef.current.style.width = `${sidebarWidthRef.current}px`;
        }
      });
    };
    const onMove = (moveEvent: MouseEvent) => {
      const next = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, startWidth + (moveEvent.clientX - startX)));
      applyWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      if (sidebarShellRef.current) {
        sidebarShellRef.current.style.width = `${latestWidth}px`;
      }
      if (sidebarInnerRef.current) {
        sidebarInnerRef.current.style.width = `${latestWidth}px`;
      }
      const normalizedWidth = normalizeSidebarWidth(latestWidth);
      setSidebarWidth(normalizedWidth);
      ws.updateSettings({ appearance: { sidebarWidth: normalizedWidth } });
      setIsResizingSidebar(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Files can be dropped anywhere on the chat pane; the whole pane dims and the
  // dropped files are handed to the active composer.
  const paneDragHasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types ?? []).includes("Files");
  const onPaneDragEnter = (event: DragEvent) => {
    if (!paneDragHasFiles(event)) {
      return;
    }
    event.preventDefault();
    setPaneDragDepth((depth) => depth + 1);
  };
  const onPaneDragOver = (event: DragEvent) => {
    if (!paneDragHasFiles(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const onPaneDragLeave = (event: DragEvent) => {
    if (!paneDragHasFiles(event)) {
      return;
    }
    setPaneDragDepth((depth) => Math.max(0, depth - 1));
  };
  const onPaneDrop = (event: DragEvent) => {
    if (!paneDragHasFiles(event)) {
      return;
    }
    event.preventDefault();
    setPaneDragDepth(0);
    void composerRef.current?.addFiles(Array.from(event.dataTransfer.files));
  };

  const handleCreateProject = (input: Parameters<typeof ws.createProject>[0]) => {
    try {
      const created = ws.createProject(input);
      onNavigate?.({ kind: "project", projectId: created.projectId, conversationId: created.conversationId });
      setRunKey((k) => k + 1);
      toast({ message: t("newProjectChatWith", { agent: input.profile.agent, project: input.name }), severity: "info", duration: 2500 });
    } catch (error) {
      toast({ message: error instanceof Error ? error.message : String(error), severity: "error", duration: 3000 });
    }
  };

  const conversationActions = {
    onRename: ws.rename,
    onTogglePin: ws.togglePin,
    onArchive: (id: string) => {
      ws.archive(id);
      toast({ message: t("conversationArchived"), severity: "info", duration: 2500 });
    },
    onDelete: (id: string) => {
      if (ws.settings.general.confirmDestructiveActions) {
        setConfirmDelete(id);
        return;
      }
      removeConversation(id);
      toast({ message: t("conversationDeleted"), severity: "warning", duration: 2500 });
    },
  };

  const doDelete = () => {
    if (confirmDelete) {
      removeConversation(confirmDelete);
      setConfirmDelete(null);
      toast({ message: t("conversationDeleted"), severity: "warning", duration: 2500 });
    }
  };

  const messageActions = {
    onCopy: async (message: ChatMessage) => {
      try {
        await navigator.clipboard.writeText(messageToPlainText(message));
        toast({ message: t("messageCopied"), severity: "success", duration: 1800 });
      } catch {
        toast({ message: t("clipboardUnavailable"), severity: "error", duration: 2500 });
      }
    },
    // Hide retry while the agent is working (no retrying an in-flight turn);
    // an undefined handler removes the button in MessageActionBar.
    onRetry: selectedHasActiveWork
      ? undefined
      : (message: ChatMessage) => {
          notifiableRuns.current.add(ws.selectedId);
          ws.retryMessage(ws.selectedId, message.id);
        },
    onFork: (message: ChatMessage) => {
      const forkId = ws.forkConversationFromMessage(ws.selectedId, message.id);
      if (!forkId) {
        return;
      }
      const fork = ws.find(forkId);
      if (fork) {
        setProfile(conversationProfile(fork));
      }
      setView("chat");
      ws.setConversationView(forkId, "chat");
      setRunKey((k) => k + 1);
      onNavigate?.(routeForConversation(ws, forkId));
      toast({ message: t("forkedConversationCreated"), severity: "success", duration: 2200 });
    },
    onEditAndResend: (message: ChatMessage, text: string) => {
      notifiableRuns.current.add(ws.selectedId);
      ws.editAndResendMessage(ws.selectedId, message.id, text);
    },
    onApprovalDecision: async (approvalId: string, decision: ApprovalDecision) => {
      try {
        const response = await fetch("/api/run-approval", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: approvalId, decision }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Approval decision failed (${response.status})`);
        }
        ws.decideApproval(ws.selectedId, approvalId, decision);
      } catch (error) {
        toast({ message: error instanceof Error ? error.message : String(error), severity: "error", duration: 3000 });
        throw error;
      }
    },
    onOptionSelection: async (optionBlockId: string, selectedLabels: readonly string[]) => {
      try {
        const response = await fetch("/api/run-input", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: optionBlockId, selected: selectedLabels }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Option selection failed (${response.status})`);
        }
        ws.selectOptions(ws.selectedId, optionBlockId, selectedLabels);
      } catch (error) {
        toast({ message: error instanceof Error ? error.message : String(error), severity: "error", duration: 3000 });
        throw error;
      }
    },
  };

  const commandItems: readonly CommandPaletteItem[] = [
    {
      id: "new-conversation",
      label: t("commandNewConversation"),
      keywords: [t("newConversation"), t("newChat")],
      shortcut: ["Ctrl", "N"],
      action: () => createConversation(),
    },
    {
      id: "search-conversations",
      label: t("searchConversations"),
      keywords: [t("chats"), t("projects"), "search"],
      action: () => {
        void ws.loadAllThreads();
        setSearchOpen(true);
      },
    },
    {
      id: "open-settings",
      label: t("commandOpenSettings"),
      keywords: [t("settings"), t("appearance"), t("general")],
      shortcut: ["Ctrl", ","],
      action: () => setSettingsOpen(true),
    },
    {
      id: "open-git",
      label: t("commandOpenGit"),
      keywords: [t("git"), t("gitStatus")],
      action: () => showView("git"),
    },
    {
      id: "open-preview",
      label: t("commandOpenPreview"),
      keywords: [t("previewTab"), t("browserPreviewTitle")],
      action: () => showView("preview"),
    },
    {
      id: "toggle-theme",
      label: t("commandToggleTheme"),
      keywords: [t("theme"), t("dark"), t("light")],
      action: () => ws.updateSettings({ appearance: { theme: mode === "dark" ? "light" : "dark" } }),
    },
    {
      id: "open-kit",
      label: t("commandOpenKit"),
      keywords: [t("kit")],
      action: openKit,
    },
  ];

  if (ws.loadError && !ws.loaded) {
    return (
      <Box sx={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "background.default", p: 2 }}>
        <Alert
          severity="error"
          action={
            <Button variant="subtle" size="small" onClick={ws.reloadWorkspace} disabled={ws.loading}>
              {t("retryWorkspaceLoad")}
            </Button>
          }
          sx={{ ...WORKSPACE_ERROR_ALERT_SX, maxWidth: 720, width: "100%" }}
        >
          {t("workspaceError", { error: ws.loadError })}
        </Alert>
      </Box>
    );
  }

  const primaryCliUpdate = cliUpdateSnapshot.updates[0] ?? null;
  const extraCliUpdateCount = Math.max(0, cliUpdateSnapshot.updates.length - 1);
  const cliUpdateNotice = primaryCliUpdate ? (
    <Box sx={{ px: 0.75, pb: 1, flex: "0 0 auto" }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: "center",
          px: 1.25,
          py: 1,
          borderRadius: (theme) => `${theme.custom.radii.md}px`,
          backgroundColor: (theme) => theme.custom.surfaces.s2,
          border: (theme) => `1px solid ${theme.palette.status.warn.main}`,
          boxShadow: (theme) => `inset 3px 0 0 0 ${theme.palette.status.warn.main}`,
        }}
      >
        <Box sx={{ display: "flex", color: (theme) => theme.palette.status.warn.main, flex: "0 0 auto" }}>
          <SystemUpdateAltIcon sx={{ fontSize: 20 }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: "0.8rem", fontWeight: 700, color: "text.primary" }}>
            {t("cliUpdateRequired")}
          </Typography>
          <Typography noWrap sx={{ fontSize: "0.72rem", color: "text.secondary", mt: 0.25 }}>
            {t("cliUpdateAvailable", { agent: primaryCliUpdate.agentName, current: primaryCliUpdate.currentVersion, latest: primaryCliUpdate.latestVersion })}
            {extraCliUpdateCount > 0 ? ` · ${t("cliUpdateMore", { count: extraCliUpdateCount })}` : ""}
          </Typography>
        </Box>
        <Button
          variant="subtle"
          size="small"
          disabled={cliUpdateBusyAgent !== null}
          onClick={() => void handleCliUpdate(primaryCliUpdate)}
          sx={{ flex: "0 0 auto", minWidth: 78 }}
        >
          {t("updateCli")}
        </Button>
      </Stack>
    </Box>
  ) : null;

  const sidebar = (
    <Stack sx={{ height: "100%", minHeight: 0, backgroundColor: (t) => t.custom.surfaces.s1 }}>
      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "space-between", px: SIDEBAR_INSET, minHeight: HEADER_MIN_HEIGHT, flex: "0 0 auto", borderBottom: (t) => `1px solid ${t.custom.borders.subtle}` }}
      >
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", minWidth: 0 }}>
          <Tooltip title={t("toggleSidebar")}>
            <IconButton aria-label={t("toggleSidebar")} onClick={() => setSidebarCollapsed(true)} sx={{ display: { xs: "none", md: "inline-flex" } }}>
              <MenuOpenIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Typography noWrap sx={{ fontFamily: (t) => t.custom.fonts.mono, fontWeight: 700, fontSize: "0.9rem" }}>{t("appTitle")}</Typography>
        </Stack>
        <Stack direction="row" spacing={0.25}>
          <Tooltip title={t("searchConversations")}>
            <IconButton
              aria-label={t("searchConversations")}
              onClick={() => {
                void ws.loadAllThreads();
                setSearchOpen(true);
              }}
            >
              <SearchIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("settings")}>
            <IconButton aria-label={t("settings")} onClick={() => setSettingsOpen(true)}>
              <SettingsIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("newProject")}>
            <IconButton aria-label={t("newProject")} onClick={() => setProjectDialogOpen(true)}>
              <CreateNewFolderIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("newConversation")}>
            <IconButton aria-label={t("newConversation")} onClick={(event) => setNewChatMenuAnchor(event.currentTarget)}>
              <AddIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={newChatMenuAnchor}
            open={Boolean(newChatMenuAnchor)}
            onClose={() => setNewChatMenuAnchor(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
            slotProps={{ list: { dense: true } }}
          >
            <MenuItem onClick={() => createConversation()} sx={{ gap: 1, fontSize: "0.8rem" }}>
              <ChatBubbleOutlineIcon sx={{ fontSize: 16, color: "text.secondary" }} />
              <Box component="span">{t("simpleChatOption")}</Box>
            </MenuItem>
            {ws.projects.length > 0 && <Divider sx={{ my: 0.5 }} />}
            {ws.projects.map((project) => (
              <MenuItem key={project.id} onClick={() => createConversation(project.id)} sx={{ gap: 1, fontSize: "0.8rem" }}>
                <FolderOutlinedIcon sx={{ fontSize: 16, color: "text.secondary" }} />
                <Box component="span" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.name}</Box>
              </MenuItem>
            ))}
          </Menu>
        </Stack>
      </Stack>

      <ConversationList projects={ws.projects} chats={ws.chats} selectedId={ws.selectedId} onSelect={openConversation} actions={conversationActions} wakeupConversationIds={wakeupConversationIds} />
      {cliUpdateNotice}
    </Stack>
  );

  return (
    <WorkspaceUiProvider value={uiApi}>
    <Box sx={{ height: "100dvh", display: "flex", overflow: "hidden", bgcolor: "background.default" }}>
      <Box
        ref={sidebarShellRef}
        sx={{
          display: { xs: "none", md: "block" },
          width: sidebarCollapsed ? 0 : sidebarWidth,
          flex: "0 0 auto",
          overflow: "hidden",
          transition: isResizingSidebar ? "none" : "width 200ms ease",
        }}
      >
        <Box ref={sidebarInnerRef} sx={{ width: sidebarWidth, height: "100%" }}>{sidebar}</Box>
      </Box>
      {!sidebarCollapsed && (
        <Box
          role="separator"
          aria-orientation="vertical"
          aria-label={t("resizeSidebar")}
          onMouseDown={startSidebarResize}
          sx={{
            display: { xs: "none", md: "block" },
            flex: "0 0 auto",
            width: "1px",
            cursor: "col-resize",
            backgroundColor: (t) => t.custom.borders.subtle,
            transition: "background-color 120ms ease",
            "&:hover": { backgroundColor: (t) => t.palette.status.running.main },
          }}
        />
      )}

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} sx={{ display: { md: "none" } }} slotProps={{ paper: { sx: { width: DEFAULT_SIDEBAR_WIDTH, backgroundImage: "none" } } }}>
        {sidebar}
      </Drawer>

      <Box
        sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", position: "relative" }}
        onDragEnter={onPaneDragEnter}
        onDragOver={onPaneDragOver}
        onDragLeave={onPaneDragLeave}
        onDrop={onPaneDrop}
      >
        {paneDragging && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              zIndex: 30,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 1.25,
              flexDirection: "column",
              color: "text.primary",
              backgroundColor: "rgba(8, 11, 14, 0.66)",
              backdropFilter: "blur(1px)",
              animation: `${dropIn} 140ms ease both`,
              pointerEvents: "none",
            }}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                px: 2.5,
                py: 1.75,
                borderRadius: (t) => `${t.custom.radii.lg}px`,
                border: (t) => `1.5px dashed ${t.custom.borders.strong}`,
                backgroundColor: (t) => t.custom.surfaces.s2,
                boxShadow: "0 16px 48px rgba(0, 0, 0, 0.5)",
              }}
            >
              <AttachFileIcon sx={{ fontSize: 20, color: (t) => t.palette.status.info.main }} />
              <Typography sx={{ fontSize: "0.92rem", fontWeight: 700 }}>{t("dropFilesHint")}</Typography>
            </Box>
          </Box>
        )}
        <Box component="header" sx={{ flex: "0 0 auto", backgroundColor: (t) => t.custom.surfaces.s1 }}>
          <Stack
            direction="row"
            spacing={1.5}
            sx={{ alignItems: "center", justifyContent: "space-between", px: SIDEBAR_INSET, minHeight: HEADER_MIN_HEIGHT, borderBottom: (t) => `1px solid ${t.custom.borders.subtle}` }}
          >
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", minWidth: 0 }}>
              {/* Mobile: opens the drawer. Desktop: only shown to re-open a
                  collapsed sidebar. */}
              <IconButton
                aria-label={t("openConversations")}
                onClick={() => {
                  setDrawerOpen(true);
                  setSidebarCollapsed(false);
                }}
                sx={{ display: { xs: "inline-flex", md: sidebarCollapsed ? "inline-flex" : "none" } }}
              >
                <MenuIcon sx={{ fontSize: 20 }} />
              </IconButton>
              <Box sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ fontFamily: (t) => t.custom.fonts.mono, fontWeight: 700, fontSize: "0.9rem" }}>
                  {headerTitle}
                </Typography>
                {activeCwd && (
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", display: { xs: "none", sm: "flex" } }}>
                    <FolderOutlinedIcon sx={{ fontSize: 12, color: "text.secondary" }} />
                    <Typography noWrap sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.64rem", color: "text.secondary" }}>
                      {activeCwd}
                    </Typography>
                  </Stack>
                )}
              </Box>
            </Stack>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flex: "0 0 auto", "& .MuiIconButton-root": { width: 30, height: 30 } }}>
              {selected && <AgentBadge profile={profile} onClick={openPicker} compact />}
              <ToggleButtonGroup
                size="small"
                exclusive
                value={view}
                onChange={(_, next: ConversationView | null) => next && showView(next)}
                aria-label={t("viewSwitcher")}
                sx={{
                  // Single bordered container with borderless segments inside, so
                  // the selected highlight fills its segment edge-to-edge (no
                  // uneven gap between the highlight and the group border).
                  height: 30,
                  alignItems: "stretch",
                  borderRadius: (t) => `${t.custom.radii.sm}px`,
                  border: (t) => `1px solid ${t.custom.borders.subtle}`,
                  backgroundColor: (t) => t.custom.surfaces.s2,
                  overflow: "hidden",
                  "& .MuiToggleButton-root": {
                    border: 0,
                    borderRadius: 0,
                    height: "100%",
                    px: 1.25,
                    py: 0,
                    gap: 0.5,
                    textTransform: "none",
                    fontFamily: (t) => t.custom.fonts.mono,
                    fontSize: "0.74rem",
                    color: "text.secondary",
                    "&:not(:first-of-type)": { borderLeft: (t) => `1px solid ${t.custom.borders.subtle}` },
                    "&.Mui-selected": { color: "text.primary", backgroundColor: (t) => t.custom.surfaces.s3 },
                    "&.Mui-selected:hover": { backgroundColor: (t) => t.custom.surfaces.s3 },
                  },
                }}
              >
                <ToggleButton value="chat" aria-label={t("chatTab")}>
                  <ChatBubbleOutlineIcon sx={{ fontSize: 15 }} />
                  <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>{t("chatTab")}</Box>
                </ToggleButton>
                <ToggleButton value="git" aria-label={t("git")}>
                  <AccountTreeIcon sx={{ fontSize: 15 }} />
                  <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>{t("git")}</Box>
                  {(gitUnstaged.additions > 0 || gitUnstaged.deletions > 0) && (
                    <Box component="span" sx={{ ml: 0.5, display: "inline-flex", gap: 0.5, fontSize: "0.64rem", fontWeight: 700 }}>
                      <Box component="span" sx={{ color: (t) => t.palette.status.ok.main }}>+{gitUnstaged.additions}</Box>
                      <Box component="span" sx={{ color: (t) => t.palette.status.error.main }}>−{gitUnstaged.deletions}</Box>
                    </Box>
                  )}
                </ToggleButton>
                <ToggleButton value="resources" aria-label={t("resourcesTab")}>
                  <InsertDriveFileOutlinedIcon sx={{ fontSize: 15 }} />
                  <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>{t("resourcesTab")}</Box>
                </ToggleButton>
                <ToggleButton value="preview" aria-label={t("previewTab")}>
                  <OpenInBrowserIcon sx={{ fontSize: 15 }} />
                  <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>{t("previewTab")}</Box>
                </ToggleButton>
                {showTerminal && (
                  <ToggleButton value="terminal" aria-label={t("terminalTab")}>
                    <TerminalIcon sx={{ fontSize: 15 }} />
                    <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>{t("terminalTab")}</Box>
                  </ToggleButton>
                )}
              </ToggleButtonGroup>
            </Stack>
          </Stack>
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <Box sx={{ width: "100%", maxWidth: THREAD_MAX_WIDTH, mx: "auto", px: THREAD_PADDING_X, "&:empty": { display: "none" }, "&:not(:empty)": { pt: 2 } }}>
              {ws.loadError && (
              <Alert
                severity="error"
                action={
                  <Button variant="subtle" size="small" onClick={ws.reloadWorkspace}>
                    {t("retryWorkspaceLoad")}
                  </Button>
                }
                sx={{ ...WORKSPACE_ERROR_ALERT_SX, mb: 2 }}
              >
                {t("workspaceError", { error: ws.loadError })}
              </Alert>
            )}
            {agentStatusError && (
              <Alert
                severity="error"
                action={
                  <Button variant="subtle" size="small" onClick={reloadAgentStatus}>
                    {t("retryAgentDetection")}
                  </Button>
                }
                sx={{ mb: 2 }}
              >
                {t("agentDetectionError", { error: agentStatusError })}
              </Alert>
            )}
            {noAgentsAvailable && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {t("noAgentsAvailable")}
              </Alert>
            )}
            </Box>
            <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
              {/* Chat and Git are both kept mounted; only the active one is shown,
                  so the Git view keeps its scroll/expanded state across chat switches. */}
              <Box sx={{ position: "absolute", inset: 0, display: view === "chat" ? "block" : "none" }}>
                {!selected ? (
                  <Stack sx={{ height: "100%", justifyContent: "center", alignItems: "center", px: THREAD_PADDING_X }}>
                    <EmptyState
                      icon={<ChatBubbleOutlineIcon />}
                      title={t("noConversationSelected")}
                      description={t("pickConversation")}
                      action={<Button variant="contained" onClick={() => createConversation()}>{t("newChat")}</Button>}
                    />
                  </Stack>
                ) : messages.length === 0 ? (
                  <Stack sx={{ height: "100%", justifyContent: "center", alignItems: "center", px: THREAD_PADDING_X }}>
                    <EmptyState
                      icon={<ChatBubbleOutlineIcon />}
                      title={t("startConversation")}
                      description={t(profileAccessMode === "unrestricted" ? "messageAgentAccess" : "messageAgentReadOnlyAccess", { title: selected.title })}
                    />
                  </Stack>
                ) : (
                  <Conversation
                    key={`${ws.selectedId}-${runKey}`}
                    messages={messages}
                    typing={selected.status === "running" && messages[messages.length - 1]?.role === "user"}
                    actions={messageActions}
                    agentProfile={conversationProfile(selected)}
                    displayPrefs={{ reasoningAutoExpand: ws.settings.appearance.reasoningAutoExpand }}
                    contentMaxWidth={THREAD_MAX_WIDTH}
                    contentPaddingX={THREAD_PADDING_X}
                    bottomInset={contentBottomInset}
                  />
                )}
              </Box>
              <Box sx={{ position: "absolute", inset: 0, display: view === "git" ? "block" : "none" }}>
                <GitView
                  cwd={selectedCwd}
                  lastTurnDiffs={lastTurnDiffs}
                  review={selected ? review : undefined}
                  active={view === "git"}
                  onUnstagedStatsChange={setGitUnstaged}
                  bottomInset={contentBottomInset}
                  focusPath={gitFocus.path}
                  focusNonce={gitFocus.nonce}
                  reloadSignal={gitReloadSignal}
                  worktree={worktreeApi}
                />
              </Box>
              {/* Mounted only while active: it derives purely from the thread
                  (no scroll/expanded state to preserve), and keeping it mounted
                  would duplicate file/link text into the hidden DOM. */}
              {view === "resources" && (
                <Box sx={{ position: "absolute", inset: 0 }}>
                  <ResourcesPanel messages={messages} bottomInset={contentBottomInset} />
                </Box>
              )}
              <Box sx={{ position: "absolute", inset: 0, display: view === "preview" ? "block" : "none" }}>
                {selected ? (
                  <BrowserPreview
                    sessionId={selected.id}
                    active={view === "preview"}
                    bridgeActive={view === "preview" || selectedHasActiveWork}
                    onSendAnnotation={sendBrowserAnnotation}
                    onActivityEventsChange={setBrowserActivityEvents}
                    openRequest={browserOpenRequest}
                    serverHostOverride={ws.settings.general.previewServerHost}
                    bottomInset={view === "preview" ? contentBottomInset : 0}
                  />
                ) : null}
              </Box>
              {/* Keyed by folder so each project's terminal keeps its own scrollback. */}
              {showTerminal && (
                <Box sx={{ position: "absolute", inset: 0, display: view === "terminal" ? "block" : "none" }}>
                  <TerminalView key={terminalCwd ?? "none"} cwd={terminalCwd} />
                </Box>
              )}
            </Box>
          </Box>
        </Box>

        {/* The composer floats over the thread (absolute) with a soft fade behind
            it and a gap below, rather than sitting in a bordered bar that pushes
            the thread up. Hidden in the terminal/preview views (composerVisible). */}
        {composerVisible && (
        <Box
          sx={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 8,
            pointerEvents: "none",
            background: (t) => `linear-gradient(to top, ${t.palette.background.default} 46%, ${t.palette.background.default}00)`,
          }}
        >
          <Box
            ref={composerDockRef}
            sx={{ width: "100%", maxWidth: THREAD_MAX_WIDTH, mx: "auto", px: THREAD_PADDING_X, pt: 2.5, pb: 2, pointerEvents: "auto" }}
          >
            {workspaceHydrating ? (
              <Box aria-busy="true" sx={{ minHeight: 44 }} />
            ) : (
              <Stack spacing={1}>
                <Composer
                  key={ws.selectedId}
                  ref={composerRef}
                  placeholder={selected ? t("messagePlaceholder", { title: buildComposerLabel(profile) }) : t("startPlaceholder")}
                  initialValue={composerDraft.text}
                  initialAttachments={composerDraft.attachments}
                  onDraftChange={(draft) => {
                    if (selected) {
                      scheduleDraftSave(ws.selectedId, draft);
                    }
                  }}
                  onSend={(text) => {
                    submitComposerText(text);
                  }}
                  mentionableFiles={mentionableFiles}
                  modes={supportedModes}
                  activeMode={profile.mode}
                  onModeChange={handleModeChange}
                  autoConfirm={profile.autoConfirm ?? false}
                  supportsAutoConfirm={AGENT_AUTO_CONFIRM_AGENTS.has(profile.agent)}
                  onAutoConfirmChange={handleAutoConfirmChange}
                  onStop={() => ws.stopRun(ws.selectedId)}
                  onAttachmentError={(message) => toast({ message, severity: "error", duration: 3000 })}
                  running={selectedHasActiveWork}
                  reviewCount={reviewComments.length}
                  onSendReview={sendReviewComments}
                  onTagsHeightChange={setComposerTagsHeight}
                  onOverlayLiftChange={setComposerOverlayLift}
                  history={messageHistory}
                  agentId={profile.agent}
                  agentLimit={agentLimits[profile.agent] ?? null}
                  agentLimitLoaded={agentLimitsLoaded}
                  agentLimitRefreshing={agentLimitRefreshing[profile.agent] === true}
                  agentLimitRefreshError={agentLimitRefreshErrors[profile.agent] ?? null}
                  onRefreshAgentLimits={(requestRefresh) => refreshAgentLimits(profile.agent, requestRefresh)}
                  contextTokens={selected?.usage?.contextTokens}
                  contextWindow={contextWindowForAgentProfile(profile)}
                  autoCompact={selected?.compaction?.auto ?? true}
                  compactWindow={selected?.compaction?.window}
                  onAutoCompactChange={(enabled) => {
                    if (selected) {
                      ws.setCompaction(selected.id, { auto: enabled });
                    }
                  }}
                  onCompactWindowChange={(window) => {
                    if (selected) {
                      ws.setCompaction(selected.id, { window });
                    }
                  }}
                  onCompactNow={() => {
                    if (!selected) {
                      return;
                    }
                    if (!ws.compactConversation(selected.id)) {
                      toast({ message: t("compactionNoSession"), severity: "info", duration: 3000 });
                    }
                  }}
                  queuedMessageCount={selected ? ws.pendingMessageCount(selected.id) : 0}
                  onSendQueuedNow={() => {
                    if (selected) {
                      ws.sendQueuedMessageNow(selected.id);
                    }
                  }}
                  voiceProvider={composerVoiceProvider}
                  onVoiceError={(message) => toast({ message, severity: "error", duration: 3500 })}
                  browserActivityEvents={view === "preview" ? browserActivityEvents : undefined}
                  registeredPlugins={registeredPlugins}
                  scheduledWakeups={selectedWakeups.map((wakeup) => ({
                    id: wakeup.id,
                    label: wakeupLabel(wakeup, locale),
                    removeLabel: locale === "ru" ? "Убрать запланированную задачу" : "Remove scheduled wakeup",
                    onRemove: () => removeWakeup(wakeup.id),
                  }))}
                />
              </Stack>
            )}
          </Box>
        </Box>
        )}
      </Box>

      <AgentPicker open={pickerOpen} value={profile} onClose={() => setPickerOpen(false)} onSelect={handlePicked} />
      <ConversationSearch
        open={searchOpen}
        projects={ws.projects}
        chats={ws.chats}
        threads={ws.threads}
        onClose={() => setSearchOpen(false)}
        onSelect={openConversation}
      />
      <CommandPalette open={commandPaletteOpen} items={commandItems} onClose={() => setCommandPaletteOpen(false)} />
      <CreateProjectDialog open={projectDialogOpen} defaultProfile={ws.settings.agents.defaultProfile} onClose={() => setProjectDialogOpen(false)} onCreate={handleCreateProject} />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={ws.settings}
        onSettingsChange={ws.updateSettings}
        onVoiceConfigChange={refreshVoiceConfig}
      />

      <Dialog open={confirmDelete != null} onClose={() => setConfirmDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("deleteConversationTitle")}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t("deleteConversationBody")}</DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2 }}>
          <Button variant="text" onClick={() => setConfirmDelete(null)}>
            {t("cancel")}
          </Button>
          <Button variant="contained" color="error" onClick={doDelete}>
            {t("delete")}
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
    </WorkspaceUiProvider>
  );
}
