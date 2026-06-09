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
import { type ChangeEvent, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { localFileUrl } from "../../lib/external-url";
import { ImageLightbox } from "../workspace/ImageLightbox";
import { Button, IconButton, Tooltip } from "../ui";
import { AgentBlockRenderer } from "./AgentBlockRenderer";
import { AttachmentTile } from "./AttachmentTile";
import { DiffCard } from "./DiffCard";
import { DEFAULT_AGENT_OPTION_ID, agentProfileLabels, getAgent, resolveAgentReasoningValue, type AgentProfile } from "./agents";
import { rise } from "./anim";
import type { MessageActionHandlers } from "./message-actions";
import { AgentAvatar, TypingDots, UserAvatar } from "./parts";
import type { AgentBlock, ChatMessage, DiffBlock } from "./types";
import { formatCostUsd, formatTokenUsage } from "./usage-cost";

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
    <Stack direction="row" spacing={1.25} sx={{ justifyContent: "flex-end", alignItems: "flex-start", ...rise(delay), ...revealActionsOnHover }}>
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
          <Stack spacing={0.5} sx={{ alignItems: "flex-end", minWidth: 0 }}>
            {displayText && (
              <Box
                sx={{
                  px: 1.75,
                  py: 1.25,
                  borderRadius: (t) => `${t.custom.radii.lg}px`,
                  borderTopRightRadius: (t) => `${t.custom.radii.sm}px`,
                  backgroundColor: (t) => t.custom.surfaces.s3,
                  border: (t) => `1px solid ${t.custom.borders.subtle}`,
                }}
              >
                <Typography sx={{ fontSize: "0.9rem", lineHeight: 1.6, color: "text.primary", whiteSpace: "pre-line", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                  {displayText}
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
            {message.time}
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

export interface MessageDisplayPrefs {
  readonly showTokens: boolean;
  readonly showCost: boolean;
  /** Auto-expand the reasoning container while the agent is actively thinking. */
  readonly reasoningAutoExpand?: boolean;
}

function UsagePill({ children }: { readonly children: ReactNode }) {
  return (
    <Box
      component="span"
      sx={{
        px: 0.75,
        py: 0.2,
        borderRadius: (t) => `${t.custom.radii.pill}px`,
        border: (t) => `1px solid ${t.custom.borders.subtle}`,
        color: "text.secondary",
        fontFamily: (t) => t.custom.fonts.mono,
        fontSize: "0.66rem",
        lineHeight: 1.4,
      }}
    >
      {children}
    </Box>
  );
}

function AgentUsageMeta({ message, displayPrefs }: { readonly message: ChatMessage; readonly displayPrefs: MessageDisplayPrefs }) {
  const showCost = displayPrefs.showCost && message.costUsd !== undefined;
  const showTokens = displayPrefs.showTokens && message.usage !== undefined;
  if (!showCost && !showTokens) {
    return null;
  }
  return (
    <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
      {showCost && <UsagePill>{formatCostUsd(message.costUsd!)}</UsagePill>}
      {showTokens && <UsagePill>{formatTokenUsage(message.usage!)}</UsagePill>}
    </Stack>
  );
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
function AgentDetails({ blocks, actions, autoExpand = false, live = false, showSpinner = false }: { readonly blocks: readonly AgentBlock[]; readonly actions?: MessageActionHandlers; readonly autoExpand?: boolean; readonly live?: boolean; readonly showSpinner?: boolean }) {
  // `autoExpand` only seeds the initial open state — expanded while the turn is
  // live (the agent is still working). We key off the live turn, not a reasoning
  // block being active, because some agents stream their thinking as plain text
  // rather than reasoning events. Afterwards the user's manual toggle always
  // wins, so the container can be collapsed mid-thought.
  const [open, setOpen] = useState(autoExpand && live);
  const detailsId = useId();
  const { t } = useI18n();
  const reasoning = blocks.find((block) => block.kind === "reasoning");
  const reasoningDuration = reasoning?.kind === "reasoning" ? reasoning.duration : undefined;
  // The turn's real wall-clock start (epoch ms) so the live timer shows actual
  // elapsed time, surviving page reloads, instead of counting from mount. It's
  // carried by the ACTIVE (last) reasoning block, not necessarily the first, so
  // scan all reasoning blocks for it.
  const startedAtMs = blocks.reduce<number | undefined>((found, block) => found ?? (block.kind === "reasoning" ? block.startedAtMs : undefined), undefined);
  // Parse the persisted "17s" duration string into seconds for a tidy m/s label.
  const doneSeconds = reasoningDuration ? Number.parseInt(reasoningDuration, 10) : Number.NaN;
  // Re-render once per second so the live elapsed label ticks.
  const [, forceTick] = useState(0);
  const liveStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (!showSpinner) {
      liveStartRef.current = null;
      return;
    }
    // Fall back to a mount-relative clock only if the block carries no real start.
    if (liveStartRef.current === null) {
      liveStartRef.current = Date.now();
    }
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [showSpinner]);
  const fmtDuration = (totalSec: number): string => {
    const safe = Math.max(0, totalSec);
    const m = Math.floor(safe / 60);
    const s = safe % 60;
    return m > 0 ? `${m}${t("unitMinShort")} ${s}${t("unitSecShort")}` : `${s}${t("unitSecShort")}`;
  };
  const liveAnchor = startedAtMs ?? liveStartRef.current;
  const liveSeconds = showSpinner && liveAnchor !== null && liveAnchor !== undefined ? Math.round((Date.now() - liveAnchor) / 1000) : 0;
  // Only expandable when there is real content — an empty reasoning block (e.g.
  // a still-streaming turn) shows the header but can't be opened to nothing.
  const expandable = blocks.some((block) => (block.kind === "reasoning" ? block.text.trim().length > 0 : true));
  const isOpen = expandable && open;
  const durationLabelSx = { fontFamily: (th: { custom: { fonts: { mono: string } } }) => th.custom.fonts.mono, fontSize: "0.68rem", color: "text.secondary", flex: "0 0 auto", whiteSpace: "nowrap" } as const;
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
          <Typography component="span" sx={durationLabelSx}>{fmtDuration(liveSeconds)}</Typography>
        </Stack>
      ) : Number.isFinite(doneSeconds) ? (
        <Typography component="span" sx={durationLabelSx}>{t("reasoningWorked", { duration: fmtDuration(doneSeconds) })}</Typography>
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
    <Box sx={{ borderRadius: (t) => `${t.custom.radii.md}px`, border: (t) => `1px dashed ${t.custom.borders.subtle}`, backgroundColor: (t) => t.custom.surfaces.s1, overflow: "hidden" }}>
      {expandable ? (
        <ButtonBase
          aria-controls={detailsId}
          aria-expanded={isOpen}
          onClick={() => setOpen((value) => !value)}
          sx={{ ...headerSx, "&:hover": { backgroundColor: (t) => t.custom.surfaces.s3 } }}
          type="button"
        >
          {headerContent}
        </ButtonBase>
      ) : (
        <Stack direction="row" sx={headerSx}>
          {headerContent}
        </Stack>
      )}
      <Collapse in={isOpen} unmountOnExit>
        <Stack id={detailsId} spacing={0.75} sx={{ px: 1.5, py: 1.5, borderTop: (t) => `1px dashed ${t.custom.borders.subtle}` }}>
          {/* Drop empty reasoning segments — a blank Typography still consumes a
              Stack gap on each side, which read as uneven spacing between tools. */}
          {blocks
            .filter((block) => !(block.kind === "reasoning" && block.text.trim().length === 0))
            .map((block, index) =>
              block.kind === "reasoning" ? (
                <Typography
                  key={index}
                  component="div"
                  sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.76rem", lineHeight: 1.7, color: "text.secondary", whiteSpace: "pre-line", fontStyle: "italic" }}
                >
                  {block.text.trim()}
                </Typography>
              ) : (
                <AgentBlockRenderer
                  key={index}
                  // Strip `streaming` from narration text so it doesn't render its
                  // own bare dots — the single live indicator below carries the timer.
                  block={block.kind === "text" ? { ...block, streaming: false } : block}
                  actions={actions ? { onApprovalDecision: actions.onApprovalDecision, onOptionSelection: actions.onOptionSelection } : undefined}
                />
              ),
            )}
          {/* Live "thinking" indicator inside the body, with the same elapsed
              timer as the header (single instance — no duplicate). */}
          {showSpinner && (
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              <TypingDots />
              <Typography component="span" sx={durationLabelSx}>{fmtDuration(liveSeconds)}</Typography>
            </Stack>
          )}
        </Stack>
      </Collapse>
    </Box>
  );
}

const DEFAULT_DISPLAY_PREFS: MessageDisplayPrefs = { showTokens: true, showCost: false };

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
  const diffBlocks = blocks.filter((block): block is DiffBlock => block.kind === DIFF_KIND);
  // The plan is pinned under the message (visible even while the agent works),
  // not folded into the collapsible details.
  const planBlocks = blocks.filter((block) => block.kind === "plan");
  // Only the final result text escapes the Reasoning container; narration text
  // that arrived before/between tool calls stays interleaved with them inside.
  // Legacy/persisted text blocks have no `result` flag — treat them as result
  // (visible) unless explicitly marked as narration (result === false).
  const isResultText = (block: AgentBlock): boolean => block.kind === "text" && block.result !== false;
  const isAnswerBlock = (block: AgentBlock): boolean => isResultText(block) || (ANSWER_BLOCK_KINDS.has(block.kind) && block.kind !== "text");
  const detailBlocks = blocks.filter((block) => !isAnswerBlock(block) && block.kind !== DIFF_KIND && block.kind !== "plan");
  const answerBlocks = blocks.filter((block) => isAnswerBlock(block));
  const live = isMessageLive(blocks);
  // The live "thinking" dots live in exactly one place. Once the answer text
  // starts streaming (white text appears) it carries its own trailing dots, so
  // the reasoning header dots would otherwise hang awkwardly in the middle.
  const answerStreaming = answerBlocks.some((block) => block.kind === "text" && block.streaming === true);
  const showDetailSpinner = live && !answerStreaming;
  const profileLabel = agentMessageProfileLabel(message.profile ?? agentProfile);
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: "flex-start", ...rise(delay), ...revealActionsOnHover }}>
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
              {message.time}
            </Typography>
          )}
          <AgentUsageMeta message={message} displayPrefs={displayPrefs} />
        </Stack>
        <Stack spacing={1.25}>
          {/* The turn starts as an empty agent message; show the thinking dots in
              place until the first block streams in (no separate typing bubble). */}
          {blocks.length === 0 && <TypingDots />}
          {detailBlocks.length > 0 && (
            <Box sx={rise(delay + 40)}>
              <AgentDetails blocks={detailBlocks} actions={actions} autoExpand={displayPrefs.reasoningAutoExpand ?? false} live={live} showSpinner={showDetailSpinner} />
            </Box>
          )}
          {/* Plan stays pinned and visible under the message, even mid-run. */}
          {planBlocks.map((block, index) => (
            <Box key={`plan-${index}`} sx={rise(delay + 60)}>
              <AgentBlockRenderer block={block} />
            </Box>
          ))}
          {answerBlocks.map((block, index) => (
            <Box key={index} sx={rise(delay + 80 + Math.min(index, 3) * 40)}>
              <AgentBlockRenderer
                block={block}
                actions={actions ? { onApprovalDecision: actions.onApprovalDecision, onOptionSelection: actions.onOptionSelection } : undefined}
              />
            </Box>
          ))}
        </Stack>
        {/* File changes from the turn: shown under the reply once the agent is
            done (not folded into the reasoning container), above the copy action. */}
        {!live && diffBlocks.length > 0 && (
          <Stack spacing={1} sx={{ mt: 1.25 }}>
            {diffBlocks.map((block, index) => (
              <Box key={`diff-${index}`} sx={rise(delay + 100 + Math.min(index, 3) * 40)}>
                <DiffCard block={block} />
              </Box>
            ))}
          </Stack>
        )}
        <MessageActionBar message={message} actions={actions ? { onCopy: actions.onCopy, onRetry: actions.onRetry, onFork: actions.onFork } : undefined} />
      </Box>
    </Stack>
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
