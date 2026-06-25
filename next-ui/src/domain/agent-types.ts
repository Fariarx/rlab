import type { AgentId, AgentProfile } from "../lib/agent-catalog";
import type { StatusKey } from "../theme/tokens";

/** Run state shared by tool/command/plan-step style blocks. */
export type RunState = "pending" | "running" | "ok" | "error";

export interface ToolBlock {
  readonly kind: "tool";
  readonly name: string;
  readonly summary?: string;
  readonly args?: Readonly<Record<string, string>>;
  readonly output?: string;
  readonly state: RunState;
  readonly duration?: string;
}

export interface CommandBlock {
  readonly kind: "command";
  readonly command: string;
  readonly output?: string;
  readonly state: RunState;
  readonly exitCode?: number;
}

export interface DiffBlock {
  readonly kind: "diff";
  readonly file: string;
  readonly additions: number;
  readonly deletions: number;
  readonly lines: ReadonlyArray<{ readonly type: "add" | "del" | "ctx"; readonly text: string }>;
}

export interface SearchBlock {
  readonly kind: "search";
  readonly query: string;
  readonly state: RunState;
  readonly results: ReadonlyArray<{ readonly title: string; readonly url: string }>;
}

export interface PlanBlock {
  readonly kind: "plan";
  readonly steps: ReadonlyArray<{ readonly label: string; readonly state: RunState }>;
}

export interface ReasoningBlock {
  readonly kind: "reasoning";
  readonly text: string;
  /** When true, renders the live "thinking" animation instead of a summary. */
  readonly active?: boolean;
  readonly duration?: string;
  /** Epoch ms when the turn started, so a live elapsed timer shows the real
   *  wall-clock time even after a page reload (not time-since-mount). */
  readonly startedAtMs?: number;
}

export interface TextBlock {
  readonly kind: "text";
  readonly text: string;
  /** Appends a blinking caret to convey live streaming. */
  readonly streaming?: boolean;
  /** The final answer text (the trailing text after the last reasoning/tool).
   *  Only result text escapes the Reasoning container; narration text that
   *  arrived before/between tool calls stays inline with them. */
  readonly result?: boolean;
}

export interface CodeBlockData {
  readonly kind: "code";
  readonly language: string;
  readonly code: string;
}

export interface OptionsBlock {
  readonly kind: "options";
  readonly id?: string;
  readonly prompt: string;
  readonly multi?: boolean;
  readonly options: ReadonlyArray<{ readonly id: string; readonly label: string; readonly description?: string }>;
  readonly selected?: readonly string[];
}

export interface ApprovalBlock {
  readonly kind: "approval";
  readonly id?: string;
  readonly title: string;
  readonly detail?: string;
  readonly decision?: ApprovalDecision;
}

export type ApprovalDecision = "approved" | "rejected";

export interface StatusBlock {
  readonly kind: "status";
  readonly level: StatusKey;
  readonly text: string;
  /** Force the status into the visible answer stream even when partial text exists. */
  readonly surface?: boolean;
}

export interface CitationBlock {
  readonly kind: "citation";
  readonly sources: ReadonlyArray<{ readonly label: string; readonly url: string }>;
}

export interface SuggestedActionsBlock {
  readonly kind: "suggested";
  readonly actions: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly icon?: SuggestedActionIconKey;
    readonly tone?: "default" | "primary" | "danger";
  }>;
}

export type SuggestedActionIconKey = "arrow-forward" | "copy" | "refresh";

/** Compact source anchor for a code-review comment attached to a diff line. */
export interface ReviewCommentAnchor {
  /** 1-based line number within the rendered diff. */
  readonly line: number;
  readonly lineText: string;
  /** Exact rendered diff line, including the unified-diff prefix when present. */
  readonly diffLine?: string;
  /** Nearest unified-diff hunk header above the line, when present. */
  readonly hunkHeader?: string;
  /** A small set of nearby rendered diff lines with rendered diff line numbers. */
  readonly diffContext?: readonly string[];
}

/** A single code-review comment a user attached to a diff line in the Git view. */
export interface ReviewCommentEntry extends ReviewCommentAnchor {
  readonly id: string;
  readonly file: string;
  readonly body: string;
}

/** A batch of review comments rendered as one collapsible block in the thread. */
export interface ReviewBlock {
  readonly kind: "review";
  readonly comments: readonly ReviewCommentEntry[];
}

export type AgentBlock =
  | ReasoningBlock
  | TextBlock
  | ToolBlock
  | CommandBlock
  | DiffBlock
  | SearchBlock
  | PlanBlock
  | CodeBlockData
  | OptionsBlock
  | ApprovalBlock
  | StatusBlock
  | CitationBlock
  | SuggestedActionsBlock
  | ReviewBlock;

