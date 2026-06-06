import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import EditIcon from "@mui/icons-material/Edit";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import PsychologyIcon from "@mui/icons-material/Psychology";
import ReplayIcon from "@mui/icons-material/Replay";
import SendIcon from "@mui/icons-material/Send";
import CloseIcon from "@mui/icons-material/Close";
import { Box, Collapse, Stack, Typography } from "@mui/material";
import { type ChangeEvent, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, IconButton, Tooltip } from "../ui";
import { AgentBlockRenderer } from "./AgentBlockRenderer";
import { rise } from "./anim";
import { type MessageActionHandlers } from "./message-actions";
import { AgentAvatar, TypingDots, UserAvatar } from "./parts";
import { type AgentBlock, type ChatMessage } from "./types";
import { formatCostUsd, formatTokenUsage } from "./usage-cost";

/**
 * Split a sent user message into its visible text and the attachments that the
 * composer appended (inline text-file blocks and path-based file links). Files
 * are shown as compact tags instead of dumping their contents into the thread.
 */
function splitUserContent(raw: string): { readonly text: string; readonly attachments: readonly string[] } {
  const names: string[] = [];
  let text = raw.replace(/<attachment\s+name="([^"]*)"[^>]*>[\s\S]*?<\/attachment>/g, (_match, name: string) => {
    names.push(name);
    return "";
  });
  text = text.replace(/!?\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole: string, label: string, target: string) => {
    if (/[\\/]/.test(target) || /\.[a-z0-9]{1,8}$/i.test(target)) {
      names.push(label);
      return "";
    }
    return whole;
  });
  return { text: text.trim(), attachments: names };
}

