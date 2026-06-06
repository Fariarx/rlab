import { Stack } from "@mui/material";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Toast, type ToastSeverity } from "./Toast";

/**
 * ToastProvider — an imperative, queued notification system layered over the
 * kit's <Toast/> surface. MUI's Snackbar shows one message at a time with no
 * queue; this stacks them bottom-left (top on mobile) and auto-dismisses. Mount once near the
 * app root, then call `useToast()` anywhere beneath it.
 */
export interface ToastOptions {
  readonly message: ReactNode;
  readonly severity?: ToastSeverity;
  /** Auto-dismiss delay in ms; defaults to 5000. Pass 0 to disable. */
  readonly duration?: number;
  readonly action?: ReactNode;
}

interface ToastApi {
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

interface ActiveToast extends ToastOptions {
  readonly id: string;
}

const ToastContext = createContext<ToastApi | null>(null);

let toastSeq = 0;

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ActiveToast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer != null) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      toastSeq += 1;
      const id = `toast-${toastSeq}`;
      setToasts((current) => [...current, { ...options, id }]);

      const duration = options.duration ?? 5000;
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
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
          // Desktop: bottom-left. Mobile (narrow width): pinned to the top.
          bottom: { xs: "auto", md: 20 },
          top: { xs: 16, md: "auto" },
          left: { xs: 16, md: 20 },
          right: { xs: 16, md: "auto" },
          alignItems: { xs: "center", md: "flex-start" },
          pointerEvents: "none",
          "& > *": { pointerEvents: "auto" },
        }}
      >
        {toasts.map((item) => (
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
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (context == null) {
    throw new Error("useToast must be used within a <ToastProvider/>.");
  }
  return context;
}
