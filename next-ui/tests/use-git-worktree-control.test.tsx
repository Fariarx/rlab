import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { I18nApi } from "../src/i18n/I18nProvider";
import type { ToastOptions } from "../src/components/ui";
import type { GitWorktreeControl } from "../src/components/workspace/git/GitPanel";
import { useGitWorktreeControl } from "../src/components/workspace/git/use-git-worktree-control";
import { createWorktree, mergeWorktree } from "../src/client/api/workspace-page-api";

vi.mock("../src/client/api/workspace-page-api", () => ({
  createWorktree: vi.fn(),
  mergeWorktree: vi.fn(),
}));

const createWorktreeMock = vi.mocked(createWorktree);
const mergeWorktreeMock = vi.mocked(mergeWorktree);

const t: I18nApi["t"] = (key) => key;

function Harness({
  conversationId = "chat-1",
  basePath,
  worktreePath,
  setWorktree,
  reloadGit,
  toast,
  capture,
}: {
  readonly conversationId?: string;
  readonly basePath?: string | null;
  readonly worktreePath?: string;
  readonly setWorktree: (conversationId: string, worktreePath: string | undefined) => void;
  readonly reloadGit: () => void;
  readonly toast: (options: ToastOptions) => string;
  readonly capture: (control: GitWorktreeControl | undefined) => void;
}) {
  const control = useGitWorktreeControl({ conversationId, basePath: basePath === null ? undefined : (basePath ?? "/repo"), worktreePath, setWorktree, reloadGit, t, toast });
  useEffect(() => {
    capture(control);
  }, [capture, control]);
  return null;
}

describe("useGitWorktreeControl", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("does not expose controls without a base path", () => {
    const captured: { current: GitWorktreeControl | undefined } = { current: undefined };

    render(
      <Harness
        basePath={null}
        setWorktree={vi.fn()}
        reloadGit={vi.fn()}
        toast={vi.fn(() => "toast-1")}
        capture={(control) => {
          captured.current = control;
        }}
      />,
    );

    expect(captured.current).toBeUndefined();
  });

  it("creates a worktree and reloads Git", async () => {
    createWorktreeMock.mockResolvedValueOnce({ path: "/repo.worktrees/chat-1", branch: "chat-1" });
    const setWorktree = vi.fn();
    const reloadGit = vi.fn();
    const toast = vi.fn(() => "toast-1");
    const captured: { current: GitWorktreeControl | undefined } = { current: undefined };

    render(
      <Harness
        setWorktree={setWorktree}
        reloadGit={reloadGit}
        toast={toast}
        capture={(control) => {
          captured.current = control;
        }}
      />,
    );

    await act(async () => {
      captured.current?.onCreate();
    });

    expect(createWorktreeMock).toHaveBeenCalledWith("/repo");
    expect(setWorktree).toHaveBeenCalledWith("chat-1", "/repo.worktrees/chat-1");
    expect(reloadGit).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({ message: "worktreeCreatedToast", severity: "success", duration: 2500 });
    await waitFor(() => expect(captured.current?.busy).toBe(false));
  });

  it("merges a worktree and clears the conversation worktree path", async () => {
    mergeWorktreeMock.mockResolvedValueOnce();
    const setWorktree = vi.fn();
    const reloadGit = vi.fn();
    const toast = vi.fn(() => "toast-1");
    const captured: { current: GitWorktreeControl | undefined } = { current: undefined };

    render(
      <Harness
        worktreePath="/repo.worktrees/chat-1"
        setWorktree={setWorktree}
        reloadGit={reloadGit}
        toast={toast}
        capture={(control) => {
          captured.current = control;
        }}
      />,
    );

    await act(async () => {
      captured.current?.onMerge();
    });

    expect(mergeWorktreeMock).toHaveBeenCalledWith("/repo", "/repo.worktrees/chat-1");
    expect(setWorktree).toHaveBeenCalledWith("chat-1", undefined);
    expect(reloadGit).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({ message: "worktreeMergedToast", severity: "success", duration: 2500 });
  });

  it("reports create failures and clears busy state", async () => {
    createWorktreeMock.mockRejectedValueOnce(new Error("create failed"));
    const toast = vi.fn(() => "toast-1");
    const captured: { current: GitWorktreeControl | undefined } = { current: undefined };

    render(
      <Harness
        setWorktree={vi.fn()}
        reloadGit={vi.fn()}
        toast={toast}
        capture={(control) => {
          captured.current = control;
        }}
      />,
    );

    await act(async () => {
      captured.current?.onCreate();
    });

    expect(toast).toHaveBeenCalledWith({ message: "create failed", severity: "error", duration: 3500 });
    await waitFor(() => expect(captured.current?.busy).toBe(false));
  });
});
