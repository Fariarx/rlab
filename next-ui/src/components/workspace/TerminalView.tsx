import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import StopCircleOutlinedIcon from "@mui/icons-material/StopCircleOutlined";
import TerminalIcon from "@mui/icons-material/Terminal";
import { Box, CircularProgress, InputBase, Stack, Typography } from "@mui/material";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { EmptyState, IconButton } from "../ui";

type OutputSegment = { readonly stream: "out" | "err"; readonly text: string };

interface TerminalEntry {
  readonly id: number;
  readonly command: string;
  segments: OutputSegment[];
  exitCode?: number;
  running: boolean;
  stopped?: boolean;
}

type TerminalEvent =
  | { readonly type: "out"; readonly chunk: string }
  | { readonly type: "err"; readonly chunk: string }
  | { readonly type: "exit"; readonly code: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTerminalEvent(line: string): TerminalEvent {
  const value: unknown = JSON.parse(line);
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("invalid event");
  }
  if ((value.type === "out" || value.type === "err") && typeof value.chunk === "string") {
    return { type: value.type, chunk: value.chunk };
  }
  if (value.type === "exit" && typeof value.code === "number") {
    return { type: "exit", code: value.code };
  }
  throw new Error(`invalid ${value.type} event`);
}

/** TerminalView — a per-folder command runner. Each command runs in the chat's
 *  cwd and streams stdout/stderr back; it is stateless between commands (a `cd`
 *  only lasts within a single command line). */