export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "agent";
  readonly time?: string;
  /** Epoch ms when this message was created. User-message activity ordering uses this stable timestamp. */
  readonly createdAtMs?: number;
  /** Epoch ms when this assistant turn actually started. Used for live timers. */
  readonly startedAtMs?: number;
  /** Agent profile used for this specific assistant turn. */
  readonly profile?: AgentProfile;
  /** User messages carry plain text; agent messages carry rich blocks. */
  readonly text?: string;
  readonly blocks?: readonly AgentBlock[];
  readonly costUsd?: number;
  readonly usage?: RunUsage;
}

export interface ComposerAttachmentDraft {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  /** Inlined text content for text-like files. Empty for files referenced by path. */
  readonly content: string;
  readonly size: number;
  readonly lastModified: number;
  /** Absolute path on disk for non-text files (images, binaries) the agent reads by path. */
  readonly path?: string;
}

export interface ComposerDraft {
  readonly text: string;
  readonly attachments: readonly ComposerAttachmentDraft[];
}

/* ----------------------------- Sidebar / projects --------------------------- */

export type ConversationStatus = "running" | "waiting" | "done" | "error" | "idle";

/** Maps a conversation status to its status-dot color key (shared by the
 *  sidebar list and the conversation header so they always agree). */
export const conversationStatusKey: Record<ConversationStatus, StatusKey> = {
  running: "running",
  waiting: "warn",
  done: "ok",
  error: "error",
  idle: "idle",
};

export interface RunUsage {
  readonly totalTokens?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  /** Tokens occupying the model's context window on the turn's final model call
   *  (input + cache reads/writes of that one call — NOT summed across the turn's
   *  tool round-trips). Used to show how full the context window is. */
  readonly contextTokens?: number;
}

/** Per-conversation compaction preferences. Both fields are overrides: when
 *  unset, auto-compaction stays on and the window defaults to the model's full
 *  context window. Mirrors the Claude SDK `autoCompactEnabled`/`autoCompactWindow`
 *  settings; sent to the backend on every run for this conversation. */
export interface CompactionSettings {
  /** Auto-compact the conversation when its context window fills. Default true. */
  readonly auto?: boolean;
  /** Token budget the agent compacts down toward. Unset = the model's full
   *  context window (see contextWindowForModel). */
  readonly window?: number;
}

export type ConversationView = "chat" | "git" | "resources" | "preview" | "terminal";

export interface ConversationSummary {
  readonly id: string;
  readonly title: string;
  readonly snippet: string;
  readonly time: string;
  /** Epoch ms of the latest user turn. Drives newest→oldest sidebar ordering;
   *  `time` is the matching display label. Agent run updates must not bump it. */
  readonly updatedAtMs?: number;
  /** Epoch ms of the last persisted thread/message mutation. Summary-only
   *  changes must not invalidate cached thread pages. */
  readonly threadUpdatedAtMs?: number;
  readonly status: ConversationStatus;
  readonly agent: AgentId;
  readonly profile?: AgentProfile;
  /** Per-conversation auto-/manual-compaction preferences. */
  readonly compaction?: CompactionSettings;
  /** Last workspace pane opened for this conversation. */
  readonly view?: ConversationView;
  readonly activeRunId?: string;
  readonly unread?: boolean;
  /** Pinned conversations surface in a dedicated top group and are hidden from
   *  their original project/chats list. */
  readonly pinned?: boolean;
  /** Manual order inside the pinned group. Regular project/chats groups keep
   *  their persisted server order. */
  readonly pinnedOrder?: number;
  /** Archived conversations stay persisted and searchable, but are hidden from
   *  the normal sidebar groups. */
  readonly archived?: boolean;
  readonly costUsd?: number;
  readonly usage?: RunUsage;
  /** Native agent sessions keyed by agent. Switching agents forks the native
   *  session, and switching back resumes that agent's own session. */
  readonly agentSessions?: Partial<Record<AgentId, string>>;
  /** Most recently observed native session id and owning agent. Kept for
   *  persisted-state compatibility; `agentSessions` is the source of truth for
   *  same-agent resume. */
  readonly sessionId?: string;
  readonly sessionAgent?: AgentId;
  /** When set, this conversation's agent runs (and Git view) operate in an
   *  isolated git worktree at this path instead of the project's base path. */
  readonly worktreePath?: string;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  /** Real working directory the agent runs in for this project's conversations. */
  readonly path?: string;
  readonly conversations: readonly ConversationSummary[];
}
