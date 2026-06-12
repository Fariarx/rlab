import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import EditIcon from "@mui/icons-material/Edit";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import PsychologyIcon from "@mui/icons-material/Psychology";
import RefreshIcon from "@mui/icons-material/Refresh";
import SendIcon from "@mui/icons-material/Send";
import CloseIcon from "@mui/icons-material/Close";
import { Box, ButtonBase, Collapse, Stack, Typography } from "@mui/material";
import { type ChangeEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { localFileUrl } from "../../lib/external-url";
import { normalizeClockLabel } from "../../lib/time-format";
import { ImageLightbox } from "../workspace/ImageLightbox";
import { Button, IconButton, Tooltip } from "../ui";
import { AgentBlockRenderer } from "./AgentBlockRenderer";
import { AttachmentTile } from "./AttachmentTile";
import { DiffCard } from "./DiffCard";
import { DEFAULT_AGENT_OPTION_ID, agentProfileLabels, getAgent, resolveAgentReasoningValue, type AgentProfile } from "./agents";
import { rise } from "./anim";
import type { MessageActionHandlers } from "./message-actions";
import { AgentAvatar, InlinePluginText, TypingDots, UserAvatar } from "./parts";
import type { AgentBlock, ChatMessage, DiffBlock, PlanBlock } from "./types";

interface MessageAttachment {
  readonly name: string;
  /** Path/URL for path-based file links (used to preview images); absent for
   *  inline text-file blocks. */
  readonly target?: string;
  readonly isImage: boolean;
}

const MESSAGE_IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?|#|$)/i;

/**
 * Split a sent user message into its visible text and the attachments the
 * composer appended (inline text-file blocks and path-based file links), so each
 * attachment can render as a tile instead of dumping its contents into the thread.
 */
function splitUserContent(raw: string): { readonly text: string; readonly attachments: readonly MessageAttachment[] } {
  const attachments: MessageAttachment[] = [];
  let text = raw.replace(/(!?)\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole: string, bang: string, label: string, target: string) => {
    if (/[\\/]/.test(target) || /\.[a-z0-9]{1,8}$/i.test(target)) {
      attachments.push({ name: label, target, isImage: bang === "!" || MESSAGE_IMAGE_RE.test(target) });
      return "";
    }
    return whole;
  });
  text = text.replace(/<attachment\s+name="([^"]*)"[^>]*>[\s\S]*?<\/attachment>/g, (_match, name: string) => {
    attachments.push({ name, isImage: false });
    return "";
  });
  return { text: text.trim(), attachments };
}

function MessageAttachments({ attachments, onOpenImage }: { readonly attachments: readonly MessageAttachment[]; readonly onOpenImage: (attachment: MessageAttachment) => void }) {
  return (
    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75, justifyContent: "flex-end" }}>
      {attachments.map((attachment, index) => (
        <AttachmentTile
          key={`${attachment.name}-${index}`}
          name={attachment.name}
          mime={attachment.isImage ? "image/*" : undefined}
          previewSrc={attachment.isImage && attachment.target ? localFileUrl(attachment.target) : undefined}
          onOpen={
            attachment.isImage && attachment.target
              ? () => onOpenImage(attachment)
              : attachment.target && /^([/]|[a-zA-Z]:[\\/])/.test(attachment.target)
                ? () => window.open(`${localFileUrl(attachment.target ?? "")}&download=1`, "_blank", "noopener,noreferrer")
                : undefined
          }
        />
      ))}
    </Stack>
  );
}

const READ_ONLY_IMAGE_TOOL_NAMES = new Set(["read", "readfile", "read_file", "viewimage", "view_image", "image", "openimage", "open_image"]);

function toolLeafName(name: string): string {
  return name.split("/").at(-1)?.replace(/[-\s]/g, "_").toLowerCase() ?? name.toLowerCase();
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const leaf = normalized.split("/").filter(Boolean).at(-1);
  return leaf && leaf.trim().length > 0 ? leaf : path;
}

