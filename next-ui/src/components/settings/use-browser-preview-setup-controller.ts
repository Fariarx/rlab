import { useCallback, useEffect, useState } from "react";
import { installBrowserPreview, loadBrowserPreviewInstalled } from "../../client/api/settings-api";
import { BrowserPreviewSetupStore } from "./settings-dialog-store";
import { errorMessage } from "./settings-dialog-model";

export interface BrowserPreviewSetupController {
  readonly installBrowser: () => void;
  readonly store: BrowserPreviewSetupStore;
}

export function useBrowserPreviewSetupController(): BrowserPreviewSetupController {
  const [store] = useState(() => new BrowserPreviewSetupStore());
  const { setError, setInstalled, setInstalling } = store;

  const refreshStatus = useCallback(async () => {
    setError(null);
    try {
      setInstalled(await loadBrowserPreviewInstalled());
    } catch (error) {
      setInstalled(false);
      setError(errorMessage(error));
    }
  }, [setError, setInstalled]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const installBrowser = useCallback(() => {
    setInstalling(true);
    setError(null);
    void (async () => {
      try {
        await installBrowserPreview();
        await refreshStatus();
      } catch (error) {
        setError(errorMessage(error));
      } finally {
        setInstalling(false);
      }
    })();
  }, [refreshStatus, setError, setInstalling]);

  return { installBrowser, store };
}
