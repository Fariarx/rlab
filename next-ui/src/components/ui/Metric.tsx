import { Box, Stack, Typography } from "@mui/material";
import { type ReactNode } from "react";
import { type StatusKey } from "../../theme/tokens";

/**
 * Metric — a micro-labelled headline number rendered in monospace (the `68%`
 * pattern). Optional delta and status color make it read at a glance.
 */
type DeltaDirection = "up" | "down" | "flat";

export interface MetricProps {
  readonly label: ReactNode;
  readonly value: ReactNode;
  readonly unit?: ReactNode;
  readonly delta?: { readonly value: ReactNode; readonly direction: DeltaDirection };
  /** Tints the value; defaults to primary text. */
  readonly status?: StatusKey;
}

const deltaGlyph: Record<DeltaDirection, string> = {
  up: "▲",
  down: "▼",
  flat: "→",
};

const deltaStatus: Record<DeltaDirection, StatusKey> = {
  up: "ok",
  down: "error",
  flat: "idle",
};

export function Metric({ label, value, unit, delta, status }: MetricProps) {
  return (
    <Stack spacing={0.75}>
      <Typography variant="microLabel" component="span" sx={{ color: "text.secondary" }}>
        {label}
      </Typography>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline" }}>
        <Typography
          component="span"
          sx={{
            fontFamily: (theme) => theme.custom.fonts.mono,
            fontSize: "1.85rem",
            fontWeight: 700,
            lineHeight: 1,
            color: status ? (theme) => theme.palette.status[status].main : "text.primary",
          }}
        >
          {value}
        </Typography>
        {unit != null && (
          <Typography
            component="span"
            sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.85rem", color: "text.secondary" }}
          >
            {unit}
          </Typography>
        )}
        {delta != null && (
          <Box
            component="span"
            sx={{
              ml: 0.5,
              fontFamily: (theme) => theme.custom.fonts.mono,
              fontSize: "0.75rem",
              fontWeight: 600,
              color: (theme) => theme.palette.status[deltaStatus[delta.direction]].main,
            }}
          >
            {deltaGlyph[delta.direction]} {delta.value}
          </Box>
        )}
      </Stack>
    </Stack>
  );
}
