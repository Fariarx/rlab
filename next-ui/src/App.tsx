import { CssBaseline, GlobalStyles, ThemeProvider } from "@mui/material";
import { useMemo } from "react";
import { AgentStatusProvider } from "./components/agent";
import { KitPage } from "./components/kit/KitPage";
import { ToastProvider } from "./components/ui";
import { useWorkspace } from "./components/workspace/use-workspace";
import { WorkspacePageView } from "./components/workspace/WorkspacePage";
import { I18nProvider } from "./i18n/I18nProvider";
import { buildHashRoute, parseHashRoute, type HashRoute, useHashRoute } from "./lib/use-hash-route";
import { buildAppTheme } from "./theme/app-theme";

export function App() {
  const hash = useHashRoute();
  const route = parseHashRoute(hash);
  const workspace = useWorkspace();
  const mode = workspace.settings.appearance.theme;
  const isKit = route.kind === "kit";
  const density = workspace.settings.appearance.density;
  const activeTheme = useMemo(() => buildAppTheme(mode, density), [density, mode]);
  const reduceMotion = workspace.settings.appearance.reduceMotion;

  const setTheme = () => {
    workspace.updateSettings({
      appearance: { theme: mode === "dark" ? "light" : "dark" },
    });
  };

  const navigate = (nextRoute: HashRoute) => {
    const nextHash = buildHashRoute(nextRoute);
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  };

  return (
    <ThemeProvider theme={activeTheme}>
      <CssBaseline />
      {reduceMotion && (
        <GlobalStyles
          styles={{
            "*, *::before, *::after": {
              animationDuration: "1ms !important",
              scrollBehavior: "auto !important",
              transitionDuration: "1ms !important",
            },
          }}
        />
      )}
      <AgentStatusProvider>
        <I18nProvider locale={workspace.settings.general.locale}>
          <ToastProvider>
            {isKit ? <KitPage mode={mode} onToggleMode={setTheme} /> : <WorkspacePageView workspace={workspace} route={route} onNavigate={navigate} />}
          </ToastProvider>
        </I18nProvider>
      </AgentStatusProvider>
    </ThemeProvider>
  );
}
