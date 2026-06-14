import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ToastOptions } from "../src/components/ui";
import { useWorkspaceLoadErrorToast } from "../src/components/workspace/hooks/use-workspace-load-error-toast";
import type { I18nApi } from "../src/i18n/I18nProvider";

const t: I18nApi["t"] = (key, params) => (key === "workspaceError" ? `Workspace failed: ${params?.error}` : key);

function Harness({
  loadError,
  toast,
}: {
  readonly loadError: string | null | undefined;
  readonly toast: (options: ToastOptions) => string;
}) {
  useWorkspaceLoadErrorToast({ loadError, t, toast });
  return null;
}

describe("useWorkspaceLoadErrorToast", () => {
  it("shows a workspace load error once until the error clears", () => {
    const toast = vi.fn<(options: ToastOptions) => string>(() => "toast-1");
    const { rerender } = render(<Harness loadError="disk failed" toast={toast} />);

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenLastCalledWith({
      message: "Workspace failed: disk failed",
      severity: "error",
      duration: 5000,
    });

    rerender(<Harness loadError="disk failed" toast={toast} />);
    expect(toast).toHaveBeenCalledTimes(1);

    rerender(<Harness loadError={null} toast={toast} />);
    expect(toast).toHaveBeenCalledTimes(1);

    rerender(<Harness loadError="disk failed" toast={toast} />);
    expect(toast).toHaveBeenCalledTimes(2);
  });
});
