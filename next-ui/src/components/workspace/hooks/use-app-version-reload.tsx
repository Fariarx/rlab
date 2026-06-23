import { useEffect } from "react";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import type { I18nApi } from "../../../i18n/I18nProvider";
import { loadAppVersion } from "../../../client/api/workspace-page-api";
import { IconButton, type ToastOptions } from "../../ui";

const DEFAULT_APP_VERSION_POLL_MS = 60_000;

const reloadCurrentWindow = () => window.location.reload();

export interface UseAppVersionReloadOptions {
  readonly t: I18nApi["t"];
  readonly toast: (options: ToastOptions) => string;
  readonly pollMs?: number;
  readonly reloadApp?: () => void;
}

export function useAppVersionReload({
  t,
  toast,
  pollMs = DEFAULT_APP_VERSION_POLL_MS,
  reloadApp = reloadCurrentWindow,
}: UseAppVersionReloadOptions): void {
  useEffect(() => {
    let baseline: string | null = null;
    let prompted = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const check = async () => {
      try {
        const version = await loadAppVersion();
        if (!version || version === "dev") {
          return;
        }
        if (baseline === null) {
          baseline = version;
          return;
        }
        if (version !== baseline && !prompted) {
          prompted = true;
          toast({
            message: t("newVersionAvailable"),
            severity: "info",
            duration: 0,
            action: (
              <IconButton aria-label={t("reloadApp")} tone="subtle" size="small" onClick={reloadApp}>
                <RefreshRoundedIcon sx={{ fontSize: 16 }} />
              </IconButton>
            ),
          });
        }
      } catch {
        // Transient offline/server errors are not actionable; the next poll retries.
      }
    };

    void check();
    timer = setInterval(check, pollMs);
    return () => {
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [pollMs, reloadApp, t, toast]);
}
