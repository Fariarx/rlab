import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { observer } from "mobx-react-lite";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitFileStatus } from "../src/lib/git-status";
import { useGitFileDiff, type UseGitFileDiffResult } from "../src/components/workspace/git/use-git-file-diff";

const file: GitFileStatus = {
  code: " M",
  gitPath: "src/file.ts",
  label: "Modified",
  path: "src/file.ts",
  staged: false,
  unstaged: true,
};

const unifiedDiff = [
  "diff --git a/src/file.ts b/src/file.ts",
  "index 1111111..2222222 100644",
  "--- a/src/file.ts",
  "+++ b/src/file.ts",
  "@@ -1 +1 @@",
  "-old",
  "+new",
].join("\n");

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

const Probe = observer(function Probe({
  autoLoad,
  onSnapshot,
}: {
  readonly autoLoad: boolean;
  readonly onSnapshot: (snapshot: UseGitFileDiffResult) => void;
}) {
  const result = useGitFileDiff({
    cwd: "C:/repo",
    file,
    mode: "worktree",
    autoLoad,
    unavailableMessage: "Diff unavailable",
  });

  useEffect(() => {
    onSnapshot(result);
  }, [onSnapshot, result]);

  return (
    <button type="button" onClick={result.loadDiff}>
      load
    </button>
  );
});

describe("useGitFileDiff", () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads and parses a file diff when auto-load is enabled", async () => {
    const snapshots: UseGitFileDiffResult[] = [];
    fetchMock.mockResolvedValueOnce(jsonResponse({ diff: unifiedDiff, mode: "worktree", path: file.gitPath }));

    render(<Probe autoLoad={true} onSnapshot={(snapshot) => snapshots.push(snapshot)} />);

    await waitFor(() => expect(snapshots.at(-1)?.lines?.some((line) => line.kind === "add")).toBe(true));
    expect(snapshots.at(-1)?.loading).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/git-diff",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ cwd: "C:/repo", path: file.gitPath, mode: "worktree" }),
      }),
    );
  });

  it("does not request the same card diff more than once", async () => {
    const snapshots: UseGitFileDiffResult[] = [];
    fetchMock.mockResolvedValue(jsonResponse({ diff: "", mode: "worktree", path: file.gitPath }));

    render(<Probe autoLoad={false} onSnapshot={(snapshot) => snapshots.push(snapshot)} />);
    fireEvent.click(screen.getByRole("button", { name: "load" }));
    await waitFor(() => expect(snapshots.at(-1)?.lines).toEqual([]));
    fireEvent.click(screen.getByRole("button", { name: "load" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
