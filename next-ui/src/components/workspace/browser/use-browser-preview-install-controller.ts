import { useCallback, useEffect } from "react";
import { installBrowserPreview, loadBrowserPreviewInstallStatus } from "../../../client/api/settings-api";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface BrowserPreviewInstallController {
  readonly installPreviewBrowser: () => void;
}

export function useBrowserPreviewInstallController({
  active,
  browserInstalled,
  setBrowserInstalled,
  setInstallBrowserError,
  setInstallingBrowser,
}: {
  readonly active: boolean;
  readonly browserInstalled: boolean | null;
  readonly setBrowserInstalled: (value: boolean | null) => void;
  readonly setInstallBrowserError: (value: string | null) => void;
  readonly setInstallingBrowser: (value: boolean) => void;
}): BrowserPreviewInstallController {
  useEffect(() => {
    if (!active || browserInstalled !== null) {
      return;
    }
    let canceled = false;
    void (async () => {
      try {
        const installed = await loadBrowserPreviewInstallStatus();
        if (canceled) {
          return;
        }
        if (installed === null) {
          throw new Error("Browser preview install status response is invalid.");
        }
        setInstallBrowserError(null);
        setBrowserInstalled(installed);
      } catch (error) {
        if (!canceled) {
          setBrowserInstalled(false);
          setInstallBrowserError(errorMessage(error));
        }
      }
    })();
    return () => {
      canceled = true;
    };
  }, [active, browserInstalled, setBrowserInstalled, setInstallBrowserError]);

  const installPreviewBrowser = useCallback(() => {
    setInstallingBrowser(true);
    setInstallBrowserError(null);
    void (async () => {
      try {
        await installBrowserPreview();
        const installed = await loadBrowserPreviewInstallStatus();
        if (installed !== true) {
          throw new Error("Browser preview install status did not confirm installation.");
        }
        setBrowserInstalled(true);
      } catch (error) {
        setBrowserInstalled(false);
        setInstallBrowserError(errorMessage(error));
      } finally {
        setInstallingBrowser(false);
      }
    })();
  }, [setBrowserInstalled, setInstallBrowserError, setInstallingBrowser]);

  return { installPreviewBrowser };
}
