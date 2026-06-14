import { useEffect, useRef } from "react";
import type { I18nApi } from "../../../i18n/I18nProvider";
import type { ToastOptions } from "../../ui";

export interface UseWorkspaceLoadErrorToastInput {
  readonly loadError: string | null | undefined;
  readonly t: I18nApi["t"];
  readonly toast: (options: ToastOptions) => string;
}

export function useWorkspaceLoadErrorToast({ loadError, t, toast }: UseWorkspaceLoadErrorToastInput): void {
  const lastWorkspaceErrorToast = useRef<string | null>(null);

  useEffect(() => {
    if (!loadError) {
      lastWorkspaceErrorToast.current = null;
      return;
    }

    if (lastWorkspaceErrorToast.current === loadError) {
      return;
    }

    lastWorkspaceErrorToast.current = loadError;
    toast({ message: t("workspaceError", { error: loadError }), severity: "error", duration: 5000 });
  }, [loadError, t, toast]);
}