function MessageAttachments({ names }: { readonly names: readonly string[] }) {
  return (
    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, justifyContent: "flex-end" }}>
      {names.map((name, index) => (
        <Box
          key={`${name}-${index}`}
          component="span"
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 0.5,
            maxWidth: 240,
            px: 0.875,
            py: 0.25,
            borderRadius: (t) => `${t.custom.radii.pill}px`,
            fontSize: "0.72rem",
            fontWeight: 600,
            color: "text.primary",
            backgroundColor: (t) => t.custom.surfaces.s3,
            border: (t) => `1px solid ${t.custom.borders.strong}`,
          }}
        >
          <DescriptionOutlinedIcon sx={{ fontSize: 13, color: "text.secondary", flex: "0 0 auto" }} />
          <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {name}
          </Box>
        </Box>
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
  if (!actions?.onCopy) {
    return null;
  }

  return (
    <Stack className="msg-actions" direction="row" spacing={0.25} sx={{ justifyContent: "flex-start", mt: 1, ...messageActionRowSx }}>
      <Tooltip title={t("copy")}>
        <IconButton aria-label={t("copyMessage")} onClick={() => actions.onCopy?.(message)} sx={messageActionButtonSx}>
          <ContentCopyIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

function UserMessage({ message, delay, actions }: { readonly message: ChatMessage; readonly delay: number; readonly actions?: MessageActionHandlers }) {
  const { text: displayText, attachments } = splitUserContent(message.text ?? "");
  const reviewBlocks = (message.blocks ?? []).filter((block) => block.kind === "review");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayText);
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
      <Stack spacing={0.5} sx={{ alignItems: "flex-end", maxWidth: "82%", minWidth: 0 }}>
        {editing ? (
          <Box
            sx={{
              p: 1,
              width: "min(520px, 100%)",
              borderRadius: (t) => `${t.custom.radii.lg}px`,
              backgroundColor: (t) => t.custom.surfaces.s2,
              border: (t) => `1px solid ${t.custom.borders.focus}`,
            }}
          >
            <Stack spacing={1}>
              <Box
                component="textarea"
                aria-label={t("editMessage")}
                value={draft}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setDraft(event.currentTarget.value)}
                rows={3}
                sx={{
                  width: "100%",
                  resize: "vertical",
                  border: (t) => `1px solid ${t.custom.borders.subtle}`,
                  borderRadius: (t) => `${t.custom.radii.md}px`,
                  bgcolor: (t) => t.custom.surfaces.s1,
                  color: "text.primary",
                  font: "inherit",
                  fontSize: "0.9rem",
                  lineHeight: 1.5,
                  p: 1,
                  outline: 0,
                  "&:focus": {
                    borderColor: (t) => t.custom.borders.focus,
                  },
                }}
              />
              <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
                <Button size="small" variant="text" aria-label={t("cancelEdit")} onClick={() => setEditing(false)}>
                  <CloseIcon sx={{ fontSize: 15 }} />
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
            {attachments.length > 0 && <MessageAttachments names={attachments} />}
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
            {actions?.onRetry && (
              <Tooltip title={t("retry")}>
                <IconButton aria-label={t("retryMessage")} onClick={() => actions.onRetry?.(message)} sx={messageActionButtonSx}>
                  <ReplayIcon sx={{ fontSize: 14 }} />
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
    </Stack>
  );
}

// The agent's actual reply / things the user must act on stay visible; all the
// intermediate work (reasoning, tool calls, commands, diffs, searches, plans,
// code, status, citations) is folded into one collapsed container.
const ANSWER_BLOCK_KINDS: ReadonlySet<AgentBlock["kind"]> = new Set(["text", "options", "approval", "suggested"]);

export interface MessageDisplayPrefs {
  readonly showTokens: boolean;
  readonly showCost: boolean;
}

function UsagePill({ children }: { readonly children: React.ReactNode }) {
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

/** Collapsed-by-default container holding an agent turn's intermediate work, so
 *  threads stay readable — only the answer and the (collapsed) details show. */
function AgentDetails({ blocks, actions }: { readonly blocks: readonly AgentBlock[]; readonly actions?: MessageActionHandlers }) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  const reasoning = blocks.find((block) => block.kind === "reasoning");
  const reasoningDuration = reasoning?.kind === "reasoning" ? reasoning.duration : undefined;
  const active = blocks.some((block) => block.kind === "reasoning" && block.active);
  // Only expandable when there is real content — an empty reasoning block (e.g.
  // a still-streaming turn) shows the header but can't be opened to nothing.
  const expandable = blocks.some((block) => (block.kind === "reasoning" ? block.text.trim().length > 0 : true));
  const isOpen = open && expandable;

  return (
    <Box sx={{ borderRadius: (t) => `${t.custom.radii.md}px`, border: (t) => `1px dashed ${t.custom.borders.subtle}`, backgroundColor: (t) => t.custom.surfaces.s1, overflow: "hidden" }}>
      <Stack
        direction="row"
        spacing={1.25}
        onClick={expandable ? () => setOpen((value) => !value) : undefined}
        sx={{ alignItems: "center", px: 1.5, py: 1, cursor: expandable ? "pointer" : "default", "&:hover": expandable ? { backgroundColor: (t) => t.custom.surfaces.s3 } : undefined }}
      >
        <PsychologyIcon sx={{ fontSize: 16, color: "text.secondary" }} />
        <Typography variant="microLabel" sx={{ color: "text.secondary", flex: 1, minWidth: 0 }}>
          {reasoningDuration ? t("reasoningThoughtFor", { duration: reasoningDuration }) : t("reasoning")}
        </Typography>
        {active && <TypingDots />}
        {expandable && <KeyboardArrowDownIcon sx={{ fontSize: 18, color: "text.secondary", transition: "transform 180ms ease", transform: isOpen ? "rotate(180deg)" : "none" }} />}
      </Stack>
      <Collapse in={isOpen} unmountOnExit>
        <Stack spacing={1.25} sx={{ px: 1.5, py: 1.5, borderTop: (t) => `1px dashed ${t.custom.borders.subtle}` }}>
          {blocks.map((block, index) =>
            block.kind === "reasoning" ? (
              <Typography
                key={index}
                component="div"
                sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.76rem", lineHeight: 1.7, color: "text.secondary", whiteSpace: "pre-line", fontStyle: "italic" }}
              >
                {block.text}
              </Typography>
            ) : (
              <AgentBlockRenderer
                key={index}
                block={block}
                actions={actions ? { onApprovalDecision: actions.onApprovalDecision, onOptionSelection: actions.onOptionSelection } : undefined}
              />
            ),
          )}
        </Stack>
      </Collapse>
    </Box>
  );
}

function AgentMessage({ message, delay, actions }: { readonly message: ChatMessage; readonly delay: number; readonly actions?: MessageActionHandlers }) {
  const { t } = useI18n();
  const blocks = message.blocks ?? [];
  const detailBlocks = blocks.filter((block) => !ANSWER_BLOCK_KINDS.has(block.kind));
  const answerBlocks = blocks.filter((block) => ANSWER_BLOCK_KINDS.has(block.kind));
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: "flex-start", ...rise(delay), ...revealActionsOnHover }}>
      <AgentAvatar />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", mb: 1 }}>
          <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.8rem", fontWeight: 700, color: "text.primary" }}>
            {t("agent")}
          </Typography>
          {message.time && (
            <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.66rem", color: "text.secondary" }}>
              {message.time}
            </Typography>
          )}
          <AgentUsageMeta message={message} />
        </Stack>
        <Stack spacing={1.25}>
          {/* The turn starts as an empty agent message; show the thinking dots in
              place until the first block streams in (no separate typing bubble). */}
          {blocks.length === 0 && <TypingDots />}
          {detailBlocks.length > 0 && (
            <Box sx={rise(delay + 120)}>
              <AgentDetails blocks={detailBlocks} actions={actions} />
            </Box>
          )}
          {answerBlocks.map((block, index) => (
            <Box key={index} sx={rise(delay + 200 + index * 90)}>
              <AgentBlockRenderer
                block={block}
                actions={actions ? { onApprovalDecision: actions.onApprovalDecision, onOptionSelection: actions.onOptionSelection } : undefined}
              />
            </Box>
          ))}
        </Stack>
        <MessageActionBar message={message} actions={actions ? { onCopy: actions.onCopy } : undefined} />
      </Box>
    </Stack>
  );
}

export function Message({ message, index = 0, actions }: { readonly message: ChatMessage; readonly index?: number; readonly actions?: MessageActionHandlers }) {
  const delay = index * 120;
  return message.role === "user" ? <UserMessage message={message} delay={delay} actions={actions} /> : <AgentMessage message={message} delay={delay} actions={actions} />;
}
