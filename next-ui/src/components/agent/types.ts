import type { StatusKey } from "../../theme/tokens";
import type { AgentId, AgentProfile } from "./agents";

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
}

export interface TextBlock {
  readonly kind: "text";
  readonly text: string;
  /** Appends a blinking caret to convey live streaming. */
  readonly streaming?: boolean;
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

/** A single code-review comment a user attached to a diff line in the Git view. */
export interface ReviewCommentEntry {
  readonly id: string;
  readonly file: string;
  /** 1-based line number within the rendered diff. */
  readonly line: number;
  readonly lineText: string;
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
}

export interface ConversationSummary {
  readonly id: string;
  readonly title: string;
  readonly snippet: string;
  readonly time: string;
  readonly status: ConversationStatus;
  readonly agent: AgentId;
  readonly profile?: AgentProfile;
  readonly activeRunId?: string;
  readonly unread?: boolean;
  /** Pinned conversations surface in a dedicated top group and are hidden from
   *  their original project/chats list. */
  readonly pinned?: boolean;
  readonly costUsd?: number;
  readonly usage?: RunUsage;
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
