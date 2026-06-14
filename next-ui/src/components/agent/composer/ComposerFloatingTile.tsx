import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import { Box } from "@mui/material";
import type { ReactNode } from "react";
import { IconButton } from "../../ui";

const COMPOSER_TILE_SIZE = 76;

/**
 * FloatingTile — a square control that "floats" above the composer with the
 * same footprint as attachment tiles. Wakeups, modes, review state, and context
 * warnings all use this shape so the row reads as one tile strip.
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
  /** When omitted the tag has no close button (e.g. the read-only review tag). */
  readonly onRemove?: () => void;
  readonly removeLabel?: string;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  readonly tone?: "neutral" | "accent" | "warn" | "danger";
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
        p: 0.75,
        borderRadius: (t) => `${t.custom.radii.md}px`,
        fontSize: "0.68rem",
        fontWeight: 600,
        lineHeight: 1.18,
        textAlign: "left",
        fontFamily: "inherit",
        color: "text.primary",
        backgroundColor: (t) => t.custom.surfaces.s3,
        border: (t) => {
          if (tone === "danger") {
            return `1px solid ${t.palette.status.error.main}`;
          }
          if (tone === "warn") {
            return `1px solid ${t.palette.status.warn.main}`;
          }
          if (tone === "accent") {
            return `1px solid ${t.palette.status.info.main}`;
          }
          return `1px solid ${t.custom.borders.strong}`;
        },
        boxShadow: "0 1px 4px rgba(0, 0, 0, 0.18)",
        transition: "transform 120ms ease, box-shadow 120ms ease",
        cursor: onClick && !disabled ? "pointer" : "default",
        opacity: disabled ? 0.5 : 1,
        "&:hover": {
          boxShadow: disabled ? "0 1px 4px rgba(0, 0, 0, 0.18)" : "0 2px 6px rgba(0, 0, 0, 0.24)",
          transform: disabled ? "none" : "translateY(-1px)",
        },
      }}
    >
      <Box
        component="span"
        sx={{
          display: "inline-flex",
          flex: "0 0 auto",
          color: (t) => {
            if (tone === "danger") {
              return t.palette.status.error.main;
            }
            if (tone === "warn") {
              return t.palette.status.warn.main;
            }
            if (tone === "accent") {
              return t.palette.status.info.main;
            }
            return t.palette.text.secondary;
          },
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
          WebkitLineClamp: 3,
          overflowWrap: "anywhere",
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
            backgroundColor: (t) => t.custom.surfaces.s2,
            border: (t) => `1px solid ${t.custom.borders.subtle}`,
            "&:hover": { backgroundColor: (t) => t.custom.surfaces.s4, color: "text.primary" },
          }}
        >
          <CloseRoundedIcon sx={{ fontSize: 14 }} />
        </IconButton>
      )}
    </Box>
  );
}
