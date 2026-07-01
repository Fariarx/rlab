import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useToast, type ToastOptions } from "../src/components/ui";
import { renderWithTheme } from "./util/render-with-theme";

function ToastHarness({ options }: { readonly options: ToastOptions }) {
  const { toast } = useToast();
  useEffect(() => {
    toast(options);
  }, [options, toast]);
  return null;
}

describe("ToastProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("duplicates error toasts to the browser console", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    renderWithTheme(<ToastHarness options={{ message: "save failed", severity: "error", duration: 0 }} />);

    expect(error).toHaveBeenCalledWith("save failed");
  });

  it("does not log non-error toasts", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    renderWithTheme(<ToastHarness options={{ message: "saved", severity: "success", duration: 0 }} />);

    expect(error).not.toHaveBeenCalled();
  });
});
