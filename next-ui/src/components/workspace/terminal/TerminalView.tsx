import "@xterm/xterm/css/xterm.css";

import TerminalIcon from "@mui/icons-material/Terminal";
import { Box, Stack } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useI18n } from "../../../i18n/I18nProvider";
import { EmptyState } from "../../ui";
import {
  INACTIVE_TERMINAL_MODIFIERS,
  type TerminalInputModifier,
} from "./terminal-view-model";
import { disposeTerminal, ensureTerminal, type RlabTerminal } from "./terminal-session";
import { TerminalViewStore } from "./terminal-view-store";
import { TerminalHeader } from "./TerminalHeader";
import { TerminalKeyboardControls } from "./TerminalKeyboardControls";

export const TerminalView = observer(function TerminalView({ cwd }: { readonly cwd?: string }) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<RlabTerminal | null>(null);
  const [store] = useState(() => new TerminalViewStore({ connecting: Boolean(cwd), running: false, error: null, exitCode: null }, INACTIVE_TERMINAL_MODIFIERS));
  const { status, setStatus, terminalEpoch, setTerminalEpoch, inputModifiers, setInputModifiers } = store;

  useEffect(() => {
    // `terminalEpoch` is a lifecycle token: restartTerminal increments it after
    // disposing the cached terminal so this effect remounts the replacement.
    void terminalEpoch;
    const container = containerRef.current;
    if (!cwd || !container) {
      return;
    }
    const terminal = ensureTerminal(cwd);
    terminalRef.current = terminal;
    terminal.setInputModifiers(inputModifiers, () => setInputModifiers(INACTIVE_TERMINAL_MODIFIERS));
    const unsubscribe = terminal.subscribe({ onStatus: setStatus });
    terminal.mount(container);
    return () => {
      unsubscribe();
      terminal.unmount(container);
      if (terminalRef.current === terminal) {
        terminalRef.current = null;
      }
    };
  }, [cwd, inputModifiers, setInputModifiers, setStatus, terminalEpoch]);

  useEffect(() => {
    terminalRef.current?.setInputModifiers(inputModifiers, () => setInputModifiers(INACTIVE_TERMINAL_MODIFIERS));
  }, [inputModifiers, setInputModifiers]);

  const stopTerminal = () => {
    if (!cwd || !terminalRef.current) {
      return;
    }
    const terminal = terminalRef.current;
    void terminal.stop().finally(() => {
      disposeTerminal(cwd);
      if (terminalRef.current === terminal) {
        terminalRef.current = null;
      }
    });
  };
  const restartTerminal = () => {
    if (!cwd) {
      return;
    }
    disposeTerminal(cwd);
    terminalRef.current = null;
    setStatus({ connecting: true, running: false, error: null, exitCode: null });
    setInputModifiers(INACTIVE_TERMINAL_MODIFIERS);
    setTerminalEpoch((value) => value + 1);
  };
  const toggleInputModifier = (modifier: TerminalInputModifier) => {
    let nextModifiers = inputModifiers;
    flushSync(() => {
      setInputModifiers((current) => {
        nextModifiers = { ...current, [modifier]: !current[modifier] };
        return nextModifiers;
      });
    });
    terminalRef.current?.setInputModifiers(nextModifiers, () => setInputModifiers(INACTIVE_TERMINAL_MODIFIERS));
  };
  const sendKeySequence = (sequence: string) => {
    flushSync(() => setInputModifiers(INACTIVE_TERMINAL_MODIFIERS));
    terminalRef.current?.setInputModifiers(INACTIVE_TERMINAL_MODIFIERS, () => setInputModifiers(INACTIVE_TERMINAL_MODIFIERS));
    terminalRef.current?.sendKeySequence(sequence);
  };

  if (!cwd) {
    return (
      <Stack sx={{ height: "100%", minHeight: 0, justifyContent: "center", alignItems: "center", px: 3, py: 4, backgroundColor: "#080c10" }}>
        <EmptyState icon={<TerminalIcon />} title={t("terminalTab")} description={t("gitNoProject")} />
      </Stack>
    );
  }

  return (
    <Stack sx={{ height: "100%", minHeight: 0, backgroundColor: "#080c10" }}>
      <TerminalHeader cwd={cwd} status={status} onStop={stopTerminal} onRestart={restartTerminal} t={t} />
      <TerminalKeyboardControls inputModifiers={inputModifiers} running={status.running} onToggleInputModifier={toggleInputModifier} onSendKeySequence={sendKeySequence} t={t} />
      <Box
        ref={containerRef}
        role="log"
        aria-label={t("terminalOutput")}
        aria-busy={status.connecting ? "true" : "false"}
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          backgroundColor: "#080c10",
          "& .xterm": { height: "100%", p: 1 },
          "& .xterm-viewport": { backgroundColor: "#080c10 !important" },
          "& .xterm-screen": { outline: "none" },
        }}
      />
    </Stack>
  );
});
