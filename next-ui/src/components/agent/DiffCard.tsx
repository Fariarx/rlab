import AccountTreeIcon from "@mui/icons-material/AccountTree";
import DescriptionIcon from "@mui/icons-material/Description";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import UndoIcon from "@mui/icons-material/Undo";
import { Box, Collapse, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { IconButton, Tooltip } from "../ui";
import { type DiffBlock } from "./types";

const signPrefix = { add: "+", del: "-", ctx: " " } as const;

/** DiffCard — a file edit with +/- counts and a collapsible hunk preview. When
 *  `onRevert`/`onOpenInGit` are provided the header gains inline actions (used
 *  for diffs surfaced directly under an agent message). */
export function DiffCard({
  block,
  onRevert,
  onOpenInGit,
}: {
  readonly block: DiffBlock;
  readonly onRevert?: () => void;
  readonly onOpenInGit?: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);

  return (
    <Box
      sx={{
        borderRadius: (t) => `${t.custom.radii.md}px`,
        border: (t) => `1px solid ${t.custom.borders.subtle}`,
        backgroundColor: (t) => t.custom.surfaces.s2,
        overflow: "hidden",
      }}
    >
      <Stack
        direction="row"
        spacing={1.25}
        onClick={() => setOpen((v) => !v)}
        sx={{ alignItems: "center", px: 1.5, py: 1, cursor: "pointer", "&:hover": { backgroundColor: (t) => t.custom.surfaces.s3 } }}
      >
        <DescriptionIcon sx={{ fontSize: 16, color: "text.secondary" }} />
        <Typography component="span" sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.8rem", fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {block.file}
        </Typography>
        <Typography component="span" sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.72rem", color: (t) => t.palette.status.ok.main }}>
          +{block.additions}
        </Typography>
        <Typography component="span" sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.72rem", color: (t) => t.palette.status.error.main }}>
          −{block.deletions}
        </Typography>
        {(onRevert || onOpenInGit) && (
          <Stack direction="row" spacing={0.25} sx={{ flex: "0 0 auto" }} onClick={(event) => event.stopPropagation()}>
            {onOpenInGit && (
              <Tooltip title={t("diffOpenInGit")}>
                <IconButton aria-label={t("diffOpenInGit")} onClick={onOpenInGit} sx={{ p: 0.5 }}>
                  <AccountTreeIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </Tooltip>
            )}
            {onRevert && (
              <Tooltip title={t("diffRevert")}>
                <IconButton aria-label={t("diffRevert")} onClick={onRevert} sx={{ p: 0.5 }}>
                  <UndoIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        )}
        <KeyboardArrowDownIcon sx={{ fontSize: 18, color: "text.secondary", transition: "transform 180ms ease", transform: open ? "rotate(180deg)" : "none" }} />
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ borderTop: (t) => `1px solid ${t.custom.borders.subtle}`, backgroundColor: (t) => t.custom.surfaces.s1, py: 0.5 }}>
          {block.lines.map((line, index) => (
            <Box
              key={index}
              sx={{
                display: "flex",
                px: 1.5,
                fontFamily: (t) => t.custom.fonts.mono,
                fontSize: "0.74rem",
                lineHeight: 1.7,
                whiteSpace: "pre",
                color: (t) =>
                  line.type === "add"
                    ? t.palette.status.ok.main
                    : line.type === "del"
                      ? t.palette.status.error.main
                      : t.palette.text.secondary,
                backgroundColor: (t) =>
                  line.type === "add" ? t.palette.status.ok.soft : line.type === "del" ? t.palette.status.error.soft : "transparent",
              }}
            >
              <Box component="span" sx={{ width: 14, flex: "0 0 auto", opacity: 0.7 }}>
                {signPrefix[line.type]}
              </Box>
              <Box component="span">{line.text}</Box>
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}
