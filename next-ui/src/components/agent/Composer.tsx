import AttachFileIcon from "@mui/icons-material/AttachFile";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import MicRoundedIcon from "@mui/icons-material/MicRounded";
import OpenInBrowserIcon from "@mui/icons-material/OpenInBrowser";
import RateReviewOutlinedIcon from "@mui/icons-material/RateReviewOutlined";
import SendIcon from "@mui/icons-material/Send";
import SendTimeExtensionIcon from "@mui/icons-material/SendTimeExtension";
import CompressRoundedIcon from "@mui/icons-material/CompressRounded";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import { Box, Collapse, Divider, InputBase, Menu, MenuItem, Stack, Switch, type SxProps, TextField, type Theme, Tooltip, Typography } from "@mui/material";
import type { PopoverActions } from "@mui/material/Popover";
import { type ChangeEvent, type ClipboardEvent, forwardRef, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { localFileUrl } from "../../lib/external-url";
import type { VoiceProviderId, VoiceProviderKind } from "../../lib/voice-providers";
import { ImageLightbox } from "../workspace/ImageLightbox";
import { Button, IconButton, KeyHint } from "../ui";
import { AttachmentTile } from "./AttachmentTile";
import { ContextGauge } from "./ContextGauge";
import type { AgentRateLimit, RateLimitWindow } from "./agent-limits";
import type { ComposerAttachmentDraft, ComposerDraft } from "./types";

/** Pastes longer than this become a text-file attachment instead of flooding the input. */
const PASTE_AS_FILE_CHARS = 1500;

interface SlashCommand {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
}

// Pasted-file fallback names only (a filename, not a React key).
let attachmentIdSeq = 0;

/** A process-unique attachment id. Must NOT derive from file metadata + a
 *  module counter: the counter resets on every page load, so the same file
 *  re-attached after a reload (or in a second tab) would mint a colliding id,
 *  and a persisted-draft round-trip could surface two list entries with the same
 *  React key — which React reconciles by duplicating or dropping tiles, so
 *  attachments appeared to vanish or multiply. A UUID is collision-free. */
function newAttachmentId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `att-${Date.now().toString(36)}-${(attachmentIdSeq++).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "yaml", "yml", "toml", "csv", "tsv", "js", "jsx", "ts", "tsx", "mjs", "cjs",
  "css", "scss", "less", "html", "xml", "sh", "bash", "zsh", "py", "rb", "go", "rs", "java", "kt", "c", "h",
  "cpp", "hpp", "cc", "cs", "php", "sql", "log", "env", "gitignore", "dockerfile", "ini", "conf", "cfg", "diff", "patch",
]);

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/[[\]\\]/g, "\\$&");
}

function isImageMime(type: string): boolean {
  return type.startsWith("image/");
}

function isTextLikeFile(file: File): boolean {
  const type = file.type;
  if (type.startsWith("text/")) {
    return true;
  }
  if (/^application\/(json|xml|javascript|x-yaml|yaml|x-sh|toml|x-www-form-urlencoded)$/.test(type)) {
    return true;
  }
  if (type === "") {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    return TEXT_EXTENSIONS.has(ext);
  }
  return false;
}

function mentionQuery(value: string): string | null {
  const match = value.match(/(?:^|\s)@([^\s@/]*)$/);
  return match ? match[1].toLowerCase() : null;
}

function attachmentBlock(attachment: ComposerAttachmentDraft): string {
  // Non-text files are referenced by their on-disk path (vibe-kanban style) so
  // the agent reads them with its own tools instead of receiving garbled bytes.
  if (attachment.path) {
    const label = escapeMarkdownLabel(attachment.name);
    return isImageMime(attachment.type) ? `![${label}](${attachment.path})` : `[${label}](${attachment.path})`;
  }
  const type = attachment.type || "text/plain";
  return [`<attachment name="${escapeXml(attachment.name)}" type="${escapeXml(type)}">`, attachment.content, "</attachment>"].join("\n");
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read audio"));
    reader.readAsDataURL(blob);
  });
}

interface SpeechRecognitionAlternativeLike {
  readonly transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly length: number;
  readonly isFinal: boolean;
  readonly [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionResultEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike {
  readonly error?: string;
  readonly message?: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function speechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }
  const candidate = window as Window & {
    readonly SpeechRecognition?: SpeechRecognitionConstructor;
    readonly webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

function preferredAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

async function readComposerResponseError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error ?? fallback;
}

async function fileToAttachmentDraft(file: File): Promise<ComposerAttachmentDraft> {
  const base = {
    id: newAttachmentId(),
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    lastModified: file.lastModified,
  };
  if (isTextLikeFile(file)) {
    return { ...base, content: await file.text() };
  }
  const dataBase64 = await fileToBase64(file);
  const response = await fetch("/api/attachments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, mimeType: base.type, dataBase64 }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Upload failed (${response.status})`);
  }
  const { path } = (await response.json()) as { path: string };
  return { ...base, content: "", path };
}

function composerAttachmentsEqual(left: readonly ComposerAttachmentDraft[], right: readonly ComposerAttachmentDraft[]): boolean {
  return left.length === right.length && left.every((attachment, index) => {
    const other = right[index];
    return (
      other !== undefined
      && attachment.id === other.id
      && attachment.name === other.name
      && attachment.type === other.type
      && attachment.content === other.content
      && attachment.size === other.size
      && attachment.lastModified === other.lastModified
      && attachment.path === other.path
    );
  });
}

function composerDraftsEqual(left: ComposerDraft, right: ComposerDraft): boolean {
  return left.text === right.text && composerAttachmentsEqual(left.attachments, right.attachments);
}

const COMPOSER_TILE_SIZE = 76;
const COMPOSER_BORDER_HOVER_RADIUS_PX = 42;
const VOICE_DEFAULT_LEVEL_COUNT = 96;
const VOICE_MIN_LEVEL_COUNT = 48;
const VOICE_MAX_LEVEL_COUNT = 220;
const VOICE_LEVEL_PITCH_PX = 6;
const VOICE_IDLE_LEVEL = 0.025;
const VOICE_IDLE_LEVELS = voiceIdleLevels(VOICE_DEFAULT_LEVEL_COUNT);
const VOICE_NO_SPEECH_NOTICE_DELAY_MS = 800;

function voiceIdleLevels(levelCount: number): readonly number[] {
  return Array.from({ length: levelCount }, () => VOICE_IDLE_LEVEL);
}

export function voiceLevelCountFromWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) {
    return VOICE_DEFAULT_LEVEL_COUNT;
  }
  return Math.max(VOICE_MIN_LEVEL_COUNT, Math.min(VOICE_MAX_LEVEL_COUNT, Math.round(width / VOICE_LEVEL_PITCH_PX)));
}

