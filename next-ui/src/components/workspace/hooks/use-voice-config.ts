import { useCallback, useEffect, useState } from "react";
import { loadVoiceConfig, type VoiceConfigSnapshot } from "../../../client/api/workspace-page-api";
import type { ToastOptions } from "../../ui";

export interface UseVoiceConfigOptions {
  readonly toast: (options: ToastOptions) => string;
}

export interface VoiceConfigController {
  readonly config: VoiceConfigSnapshot;
  readonly refresh: () => void;
}

export function useVoiceConfig({ toast }: UseVoiceConfigOptions): VoiceConfigController {
  const [config, setConfig] = useState<VoiceConfigSnapshot>({ providers: {} });

  const refresh = useCallback(() => {
    loadVoiceConfig()
      .then(setConfig)
      .catch((error: unknown) => {
        setConfig({ providers: {} });
        toast({ message: error instanceof Error ? error.message : String(error), severity: "error", duration: 3000 });
      });
  }, [toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { config, refresh };
}
