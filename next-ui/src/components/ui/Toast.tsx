import CloseIcon from "@mui/icons-material/Close";
import { Box, IconButton, Stack } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { ReactNode } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { StatusKey } from "../../theme/tokens";

/**
 * Toast — the presentational notification card used by ToastProvider. A
 * left-accented monospace surface tinted by severity. Not meant to be used
 * directly; reach for `useToast()` instead.
 */
export type ToastSeverity = "info" | "success" | "warning" | "error";

export interface ToastProps {
  readonly severity?: ToastSeverity;
  readonly message: ReactNode;
  readonly action?: ReactNode;
  readonly onClose?: () => void;
}

const severityStatus: Record<ToastSeverity, StatusKey> = {
  info: "info",
  success: "ok",
  warning: "warn",
  error: "error",
};

const Surface = styled("div", {
  shouldForwardProp: (prop) => prop !== "severity",
})<{ severity: ToastSeverity }>(({ theme, severity }) => {
  const accent = theme.palette.status[severityStatus[severity]];
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 280,
    maxWidth: 420,
    padding: "10px 14px",
    backgroundColor: theme.custom.surfaces.s2,
    border: `1px solid ${theme.custom.borders.subtle}`,
    borderLeft: `3px solid ${accent.main}`,
    borderRadius: theme.custom.radii.lg,
    boxShadow: "0 12px 32px rgba(0, 0, 0, 0.32)",
    fontFamily: theme.custom.fonts.mono,
    fontSize: "0.8rem",
    color: theme.palette.text.primary,
  };
});

export function Toast({ severity = "info", message, action, onClose }: ToastProps) {
  const { t } = useI18n();

  return (
    <Surface severity={severity} role="status">
      <Box sx={{ flex: 1, minWidth: 0, lineHeight: 1.5, whiteSpace: "pre-line" }}>{message}</Box>
      {(action != null || onClose != null) && (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", flex: "0 0 auto" }}>
          {action}
          {onClose != null && (
            <IconButton size="small" onClick={onClose} aria-label={t("dismissNotification")} sx={{ color: "text.secondary" }}>
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          )}
        </Stack>
      )}
    </Surface>
  );
}
