import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import PauseRoundedIcon from "@mui/icons-material/PauseRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import ScheduleSendRoundedIcon from "@mui/icons-material/ScheduleSendRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
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

const queuedHeaderButtonSx = {
  minWidth: { xs: 28, sm: 0 },
  width: { xs: 28, sm: "auto" },
  height: { xs: 28, sm: 26 },
  px: { xs: 0, sm: 1 },
  color: "text.secondary",
  whiteSpace: "nowrap",
  lineHeight: 1.15,
  "& .MuiButton-startIcon": {
    margin: { xs: 0, sm: "0 6px 0 -2px" },
  },
  "& .queued-header-button-label": {
    display: { xs: "none", sm: "inline" },
  },
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
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "minmax(0, 1fr) 28px 28px", sm: "minmax(0, 1fr) auto auto" },
          gridTemplateAreas: '"title pause send"',
          alignItems: "center",
          columnGap: { xs: 0.35, sm: 0.5 },
          px: { xs: 1, sm: 1.25 },
          py: { xs: 0.45, sm: 0.35 },
          borderBottom: (theme) => `1px solid ${theme.custom.borders.subtle}`,
        }}
      >
        <Stack direction="row" spacing={0.75} sx={{ gridArea: "title", alignItems: "center", minWidth: 0, alignSelf: "center" }}>
          <ScheduleSendRoundedIcon sx={{ fontSize: 14, color: (theme) => theme.palette.status.warn.main, flex: "0 0 auto" }} />
          <Typography variant="microLabel" noWrap sx={{ color: "text.secondary", minWidth: 0 }}>
            {paused ? t("queuedPausedTitle", { count: messages.length }) : t("queuedTitle", { count: messages.length })}
          </Typography>
        </Stack>
        <Button
          variant="text"
          size="small"
          onClick={onTogglePause}
          aria-label={paused ? t("resumeQueue") : t("pauseQueue")}
          startIcon={paused ? <PlayArrowRoundedIcon sx={{ fontSize: 16 }} /> : <PauseRoundedIcon sx={{ fontSize: 16 }} />}
          sx={{
            ...queuedHeaderButtonSx,
            gridArea: "pause",
            justifySelf: { xs: "end", sm: "start" },
            alignSelf: "center",
          }}
        >
          <Box component="span" className="queued-header-button-label">
            {paused ? t("resumeQueue") : t("pauseQueue")}
          </Box>
        </Button>
        <Button
          variant="text"
          size="small"
          onClick={onSendNow}
          aria-label={t("sendQueuedNow")}
          startIcon={<SendRoundedIcon sx={{ fontSize: 16 }} />}
          sx={{
            ...queuedHeaderButtonSx,
            gridArea: "send",
            justifySelf: "end",
            alignSelf: "center",
          }}
        >
          <Box component="span" className="queued-header-button-label">
            {t("sendQueuedNow")}
          </Box>
        </Button>
      </Box>
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
