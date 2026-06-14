/**
 * MUI v9 module augmentation for the kit theme.
 *
 * Type-only (no runtime). Adds `palette.status`, `theme.custom`, the
 * `microLabel` Typography variant, and the `subtle` Button variant — all
 * derived from tokens.ts so there is a single source of truth and no `any`.
 *
 * Augments the public `@mui/material/styles` re-exports (Theme/ThemeOptions/
 * Palette/...) plus the per-component prop-override interfaces.
 */
import type { CSSProperties } from "react";
import type { DensityMode } from "../lib/app-settings";
import type { Borders, Fonts, Radii, StatusPalette, Surfaces } from "./tokens";

interface CustomTokens {
  surfaces: Surfaces;
  status: StatusPalette;
  borders: Borders;
  radii: Radii;
  fonts: Fonts;
  density: DensityMode;
}

declare module "@mui/material/styles" {
  interface Palette {
    status: StatusPalette;
  }
  interface PaletteOptions {
    status?: StatusPalette;
  }

  interface Theme {
    custom: CustomTokens;
  }
  interface ThemeOptions {
    custom?: CustomTokens;
  }

  interface TypographyVariants {
    microLabel: CSSProperties;
  }
  interface TypographyVariantsOptions {
    microLabel?: CSSProperties;
  }
}

declare module "@mui/material/Typography" {
  interface TypographyPropsVariantOverrides {
    microLabel: true;
  }
}

declare module "@mui/material/Button" {
  interface ButtonPropsVariantOverrides {
    subtle: true;
  }
}