function readOnlyImageToolPath(block: AgentBlock): string | null {
  if (block.kind !== "tool" || block.state === "error") {
    return null;
  }
  const leaf = toolLeafName(block.name);
  if (!READ_ONLY_IMAGE_TOOL_NAMES.has(leaf) && !READ_ONLY_IMAGE_TOOL_NAMES.has(leaf.replace(/_/g, ""))) {
    return null;
  }
  const args = block.args ?? {};
  const candidates = [
    args.path,
    args.file,
    args.file_path,
    args.filePath,
    args.image,
    args.image_path,
    args.imagePath,
    args.source,
    args.input,
    block.summary,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return candidates.find((value) => MESSAGE_IMAGE_RE.test(value.trim()))?.trim() ?? null;
}

function AgentImagePreview({ path, onOpen }: { readonly path: string; readonly onOpen: (attachment: MessageAttachment) => void }) {
  const attachment = { name: basename(path), target: path, isImage: true };
  return (
    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75 }}>
      <AttachmentTile name={attachment.name} mime="image/*" previewSrc={localFileUrl(path)} onOpen={() => onOpen(attachment)} />
    </Stack>
  );
}

/** Compact styling for inline message action icons (copy / retry / edit). */
const messageActionButtonSx = { p: 0.5 } as const;
/** Action rows are hidden until the message is hovered/focused (see the
 *  `&:hover .msg-actions` rule on each message container). */
const messageActionRowSx = { opacity: 0, transition: "opacity 120ms ease", "@media (hover: none)": { opacity: 1 } } as const;
const revealActionsOnHover = {
  "&:hover .msg-actions, &:focus-within .msg-actions": { opacity: 1 },
} as const;

function MessageActionBar({
  message,
  actions,
}: {
  readonly message: ChatMessage;
  readonly actions?: MessageActionHandlers;
}) {
  const { t } = useI18n();
  const showFork = Boolean(actions?.onFork);
  if (!actions?.onCopy && !actions?.onRetry && !showFork) {
    return null;
  }

  return (
    <Stack
      className="msg-actions"
      direction="row"
      spacing={0.25}
      sx={{ justifyContent: "flex-start", mt: 1, ...messageActionRowSx, ...(showFork ? { opacity: 0.72 } : {}) }}
    >
      {actions?.onCopy && (
        <Tooltip title={t("copy")}>
          <IconButton aria-label={t("copyMessage")} onClick={() => actions.onCopy?.(message)} sx={messageActionButtonSx}>
            <ContentCopyIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      )}
      {actions?.onRetry && (
        <Tooltip title={t("retryMessage")}>
          <IconButton aria-label={t("retryMessage")} onClick={() => actions.onRetry?.(message)} sx={messageActionButtonSx}>
            <RefreshIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      )}
      {showFork && (
        <Tooltip title={t("forkConversation")}>
          <IconButton aria-label={t("forkConversation")} onClick={() => actions?.onFork?.(message)} sx={messageActionButtonSx}>
            <AccountTreeIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      )}
    </Stack>
  );
}

