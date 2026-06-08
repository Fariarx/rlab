import AttachFileIcon from "@mui/icons-material/AttachFile";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import RateReviewOutlinedIcon from "@mui/icons-material/RateReviewOutlined";
import SendIcon from "@mui/icons-material/Send";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import { Box, InputBase, Menu, MenuItem, Stack, Switch, type SxProps, type Theme, Typography } from "@mui/material";
import { type ChangeEvent, type ClipboardEvent, forwardRef, type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { localFileUrl } from "../../lib/external-url";
import { ImageLightbox } from "../workspace/ImageLightbox";
import { Button, IconButton, KeyHint } from "../ui";
import type { ComposerAttachmentDraft, ComposerDraft } from "./types";

/** Pastes longer than this become a text-file attachment instead of flooding the input. */
const PASTE_AS_FILE_CHARS = 1500;

interface SlashCommand {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
}

let attachmentIdSeq = 0;

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

async function fileToAttachmentDraft(file: File): Promise<ComposerAttachmentDraft> {
  const base = {
    id: `${file.name}-${file.size}-${file.lastModified}-${attachmentIdSeq++}`,
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

function attachmentIcon(type: string): ReactNode {
  if (type.startsWith("image/")) {
    return <ImageOutlinedIcon sx={{ fontSize: 14 }} />;
  }
  return <DescriptionOutlinedIcon sx={{ fontSize: 14 }} />;
}

/**
 * FloatingTag — a single rounded pill that "floats" above the composer (its own
 * shadow, not boxed into a shared container). Used for each attached file and
 * for each enabled work mode (accent tone), all individually removable.
 */
function FloatingTag({
  icon,
  label,
  onRemove,
  removeLabel,
  tone = "neutral",
}: {
  readonly icon: ReactNode;
  readonly label: string;
  /** When omitted the tag has no close button (e.g. the read-only review tag). */
  readonly onRemove?: () => void;
  readonly removeLabel?: string;
  readonly tone?: "neutral" | "accent";
}) {
  return (
    <Box
      component="span"
      sx={{
        pointerEvents: "auto",
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        maxWidth: 240,
        pl: 0.875,
        pr: onRemove ? 0.25 : 0.875,
        py: 0.25,
        borderRadius: (t) => `${t.custom.radii.pill}px`,
        fontSize: "0.74rem",
        fontWeight: 600,
        // Solid, opaque surface — these sit over the thread, so no translucency.
        color: "text.primary",
        backgroundColor: (t) => t.custom.surfaces.s3,
        border: (t) => `1px solid ${t.custom.borders.strong}`,
        boxShadow: "0 1px 4px rgba(0, 0, 0, 0.18)",
        transition: "transform 120ms ease, box-shadow 120ms ease",
        "&:hover": { boxShadow: "0 2px 6px rgba(0, 0, 0, 0.22)" },
      }}
    >
      <Box component="span" sx={{ display: "inline-flex", flex: "0 0 auto", color: tone === "accent" ? (t) => t.palette.status.info.main : "text.secondary" }}>
        {icon}
      </Box>
      <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </Box>
      {onRemove && (
        <IconButton aria-label={removeLabel ?? ""} onClick={onRemove} sx={{ p: 0.125, flex: "0 0 auto", color: "inherit", "&:hover": { backgroundColor: "transparent", opacity: 0.7 } }}>
          <CloseRoundedIcon sx={{ fontSize: 13 }} />
        </IconButton>
      )}
    </Box>
  );
}

/** An image attachment shown as a small square preview that opens full-screen on
 *  click, with a corner remove button. Non-image files keep the pill chip. */
function AttachmentThumb({ attachment, onRemove, onOpen, removeLabel }: { readonly attachment: ComposerAttachmentDraft; readonly onRemove: () => void; readonly onOpen: () => void; readonly removeLabel: string }) {
  return (
    <Box sx={{ position: "relative", width: 48, height: 48, flex: "0 0 auto" }}>
      <Box
        component="button"
        type="button"
        onClick={onOpen}
        aria-label={attachment.name}
        sx={{
          p: 0,
          width: "100%",
          height: "100%",
          display: "block",
          cursor: "pointer",
          borderRadius: (t) => `${t.custom.radii.md}px`,
          overflow: "hidden",
          border: (t) => `1px solid ${t.custom.borders.strong}`,
          backgroundColor: (t) => t.custom.surfaces.s3,
          "&:hover": { borderColor: (t) => t.palette.status.info.main },
        }}
      >
        <Box component="img" src={localFileUrl(attachment.path ?? "")} alt={attachment.name} loading="lazy" sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      </Box>
      <IconButton
        aria-label={removeLabel}
        onClick={onRemove}
        sx={{
          position: "absolute",
          top: -6,
          right: -6,
          p: 0.125,
          color: "#fff",
          backgroundColor: (t) => t.palette.status.error.main,
          border: (t) => `1px solid ${t.custom.surfaces.s1}`,
          "&:hover": { backgroundColor: (t) => t.palette.status.error.main, opacity: 0.85 },
        }}
      >
        <CloseRoundedIcon sx={{ fontSize: 12 }} />
      </IconButton>
    </Box>
  );
}

/** Imperative handle so a parent drop-zone (the whole chat pane) can hand files
 *  to the composer's attachment pipeline. */
export interface ComposerHandle {
  readonly addFiles: (files: readonly File[]) => Promise<void>;
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
}

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
  },
  ref,
) {
  const [internalValue, setInternalValue] = useState(initialValue);
  const [internalAttachments, setInternalAttachments] = useState<readonly ComposerAttachmentDraft[]>(initialAttachments);
  const [sending, setSending] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [suggestDismissed, setSuggestDismissed] = useState(false);
  const [modeMenuAnchor, setModeMenuAnchor] = useState<null | HTMLElement>(null);
  // An image attachment opened full-screen (click a thumbnail to view).
  const [previewAttachment, setPreviewAttachment] = useState<ComposerAttachmentDraft | null>(null);
  const activeModeOption = modes.find((mode) => mode.id === activeMode) ?? null;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
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

  // The composer now sits in normal flow and grows downward via the textarea's
  // maxRows, so the thread above simply shrinks — no floating tags/overlay to
  // position. Reset any previously-reported insets to zero so the thread doesn't
  // reserve phantom space.
  useEffect(() => {
    onTagsHeightChange?.(0);
    onOverlayLiftChange?.(0);
  }, [onTagsHeightChange, onOverlayLiftChange]);

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
      setComposerAttachments([...latestDraftRef.current.attachments, ...ready]);
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
  useImperativeHandle(ref, () => ({ addFiles }), [addFiles]);

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

  const canSend = (composerValue.trim().length > 0 || composerAttachments.length > 0 || reviewCount > 0) && !sending;
  const sendLabel = reviewCount > 0 ? t("reviewSendComments") : t("send");

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

  const hasChips = reviewCount > 0 || activeModeOption !== null || composerAttachments.length > 0;

  return (
    // A normal-flow column: the chips/attachments row sits directly above the
    // input bar (no absolute positioning, no geometry to drift), and the input
    // grows downward via maxRows — so the thread above just shrinks.
    <Box sx={{ position: "relative", display: "flex", flexDirection: "column", gap: 0.75 }}>
      {hasChips && (
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.75 }}>
          {reviewCount > 0 && (
            <FloatingTag
              tone="accent"
              icon={<RateReviewOutlinedIcon sx={{ fontSize: 14 }} />}
              label={t("reviewPending", { count: reviewCount })}
            />
          )}
          {activeModeOption && (
            <FloatingTag
              tone="accent"
              icon={<AutoAwesomeRoundedIcon sx={{ fontSize: 14 }} />}
              label={activeModeOption.label}
              removeLabel={t("disableMode", { mode: activeModeOption.label })}
              onRemove={() => onModeChange?.("default")}
            />
          )}
          {composerAttachments.map((attachment) =>
            isImageMime(attachment.type) && attachment.path ? (
              <AttachmentThumb
                key={attachment.id}
                attachment={attachment}
                removeLabel={t("removeAttachment", { name: attachment.name })}
                onRemove={() => setComposerAttachments(composerAttachments.filter((item) => item.id !== attachment.id))}
                onOpen={() => setPreviewAttachment(attachment)}
              />
            ) : (
              <FloatingTag
                key={attachment.id}
                icon={attachmentIcon(attachment.type)}
                label={attachment.name}
                removeLabel={t("removeAttachment", { name: attachment.name })}
                onRemove={() => setComposerAttachments(composerAttachments.filter((item) => item.id !== attachment.id))}
              />
            ),
          )}
        </Box>
      )}
      <Box
        sx={{
          display: "flex",
          alignItems: "flex-end",
          gap: 1,
          p: 1,
          borderRadius: (t) => `${t.custom.radii.lg}px`,
          backgroundColor: (t) => t.custom.surfaces.s2,
          border: (t) => `1px solid ${t.custom.borders.subtle}`,
          transition: "border-color 140ms ease",
          // Soft focus: just brighten the border. No outer glow ring (it clipped
          // against the surrounding padding and read as harsh).
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
        {/* One options control: attach files + per-chat work modes. Opens upward.
            Its colour never changes with the active mode (that lives in a tag). */}
        <IconButton data-testid="composer-options-button" aria-label={t("composerOptions")} sx={{ flex: "0 0 auto" }} onClick={(event: MouseEvent<HTMLElement>) => setModeMenuAnchor(event.currentTarget)}>
          <TuneRoundedIcon sx={{ fontSize: 18 }} />
        </IconButton>
        <Menu
          anchorEl={modeMenuAnchor}
          open={Boolean(modeMenuAnchor)}
          onClose={() => setModeMenuAnchor(null)}
          anchorOrigin={{ vertical: "top", horizontal: "left" }}
          transformOrigin={{ vertical: "bottom", horizontal: "left" }}
          slotProps={{ paper: { sx: { boxShadow: "0 4px 12px rgba(0, 0, 0, 0.14)", minWidth: 304 } }, list: { dense: true, sx: { py: 0.5, width: "100%" } } }}
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
          {modes.map((mode) => (
            <MenuItem key={mode.id} onClick={() => onModeChange?.(mode.id === activeMode ? "default" : mode.id)} sx={modeMenuItemSx}>
              <AutoAwesomeRoundedIcon sx={{ fontSize: 15, color: "text.secondary" }} />
              <Box component="span" sx={{ minWidth: 84 }}>{mode.label}</Box>
              <Switch size="small" checked={mode.id === activeMode} onChange={() => undefined} tabIndex={-1} sx={modeSwitchSx} />
            </MenuItem>
          ))}
        </Menu>
        {/* The input grows in-flow (downward) via the textarea's maxRows; the
            composer column expands and the thread above shrinks. */}
        <Box
          data-testid="composer-input-area"
          sx={{ position: "relative", flex: 1, minWidth: 0, minHeight: 30, display: "flex", alignItems: "center" }}
        >
          {/* The suggestion dropdown is anchored to the input column, so it is
              never wider than the field it completes. */}
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
            maxRows={8}
            sx={{
              width: "100%",
              fontSize: "0.9rem",
              lineHeight: 1.5,
              py: 0.5,
            }}
          />
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flex: "0 0 auto" }}>
          {running ? (
            <IconButton data-testid="composer-stop-button" aria-label={t("stopRun")} tone="danger" onClick={onStop}>
              <StopCircleIcon sx={{ fontSize: 19 }} />
            </IconButton>
          ) : (
            <Box sx={{ display: { xs: "none", sm: "flex" }, alignItems: "center", gap: 0.5 }}>
              <KeyHint keys="⏎" />
            </Box>
          )}
          <Button
            variant="contained"
            onClick={() => void send()}
            disabled={!canSend}
            sx={{ minWidth: 0, px: 1.25, py: 1, borderRadius: (t) => `${t.custom.radii.md}px` }}
            aria-label={sendLabel}
            data-testid="composer-send-button"
          >
            <SendIcon sx={{ fontSize: 18 }} />
          </Button>
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
