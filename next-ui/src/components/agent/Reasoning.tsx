import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import PsychologyIcon from "@mui/icons-material/Psychology";
import { Box, Collapse, Stack, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useState } from "react";
import { shimmer } from "./anim";
import { TypingDots } from "./parts";
import { type ReasoningBlock } from "./types";

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
  const [open, setOpen] = useState(block.active ?? false);

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
        onClick={() => setOpen((v) => !v)}
        sx={{
          alignItems: "center",
          px: 1.5,
          py: 1,
          cursor: "pointer",
          "&:hover": { backgroundColor: (t) => t.custom.surfaces.s3 },
        }}
      >
        <PsychologyIcon sx={{ fontSize: 16, color: "text.secondary" }} />
        {block.active ? (
          <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", flex: 1 }}>
            <ShimmerText>Thinking</ShimmerText>
            <TypingDots />
          </Stack>
        ) : (
          <Typography variant="microLabel" sx={{ color: "text.secondary", flex: 1 }}>
            Reasoning{block.duration ? ` · thought for ${block.duration}` : ""}
          </Typography>
        )}
        <KeyboardArrowDownIcon
          sx={{
            fontSize: 18,
            color: "text.secondary",
            transition: "transform 180ms ease",
            transform: open ? "rotate(180deg)" : "none",
          }}
        />
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Typography
          component="div"
          sx={{
            px: 1.5,
            pb: 1.5,
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
