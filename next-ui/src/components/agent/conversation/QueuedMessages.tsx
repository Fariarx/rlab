import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import ScheduleSendRoundedIcon from "@mui/icons-material/ScheduleSendRounded";
import { Box, Stack, Typography } from "@mui/material";
import { useI18n } from "../../../i18n/I18nProvider";
import { Button, IconButton, Tooltip } from "../../ui";
import type { ChatMessage } from "../core/types";

export interface QueuedMessagesProps {
  readonly messages: readonly ChatMessage[];
  readonly onCancel: (messageId: string) => void;
  readonly onSendNow: () => void;
}

/**
 * The list of user turns waiting for the active run to finish, docked just above
 * the composer. Each turn can be cancelled in place; the first can be sent now
 * (which interrupts the current run). Hidden when the queue is empty.
 */
export function QueuedMessages({ messages, onCancel, onSendNow }: QueuedMessagesProps) {
  const { t } = useI18n();
  if (messages.length === 0) {
    return null;
  }
  return (
    <Box
      data-testid="queued-messages"
      sx={{
        borderRadius: (theme) => `${theme.custom.radii.lg}px`,
        border: (theme) => `1px solid ${theme.palette.status.warn.border}`,
        backgroundColor: (theme) => theme.palette.status.warn.soft,
        overflow: "hidden",
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", px: 1.5, py: 0.75, borderBottom: (theme) => `1px solid ${theme.palette.status.warn.border}` }}
      >
        <ScheduleSendRoundedIcon sx={{ fontSize: 15, color: (theme) => theme.palette.status.warn.main, flex: "0 0 auto" }} />
        <Typography variant="microLabel" sx={{ color: (theme) => theme.palette.status.warn.main, flex: 1, minWidth: 0 }}>
          {t("queuedTitle", { count: messages.length })}
        </Typography>
        <Button variant="text" size="small" onClick={onSendNow} sx={{ minWidth: 0, color: (theme) => theme.palette.status.warn.main }}>
          {t("sendQueuedNow")}
        </Button>
      </Stack>
      <Stack sx={{ px: 0.75, py: 0.5 }} spacing={0.25}>
        {messages.map((message, index) => (
          <Stack
            key={message.id}
            direction="row"
            spacing={1}
            sx={{
              alignItems: "center",
              px: 0.75,
              py: 0.5,
              borderRadius: (theme) => `${theme.custom.radii.md}px`,
              "&:hover": { backgroundColor: (theme) => theme.custom.surfaces.s3 },
            }}
          >
            <Box
              component="span"
              sx={{
                flex: "0 0 auto",
                width: 18,
                height: 18,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "999px",
                fontFamily: (theme) => theme.custom.fonts.mono,
                fontSize: "0.62rem",
                fontWeight: 700,
                color: "text.secondary",
                backgroundColor: (theme) => theme.custom.surfaces.s3,
              }}
            >
              {index + 1}
            </Box>
            <Typography
              sx={{ flex: 1, minWidth: 0, fontSize: "0.82rem", color: "text.primary", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {(message.text ?? "").trim() || t("queuedEmptyTurn")}
            </Typography>
            <Tooltip title={t("cancelQueuedMessage")}>
              <IconButton
                aria-label={t("cancelQueuedMessage")}
                onClick={() => onCancel(message.id)}
                sx={{ flex: "0 0 auto", width: 24, height: 24, color: "text.secondary", "&:hover": { color: (theme) => theme.palette.status.error.main, backgroundColor: (theme) => theme.custom.surfaces.s3 } }}
              >
                <CloseRoundedIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}