function UserMessage({ message, delay, actions }: { readonly message: ChatMessage; readonly delay: number; readonly actions?: MessageActionHandlers }) {
  const { text: displayText, attachments } = splitUserContent(message.text ?? "");
  const reviewBlocks = (message.blocks ?? []).filter((block) => block.kind === "review");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayText);
  const [previewImage, setPreviewImage] = useState<MessageAttachment | null>(null);
  const { t } = useI18n();

  const submitEdit = () => {
    const text = draft.trim();
    if (text.length > 0) {
      actions?.onEditAndResend?.(message, text);
      setEditing(false);
    }
  };

  return (
    <Stack direction="row" spacing={1.25} sx={{ justifyContent: "flex-end", alignItems: "flex-start", width: "100%", minWidth: 0, ...rise(delay), ...revealActionsOnHover }}>
      {/* Editing breaks out of the narrow user-bubble width so there's room to
          rework a longer message comfortably. */}
      <Stack spacing={0.5} sx={{ alignItems: "flex-end", width: editing ? "100%" : "auto", maxWidth: editing ? "100%" : "82%", minWidth: 0 }}>
        {editing ? (
          <Box
            sx={{
              width: "100%",
              p: 1.5,
              borderRadius: (t) => `${t.custom.radii.lg}px`,
              backgroundColor: (t) => t.custom.surfaces.s2,
            }}
          >
            <Stack spacing={1.25}>
              <Typography variant="microLabel" sx={{ color: "text.secondary" }}>
                {t("editMessage")}
              </Typography>
              <Box
                component="textarea"
                aria-label={t("editMessage")}
                autoFocus
                value={draft}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setDraft(event.currentTarget.value)}
                onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    submitEdit();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setEditing(false);
                  }
                }}
                rows={5}
                sx={{
                  width: "100%",
                  minHeight: 120,
                  resize: "vertical",
                  border: 0,
                  borderRadius: (t) => `${t.custom.radii.md}px`,
                  bgcolor: (t) => t.custom.surfaces.s1,
                  color: "text.primary",
                  font: "inherit",
                  fontSize: "0.9rem",
                  lineHeight: 1.6,
                  p: 1.5,
                  outline: 0,
                  "&:focus": { outline: 0 },
                }}
              />
              <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end", alignItems: "center" }}>
                <Button size="small" variant="text" onClick={() => setEditing(false)} startIcon={<CloseIcon sx={{ fontSize: 15 }} />}>
                  {t("cancel")}
                </Button>
                <Button size="small" variant="contained" aria-label={t("sendEditedMessage")} onClick={submitEdit} startIcon={<SendIcon sx={{ fontSize: 15 }} />}>
                  {t("send")}
                </Button>
              </Stack>
            </Stack>
          </Box>
        ) : (
          <Stack spacing={0.5} sx={{ alignItems: "flex-end", minWidth: 0, maxWidth: "100%" }}>
            {displayText && (
              <Box
                sx={{
                  minWidth: 0,
                  maxWidth: "100%",
                  px: 1.75,
                  py: 1.25,
                  borderRadius: (t) => `${t.custom.radii.lg}px`,
                  borderTopRightRadius: (t) => `${t.custom.radii.sm}px`,
                  backgroundColor: (t) => t.custom.surfaces.s3,
                  border: (t) => `1px solid ${t.custom.borders.subtle}`,
                }}
              >
                <Typography component="div" sx={{ minWidth: 0, maxWidth: "100%", fontSize: "0.9rem", lineHeight: 1.6, color: "text.primary", whiteSpace: "pre-line", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                  <InlinePluginText text={displayText} />
                </Typography>
              </Box>
            )}
            {attachments.length > 0 && <MessageAttachments attachments={attachments} onOpenImage={setPreviewImage} />}
            {reviewBlocks.map((block, index) => (
              <AgentBlockRenderer key={`review-${index}`} block={block} />
            ))}
          </Stack>
        )}
        {message.time && (
          <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.66rem", color: "text.secondary" }}>
            {normalizeClockLabel(message.time)}
          </Typography>
        )}
        {!editing && (
          <Stack className="msg-actions" direction="row" spacing={0.25} sx={messageActionRowSx}>
            {actions?.onCopy && (
              <Tooltip title={t("copy")}>
                <IconButton aria-label={t("copyMessage")} onClick={() => actions.onCopy?.(message)} sx={messageActionButtonSx}>
                  <ContentCopyIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            )}
            {actions?.onEditAndResend && (
              <Tooltip title={t("editAndResend")}>
                <IconButton aria-label={t("editAndResend")} onClick={() => setEditing(true)} sx={messageActionButtonSx}>
                  <EditIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        )}
      </Stack>
      <UserAvatar />
      <ImageLightbox src={previewImage?.target ?? null} label={previewImage?.name} onClose={() => setPreviewImage(null)} />
    </Stack>
  );
}

// The agent's actual reply / things the user must act on stay visible; the
// intermediate work (reasoning, tool calls, commands, searches, plans, code,
// status, citations) is folded into one collapsed container. File diffs are
// pulled out separately and shown under the reply once the turn is done.
const ANSWER_BLOCK_KINDS: ReadonlySet<AgentBlock["kind"]> = new Set(["text", "options", "approval", "suggested"]);
const DIFF_KIND: AgentBlock["kind"] = "diff";
const COMPLETED_PLAN_HIDE_DELAY_MS = 3000;
type VisibleTerminalStatusBlock = Extract<AgentBlock, { kind: "status"; level: "warn" | "error" }>;

/** Whether the agent turn is still producing output (so diffs aren't surfaced
 *  until the turn settles). */
function isMessageLive(blocks: readonly AgentBlock[]): boolean {
  return blocks.some((block) => {
    switch (block.kind) {
      case "text":
        return block.streaming === true;
      case "reasoning":
        return block.active === true;
      case "tool":
      case "command":
      case "search":
        return block.state === "running";
      case "plan":
        return block.steps.some((step) => step.state === "running");
      default:
        return false;
    }
  });
}

function isCompletedPlanBlock(block: AgentBlock): block is PlanBlock {
  return block.kind === "plan" && block.steps.length > 0 && block.steps.every((step) => step.state === "ok" || step.state === "error");
}

function planStateSignature(blocks: readonly PlanBlock[]): string {
  return blocks.map((block) => block.steps.map((step) => `${step.state}:${step.label}`).join("|")).join("\n");
}

function resolvedInputSignature(blocks: readonly AgentBlock[]): string {
  return blocks
    .filter(isResolvedInputBlock)
    .map((block) => {
      if (block.kind === "approval") {
        return `approval:${block.id ?? ""}:${block.decision ?? ""}`;
      }
      if (block.kind === "options") {
        return `options:${block.id ?? ""}:${(block.selected ?? []).join(",")}`;
      }
      return "";
    })
    .join("\n");
}

function formatElapsedSeconds(totalSec: number, t: ReturnType<typeof useI18n>["t"]): string {
  const safe = Math.max(0, totalSec);
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return m > 0 ? `${m}${t("unitMinShort")} ${s}${t("unitSecShort")}` : `${s}${t("unitSecShort")}`;
}

const durationLabelSx = { fontFamily: (th: { custom: { fonts: { mono: string } } }) => th.custom.fonts.mono, fontSize: "0.68rem", color: "text.secondary", flex: "0 0 auto", whiteSpace: "nowrap" } as const;

function isResolvedInputBlock(block: AgentBlock): boolean {
  if (block.kind === "approval") {
    return block.decision != null;
  }
  if (block.kind === "options") {
    return (block.selected?.length ?? 0) > 0;
  }
  return false;
}

function diffTotals(blocks: readonly DiffBlock[]): { readonly additions: number; readonly deletions: number } {
  return blocks.reduce(
    (total, block) => ({
      additions: total.additions + block.additions,
      deletions: total.deletions + block.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}

function isVisibleTerminalStatus(block: AgentBlock): block is VisibleTerminalStatusBlock {
  return block.kind === "status" && (block.level === "warn" || block.level === "error");
}

function lastVisibleTerminalStatus(blocks: readonly AgentBlock[], live: boolean, hasVisibleAnswerOutput: boolean): VisibleTerminalStatusBlock | null {
  if (live || hasVisibleAnswerOutput) {
    return null;
  }
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (isVisibleTerminalStatus(block)) {
      return block;
    }
  }
  return null;
}

function ChangedFilesAccordion({ blocks, delay }: { readonly blocks: readonly DiffBlock[]; readonly delay: number }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { t } = useI18n();
  const totals = diffTotals(blocks);

  return (
    <Box
      sx={{
        mt: 1.25,
        borderRadius: (theme) => `${theme.custom.radii.md}px`,
        border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
        backgroundColor: (theme) => (theme.palette.mode === "dark" ? "rgba(0, 0, 0, 0.3)" : "rgba(17, 24, 39, 0.06)"),
        boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.02)",
        overflow: "clip",
        ...rise(delay),
      }}
      data-testid="changed-files-accordion"
    >
      <ButtonBase
        aria-controls={panelId}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          width: "100%",
          px: 1.5,
          py: 1,
          textAlign: "left",
          backgroundColor: "transparent",
          "&:hover": {
            backgroundColor: (theme) => (theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.035)" : "rgba(17, 24, 39, 0.08)"),
          },
        }}
        type="button"
      >
        <DescriptionOutlinedIcon sx={{ fontSize: 16, color: "text.secondary", flex: "0 0 auto" }} />
        <Typography variant="microLabel" sx={{ color: "text.secondary", flex: 1, minWidth: 0 }}>
          {t("gitChanges")}
        </Typography>
        <Typography component="span" sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.68rem", color: "text.tertiary", flex: "0 0 auto" }}>
          {t("gitChangedFilesCount", { count: blocks.length })}
        </Typography>
        {(totals.additions > 0 || totals.deletions > 0) && (
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flex: "0 0 auto", fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.72rem", fontWeight: 700 }}>
            {totals.additions > 0 && <Box component="span" sx={{ color: (theme) => theme.palette.status.ok.main }}>+{totals.additions}</Box>}
            {totals.deletions > 0 && <Box component="span" sx={{ color: (theme) => theme.palette.status.error.main }}>−{totals.deletions}</Box>}
          </Stack>
        )}
        <KeyboardArrowDownIcon sx={{ fontSize: 18, color: "text.secondary", transition: "transform 180ms ease", transform: open ? "rotate(180deg)" : "none", flex: "0 0 auto" }} />
      </ButtonBase>
      <Collapse in={open} unmountOnExit>
        <Stack
          id={panelId}
          spacing={1}
          sx={{
            px: 1,
            py: 1,
            borderTop: (theme) => `1px solid ${theme.custom.borders.subtle}`,
            backgroundColor: (theme) => (theme.palette.mode === "dark" ? "rgba(0, 0, 0, 0.22)" : "rgba(17, 24, 39, 0.045)"),
          }}
        >
          {blocks.map((block, index) => (
            <Box key={`${block.file}-${index}`} sx={rise(Math.min(index, 3) * 40)}>
              <DiffCard block={block} />
            </Box>
          ))}
        </Stack>
      </Collapse>
    </Box>
  );
}

