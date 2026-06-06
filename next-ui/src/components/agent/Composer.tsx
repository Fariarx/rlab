import AttachFileIcon from "@mui/icons-material/AttachFile";
import CloseIcon from "@mui/icons-material/Close";
import SendIcon from "@mui/icons-material/Send";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import { Box, Chip, InputBase, Stack, Typography } from "@mui/material";
import { type ChangeEvent, type KeyboardEvent, useMemo, useRef, useState } from "react";
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

/** Composer — the chat input. Sends on Enter (Shift+Enter for newline). Sticky
 * at the bottom on mobile; the send button stays a comfortable tap target. */
export function Composer({
  placeholder = "Message the agent…",
  mentionableFiles = [],
  value,
  attachments,
  onDraftChange,
  onSend,
  onStop,
  onAttachmentError,
  running = false,
}: {
  readonly placeholder?: string;
  readonly mentionableFiles?: readonly string[];
  readonly value?: string;
  readonly attachments?: readonly ComposerAttachmentDraft[];
  readonly onDraftChange?: (draft: ComposerDraft) => void;
  readonly onSend?: (value: string) => void;
  readonly onStop?: () => void;
  readonly onAttachmentError?: (message: string) => void;
  readonly running?: boolean;
}) {
  const [internalValue, setInternalValue] = useState("");
  const [internalAttachments, setInternalAttachments] = useState<readonly ComposerAttachmentDraft[]>([]);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { t } = useI18n();
  const composerValue = value ?? internalValue;
  const composerAttachments = attachments ?? internalAttachments;
  const latestDraftRef = useRef<ComposerDraft>({ text: composerValue, attachments: composerAttachments });
  latestDraftRef.current = { text: composerValue, attachments: composerAttachments };

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
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  const chooseFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
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

  const insertMention = (file: string) => {
    setComposerValue(composerValue.replace(/@([^\s@/]*)$/, `@${file} `));
  };

  const insertSlashCommand = (command: SlashCommand) => {
    setComposerValue(`${command.prompt} `);
  };

  const canSend = (composerValue.trim().length > 0 || composerAttachments.length > 0) && !sending;

  return (
    <Stack spacing={0.75}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          p: 1,
          borderRadius: (t) => `${t.custom.radii.lg}px`,
          backgroundColor: (t) => t.custom.surfaces.s2,
          border: (t) => `1px solid ${t.custom.borders.subtle}`,
          transition: "box-shadow 140ms ease, border-color 140ms ease",
          "&:focus-within": {
            borderColor: (t) => t.custom.borders.focus,
            boxShadow: (t) => `0 0 0 3px ${t.palette.status.running.soft}`,
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
        <IconButton aria-label={t("attach")} sx={{ flex: "0 0 auto" }} onClick={() => fileInputRef.current?.click()}>
          <AttachFileIcon sx={{ fontSize: 18 }} />
        </IconButton>
        <InputBase
          value={composerValue}
          onChange={(event) => setComposerValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          multiline
          maxRows={6}
          sx={{ flex: 1, fontSize: "0.9rem", lineHeight: 1.5, py: 0.5 }}
        />
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
      {composerAttachments.length > 0 && (
        <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", gap: 0.75 }}>
          {composerAttachments.map((attachment) => (
            <Chip
              key={attachment.id}
              label={attachment.name}
              size="small"
              deleteIcon={<CloseIcon sx={{ fontSize: 15 }} />}
              onDelete={() => setComposerAttachments(composerAttachments.filter((item) => item.id !== attachment.id))}
            />
          ))}
        </Stack>
      )}
      {(visibleSlashCommands.length > 0 || mentionedFiles.length > 0) && (
        <Stack
          spacing={0.5}
          sx={{
            p: 0.75,
            borderRadius: (theme) => `${theme.custom.radii.md}px`,
            border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
            backgroundColor: (theme) => theme.custom.surfaces.s2,
          }}
        >
          {visibleSlashCommands.map((command) => (
            <Button key={command.id} variant="text" size="small" onClick={() => insertSlashCommand(command)} sx={{ justifyContent: "flex-start" }}>
              {command.label}
            </Button>
          ))}
          {mentionedFiles.map((file) => (
            <Button key={file} variant="text" size="small" onClick={() => insertMention(file)} sx={{ justifyContent: "flex-start" }}>
              <Typography component="span" sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.76rem" }}>
                {file}
              </Typography>
            </Button>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
