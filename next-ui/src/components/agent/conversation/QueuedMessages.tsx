import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import PauseRoundedIcon from "@mui/icons-material/PauseRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import ScheduleSendRoundedIcon from "@mui/icons-material/ScheduleSendRounded";
import { Box, Stack, Typography } from "@mui/material";
import { useI18n } from "../../../i18n/I18nProvider";
import { Button, IconButton, Tooltip } from "../../ui";
import type { ChatMessage } from "../core/types";

export interface QueuedMessagesProps {
  readonly messages: readonly ChatMessage[];
  readonly paused: boolean;
  readonly onCancel: (messageId: string) => void;
  readonly onCopy: (message: ChatMessage) => void;
  readonly onSendNow: () => void;
  readonly onTogglePause: () => void;
}

const queuedActionButtonSx = {
  flex: "0 0 auto",
  width: 22,
  height: 22,
  color: "text.secondary",
} as const;

const QUEUED_VISIBLE_ROW_COUNT = 5;
const QUEUED_ROW_HEIGHT_PX = 30;

/**
 * The list of user turns waiting for the active run to finish, docked just above
 * the composer. Each turn can be copied or cancelled in place; the first can be
 * sent now (which interrupts the current run). The whole queue can be paused so
 * settled runs don't auto-dispatch the next turn. Hidden when the queue is empty.
 */
export function QueuedMessages({ messages, paused, onCancel, onCopy, onSendNow, onTogglePause }: QueuedMessagesProps) {
  const { t } = useI18n();
  if (messages.length === 0) {
    return null;
  }
  const scrollable = messages.length > QUEUED_VISIBLE_ROW_COUNT;
  return (
    <Box
      data-testid="queued-messages"
      sx={{
        width: "100%",
        borderRadius: (theme) => `${theme.custom.radii.lg}px`,
        border: (theme) => `1px solid ${theme.custom.borders.strong}`,
        backgroundColor: (theme) => theme.custom.surfaces.s2,
        boxShadow: "0 -10px 28px rgba(0, 0, 0, 0.3)",
        overflow: "hidden",
      }}
    >
      <Stack
        direction="row"
        spacing={0.75}
        sx={{ alignItems: "center", px: 1.25, py: 0.35, borderBottom: (theme) => `1px solid ${theme.custom.borders.subtle}` }}
      >
        <ScheduleSendRoundedIcon sx={{ fontSize: 14, color: (theme) => theme.palette.status.warn.main, flex: "0 0 auto" }} />
        <Typography variant="microLabel" sx={{ color: "text.secondary", flex: 1, minWidth: 0 }}>
          {paused ? t("queuedPausedTitle", { count: messages.length }) : t("queuedTitle", { count: messages.length })}
        </Typography>
        <Button
          variant="text"
          size="small"
          onClick={onTogglePause}
          startIcon={paused ? <PlayArrowRoundedIcon sx={{ fontSize: 16 }} /> : <PauseRoundedIcon sx={{ fontSize: 16 }} />}
          sx={{ minWidth: 0, color: "text.secondary" }}
        >
          {paused ? t("resumeQueue") : t("pauseQueue")}
        </Button>
        <Button variant="text" size="small" onClick={onSendNow} sx={{ minWidth: 0, color: "text.secondary" }}>
          {t("sendQueuedNow")}
        </Button>
      </Stack>
      <Stack
        data-testid="queued-messages-list"
        data-scrollable={scrollable ? "true" : undefined}
        sx={{
          px: 0.5,
          py: 0.25,
          maxHeight: scrollable ? QUEUED_VISIBLE_ROW_COUNT * QUEUED_ROW_HEIGHT_PX : "none",
          overflowY: scrollable ? "auto" : "visible",
          overscrollBehavior: "contain",
          scrollbarGutter: scrollable ? "stable" : "auto",
        }}
      >
        {messages.map((message, index) => (
          <Stack
            key={message.id}
            direction="row"
            spacing={0.75}
            sx={{
              alignItems: "center",
              minHeight: QUEUED_ROW_HEIGHT_PX,
              px: 0.75,
              py: 0.25,
              borderRadius: (theme) => `${theme.custom.radii.md}px`,
              "&:hover": { backgroundColor: (theme) => theme.custom.surfaces.s3 },
              "& .queued-actions": { opacity: 0, transition: "opacity 120ms ease", "@media (hover: none)": { opacity: 1 } },
              "&:hover .queued-actions, &:focus-within .queued-actions": { opacity: 1 },
            }}
          >
            <Box
              component="span"
              sx={{
                flex: "0 0 auto",
                width: 17,
                height: 17,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "999px",
                fontFamily: (theme) => theme.custom.fonts.mono,
                fontSize: "0.6rem",
                fontWeight: 700,
                color: "text.secondary",
                backgroundColor: (theme) => theme.custom.surfaces.s3,
              }}
            >
              {index + 1}
            </Box>
            <Typography
              sx={{ flex: 1, minWidth: 0, fontSize: "0.8rem", color: "text.primary", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {(message.text ?? "").trim() || t("queuedEmptyTurn")}
            </Typography>
            <Stack className="queued-actions" direction="row" spacing={0.25} sx={{ flex: "0 0 auto", alignItems: "center" }}>
              <Tooltip title={t("copyQueuedMessage")}>
                <IconButton
                  aria-label={t("copyQueuedMessage")}
                  onClick={() => onCopy(message)}
                  sx={{ ...queuedActionButtonSx, "&:hover": { color: "text.primary", backgroundColor: (theme) => theme.custom.surfaces.s4 } }}
                >
                  <ContentCopyRoundedIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t("cancelQueuedMessage")}>
                <IconButton
                  aria-label={t("cancelQueuedMessage")}
                  onClick={() => onCancel(message.id)}
                  sx={{ ...queuedActionButtonSx, "&:hover": { color: (theme) => theme.palette.status.error.main, backgroundColor: (theme) => theme.custom.surfaces.s4 } }}
                >
                  <CloseRoundedIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            </Stack>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}
