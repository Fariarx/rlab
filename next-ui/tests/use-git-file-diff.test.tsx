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

const secondFile: GitFileStatus = {
  code: " M",
  gitPath: "src/second.ts",
  label: "Modified",
  path: "src/second.ts",
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

const updatedUnifiedDiff = [
  "diff --git a/src/file.ts b/src/file.ts",
  "index 2222222..3333333 100644",
  "--- a/src/file.ts",
  "+++ b/src/file.ts",
  "@@ -1 +1 @@",
  "-new",
  "+newer",
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
  targetFile = file,
  revisionKey = 0,
  onSnapshot,
}: {
  readonly autoLoad: boolean;
  readonly targetFile?: GitFileStatus;
  readonly revisionKey?: number | string;
  readonly onSnapshot: (snapshot: UseGitFileDiffResult) => void;
}) {
  const result = useGitFileDiff({
    cwd: "C:/repo",
    file: targetFile,
    mode: "worktree",
    autoLoad,
    revisionKey,
    unavailableMessage: "Diff unavailable",
  });

  useEffect(() => {
    onSnapshot(result);
  }, [onSnapshot, result]);

  return (
    <>
      <button type="button" onClick={result.loadDiff}>
        load
      </button>
      <button type="button" onClick={() => result.expandContext("after")}>
        expand
      </button>
    </>
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

  it("requests a fresh diff when the target file changes with the same revision", async () => {
    const snapshots: UseGitFileDiffResult[] = [];
    const secondFileDiff = unifiedDiff.replaceAll("src/file.ts", "src/second.ts");
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ diff: "", mode: "worktree", path: file.gitPath }))
      .mockResolvedValueOnce(jsonResponse({ diff: secondFileDiff, mode: "worktree", path: secondFile.gitPath }));

    const { rerender } = render(<Probe autoLoad={true} onSnapshot={(snapshot) => snapshots.push(snapshot)} />);
    await waitFor(() => expect(snapshots.at(-1)?.lines).toEqual([]));

    rerender(<Probe autoLoad={true} targetFile={secondFile} onSnapshot={(snapshot) => snapshots.push(snapshot)} />);

    await waitFor(() => expect(snapshots.at(-1)?.lines?.some((line) => line.text === "+new")).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/git-diff",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ cwd: "C:/repo", path: secondFile.gitPath, mode: "worktree" }),
      }),
    );
  });

  it("reloads an already requested diff when its revision changes", async () => {
    const snapshots: UseGitFileDiffResult[] = [];
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ diff: unifiedDiff, mode: "worktree", path: file.gitPath }))
      .mockResolvedValueOnce(jsonResponse({ diff: updatedUnifiedDiff, mode: "worktree", path: file.gitPath }));

    const { rerender } = render(<Probe autoLoad={false} revisionKey={1} onSnapshot={(snapshot) => snapshots.push(snapshot)} />);
    fireEvent.click(screen.getByRole("button", { name: "load" }));
    await waitFor(() => expect(snapshots.at(-1)?.lines?.some((line) => line.text === "+new")).toBe(true));

    rerender(<Probe autoLoad={false} revisionKey={2} onSnapshot={(snapshot) => snapshots.push(snapshot)} />);

    await waitFor(() => expect(snapshots.at(-1)?.lines?.some((line) => line.text === "+newer")).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reloads the diff with 20 more context lines on expansion", async () => {
    const snapshots: UseGitFileDiffResult[] = [];
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ diff: unifiedDiff, mode: "worktree", path: file.gitPath, contextLines: 3, oldLineCount: 40, newLineCount: 40 }))
      .mockResolvedValueOnce(jsonResponse({ diff: updatedUnifiedDiff, mode: "worktree", path: file.gitPath, contextLines: 23, oldLineCount: 40, newLineCount: 40 }));

    render(<Probe autoLoad={true} onSnapshot={(snapshot) => snapshots.push(snapshot)} />);

    await waitFor(() => expect(snapshots.at(-1)?.lines?.some((line) => line.text === "+new")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "expand" }));

    await waitFor(() => expect(snapshots.at(-1)?.lines?.some((line) => line.text === "+newer")).toBe(true));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/git-diff",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ cwd: "C:/repo", path: file.gitPath, mode: "worktree", contextLines: 23 }),
      }),
    );
    expect(snapshots.at(-1)?.contextLines).toBe(23);
    expect(snapshots.at(-1)?.oldLineCount).toBe(40);
    expect(snapshots.at(-1)?.newLineCount).toBe(40);
  });
});
