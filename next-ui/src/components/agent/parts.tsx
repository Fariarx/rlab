import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import RefreshIcon from "@mui/icons-material/Refresh";
import { Box, Stack, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "../../i18n/I18nProvider";
import { type StatusKey } from "../../theme/tokens";
import { Button, IconButton, StatusDot } from "../ui";
import { blink, bounce } from "./anim";
import { type SuggestedActionIconKey } from "./types";

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
  const { t } = useI18n();

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
      {t("userAvatarInitials")}
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

function textFromReactNode(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(textFromReactNode).join("");
  }
  return "";
}

const markdownComponents = {
  p({ children }) {
    return (
      <Typography component="p" sx={{ m: 0, color: "text.primary", fontSize: "0.9rem", lineHeight: 1.65, overflowWrap: "anywhere", wordBreak: "break-word" }}>
        {children}
      </Typography>
    );
  },
  ol({ children }) {
    return (
      <Box component="ol" sx={{ m: 0, pl: 2.5, color: "text.primary", fontSize: "0.9rem", lineHeight: 1.65 }}>
        {children}
      </Box>
    );
  },
  ul({ children }) {
    return (
      <Box component="ul" sx={{ m: 0, pl: 2.5, color: "text.primary", fontSize: "0.9rem", lineHeight: 1.65 }}>
        {children}
      </Box>
    );
  },
  li({ children }) {
    return (
      <Box component="li" sx={{ pl: 0.25, mb: 0.5, "&:last-child": { mb: 0 } }}>
        {children}
      </Box>
    );
  },
  strong({ children }) {
    return (
      <Typography component="strong" sx={{ font: "inherit", fontWeight: 700, color: "text.primary" }}>
        {children}
      </Typography>
    );
  },
  em({ children }) {
    return (
      <Typography component="em" sx={{ font: "inherit", fontStyle: "italic", color: "text.primary" }}>
        {children}
      </Typography>
    );
  },
  a({ href, children }) {
    return (
      <Box
        component="a"
        href={href}
        target="_blank"
        rel="noreferrer"
        sx={{
          color: "primary.main",
          textDecorationColor: "currentColor",
          textUnderlineOffset: 3,
          "&:hover": { color: "primary.light" },
        }}
      >
        {children}
      </Box>
    );
  },
  blockquote({ children }) {
    return (
      <Box
        component="blockquote"
        sx={{
          m: 0,
          pl: 1.5,
          borderLeft: (t) => `2px solid ${t.palette.primary.main}`,
          color: "text.secondary",
        }}
      >
        {children}
      </Box>
    );
  },
  code({ className, children }) {
    const match = /language-([^\s]+)/.exec(className ?? "");
    if (match?.[1]) {
      return <CodeBlock language={match[1]} code={textFromReactNode(children).replace(/\n$/, "")} />;
    }
    return (
      <Box
        component="code"
        sx={{
          px: 0.4,
          py: 0.1,
          borderRadius: (t) => `${t.custom.radii.sm}px`,
          fontFamily: (t) => t.custom.fonts.mono,
          fontSize: "0.82em",
          color: "text.primary",
          backgroundColor: (t) => t.custom.surfaces.s3,
        }}
      >
        {children}
      </Box>
    );
  },
  pre({ children }) {
    return <Box sx={{ my: 0.5 }}>{children}</Box>;
  },
  table({ children }) {
    return (
      <Box sx={{ overflowX: "auto" }}>
        <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem", color: "text.primary" }}>
          {children}
        </Box>
      </Box>
    );
  },
  th({ children }) {
    return (
      <Box component="th" sx={{ px: 1, py: 0.75, border: (t) => `1px solid ${t.custom.borders.subtle}`, textAlign: "left", fontWeight: 700 }}>
        {children}
      </Box>
    );
  },
  td({ children }) {
    return (
      <Box component="td" sx={{ px: 1, py: 0.75, border: (t) => `1px solid ${t.custom.borders.subtle}`, verticalAlign: "top" }}>
        {children}
      </Box>
    );
  },
} satisfies Components;

function MarkdownMessage({ text }: { readonly text: string }) {
  return (
    <Stack spacing={1} sx={{ minWidth: 0 }}>
      <Markdown remarkPlugins={[remarkGfm]} skipHtml components={markdownComponents}>
        {text}
      </Markdown>
    </Stack>
  );
}

export function MessageText({ text, streaming }: { readonly text: string; readonly streaming?: boolean }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <MarkdownMessage text={text} />
      {streaming && <Caret />}
    </Box>
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
  const { t } = useI18n();

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
        <IconButton aria-label={t("copyCode")}>
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
  readonly icon?: SuggestedActionIconKey;
  readonly tone?: "default" | "primary" | "danger";
}

const suggestedActionIcon = {
  "arrow-forward": <ArrowForwardIcon sx={{ fontSize: 15 }} />,
  copy: <ContentCopyIcon sx={{ fontSize: 15 }} />,
  refresh: <RefreshIcon sx={{ fontSize: 15 }} />,
} satisfies Record<SuggestedActionIconKey, ReactNode>;

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
          startIcon={action.icon ? suggestedActionIcon[action.icon] : undefined}
          onClick={() => onAction?.(action.id)}
        >
          {action.label}
        </Button>
      ))}
    </Stack>
  );
}
