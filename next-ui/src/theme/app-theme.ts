import { createTheme, type Theme } from "@mui/material/styles";
import { checkboxIcons } from "../components/ui/checkbox-icons";
import type { DensityMode, ThemeMode } from "../lib/app-settings";
import { dark, fonts, highContrast, light, microLabel, type ModeTokens, radii } from "./tokens";

/**
 * Kit theme — technical, restrained UI in dark and light modes.
 *
 * `buildTheme` consumes a mode's token set (see ./tokens.ts) and produces a MUI
 * theme: the `status` palette, the `custom` token bag (so components read
 * surfaces/borders/status through the theme and switch automatically), monospace
 * accents, the `microLabel`/`subtle` variants, and component overrides. See
 * ./theme-augmentation.d.ts for the typing.
 */
function buildTheme(t: ModeTokens, density: DensityMode): Theme {
  const { surfaces, borders, status, text } = t;
  const accent = status.running.main;
  const compact = density === "compact";

  return createTheme({
    spacing: compact ? 6 : 8,
    palette: {
      mode: t.mode,
      background: t.background,
      primary: t.primary,
      secondary: t.secondary,
      success: { main: status.ok.main },
      warning: { main: status.warn.main },
      error: { main: status.error.main },
      text,
      status,
    },
    custom: { surfaces, status, borders, radii, fonts, density },
    shape: { borderRadius: radii.md },
    typography: {
      fontFamily: fonts.sans,
      h1: { fontSize: "2.25rem", fontWeight: 750, letterSpacing: 0 },
      h2: { fontSize: "1.35rem", fontWeight: 700, letterSpacing: 0 },
      button: { fontWeight: 700, letterSpacing: 0, textTransform: "none" },
      microLabel,
    },
    components: {
      MuiButtonBase: {
        defaultProps: { disableRipple: true },
      },
      MuiCssBaseline: {
        styleOverrides: {
          "code, kbd, samp, pre": { fontFamily: fonts.mono },
          // Slim, themed scrollbars so they don't look like default OS bars.
          "*": {
            scrollbarWidth: "thin",
            scrollbarColor: `${surfaces.s4} transparent`,
          },
          "*::-webkit-scrollbar": { width: 10, height: 10 },
          "*::-webkit-scrollbar-track": { backgroundColor: "transparent" },
          "*::-webkit-scrollbar-thumb": {
            backgroundColor: surfaces.s4,
            borderRadius: 999,
            border: "2px solid transparent",
            backgroundClip: "content-box",
          },
          "*::-webkit-scrollbar-thumb:hover": {
            backgroundColor: borders.strong,
          },
          "*::-webkit-scrollbar-corner": { backgroundColor: "transparent" },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: radii.md },
        },
        variants: [
          {
            props: { variant: "subtle" },
            style: {
              fontFamily: fonts.mono,
              fontWeight: 600,
              letterSpacing: "0.02em",
              textTransform: "none",
              color: text.primary,
              backgroundColor: surfaces.s2,
              border: `1px solid ${borders.subtle}`,
              "&:hover": { backgroundColor: surfaces.s3, borderColor: borders.strong },
              "&:active": { backgroundColor: surfaces.s4 },
              "&.Mui-disabled": { opacity: 0.5 },
            },
          },
        ],
      },
      MuiChip: {
        styleOverrides: {
          root: {
            fontFamily: fonts.mono,
            fontWeight: 600,
            letterSpacing: "0.04em",
            borderRadius: radii.pill,
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: surfaces.s3,
            border: `1px solid ${borders.subtle}`,
            color: text.primary,
            fontFamily: fonts.mono,
            fontSize: "0.7rem",
            letterSpacing: "0.02em",
            borderRadius: radii.sm,
            paddingTop: compact ? 3 : 4,
            paddingBottom: compact ? 3 : 4,
          },
          arrow: { color: surfaces.s3 },
        },
      },
      MuiInputBase: {
        styleOverrides: {
          root: { fontFamily: fonts.mono },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: surfaces.s3,
            borderRadius: radii.md,
            transition: "box-shadow 120ms ease",
            "& .MuiOutlinedInput-notchedOutline": { borderColor: borders.subtle },
            "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: borders.strong },
            "&.Mui-focused": { boxShadow: `0 0 0 3px ${status.running.soft}` },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
              borderColor: borders.focus,
              borderWidth: 1,
            },
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
            border: `1px solid ${borders.subtle}`,
            borderRadius: radii.lg,
            boxShadow: t.cardShadow,
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            backgroundImage: "none",
            backgroundColor: surfaces.s2,
            border: `1px solid ${borders.subtle}`,
            borderRadius: radii.lg,
          },
        },
      },
      MuiDialogContent: {
        styleOverrides: {
          // Keep a small gap below the title so floating labels / first-row
          // controls in popups aren't clipped (MUI zeroes this after a title).
          root: { paddingTop: 12 },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            backgroundImage: "none",
            backgroundColor: surfaces.s2,
            border: `1px solid ${borders.subtle}`,
            borderRadius: radii.md,
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            fontFamily: fonts.mono,
            fontSize: compact ? "0.78rem" : "0.82rem",
            "&:hover": { backgroundColor: surfaces.s3 },
            "&.Mui-selected": { backgroundColor: surfaces.s3 },
          },
        },
      },
      MuiTabs: {
        styleOverrides: {
          root: { minHeight: compact ? 34 : 40, borderBottom: `1px solid ${borders.subtle}` },
          indicator: { backgroundColor: accent, height: 2 },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            minHeight: compact ? 34 : 40,
            padding: compact ? "6px 10px" : "8px 12px",
            fontFamily: fonts.mono,
            fontSize: "0.78rem",
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "none",
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderBottomColor: borders.subtle,
            fontFamily: fonts.mono,
            fontSize: "0.8rem",
          },
          head: {
            ...microLabel,
            color: text.secondary,
            backgroundColor: surfaces.s1,
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { height: 6, borderRadius: radii.pill, backgroundColor: surfaces.s3 },
          bar: { borderRadius: radii.pill },
        },
      },
      MuiCheckbox: {
        defaultProps: checkboxIcons,
        styleOverrides: {
          root: {
            padding: 6,
            "&.Mui-disabled": { opacity: 0.45 },
          },
        },
      },
      MuiRadio: {
        styleOverrides: {
          root: {
            color: text.secondary,
            padding: 6,
            "&.Mui-checked": { color: accent },
            "&.Mui-disabled": { opacity: 0.4 },
          },
        },
      },
      MuiSwitch: {
        styleOverrides: {
          root: { width: 40, height: 24, padding: 0, marginLeft: 8, marginRight: 8 },
          switchBase: {
            padding: 4,
            "&.Mui-checked": {
              transform: "translateX(16px)",
              color: "#ffffff",
              "& + .MuiSwitch-track": { backgroundColor: accent, opacity: 1, border: 0 },
            },
            "&.Mui-disabled .MuiSwitch-thumb": { backgroundColor: status.idle.main },
            "&.Mui-disabled + .MuiSwitch-track": {
              opacity: 1,
              backgroundColor: surfaces.s4,
              borderColor: borders.strong,
            },
          },
          thumb: { width: 16, height: 16, boxShadow: "none", backgroundColor: "#ffffff" },
          track: {
            borderRadius: radii.pill,
            backgroundColor: surfaces.s4,
            opacity: 1,
            border: `1px solid ${borders.strong}`,
          },
        },
      },
      MuiSlider: {
        styleOverrides: {
          root: { color: accent, height: 4 },
          rail: { backgroundColor: surfaces.s4, opacity: 1 },
          thumb: {
            width: 14,
            height: 14,
            backgroundColor: "#ffffff",
            border: `2px solid ${accent}`,
            "&:hover, &.Mui-focusVisible": { boxShadow: `0 0 0 6px ${status.running.soft}` },
          },
          valueLabel: {
            backgroundColor: surfaces.s3,
            border: `1px solid ${borders.subtle}`,
            color: text.primary,
            fontFamily: fonts.mono,
            fontSize: "0.7rem",
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            borderRadius: radii.sm,
            color: text.secondary,
            "&:hover": { backgroundColor: surfaces.s3, color: text.primary },
          },
        },
      },
      MuiToggleButtonGroup: {
        styleOverrides: {
          root: {
            backgroundColor: surfaces.s2,
            border: `1px solid ${borders.subtle}`,
            borderRadius: radii.md,
            padding: 2,
            gap: 2,
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            border: 0,
            borderRadius: radii.sm,
            padding: compact ? "3px 9px" : "4px 12px",
            fontFamily: fonts.mono,
            fontSize: compact ? "0.72rem" : "0.75rem",
            fontWeight: 600,
            letterSpacing: "0.03em",
            textTransform: "none",
            color: text.secondary,
            "&:hover": { backgroundColor: surfaces.s3 },
            "&.Mui-selected": {
              backgroundColor: surfaces.s4,
              color: text.primary,
              "&:hover": { backgroundColor: surfaces.s4 },
            },
          },
        },
      },
    },
  });
}

export function buildAppTheme(mode: ThemeMode, density: DensityMode): Theme {
  if (mode === "light") {
    return buildTheme(light, density);
  }
  if (mode === "high-contrast") {
    return buildTheme(highContrast, density);
  }
  return buildTheme(dark, density);
}

export const darkTheme = buildTheme(dark, "comfortable");
export const lightTheme = buildTheme(light, "comfortable");
export const highContrastTheme = buildTheme(highContrast, "comfortable");

/** Default theme (dark). Kept as a named export for tests/back-compat. */
export const appTheme = darkTheme;
