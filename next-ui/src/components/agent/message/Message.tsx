import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import EditIcon from "@mui/icons-material/Edit";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import RefreshIcon from "@mui/icons-material/Refresh";
import SendIcon from "@mui/icons-material/Send";
import CloseIcon from "@mui/icons-material/Close";
import { Box, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { type ChangeEvent, type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import { localFileUrl } from "../../../lib/external-url";
import { normalizeClockLabel } from "../../../lib/time-format";
import { Button, IconButton, ImageLightbox, Tooltip } from "../../ui";
import { AgentBlockRenderer } from "../blocks/AgentBlockRenderer";
import { AgentDetails } from "./AgentDetails";
import { AttachmentTile } from "../composer/AttachmentTile";
import { Composer } from "../composer/Composer";
import { useComposerShared } from "../composer/composer-shared-context";
import { ChangedFilesAccordion } from "./ChangedFilesAccordion";
import { AgentMessageStore, MessageShellStore } from "../stores/agent-local-stores";
import type { AgentProfile } from "../core/agents";
import { rise } from "../core/anim";
import { keyedAgentBlocks } from "./message-block-keys";
import { createAgentMessageBlockModel, isMessageLive } from "./message-block-model";
import { basename, parseUserDraft, readOnlyImageToolPath, splitUserContent, type MessageAttachment } from "./message-content-model";
import { agentMessageProfileLabel, formatElapsedSeconds } from "./message-display-model";
import type { MessageActionHandlers } from "./message-actions";
import { AgentAvatar, MessageText, TypingDots, UserAvatar } from "../blocks/parts";
import type { ChatMessage } from "../core/types";
import { useDelayedHideFlag } from "./use-delayed-hide-flag";
import { useLiveElapsedSeconds } from "./use-live-elapsed-seconds";

function MessageAttachments({ attachments, onOpenImage }: { readonly attachments: readonly MessageAttachment[]; readonly onOpenImage: (attachment: MessageAttachment) => void }) {
  return (
    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75, justifyContent: "flex-end" }}>
      {attachments.map((attachment) => (
        <AttachmentTile
          key={attachment.id}
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

function AgentImagePreview({ path, onOpen }: { readonly path: string; readonly onOpen: (attachment: MessageAttachment) => void }) {
  const name = basename(path);
  const attachment = { id: `agent-image:${path}`, name, target: path, isImage: true };
  return (
    <Box
      component="button"
      type="button"
      onClick={() => onOpen(attachment)}
      aria-label={name}
      sx={{
        display: "inline-block",
        p: 0,
        border: 0,
        backgroundColor: "transparent",
        cursor: "pointer",
        maxWidth: "100%",
        lineHeight: 0,
      }}
    >
      <Box
        component="img"
        src={localFileUrl(path)}
        alt={name}
        loading="lazy"
        sx={{
          display: "block",
          maxWidth: 320,
          maxHeight: 320,
          width: "auto",
          height: "auto",
          borderRadius: (t) => `${t.custom.radii.md}px`,
          border: (t) => `1px solid ${t.custom.borders.subtle}`,
        }}
      />
    </Box>
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

/** Inline editor for a sent user message. When a Composer context is available
 *  (inside a live conversation) it reuses the real Composer input stack, but
 *  with edit-only chrome: text, attachments, mentions, and send. It falls back
 *  to a plain textarea in isolated contexts (tests/storybook) that lack the
 *  context. */
const UserMessageEditor = observer(function UserMessageEditor({
  message,
  store,
  onResend,
  onCancel,
}: {
  readonly message: ChatMessage;
  readonly store: MessageShellStore;
  readonly onResend: (value: string) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useI18n();
  const shared = useComposerShared();
  const editDraft = useMemo(() => parseUserDraft(message.text ?? ""), [message.text]);

  if (shared) {
    return (
      <Box sx={{ width: "100%", p: 1.5, borderRadius: (t) => `${t.custom.radii.lg}px`, backgroundColor: (t) => t.custom.surfaces.s2 }}>
        <Stack spacing={1}>
          <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
            <Typography variant="microLabel" sx={{ color: "text.secondary" }}>
              {t("editMessage")}
            </Typography>
            <Button size="small" variant="text" onClick={onCancel} startIcon={<CloseIcon sx={{ fontSize: 15 }} />}>
              {t("cancel")}
            </Button>
          </Stack>
          <Composer
            {...shared}
            key={message.id}
            variant="edit"
            placeholder={t("editMessage")}
            initialValue={editDraft.text}
            initialAttachments={editDraft.attachments}
            onSend={onResend}
            running={false}
          />
        </Stack>
      </Box>
    );
  }

  const submit = () => {
    const text = store.draft.trim();
    if (text.length > 0) {
      onResend(text);
    }
  };
  return (
    <Box sx={{ width: "100%", p: 1.5, borderRadius: (t) => `${t.custom.radii.lg}px`, backgroundColor: (t) => t.custom.surfaces.s2 }}>
      <Stack spacing={1.25}>
        <Typography variant="microLabel" sx={{ color: "text.secondary" }}>
          {t("editMessage")}
        </Typography>
        <Box
          component="textarea"
          aria-label={t("editMessage")}
          autoFocus
          value={store.draft}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => store.setDraft(event.currentTarget.value)}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              submit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
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
          <Button size="small" variant="text" onClick={onCancel} startIcon={<CloseIcon sx={{ fontSize: 15 }} />}>
            {t("cancel")}
          </Button>
          <Button size="small" variant="contained" aria-label={t("sendEditedMessage")} onClick={submit} startIcon={<SendIcon sx={{ fontSize: 15 }} />}>
            {t("send")}
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
});

const UserMessage = observer(function UserMessage({
  message,
  delay,
  actions,
}: {
  readonly message: ChatMessage;
  readonly delay: number;
  readonly actions?: MessageActionHandlers;
}) {
  const { text: displayText, attachments } = splitUserContent(message.text ?? "");
  const reviewBlocks = (message.blocks ?? []).filter((block) => block.kind === "review");
  const [store] = useState(() => new MessageShellStore(displayText));
  const { editing, previewImage, setEditing, setPreviewImage } = store;
  const { t } = useI18n();

  return (
    <Stack direction="row" spacing={1.25} sx={{ justifyContent: "flex-end", alignItems: "flex-start", width: "100%", minWidth: 0, ...rise(delay), ...revealActionsOnHover }}>
      {/* Editing breaks out of the narrow user-bubble width so there's room to
          rework a longer message comfortably. */}
      <Stack spacing={0.5} sx={{ alignItems: "flex-end", width: editing ? "100%" : "auto", maxWidth: editing ? "100%" : "82%", minWidth: 0 }}>
        {editing ? (
          <UserMessageEditor
            message={message}
            store={store}
            onResend={(value) => {
              actions?.onEditAndResend?.(message, value);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <Stack spacing={0.75} sx={{ alignItems: "flex-end", minWidth: 0, maxWidth: "100%" }}>
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
                <MessageText text={displayText} />
              </Box>
            )}
            {attachments.length > 0 && <MessageAttachments attachments={attachments} onOpenImage={setPreviewImage} />}
            {keyedAgentBlocks(reviewBlocks).map(({ block, key }) => (
              <AgentBlockRenderer key={key} block={block} />
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
});

// The agent's actual reply / things the user must act on stay visible; the
// intermediate work (reasoning, tool calls, commands, searches, plans, code,
// status, citations) is folded into one collapsed container. File diffs are
// pulled out separately and shown under the reply once the turn is done.
const COMPLETED_PLAN_HIDE_DELAY_MS = 3000;

const durationLabelSx = { fontFamily: (th: { custom: { fonts: { mono: string } } }) => th.custom.fonts.mono, fontSize: "0.68rem", color: "text.secondary", flex: "0 0 auto", whiteSpace: "nowrap" } as const;

export interface MessageDisplayPrefs {
  /** Auto-expand the reasoning container while the agent is actively thinking. */
  readonly reasoningAutoExpand?: boolean;
}

const DEFAULT_DISPLAY_PREFS: MessageDisplayPrefs = { reasoningAutoExpand: true };

const AgentMessage = observer(function AgentMessage({
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
  const [store] = useState(() => new AgentMessageStore());
  const { hideCompletedPlans, hideResolvedInputs, previewImage, setHideCompletedPlans, setHideResolvedInputs, setPreviewImage } = store;
  const blockModel = createAgentMessageBlockModel({
    blocks,
    hideCompletedPlans,
    hideResolvedInputs,
    isImageAnswerBlock: (block) => readOnlyImageToolPath(block) != null,
    live,
  });
  useDelayedHideFlag({
    delayMs: COMPLETED_PLAN_HIDE_DELAY_MS,
    generation: blockModel.hasCompletedPlan ? blockModel.completedPlanSignature : "",
    setHidden: setHideCompletedPlans,
  });
  useEffect(() => {
    setHideResolvedInputs(blockModel.hasResolvedInput);
  }, [blockModel.hasResolvedInput, blockModel.resolvedInputsSignature, setHideResolvedInputs]);
  // The live "thinking" dots live in exactly one place. Once the answer text
  // starts streaming (white text appears) it carries its own trailing dots, so
  // the reasoning header dots would otherwise hang awkwardly in the middle.
  const showDetailSpinner = live && !blockModel.answerStreaming;
  const liveSeconds = useLiveElapsedSeconds({ active: live || emptyLive, startedAtMs: message.startedAtMs });
  const durationUnits = { minute: t("unitMinShort"), second: t("unitSecShort") };
  const profileLabel = agentMessageProfileLabel(message.profile ?? agentProfile);
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
              {liveSeconds !== null && <Typography component="span" sx={durationLabelSx}>{formatElapsedSeconds(liveSeconds, durationUnits)}</Typography>}
            </Stack>
          )}
          {blockModel.detailBlocks.length > 0 && (
            <Box sx={{ minWidth: 0, maxWidth: "100%", ...rise(delay + 40) }}>
              <AgentDetails blocks={blockModel.detailBlocks} actions={actions} autoExpand={displayPrefs.reasoningAutoExpand ?? false} live={live} showSpinner={showDetailSpinner} hasResultAfter={blockModel.answerBlocks.length > 0} startedAtMs={message.startedAtMs} />
            </Box>
          )}
          {/* Plan stays pinned and visible under the message, even mid-run. */}
          {keyedAgentBlocks(blockModel.visiblePlanBlocks).map(({ block, key }) => (
            <Box key={key} sx={{ minWidth: 0, maxWidth: "100%", ...rise(delay + 60) }}>
              <AgentBlockRenderer block={block} />
            </Box>
          ))}
            {keyedAgentBlocks(blockModel.answerBlocks).map(({ block, key, order }) => {
              const imagePath = readOnlyImageToolPath(block);
              return (
                <Box key={key} sx={{ minWidth: 0, maxWidth: "100%", ...rise(delay + 80 + Math.min(order, 3) * 40) }}>
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
          {!live && blockModel.diffBlocks.length > 0 && <ChangedFilesAccordion blocks={blockModel.diffBlocks} delay={delay + 100} />}
          <MessageActionBar message={message} actions={actions ? { onCopy: actions.onCopy, onRetry: actions.onRetry, onFork: actions.onFork } : undefined} />
        </Box>
      </Stack>
      <ImageLightbox src={previewImage?.target ?? null} label={previewImage?.name} onClose={() => setPreviewImage(null)} />
    </>
  );
});

export function Message({
  message,
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
