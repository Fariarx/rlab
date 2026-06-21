import AttachFileIcon from "@mui/icons-material/AttachFile";
import ChecklistRoundedIcon from "@mui/icons-material/ChecklistRounded";
import ConstructionRoundedIcon from "@mui/icons-material/ConstructionRounded";
import MicRoundedIcon from "@mui/icons-material/MicRounded";
import OpenInBrowserIcon from "@mui/icons-material/OpenInBrowser";
import RateReviewOutlinedIcon from "@mui/icons-material/RateReviewOutlined";
import RuleRoundedIcon from "@mui/icons-material/RuleRounded";
import SendIcon from "@mui/icons-material/Send";
import CompressRoundedIcon from "@mui/icons-material/CompressRounded";
import DriveFileRenameOutlineRoundedIcon from "@mui/icons-material/DriveFileRenameOutlineRounded";
import SpeedRoundedIcon from "@mui/icons-material/SpeedRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import SummarizeRoundedIcon from "@mui/icons-material/SummarizeRounded";
import TaskAltRoundedIcon from "@mui/icons-material/TaskAltRounded";
import TravelExploreRoundedIcon from "@mui/icons-material/TravelExploreRounded";
import { Box, Divider, InputBase, Menu, MenuItem, Stack, Switch, type SxProps, TextField, type Theme, Tooltip, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { forwardRef, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import { localFileUrl } from "../../../lib/external-url";
import type { ComposerPluginLink } from "../../../lib/rlab-plugins";
import { Button, IconButton, ImageLightbox, KeyHint } from "../../ui";
import { AttachmentTile } from "./AttachmentTile";
import { ComposerTag } from "./ComposerTag";
import { WakeupTile, type WakeupTileProps } from "./WakeupTile";
import { ComposerLimitsPanel } from "./ComposerLimitsPanel";
import { browserActivityTone, type ComposerBrowserActivityEvent, type ComposerVoiceProvider } from "./composer-model";
import type { ComposerAttachmentDraft, ComposerDraft } from "../core/types";
import { isAgentModifierModeId, isAgentWorkModeId } from "../core/agents";
import { VOICE_IDLE_LEVELS, VoiceRecordingStrip } from "./ComposerVoice";
import type { AgentRateLimit } from "../../../lib/agent-limits";
import { isImageMime } from "./composer-utils";
import { useComposerViewModel } from "./composer-view-model";
import { ComposerStore } from "./composer-store";
import { useComposerLayoutController } from "./use-composer-layout-controller";
import { useComposerTextController } from "./use-composer-text-controller";
import { useComposerVoice } from "./use-composer-voice";
import { type ComposerHandle, useComposerFileController } from "./use-composer-file-controller";
export { voiceLevelCountFromWidth, voiceLevelsFromTimeDomainData } from "./ComposerVoice";

const COMPOSER_BORDER_HOVER_RADIUS_PX = 42;
const COMPOSER_OPTIONS_MENU_Y_OFFSET_PX = -12;
const LIMIT_UNSUPPORTED_AGENTS = new Set<string>(["opencode"]);
const WRITE_PLACEHOLDER_PATTERN = /^(?:Написать|Message)\s*:?\s+(.+)$/;

function composerPlaceholderModel(placeholder: string): { readonly inputPlaceholder: string; readonly visualLabel: string | null } {
  const match = WRITE_PLACEHOLDER_PATTERN.exec(placeholder.trim());
  const label = match?.[1]?.trim();
  return label ? { inputPlaceholder: label, visualLabel: label } : { inputPlaceholder: placeholder, visualLabel: null };
}

function ComposerPlaceholderHint({ label, panel = false }: { readonly label: string; readonly panel?: boolean }) {
  return (
    <Box
      aria-hidden
      data-testid="composer-placeholder-hint"
      sx={{
        position: "absolute",
        left: panel ? 8 : 0,
        right: panel ? 8 : 0,
        top: panel ? 8 : "50%",
        transform: panel ? "none" : "translateY(-50%)",
        zIndex: 6,
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        minWidth: 0,
        color: "text.secondary",
        opacity: 0.76,
        fontSize: "0.84rem",
        lineHeight: 1.45,
        pointerEvents: "none",
      }}
    >
      <Box component="span" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </Box>
      <DriveFileRenameOutlineRoundedIcon data-testid="composer-placeholder-icon" sx={{ flex: "0 0 auto", fontSize: 15, color: "inherit" }} />
    </Box>
  );
}

type ComposerModeIconColor = string | ((theme: Theme) => string);

function composerModeColor(modeId: string): ComposerModeIconColor {
  switch (modeId) {
    case "fast":
      return (theme) => theme.palette.status.warn.main;
    case "plan":
      return (theme) => theme.palette.status.info.main;
    case "review":
      return (theme) => theme.palette.status.running.main;
    case "build":
      return (theme) => theme.palette.status.ok.main;
    case "explore":
      return "#a371f7";
    case "summary":
      return (theme) => theme.palette.status.idle.main;
    default:
      return (theme) => theme.palette.status.info.main;
  }
}

function composerModeIcon(modeId: string, color: ComposerModeIconColor = "text.secondary", fontSize = 15): ReactNode {
  const sx = { fontSize, color } as const;
  switch (modeId) {
    case "fast":
      return <SpeedRoundedIcon sx={sx} />;
    case "plan":
      return <RuleRoundedIcon sx={sx} />;
    case "review":
      return <RateReviewOutlinedIcon sx={sx} />;
    case "build":
      return <ConstructionRoundedIcon sx={sx} />;
    case "explore":
      return <TravelExploreRoundedIcon sx={sx} />;
    case "summary":
      return <SummarizeRoundedIcon sx={sx} />;
    default:
      return <ChecklistRoundedIcon sx={sx} />;
  }
}

export type { ComposerHandle } from "./use-composer-file-controller";

export interface ComposerProps {
  readonly placeholder?: string;
  /** Minimal in-thread editing chrome: input, attachments, suggestions, and send. */
  readonly variant?: "default" | "edit";
  readonly mentionableFiles?: readonly string[];
  readonly value?: string;
  readonly attachments?: readonly ComposerAttachmentDraft[];
  readonly initialValue?: string;
  readonly initialAttachments?: readonly ComposerAttachmentDraft[];
  /** Last user message sent in this conversation. Used to reject delayed mobile
   *  browser change events that try to resurrect the submitted text as a draft. */
  readonly recentlySubmittedValue?: string;
  /** Non-default work modes the current agent supports (toggleable per chat). */
  readonly modes?: readonly { readonly id: string; readonly label: string }[];
  /** The currently active work mode id ("default" when none). */
  readonly activeMode?: string;
  readonly onModeChange?: (modeId: string) => void;
  readonly activeModifierModes?: readonly string[];
  readonly onModifierModeChange?: (modeId: string, enabled: boolean) => void;
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
  readonly scheduledWakeups?: readonly WakeupTileProps[];
  /** Full-width accessory rendered directly above the input and below floating tags. */
  readonly queuedContent?: ReactNode;
  /** Selected and server-authorized voice dictation provider. Omitted for "none". */
  readonly voiceProvider?: ComposerVoiceProvider;
  readonly onVoiceError?: (message: string) => void;
}

/** Composer — the chat input. Sends on Enter (Shift+Enter for newline). Sticky
 * at the bottom on mobile; the send button stays a comfortable tap target. */
const ComposerInner = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  {
    placeholder = "Message the agent…",
    variant = "default",
    mentionableFiles = [],
    value,
    attachments,
    initialValue = "",
    initialAttachments = [],
    recentlySubmittedValue,
    modes = [],
    activeMode = "default",
    onModeChange,
    activeModifierModes = [],
    onModifierModeChange,
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
    queuedContent,
    voiceProvider,
    onVoiceError,
  },
  ref,
) {
  const editChrome = variant === "edit";
  const [composerStore] = useState(() => new ComposerStore(initialValue, initialAttachments, VOICE_IDLE_LEVELS));
  const stopVoiceInputRef = useRef<() => void>(() => undefined);
  const stopVoiceInputBeforeSend = useCallback(() => stopVoiceInputRef.current(), []);
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
  } = composerStore;
  // True when the input needs more than one row; it then lifts into an upward-
  // growing overlay (so the bar height never changes), and the floating tags
  // rise above it by `overlayLift`.
  const modifierModes = modes.filter((mode) => isAgentModifierModeId(mode.id));
  const workModes = modes.filter((mode) => isAgentWorkModeId(mode.id));
  const hasModifierModes = modifierModes.length > 0 || supportsAutoConfirm;
  const activeModifierModeIds = new Set([...activeModifierModes, ...(isAgentModifierModeId(activeMode) ? [activeMode] : [])]);
  const activeWorkModeOption = workModes.find((mode) => mode.id === activeMode) ?? null;
  const activeModeIndicatorIcon = activeWorkModeOption ? composerModeIcon(activeWorkModeOption.id, composerModeColor(activeWorkModeOption.id), 13) : null;
  const { t } = useI18n();
  const composerValue = value ?? internalValue;
  const composerAttachments = attachments ?? internalAttachments;
  const placeholderModel = composerPlaceholderModel(placeholder);
  const inputPlaceholder = placeholderModel.inputPlaceholder;
  const showPlaceholderHint = Boolean(placeholderModel.visualLabel) && composerValue.length === 0;
  const showBrowserActivitySection = !editChrome && browserActivityEvents !== undefined;
  const effectiveReviewCount = editChrome ? 0 : reviewCount;
  const [composerFocused, setComposerFocused] = useState(false);
  const inputAreaRef = useRef<HTMLDivElement | null>(null);
  const [floatingInsets, setFloatingInsets] = useState(() => ({ left: editChrome ? 39 : 43, right: 0 }));

  const viewModel = useComposerViewModel({
    activeSuggestion,
    agentId,
    agentLimit,
    agentLimitLoaded,
    agentLimitRefreshError,
    agentLimitRefreshing,
    composerValue,
    contextTokens,
    contextWindow,
    limitOpen,
    mentionableFiles,
    registeredPlugins,
    suggestDismissed,
    t,
  });
  const { suggestions, open: suggestionsOpen, activeIndex, key: suggestionKey } = viewModel.suggestionsState;
  // Parsed `$tool` ranges still drive atomic token deletion, but the input shows
  // them as plain visible text — no transparent-overlay highlight. The overlay
  // approach desynced the native caret on mobile IMEs (text is transparent and
  // the caret rides the real textarea glyphs while a separate, non-scrolling
  // overlay paints the token), so it's gone in favour of a correct caret.
  const composerPluginTokenRanges = viewModel.pluginTokenRanges;

  // Context usage is intentionally not rendered as a composer progress control.
  // Keep only the over-limit warning that offers compaction.
  const { supportsAutoCompact, supportsCompaction } = viewModel.context;
  const { limitLayoutKey, limitLines } = viewModel;
  const {
    clearComposerBorderHover,
    composerBarRef,
    openOptionsMenu,
    optionsMenuActionRef,
    optionsMenuListRef,
    rootRef,
    tagsRef,
    textareaRef,
    updateComposerBorderHover,
    updateOptionsMenuPosition,
  } = useComposerLayoutController({
    composerValue,
    composerFocused,
    expanded,
    limitLayoutKey,
    modeMenuAnchor,
    onOverlayLiftChange,
    onTagsHeightChange,
    setExpanded,
    setLimitOpen,
    setModeMenuAnchor,
    setOptionsMenuMaxHeight,
    setOverlayLift,
  });

  const {
    addFiles,
    applySuggestion,
    canSend,
    handleBeforeInput,
    handleComposerChange,
    handleKeyDown,
    handlePaste,
    hasComposerPayload,
    latestDraftRef,
    send,
    setComposerAttachments,
    updateDraft,
  } = useComposerTextController({
    attachmentsControlled: attachments !== undefined,
    composerAttachments,
    composerValue,
    history,
    initialAttachments,
    initialValue,
    onAttachmentError,
    onBeforeSend: stopVoiceInputBeforeSend,
    onDraftChange,
    onSend,
    onSendReview: editChrome ? undefined : onSendReview,
    pluginTokenRanges: composerPluginTokenRanges,
    recentlySubmittedValue,
    reviewCount: effectiveReviewCount,
    sending,
    setActiveSuggestion,
    setInternalAttachments,
    setInternalValue,
    setSending,
    setSuggestDismissed,
    suggestions,
    suggestionsActiveIndex: activeIndex,
    suggestionsOpen,
    t,
    textareaRef,
    valueControlled: value !== undefined,
  });

  const {
    setVoiceLevelCountForWidth,
    stopVoiceInput,
    toggleVoiceInput,
    voiceAmbient,
    voiceAvailable,
    voiceDuration,
    voiceInputActive,
    voiceLabel,
    voiceLevels,
    voiceState,
  } = useComposerVoice({
    latestDraftRef,
    onVoiceError,
    store: composerStore,
    textareaRef,
    updateDraft,
    voiceProvider: editChrome ? undefined : voiceProvider,
  });
  stopVoiceInputRef.current = stopVoiceInput;
  const visualExpanded = expanded || voiceState === "recording";
  const effectiveOverlayLift = voiceState === "recording" ? Math.max(overlayLift, 48) : overlayLift;
  const floatingAttachments = editChrome ? [] : composerAttachments;
  const hasInlineAttachments = editChrome && composerAttachments.length > 0;
  const hasFloatingTags = (!editChrome && scheduledWakeups.length > 0) || (!editChrome && effectiveReviewCount > 0) || floatingAttachments.length > 0;
  useEffect(() => {
    onOverlayLiftChange?.(effectiveOverlayLift);
  }, [effectiveOverlayLift, onOverlayLiftChange]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const inputArea = inputAreaRef.current;
    if (!root || !inputArea) {
      return;
    }
    let frame = 0;
    const measureFloatingInsets = () => {
      const rootRect = root.getBoundingClientRect();
      const inputRect = inputArea.getBoundingClientRect();
      const left = Math.max(0, Math.round(inputRect.left - rootRect.left));
      const right = Math.max(0, Math.round(rootRect.right - inputRect.right));
      setFloatingInsets((current) => (current.left === left && current.right === right ? current : { left, right }));
    };
    const scheduleMeasure = () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(measureFloatingInsets);
    };
    measureFloatingInsets();
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleMeasure) : null;
    resizeObserver?.observe(root);
    resizeObserver?.observe(inputArea);
    if (composerBarRef.current) {
      resizeObserver?.observe(composerBarRef.current);
    }
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [composerBarRef, rootRef]);

  const { chooseFiles, fileInputRef, openFilePicker } = useComposerFileController({ addFiles, forwardedRef: ref, textareaRef });
  useEffect(() => {
    void suggestionKey;
    setActiveSuggestion(0);
  }, [setActiveSuggestion, suggestionKey]);

  const showAgentStopButton = !editChrome && running && !hasComposerPayload && effectiveReviewCount === 0;
  const sendLabel = effectiveReviewCount > 0 ? t("reviewSendComments") : t("send");
  const inputEventProps = {
    onBeforeInput: handleBeforeInput,
    onFocus: () => setComposerFocused(true),
    onBlur: () => setComposerFocused(false),
  } as const;
  const hiddenNativePlaceholderSx = placeholderModel.visualLabel
    ? {
        "& input::placeholder, & textarea::placeholder": {
          color: "transparent",
          opacity: 0,
        },
      }
    : undefined;
  const renderAttachmentTag = (attachment: ComposerAttachmentDraft) => {
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
  };

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
  const sectionDividerSx: SxProps<Theme> = { my: 0.5, mx: 1.5 };
  const renderWorkModeMenuItem = (mode: { readonly id: string; readonly label: string }) => (
    <MenuItem key={mode.id} onClick={() => onModeChange?.(mode.id === activeMode ? "default" : mode.id)} sx={modeMenuItemSx}>
      {composerModeIcon(mode.id)}
      <Box component="span" sx={{ minWidth: 84 }}>{mode.label}</Box>
      <Switch size="small" checked={mode.id === activeMode} onChange={() => undefined} tabIndex={-1} sx={modeSwitchSx} />
    </MenuItem>
  );
  const renderModifierModeMenuItem = (mode: { readonly id: string; readonly label: string }) => {
    const checked = activeModifierModeIds.has(mode.id);
    return (
      <MenuItem key={mode.id} onClick={() => onModifierModeChange?.(mode.id, !checked)} sx={modeMenuItemSx}>
        {composerModeIcon(mode.id)}
        <Box component="span" sx={{ minWidth: 84 }}>{mode.label}</Box>
        <Switch size="small" checked={checked} onChange={() => undefined} tabIndex={-1} sx={modeSwitchSx} />
      </MenuItem>
    );
  };

  useEffect(() => {
    // The selected agent scopes the rate-limit popover state.
    void agentId;
    setLimitOpen(false);
  }, [agentId, setLimitOpen]);

  const toggleLimitsOpen = () => {
    const nextOpen = !limitOpen;
    setLimitOpen(nextOpen);
    if (nextOpen) {
      onRefreshAgentLimits?.(true);
    }
  };
  const limitEmptyMessage = agentId && LIMIT_UNSUPPORTED_AGENTS.has(agentId) ? t("limitsUnavailable") : t("limitsNoData");

  return (
    // Plain relative Box: the only in-flow child is the input bar. The tags +
    // image thumbnails float above it (absolute, each with its own shadow), and
    // the multiline input lifts into an upward overlay — nothing reflows the thread.
    <Box ref={rootRef} sx={{ position: "relative" }}>
      {/* Floating accessories. From bottom to top: queued turns, then tags
          (wakeups/review/attachments). The wrapper stays mounted so the dock can
          measure the full floating height. */}
      <Box
        ref={tagsRef}
        data-testid="composer-floating-accessories"
        sx={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: `calc(100% + ${8 + effectiveOverlayLift}px)`,
          pl: `${floatingInsets.left}px`,
          pr: `${floatingInsets.right}px`,
          display: "flex",
          flexDirection: "column-reverse",
          alignItems: "stretch",
          gap: 0.75,
          pointerEvents: "none",
          zIndex: 6,
        }}
      >
        {queuedContent ? <Box sx={{ width: "100%", pointerEvents: "auto" }}>{queuedContent}</Box> : null}
        {hasFloatingTags && (
          <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 0.75, pointerEvents: "none" }}>
            {!editChrome && scheduledWakeups.map((wakeup) => (
              <WakeupTile
                key={wakeup.id}
                id={wakeup.id}
                label={wakeup.label}
                removeLabel={wakeup.removeLabel}
                onRemove={wakeup.onRemove}
                detail={wakeup.detail}
              />
            ))}
            {!editChrome && effectiveReviewCount > 0 && (
              <ComposerTag
                icon={<RateReviewOutlinedIcon sx={{ fontSize: 15, color: (theme) => theme.palette.status.info.main }} />}
                label={t("reviewPending", { count: effectiveReviewCount })}
                testId="composer-review-tag"
              />
            )}
            {floatingAttachments.map(renderAttachmentTag)}
          </Box>
        )}
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
        {editChrome ? (
          <Tooltip title={t("attach")}>
            <span style={{ display: "flex" }}>
              <IconButton
                data-testid="composer-attach-button"
                aria-label={t("attach")}
                tone="subtle"
                onClick={openFilePicker}
                sx={{ width: 30, height: 30, borderRadius: (theme) => `${theme.custom.radii.md}px` }}
              >
                <AttachFileIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>
        ) : (
          <>
            <Tooltip title={activeWorkModeOption ? t("activeModeTooltip", { mode: activeWorkModeOption.label }) : t("composerOptions")}>
              <Box sx={{ position: "relative", flex: "0 0 auto", display: "inline-flex" }}>
                <IconButton
                  data-testid="composer-options-button"
                  aria-label={activeWorkModeOption ? t("activeModeTooltip", { mode: activeWorkModeOption.label }) : t("composerOptions")}
                  onClick={(event) => openOptionsMenu(event.currentTarget)}
                  sx={{ width: 34, height: 34, color: "text.secondary", borderRadius: (theme) => `${theme.custom.radii.md}px` }}
                >
                  <SettingsRoundedIcon sx={{ fontSize: 20 }} />
                </IconButton>
                {activeModeIndicatorIcon && (
                  <Box
                    component="span"
                    data-testid="active-mode-indicator"
                    aria-hidden="true"
                    sx={{
                      position: "absolute",
                      top: 2,
                      right: 1,
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      pointerEvents: "none",
                      display: "grid",
                      placeItems: "center",
                      backgroundColor: (theme) => theme.custom.surfaces.s3,
                      border: (theme) => `1px solid ${theme.custom.borders.strong}`,
                      boxShadow: "0 2px 5px rgba(0, 0, 0, 0.46)",
                      color: "text.secondary",
                      "& .MuiSvgIcon-root": {
                        display: "block",
                        filter: "drop-shadow(0 1px 1px rgba(0, 0, 0, 0.65))",
                      },
                    }}
                  >
                    {activeModeIndicatorIcon}
                  </Box>
                )}
              </Box>
            </Tooltip>
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
                  openFilePicker();
                }}
                sx={{ gap: 1, fontSize: "0.8rem", minHeight: 0 }}
              >
                <AttachFileIcon sx={{ fontSize: 16, color: "text.secondary" }} />
                <Box component="span">{t("attach")}</Box>
              </MenuItem>
              {(workModes.length > 0 || hasModifierModes) && <Divider sx={sectionDividerSx} />}
              {workModes.map(renderWorkModeMenuItem)}
              {workModes.length > 0 && hasModifierModes && <Divider sx={sectionDividerSx} />}
              {modifierModes.map(renderModifierModeMenuItem)}
              {supportsAutoConfirm && (
                <MenuItem onClick={() => onAutoConfirmChange?.(!autoConfirm)} sx={modeMenuItemSx}>
                  <TaskAltRoundedIcon sx={{ fontSize: 15, color: "text.secondary" }} />
                  <Box component="span" sx={{ minWidth: 84 }}>{t("agentModeAutoConfirm")}</Box>
                  <Switch size="small" checked={autoConfirm} onChange={() => undefined} tabIndex={-1} sx={modeSwitchSx} />
                </MenuItem>
              )}
          {showBrowserActivitySection && (
            <>
              <Divider sx={sectionDividerSx} />
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
          <Divider sx={sectionDividerSx} />
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
          <Divider sx={sectionDividerSx} />
          <ComposerLimitsPanel
            emptyMessage={limitEmptyMessage}
            limitLines={limitLines}
            loading={!agentLimitLoaded}
            onToggle={toggleLimitsOpen}
            open={limitOpen}
            refreshError={agentLimitRefreshError}
            refreshing={agentLimitRefreshing}
            t={t}
            updatePosition={updateOptionsMenuPosition}
          />
            </Menu>
          </>
        )}
        <Box
          ref={inputAreaRef}
          data-testid="composer-input-area"
          data-expanded={visualExpanded ? "true" : "false"}
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
                    onClick={() => applySuggestion(suggestion)}
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
          {voiceState === "recording" ? (
            <Box
              data-testid="composer-voice-input-panel"
              sx={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 5,
                display: "flex",
                flexDirection: "column",
                gap: 0.75,
                px: 1,
                py: 0.75,
                borderRadius: (t) => `${t.custom.radii.md}px`,
                backgroundColor: (t) => t.custom.surfaces.s2,
                border: (t) => `1px solid ${t.custom.borders.strong}`,
                boxShadow: "0 -10px 28px rgba(0, 0, 0, 0.45)",
              }}
            >
              <InputBase
                inputRef={textareaRef}
                value={composerValue}
                onChange={handleComposerChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={inputPlaceholder}
                inputProps={{ "aria-label": inputPlaceholder, "data-testid": "composer-input", spellCheck: false, autoCorrect: "off", autoCapitalize: "none", autoComplete: "off", ...inputEventProps }}
                multiline
                minRows={1}
                maxRows={7}
                sx={{
                  width: "100%",
                  fontSize: "0.84rem",
                  lineHeight: 1.45,
                  py: 0.25,
                  ...hiddenNativePlaceholderSx,
                }}
              />
              {showPlaceholderHint && placeholderModel.visualLabel ? <ComposerPlaceholderHint label={placeholderModel.visualLabel} panel /> : null}
              <VoiceRecordingStrip label={voiceLabel} duration={voiceDuration} levels={voiceLevels} ambient={voiceAmbient} onLevelCountChange={setVoiceLevelCountForWidth} dockBottom />
            </Box>
          ) : (
            <InputBase
              inputRef={textareaRef}
              value={composerValue}
              onChange={handleComposerChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={inputPlaceholder}
              inputProps={{ "aria-label": inputPlaceholder, "data-testid": "composer-input", spellCheck: false, autoCorrect: "off", autoCapitalize: "none", autoComplete: "off", ...inputEventProps }}
              multiline
              minRows={1}
              maxRows={expanded ? 8 : 1}
              sx={{
                width: "100%",
                fontSize: "0.84rem",
                lineHeight: 1.45,
                py: 0.25,
                ...hiddenNativePlaceholderSx,
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
          )}
          {voiceState !== "recording" && showPlaceholderHint && placeholderModel.visualLabel ? <ComposerPlaceholderHint label={placeholderModel.visualLabel} /> : null}
        </Box>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", flex: "0 0 auto" }}>
          {!editChrome && !running && !voiceInputActive ? (
            <Box sx={{ display: { xs: "none", sm: "flex" }, alignItems: "center", gap: 0.5 }}>
              <KeyHint keys="⏎" />
            </Box>
          ) : null}
          {!editChrome && voiceAvailable && (
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
      {hasInlineAttachments && (
        <Box
          data-testid="composer-inline-attachments"
          sx={{
            mt: 0.75,
            ml: `${floatingInsets.left}px`,
            mr: `${floatingInsets.right}px`,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 0.75,
          }}
        >
          {composerAttachments.map(renderAttachmentTag)}
        </Box>
      )}
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
