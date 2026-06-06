import AttachFileIcon from "@mui/icons-material/AttachFile";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import SendIcon from "@mui/icons-material/Send";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import { Box, Divider, InputBase, Menu, MenuItem, Stack, Switch, type SxProps, type Theme, Typography } from "@mui/material";
import { type ChangeEvent, forwardRef, type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, IconButton, KeyHint } from "../ui";
import { type ComposerAttachmentDraft, type ComposerDraft } from "./types";

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
  readonly onRemove: () => void;
  readonly removeLabel: string;
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
        pr: 0.25,
        py: 0.25,
        borderRadius: (t) => `${t.custom.radii.pill}px`,
        fontSize: "0.74rem",
        fontWeight: 600,
        // Solid, opaque surface — these sit over the thread, so no translucency.
        color: "text.primary",
        backgroundColor: (t) => t.custom.surfaces.s3,
        border: (t) => `1px solid ${t.custom.borders.strong}`,
        boxShadow: "0 2px 10px rgba(0, 0, 0, 0.35)",
        transition: "transform 120ms ease, box-shadow 120ms ease",
        "&:hover": { boxShadow: "0 4px 14px rgba(0, 0, 0, 0.45)" },
      }}
    >
      <Box component="span" sx={{ display: "inline-flex", flex: "0 0 auto", color: tone === "accent" ? (t) => t.palette.status.info.main : "text.secondary" }}>
        {icon}
      </Box>
      <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </Box>
      <IconButton aria-label={removeLabel} onClick={onRemove} sx={{ p: 0.125, flex: "0 0 auto", color: "inherit", "&:hover": { backgroundColor: "transparent", opacity: 0.7 } }}>
        <CloseRoundedIcon sx={{ fontSize: 13 }} />
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
}