function formatVoiceDuration(startedAt: number | null): string {
  if (startedAt === null) {
    return "0:00";
  }
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function voiceLevelsFromTimeDomainData(data: Uint8Array, levelCount = VOICE_DEFAULT_LEVEL_COUNT): readonly number[] {
  if (data.length === 0 || levelCount <= 0) {
    return [];
  }
  return Array.from({ length: levelCount }, (_, index) => {
    const start = Math.floor((index * data.length) / levelCount);
    const end = Math.max(start + 1, Math.floor(((index + 1) * data.length) / levelCount));
    let sum = 0;
    for (let offset = start; offset < end; offset += 1) {
      const centered = (data[offset] - 128) / 128;
      sum += centered * centered;
    }
    return Math.min(1, Math.sqrt(sum / (end - start)) * 5);
  });
}

function VoiceRecordingStrip({ label, duration, levels, onLevelCountChange }: { readonly label: string; readonly duration: string; readonly levels: readonly number[]; readonly onLevelCountChange: (levelCount: number) => void }) {
  const waveformRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const waveform = waveformRef.current;
    if (!waveform || typeof ResizeObserver === "undefined") {
      return;
    }
    const update = () => onLevelCountChange(voiceLevelCountFromWidth(waveform.getBoundingClientRect().width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(waveform);
    return () => observer.disconnect();
  }, [onLevelCountChange]);

  return (
    <Box
      data-testid="composer-voice-recording-strip"
      role="status"
      aria-label={label}
      sx={{
        position: "absolute",
        inset: 0,
        zIndex: 6,
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 1.25,
        px: 1,
        color: "text.primary",
        pointerEvents: "none",
        backgroundColor: (theme) => theme.custom.surfaces.s2,
      }}
    >
      <Box
        ref={waveformRef}
        sx={{
          minWidth: 0,
          height: 28,
          position: "relative",
          display: "grid",
          gridTemplateColumns: `repeat(${Math.max(1, levels.length)}, minmax(0, 1fr))`,
          alignItems: "center",
          gap: "2px",
          overflow: "hidden",
        }}
      >
        {levels.map((level, index) => {
          const height = Math.max(3, Math.min(28, 3 + level * 32));
          return (
          <Box
            key={index}
            component="span"
            data-level={level.toFixed(3)}
            sx={{
              justifySelf: "stretch",
              minWidth: 1,
              height,
              borderRadius: "999px",
              backgroundColor: "text.primary",
              opacity: Math.max(0.28, Math.min(0.96, 0.34 + level * 0.8)),
              transformOrigin: "center",
              transition: "height 80ms linear",
            }}
          />
          );
        })}
      </Box>
      <Typography
        component="span"
        sx={{
          minWidth: 38,
          fontFamily: (theme) => theme.custom.fonts.mono,
          fontSize: "0.78rem",
          color: "text.secondary",
          textAlign: "right",
        }}
      >
        {duration}
      </Typography>
    </Box>
  );
}

/**
 * FloatingTile — a square control that "floats" above the composer with the
 * same footprint as attachment tiles. Wakeups, modes, review state, and context
 * warnings all use this shape so the row reads as one tile strip.
 */
function FloatingTile({
  icon,
  label,
  onRemove,
  removeLabel,
  onClick,
  disabled = false,
  tone = "neutral",
  testId,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  /** When omitted the tag has no close button (e.g. the read-only review tag). */
  readonly onRemove?: () => void;
  readonly removeLabel?: string;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  readonly tone?: "neutral" | "accent" | "warn" | "danger";
  readonly testId?: string;
}) {
  const Component = onClick ? "button" : "span";
  return (
    <Box
      component={Component}
      type={onClick ? "button" : undefined}
      disabled={onClick ? disabled : undefined}
      data-testid={testId}
      onClick={onClick}
      sx={{
        pointerEvents: "auto",
        position: "relative",
        width: COMPOSER_TILE_SIZE,
        height: COMPOSER_TILE_SIZE,
        flex: `0 0 ${COMPOSER_TILE_SIZE}px`,
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: "space-between",
        gap: 0.5,
        p: 0.75,
        borderRadius: (t) => `${t.custom.radii.md}px`,
        fontSize: "0.68rem",
        fontWeight: 600,
        lineHeight: 1.18,
        textAlign: "left",
        fontFamily: "inherit",
        color: "text.primary",
        backgroundColor: (t) => t.custom.surfaces.s3,
        border: (t) => {
          if (tone === "danger") {
            return `1px solid ${t.palette.status.error.main}`;
          }
          if (tone === "warn") {
            return `1px solid ${t.palette.status.warn.main}`;
          }
          if (tone === "accent") {
            return `1px solid ${t.palette.status.info.main}`;
          }
          return `1px solid ${t.custom.borders.strong}`;
        },
        boxShadow: "0 1px 4px rgba(0, 0, 0, 0.18)",
        transition: "transform 120ms ease, box-shadow 120ms ease",
        cursor: onClick && !disabled ? "pointer" : "default",
        opacity: disabled ? 0.5 : 1,
        "&:hover": {
          boxShadow: disabled ? "0 1px 4px rgba(0, 0, 0, 0.18)" : "0 2px 6px rgba(0, 0, 0, 0.24)",
          transform: disabled ? "none" : "translateY(-1px)",
        },
      }}
    >
      <Box
        component="span"
        sx={{
          display: "inline-flex",
          flex: "0 0 auto",
          color: (t) => {
            if (tone === "danger") {
              return t.palette.status.error.main;
            }
            if (tone === "warn") {
              return t.palette.status.warn.main;
            }
            if (tone === "accent") {
              return t.palette.status.info.main;
            }
            return t.palette.text.secondary;
          },
        }}
      >
        {icon}
      </Box>
      <Box
        component="span"
        sx={{
          minHeight: 0,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 3,
          overflowWrap: "anywhere",
        }}
      >
        {label}
      </Box>
      {onRemove && (
        <IconButton
          aria-label={removeLabel ?? ""}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          sx={{
            position: "absolute",
            top: 3,
            right: 3,
            width: 20,
            height: 20,
            p: 0,
            color: "text.secondary",
            backgroundColor: (t) => t.custom.surfaces.s2,
            border: (t) => `1px solid ${t.custom.borders.subtle}`,
            "&:hover": { backgroundColor: (t) => t.custom.surfaces.s4, color: "text.primary" },
          }}
        >
          <CloseRoundedIcon sx={{ fontSize: 14 }} />
        </IconButton>
      )}
    </Box>
  );
}

/**
 * MeterRow — a labeled stat with an optional thin progress bar. Used in the
 * options menu for the conversation's context-window fill and the agent's
 * account-limit windows (5-hour / weekly). The bar colour climbs from calm
 * (blue) through warning (amber) to critical (red) so a glance reads how close
 * a limit is; rows without a percent (cost, plan, status) render label + value
 * only, keeping the whole section visually consistent.
 */
function MeterRow({ label, value, percent }: { readonly label: string; readonly value: string; readonly percent?: number }) {
  const clamped = typeof percent === "number" ? Math.max(0, Math.min(100, percent)) : null;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
      <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <Typography sx={{ fontSize: "0.72rem", color: "text.secondary" }}>{label}</Typography>
        <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.72rem", color: "text.primary" }}>{value}</Typography>
      </Stack>
      {clamped !== null && (
        <Box sx={{ height: 5, borderRadius: (t) => `${t.custom.radii.pill}px`, backgroundColor: (t) => t.custom.surfaces.s4, overflow: "hidden" }}>
          <Box
            sx={{
              height: "100%",
              width: `${clamped}%`,
              borderRadius: (t) => `${t.custom.radii.pill}px`,
              transition: "width 220ms ease",
              backgroundColor: (t) => (clamped >= 90 ? t.palette.status.error.main : clamped >= 70 ? t.palette.status.warn.main : t.palette.status.running.main),
            }}
          />
        </Box>
      )}
    </Box>
  );
}

interface ComposerBrowserActivityEvent {
  readonly id: number;
  readonly type: string;
  readonly label: string;
  readonly detail?: string;
}

interface ComposerVoiceProvider {
  readonly id: VoiceProviderId;
  readonly name: string;
  readonly kind: Exclude<VoiceProviderKind, "none">;
  readonly language: string;
  readonly configured: boolean;
}

function browserActivityTone(type: string): "info" | "success" | "warning" | "error" {
  if (type === "console.error" || type === "page.error" || type === "network.failed") {
    return "error";
  }
  if (type === "navigation.done" || type === "tab.selected") {
    return "success";
  }
  if (type === "navigation.started") {
    return "warning";
  }
  return "info";
}

/** Imperative handle so a parent drop-zone (the whole chat pane) can hand files
 *  to the composer's attachment pipeline. */
export interface ComposerHandle {
  readonly addFiles: (files: readonly File[]) => Promise<void>;
  readonly focus: () => void;
}

interface ComposerProps {
  readonly placeholder?: string;
  readonly mentionableFiles?: readonly string[];
  readonly value?: string;
  readonly attachments?: readonly ComposerAttachmentDraft[];
  readonly initialValue?: string;
  readonly initialAttachments?: readonly ComposerAttachmentDraft[];
  /** Non-default work modes the current agent supports (toggleable per chat). */
  readonly modes?: readonly { readonly id: string; readonly label: string }[];
  /** The currently active work mode id ("default" when none). */
  readonly activeMode?: string;
  readonly onModeChange?: (modeId: string) => void;
  readonly onDraftChange?: (draft: ComposerDraft) => void;
  readonly onSend?: (value: string) => void;
  readonly onStop?: () => void;
  readonly onAttachmentError?: (message: string) => void;
  readonly running?: boolean;
  /** Count of pending review comments shown as a no-close tag; when > 0 the send
   *  button is enabled and sending also flushes the comments via onSendReview. */
  readonly reviewCount?: number;
  readonly onSendReview?: () => void;
  /** Reports the height of the floating tags row so the thread/Git content above
   *  can reserve matching bottom space (the tags still float over the content). */
  readonly onTagsHeightChange?: (height: number) => void;
  /** Reports the multiline-overlay lift (px above the single-row baseline) so
   *  the thread can reserve extra space when the textarea expands upward. */
  readonly onOverlayLiftChange?: (lift: number) => void;
  /** Previously sent user messages (oldest first) recalled with ArrowUp/ArrowDown
   *  when the caret is at the edge, shell-history style. */
  readonly history?: readonly string[];
  /** Current agent id, used to show its account rate-limits in the options menu. */
  readonly agentId?: string;
  /** Shared account rate-limits for the selected CLI agent, owned by WorkspacePage. */
  readonly agentLimit?: AgentRateLimit | null;
  readonly agentLimitLoaded?: boolean;
  readonly agentLimitRefreshing?: boolean;
  readonly agentLimitRefreshError?: string | null;
  readonly onRefreshAgentLimits?: (requestRefresh: boolean) => void;
  /** The selected conversation's latest-turn context-window fill (tokens) and the
   *  model's window size, for the context gauge in the options menu. */
  readonly contextTokens?: number;
  readonly contextWindow?: number;
  /** Compaction controls (per conversation). `autoCompact` defaults to true;
   *  `compactWindow` is the token override (undefined = the model's full window). */
  readonly autoCompact?: boolean;
  readonly compactWindow?: number;
  readonly onAutoCompactChange?: (enabled: boolean) => void;
  readonly onCompactWindowChange?: (window: number | undefined) => void;
  /** Force a compaction of the conversation now (best-effort per agent). */
  readonly onCompactNow?: () => void;
  /** Browser Preview activity, shown inside the input options menu. */
  readonly browserActivityEvents?: readonly ComposerBrowserActivityEvent[];
  /** Server-side scheduled wakeups for this chat, rendered as first floating tags. */
  readonly scheduledWakeups?: readonly { readonly id: string; readonly label: string; readonly removeLabel: string; readonly onRemove: () => void }[];
  /** User turns queued behind the current/last run; can be dispatched manually. */
  readonly queuedMessageCount?: number;
  readonly onSendQueuedNow?: () => void;
  /** Selected and server-authorized voice dictation provider. Omitted for "none". */
  readonly voiceProvider?: ComposerVoiceProvider;
  readonly onVoiceError?: (message: string) => void;
}

