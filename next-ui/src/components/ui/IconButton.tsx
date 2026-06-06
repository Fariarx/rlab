import MuiIconButton, { type IconButtonProps as MuiIconButtonProps } from "@mui/material/IconButton";
import { styled } from "@mui/material/styles";

/**
 * IconButton — a tone-aware icon button. `subtle` gives it a bordered surface
 * (use it as a standalone control), `danger` tints it for destructive actions.
 * The plain MUI IconButton (themed) is still available via the barrel as needed.
 */
export type IconButtonTone = "default" | "subtle" | "danger";

export interface IconButtonProps extends Omit<MuiIconButtonProps, "color"> {
  readonly tone?: IconButtonTone;
}

const Styled = styled(MuiIconButton, {
  shouldForwardProp: (prop) => prop !== "tone",
})<{ tone: IconButtonTone }>(({ theme, tone }) => {
  const base = { borderRadius: theme.custom.radii.sm };

  if (tone === "subtle") {
    return {
      ...base,
      color: theme.palette.text.secondary,
      backgroundColor: theme.custom.surfaces.s2,
      border: `1px solid ${theme.custom.borders.subtle}`,
      "&:hover": {
        backgroundColor: theme.custom.surfaces.s3,
        borderColor: theme.custom.borders.strong,
        color: theme.palette.text.primary,
      },
    };
  }

  if (tone === "danger") {
    const error = theme.palette.status.error;
    return {
      ...base,
      color: error.main,
      "&:hover": { backgroundColor: error.soft },
    };
  }

  return {
    ...base,
    color: theme.palette.text.secondary,
    "&:hover": { backgroundColor: theme.custom.surfaces.s3, color: theme.palette.text.primary },
  };
});

export function IconButton({ tone = "default", size = "small", ...rest }: IconButtonProps) {
  return <Styled tone={tone} size={size} {...rest} />;
}
