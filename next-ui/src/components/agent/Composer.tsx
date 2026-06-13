import AttachFileIcon from "@mui/icons-material/AttachFile";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import MicRoundedIcon from "@mui/icons-material/MicRounded";
import OpenInBrowserIcon from "@mui/icons-material/OpenInBrowser";
import RateReviewOutlinedIcon from "@mui/icons-material/RateReviewOutlined";
import SendIcon from "@mui/icons-material/Send";
import SendTimeExtensionIcon from "@mui/icons-material/SendTimeExtension";
import CompressRoundedIcon from "@mui/icons-material/CompressRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import { Box, Collapse, Divider, InputBase, Menu, MenuItem, Stack, Switch, type SxProps, TextField, type Theme, Tooltip, Typography } from "@mui/material";
import type { PopoverActions } from "@mui/material/Popover";
import { observer } from "mobx-react-lite";
import { type ChangeEvent, type ClipboardEvent, type FormEvent, forwardRef, type KeyboardEvent, type MouseEvent, type PointerEvent, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { localFileUrl } from "../../lib/external-url";
import { ImageLightbox } from "../workspace/ImageLightbox";
import { Button, IconButton, KeyHint } from "../ui";
import { AttachmentTile } from "./AttachmentTile";
import { FloatingTile } from "./ComposerFloatingTile";
import {
  browserActivityTone,
  supportsAutoCompactToggle,
  supportsCompactionWindow,
  type ComposerBrowserActivityEvent,
  type ComposerVoiceProvider,
} from "./composer-model";
import type { ComposerAttachmentDraft, ComposerDraft } from "./types";
import {
  VOICE_DEFAULT_LEVEL_COUNT,
  VOICE_IDLE_LEVELS,
  VOICE_NO_SPEECH_NOTICE_DELAY_MS,
  VoiceRecordingStrip,
  formatVoiceDuration,
  speechRecognitionConstructor,
  isMobileSpeechRecognitionRuntime,
  preferredAudioMimeType,
  voiceAmbientLevels,
  voiceIdleLevels,
  voiceLevelCountFromWidth,
  voiceLevelsFromTimeDomainData,
  type SpeechRecognitionLike,
} from "./ComposerVoice";
import type { AgentRateLimit, RateLimitWindow } from "./agent-limits";
import {
  PASTE_AS_FILE_CHARS,
  attachmentBlock,
  blobToBase64,
  composerDraftsEqual,
  displayPluginToken,
  escapeRegExp,
  fileToAttachmentDraft,
  isImageMime,
  mentionQuery,
  pluginLinkQuery,
  readComposerResponseError,
} from "./composer-utils";
import { ComposerStore } from "./composer-store";
export { voiceLevelCountFromWidth, voiceLevelsFromTimeDomainData } from "./ComposerVoice";

const COMPOSER_BORDER_HOVER_RADIUS_PX = 42;
const COMPOSER_OPTIONS_MENU_Y_OFFSET_PX = -12;
const LIMIT_UNSUPPORTED_AGENTS = new Set<string>(["opencode"]);
let pastedFileNameSeq = 0;

interface ComposerPluginTokenRange {
  readonly token: string;
  readonly start: number;
  readonly end: number;
}

function pluginTokenRanges(value: string, pattern: RegExp | null): readonly ComposerPluginTokenRange[] {
  if (!pattern) {
    return [];
  }
  return Array.from(value.matchAll(pattern)).flatMap((match) => {
    const token = match[0];
    const start = match.index;
    return typeof start === "number" && token.length > 0 ? [{ token, start, end: start + token.length }] : [];
  });
}

function selectionIntersectsRange(selectionStart: number, selectionEnd: number, range: ComposerPluginTokenRange): boolean {
  return selectionStart < range.end && selectionEnd > range.start;
}

function tokenRangeForDeleteKey(ranges: readonly ComposerPluginTokenRange[], selectionStart: number, selectionEnd: number, key: "Backspace" | "Delete"): { readonly start: number; readonly end: number } | null {
  const selectedRanges = ranges.filter((range) => selectionIntersectsRange(selectionStart, selectionEnd, range));
  if (selectedRanges.length > 0) {
    return {
      start: Math.min(selectionStart, selectedRanges[0]?.start ?? selectionStart),
      end: Math.max(selectionEnd, selectedRanges[selectedRanges.length - 1]?.end ?? selectionEnd),
    };
  }
  if (key === "Backspace") {
    const range = ranges.find((item) => selectionStart > item.start && selectionStart <= item.end);
    return range ? { start: range.start, end: range.end } : null;
  }
  const range = ranges.find((item) => selectionStart >= item.start && selectionStart < item.end);
  return range ? { start: range.start, end: range.end } : null;
}

function commonPrefixLength(left: string, right: string): number {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function commonSuffixLength(left: string, right: string, prefixLength: number): number {
  let length = 0;
  while (
    length < left.length - prefixLength
    && length < right.length - prefixLength
    && left[left.length - 1 - length] === right[right.length - 1 - length]
  ) {
    length += 1;
  }
  return length;
}

function normalizePluginTokenDeletion(previous: string, next: string, ranges: readonly ComposerPluginTokenRange[]): { readonly value: string; readonly caret: number } | null {
  if (next.length >= previous.length || ranges.length === 0) {
    return null;
  }
  const prefixLength = commonPrefixLength(previous, next);
  const suffixLength = commonSuffixLength(previous, next, prefixLength);
  const changedStart = prefixLength;
  const changedEnd = previous.length - suffixLength;
  const touchedRanges = ranges.filter((range) => selectionIntersectsRange(changedStart, changedEnd, range));
  if (touchedRanges.length === 0) {
    return null;
  }
  const start = Math.min(changedStart, touchedRanges[0]?.start ?? changedStart);
  const end = Math.max(changedEnd, touchedRanges[touchedRanges.length - 1]?.end ?? changedEnd);
  return { value: previous.slice(0, start) + previous.slice(end), caret: start };
}

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

/** Imperative handle so a parent drop-zone (the whole chat pane) can hand files
 *  to the composer's attachment pipeline. */
export interface ComposerHandle {
  readonly addFiles: (files: readonly File[]) => Promise<void>;
  readonly focus: () => void;
}

export interface ComposerPluginLink {
  readonly id: string;
  readonly label: string;
  readonly token: string;
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
  /** Sandbox approval setting for CLIs where this is not a chat work mode. */
  readonly autoConfirm?: boolean;
  readonly supportsAutoConfirm?: boolean;
  readonly onAutoConfirmChange?: (enabled: boolean) => void;
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
  /** Current agent id, used for agent-specific composer controls. */
  readonly agentId?: string;
  /** Shared account rate-limits for the selected CLI agent, shown inside the options menu. */
  readonly agentLimit?: AgentRateLimit | null;
  readonly agentLimitLoaded?: boolean;
  readonly agentLimitRefreshing?: boolean;
  readonly agentLimitRefreshError?: string | null;
  readonly onRefreshAgentLimits?: (requestRefresh: boolean) => void;
  /** The selected conversation's latest-turn context-window fill (tokens) and
   *  model window size, used only for the over-limit compaction warning. */
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
  /** Server-registered rlab tools that can be referenced in the prompt via `$...`. */
  readonly registeredPlugins?: readonly ComposerPluginLink[];
  /** Server-side scheduled wakeups for this chat, rendered as first floating tags. */
  readonly scheduledWakeups?: readonly { readonly id: string; readonly label: string; readonly removeLabel: string; readonly onRemove: () => void }[];
  /** User turns queued behind the current/last run; can be dispatched manually. */
  readonly queuedMessageCount?: number;
  readonly onSendQueuedNow?: () => void;
  /** Selected and server-authorized voice dictation provider. Omitted for "none". */
  readonly voiceProvider?: ComposerVoiceProvider;
  readonly onVoiceError?: (message: string) => void;
}

/** Composer — the chat input. Sends on Enter (Shift+Enter for newline). Sticky
 * at the bottom on mobile; the send button stays a comfortable tap target. */
const ComposerInner = forwardRef<ComposerHandle, ComposerProps>(function Composer(
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
    autoConfirm = false,
    supportsAutoConfirm = false,
    onAutoConfirmChange,
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
    registeredPlugins = [],
    scheduledWakeups = [],
    queuedMessageCount = 0,
    onSendQueuedNow,
    voiceProvider,
    onVoiceError,
  },
  ref,
) {
  const [composerStore] = useState(() => new ComposerStore(initialValue, initialAttachments, VOICE_IDLE_LEVELS));
  const {
    internalValue,
    setInternalValue,
    internalAttachments,
    setInternalAttachments,
    sending,
    setSending,
    activeSuggestion,
    setActiveSuggestion,
    suggestDismissed,
    setSuggestDismissed,
    modeMenuAnchor,
    setModeMenuAnchor,
    optionsMenuMaxHeight,
    setOptionsMenuMaxHeight,
    expanded,
    setExpanded,
    overlayLift,
    setOverlayLift,
    previewAttachment,
    setPreviewAttachment,
    limitOpen,
    setLimitOpen,
    voiceState,
    setVoiceState,
    voiceRecordingStartedAt,
    setVoiceRecordingStartedAt,
    voiceClock,
    setVoiceClock,
    voiceLevels,
    setVoiceLevels,
    voiceAmbient,
    setVoiceAmbient,
    browserVoiceSupported,
    setBrowserVoiceSupported,
  } = composerStore;
  // True when the input needs more than one row; it then lifts into an upward-
  // growing overlay (so the bar height never changes), and the floating tags
  // rise above it by `overlayLift`.
  const onOverlayLiftChangeRef = useRef(onOverlayLiftChange);
  onOverlayLiftChangeRef.current = onOverlayLiftChange;
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
  const voiceBrowserInterimTranscriptRef = useRef("");
  const voiceLevelValuesRef = useRef<readonly number[]>(VOICE_IDLE_LEVELS);
  const voiceLevelLastPaintRef = useRef(0);
  const voiceLevelCountRef = useRef(VOICE_DEFAULT_LEVEL_COUNT);
  const singleRowRef = useRef(0);
  // Shell-style history navigation: -1 means "not browsing"; otherwise an index
  // into `history`. `historyDraftRef` holds the text being composed before the
  // user started scrolling back, so ArrowDown past the newest restores it.
  const historyIndexRef = useRef(-1);
  const historyDraftRef = useRef("");
  const pendingCaretToEndRef = useRef(false);
  const pendingSelectionRef = useRef<{ readonly start: number; readonly end: number } | null>(null);
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
    const pendingSelection = pendingSelectionRef.current;
    if (pendingSelection) {
      pendingSelectionRef.current = null;
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(pendingSelection.start, pendingSelection.end);
      }
      return;
    }
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

  const q = mentionQuery(composerValue);
  const pluginQ = pluginLinkQuery(composerValue);
  const mentionedFiles = useMemo(
    () => (q == null ? [] : mentionableFiles.filter((file) => file.toLowerCase().includes(q)).slice(0, 8)),
    [mentionableFiles, q],
  );
  const mentionedPlugins = useMemo(
    () =>
      pluginQ == null
        ? []
        : registeredPlugins
            .filter((plugin) => {
              const haystack = `${plugin.id} ${plugin.label} ${plugin.token}`.toLowerCase();
              return haystack.includes(pluginQ);
            })
            .slice(0, 8),
    [pluginQ, registeredPlugins],
  );
  const composerPluginTokenPattern = useMemo(() => {
    const tokens = new Set<string>();
    registeredPlugins.forEach((plugin) => {
      if (plugin.token.startsWith("$")) {
        tokens.add(plugin.token);
      }
    });
    if (tokens.has("$TaskWakeup")) {
      tokens.add("$ScheduleWakeup");
    }
    if (tokens.size === 0) {
      return null;
    }
    return new RegExp(`(${Array.from(tokens).sort((left, right) => right.length - left.length).map(escapeRegExp).join("|")})\\b`, "g");
  }, [registeredPlugins]);
  const composerPluginTokenRanges = useMemo(() => pluginTokenRanges(composerValue, composerPluginTokenPattern), [composerPluginTokenPattern, composerValue]);
  const composerPluginPreviewParts = useMemo(() => {
    if (composerPluginTokenRanges.length === 0) {
      return [];
    }
    const parts: ReadonlyArray<{ readonly type: "text"; readonly text: string } | { readonly type: "plugin"; readonly token: string }> = [];
    const mutableParts: Array<{ readonly type: "text"; readonly text: string } | { readonly type: "plugin"; readonly token: string }> = [];
    let lastIndex = 0;
    for (const range of composerPluginTokenRanges) {
      if (range.start > lastIndex) {
        mutableParts.push({ type: "text", text: composerValue.slice(lastIndex, range.start) });
      }
      mutableParts.push({ type: "plugin", token: range.token });
      lastIndex = range.end;
    }
    if (lastIndex < composerValue.length) {
      mutableParts.push({ type: "text", text: composerValue.slice(lastIndex) });
    }
    return mutableParts.length === 1 && mutableParts[0]?.type === "text" ? parts : mutableParts;
  }, [composerPluginTokenRanges, composerValue]);
  const hasComposerPluginPreview = composerPluginPreviewParts.length > 0;

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
    setVoiceLevels((current) => (current.length === levelCount ? current : voiceAmbient ? voiceAmbientLevels(levelCount) : voiceIdleLevels(levelCount)));
  }, [voiceAmbient]);

  const setAmbientVoiceLevels = useCallback((enabled: boolean) => {
    setVoiceAmbient(enabled);
    if (enabled) {
      const levels = voiceAmbientLevels(voiceLevelCountRef.current);
      voiceLevelValuesRef.current = levels;
      setVoiceLevels(levels);
    }
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

  const replaceComposerRange = (start: number, end: number, replacement = "") => {
    const caret = start + replacement.length;
    pendingSelectionRef.current = { start: caret, end: caret };
    setComposerValue(composerValue.slice(0, start) + replacement + composerValue.slice(end));
  };

  const deleteComposerPluginToken = (key: "Backspace" | "Delete"): boolean => {
    const el = textareaRef.current;
    if (!el || composerPluginTokenRanges.length === 0) {
      return false;
    }
    const range = tokenRangeForDeleteKey(composerPluginTokenRanges, el.selectionStart, el.selectionEnd, key);
    if (!range) {
      return false;
    }
    replaceComposerRange(range.start, range.end);
    return true;
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

  const commitBrowserInterimDictation = useCallback((): boolean => {
    const interim = voiceBrowserInterimTranscriptRef.current;
    voiceBrowserInterimTranscriptRef.current = "";
    return appendDictation(interim);
  }, [appendDictation]);

  const stopVoiceAnalyser = useCallback(() => {
    setVoiceAmbient(false);
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
    mediaStreamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });
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
    if (!Recognition) {
      onVoiceError?.(t("voiceInputUnavailable", { provider: voiceProvider.name }));
      return;
    }
    try {
      const isMobileRuntime = isMobileSpeechRecognitionRuntime();
      if (!isMobileRuntime && navigator.mediaDevices && typeof window.AudioContext !== "undefined") {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        startVoiceAnalyser(stream);
      } else {
        setAmbientVoiceLevels(true);
      }
      const recognition = new Recognition();
      const allowAutoRestart = !isMobileRuntime;
      recognition.lang = voiceProvider.language;
      recognition.continuous = allowAutoRestart;
      recognition.interimResults = true;
      const finishRecognition = () => {
        recognitionRef.current = null;
        clearVoiceNoSpeechNotice();
        stopVoiceTracks();
        setVoiceState("idle");
      };
      recognition.onresult = (event) => {
        let finalTranscript = "";
        let interimTranscript = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (result?.isFinal) {
            finalTranscript += result[0]?.transcript ?? "";
          } else {
            interimTranscript += result?.[0]?.transcript ?? "";
          }
        }
        if (finalTranscript.trim()) {
          voiceBrowserInterimTranscriptRef.current = "";
          appendDictation(finalTranscript);
          return;
        }
        if (interimTranscript.trim()) {
          voiceBrowserInterimTranscriptRef.current = interimTranscript;
          voiceRecognizedRef.current = true;
          clearVoiceNoSpeechNotice();
        }
      };
      recognition.onerror = (event) => {
        if (voiceManualStopRef.current && (event.error === "aborted" || event.error === "no-speech")) {
          commitBrowserInterimDictation();
          finishRecognition();
          return;
        }
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
        const committed = commitBrowserInterimDictation();
        const shouldReportNoSpeech = !committed && !voiceManualStopRef.current && !voiceRecognizedRef.current;
        if (allowAutoRestart && !voiceManualStopRef.current && recognitionRef.current === recognition) {
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
        finishRecognition();
        if (shouldReportNoSpeech) {
          scheduleVoiceNoSpeechNotice();
        }
      };
      voiceManualStopRef.current = false;
      voiceRecognizedRef.current = false;
      voiceNoSpeechNotifiedRef.current = false;
      voiceBrowserInterimTranscriptRef.current = "";
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
  }, [appendDictation, clearVoiceNoSpeechNotice, commitBrowserInterimDictation, onVoiceError, scheduleVoiceNoSpeechNotice, setAmbientVoiceLevels, startVoiceAnalyser, stopVoiceTracks, t, voiceProvider]);

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

  const handleComposerChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const nextValue = event.target.value;
    const normalized = normalizePluginTokenDeletion(composerValue, nextValue, composerPluginTokenRanges);
    if (normalized) {
      pendingSelectionRef.current = { start: normalized.caret, end: normalized.caret };
      setComposerValue(normalized.value);
      return;
    }
    setComposerValue(nextValue);
  };

  const handleBeforeInput = (event: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const nativeEvent = event.nativeEvent as InputEvent;
    if (nativeEvent.inputType === "deleteContentBackward" && deleteComposerPluginToken("Backspace")) {
      event.preventDefault();
      return;
    }
    if (nativeEvent.inputType === "deleteContentForward" && deleteComposerPluginToken("Delete")) {
      event.preventDefault();
    }
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
    if ((event.key === "Backspace" || event.key === "Delete") && deleteComposerPluginToken(event.key)) {
      event.preventDefault();
      return;
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
      return new File([file], `pasted-${kind}-${pastedFileNameSeq++}.${ext}`, { type: file.type });
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

  const insertPluginLink = (plugin: ComposerPluginLink) => {
    setComposerValue(composerValue.replace(/(^|\s)\$([^\s$]*)$/, (_match, prefix: string) => `${prefix}${plugin.token} `));
  };

  // `$` plugin links and @-mentions never appear together at the same caret
  // position, so a single suggestion list covers both.
  const suggestions: ReadonlyArray<{ readonly id: string; readonly label: string; readonly mono?: boolean; readonly apply: () => void }> =
    mentionedPlugins.length > 0
      ? mentionedPlugins.map((plugin) => ({ id: plugin.id, label: plugin.token, mono: true, apply: () => insertPluginLink(plugin) }))
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
    && browserVoiceSupported;
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

  // Context usage is intentionally not rendered as a composer progress control.
  // Keep only the over-limit warning that offers compaction.
  const hasKnownContextWindow = typeof contextWindow === "number" && contextWindow > 0;
  const effectiveContextTokens = typeof contextTokens === "number" && Number.isFinite(contextTokens) && contextTokens > 0 ? contextTokens : 0;
  const contextOverLimit = hasKnownContextWindow && effectiveContextTokens / contextWindow >= 1;
  const supportsAutoCompact = supportsAutoCompactToggle(agentId);
  const supportsCompaction = supportsCompactionWindow(agentId);
  const limitWindowLabel = (kind: RateLimitWindow["kind"]): string =>
    kind === "weekly"
      ? t("limitWindowWeekly")
      : kind === "daily"
        ? t("limitWindowDaily")
        : kind === "overage"
          ? t("limitOverage")
          : t("limitWindow5h");
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
        lines.push({
          id: `${window.kind}-${window.label ?? ""}`,
          label: window.label ?? limitWindowLabel(window.kind),
          value: parts.join(" · "),
          percent: typeof window.usedPercent === "number" ? window.usedPercent : undefined,
        });
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

  // Opens the options menu anchored to the clicked element.
  const openOptionsMenu = (anchorEl: HTMLElement) => {
    setLimitOpen(false);
    setOptionsMenuMaxHeight(Math.max(0, Math.floor(anchorEl.getBoundingClientRect().top - 12)));
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
          "& .MuiIconButton-root:not([data-testid='composer-voice-button']):not([data-testid='composer-options-button'])": { width: 30, height: 30 },
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
        <IconButton
          data-testid="composer-options-button"
          aria-label={t("composerOptions")}
          onClick={(event) => openOptionsMenu(event.currentTarget)}
          sx={{ width: 34, height: 34, flex: "0 0 auto", color: "text.secondary" }}
        >
          <SettingsRoundedIcon sx={{ fontSize: 20 }} />
        </IconButton>
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
                mt: `${COMPOSER_OPTIONS_MENU_Y_OFFSET_PX}px`,
                minWidth: 304,
                maxHeight: optionsMenuMaxHeight,
                overflowY: "auto",
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
          {supportsAutoConfirm && (
            <MenuItem onClick={() => onAutoConfirmChange?.(!autoConfirm)} sx={modeMenuItemSx}>
              <AutoAwesomeRoundedIcon sx={{ fontSize: 15, color: "text.secondary" }} />
              <Box component="span" sx={{ minWidth: 84 }}>{t("agentModeAutoConfirm")}</Box>
              <Switch size="small" checked={autoConfirm} onChange={() => undefined} tabIndex={-1} sx={modeSwitchSx} />
            </MenuItem>
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
          {/* Compaction — below both conversation info sections */}
          <Divider sx={{ my: 0.5 }} />
          {supportsAutoCompact && (
            <MenuItem onClick={() => onAutoCompactChange?.(!autoCompact)} sx={modeMenuItemSx}>
              <CompressRoundedIcon sx={{ fontSize: 15, color: "text.secondary" }} />
              <Box component="span" sx={{ flex: 1, minWidth: 0 }}>{t("compactionAuto")}</Box>
              <Switch size="small" checked={autoCompact} onChange={() => undefined} tabIndex={-1} sx={modeSwitchSx} />
            </MenuItem>
          )}
          {supportsCompaction && (supportsAutoCompact ? autoCompact : true) && (
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
          <Divider sx={{ my: 0.5 }} />
          <Box sx={{ px: 2, py: 0.75, cursor: "default" }} onClick={(event) => event.stopPropagation()}>
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
              <Box id="composer-agent-limits" sx={{ pb: 0.75 }}>
                {limitLines.length > 0 ? (
                  <Stack spacing={1}>
                    {limitLines.map((line) => (
                      <MeterRow key={line.id} label={line.label} value={line.value} percent={line.percent} />
                    ))}
                  </Stack>
                ) : (
                  <Typography sx={{ fontSize: "0.72rem", color: "text.tertiary" }}>
                    {!agentLimitLoaded ? "..." : agentId && LIMIT_UNSUPPORTED_AGENTS.has(agentId) ? t("limitsUnavailable") : t("limitsNoData")}
                  </Typography>
                )}
                {agentLimitRefreshError ? (
                  <Typography sx={{ mt: 0.75, fontSize: "0.72rem", color: (theme) => theme.palette.status.error.main }}>
                    {agentLimitRefreshError}
                  </Typography>
                ) : null}
              </Box>
            </Collapse>
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
                backgroundColor: "transparent",
                textAlign: "left",
                font: "inherit",
              }}
            >
              <Typography variant="microLabel" sx={{ color: "text.secondary", display: "block", flex: 1, minWidth: 0 }}>
                {t("limitsLabel")}
              </Typography>
              {agentLimitRefreshing ? (
                <Typography sx={{ fontSize: "0.72rem", color: "text.tertiary", fontFamily: (theme) => theme.custom.fonts.mono }}>...</Typography>
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
          </Box>
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
          {hasComposerPluginPreview && (
            <Box
              data-testid="composer-plugin-preview"
              aria-hidden="true"
              sx={{
                position: "absolute",
                left: expanded ? 8 : 0,
                right: expanded ? 8 : 0,
                top: expanded ? 6 : "50%",
                transform: expanded ? "none" : "translateY(-50%)",
                zIndex: expanded ? 6 : 1,
                pointerEvents: "none",
                display: "block",
                minWidth: 0,
                maxHeight: expanded ? "11.6em" : "1.45em",
                overflow: "hidden",
                color: "text.primary",
                fontSize: "0.84rem",
                lineHeight: 1.45,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              {composerPluginPreviewParts.map((part, index) =>
                part.type === "plugin" ? (
                  <Box
                    key={`${part.token}-${index}`}
                    data-testid="composer-plugin-token"
                    component="span"
                    sx={{
                      display: "inline-block",
                      minWidth: `${part.token.length}ch`,
                      color: "primary.main",
                      fontWeight: 700,
                      textDecoration: "none",
                    }}
                  >
                    {displayPluginToken(part.token)}
                  </Box>
                ) : (
                  <Box key={`text-${index}`} component="span">{part.text}</Box>
                ),
              )}
            </Box>
          )}
          <InputBase
            inputRef={textareaRef}
            value={composerValue}
            onChange={handleComposerChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            inputProps={{ "aria-label": placeholder, "data-testid": "composer-input", spellCheck: false, autoCorrect: "off", autoCapitalize: "none", autoComplete: "off", onBeforeInput: handleBeforeInput }}
            multiline
            minRows={1}
            maxRows={expanded ? 8 : 1}
            sx={{
              width: "100%",
              fontSize: "0.84rem",
              lineHeight: 1.45,
              py: 0.25,
              ...(hasComposerPluginPreview && {
                "& .MuiInputBase-input": {
                  color: "transparent",
                  caretColor: (theme) => theme.palette.text.primary,
                },
              }),
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
          {voiceState === "recording" && <VoiceRecordingStrip label={voiceLabel} duration={voiceDuration} levels={voiceLevels} ambient={voiceAmbient} onLevelCountChange={setVoiceLevelCountForWidth} />}
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
          {!voiceInputActive && (
            showAgentStopButton ? (
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
            )
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

export const Composer = observer(ComposerInner);
