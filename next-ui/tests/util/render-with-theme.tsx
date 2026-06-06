import { ThemeProvider } from "@mui/material/styles";
import { render, type RenderResult } from "@testing-library/react";
import { type ReactElement, type ReactNode } from "react";
import { ToastProvider } from "../../src/components/ui";
import { appTheme } from "../../src/theme/app-theme";

/**
 * Renders kit components inside the providers they depend on: the theme (so
 * `theme.palette.status` / `theme.custom` resolve) and the toast provider (so
 * `useToast()` consumers don't throw).
 */
export function renderWithTheme(ui: ReactElement): RenderResult {
  return render(ui, {
    wrapper: ({ children }: { readonly children: ReactNode }) => (
      <ThemeProvider theme={appTheme}>
        <ToastProvider>{children}</ToastProvider>
      </ThemeProvider>
    ),
  });
}
