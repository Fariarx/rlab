import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { Box, ButtonBase, Collapse, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useId, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import { DiffCard } from "../blocks/DiffCard";
import { ToggleStore } from "../stores/agent-local-stores";
import { rise } from "../core/anim";
import { keyedAgentBlocks } from "./message-block-keys";
import { diffTotals } from "./message-block-model";
import type { DiffBlock } from "../core/types";

export const ChangedFilesAccordion = observer(function ChangedFilesAccordion({
  blocks,
  delay,
}: {
  readonly blocks: readonly DiffBlock[];
  readonly delay: number;
}) {
  const [store] = useState(() => new ToggleStore());
  const { open, setOpen } = store;
  const panelId = useId();
  const { t } = useI18n();
  const totals = diffTotals(blocks);

  return (
    <Box
      sx={{
        mt: 1.25,
        borderRadius: (theme) => `${theme.custom.radii.md}px`,
        border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
        backgroundColor: (theme) => (theme.palette.mode === "dark" ? "rgba(0, 0, 0, 0.3)" : "rgba(17, 24, 39, 0.06)"),
        boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.02)",
        overflow: "clip",
        ...rise(delay),
      }}
      data-testid="changed-files-accordion"
    >
      <ButtonBase
        aria-controls={panelId}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          width: "100%",
          px: 1.5,
          py: 1,
          textAlign: "left",
          backgroundColor: "transparent",
          "&:hover": {
            backgroundColor: (theme) => (theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.035)" : "rgba(17, 24, 39, 0.08)"),
          },
        }}
        type="button"
      >
        <DescriptionOutlinedIcon sx={{ fontSize: 16, color: "text.secondary", flex: "0 0 auto" }} />
        <Typography variant="microLabel" sx={{ color: "text.secondary", flex: 1, minWidth: 0 }}>
          {t("gitChanges")}
        </Typography>
        <Typography component="span" sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.68rem", color: "text.tertiary", flex: "0 0 auto" }}>
          {t("gitChangedFilesCount", { count: blocks.length })}
        </Typography>
        {(totals.additions > 0 || totals.deletions > 0) && (
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flex: "0 0 auto", fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.72rem", fontWeight: 700 }}>
            {totals.additions > 0 && <Box component="span" sx={{ color: (theme) => theme.palette.status.ok.main }}>+{totals.additions}</Box>}
            {totals.deletions > 0 && <Box component="span" sx={{ color: (theme) => theme.palette.status.error.main }}>−{totals.deletions}</Box>}
          </Stack>
        )}
        <KeyboardArrowDownIcon sx={{ fontSize: 18, color: "text.secondary", transition: "transform 180ms ease", transform: open ? "rotate(180deg)" : "none", flex: "0 0 auto" }} />
      </ButtonBase>
      <Collapse in={open} unmountOnExit>
        <Stack
          id={panelId}
          spacing={1}
          sx={{
            px: 1,
            py: 1,
            borderTop: (theme) => `1px solid ${theme.custom.borders.subtle}`,
            backgroundColor: (theme) => (theme.palette.mode === "dark" ? "rgba(0, 0, 0, 0.22)" : "rgba(17, 24, 39, 0.045)"),
          }}
        >
          {keyedAgentBlocks(blocks).map(({ block, key, order }) => (
            <Box key={key} sx={rise(Math.min(order, 3) * 40)}>
              <DiffCard block={block} />
            </Box>
          ))}
        </Stack>
      </Collapse>
    </Box>
  );
});
