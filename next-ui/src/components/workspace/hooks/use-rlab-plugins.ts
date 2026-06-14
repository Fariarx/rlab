import { useEffect, useState } from "react";
import { loadRlabPlugins } from "../../../client/api/workspace-page-api";
import type { ComposerPluginLink } from "../../../lib/rlab-plugins";
import type { ToastOptions } from "../../ui";

export interface UseRlabPluginsOptions {
  readonly toast: (options: ToastOptions) => string;
}

export function useRlabPlugins({ toast }: UseRlabPluginsOptions): readonly ComposerPluginLink[] {
  const [plugins, setPlugins] = useState<readonly ComposerPluginLink[]>([]);

  useEffect(() => {
    let canceled = false;
    loadRlabPlugins()
      .then((loadedPlugins) => {
        if (!canceled) {
          setPlugins(loadedPlugins);
        }
      })
      .catch((error: unknown) => {
        if (!canceled) {
          setPlugins([]);
          toast({ message: error instanceof Error ? error.message : String(error), severity: "error", duration: 3000 });
        }
      });
    return () => {
      canceled = true;
    };
  }, [toast]);

  return plugins;
}
