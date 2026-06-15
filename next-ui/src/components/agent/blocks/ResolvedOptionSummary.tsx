import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlineRounded";
import { Box, Stack, Typography } from "@mui/material";
import { useI18n } from "../../../i18n/I18nProvider";
import type { OptionsBlock } from "../core/types";

/** Compact, single-line recap of an already-answered question. Shown inside the
 *  collapsed reasoning container so a resolved prompt no longer takes up a full
 *  interactive card at the bottom of the thread. */
export function ResolvedOptionSummary({ block }: { readonly block: OptionsBlock }) {
  const { t } = useI18n();
  const selected = block.selected ?? [];
  // `selected` carries the chosen labels, but tolerate ids too (older payloads).
  const matchedLabels = block.options.filter((option) => selected.some((value) => value === option.id || value === option.label)).map((option) => option.label);
  const chosen = matchedLabels.length > 0 ? matchedLabels : [...selected];

  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline", minWidth: 0 }}>
      <CheckCircleOutlineIcon sx={{ fontSize: 14, color: (theme) => theme.palette.status.ok.main, flex: "0 0 auto", transform: "translateY(2px)" }} />
      <Typography
        component="div"
        sx={{ fontSize: "0.76rem", lineHeight: 1.7, color: "text.secondary", minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word" }}
      >
        <Box component="span" sx={{ color: "text.primary" }}>
          {block.prompt}
        </Box>
        <Box component="span" sx={{ mx: 0.75, color: "text.secondary", opacity: 0.6 }}>
          →
        </Box>
        <Box component="span" sx={{ color: "text.secondary" }}>
          {t("selectedOptions", { items: chosen.join(", ") })}
        </Box>
      </Typography>
    </Stack>
  );
}
