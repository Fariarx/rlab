import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CloseIcon from "@mui/icons-material/Close";
import CodeIcon from "@mui/icons-material/Code";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import SearchIcon from "@mui/icons-material/Search";
import TerminalIcon from "@mui/icons-material/Terminal";
import { Box, CircularProgress, Collapse, Stack, Typography } from "@mui/material";
import { type ReactNode, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { normalizeAgentToolOutput } from "../../lib/agent-output";
import { StatusDot } from "../ui";
import { MessageLink } from "./parts";
import type { CommandBlock, RunState, SearchBlock, ToolBlock } from "./types";

/* ------------------------------ Run indicator ------------------------------- */

export function RunIndicator({ state }: { readonly state: RunState }) {
  const { t } = useI18n();

  if (state === "running") {
    return <CircularProgress size={14} thickness={5} sx={{ color: (t) => t.palette.status.running.main }} />;
  }
  if (state === "ok") {
    return <CheckCircleIcon sx={{ fontSize: 16, color: (t) => t.palette.status.ok.main }} />;
  }
  if (state === "error") {
    return (
      <Box
        sx={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          backgroundColor: (t) => t.palette.status.error.main,
        }}
      >
        <CloseIcon sx={{ fontSize: 11 }} />
      </Box>
    );
  }
  return <StatusDot status="idle" label={t("pending")} pulse={false} />;
}

const stateBorder: Record<RunState, "running" | "ok" | "error" | "idle"> = {
  pending: "idle",
  running: "running",
  ok: "ok",
  error: "error",
};

/* ------------------------------- Action frame ------------------------------- */

interface ActionFrameProps {
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly meta?: ReactNode;
  readonly state: RunState;
  readonly defaultOpen?: boolean;
  readonly collapsible?: boolean;
  readonly children?: ReactNode;
}