export interface MessageDisplayPrefs {
  /** Auto-expand the reasoning container while the agent is actively thinking. */
  readonly reasoningAutoExpand?: boolean;
}

function agentMessageProfileLabel(profile: AgentProfile | undefined): string | null {
  if (!profile) {
    return null;
  }
  const agent = getAgent(profile.agent);
  const modelOption = agent.models.find((option) => option.id === profile.model);
  const modelLabel =
    profile.model === DEFAULT_AGENT_OPTION_ID
      ? (modelOption?.value ?? modelOption?.label)
      : (agentProfileLabels({ ...profile, reasoning: DEFAULT_AGENT_OPTION_ID, mode: "default" })[0] ?? modelOption?.label ?? profile.model);
  // e.g. "Claude Code · Opus 4.8 · medium" — the effort is shown when set.
  const effort = resolveAgentReasoningValue(profile.agent, profile.reasoning);
  return [agent.name, modelLabel, effort].filter(Boolean).join(" · ");
}

/** Collapsed-by-default container holding an agent turn's intermediate work, so
 *  threads stay readable — only the answer and the (collapsed) details show. */
function AgentDetails({
  blocks,
  actions,
  autoExpand = false,
  live = false,
  showSpinner = false,
  hasResultAfter = false,
  startedAtMs,
}: {
  readonly blocks: readonly AgentBlock[];
  readonly actions?: MessageActionHandlers;
  readonly autoExpand?: boolean;
  readonly live?: boolean;
  readonly showSpinner?: boolean;
  readonly hasResultAfter?: boolean;
  readonly startedAtMs?: number;
}) {
  // `autoExpand` only seeds the initial open state — expanded while the turn is
  // live (the agent is still working). We key off the live turn, not a reasoning
  // block being active, because some agents stream their thinking as plain text
  // rather than reasoning events. Afterwards the user's manual toggle always
  // wins, so the container can be collapsed mid-thought.
  const [open, setOpen] = useState(autoExpand && live);
  const previousLive = useRef(live);
  const detailsId = useId();
  const { t } = useI18n();
  const reasoning = blocks.find((block) => block.kind === "reasoning");
  const reasoningDuration = reasoning?.kind === "reasoning" ? reasoning.duration : undefined;
  // The turn's real wall-clock start (epoch ms) so the live timer shows actual
  // elapsed time, surviving page reloads, instead of counting from mount. It's
  // carried by the ACTIVE (last) reasoning block, not necessarily the first, so
  // scan all reasoning blocks for it.
  const blockStartedAtMs = blocks.reduce<number | undefined>((found, block) => found ?? (block.kind === "reasoning" ? block.startedAtMs : undefined), undefined);
  // Parse the persisted "17s" duration string into seconds for a tidy m/s label.
  const doneSeconds = reasoningDuration ? Number.parseInt(reasoningDuration, 10) : Number.NaN;
  // Re-render once per second so the live elapsed label ticks.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!showSpinner) {
      return;
    }
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [showSpinner]);
  useEffect(() => {
    if (previousLive.current && !live && hasResultAfter) {
      setOpen(false);
    }
    previousLive.current = live;
  }, [hasResultAfter, live]);
  const liveAnchor = startedAtMs ?? blockStartedAtMs;
  const liveSeconds = showSpinner && liveAnchor !== undefined ? Math.round((Date.now() - liveAnchor) / 1000) : null;
  // Only expandable when there is real content — an empty reasoning block (e.g.
  // a still-streaming turn) shows the header but can't be opened to nothing.
  const expandable = blocks.some((block) => (block.kind === "reasoning" ? block.text.trim().length > 0 : true));
  const isOpen = expandable && open;
  const headerContent = (
    <>
      <PsychologyIcon sx={{ fontSize: 16, color: "text.secondary", flex: "0 0 auto" }} />
      <Typography variant="microLabel" sx={{ color: "text.secondary", flex: 1, minWidth: 0 }}>
        {t("reasoning")}
      </Typography>
      {/* Right edge: dots + live elapsed while working, or "Worked Xm Ys" when done. */}
      {showSpinner ? (
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flex: "0 0 auto" }}>
          <TypingDots />
          {liveSeconds !== null && <Typography component="span" sx={durationLabelSx}>{formatElapsedSeconds(liveSeconds, t)}</Typography>}
        </Stack>
      ) : Number.isFinite(doneSeconds) ? (
        <Typography component="span" sx={durationLabelSx}>{t("reasoningWorked", { duration: formatElapsedSeconds(doneSeconds, t) })}</Typography>
      ) : null}
      {expandable && <KeyboardArrowDownIcon sx={{ fontSize: 18, color: "text.secondary", transition: "transform 180ms ease", transform: isOpen ? "rotate(180deg)" : "none" }} />}
    </>
  );
  const headerSx = {
    alignItems: "center",
    display: "flex",
    gap: 1.25,
    justifyContent: "flex-start",
    px: 1.5,
    py: 1,
    textAlign: "left",
    width: "100%",
  } as const;

  return (
    <Box sx={{ borderRadius: (t) => `${t.custom.radii.md}px`, border: (t) => `1px dashed ${t.custom.borders.subtle}`, backgroundColor: (t) => t.custom.surfaces.s1, overflow: "clip" }}>
      {expandable ? (
        <ButtonBase
          aria-controls={detailsId}
          aria-expanded={isOpen}
          onClick={() => setOpen((value) => !value)}
          sx={{ ...headerSx, position: "sticky", top: 0, zIndex: 3, backgroundColor: (t) => t.custom.surfaces.s1, "&:hover": { backgroundColor: (t) => t.custom.surfaces.s3 } }}
          type="button"
        >
          {headerContent}
        </ButtonBase>
      ) : (
        <Stack direction="row" sx={{ ...headerSx, position: "sticky", top: 0, zIndex: 3, backgroundColor: (t) => t.custom.surfaces.s1 }}>
          {headerContent}
        </Stack>
      )}
      <Collapse in={isOpen} unmountOnExit>
        <Stack
          data-testid="agent-details-body"
          id={detailsId}
          spacing={0.75}
          sx={{
            "--agent-sticky-top": "0px",
            "--agent-sticky-z-index": 2,
            px: 1.5,
            py: 1.5,
            borderTop: (t) => `1px dashed ${t.custom.borders.subtle}`,
          }}
        >
          {/* Drop empty reasoning segments — a blank Typography still consumes a
              Stack gap on each side, which read as uneven spacing between tools. */}
          {blocks
            .filter((block) => !(block.kind === "reasoning" && block.text.trim().length === 0))
            .map((block, index) =>
              block.kind === "reasoning" ? (
                <Typography
                  key={index}
                  component="div"
                  sx={{
                    fontFamily: (t) => t.custom.fonts.mono,
                    fontSize: "0.76rem",
                    lineHeight: 1.7,
                    color: "text.secondary",
                    whiteSpace: "pre-line",
                    overflowWrap: "anywhere",
                    wordBreak: "break-word",
                    fontStyle: "italic",
                  }}
                >
                  {block.text.trim()}
                </Typography>
              ) : (
                <AgentBlockRenderer
                  key={index}
                  // Strip `streaming` from narration text so it doesn't render its
                  // own bare dots; the live indicator belongs only in the header.
                  block={block.kind === "text" ? { ...block, streaming: false } : block}
                  actions={actions ? { onApprovalDecision: actions.onApprovalDecision, onOptionSelection: actions.onOptionSelection } : undefined}
                />
              ),
            )}
        </Stack>
      </Collapse>
    </Box>
  );
}

