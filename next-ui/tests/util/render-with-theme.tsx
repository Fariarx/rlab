import { ThemeProvider } from "@mui/material/styles";
import { render, type RenderResult } from "@testing-library/react";
import { type ReactElement } from "react";
import { ToastProvider } from "../../src/components/ui";
import { appTheme } from "../../src/theme/app-theme";

/**
 * Renders kit components inside the providers they depend on: the theme (so
 * `theme.palette.status` / `theme.custom` resolve) and the toast provider (so
 * `useToast()` consumers don't throw).
 */
export function renderWithTheme(ui: ReactElement): RenderResult {
  return render(
    <ThemeProvider theme={appTheme}>
      <ToastProvider>{ui}</ToastProvider>
    </ThemeProvider>,
  );
}
