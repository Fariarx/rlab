import { styled } from "@mui/material/styles";
import { Fragment, type ReactNode } from "react";

/**
 * KeyHint — keyboard-shortcut affordance rendered as monospace key caps
 * (e.g. `⌘ K`, `Ctrl C`).
 */
interface KeyHintProps {
  /** A single key (`"⌘"`) or an ordered chord (`["Ctrl", "C"]`). */
  readonly keys: string | readonly string[];
  /** Optional glyph drawn between caps. Omit for a clean gap-only look. */
  readonly separator?: ReactNode;
  readonly className?: string;
}

const Row = styled("span")({
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  verticalAlign: "middle",
});

const Cap = styled("kbd")(({ theme }) => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 20,
  height: 20,
  padding: "0 6px",
  fontFamily: theme.custom.fonts.mono,
  fontSize: "0.68rem",
  fontWeight: 600,
  lineHeight: 1,
  color: theme.palette.text.secondary,
  backgroundColor: theme.custom.surfaces.s3,
  border: `1px solid ${theme.custom.borders.subtle}`,
  borderRadius: theme.custom.radii.sm,
  boxShadow: `inset 0 -1px 0 ${theme.custom.borders.subtle}`,
}));

const Separator = styled("span")(({ theme }) => ({
  fontFamily: theme.custom.fonts.mono,
  fontSize: "0.68rem",
  color: theme.palette.status.idle.main,
}));

export function KeyHint({ keys, separator, className }: KeyHintProps) {
  const caps = typeof keys === "string" ? [keys] : keys;

  return (
    <Row className={className}>
      {caps.map((cap, index) => (
        <Fragment key={`${cap}-${index}`}>
          {index > 0 && separator != null && <Separator>{separator}</Separator>}
          <Cap>{cap}</Cap>
        </Fragment>
      ))}
    </Row>
  );
}
