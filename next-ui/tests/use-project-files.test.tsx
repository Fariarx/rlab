import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToastOptions } from "../src/components/ui";
import { useProjectFiles } from "../src/components/workspace/hooks/use-project-files";
import { loadProjectFiles } from "../src/client/api/workspace-page-api";

vi.mock("../src/client/api/workspace-page-api", () => ({
  loadProjectFiles: vi.fn(),
}));

const loadProjectFilesMock = vi.mocked(loadProjectFiles);

function Harness({
  cwd,
  toast,
  capture,
}: {
  readonly cwd: string | undefined;
  readonly toast: (options: ToastOptions) => string;
  readonly capture: (files: readonly string[]) => void;
}) {
  const files = useProjectFiles({ cwd, toast });
  useEffect(() => {
    capture(files);
  }, [capture, files]);
  return null;
}

describe("useProjectFiles", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("loads files for the current cwd", async () => {
    loadProjectFilesMock.mockResolvedValueOnce(["src/app.ts", "README.md"]);
    const captured: { current: readonly string[] } = { current: [] };

    render(
      <Harness
        cwd="C:/repo"
        toast={vi.fn(() => "toast-1")}
        capture={(files) => {
          captured.current = files;
        }}
      />,
    );

    await waitFor(() => expect(captured.current).toEqual(["src/app.ts", "README.md"]));
    expect(loadProjectFilesMock).toHaveBeenCalledWith("C:/repo");
  });

  it("clears files when cwd is missing", async () => {
    loadProjectFilesMock.mockResolvedValueOnce(["src/app.ts"]);
    const captured: { current: readonly string[] } = { current: [] };
    const { rerender } = render(
      <Harness
        cwd="C:/repo"
        toast={vi.fn(() => "toast-1")}
        capture={(files) => {
          captured.current = files;
        }}
      />,
    );
    await waitFor(() => expect(captured.current).toEqual(["src/app.ts"]));

    rerender(
      <Harness
        cwd={undefined}
        toast={vi.fn(() => "toast-1")}
        capture={(files) => {
          captured.current = files;
        }}
      />,
    );

    await waitFor(() => expect(captured.current).toEqual([]));
  });

  it("clears files and reports load errors", async () => {
    loadProjectFilesMock.mockRejectedValueOnce(new Error("scan failed"));
    const toast = vi.fn(() => "toast-1");
    const captured: { current: readonly string[] } = { current: ["stale.ts"] };

    render(
      <Harness
        cwd="C:/repo"
        toast={toast}
        capture={(files) => {
          captured.current = files;
        }}
      />,
    );

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ message: "scan failed", severity: "error", duration: 3000 }));
    expect(captured.current).toEqual([]);
  });
});
