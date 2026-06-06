import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import EditIcon from "@mui/icons-material/Edit";
import ReplayIcon from "@mui/icons-material/Replay";
import SendIcon from "@mui/icons-material/Send";
import CloseIcon from "@mui/icons-material/Close";
import { Box, Stack, Typography } from "@mui/material";
import { type ChangeEvent, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, IconButton, Tooltip } from "../ui";
import { AgentBlockRenderer } from "./AgentBlockRenderer";
import { rise } from "./anim";
import { type MessageActionHandlers } from "./message-actions";
import { AgentAvatar, UserAvatar } from "./parts";
import { type ChatMessage } from "./types";

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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.text ?? "");
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
              {message.text}
            </Typography>
          </Box>
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

function AgentMessage({ message, delay, actions }: { readonly message: ChatMessage; readonly delay: number; readonly actions?: MessageActionHandlers }) {
  const { t } = useI18n();
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
        </Stack>
        <Stack spacing={1.25}>
          {message.blocks?.map((block, index) => (
            <Box key={index} sx={rise(delay + 120 + index * 90)}>
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
