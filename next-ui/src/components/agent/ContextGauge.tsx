import { Box, CircularProgress, type SxProps, type Theme, Tooltip } from "@mui/material";
import type { MouseEvent } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { type ContextSeverity, contextSeverity, formatTokens } from "../../lib/model-context";

const FILL_COLOR: Record<ContextSeverity, (theme: Theme) => string> = {
  ok: (theme) => theme.palette.status.info.main,
  warn: (theme) => theme.palette.status.warn.main,
  full: (theme) => theme.palette.status.error.main,
};

export interface ContextGaugeProps {
  /** Tokens currently occupying the context window. */
  readonly tokens: number;
  /** The model's full context window size, in tokens. */
  readonly window: number;
  readonly size?: number;
  readonly onClick?: (event: MouseEvent<HTMLElement>) => void;
}

/** A small donut showing how full the conversation's context window is, sitting
 *  next to the composer options button. Neutral until ~80% full, amber past it,
 *  red (and pulsing) once the conversation has outgrown the window. The tooltip
 *  carries the exact figures; clicking opens the options menu. */
export function ContextGauge({ tokens, window, size = 22, onClick }: ContextGaugeProps) {
  const { t } = useI18n();
  const ratio = window > 0 ? tokens / window : 0;
  const severity = contextSeverity(ratio);
  const pct = Math.round(ratio * 100);
  const thickness = 4.5;
  const tooltip = `${t("contextUsage")}: ${formatTokens(tokens)} / ${formatTokens(window)} · ${pct}%`;

  const fillSx: SxProps<Theme> = {
    position: "absolute",
    left: 0,
    color: FILL_COLOR[severity],
    "& .MuiCircularProgress-circle": { strokeLinecap: "round" },
    ...(severity === "full"
      ? {
          animation: "contextGaugePulse 1.5s ease-in-out infinite",
          "@keyframes contextGaugePulse": { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.5 } },
        }
      : {}),
  };

  return (
    <Tooltip title={tooltip}>
      <Box
        role={onClick ? "button" : "img"}
        aria-label={tooltip}
        onClick={onClick}
        data-testid="context-gauge"
        data-severity={severity}
        sx={{
          position: "relative",
          display: "inline-flex",
          flex: "0 0 auto",
          width: size,
          height: size,
          cursor: onClick ? "pointer" : "default",
        }}
      >
        <CircularProgress
          variant="determinate"
          value={100}
          size={size}
          thickness={thickness}
          sx={{ position: "absolute", left: 0, color: (theme) => theme.custom.borders.strong }}
        />
        <CircularProgress variant="determinate" value={Math.min(100, pct)} size={size} thickness={thickness} sx={fillSx} />
      </Box>
    </Tooltip>
  );
}