export function TerminalView({ cwd }: { readonly cwd?: string }) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<readonly TerminalEntry[]>([]);
  const [input, setInput] = useState("");
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const seqRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllers = useRef(new Map<number, AbortController>());
  const stoppedIds = useRef(new Set<number>());
  const history = entries.map((entry) => entry.command);
  const hasRunningEntry = entries.some((entry) => entry.running);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries]);

  const patchEntry = (id: number, patch: (entry: TerminalEntry) => TerminalEntry) => {
    setEntries((current) => current.map((entry) => (entry.id === id ? patch(entry) : entry)));
  };

  const run = async (command: string, cwdForRun: string) => {
    const id = ++seqRef.current;
    const abortController = new AbortController();
    abortControllers.current.set(id, abortController);
    stoppedIds.current.delete(id);
    setEntries((current) => [...current, { id, command, segments: [], running: true }]);

    const append = (segment: OutputSegment) =>
      patchEntry(id, (entry) => {
        const last = entry.segments[entry.segments.length - 1];
        // Coalesce consecutive chunks of the same stream to keep the DOM light.
        const segments =
          last && last.stream === segment.stream
            ? [...entry.segments.slice(0, -1), { stream: last.stream, text: last.text + segment.text }]
            : [...entry.segments, segment];
        return { ...entry, segments };
      });

    try {
      const response = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({ cwd: cwdForRun, command }),
      });
      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        append({ stream: "err", text: payload.error ?? `Terminal failed (${response.status})` });
        patchEntry(id, (entry) => ({ ...entry, running: false, exitCode: 1 }));
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }
          let event: TerminalEvent;
          try {
            event = parseTerminalEvent(line);
          } catch (error) {
            append({ stream: "err", text: `${t("terminalProtocolError", { error: error instanceof Error ? error.message : String(error) })}\n` });
            patchEntry(id, (entry) => ({ ...entry, running: false, exitCode: 1 }));
            return;
          }
          if (event.type === "out") {
            append({ stream: "out", text: event.chunk });
          } else if (event.type === "err") {
            append({ stream: "err", text: event.chunk });
          } else if (event.type === "exit") {
            patchEntry(id, (entry) => ({ ...entry, running: false, exitCode: event.code }));
          }
        }
      }
      patchEntry(id, (entry) => (entry.running ? { ...entry, running: false } : entry));
    } catch (error) {
      if (stoppedIds.current.has(id)) {
        return;
      }
      append({ stream: "err", text: error instanceof Error ? error.message : String(error) });
      patchEntry(id, (entry) => ({ ...entry, running: false, exitCode: 1 }));
    } finally {
      abortControllers.current.delete(id);
    }
  };

  const stop = (id: number) => {
    stoppedIds.current.add(id);
    abortControllers.current.get(id)?.abort();
    abortControllers.current.delete(id);
    patchEntry(id, (entry) => ({ ...entry, running: false, stopped: true }));
  };

  const submit = () => {
    const command = input.trim();
    if (!command || !cwd) {
      return;
    }
    setInput("");
    setHistoryIndex(null);
    void run(command, cwd);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === "ArrowUp" && history.length > 0) {
      event.preventDefault();
      const next = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      setInput(history[next]);
      return;
    }
    if (event.key === "ArrowDown" && historyIndex !== null) {
      event.preventDefault();
      const next = historyIndex + 1;
      if (next >= history.length) {
        setHistoryIndex(null);
        setInput("");
      } else {
        setHistoryIndex(next);
        setInput(history[next]);
      }
    }
  };

  return (
    <Stack sx={{ height: "100%", minHeight: 0, backgroundColor: (theme) => theme.custom.surfaces.s1 }}>
      {!cwd ? (
        <Stack sx={{ flex: 1, minHeight: 0, justifyContent: "center", alignItems: "center", px: 3, py: 4 }}>
          <EmptyState icon={<TerminalIcon />} title={t("terminalTab")} description={t("gitNoProject")} />
        </Stack>
      ) : (
        <>
          <Box
            ref={scrollRef}
            role="log"
            aria-label={t("terminalOutput")}
            aria-live="polite"
            aria-busy={hasRunningEntry ? "true" : "false"}
            sx={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              px: 1.5,
              py: 1.25,
              fontFamily: (theme) => theme.custom.fonts.mono,
              fontSize: "0.74rem",
              lineHeight: 1.5,
            }}
          >
            {entries.length === 0 && (
              <Typography sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.74rem", color: "text.tertiary" }}>
                {t("terminalHint")}
              </Typography>
            )}
            {entries.map((entry) => (
              <Box key={entry.id} sx={{ mb: 1 }}>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline" }}>
                  <Box component="span" sx={{ color: (theme) => theme.palette.status.ok.main, flex: "0 0 auto" }}>❯</Box>
                  <Box component="span" sx={{ color: "text.primary", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{entry.command}</Box>
                  {entry.running && <CircularProgress size={11} sx={{ flex: "0 0 auto", alignSelf: "center" }} />}
                  {entry.running && (
                    <IconButton aria-label={t("stopTerminalCommand")} tone="danger" onClick={() => stop(entry.id)} sx={{ ml: 0.25, width: 22, height: 22 }}>
                      <StopCircleOutlinedIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  )}
                </Stack>
                {entry.segments.length > 0 && (
                  <Box component="pre" sx={{ m: 0, mt: 0.25, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "inherit" }}>
                    {entry.segments.map((segment, index) => (
                      <Box
                        component="span"
                        key={index}
                        sx={{ color: segment.stream === "err" ? (theme) => theme.palette.status.error.main : "text.secondary" }}
                      >
                        {segment.text}
                      </Box>
                    ))}
                  </Box>
                )}
                {entry.exitCode !== undefined && entry.exitCode !== 0 && (
                  <Typography component="span" sx={{ fontFamily: "inherit", fontSize: "0.7rem", color: (theme) => theme.palette.status.error.main }}>
                    {t("terminalExitCode", { code: entry.exitCode })}
                  </Typography>
                )}
                {entry.stopped === true && (
                  <Typography component="span" sx={{ fontFamily: "inherit", fontSize: "0.7rem", color: "text.secondary" }}>
                    {t("terminalStopped")}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>

          <Stack
            direction="row"
            spacing={0.75}
            sx={{
              alignItems: "center",
              flex: "0 0 auto",
              px: 1.5,
              py: 1,
              borderTop: (theme) => `1px solid ${theme.custom.borders.subtle}`,
              backgroundColor: (theme) => theme.custom.surfaces.s2,
            }}
          >
            <Typography
              noWrap
              sx={{
                fontFamily: (theme) => theme.custom.fonts.mono,
                fontSize: "0.7rem",
                color: "text.tertiary",
                flex: "0 1 auto",
                minWidth: 0,
                maxWidth: "40%",
                direction: "rtl",
                textAlign: "left",
              }}
            >
              {cwd}
            </Typography>
            <KeyboardArrowRightIcon sx={{ fontSize: 18, color: (theme) => theme.palette.status.ok.main, flex: "0 0 auto" }} />
            <InputBase
              inputProps={{ "aria-label": t("terminalCommandInput") }}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("terminalPlaceholder")}
              sx={{ flex: 1, fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.78rem", color: "text.primary" }}
            />
          </Stack>
        </>
      )}
    </Stack>
  );
}
