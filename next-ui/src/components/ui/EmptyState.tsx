import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

/**
 * EmptyState — an empty placeholder: a dashed, muted frame with a monospace
 * title, optional description, and an optional action. Reads as intentionally
 * empty rather than broken.
 */
export interface EmptyStateProps {
  readonly icon?: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <Stack
      className={className}
      spacing={1.5}
      sx={{
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        px: 3,
        py: 5,
        borderRadius: (theme) => `${theme.custom.radii.lg}px`,
        border: (theme) => `1px dashed ${theme.custom.borders.strong}`,
        color: "text.secondary",
      }}
    >
      {icon != null && <Box sx={{ color: (theme) => theme.palette.status.idle.main, display: "flex" }}>{icon}</Box>}
      <Typography
        component="span"
        sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.95rem", color: "text.primary" }}
      >
        {title}
      </Typography>
      {description != null && (
        <Typography variant="body2" sx={{ maxWidth: 360, color: "text.secondary" }}>
          {description}
        </Typography>
      )}
      {action != null && <Box sx={{ mt: 0.5 }}>{action}</Box>}
    </Stack>
  );
}
