import { Box } from "@mui/material";

export interface TagOption {
  readonly id: string;
  readonly label: string;
}

/**
 * TagSelect — a single-choice selector rendered as wrapping pill "tags" (the
 * agent-picker style). Uses flex `gap` (not Stack spacing) so wrapped rows keep
 * an even gap with no extra leading indent.
 */
export function TagSelect({
  value,
  options,
  onSelect,
  ariaLabel,
}: {
  readonly value: string;
  readonly options: readonly TagOption[];
  readonly onSelect: (id: string) => void;
  readonly ariaLabel?: string;
}) {
  return (
    <Box role="group" aria-label={ariaLabel} sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
      {options.map((option) => {
        const on = option.id === value;
        return (
          <Box
            key={option.id}
            component="button"
            type="button"
            aria-pressed={on}
            onClick={() => onSelect(option.id)}
            sx={{
              px: 1.25,
              py: 0.5,
              borderRadius: (t) => `${t.custom.radii.pill}px`,
              cursor: "pointer",
              font: "inherit",
              fontFamily: (t) => t.custom.fonts.mono,
              fontSize: "0.72rem",
              fontWeight: 600,
              whiteSpace: "nowrap",
              color: (t) => (on ? t.palette.status.running.main : t.palette.text.secondary),
              border: (t) => `1px solid ${on ? t.palette.status.running.border : t.custom.borders.subtle}`,
              backgroundColor: (t) => (on ? t.palette.status.running.soft : t.custom.surfaces.s2),
              transition: "all 140ms ease",
              "&:hover": { borderColor: (t) => t.custom.borders.strong },
              "&:focus-visible": {
                outline: (t) => `2px solid ${t.custom.borders.focus}`,
                outlineOffset: 2,
              },
            }}
          >
            {option.label}
          </Box>
        );
      })}
    </Box>
  );
}
