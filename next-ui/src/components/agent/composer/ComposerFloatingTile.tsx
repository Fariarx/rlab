import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import { Box } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import type { MouseEvent, ReactNode } from "react";
import { IconButton } from "../../ui";

const COMPOSER_TILE_SIZE = 76;

type Tone = "neutral" | "accent" | "warn" | "danger";

function statusKey(tone: Tone): "info" | "warn" | "error" | null {
  if (tone === "accent") {
    return "info";
  }
  if (tone === "warn") {
    return "warn";
  }
  if (tone === "danger") {
    return "error";
  }
  return null;
}

function tileBackground(theme: Theme, tone: Tone): string {
  const key = statusKey(tone);
  return key ? theme.palette.status[key].soft : theme.custom.surfaces.s2;
}

function tileBorder(theme: Theme, tone: Tone): string {
  const key = statusKey(tone);
  return key ? theme.palette.status[key].border : theme.custom.borders.strong;
}

function tileAccent(theme: Theme, tone: Tone): string {
  const key = statusKey(tone);
  return key ? theme.palette.status[key].main : theme.palette.text.secondary;
}

/**
 * FloatingTile — a square control that "floats" above the composer with the same
 * footprint as attachment tiles. Wakeups, modes, and review state use this shape
 * so the row reads as one tile strip. The icon sits in a tinted badge and the
 * whole tile carries a soft tone wash (not just an outline), so toned tiles read
 * as filled chips rather than hollow boxes.
 */
export function FloatingTile({
  icon,
  label,
  onRemove,
  removeLabel,
  onClick,
  disabled = false,
  tone = "neutral",
  testId,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  /** When omitted the tile has no close button (e.g. the read-only review tag). */
  readonly onRemove?: () => void;
  readonly removeLabel?: string;
  readonly onClick?: (event: MouseEvent<HTMLElement>) => void;
  readonly disabled?: boolean;
  readonly tone?: Tone;
  readonly testId?: string;
}) {
  const Component = onClick ? "button" : "span";
  return (
    <Box
      component={Component}
      type={onClick ? "button" : undefined}
      disabled={onClick ? disabled : undefined}
      data-testid={testId}
      onClick={onClick}
      sx={{
        pointerEvents: "auto",
        position: "relative",
        width: COMPOSER_TILE_SIZE,
        height: COMPOSER_TILE_SIZE,
        flex: `0 0 ${COMPOSER_TILE_SIZE}px`,
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: "space-between",
        gap: 0.5,
        p: 1,
        borderRadius: (theme) => `${theme.custom.radii.md}px`,
        fontSize: "0.7rem",
        fontWeight: 600,
        lineHeight: 1.2,
        textAlign: "left",
        fontFamily: "inherit",
        color: "text.primary",
        backgroundColor: (theme) => tileBackground(theme, tone),
        border: (theme) => `1px solid ${tileBorder(theme, tone)}`,
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.2)",
        transition: "transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease",
        cursor: onClick && !disabled ? "pointer" : "default",
        opacity: disabled ? 0.5 : 1,
        "&:hover": {
          boxShadow: disabled ? "0 1px 3px rgba(0, 0, 0, 0.2)" : "0 4px 12px rgba(0, 0, 0, 0.3)",
          transform: disabled ? "none" : "translateY(-1px)",
          borderColor: (theme) => (disabled ? tileBorder(theme, tone) : tileAccent(theme, tone)),
        },
      }}
    >
      <Box
        component="span"
        sx={{
          display: "inline-flex",
          flex: "0 0 auto",
          width: 26,
          height: 26,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: (theme) => `${theme.custom.radii.sm}px`,
          color: (theme) => tileAccent(theme, tone),
          backgroundColor: (theme) => (tone === "neutral" ? theme.custom.surfaces.s3 : "rgba(255, 255, 255, 0.06)"),
        }}
      >
        {icon}
      </Box>
      <Box
        component="span"
        sx={{
          minHeight: 0,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
          overflowWrap: "anywhere",
          color: "text.primary",
        }}
      >
        {label}
      </Box>
      {onRemove && (
        <IconButton
          aria-label={removeLabel ?? ""}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          sx={{
            position: "absolute",
            top: 3,
            right: 3,
            width: 20,
            height: 20,
            p: 0,
            color: "text.secondary",
            backgroundColor: (theme) => theme.custom.surfaces.s2,
            border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
            "&:hover": { backgroundColor: (theme) => theme.custom.surfaces.s4, color: "text.primary" },
          }}
        >
          <CloseRoundedIcon sx={{ fontSize: 14 }} />
        </IconButton>
      )}
    </Box>
  );
}