const DEFAULT_DISPLAY_PREFS: MessageDisplayPrefs = { reasoningAutoExpand: true };

function AgentMessage({
  message,
  delay,
  actions,
  displayPrefs = DEFAULT_DISPLAY_PREFS,
  agentProfile,
}: {
  readonly message: ChatMessage;
  readonly delay: number;
  readonly actions?: MessageActionHandlers;
  readonly displayPrefs?: MessageDisplayPrefs;
  readonly agentProfile?: AgentProfile;
}) {
  const { t } = useI18n();
  const blocks = message.blocks ?? [];
  const live = isMessageLive(blocks);
  const emptyLive = blocks.length === 0 && message.startedAtMs !== undefined;
  const [, forceMessageTick] = useState(0);
  const diffBlocks = blocks.filter((block): block is DiffBlock => block.kind === DIFF_KIND);
  // The live plan is pinned under the message; completed plans archive into
  // details after a short grace period so the thread does not keep duplicating
  // stale checklists.
  const planBlocks = blocks.filter((block): block is PlanBlock => block.kind === "plan");
  const [hideCompletedPlans, setHideCompletedPlans] = useState(false);
  const completedPlanSignature = planStateSignature(planBlocks);
  const hasCompletedPlan = planBlocks.some(isCompletedPlanBlock);
  useEffect(() => {
    if (!hasCompletedPlan) {
      setHideCompletedPlans(false);
      return;
    }
    setHideCompletedPlans(false);
    const timer = window.setTimeout(() => setHideCompletedPlans(true), COMPLETED_PLAN_HIDE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [completedPlanSignature, hasCompletedPlan]);
  const visiblePlanBlocks = planBlocks.filter((block) => !hideCompletedPlans || !isCompletedPlanBlock(block));
  const archivedPlanBlocks = hideCompletedPlans ? planBlocks.filter(isCompletedPlanBlock) : [];
  const [hideResolvedInputs, setHideResolvedInputs] = useState(false);
  const [previewImage, setPreviewImage] = useState<MessageAttachment | null>(null);
  const resolvedInputsSignature = resolvedInputSignature(blocks);
  const hasResolvedInput = resolvedInputsSignature.length > 0;
  useEffect(() => {
    if (!hasResolvedInput) {
      setHideResolvedInputs(false);
      return;
    }
    setHideResolvedInputs(false);
    const timer = window.setTimeout(() => setHideResolvedInputs(true), COMPLETED_PLAN_HIDE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [hasResolvedInput, resolvedInputsSignature]);
  // Only the final result text escapes the Reasoning container; narration text
  // that arrived before/between tool calls stays interleaved with them inside.
  // Legacy/persisted text blocks have no `result` flag — treat them as result
  // (visible) unless explicitly marked as narration (result === false).
  const isResultText = (block: AgentBlock): boolean => block.kind === "text" && block.result !== false && !live;
  const isAnswerBlock = (block: AgentBlock): boolean =>
    readOnlyImageToolPath(block) != null ||
    isResultText(block) ||
    (ANSWER_BLOCK_KINDS.has(block.kind) && block.kind !== "text" && (!isResolvedInputBlock(block) || !hideResolvedInputs));
  const baseAnswerBlocks = blocks.filter((block) => isAnswerBlock(block));
  const visibleTerminalStatus = lastVisibleTerminalStatus(blocks, live, baseAnswerBlocks.length > 0);
  const detailBlocks = [
    ...blocks.filter((block) => !isAnswerBlock(block) && block.kind !== DIFF_KIND && block.kind !== "plan"),
    ...archivedPlanBlocks,
  ];
  const answerBlocks = [...baseAnswerBlocks, ...(visibleTerminalStatus ? [visibleTerminalStatus] : [])];
  // The live "thinking" dots live in exactly one place. Once the answer text
  // starts streaming (white text appears) it carries its own trailing dots, so
  // the reasoning header dots would otherwise hang awkwardly in the middle.
  const answerStreaming = answerBlocks.some((block) => block.kind === "text" && block.streaming === true);
  const showDetailSpinner = live && !answerStreaming;
  const liveSeconds = (live || emptyLive) && message.startedAtMs !== undefined ? Math.round((Date.now() - message.startedAtMs) / 1000) : null;
  const profileLabel = agentMessageProfileLabel(message.profile ?? agentProfile);
  useEffect(() => {
    if (!emptyLive) {
      return;
    }
    const id = setInterval(() => forceMessageTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [emptyLive]);
  return (
    <>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "flex-start", width: "100%", minWidth: 0, ...rise(delay), ...revealActionsOnHover }}>
        <AgentAvatar />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", mb: 1 }}>
            <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.8rem", fontWeight: 700, color: "text.primary" }}>
              {t("agent")}
            </Typography>
            {profileLabel && (
              <Typography noWrap sx={{ minWidth: 0, maxWidth: 260, fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.7rem", fontWeight: 700, color: "text.secondary" }}>
                {profileLabel}
              </Typography>
            )}
            {message.time && (
              <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.66rem", color: "text.secondary" }}>
                {normalizeClockLabel(message.time)}
              </Typography>
            )}
          </Stack>
          <Stack spacing={1.25} sx={{ minWidth: 0, maxWidth: "100%" }}>
          {/* The turn starts as an empty agent message; show the thinking dots in
              place until the first block streams in (no separate typing bubble). */}
          {blocks.length === 0 && (
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              <TypingDots />
              {liveSeconds !== null && <Typography component="span" sx={durationLabelSx}>{formatElapsedSeconds(liveSeconds, t)}</Typography>}
            </Stack>
          )}
          {detailBlocks.length > 0 && (
            <Box sx={{ minWidth: 0, maxWidth: "100%", ...rise(delay + 40) }}>
              <AgentDetails blocks={detailBlocks} actions={actions} autoExpand={displayPrefs.reasoningAutoExpand ?? false} live={live} showSpinner={showDetailSpinner} hasResultAfter={answerBlocks.length > 0} startedAtMs={message.startedAtMs} />
            </Box>
          )}
          {/* Plan stays pinned and visible under the message, even mid-run. */}
          {visiblePlanBlocks.map((block, index) => (
            <Box key={`plan-${index}`} sx={{ minWidth: 0, maxWidth: "100%", ...rise(delay + 60) }}>
              <AgentBlockRenderer block={block} />
            </Box>
          ))}
            {answerBlocks.map((block, index) => {
              const imagePath = readOnlyImageToolPath(block);
              return (
                <Box key={index} sx={{ minWidth: 0, maxWidth: "100%", ...rise(delay + 80 + Math.min(index, 3) * 40) }}>
                  {imagePath ? (
                    <AgentImagePreview path={imagePath} onOpen={setPreviewImage} />
                  ) : (
                    <AgentBlockRenderer
                      block={block}
                      actions={actions ? { onApprovalDecision: actions.onApprovalDecision, onOptionSelection: actions.onOptionSelection } : undefined}
                    />
                  )}
                </Box>
              );
            })}
          </Stack>
          {/* File changes from the turn: shown under the reply once the agent is
              done (not folded into the reasoning container), above the copy action. */}
          {!live && diffBlocks.length > 0 && <ChangedFilesAccordion blocks={diffBlocks} delay={delay + 100} />}
          <MessageActionBar message={message} actions={actions ? { onCopy: actions.onCopy, onRetry: actions.onRetry, onFork: actions.onFork } : undefined} />
        </Box>
      </Stack>
      <ImageLightbox src={previewImage?.target ?? null} label={previewImage?.name} onClose={() => setPreviewImage(null)} />
    </>
  );
}

export function Message({
  message,
  index = 0,
  actions,
  displayPrefs,
  agentProfile,
}: {
  readonly message: ChatMessage;
  readonly index?: number;
  readonly actions?: MessageActionHandlers;
  readonly displayPrefs?: MessageDisplayPrefs;
  readonly agentProfile?: AgentProfile;
}) {
  // No per-index cascade: in a long thread `index` is large, so `index * 120`
  // delayed message 30 by 3.6s on open. Every message fades in immediately; only
  // the blocks within a message stagger slightly (see AgentMessage).
  const delay = 0;
  return message.role === "user" ? (
    <UserMessage message={message} delay={delay} actions={actions} />
  ) : (
    <AgentMessage message={message} delay={delay} actions={actions} displayPrefs={displayPrefs} agentProfile={agentProfile} />
  );
}
