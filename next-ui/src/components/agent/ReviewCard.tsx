import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import RateReviewOutlinedIcon from "@mui/icons-material/RateReviewOutlined";
import { Box, Collapse, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { ReviewBlock } from "./types";

/** ReviewCard — a collapsible block summarising the diff-line comments a user
 *  sent to the agent (one block per batch). Collapsed by default. */
export function ReviewCard({ block }: { readonly block: ReviewBlock }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const count = block.comments.length;

  return (
    <Box
      sx={{
        width: "min(520px, 100%)",
        borderRadius: (theme) => `${theme.custom.radii.md}px`,
        border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
        backgroundColor: (theme) => theme.custom.surfaces.s2,
        overflow: "hidden",
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        onClick={() => setOpen((value) => !value)}
        sx={{ alignItems: "center", px: 1.5, py: 1, cursor: "pointer", "&:hover": { backgroundColor: (theme) => theme.custom.surfaces.s3 } }}
      >
        <RateReviewOutlinedIcon sx={{ fontSize: 16, color: (theme) => theme.palette.status.info.main, flex: "0 0 auto" }} />
        <Typography sx={{ flex: 1, minWidth: 0, fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.8rem", fontWeight: 600 }}>
          {t("reviewComments", { count })}
        </Typography>
        <KeyboardArrowDownIcon sx={{ fontSize: 18, color: "text.secondary", flex: "0 0 auto", transition: "transform 180ms ease", transform: open ? "rotate(180deg)" : "none" }} />
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Stack spacing={1} sx={{ px: 1.5, py: 1.25, borderTop: (theme) => `1px solid ${theme.custom.borders.subtle}` }}>
          {block.comments.map((comment) => (
            <Box key={comment.id}>
              <Typography sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.7rem", color: (theme) => theme.palette.status.info.main }}>
                {comment.file}:{comment.line}
              </Typography>
              <Typography sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.7rem", color: "text.tertiary", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {comment.lineText}
              </Typography>
              <Typography sx={{ fontSize: "0.82rem", color: "text.primary", whiteSpace: "pre-wrap", overflowWrap: "anywhere", mt: 0.25 }}>
                {comment.body}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Collapse>
    </Box>
  );
}
