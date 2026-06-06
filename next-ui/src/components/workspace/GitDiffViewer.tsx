import { Box, Stack, Typography, type SxProps, type Theme } from "@mui/material";
import { type ReactNode } from "react";
import { type DiffBlock } from "../agent";

type DiffViewerLineKind = "add" | "del" | "ctx" | "meta";

interface DiffViewerLine {
  readonly kind: DiffViewerLineKind;
  readonly text: string;
}

interface GitDiffViewerProps {
  readonly emptyText: string;
  readonly lines: readonly DiffViewerLine[];
  readonly title?: ReactNode;
}

function unifiedLineKind(line: string): DiffViewerLineKind {
  if (line.startsWith("@@") || line.startsWith("diff --git ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
    return "meta";
  }
  if (line.startsWith("+")) {
    return "add";
  }
  if (line.startsWith("-")) {
    return "del";
  }
  return "ctx";
}

export function gitDiffViewerLinesFromUnified(diff: string): readonly DiffViewerLine[] {
  return diff
    .split(/\r?\n/)
    .filter((line, index, lines) => line.length > 0 || index < lines.length - 1)
    .map((line) => ({ kind: unifiedLineKind(line), text: line }));
}

export function gitDiffViewerLinesFromBlock(block: DiffBlock): readonly DiffViewerLine[] {
  return block.lines.map((line) => {
    const prefix = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
    return { kind: line.type, text: `${prefix}${line.text}` };
  });
}

function lineSx(kind: DiffViewerLineKind): SxProps<Theme> {
  switch (kind) {
    case "add":
      return {
        backgroundColor: (theme) => theme.palette.status.ok.soft,
        color: (theme) => theme.palette.status.ok.main,
      };
    case "del":
      return {
        backgroundColor: (theme) => theme.palette.status.error.soft,
        color: (theme) => theme.palette.status.error.main,
      };
    case "meta":
      return {
        backgroundColor: (theme) => theme.custom.surfaces.s1,
        color: "text.secondary",
      };
    case "ctx":
      return {
        backgroundColor: "transparent",
        color: "text.primary",
      };
  }
}

export function GitDiffViewer({ emptyText, lines, title }: GitDiffViewerProps) {
  if (lines.length === 0) {
    return (
      <Box
        sx={{
          border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
          borderRadius: (theme) => `${theme.custom.radii.md}px`,
          backgroundColor: (theme) => theme.custom.surfaces.s2,
          p: 2,
        }}
      >
        <Typography sx={{ color: "text.secondary", fontSize: "0.82rem" }}>{emptyText}</Typography>
      </Box>
    );
  }

  return (
    <Stack
      sx={{
        minHeight: 0,
        border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
        borderRadius: (theme) => `${theme.custom.radii.md}px`,
        backgroundColor: (theme) => theme.custom.surfaces.s2,
        overflow: "hidden",
      }}
    >
      {title != null && (
        <Box
          sx={{
            px: 1.25,
            py: 1,
            borderBottom: (theme) => `1px solid ${theme.custom.borders.subtle}`,
            backgroundColor: (theme) => theme.custom.surfaces.s1,
          }}
        >
          {title}
        </Box>
      )}
      <Box
        component="ol"
        sx={{
          m: 0,
          p: 0,
          maxHeight: { xs: 420, md: 560 },
          overflow: "auto",
          listStyle: "none",
          fontFamily: (theme) => theme.custom.fonts.mono,
          fontSize: "0.72rem",
          lineHeight: 1.55,
        }}
      >
        {lines.map((line, index) => (
          <Box
            component="li"
            key={`${index}-${line.kind}-${line.text}`}
            sx={{
              display: "grid",
              gridTemplateColumns: "3.5rem minmax(max-content, 1fr)",
              minWidth: "100%",
              ...lineSx(line.kind),
            }}
          >
            <Box
              component="span"
              aria-hidden="true"
              sx={{
                userSelect: "none",
                textAlign: "right",
                px: 1,
                color: "text.secondary",
                borderRight: (theme) => `1px solid ${theme.custom.borders.subtle}`,
              }}
            >
              {index + 1}
            </Box>
            <Box component="span" sx={{ whiteSpace: "pre", px: 1 }}>
              {line.text}
            </Box>
          </Box>
        ))}
      </Box>
    </Stack>
  );
}