/** Agents whose CLI/SDK does not surface account rate-limit data, so the menu
 *  shows "not reported" instead of a forever-pending "no data yet". Gemini's
 *  CLI keeps quota only in its interactive UI; OpenCode doesn't report it. */
const LIMIT_UNSUPPORTED_AGENTS = new Set<string>(["gemini", "opencode"]);
const AUTO_COMPACT_TOGGLE_AGENTS = new Set<string>(["claude-code"]);
const COMPACTION_WINDOW_AGENTS = new Set<string>(["claude-code", "codex"]);

/** Composer — the chat input. Sends on Enter (Shift+Enter for newline). Sticky
 * at the bottom on mobile; the send button stays a comfortable tap target. */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  {
    placeholder = "Message the agent…",
    mentionableFiles = [],
    value,
    attachments,
    initialValue = "",
    initialAttachments = [],
    modes = [],
    activeMode = "default",
    onModeChange,
    onDraftChange,
    onSend,
    onStop,
    onAttachmentError,
    running = false,
    reviewCount = 0,
    onSendReview,
    onTagsHeightChange,
    onOverlayLiftChange,
    history = [],
    agentId,
    agentLimit = null,
    agentLimitLoaded = false,
    agentLimitRefreshing = false,
    agentLimitRefreshError = null,
    onRefreshAgentLimits,
    contextTokens,
    contextWindow,
    autoCompact = true,
    compactWindow,
    onAutoCompactChange,
    onCompactWindowChange,
    onCompactNow,
    browserActivityEvents,
    scheduledWakeups = [],
    queuedMessageCount = 0,
    onSendQueuedNow,
    voiceProvider,
    onVoiceError,
  },
  ref,
) {
  const [internalValue, setInternalValue] = useState(initialValue);
  const [internalAttachments, setInternalAttachments] = useState<readonly ComposerAttachmentDraft[]>(initialAttachments);
  const [sending, setSending] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [suggestDismissed, setSuggestDismissed] = useState(false);
  const [modeMenuAnchor, setModeMenuAnchor] = useState<null | HTMLElement>(null);
  // True when the input needs more than one row; it then lifts into an upward-
  // growing overlay (so the bar height never changes), and the floating tags
  // rise above it by `overlayLift`.
  const [expanded, setExpanded] = useState(false);
  const [overlayLift, setOverlayLift] = useState(0);
  const onOverlayLiftChangeRef = useRef(onOverlayLiftChange);
  onOverlayLiftChangeRef.current = onOverlayLiftChange;
  // An image attachment opened full-screen (click a thumbnail to view).
  const [previewAttachment, setPreviewAttachment] = useState<ComposerAttachmentDraft | null>(null);
  const [limitOpen, setLimitOpen] = useState(false);
  const optionsMenuActionRef = useRef<PopoverActions | null>(null);
  const optionsMenuListRef = useRef<HTMLUListElement | null>(null);
  const optionsMenuPositionFrameRef = useRef<number | null>(null);
  const activeModeOption = modes.find((mode) => mode.id === activeMode) ?? null;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const tagsRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const composerBarRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceAudioContextRef = useRef<AudioContext | null>(null);
  const voiceAnalyserFrameRef = useRef<number | null>(null);
  const voiceNoSpeechTimerRef = useRef<number | null>(null);
  const voiceNoSpeechNotifiedRef = useRef(false);
  const voiceRecognizedRef = useRef(false);
  const voiceManualStopRef = useRef(false);
  const voiceLevelValuesRef = useRef<readonly number[]>(VOICE_IDLE_LEVELS);
  const voiceLevelLastPaintRef = useRef(0);
  const voiceLevelCountRef = useRef(VOICE_DEFAULT_LEVEL_COUNT);
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [voiceRecordingStartedAt, setVoiceRecordingStartedAt] = useState<number | null>(null);
  const [voiceClock, setVoiceClock] = useState(0);
  const [voiceLevels, setVoiceLevels] = useState<readonly number[]>(VOICE_IDLE_LEVELS);
  const [browserVoiceSupported, setBrowserVoiceSupported] = useState(false);
  const singleRowRef = useRef(0);
  // Shell-style history navigation: -1 means "not browsing"; otherwise an index
  // into `history`. `historyDraftRef` holds the text being composed before the
  // user started scrolling back, so ArrowDown past the newest restores it.
  const historyIndexRef = useRef(-1);
  const historyDraftRef = useRef("");
  const pendingCaretToEndRef = useRef(false);
  const initialDraftRef = useRef<ComposerDraft>({ text: initialValue, attachments: initialAttachments });
  const localDraftDirtyRef = useRef(false);
  const { t } = useI18n();
  const composerValue = value ?? internalValue;
  const composerAttachments = attachments ?? internalAttachments;
  const showBrowserActivitySection = browserActivityEvents !== undefined;
  const latestDraftRef = useRef<ComposerDraft>({ text: composerValue, attachments: composerAttachments });
  latestDraftRef.current = { text: composerValue, attachments: composerAttachments };

  useEffect(() => {
    if (value !== undefined || attachments !== undefined || localDraftDirtyRef.current) {
      return;
    }
    const nextInitialDraft: ComposerDraft = { text: initialValue, attachments: initialAttachments };
    if (composerDraftsEqual(initialDraftRef.current, nextInitialDraft)) {
      return;
    }
    initialDraftRef.current = nextInitialDraft;
    latestDraftRef.current = nextInitialDraft;
    setInternalValue(nextInitialDraft.text);
    setInternalAttachments(nextInitialDraft.attachments);
  }, [attachments, initialAttachments, initialValue, value]);

  // After recalling a history entry, drop the caret at the end of the recalled
  // text so the next keystroke edits rather than replaces it.
  useLayoutEffect(() => {
    if (!pendingCaretToEndRef.current) {
      return;
    }
    pendingCaretToEndRef.current = false;
    const el = textareaRef.current;
    if (el) {
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }
  }, [composerValue]);

  // Detect multiline and measure how far the upward overlay rises above the bar
  // so the floating tags clear it. Geometry-based (not an estimate) so it can't
  // drift out of sync with the textarea.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    if (singleRowRef.current === 0 && !expanded) {
      singleRowRef.current = el.scrollHeight;
    }
    const baseline = singleRowRef.current || 24;
    const needsMultiline = composerValue.length > 0 && (composerValue.includes("\n") || el.scrollHeight > baseline * 1.5);
    setExpanded(needsMultiline);
    const root = rootRef.current;
    let nextLift = 0;
    if (needsMultiline && expanded && root) {
      const overlayTop = el.getBoundingClientRect().top - 8;
      nextLift = Math.max(0, Math.round(root.getBoundingClientRect().top - overlayTop));
    }
    setOverlayLift(nextLift);
    onOverlayLiftChangeRef.current?.(nextLift);
  }, [composerValue, expanded]);

  // Report the floating tags row height so the thread/Git content reserves
  // matching bottom space (the row floats over the content).
  useEffect(() => {
    const el = tagsRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      onTagsHeightChange?.(0);
      return;
    }
    const report = () => onTagsHeightChange?.(el.offsetHeight);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => {
      observer.disconnect();
      onTagsHeightChange?.(0);
    };
  }, [onTagsHeightChange]);

  const slashCommands = useMemo<readonly SlashCommand[]>(
    () => [
      { id: "plan", label: "/plan", prompt: t("slashPlanPrompt") },
      { id: "test", label: "/test", prompt: t("slashTestPrompt") },
      { id: "fix", label: "/fix", prompt: t("slashFixPrompt") },
    ],
    [t],
  );
  const q = mentionQuery(composerValue);
  const mentionedFiles = useMemo(
    () => (q == null ? [] : mentionableFiles.filter((file) => file.toLowerCase().includes(q)).slice(0, 8)),
    [mentionableFiles, q],
  );
  const visibleSlashCommands = composerValue.startsWith("/") && !composerValue.includes(" ") ? slashCommands.filter((command) => command.label.startsWith(composerValue)) : [];

  const updateComposerBorderHover = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const composerBar = composerBarRef.current;
    if (!composerBar) {
      return;
    }
    const rect = composerBar.getBoundingClientRect();
    composerBar.style.setProperty("--composer-border-x", `${Math.round(event.clientX - rect.left)}px`);
    composerBar.style.setProperty("--composer-border-y", `${Math.round(event.clientY - rect.top)}px`);
    composerBar.style.setProperty("--composer-border-hover-opacity", "1");
  }, []);

  const clearComposerBorderHover = useCallback(() => {
    composerBarRef.current?.style.setProperty("--composer-border-hover-opacity", "0");
  }, []);

  const setVoiceLevelCountForWidth = useCallback((levelCount: number) => {
    if (voiceLevelCountRef.current === levelCount) {
      return;
    }
    voiceLevelCountRef.current = levelCount;
    setVoiceLevels((current) => (current.length === levelCount ? current : voiceIdleLevels(levelCount)));
  }, []);

  const updateOptionsMenuPosition = useCallback(() => {
    optionsMenuActionRef.current?.updatePosition();
  }, []);

  const scheduleOptionsMenuPositionUpdate = useCallback(() => {
    if (optionsMenuPositionFrameRef.current !== null) {
      cancelAnimationFrame(optionsMenuPositionFrameRef.current);
    }
    optionsMenuPositionFrameRef.current = requestAnimationFrame(() => {
      optionsMenuPositionFrameRef.current = null;
      updateOptionsMenuPosition();
    });
  }, [updateOptionsMenuPosition]);

  useEffect(() => {
    return () => {
      if (optionsMenuPositionFrameRef.current !== null) {
        cancelAnimationFrame(optionsMenuPositionFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const list = optionsMenuListRef.current;
    if (!modeMenuAnchor || !list || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(scheduleOptionsMenuPositionUpdate);
    observer.observe(list);
    return () => observer.disconnect();
  }, [modeMenuAnchor, scheduleOptionsMenuPositionUpdate]);

  const updateDraft = (draft: ComposerDraft) => {
    localDraftDirtyRef.current = true;
    latestDraftRef.current = draft;
    if (value === undefined) {
      setInternalValue(draft.text);
    }
    if (attachments === undefined) {
      setInternalAttachments(draft.attachments);
    }
    onDraftChange?.(draft);
  };

  const setComposerValue = (nextValue: string) => {
    // Typing re-opens suggestions that an earlier Escape dismissed and exits any
    // in-progress history browsing so the next ArrowUp starts fresh.
    setSuggestDismissed(false);
    historyIndexRef.current = -1;
    updateDraft({ text: nextValue, attachments: latestDraftRef.current.attachments });
  };

  // Recall a history entry without exiting history-browsing mode; the caret is
  // moved to the end on the next paint so further arrow presses keep navigating.
  const applyHistoryValue = (nextValue: string) => {
    pendingCaretToEndRef.current = true;
    updateDraft({ text: nextValue, attachments: latestDraftRef.current.attachments });
  };

  const navigateHistory = (direction: "up" | "down"): boolean => {
    if (history.length === 0) {
      return false;
    }
    const browsing = historyIndexRef.current !== -1;
    if (direction === "up") {
      if (!browsing) {
        historyDraftRef.current = composerValue;
        historyIndexRef.current = history.length - 1;
      } else if (historyIndexRef.current > 0) {
        historyIndexRef.current -= 1;
      } else {
        return true; // already at the oldest; swallow the key but don't wrap.
      }
      applyHistoryValue(history[historyIndexRef.current] ?? "");
      return true;
    }
    // direction === "down": only meaningful while browsing.
    if (!browsing) {
      return false;
    }
    if (historyIndexRef.current < history.length - 1) {
      historyIndexRef.current += 1;
      applyHistoryValue(history[historyIndexRef.current] ?? "");
    } else {
      // Past the newest entry → restore the draft the user was composing.
      historyIndexRef.current = -1;
      applyHistoryValue(historyDraftRef.current);
    }
    return true;
  };

  const setComposerAttachments = (nextAttachments: readonly ComposerAttachmentDraft[]) => {
    updateDraft({ text: latestDraftRef.current.text, attachments: nextAttachments });
  };

  const clearVoiceNoSpeechNotice = useCallback(() => {
    if (voiceNoSpeechTimerRef.current !== null) {
      window.clearTimeout(voiceNoSpeechTimerRef.current);
      voiceNoSpeechTimerRef.current = null;
    }
  }, []);

  const scheduleVoiceNoSpeechNotice = useCallback(() => {
    if (voiceRecognizedRef.current || voiceNoSpeechNotifiedRef.current || voiceNoSpeechTimerRef.current !== null) {
      return;
    }
    voiceNoSpeechTimerRef.current = window.setTimeout(() => {
      voiceNoSpeechTimerRef.current = null;
      if (!voiceRecognizedRef.current) {
        voiceNoSpeechNotifiedRef.current = true;
        onVoiceError?.(t("voiceNoSpeech"));
      }
    }, VOICE_NO_SPEECH_NOTICE_DELAY_MS);
  }, [onVoiceError, t]);

  const appendDictation = useCallback((text: string): boolean => {
    const cleanText = text.trim();
    if (!cleanText) {
      return false;
    }
    voiceRecognizedRef.current = true;
    clearVoiceNoSpeechNotice();
    const currentText = latestDraftRef.current.text;
    const separator = currentText.length === 0 || /\s$/.test(currentText) ? "" : " ";
    updateDraft({ text: `${currentText}${separator}${cleanText}`, attachments: latestDraftRef.current.attachments });
    requestAnimationFrame(() => textareaRef.current?.focus());
    return true;
  }, [clearVoiceNoSpeechNotice]);

  const stopVoiceAnalyser = useCallback(() => {
    if (voiceAnalyserFrameRef.current !== null) {
      cancelAnimationFrame(voiceAnalyserFrameRef.current);
      voiceAnalyserFrameRef.current = null;
    }
    const context = voiceAudioContextRef.current;
    voiceAudioContextRef.current = null;
    if (context && context.state !== "closed") {
      void context.close();
    }
    const idleLevels = voiceIdleLevels(voiceLevelCountRef.current);
    voiceLevelValuesRef.current = idleLevels;
    setVoiceLevels(idleLevels);
  }, []);

  const stopVoiceTracks = useCallback(() => {
    stopVoiceAnalyser();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }, [stopVoiceAnalyser]);

  const startVoiceAnalyser = useCallback((stream: MediaStream) => {
    stopVoiceAnalyser();
    const AudioContextConstructor = window.AudioContext;
    const context = new AudioContextConstructor();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.35;
    context.createMediaStreamSource(stream).connect(analyser);
    voiceAudioContextRef.current = context;
    const data = new Uint8Array(analyser.fftSize);
    const tick = (now: number) => {
      analyser.getByteTimeDomainData(data);
      const next = voiceLevelsFromTimeDomainData(data, voiceLevelCountRef.current);
      voiceLevelValuesRef.current = next;
      if (now - voiceLevelLastPaintRef.current > 70) {
        voiceLevelLastPaintRef.current = now;
        setVoiceLevels(next);
      }
      voiceAnalyserFrameRef.current = requestAnimationFrame(tick);
    };
    voiceAnalyserFrameRef.current = requestAnimationFrame(tick);
  }, [stopVoiceAnalyser]);

  useEffect(() => {
    setBrowserVoiceSupported(voiceProvider?.kind === "browser" && speechRecognitionConstructor() !== null);
  }, [voiceProvider?.kind, voiceProvider?.id]);

  useEffect(() => () => {
    clearVoiceNoSpeechNotice();
    recognitionRef.current?.stop();
    mediaRecorderRef.current?.stop();
    stopVoiceTracks();
  }, [clearVoiceNoSpeechNotice, stopVoiceTracks]);

  useEffect(() => {
    if (voiceState !== "recording") {
      setVoiceRecordingStartedAt(null);
      return undefined;
    }
    if (voiceRecordingStartedAt === null) {
      setVoiceRecordingStartedAt(Date.now());
    }
    const timer = window.setInterval(() => setVoiceClock((value) => value + 1), 250);
    return () => window.clearInterval(timer);
  }, [voiceRecordingStartedAt, voiceState]);

  const transcribeCloudAudio = useCallback(async (blob: Blob) => {
    if (!voiceProvider || voiceProvider.kind !== "cloud") {
      return;
    }
    const response = await fetch("/api/voice/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: voiceProvider.id,
        mimeType: blob.type || "application/octet-stream",
        dataBase64: await blobToBase64(blob),
        language: voiceProvider.language,
      }),
    });
    if (!response.ok) {
      throw new Error(await readComposerResponseError(response, `Voice transcription failed (${response.status})`));
    }
    const payload = (await response.json()) as { text?: unknown };
    if (typeof payload.text !== "string") {
      throw new Error("Voice transcription response is invalid.");
    }
    if (!appendDictation(payload.text)) {
      scheduleVoiceNoSpeechNotice();
    }
  }, [appendDictation, scheduleVoiceNoSpeechNotice, voiceProvider]);

  const startBrowserDictation = useCallback(async () => {
    if (!voiceProvider || voiceProvider.kind !== "browser") {
      return;
    }
    const Recognition = speechRecognitionConstructor();
    if (!Recognition || !navigator.mediaDevices || typeof window.AudioContext === "undefined") {
      onVoiceError?.(t("voiceInputUnavailable", { provider: voiceProvider.name }));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      startVoiceAnalyser(stream);
      const recognition = new Recognition();
      recognition.lang = voiceProvider.language;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        let transcript = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (result?.isFinal) {
            transcript += result[0]?.transcript ?? "";
          }
        }
        appendDictation(transcript);
      };
      recognition.onerror = (event) => {
        if (!voiceManualStopRef.current && event.error === "no-speech") {
          scheduleVoiceNoSpeechNotice();
          return;
        }
        clearVoiceNoSpeechNotice();
        voiceManualStopRef.current = true;
        stopVoiceTracks();
        onVoiceError?.(t("voiceTranscriptionFailed", { error: event.message || event.error || "unknown" }));
        setVoiceState("idle");
      };
      recognition.onend = () => {
        if (!voiceManualStopRef.current && recognitionRef.current === recognition) {
          window.setTimeout(() => {
            if (voiceManualStopRef.current || recognitionRef.current !== recognition) {
              return;
            }
            try {
              recognition.start();
            } catch (error) {
              voiceManualStopRef.current = true;
              recognitionRef.current = null;
              clearVoiceNoSpeechNotice();
              stopVoiceTracks();
              setVoiceState("idle");
              onVoiceError?.(t("voiceTranscriptionFailed", { error: error instanceof Error ? error.message : String(error) }));
            }
          }, 120);
          return;
        }
        recognitionRef.current = null;
        stopVoiceTracks();
        setVoiceState("idle");
      };
      voiceManualStopRef.current = false;
      voiceRecognizedRef.current = false;
      voiceNoSpeechNotifiedRef.current = false;
      clearVoiceNoSpeechNotice();
      recognitionRef.current = recognition;
      setVoiceRecordingStartedAt(Date.now());
      setVoiceState("recording");
      recognition.start();
    } catch (error) {
      clearVoiceNoSpeechNotice();
      stopVoiceTracks();
      setVoiceState("idle");
      onVoiceError?.(t("voiceTranscriptionFailed", { error: error instanceof Error ? error.message : String(error) }));
    }
  }, [appendDictation, clearVoiceNoSpeechNotice, onVoiceError, scheduleVoiceNoSpeechNotice, startVoiceAnalyser, stopVoiceTracks, t, voiceProvider]);

  const startCloudDictation = useCallback(async () => {
    if (!voiceProvider || voiceProvider.kind !== "cloud") {
      return;
    }
    if (!voiceProvider.configured || !navigator.mediaDevices || typeof MediaRecorder === "undefined") {
      onVoiceError?.(t("voiceInputUnavailable", { provider: voiceProvider.name }));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      startVoiceAnalyser(stream);
      const chunks: Blob[] = [];
      const mimeType = preferredAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onerror = (event) => {
        onVoiceError?.(t("voiceTranscriptionFailed", { error: event.error.message }));
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || "audio/webm";
        const audio = new Blob(chunks, { type });
        mediaRecorderRef.current = null;
        stopVoiceTracks();
        if (audio.size === 0) {
          setVoiceState("idle");
          scheduleVoiceNoSpeechNotice();
          return;
        }
        setVoiceState("transcribing");
        void transcribeCloudAudio(audio)
          .catch((error: unknown) => onVoiceError?.(t("voiceTranscriptionFailed", { error: error instanceof Error ? error.message : String(error) })))
          .finally(() => setVoiceState("idle"));
      };
      voiceRecognizedRef.current = false;
      voiceNoSpeechNotifiedRef.current = false;
      clearVoiceNoSpeechNotice();
      setVoiceRecordingStartedAt(Date.now());
      setVoiceState("recording");
      recorder.start();
    } catch (error) {
      clearVoiceNoSpeechNotice();
      stopVoiceTracks();
      setVoiceState("idle");
      onVoiceError?.(t("voiceTranscriptionFailed", { error: error instanceof Error ? error.message : String(error) }));
    }
  }, [clearVoiceNoSpeechNotice, onVoiceError, scheduleVoiceNoSpeechNotice, startVoiceAnalyser, stopVoiceTracks, t, transcribeCloudAudio, voiceProvider]);

  const toggleVoiceInput = useCallback(() => {
    if (voiceState === "recording") {
      voiceManualStopRef.current = true;
      clearVoiceNoSpeechNotice();
      recognitionRef.current?.stop();
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      stopVoiceTracks();
      return;
    }
    if (!voiceProvider || voiceState !== "idle") {
      return;
    }
    if (voiceProvider.kind === "browser") {
      void startBrowserDictation();
      return;
    }
    void startCloudDictation();
  }, [clearVoiceNoSpeechNotice, startBrowserDictation, startCloudDictation, voiceProvider, voiceState]);

  const send = async () => {
    const trimmed = composerValue.trim();
    const hasInput = trimmed.length > 0 || composerAttachments.length > 0;
    if (!hasInput && reviewCount === 0) {
      return;
    }
    setSending(true);
    if (hasInput) {
      const attachmentBlocks = composerAttachments.map(attachmentBlock);
      onSend?.([trimmed, ...attachmentBlocks].filter(Boolean).join("\n\n"));
      updateDraft({ text: "", attachments: [] });
    }
    // Pending review comments flush as their own block (no agent run).
    if (reviewCount > 0) {
      onSendReview?.();
    }
    setSending(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // While the suggestion popover is open, the arrow keys / Enter / Tab drive
    // the list instead of the textarea, so picking an option never needs the mouse.
    if (suggestionsOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveSuggestion((index) => (index + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveSuggestion((index) => (index - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        suggestions[activeIndex]?.apply();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSuggestDismissed(true);
        return;
      }
    }
    // ArrowUp/ArrowDown recall sent messages (shell history). ArrowUp engages
    // only when the caret sits at the very start (so multi-line editing's own
    // vertical movement still works); ArrowDown only while already browsing.
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const el = textareaRef.current;
      const atStart = !el || (el.selectionStart === 0 && el.selectionEnd === 0);
      const atEnd = !el || (el.selectionStart === composerValue.length && el.selectionEnd === composerValue.length);
      const browsing = historyIndexRef.current !== -1;
      if (event.key === "ArrowUp" && (browsing || atStart)) {
        if (navigateHistory("up")) {
          event.preventDefault();
          return;
        }
      }
      if (event.key === "ArrowDown" && browsing && atEnd) {
        if (navigateHistory("down")) {
          event.preventDefault();
          return;
        }
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  const addFiles = async (files: readonly File[]) => {
    if (files.length === 0) {
      return;
    }
    const results = await Promise.allSettled(files.map(fileToAttachmentDraft));
    const ready: ComposerAttachmentDraft[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        ready.push(result.value);
      } else {
        onAttachmentError?.(t("attachmentFailed", { name: files[index].name }));
      }
    });
    if (ready.length > 0) {
      // Append while de-duping by id, so a persisted-draft round-trip (which can
      // briefly re-feed the same attachment through `initialAttachments`) can
      // never produce two list entries — and thus two identical React keys — for
      // one file.
      const existing = latestDraftRef.current.attachments;
      const seen = new Set(existing.map((item) => item.id));
      const merged = [...existing, ...ready.filter((item) => !seen.has(item.id))];
      setComposerAttachments(merged);
    }
  };

  const chooseFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    await addFiles(files);
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const clipboard = event.clipboardData;
    if (!clipboard) {
      return;
    }
    // Pasted files/images (e.g. a screenshot or copied file) become attachments.
    // Browsers expose the same payload through BOTH clipboardData.files and
    // clipboardData.items (kind "file"), so read only one source — preferring
    // .files — to avoid attaching every pasted file twice.
    const rawFiles: File[] = Array.from(clipboard.files ?? []);
    if (rawFiles.length === 0) {
      for (const item of Array.from(clipboard.items ?? [])) {
        if (item.kind !== "file") {
          continue;
        }
        const file = item.getAsFile();
        if (file) {
          rawFiles.push(file);
        }
      }
    }
    const pastedFiles: File[] = rawFiles.map((file) => {
      if (file.name) {
        return file;
      }
      // Clipboard images often arrive unnamed; synthesize a name from the mime.
      const ext = file.type.split("/")[1] || "bin";
      const kind = isImageMime(file.type) ? "image" : "file";
      return new File([file], `pasted-${kind}-${attachmentIdSeq++}.${ext}`, { type: file.type });
    });
    if (pastedFiles.length > 0) {
      event.preventDefault();
      void addFiles(pastedFiles);
      return;
    }
    const pasted = clipboard.getData("text/plain") ?? "";
    if (pasted.length > PASTE_AS_FILE_CHARS) {
      event.preventDefault();
      void addFiles([new File([pasted], `pasted-${pasted.length}.txt`, { type: "text/plain" })]);
    }
  };

  // The whole chat pane is the drop zone (see WorkspacePage); it hands dropped
  // files here through this imperative handle.
  useImperativeHandle(ref, () => ({ addFiles, focus: () => textareaRef.current?.focus() }), [addFiles]);

  const insertMention = (file: string) => {
    setComposerValue(composerValue.replace(/@([^\s@/]*)$/, `@${file} `));
  };

  const insertSlashCommand = (command: SlashCommand) => {
    setComposerValue(`${command.prompt} `);
  };

  // Slash commands and @-mentions never appear together (one needs a leading
  // "/", the other a trailing "@…"), so a single suggestion list covers both.
  const suggestions: ReadonlyArray<{ readonly id: string; readonly label: string; readonly mono?: boolean; readonly apply: () => void }> =
    visibleSlashCommands.length > 0
      ? visibleSlashCommands.map((command) => ({ id: command.id, label: command.label, apply: () => insertSlashCommand(command) }))
      : mentionedFiles.map((file) => ({ id: file, label: file, mono: true, apply: () => insertMention(file) }));
  const suggestionsOpen = suggestions.length > 0 && !suggestDismissed;
  const activeIndex = Math.min(activeSuggestion, Math.max(suggestions.length - 1, 0));
  const suggestionKey = suggestions.map((suggestion) => suggestion.id).join("|");
  useEffect(() => {
    setActiveSuggestion(0);
  }, [suggestionKey]);

  const hasAttachments = composerAttachments.length > 0;
  const hasComposerPayload = composerValue.trim().length > 0 || composerAttachments.length > 0;
  const canSend = (hasComposerPayload || reviewCount > 0) && !sending;
  const showAgentStopButton = running && !hasComposerPayload && reviewCount === 0;
  const sendLabel = reviewCount > 0 ? t("reviewSendComments") : t("send");
  const browserProviderAvailable =
    voiceProvider?.kind === "browser"
    && browserVoiceSupported
    && typeof navigator !== "undefined"
    && Boolean(navigator.mediaDevices)
    && typeof window !== "undefined"
    && typeof window.AudioContext !== "undefined";
  const cloudProviderAvailable =
    voiceProvider?.kind === "cloud"
    && voiceProvider.configured
    && typeof navigator !== "undefined"
    && Boolean(navigator.mediaDevices)
    && typeof MediaRecorder !== "undefined";
  const voiceAvailable = browserProviderAvailable || cloudProviderAvailable;
  const voiceLabel =
    voiceState === "recording"
      ? t("stopVoiceInput")
      : voiceState === "transcribing"
        ? t("voiceInputTranscribing")
        : t("startVoiceInput", { provider: voiceProvider?.name ?? "" });
  const voiceInputActive = voiceState !== "idle";
  const voiceDuration = voiceClock >= 0 ? formatVoiceDuration(voiceRecordingStartedAt) : "0:00";

  const floatingPanelSx: SxProps<Theme> = {
    pointerEvents: "auto",
    p: 0.75,
    borderRadius: (t) => `${t.custom.radii.md}px`,
    border: (t) => `1px solid ${t.custom.borders.subtle}`,
    backgroundColor: (t) => t.custom.surfaces.s2,
    boxShadow: "0 -8px 24px rgba(0, 0, 0, 0.4)",
  };
  const modeMenuItemSx: SxProps<Theme> = { display: "flex", gap: 1, fontSize: "0.8rem", minHeight: 0, pl: 2, pr: 1, width: "100%" };
  const modeSwitchSx: SxProps<Theme> = { ml: "auto", mr: 0, pointerEvents: "none" };

  // How full the context window is (raw ratio, may exceed 1 once the thread has
  // outgrown the window). Drives the gauge next to the options button and the
  // over-limit warning that offers compaction.
  const hasKnownContextWindow = typeof contextWindow === "number" && contextWindow > 0;
  const effectiveContextWindow = hasKnownContextWindow ? contextWindow : 1;
  const effectiveContextTokens = typeof contextTokens === "number" && Number.isFinite(contextTokens) && contextTokens > 0 ? contextTokens : 0;
  const contextOverLimit = hasKnownContextWindow && effectiveContextTokens / effectiveContextWindow >= 1;
  const supportsAutoCompactToggle = agentId !== undefined && AUTO_COMPACT_TOGGLE_AGENTS.has(agentId);
  const supportsCompactionWindow = agentId !== undefined && COMPACTION_WINDOW_AGENTS.has(agentId);
  const limitWindowLabel = (kind: RateLimitWindow["kind"]): string =>
    kind === "weekly" ? t("limitWindowWeekly") : kind === "overage" ? t("limitOverage") : t("limitWindow5h");
  const lowLimitWindow = agentLimit?.windows.find((window) => typeof window.usedPercent === "number" && window.usedPercent >= 85) ?? null;
  const lowLimitPercent = typeof lowLimitWindow?.usedPercent === "number" ? Math.round(lowLimitWindow.usedPercent) : null;
  const limitWarningLabel =
    lowLimitWindow && lowLimitPercent !== null
      ? `${t("limitsLowTile")} · ${limitWindowLabel(lowLimitWindow.kind)} ${lowLimitPercent}%`
      : null;
  const limitWarningHint =
    lowLimitWindow && lowLimitPercent !== null
      ? t("limitsLowHint", { window: limitWindowLabel(lowLimitWindow.kind), percent: lowLimitPercent })
      : null;
  const limitWarningTone = agentLimit?.status === "rejected" || (lowLimitPercent !== null && lowLimitPercent >= 95) ? "danger" : "warn";

  // Compact, localized lines describing the agent's account rate-limits — one
  // row per window (5-hour, weekly, …) showing usage % and time-to-reset side
  // by side, then plan + the most-severe status.
  const limitLines: ReadonlyArray<{ readonly id: string; readonly label: string; readonly value: string; readonly percent?: number }> = (() => {
    if (!agentLimit) {
      return [];
    }
    const formatReset = (resetsAt: number): string => {
      const secs = Math.max(0, resetsAt * 1000 - Date.now()) / 1000;
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      return h > 0 ? `${h}${t("unitHourShort")} ${m}${t("unitMinShort")}` : `${m}${t("unitMinShort")}`;
    };
    const statusLabel = (status: string): string =>
      status === "allowed"
        ? t("limitStatusOk")
        : status === "allowed_warning"
          ? t("limitStatusWarning")
          : status === "rejected"
            ? t("limitStatusRejected")
            : status;

    const lines: Array<{ id: string; label: string; value: string; percent?: number }> = [];
    for (const window of agentLimit.windows) {
      const parts: string[] = [];
      if (typeof window.usedPercent === "number") {
        parts.push(`${Math.round(window.usedPercent)}%`);
      }
      if (typeof window.resetsAt === "number") {
        parts.push(formatReset(window.resetsAt));
      }
      if (parts.length > 0) {
        lines.push({ id: window.kind, label: limitWindowLabel(window.kind), value: parts.join(" · "), percent: typeof window.usedPercent === "number" ? window.usedPercent : undefined });
      }
    }
    if (agentLimit.plan) {
      lines.push({ id: "plan", label: t("limitPlan"), value: agentLimit.plan });
    }
    if (agentLimit.status) {
      lines.push({ id: "status", label: t("limitStatus"), value: statusLabel(agentLimit.status) });
    }
    return lines;
  })();

  useEffect(() => {
    setLimitOpen(false);
  }, [agentId]);

  useLayoutEffect(() => {
    if (modeMenuAnchor) {
      scheduleOptionsMenuPositionUpdate();
    }
  }, [agentLimitLoaded, agentLimitRefreshError, agentLimitRefreshing, limitOpen, limitLines.length, modeMenuAnchor, scheduleOptionsMenuPositionUpdate]);

  const toggleLimitsOpen = () => {
    const nextOpen = !limitOpen;
    setLimitOpen(nextOpen);
    if (nextOpen) {
      onRefreshAgentLimits?.(true);
    }
  };

  // Opens the options menu anchored to the clicked element. Account limits stay
  // collapsed by default and refresh only when the user expands that section.
  const openOptionsMenu = (anchorEl: HTMLElement) => {
    setLimitOpen(false);
    setModeMenuAnchor(anchorEl);
  };

  return (
    // Plain relative Box: the only in-flow child is the input bar. The tags +
    // image thumbnails float above it (absolute, each with its own shadow), and
    // the multiline input lifts into an upward overlay — nothing reflows the thread.
    <Box ref={rootRef} sx={{ position: "relative" }}>
      {/* Floating row — square tiles (wakeups, mode, review, over-limit) +
          attachment tiles, always mounted so height can be measured. */}
      <Box
        ref={tagsRef}
        sx={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: `calc(100% + ${8 + overlayLift}px)`,
          // pl aligns the tile row's left edge with the text-input column start:
          // 1px bar-border + 4px bar-padding + 30px context control + 4px flex-gap = 39px
          pl: "39px",
          pr: "5px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          gap: 0.75,
          pointerEvents: "none",
          zIndex: 6,
        }}
      >
        {scheduledWakeups.map((wakeup) => (
          <FloatingTile
            key={wakeup.id}
            tone="warn"
            icon={<AccessTimeIcon sx={{ fontSize: 20 }} />}
            label={wakeup.label}
            removeLabel={wakeup.removeLabel}
            onRemove={wakeup.onRemove}
            testId={`scheduled-wakeup-tile-${wakeup.id}`}
          />
        ))}
        {queuedMessageCount > 0 && (
          <FloatingTile
            tone="warn"
            icon={<SendTimeExtensionIcon sx={{ fontSize: 20 }} />}
            label={queuedMessageCount > 1 ? t("sendQueuedNowCount", { count: queuedMessageCount }) : t("sendQueuedNow")}
            onClick={onSendQueuedNow}
            testId="queued-message-send-now"
          />
        )}
        {limitWarningLabel && (
          <Tooltip title={limitWarningHint ?? ""}>
            <FloatingTile
              tone={limitWarningTone}
              icon={<WarningAmberRoundedIcon sx={{ fontSize: 20 }} />}
              label={limitWarningLabel}
              testId="agent-limit-warning"
            />
          </Tooltip>
        )}
        {contextOverLimit && (
          <Tooltip title={t("contextOverLimitHint")}>
            <FloatingTile
              tone="danger"
              icon={<WarningAmberRoundedIcon sx={{ fontSize: 20 }} />}
              label={t("contextOverLimit")}
              disabled={running}
              onClick={() => onCompactNow?.()}
              testId="context-over-limit"
            />
          </Tooltip>
        )}
        {reviewCount > 0 && (
          <FloatingTile
            tone="accent"
            icon={<RateReviewOutlinedIcon sx={{ fontSize: 20 }} />}
            label={t("reviewPending", { count: reviewCount })}
          />
        )}
        {activeModeOption && (
          <FloatingTile
            tone="accent"
            icon={<AutoAwesomeRoundedIcon sx={{ fontSize: 20 }} />}
            label={activeModeOption.label}
            removeLabel={t("disableMode", { mode: activeModeOption.label })}
            onRemove={() => onModeChange?.("default")}
            testId="active-mode-tile"
          />
        )}
        {composerAttachments.map((attachment) => {
          const isImage = isImageMime(attachment.type) && Boolean(attachment.path);
          return (
            <AttachmentTile
              key={attachment.id}
              name={attachment.name}
              mime={attachment.type}
              sizeBytes={attachment.size}
              previewSrc={isImage ? localFileUrl(attachment.path ?? "") : undefined}
              removeLabel={t("removeAttachment", { name: attachment.name })}
              onRemove={() => setComposerAttachments(composerAttachments.filter((item) => item.id !== attachment.id))}
              onOpen={isImage ? () => setPreviewAttachment(attachment) : undefined}
            />
          );
        })}
      </Box>
      <Box
        data-testid="composer-bar"
        ref={composerBarRef}
        onPointerMove={updateComposerBorderHover}
        onPointerLeave={clearComposerBorderHover}
        onPointerCancel={clearComposerBorderHover}
        sx={{
          "--composer-border-x": "50%",
          "--composer-border-y": "50%",
          "--composer-border-hover-opacity": 0,
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          p: 0.5,
          position: "relative",
          borderRadius: (t) => `${t.custom.radii.lg}px`,
          backgroundColor: (t) => t.custom.surfaces.s2,
          border: (t) => `1px solid ${t.custom.borders.subtle}`,
          transition: "border-color 140ms ease",
          "& > *": {
            position: "relative",
            zIndex: 1,
          },
          "&::after": {
            content: '""',
            position: "absolute",
            inset: 0,
            zIndex: 0,
            pointerEvents: "none",
            borderRadius: "inherit",
            padding: "1px",
            opacity: "var(--composer-border-hover-opacity)",
            transition: "opacity 180ms ease",
            background: (theme) => {
              const hot = theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.58)" : "rgba(11, 18, 32, 0.28)";
              const soft = theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.18)" : "rgba(11, 18, 32, 0.10)";
              return `radial-gradient(${COMPOSER_BORDER_HOVER_RADIUS_PX}px ${COMPOSER_BORDER_HOVER_RADIUS_PX}px at var(--composer-border-x) var(--composer-border-y), ${hot} 0, ${soft} 58%, transparent 100%)`;
            },
            WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
            WebkitMaskComposite: "xor",
            mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
            maskComposite: "exclude",
          },
          "& .MuiIconButton-root:not([data-testid='composer-voice-button'])": { width: 30, height: 30 },
          "&:focus-within": {
            borderColor: (t) => t.custom.borders.strong,
          },
        }}
      >
        <input
          ref={fileInputRef}
          data-testid="composer-file-input"
          aria-label={t("chooseFiles")}
          multiple
          type="file"
          onChange={chooseFiles}
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        />
        {/* One options control: the context ring replaces the old settings icon
            and opens the same menu upward. */}
        <ContextGauge
          tokens={effectiveContextTokens}
          window={effectiveContextWindow}
          hitSize={30}
          testId="composer-options-button"
          ariaLabel={`${t("composerOptions")} · ${t("contextUsage")} · ${Math.round((effectiveContextTokens / effectiveContextWindow) * 100)}%`}
          onClick={(event) => openOptionsMenu(event.currentTarget)}
        />
        <Menu
          action={optionsMenuActionRef}
          anchorEl={modeMenuAnchor}
          open={Boolean(modeMenuAnchor)}
          onClose={() => {
            setModeMenuAnchor(null);
          }}
          anchorOrigin={{ vertical: "top", horizontal: "left" }}
          transformOrigin={{ vertical: "bottom", horizontal: "left" }}
          slotProps={{
            paper: {
              sx: {
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.14)",
                minWidth: 304,
              },
            },
            list: {
              dense: true,
              ref: (node: HTMLUListElement | null) => {
                optionsMenuListRef.current = node;
              },
              sx: { py: 0.5, width: "100%" },
            },
          }}
        >
          <MenuItem
            onClick={() => {
              setModeMenuAnchor(null);
              fileInputRef.current?.click();
            }}
            sx={{ gap: 1, fontSize: "0.8rem", minHeight: 0 }}
          >
            <AttachFileIcon sx={{ fontSize: 16, color: "text.secondary" }} />
            <Box component="span">{t("attach")}</Box>
          </MenuItem>
          {modes.length > 0 && (
            <>
              {modes.map((mode) => (
                <MenuItem key={mode.id} onClick={() => onModeChange?.(mode.id === activeMode ? "default" : mode.id)} sx={modeMenuItemSx}>
                  <AutoAwesomeRoundedIcon sx={{ fontSize: 15, color: "text.secondary" }} />
                  <Box component="span" sx={{ minWidth: 84 }}>{mode.label}</Box>
                  <Switch size="small" checked={mode.id === activeMode} onChange={() => undefined} tabIndex={-1} sx={modeSwitchSx} />
                </MenuItem>
              ))}
            </>
          )}
          {showBrowserActivitySection && (
            <>
              <Divider sx={{ my: 0.5 }} />
              <Box
                data-testid="composer-browser-activity-section"
                sx={{ px: 2, py: 0.75, cursor: "default" }}
                onClick={(event) => event.stopPropagation()}
              >
                <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", mb: 0.75 }}>
                  <OpenInBrowserIcon sx={{ fontSize: 15, color: "text.secondary" }} />
                  <Typography variant="microLabel" sx={{ color: "text.secondary", display: "block" }}>
                    {t("browserPreviewActivityTitle")}
                  </Typography>
                </Stack>
                {browserActivityEvents.length > 0 ? (
                  <Stack spacing={0.65}>
                    {[...browserActivityEvents].reverse().slice(0, 4).map((event) => {
                      const tone = browserActivityTone(event.type);
                      return (
                        <Box
                          key={event.id}
                          sx={{
                            minWidth: 0,
                            display: "grid",
                            gridTemplateColumns: "8px minmax(0, 1fr)",
                            alignItems: "baseline",
                            columnGap: 0.75,
                          }}
                        >
                          <Box
                            component="span"
                            aria-hidden="true"
                            sx={{
                              width: 7,
                              height: 7,
                              borderRadius: "50%",
                              backgroundColor: (theme) =>
                                tone === "error"
                                  ? theme.palette.status.error.main
                                  : tone === "warning"
                                    ? theme.palette.status.running.main
                                    : tone === "success"
                                      ? theme.palette.status.ok.main
                                      : theme.palette.status.info.main,
                            }}
                          />
                          <Typography
                            noWrap
                            title={event.detail ? `${event.label}: ${event.detail}` : event.label}
                            sx={{
                              minWidth: 0,
                              fontFamily: (theme) => theme.custom.fonts.mono,
                              fontSize: "0.72rem",
                              color: "text.primary",
                            }}
                          >
                            {event.label}
                            {event.detail ? (
                              <Box component="span" sx={{ color: "text.secondary" }}>
                                {" · "}
                                {event.detail}
                              </Box>
                            ) : null}
                          </Typography>
                        </Box>
                      );
                    })}
                  </Stack>
                ) : (
                  <Typography sx={{ fontSize: "0.72rem", color: "text.tertiary" }}>
                    {t("browserPreviewActivityEmpty")}
                  </Typography>
                )}
              </Box>
            </>
          )}
          {/* Account rate limits (ЛИМИТЫ АККАУНТА) */}
          <Divider sx={{ my: 0.5 }} />
          <Box sx={{ px: 2, py: 0.75, cursor: "default" }} onClick={(event) => event.stopPropagation()}>
            <Box
              component="button"
              type="button"
              aria-expanded={limitOpen}
              aria-controls="composer-agent-limits"
              onClick={toggleLimitsOpen}
              sx={{
                width: "100%",
                border: 0,
                p: 0,
                m: 0,
                display: "flex",
                alignItems: "center",
                gap: 0.75,
                cursor: "pointer",
                color: "inherit",
                background: "transparent",
                textAlign: "left",
              }}
            >
              <Typography variant="microLabel" sx={{ color: "text.secondary", display: "block", flex: 1, minWidth: 0 }}>
                {t("limitsLabel")}
              </Typography>
              {agentLimitRefreshing ? (
                <Typography sx={{ fontSize: "0.72rem", color: "text.tertiary", fontFamily: (theme) => theme.custom.fonts.mono }}>…</Typography>
              ) : null}
              <KeyboardArrowDownRoundedIcon
                sx={{
                  fontSize: 16,
                  color: "text.secondary",
                  transform: limitOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 140ms ease",
                }}
              />
            </Box>
            <Collapse
              in={limitOpen}
              timeout={120}
              unmountOnExit={false}
              onEnter={updateOptionsMenuPosition}
              onEntering={updateOptionsMenuPosition}
              onEntered={updateOptionsMenuPosition}
              onExit={updateOptionsMenuPosition}
              onExiting={updateOptionsMenuPosition}
              onExited={updateOptionsMenuPosition}
            >
              <Box id="composer-agent-limits" sx={{ pt: 0.75 }}>
                {limitLines.length > 0 ? (
                  <Stack spacing={1}>
                    {limitLines.map((line) => (
                      <MeterRow key={line.id} label={line.label} value={line.value} percent={line.percent} />
                    ))}
                  </Stack>
                ) : (
                  <Typography sx={{ fontSize: "0.72rem", color: "text.tertiary" }}>
                    {!agentLimitLoaded ? "…" : agentId && LIMIT_UNSUPPORTED_AGENTS.has(agentId) ? t("limitsUnavailable") : t("limitsNoData")}
                  </Typography>
                )}
                {agentLimitRefreshError ? (
                  <Typography sx={{ mt: 0.75, fontSize: "0.72rem", color: "status.error" }}>
                    {agentLimitRefreshError}
                  </Typography>
                ) : null}
              </Box>
            </Collapse>
          </Box>
          {/* Compaction — below both conversation info sections */}
          <Divider sx={{ my: 0.5 }} />
          {supportsAutoCompactToggle && (
            <MenuItem onClick={() => onAutoCompactChange?.(!autoCompact)} sx={modeMenuItemSx}>
              <CompressRoundedIcon sx={{ fontSize: 15, color: "text.secondary" }} />
              <Box component="span" sx={{ flex: 1, minWidth: 0 }}>{t("compactionAuto")}</Box>
              <Switch size="small" checked={autoCompact} onChange={() => undefined} tabIndex={-1} sx={modeSwitchSx} />
            </MenuItem>
          )}
          {supportsCompactionWindow && (supportsAutoCompactToggle ? autoCompact : true) && (
            <Box
              sx={{ ...modeMenuItemSx, alignItems: "center", cursor: "default", py: 0.5 }}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <CompressRoundedIcon sx={{ fontSize: 16, color: "text.secondary" }} />
              <Box component="span" sx={{ flex: 1, minWidth: 0 }}>{t("compactionWindow")}</Box>
              <TextField
                type="text"
                inputMode="numeric"
                size="small"
                value={typeof compactWindow === "number" ? String(compactWindow) : ""}
                placeholder={typeof contextWindow === "number" ? String(contextWindow) : t("compactionWindowAuto")}
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, "");
                  const parsed = Number.parseInt(digits, 10);
                  onCompactWindowChange?.(digits === "" || Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed);
                }}
                slotProps={{ htmlInput: { inputMode: "numeric", pattern: "[0-9]*", "aria-label": t("compactionWindow"), style: { padding: "4px 8px", fontSize: "0.72rem", textAlign: "right" } } }}
                sx={{ width: 132, "& .MuiInputBase-root": { fontFamily: (th) => th.custom.fonts.mono } }}
              />
            </Box>
          )}
          <MenuItem
            disabled={running}
            onClick={() => {
              setModeMenuAnchor(null);
              onCompactNow?.();
            }}
            sx={{ gap: 1, fontSize: "0.8rem", minHeight: 0, pl: 2, pr: 1 }}
          >
            <CompressRoundedIcon sx={{ fontSize: 16, color: "text.secondary" }} />
            <Box component="span">{t("compactNow")}</Box>
          </MenuItem>
        </Menu>
        <Box
          data-testid="composer-input-area"
          data-expanded={expanded ? "true" : "false"}
          sx={{ position: "relative", flex: 1, minWidth: 0, minHeight: 26, display: "flex", alignItems: "center" }}
        >
          {suggestionsOpen && (
            <Box role="listbox" aria-label={t("suggestions")} sx={{ position: "absolute", left: 0, right: 0, bottom: "100%", mb: 1, zIndex: 7, ...floatingPanelSx }}>
              <Stack spacing={0.25}>
                {suggestions.map((suggestion, index) => (
                  <Button
                    key={suggestion.id}
                    role="option"
                    aria-selected={index === activeIndex}
                    variant="text"
                    size="small"
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveSuggestion(index)}
                    onClick={suggestion.apply}
                    sx={{
                      justifyContent: "flex-start",
                      backgroundColor: (t) => (index === activeIndex ? t.custom.surfaces.s3 : "transparent"),
                      "&:hover": { backgroundColor: (t) => t.custom.surfaces.s3 },
                    }}
                  >
                    {suggestion.mono ? (
                      <Typography component="span" sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.76rem" }}>
                        {suggestion.label}
                      </Typography>
                    ) : (
                      suggestion.label
                    )}
                  </Button>
                ))}
              </Stack>
            </Box>
          )}
          <InputBase
            inputRef={textareaRef}
            value={composerValue}
            onChange={(event) => setComposerValue(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            inputProps={{ "aria-label": placeholder, "data-testid": "composer-input" }}
            multiline
            minRows={1}
            maxRows={expanded ? 8 : 1}
            sx={{
              width: "100%",
              fontSize: "0.84rem",
              lineHeight: 1.45,
              py: 0.25,
              ...(expanded && {
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 5,
                px: 1,
                py: 0.75,
                borderRadius: (t) => `${t.custom.radii.md}px`,
                backgroundColor: (t) => t.custom.surfaces.s2,
                border: (t) => `1px solid ${t.custom.borders.strong}`,
                boxShadow: "0 -10px 28px rgba(0, 0, 0, 0.45)",
              }),
            }}
          />
          {voiceState === "recording" && <VoiceRecordingStrip label={voiceLabel} duration={voiceDuration} levels={voiceLevels} onLevelCountChange={setVoiceLevelCountForWidth} />}
        </Box>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", flex: "0 0 auto" }}>
          {!running && !voiceInputActive ? (
            <Box sx={{ display: { xs: "none", sm: "flex" }, alignItems: "center", gap: 0.5 }}>
              <KeyHint keys="⏎" />
            </Box>
          ) : null}
          {voiceAvailable && (
            <Tooltip title={voiceLabel}>
              <span style={{ display: "flex" }}>
                <IconButton
                  data-testid="composer-voice-button"
                  aria-label={voiceLabel}
                  tone="subtle"
                  disabled={voiceState === "transcribing"}
                  onClick={toggleVoiceInput}
                  sx={{
                    width: 30,
                    height: 30,
                    borderRadius: (theme) => `${theme.custom.radii.md}px`,
                    backgroundColor: (theme) => (voiceState === "recording" ? theme.palette.status.info.soft : theme.custom.surfaces.s3),
                    borderColor: (theme) => (voiceState === "recording" ? theme.palette.status.info.border : theme.custom.borders.strong),
                    color: (theme) => (voiceState === "recording" ? theme.palette.status.info.main : theme.palette.text.primary),
                    "&:hover": {
                      backgroundColor: (theme) => (voiceState === "recording" ? theme.palette.status.info.soft : theme.custom.surfaces.s4),
                    },
                  }}
                >
                  {voiceState === "recording" ? <StopCircleIcon sx={{ fontSize: 18 }} /> : <MicRoundedIcon sx={{ fontSize: 18 }} />}
                </IconButton>
              </span>
            </Tooltip>
          )}
          {showAgentStopButton ? (
            <IconButton
              data-testid="composer-stop-button"
              aria-label={t("stopRun")}
              tone="danger"
              onClick={onStop}
              sx={{ width: 30, height: 30, borderRadius: (theme) => `${theme.custom.radii.md}px` }}
            >
              <StopCircleIcon sx={{ fontSize: 18 }} />
            </IconButton>
          ) : (
            <Button
              variant="contained"
              onClick={() => void send()}
              disabled={!canSend}
              sx={{
                height: 30,
                width: 30,
                minWidth: 30,
                px: 0,
                py: 0,
                borderRadius: (t) => `${t.custom.radii.md}px`,
              }}
              aria-label={sendLabel}
              data-testid="composer-send-button"
            >
              <SendIcon sx={{ fontSize: 16 }} />
            </Button>
          )}
        </Stack>
      </Box>
      {/* Full-screen preview of a clicked image attachment; closes on the X or a
          backdrop click (ImageLightbox's Backdrop handles both). */}
      <ImageLightbox
        src={previewAttachment?.path ?? null}
        label={previewAttachment?.name}
        onClose={() => setPreviewAttachment(null)}
      />
    </Box>
  );
});
