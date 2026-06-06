/**
 * Design tokens for the technical, restrained UI kit.
 *
 * Framework-agnostic source of truth (no MUI imports). Shared tokens (radii,
 * space, fonts, type recipes) are mode-independent; the `dark` and `light`
 * token sets carry the per-mode palette (surfaces, status, borders, text).
 *
 * Grid: every spatial value is a multiple of 4px (see `space`). The MUI theme
 * keeps its default 8px spacing unit, which stays 4px-aligned, while kit
 * components reach for `space`/`radii` directly when they need finer control.
 */

/** Border radii — generous, soft corners are part of the look. */
export const radii = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

/** 4px spatial grid. */
export const space = [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64] as const;

export const fonts = {
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  sans: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
} as const;

/** Uppercase, tracked-out monospace micro-label used by headers and titles. */
export const microLabel = {
  fontFamily: fonts.mono,
  fontSize: "0.68rem",
  fontWeight: 600,
  lineHeight: 1.4,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
} as const;

export type StatusKey = "running" | "ok" | "warn" | "error" | "idle" | "info";
export type StatusToken = { readonly main: string; readonly soft: string; readonly border: string };
export type StatusPalette = Record<StatusKey, StatusToken>;

/** Four-step surface ramp. Meaning is mode-relative: s1 is the app background,
 * s2 the panels, s3 interactive fills (inputs/keycaps/hover), s4 pressed/tracks. */
export type Surfaces = { readonly s1: string; readonly s2: string; readonly s3: string; readonly s4: string };
export type Borders = { readonly subtle: string; readonly strong: string; readonly focus: string };
export type Fonts = typeof fonts;
export type Radii = typeof radii;

export interface ModeTokens {
  readonly mode: "dark" | "light";
  readonly surfaces: Surfaces;
  readonly status: StatusPalette;
  readonly borders: Borders;
  readonly text: { readonly primary: string; readonly secondary: string };
  readonly background: { readonly default: string; readonly paper: string };
  readonly primary: { readonly main: string; readonly contrastText: string };
  readonly secondary: { readonly main: string; readonly contrastText: string };
  readonly cardShadow: string;
}

export const dark: ModeTokens = {
  mode: "dark",
  surfaces: {
    s1: "#12171c", // app background / recessed
    s2: "#1b2229", // raised panels
    s3: "#222b33", // interactive fills (inputs, key caps, hover)
    s4: "#2b353e", // pressed / tracks
  },
  status: {
    running: { main: "#48a6ff", soft: "rgba(72, 166, 255, 0.14)", border: "rgba(72, 166, 255, 0.38)" },
    ok: { main: "#4fca7a", soft: "rgba(79, 202, 122, 0.14)", border: "rgba(79, 202, 122, 0.36)" },
    warn: { main: "#f5b84b", soft: "rgba(245, 184, 75, 0.14)", border: "rgba(245, 184, 75, 0.36)" },
    error: { main: "#ff6f6f", soft: "rgba(255, 111, 111, 0.14)", border: "rgba(255, 111, 111, 0.38)" },
    idle: { main: "#6b7682", soft: "rgba(107, 118, 130, 0.16)", border: "rgba(107, 118, 130, 0.34)" },
    info: { main: "#58c4d6", soft: "rgba(88, 196, 214, 0.14)", border: "rgba(88, 196, 214, 0.36)" },
  },
  borders: {
    subtle: "rgba(152, 170, 188, 0.16)",
    strong: "rgba(152, 170, 188, 0.28)",
    focus: "#48a6ff",
  },
  text: { primary: "#eef4f8", secondary: "#9eaab5" },
  background: { default: "#12171c", paper: "#1b2229" },
  primary: { main: "#48a6ff", contrastText: "#06111d" },
  secondary: { main: "#a8d36a", contrastText: "#101707" },
  cardShadow: "0 18px 50px rgba(0, 0, 0, 0.22)",
};

export const light: ModeTokens = {
  mode: "light",
  surfaces: {
    s1: "#eceef2", // app background / recessed
    s2: "#ffffff", // raised panels
    s3: "#f1f3f6", // interactive fills (inputs, key caps, hover)
    s4: "#e3e7ec", // pressed / tracks
  },
  status: {
    running: { main: "#2563eb", soft: "rgba(37, 99, 235, 0.10)", border: "rgba(37, 99, 235, 0.30)" },
    ok: { main: "#15924a", soft: "rgba(21, 146, 74, 0.10)", border: "rgba(21, 146, 74, 0.28)" },
    warn: { main: "#b06f00", soft: "rgba(176, 111, 0, 0.10)", border: "rgba(176, 111, 0, 0.28)" },
    error: { main: "#d23b3b", soft: "rgba(210, 59, 59, 0.10)", border: "rgba(210, 59, 59, 0.28)" },
    idle: { main: "#6b7682", soft: "rgba(107, 118, 130, 0.12)", border: "rgba(107, 118, 130, 0.26)" },
    info: { main: "#0e7c90", soft: "rgba(14, 124, 144, 0.10)", border: "rgba(14, 124, 144, 0.26)" },
  },
  borders: {
    subtle: "rgba(20, 26, 33, 0.10)",
    strong: "rgba(20, 26, 33, 0.18)",
    focus: "#2563eb",
  },
  text: { primary: "#1a1f24", secondary: "#59626b" },
  background: { default: "#eceef2", paper: "#ffffff" },
  primary: { main: "#2563eb", contrastText: "#ffffff" },
  secondary: { main: "#4d7c0f", contrastText: "#ffffff" },
  cardShadow: "0 1px 2px rgba(20, 26, 33, 0.06), 0 10px 28px rgba(20, 26, 33, 0.07)",
};

export const highContrast: ModeTokens = {
  mode: "dark",
  surfaces: {
    s1: "#000000",
    s2: "#050505",
    s3: "#111111",
    s4: "#1f1f1f",
  },
  status: {
    running: { main: "#00e5ff", soft: "rgba(0, 229, 255, 0.20)", border: "#00e5ff" },
    ok: { main: "#00ff66", soft: "rgba(0, 255, 102, 0.18)", border: "#00ff66" },
    warn: { main: "#ffdd00", soft: "rgba(255, 221, 0, 0.18)", border: "#ffdd00" },
    error: { main: "#ff4d4d", soft: "rgba(255, 77, 77, 0.20)", border: "#ff4d4d" },
    idle: { main: "#c9d1d9", soft: "rgba(201, 209, 217, 0.16)", border: "#c9d1d9" },
    info: { main: "#66ccff", soft: "rgba(102, 204, 255, 0.18)", border: "#66ccff" },
  },
  borders: {
    subtle: "#8b949e",
    strong: "#ffffff",
    focus: "#00e5ff",
  },
  text: { primary: "#ffffff", secondary: "#d0d7de" },
  background: { default: "#000000", paper: "#050505" },
  primary: { main: "#00e5ff", contrastText: "#000000" },
  secondary: { main: "#ffdd00", contrastText: "#000000" },
  cardShadow: "none",
};
