import { Box, Stack } from "@mui/material";
import type { I18nApi } from "../../../i18n/I18nProvider";
import { MOBILE_KEY_SEQUENCES, MOBILE_STICKY_MODIFIERS, type TerminalInputModifier, type TerminalInputModifiers } from "./terminal-view-model";

export function TerminalKeyboardControls({
  inputModifiers,
  running,
  onSendKeySequence,
  onToggleInputModifier,
  t,
}: {
  readonly inputModifiers: TerminalInputModifiers;
  readonly running: boolean;
  readonly onSendKeySequence: (sequence: string) => void;
  readonly onToggleInputModifier: (modifier: TerminalInputModifier) => void;
  readonly t: I18nApi["t"];
}) {
  return (
    <Stack
      direction="row"
      aria-label={t("terminalKeyboardControls")}
      sx={{
        display: { xs: "flex", sm: "none" },
        flex: "0 0 auto",
        gap: 0.75,
        px: 1,
        py: 0.75,
        overflowX: "auto",
        overflowY: "hidden",
        scrollSnapType: "x mandatory",
        borderBottom: (theme) => `1px solid ${theme.custom.borders.subtle}`,
        backgroundColor: "#0a0f14",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none",
        "&::-webkit-scrollbar": { display: "none" },
      }}
    >
      {MOBILE_STICKY_MODIFIERS.map((item) => {
        const active = inputModifiers[item.key];
        return (
          <Box
            key={item.key}
            component="button"
            type="button"
            disabled={!running}
            aria-label={t("terminalToggleModifier", { key: item.label })}
            aria-pressed={active}
            onClick={() => onToggleInputModifier(item.key)}
            sx={{
              position: "relative",
              flex: "0 0 auto",
              scrollSnapAlign: "start",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 56,
              minHeight: 34,
              px: 1.1,
              borderRadius: (theme) => `${theme.custom.radii.md}px`,
              border: (theme) => `1px solid ${active ? theme.palette.primary.main : theme.custom.borders.subtle}`,
              backgroundColor: active ? "rgba(76, 201, 255, 0.2)" : (theme) => theme.custom.surfaces.s2,
              color: active ? "primary.light" : "text.primary",
              fontFamily: (theme) => theme.custom.fonts.mono,
              fontSize: "0.72rem",
              fontWeight: 800,
              whiteSpace: "nowrap",
              cursor: running ? "pointer" : "default",
              opacity: running ? 1 : 0.5,
              boxShadow: active ? "0 0 0 1px rgba(76, 201, 255, 0.35) inset" : "none",
              "&::after": {
                content: '""',
                position: "absolute",
                right: 6,
                top: 6,
                width: 6,
                height: 6,
                borderRadius: "999px",
                backgroundColor: active ? "primary.light" : "transparent",
              },
              "&:active": {
                backgroundColor: active ? "rgba(76, 201, 255, 0.28)" : (theme) => theme.custom.surfaces.s4,
              },
            }}
          >
            {item.label}
          </Box>
        );
      })}
      <Box
        aria-hidden="true"
        sx={{
          flex: "0 0 auto",
          alignSelf: "stretch",
          width: 1,
          mx: 0.25,
          backgroundColor: (theme) => theme.custom.borders.subtle,
        }}
      />
      {MOBILE_KEY_SEQUENCES.map((item) => (
        <Box
          key={item.label}
          component="button"
          type="button"
          disabled={!running}
          aria-label={t("terminalSendKeySequence", { keys: item.ariaLabel ?? item.label })}
          onClick={() => onSendKeySequence(item.sequence)}
          sx={{
            flex: "0 0 auto",
            scrollSnapAlign: "start",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 42,
            minHeight: 34,
            px: 1,
            borderRadius: (theme) => `${theme.custom.radii.md}px`,
            border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
            backgroundColor: (theme) => theme.custom.surfaces.s2,
            color: "text.primary",
            fontFamily: (theme) => theme.custom.fonts.mono,
            fontSize: "0.72rem",
            fontWeight: 700,
            whiteSpace: "nowrap",
            cursor: running ? "pointer" : "default",
            opacity: running ? 1 : 0.5,
            "&:active": {
              backgroundColor: (theme) => theme.custom.surfaces.s4,
            },
          }}
        >
          {item.label}
        </Box>
      ))}
    </Stack>
  );
}
