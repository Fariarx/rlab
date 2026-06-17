import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import { Box, Typography } from "@mui/material";
import type { MouseEvent, ReactNode } from "react";

export interface ComposerTagProps {
  readonly icon: ReactNode;
  readonly label: string;
  /** Optional trailing accessory (e.g. a file size), kept on one line. */
  readonly accessory?: ReactNode;
  /** When set, the icon+label area is a button (opens a preview/popover). */
  readonly onClick?: (event: MouseEvent<HTMLElement>) => void;
  readonly clickAriaLabel?: string;
  /** When set, a trailing × remove button is shown. */
  readonly onRemove?: () => void;
  readonly removeLabel?: string;
  readonly testId?: string;
  /** Attachment chips need the same inner air vertically and horizontally. */
  readonly equalPadding?: boolean;
}

/**
 * The compact pill shared by everything that floats above the composer —
 * attachments, scheduled wakeups, the review tag. One icon + an ellipsised
 * label (width-capped) + an optional accessory and an optional × button, so the
 * floating row reads as a single, consistently styled, wrapping tag strip.
 */
export function ComposerTag({ icon, label, accessory, onClick, clickAriaLabel, onRemove, removeLabel, testId, equalPadding = false }: ComposerTagProps) {
  return (
    <Box
      data-testid={testId}
      sx={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        maxWidth: 220,
        height: equalPadding ? "auto" : 28,
        minHeight: equalPadding ? 32 : undefined,
        pl: 0.875,
        pr: onRemove ? 0.25 : 0.875,
        py: equalPadding ? 0.875 : 0,
        flex: "0 0 auto",
        pointerEvents: "auto",
        borderRadius: (t) => `${t.custom.radii.md}px`,
        border: (t) => `1px solid ${t.custom.borders.strong}`,
        backgroundColor: (t) => t.custom.surfaces.s2,
      }}
    >
      <Box
        component={onClick ? "button" : "div"}
        type={onClick ? "button" : undefined}
        onClick={onClick}
        aria-label={onClick ? clickAriaLabel ?? label : undefined}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
          minWidth: 0,
          p: 0,
          border: 0,
          backgroundColor: "transparent",
          color: "inherit",
          font: "inherit",
          textAlign: "left",
          cursor: onClick ? "pointer" : "default",
        }}
      >
        <Box component="span" sx={{ flex: "0 0 auto", display: "inline-flex", alignItems: "center" }}>
          {icon}
        </Box>
        <Typography noWrap sx={{ minWidth: 0, fontSize: "0.76rem", fontWeight: 600, color: "text.primary" }}>
          {label}
        </Typography>
        {accessory}
      </Box>
      {onRemove && (
        <Box
          component="button"
          type="button"
          aria-label={removeLabel ?? ""}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          sx={{
            flex: "0 0 auto",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 20,
            height: 20,
            p: 0,
            border: 0,
            borderRadius: "50%",
            cursor: "pointer",
            color: "text.secondary",
            backgroundColor: "transparent",
            transition: "background-color 120ms ease, color 120ms ease",
            "&:hover": { color: "text.primary", backgroundColor: (t) => t.custom.surfaces.s3 },
          }}
        >
          <CloseRoundedIcon sx={{ fontSize: 14 }} />
        </Box>
      )}
    </Box>
  );
}
