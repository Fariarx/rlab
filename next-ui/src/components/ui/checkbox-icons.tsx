import { styled } from "@mui/material/styles";

/**
 * Rounded checkbox glyphs used as the MUI Checkbox icon/checkedIcon/
 * indeterminateIcon (wired up in app-theme defaultProps). Softer corners than
 * the default Material rect, with a tactile raised surface when unchecked.
 */
type GlyphVariant = "blank" | "checked" | "indeterminate";

const Glyph = styled("span", {
  shouldForwardProp: (prop) => prop !== "variant",
})<{ variant: GlyphVariant }>(({ theme, variant }) => {
  const filled = variant !== "blank";
  return {
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 18,
    height: 18,
    borderRadius: 7,
    transition: "background-color 120ms ease, border-color 120ms ease",
    border: `1.5px solid ${filled ? theme.palette.status.running.main : theme.custom.borders.strong}`,
    backgroundColor: filled ? theme.palette.status.running.main : theme.custom.surfaces.s3,
    color: "#ffffff",
  };
});

const Check = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M2.5 6.2 5 8.5 9.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Dash = styled("span")({
  width: 9,
  height: 2,
  borderRadius: 2,
  backgroundColor: "currentColor",
});

export const checkboxIcons = {
  icon: <Glyph variant="blank" />,
  checkedIcon: (
    <Glyph variant="checked">
      <Check />
    </Glyph>
  ),
  indeterminateIcon: (
    <Glyph variant="indeterminate">
      <Dash />
    </Glyph>
  ),
};
