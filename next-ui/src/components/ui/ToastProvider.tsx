import { Stack } from "@mui/material";
import { observer } from "mobx-react-lite";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Toast } from "./Toast";
import { ToastProviderStore, type ToastOptions } from "./toast-store";

export type { ToastOptions } from "./toast-store";

/**
 * ToastProvider — an imperative, queued notification system layered over the
 * kit's <Toast/> surface. MUI's Snackbar shows one message at a time with no
 * queue; this stacks them top-center and auto-dismisses. Mount once near the
 * app root, then call `useToast()` anywhere beneath it.
 */
interface ToastApi {
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

let toastSeq = 0;

export const ToastProvider = observer(function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [store] = useState(() => new ToastProviderStore());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    store.dismissToast(id);
    const timer = timers.current.get(id);
    if (timer != null) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, [store]);

  const toast = useCallback(
    (options: ToastOptions) => {
      toastSeq += 1;
      const id = `toast-${toastSeq}`;
      if (options.severity === "error") {
        console.error(options.message);
      }
      store.addToast({ ...options, id });

      const duration = options.duration ?? 5000;
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss, store],
  );

  const api = useMemo<ToastApi>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Stack
        spacing={1.25}
        sx={{
          position: "fixed",
          zIndex: (theme) => theme.zIndex.snackbar,
          top: { xs: 16, sm: 24 },
          left: "50%",
          width: { xs: "calc(100vw - 32px)", sm: "min(420px, calc(100vw - 48px))" },
          alignItems: "center",
          transform: "translateX(-50%)",
          pointerEvents: "none",
          "& > *": { width: "100%", pointerEvents: "auto" },
        }}
      >
        {store.toasts.map((item) => (
          <Toast
            key={item.id}
            severity={item.severity}
            message={item.message}
            action={item.action}
            onClose={() => dismiss(item.id)}
          />
        ))}
      </Stack>
    </ToastContext.Provider>
  );
});

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (context == null) {
    throw new Error("useToast must be used within a <ToastProvider/>.");
  }
  return context;
}
