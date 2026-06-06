import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { Box, Stack, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { type ReactNode } from "react";
import { type StatusKey } from "../../theme/tokens";
import { Button, IconButton, StatusDot } from "../ui";
import { blink, bounce } from "./anim";

/* ---------------------------------- Avatars --------------------------------- */

export function AgentAvatar({ size = 30 }: { readonly size?: number }) {
  return (
    <Box
      sx={{
        flex: "0 0 auto",
        width: size,
        height: size,
        borderRadius: (t) => `${t.custom.radii.sm}px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        background: (t) => `linear-gradient(140deg, ${t.palette.status.running.main}, ${t.palette.status.info.main})`,
        boxShadow: (t) => `0 4px 14px ${t.palette.status.running.soft}`,
      }}
    >
      <AutoAwesomeIcon sx={{ fontSize: size * 0.55 }} />
    </Box>
  );
}

export function UserAvatar({ size = 30 }: { readonly size?: number }) {
  return (
    <Box
      sx={{
        flex: "0 0 auto",
        width: size,
        height: size,
        borderRadius: (t) => `${t.custom.radii.sm}px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: (t) => t.custom.fonts.mono,
        fontSize: "0.62rem",
        fontWeight: 700,
        letterSpacing: "0.06em",
        color: "text.secondary",
        backgroundColor: (t) => t.custom.surfaces.s3,
        border: (t) => `1px solid ${t.custom.borders.subtle}`,
      }}
    >
      YOU
    </Box>
  );
}

/* -------------------------------- Typing dots ------------------------------- */

const Dot = styled("span")(({ theme }) => ({
  width: 6,
  height: 6,
  borderRadius: "50%",
  backgroundColor: theme.palette.status.running.main,
  animation: `${bounce} 1.2s infinite ease-in-out`,
}));

export function TypingDots() {
  return (
    <Stack direction="row" spacing={0.6} sx={{ alignItems: "center", height: 18 }}>
      {[0, 1, 2].map((i) => (
        <Dot key={i} sx={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </Stack>
  );
}

/* ------------------------------- Message text ------------------------------- */

const Caret = styled("span")(({ theme }) => ({
  display: "inline-block",
  width: 7,
  height: "1.05em",
  marginLeft: 2,
  transform: "translateY(2px)",
  borderRadius: 1,
  backgroundColor: theme.palette.status.running.main,
  animation: `${blink} 1s steps(1) infinite`,
}));

export function MessageText({ text, streaming }: { readonly text: string; readonly streaming?: boolean }) {
  return (
    <Typography
      component="div"
      sx={{ fontSize: "0.9rem", lineHeight: 1.65, color: "text.primary", whiteSpace: "pre-line" }}
    >
      {text}
      {streaming && <Caret />}
    </Typography>
  );
}

/* -------------------------------- Status note ------------------------------- */

export function StatusNote({ level, children }: { readonly level: StatusKey; readonly children: ReactNode }) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        alignItems: "center",
        alignSelf: "flex-start",
        px: 1.25,
        py: 0.75,
        borderRadius: (t) => `${t.custom.radii.pill}px`,
        backgroundColor: (t) => t.palette.status[level].soft,
        border: (t) => `1px solid ${t.palette.status[level].border}`,
      }}
    >
      <StatusDot status={level} label={level} pulse={false} size="sm" />
      <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.74rem", color: "text.primary" }}>
        {children}
      </Typography>
    </Stack>
  );
}

/* --------------------------------- Code block ------------------------------- */

export function CodeBlock({ language, code }: { readonly language: string; readonly code: string }) {
  return (
    <Box
      sx={{
        borderRadius: (t) => `${t.custom.radii.md}px`,
        border: (t) => `1px solid ${t.custom.borders.subtle}`,
        overflow: "hidden",
        backgroundColor: (t) => t.custom.surfaces.s1,
      }}
    >
      <Stack
        direction="row"
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          px: 1.5,
          py: 0.5,
          borderBottom: (t) => `1px solid ${t.custom.borders.subtle}`,
        }}
      >
        <Typography variant="microLabel" sx={{ color: "text.secondary" }}>
          {language}
        </Typography>
        <IconButton aria-label="Copy code">
          <ContentCopyIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Stack>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1.5,
          overflow: "auto",
          fontFamily: (t) => t.custom.fonts.mono,
          fontSize: "0.78rem",
          lineHeight: 1.6,
          color: "text.primary",
        }}
      >
        {code}
      </Box>
    </Box>
  );
}

/* ---------------------------------- Citation -------------------------------- */

export function Citations({ sources }: { readonly sources: ReadonlyArray<{ label: string; url: string }> }) {
  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
      {sources.map((source, index) => (
        <Stack
          key={source.url}
          direction="row"
          spacing={0.75}
          sx={{
            alignItems: "center",
            px: 1,
            py: 0.5,
            borderRadius: (t) => `${t.custom.radii.pill}px`,
            backgroundColor: (t) => t.custom.surfaces.s3,
            border: (t) => `1px solid ${t.custom.borders.subtle}`,
          }}
        >
          <Box
            sx={{
              width: 15,
              height: 15,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: (t) => t.custom.fonts.mono,
              fontSize: "0.6rem",
              color: "#fff",
              backgroundColor: (t) => t.palette.status.running.main,
            }}
          >
            {index + 1}
          </Box>
          <Typography sx={{ fontSize: "0.74rem", color: "text.secondary" }}>{source.label}</Typography>
        </Stack>
      ))}
    </Stack>
  );
}

/* ----------------------------- Suggested actions ---------------------------- */

export interface SuggestedAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly tone?: "default" | "primary" | "danger";
}

export function SuggestedActions({
  actions,
  onAction,
}: {
  readonly actions: readonly SuggestedAction[];
  readonly onAction?: (id: string) => void;
}) {
  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
      {actions.map((action) => (
        <Button
          key={action.id}
          size="small"
          variant={action.tone && action.tone !== "default" ? "contained" : "subtle"}
          color={action.tone === "danger" ? "error" : "primary"}
          startIcon={action.icon}
          onClick={() => onAction?.(action.id)}
        >
          {action.label}
        </Button>
      ))}
    </Stack>
  );
}
