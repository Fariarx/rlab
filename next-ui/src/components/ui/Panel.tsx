import { Box, Card, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

/**
 * Panel — the standard surface: a bordered card with an optional micro-label
 * header (title + adornment + actions) divided from the body. Wraps the repeated
 * panel chrome the dashboard hand-rolls so pages stay consistent.
 */
export interface PanelProps {
  readonly title?: ReactNode;
  /** Rendered next to the title — e.g. a <StatusDot/> or count. */
  readonly titleAdornment?: ReactNode;
  /** Rendered at the right edge of the header — e.g. buttons. */
  readonly actions?: ReactNode;
  /** `raised` sits one surface level brighter than the page. */
  readonly tone?: "default" | "raised";
  /** Tighter body padding for dense layouts. */
  readonly dense?: boolean;
  readonly children?: ReactNode;
  readonly className?: string;
}

export function Panel({
  title,
  titleAdornment,
  actions,
  tone = "default",
  dense = false,
  children,
  className,
}: PanelProps) {
  const hasHeader = title != null || titleAdornment != null || actions != null;
  const bodyPadding = dense ? 2 : 3;

  return (
    <Card
      className={className}
      sx={{
        backgroundColor: (theme) => (tone === "raised" ? theme.custom.surfaces.s3 : theme.palette.background.paper),
        overflow: "hidden",
      }}
    >
      {hasHeader && (
        <Stack
          direction="row"
          spacing={1}
          sx={{
            alignItems: "center",
            justifyContent: "space-between",
            px: bodyPadding,
            py: 1.5,
            borderBottom: (theme) => `1px solid ${theme.custom.borders.subtle}`,
          }}
        >
          <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
            {title != null && (
              <Typography variant="microLabel" component="span" sx={{ color: "text.secondary" }}>
                {title}
              </Typography>
            )}
            {titleAdornment}
          </Stack>
          {actions != null && (
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              {actions}
            </Stack>
          )}
        </Stack>
      )}
      <Box sx={{ p: bodyPadding }}>{children}</Box>
    </Card>
  );
}
