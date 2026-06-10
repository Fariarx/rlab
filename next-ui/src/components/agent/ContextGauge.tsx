import { Box, CircularProgress, type SxProps, type Theme, Tooltip } from "@mui/material";
import type { MouseEvent } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { type ContextSeverity, contextSeverity } from "../../lib/model-context";

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
  readonly hitSize?: number;
  readonly ariaLabel?: string;
  readonly testId?: string;
  readonly onClick?: (event: MouseEvent<HTMLElement>) => void;
}

/** A small donut showing how full the conversation's context window is, sitting
 *  next to the composer options button. Neutral until ~80% full, amber past it,
 *  red (and pulsing) once the conversation has outgrown the window. The tooltip
 *  carries the exact figures; clicking opens the options menu. */
export function ContextGauge({ tokens, window, size = 22, hitSize = size, ariaLabel, testId = "context-gauge", onClick }: ContextGaugeProps) {
  const { t } = useI18n();
  const ratio = window > 0 ? tokens / window : 0;
  const severity = contextSeverity(ratio);
  const pct = Math.round(ratio * 100);
  const thickness = 4.5;
  const tooltip = `${t("contextUsage")} · ${pct}%`;
  const accessibleLabel = ariaLabel ?? tooltip;

  const fillSx: SxProps<Theme> = {
    position: "absolute",
    inset: 0,
    m: "auto",
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
        aria-label={accessibleLabel}
        onClick={onClick}
        data-testid={testId}
        data-severity={severity}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={(event) => {
          if (!onClick || (event.key !== "Enter" && event.key !== " ")) {
            return;
          }
          event.preventDefault();
          onClick(event as unknown as MouseEvent<HTMLElement>);
        }}
        sx={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "0 0 auto",
          width: hitSize,
          height: hitSize,
          cursor: onClick ? "pointer" : "default",
        }}
      >
        <CircularProgress
          variant="determinate"
          value={100}
          size={size}
          thickness={thickness}
          sx={{ position: "absolute", inset: 0, m: "auto", color: (theme) => theme.custom.borders.strong }}
        />
        <CircularProgress variant="determinate" value={Math.min(100, pct)} size={size} thickness={thickness} sx={fillSx} />
      </Box>
    </Tooltip>
  );
}
