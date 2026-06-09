import DescriptionIcon from "@mui/icons-material/Description";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { Box, Collapse, Stack, Typography } from "@mui/material";
import { useState } from "react";
import type { DiffBlock } from "./types";

const signPrefix = { add: "+", del: "-", ctx: " " } as const;

/** DiffCard — a file edit with +/- counts and a collapsible hunk preview. */
export function DiffCard({ block }: { readonly block: DiffBlock }) {
  const [open, setOpen] = useState(false);

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
        {/* Truncate from the LEFT so the filename (right side) stays visible when
            the path is too long — `direction: rtl` moves the ellipsis to the
            start; the LRM (‎) keeps the latin path itself left-to-right. */}
        <Typography
          component="span"
          noWrap
          dir="rtl"
          sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.8rem", fontWeight: 600, flex: 1, minWidth: 0, textAlign: "left" }}
        >
          {"‎"}
          {block.file}
        </Typography>
        <Typography component="span" sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.72rem", color: (t) => t.palette.status.ok.main }}>
          +{block.additions}
        </Typography>
        <Typography component="span" sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.72rem", color: (t) => t.palette.status.error.main }}>
          −{block.deletions}
        </Typography>
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
