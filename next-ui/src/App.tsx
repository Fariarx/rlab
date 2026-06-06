import { CssBaseline, ThemeProvider } from "@mui/material";
import { AgentStatusProvider } from "./components/agent";
import { KitPage } from "./components/kit/KitPage";
import { ToastProvider } from "./components/ui";
import { WorkspacePage } from "./components/workspace/WorkspacePage";
import { useHashRoute } from "./lib/use-hash-route";
import { useThemeMode } from "./lib/use-theme-mode";
import { darkTheme, lightTheme } from "./theme/app-theme";

export function App() {
  const hash = useHashRoute();
  const { mode, toggle } = useThemeMode();
  const isKit = hash.startsWith("#/kit");
  const activeTheme = mode === "light" ? lightTheme : darkTheme;

  return (
    <ThemeProvider theme={activeTheme}>
      <CssBaseline />
      <AgentStatusProvider>
        <ToastProvider>
          {isKit ? <KitPage mode={mode} onToggleMode={toggle} /> : <WorkspacePage mode={mode} onToggleMode={toggle} />}
        </ToastProvider>
      </AgentStatusProvider>
    </ThemeProvider>
  );
}
