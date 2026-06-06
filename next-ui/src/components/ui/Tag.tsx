import Chip, { type ChipProps } from "@mui/material/Chip";
import { styled } from "@mui/material/styles";
import { type StatusKey } from "../../theme/tokens";

/**
 * Tag — a status-aware Chip. Maps `status` to the kit's status palette (soft
 * tinted fill or muted outline), which MUI's `Chip color` prop can't express
 * without color augmentation. Falls back to a neutral chip when no status given.
 */
type TagTone = "soft" | "outline";

export interface TagProps extends Omit<ChipProps, "color" | "variant"> {
  readonly status?: StatusKey;
  readonly tone?: TagTone;
}

const StyledChip = styled(Chip, {
  shouldForwardProp: (prop) => prop !== "status" && prop !== "tone",
})<{ status?: StatusKey; tone: TagTone }>(({ theme, status, tone }) => {
  if (!status) {
    return {
      backgroundColor: theme.custom.surfaces.s3,
      color: theme.palette.text.secondary,
      border: `1px solid ${theme.custom.borders.subtle}`,
    };
  }

  const accent = theme.palette.status[status];
  return {
    color: accent.main,
    border: `1px solid ${accent.border}`,
    backgroundColor: tone === "outline" ? "transparent" : accent.soft,
    "& .MuiChip-deleteIcon": {
      color: accent.main,
      opacity: 0.7,
      "&:hover": { color: accent.main, opacity: 1 },
    },
  };
});

export function Tag({ status, tone = "soft", size = "small", ...rest }: TagProps) {
  return <StyledChip status={status} tone={tone} size={size} {...rest} />;
}