/** Composer — the chat input. Sends on Enter (Shift+Enter for newline). Sticky
 * at the bottom on mobile; the send button stays a comfortable tap target. */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  {
    placeholder = "Message the agent…",
    mentionableFiles = [],
    value,
    attachments,
    modes = [],
    activeMode = "default",
    onModeChange,
    onDraftChange,
    onSend,
    onStop,
    onAttachmentError,
    running = false,
  },
  ref,
) {
  const [internalValue, setInternalValue] = useState("");
  const [internalAttachments, setInternalAttachments] = useState<readonly ComposerAttachmentDraft[]>([]);
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [suggestDismissed, setSuggestDismissed] = useState(false);
  const [modeMenuAnchor, setModeMenuAnchor] = useState<null | HTMLElement>(null);
  const activeModeOption = modes.find((mode) => mode.id === activeMode) ?? null;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const singleRowRef = useRef(0);
  const { t } = useI18n();
  const composerValue = value ?? internalValue;
  const composerAttachments = attachments ?? internalAttachments;
  const latestDraftRef = useRef<ComposerDraft>({ text: composerValue, attachments: composerAttachments });
  latestDraftRef.current = { text: composerValue, attachments: composerAttachments };

  // Decide whether the input would need more than one row. When it does, the
  // input lifts into an overlay that grows upward (see render) instead of
  // expanding the composer bar in place. Detection is driven by content height
  // (wrapped long lines) and explicit newlines, so it works regardless of how
  // the text reached multiple rows.
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
  }, [composerValue, expanded]);

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
    // Typing re-opens suggestions that an earlier Escape dismissed.
    setSuggestDismissed(false);
    updateDraft({ text: nextValue, attachments: latestDraftRef.current.attachments });
  };

  const setComposerAttachments = (nextAttachments: readonly ComposerAttachmentDraft[]) => {
    updateDraft({ text: latestDraftRef.current.text, attachments: nextAttachments });
  };

  const send = async () => {
    const trimmed = composerValue.trim();
    if (trimmed.length > 0 || composerAttachments.length > 0) {
      setSending(true);
      const attachmentBlocks = composerAttachments.map(attachmentBlock);
      onSend?.([trimmed, ...attachmentBlocks].filter(Boolean).join("\n\n"));
      updateDraft({ text: "", attachments: [] });
      setSending(false);
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

  const canSend = (composerValue.trim().length > 0 || composerAttachments.length > 0) && !sending;

  const floatingPanelSx: SxProps<Theme> = {
    pointerEvents: "auto",
    p: 0.75,
    borderRadius: (t) => `${t.custom.radii.md}px`,
    border: (t) => `1px solid ${t.custom.borders.subtle}`,
    backgroundColor: (t) => t.custom.surfaces.s2,
    boxShadow: "0 -8px 24px rgba(0, 0, 0, 0.4)",
  };

  return (
    // Plain Box (not a spaced Stack): the only in-flow child is the input bar;
    // tags + suggestions are absolutely positioned. A Stack's sibling spacing
    // would otherwise push the bar down once the (absolute) tags row mounts.
    <Box sx={{ position: "relative" }}>
      {/* Each enabled mode and each attached file floats as its own pill above
          the divider that tops the input container (overlaying the thread),
          never boxed together and never reflowing the thread. */}
      {(composerAttachments.length > 0 || activeModeOption) && (
        <Box sx={{ position: "absolute", left: 0, right: 0, bottom: "calc(100% + 22px)", display: "flex", flexWrap: "wrap", gap: 0.75, pointerEvents: "none", zIndex: 6 }}>
          {activeModeOption && (
            <FloatingTag
              tone="accent"
              icon={<AutoAwesomeRoundedIcon sx={{ fontSize: 14 }} />}
              label={activeModeOption.label}
              removeLabel={t("disableMode", { mode: activeModeOption.label })}
              onRemove={() => onModeChange?.("default")}
            />
          )}
          {composerAttachments.map((attachment) => (
            <FloatingTag
              key={attachment.id}
              icon={attachmentIcon(attachment.type)}
              label={attachment.name}
              removeLabel={t("removeAttachment", { name: attachment.name })}
              onRemove={() => setComposerAttachments(composerAttachments.filter((item) => item.id !== attachment.id))}
            />
          ))}
        </Box>
      )}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
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
          aria-label={t("chooseFiles")}
          multiple
          type="file"
          onChange={chooseFiles}
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        />
        {/* One options control: attach files + per-chat work modes. Opens upward.
            Its colour never changes with the active mode (that lives in a tag). */}
        <IconButton aria-label={t("composerOptions")} sx={{ flex: "0 0 auto" }} onClick={(event: MouseEvent<HTMLElement>) => setModeMenuAnchor(event.currentTarget)}>
          <TuneRoundedIcon sx={{ fontSize: 18 }} />
        </IconButton>
        <Menu
          anchorEl={modeMenuAnchor}
          open={Boolean(modeMenuAnchor)}
          onClose={() => setModeMenuAnchor(null)}
          anchorOrigin={{ vertical: "top", horizontal: "left" }}
          transformOrigin={{ vertical: "bottom", horizontal: "left" }}
        >
          <MenuItem
            onClick={() => {
              setModeMenuAnchor(null);
              fileInputRef.current?.click();
            }}
            sx={{ gap: 1 }}
          >
            <AttachFileIcon sx={{ fontSize: 18, color: "text.secondary" }} />
            <Box component="span">{t("attach")}</Box>
          </MenuItem>
          {modes.length > 0 && <Divider />}
          {modes.map((mode) => (
            <MenuItem key={mode.id} onClick={() => onModeChange?.(mode.id === activeMode ? "default" : mode.id)} sx={{ gap: 1 }}>
              <AutoAwesomeRoundedIcon sx={{ fontSize: 16, color: "text.secondary" }} />
              <Box component="span" sx={{ flex: 1, minWidth: 130 }}>{mode.label}</Box>
              <Switch size="small" edge="end" checked={mode.id === activeMode} onChange={() => undefined} tabIndex={-1} sx={{ pointerEvents: "none", ml: 1 }} />
            </MenuItem>
          ))}
        </Menu>
        {/* The input column keeps a fixed single-row height so the composer bar
            never grows. When multiline is needed the same input lifts into an
            overlay (position: absolute) that grows upward over the thread. */}
        <Box
          data-testid="composer-input-area"
          data-expanded={expanded ? "true" : "false"}
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
            placeholder={placeholder}
            multiline
            minRows={1}
            maxRows={expanded ? 8 : 1}
            sx={{
              width: "100%",
              fontSize: "0.9rem",
              lineHeight: 1.5,
              py: 0.5,
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
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flex: "0 0 auto" }}>
          {running ? (
            <IconButton aria-label={t("stopRun")} tone="danger" onClick={onStop}>
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
            aria-label={t("send")}
          >
            <SendIcon sx={{ fontSize: 18 }} />
          </Button>
        </Stack>
      </Box>
    </Box>
  );
});
