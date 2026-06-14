import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceUiApi } from "../src/lib/workspace-ui";
import { useWorkspaceUiApi } from "../src/components/workspace/hooks/use-workspace-ui-api";
import type { ConversationView } from "../src/components/agent";

interface BrowserOpenRequest {
  readonly url: string;
  readonly nonce: number;
}

interface GitFocusRequest {
  readonly path: string;
  readonly nonce: number;
}

type StateUpdater<T> = T | ((current: T) => T);

function resolveState<T>(current: T, updater: StateUpdater<T>): T {
  return typeof updater === "function" ? (updater as (value: T) => T)(current) : updater;
}

function Harness({
  showView,
  setBrowserOpenRequest,
  setGitFocus,
  capture,
}: {
  readonly showView: (view: ConversationView) => void;
  readonly setBrowserOpenRequest: (value: StateUpdater<BrowserOpenRequest>) => void;
  readonly setGitFocus: (value: StateUpdater<GitFocusRequest>) => void;
  readonly capture: (api: WorkspaceUiApi) => void;
}) {
  const api = useWorkspaceUiApi({ showView, setBrowserOpenRequest, setGitFocus });
  useEffect(() => {
    capture(api);
  }, [api, capture]);
  return null;
}

describe("useWorkspaceUiApi", () => {
  it("opens normalized preview URLs and switches to preview view", async () => {
    const showView = vi.fn();
    let browserOpenRequest: BrowserOpenRequest = { url: "", nonce: 2 };
    const setBrowserOpenRequest = vi.fn((updater: StateUpdater<BrowserOpenRequest>) => {
      browserOpenRequest = resolveState(browserOpenRequest, updater);
    });
    const captured: { current: WorkspaceUiApi | null } = { current: null };

    render(
      <Harness
        showView={showView}
        setBrowserOpenRequest={setBrowserOpenRequest}
        setGitFocus={vi.fn()}
        capture={(api) => {
          captured.current = api;
        }}
      />,
    );

    await waitFor(() => expect(captured.current).not.toBeNull());
    captured.current?.openPreview("vitest.dev/api");

    expect(browserOpenRequest).toEqual({ url: "https://vitest.dev/api", nonce: 3 });
    expect(showView).toHaveBeenCalledWith("preview");
  });

  it("opens Git files and switches to Git view", async () => {
    const showView = vi.fn();
    let gitFocus: GitFocusRequest = { path: "", nonce: 4 };
    const setGitFocus = vi.fn((updater: StateUpdater<GitFocusRequest>) => {
      gitFocus = resolveState(gitFocus, updater);
    });
    const captured: { current: WorkspaceUiApi | null } = { current: null };

    render(
      <Harness
        showView={showView}
        setBrowserOpenRequest={vi.fn()}
        setGitFocus={setGitFocus}
        capture={(api) => {
          captured.current = api;
        }}
      />,
    );

    await waitFor(() => expect(captured.current).not.toBeNull());
    captured.current?.openGitFile("src/App.tsx");

    expect(gitFocus).toEqual({ path: "src/App.tsx", nonce: 5 });
    expect(showView).toHaveBeenCalledWith("git");
  });
});
