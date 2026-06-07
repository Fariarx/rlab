import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import PsychologyIcon from "@mui/icons-material/Psychology";
import { Box, Collapse, Stack, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { shimmer } from "./anim";
import { TypingDots } from "./parts";
import type { ReasoningBlock } from "./types";

const ShimmerText = styled("span")(({ theme }) => ({
  fontFamily: theme.custom.fonts.mono,
  fontSize: "0.74rem",
  fontWeight: 600,
  letterSpacing: "0.04em",
  backgroundImage: `linear-gradient(90deg, ${theme.palette.text.secondary} 30%, ${theme.palette.status.running.main} 50%, ${theme.palette.text.secondary} 70%)`,
  backgroundSize: "200% 100%",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
  animation: `${shimmer} 2.4s linear infinite`,
}));

/**
 * Reasoning — the agent's thinking. Shows a live shimmer + dots while active,
 * otherwise a collapsed "Thought for …" summary that expands to the trace.
 */
export function Reasoning({ block }: { readonly block: ReasoningBlock }) {
  // Always start collapsed; only offer the toggle when there's a trace to show.
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  const hasBody = Boolean(block.text && block.text.trim().length > 0);

  return (
    <Box
      sx={{
        borderRadius: (t) => `${t.custom.radii.md}px`,
        border: (t) => `1px dashed ${t.custom.borders.subtle}`,
        backgroundColor: (t) => t.custom.surfaces.s1,
        overflow: "hidden",
      }}
    >
      <Stack
        direction="row"
        spacing={1.25}
        onClick={hasBody ? () => setOpen((v) => !v) : undefined}
        sx={{
          alignItems: "center",
          px: 1.5,
          py: 1,
          cursor: hasBody ? "pointer" : "default",
          ...(hasBody && { "&:hover": { backgroundColor: (t) => t.custom.surfaces.s3 } }),
        }}
      >
        <PsychologyIcon sx={{ fontSize: 16, color: "text.secondary" }} />
        {block.active ? (
          <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", flex: 1 }}>
            <ShimmerText>{t("thinking")}</ShimmerText>
            <TypingDots />
          </Stack>
        ) : (
          <Typography variant="microLabel" sx={{ color: "text.secondary", flex: 1 }}>
            {block.duration ? t("reasoningThoughtFor", { duration: block.duration }) : t("reasoning")}
          </Typography>
        )}
        {hasBody && (
          <KeyboardArrowDownIcon
            sx={{
              fontSize: 18,
              color: "text.secondary",
              transition: "transform 180ms ease",
              transform: open ? "rotate(180deg)" : "none",
            }}
          />
        )}
      </Stack>
      <Collapse in={open && hasBody} unmountOnExit>
        <Typography
          component="div"
          sx={{
            px: 1.5,
            pt: 1.5,
            pb: 1.5,
            borderTop: (t) => `1px dashed ${t.custom.borders.subtle}`,
            fontFamily: (t) => t.custom.fonts.mono,
            fontSize: "0.76rem",
            lineHeight: 1.7,
            color: "text.secondary",
            whiteSpace: "pre-line",
            fontStyle: "italic",
          }}
        >
          {block.text}
        </Typography>
      </Collapse>
    </Box>
  );
}