export function ActionFrame({ icon, title, meta, state, defaultOpen, collapsible = true, children }: ActionFrameProps) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const hasBody = children != null;

  return (
    <Box
      sx={{
        borderRadius: (t) => `${t.custom.radii.md}px`,
        border: (t) => `1px solid ${t.custom.borders.subtle}`,
        borderLeft: (t) => `2px solid ${t.palette.status[stateBorder[state]].main}`,
        backgroundColor: (t) => t.custom.surfaces.s2,
        overflow: "hidden",
      }}
    >
      <Stack
        direction="row"
        spacing={1.25}
        onClick={hasBody && collapsible ? () => setOpen((v) => !v) : undefined}
        sx={{
          alignItems: "center",
          px: 1.5,
          py: 1,
          cursor: hasBody && collapsible ? "pointer" : "default",
          transition: "background-color 120ms ease",
          "&:hover": hasBody && collapsible ? { backgroundColor: (t) => t.custom.surfaces.s3 } : undefined,
        }}
      >
        <Box sx={{ display: "flex", color: "text.secondary", flex: "0 0 auto" }}>{icon}</Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>{title}</Box>
        {meta}
        <RunIndicator state={state} />
        {hasBody && collapsible && (
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
      {hasBody && (
        <Collapse in={collapsible ? open : true} unmountOnExit>
          <Box sx={{ px: 1.5, py: 1.5, borderTop: (t) => `1px solid ${t.custom.borders.subtle}` }}>
            {children}
          </Box>
        </Collapse>
      )}
    </Box>
  );
}

const titleSx = { fontFamily: (t: { custom: { fonts: { mono: string } } }) => t.custom.fonts.mono, fontSize: "0.8rem", fontWeight: 600 } as const;
const metaSx = { fontFamily: (t: { custom: { fonts: { mono: string } } }) => t.custom.fonts.mono, fontSize: "0.7rem", color: "text.secondary" } as const;
const outputSx = {
  fontFamily: (t: { custom: { fonts: { mono: string } } }) => t.custom.fonts.mono,
  fontSize: "0.76rem",
  lineHeight: 1.6,
  color: "text.secondary",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
} as const;

/* ---------------------------------- Tool ------------------------------------ */

export function ToolCall({ block }: { readonly block: ToolBlock }) {
  const { t } = useI18n();
  const hasArgs = block.args != null && Object.keys(block.args).length > 0;
  const output = typeof block.output === "string" ? normalizeAgentToolOutput(block.output) : "";
  const hasOutput = output.length > 0;
  const hasContent = hasArgs || hasOutput;

  return (
    <ActionFrame
      icon={<CodeIcon sx={{ fontSize: 16 }} />}
      state={block.state}
      defaultOpen={block.state === "error"}
      title={
        <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", flexWrap: "nowrap", minWidth: 0, overflow: "hidden" }}>
          <Typography component="span" noWrap sx={{ ...titleSx, flex: "0 0 auto" }}>
            {block.name}
          </Typography>
          {block.summary && (
            <Typography component="span" noWrap sx={{ fontSize: "0.78rem", color: "text.secondary", minWidth: 0 }}>
              {block.summary}
            </Typography>
          )}
        </Stack>
      }
      meta={block.duration && <Typography component="span" sx={metaSx}>{block.duration}</Typography>}
    >
      {hasContent ? (
        <Stack spacing={1}>
          {hasArgs && (
            <Stack spacing={0.25}>
              {Object.entries(block.args ?? {}).map(([key, value]) => (
                <Stack key={key} direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                  <Typography component="span" sx={{ ...metaSx, color: (t) => t.palette.status.running.main }}>
                    {key}
                  </Typography>
                  <Typography component="span" sx={outputSx}>
                    {value}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}
          {hasOutput && <Typography component="div" sx={outputSx}>{output}</Typography>}
        </Stack>
      ) : (
        <Typography component="div" sx={{ ...outputSx, fontStyle: "italic", opacity: 0.8 }}>
          {t("noOutput")}
        </Typography>
      )}
    </ActionFrame>
  );
}

/* --------------------------------- Command ---------------------------------- */

export function CommandCard({ block }: { readonly block: CommandBlock }) {
  const { t } = useI18n();
  const output = typeof block.output === "string" ? normalizeAgentToolOutput(block.output) : "";

  return (
    <ActionFrame
      icon={<TerminalIcon sx={{ fontSize: 16 }} />}
      state={block.state}
      defaultOpen={block.state === "error"}
      title={<Typography component="code" noWrap sx={{ ...titleSx, display: "block", minWidth: 0 }}>{block.command}</Typography>}
      meta={
        block.exitCode != null && (
          <Typography component="span" sx={metaSx}>
            {t("commandExitCode", { code: block.exitCode })}
          </Typography>
        )
      }
    >
      {output && <Typography component="div" sx={outputSx}>{output}</Typography>}
    </ActionFrame>
  );
}

/* ---------------------------------- Search ---------------------------------- */

export function SearchCard({ block }: { readonly block: SearchBlock }) {
  const { t } = useI18n();

  return (
    <ActionFrame
      icon={<SearchIcon sx={{ fontSize: 16 }} />}
      state={block.state}
      defaultOpen
      title={
        <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", flexWrap: "wrap" }}>
          <Typography component="span" sx={titleSx}>
            {t("webSearch")}
          </Typography>
          <Typography component="span" sx={{ fontSize: "0.78rem", color: "text.secondary" }}>
            “{block.query}”
          </Typography>
        </Stack>
      }
      meta={<Typography component="span" sx={metaSx}>{t("searchHitCount", { count: block.results.length })}</Typography>}
    >
      <Stack spacing={0.75}>
        {block.results.map((result) => (
          <Stack key={result.url} direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
            <Box sx={{ width: 5, height: 5, borderRadius: "50%", mt: "7px", flex: "0 0 auto", backgroundColor: (t) => t.palette.status.info.main }} />
            <Box sx={{ minWidth: 0 }}>
              <Box sx={{ fontSize: "0.8rem" }}>
                <MessageLink href={result.url}>{result.title}</MessageLink>
              </Box>
              <Typography sx={{ ...metaSx, color: "text.secondary" }}>{result.url}</Typography>
            </Box>
          </Stack>
        ))}
      </Stack>
    </ActionFrame>
  );
}
