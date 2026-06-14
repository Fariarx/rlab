import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { I18nApi } from "../src/i18n/I18nProvider";
import type { AgentProfile } from "../src/components/agent";
import { listDirectories, loadFolderInfo } from "../src/client/api/directory-api";
import { type CreateProjectDialogController, useCreateProjectDialogController } from "../src/components/workspace/hooks/use-create-project-dialog-controller";

vi.mock("../src/client/api/directory-api", () => ({
  listDirectories: vi.fn(),
  loadFolderInfo: vi.fn(),
}));

const listDirectoriesMock = vi.mocked(listDirectories);
const loadFolderInfoMock = vi.mocked(loadFolderInfo);
const t: I18nApi["t"] = (key) => key;
const defaultProfile: AgentProfile = { agent: "codex", model: "gpt-5-codex", reasoning: "default", mode: "default" };

function Harness({
  open = true,
  onCreate,
  onClose,
  capture,
}: {
  readonly open?: boolean;
  readonly onCreate: (input: { readonly name: string; readonly path: string; readonly profile: AgentProfile }) => void;
  readonly onClose: () => void;
  readonly capture: (controller: CreateProjectDialogController) => void;
}) {
  const controller = useCreateProjectDialogController({ open, defaultProfile, onCreate, onClose, t });
  useEffect(() => {
    capture(controller);
  }, [capture, controller]);
  return null;
}

describe("useCreateProjectDialogController", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("loads the directory browser when opened", async () => {
    listDirectoriesMock.mockResolvedValueOnce({ path: "/repo", parent: "/", entries: [{ name: "src", path: "/repo/src" }] });
    const captured: { current: CreateProjectDialogController | null } = { current: null };

    render(<Harness onCreate={vi.fn()} onClose={vi.fn()} capture={(controller) => { captured.current = controller; }} />);

    await waitFor(() => expect(captured.current?.store.listing?.path).toBe("/repo"));
    expect(captured.current?.store.pathInput).toBe("/repo");
    expect(listDirectoriesMock).toHaveBeenCalledWith(undefined);
  });

  it("chooses the current folder and derives a missing project name", async () => {
    listDirectoriesMock.mockResolvedValueOnce({ path: "/workspace/rlab", parent: "/workspace", entries: [] });
    const captured: { current: CreateProjectDialogController | null } = { current: null };

    render(<Harness onCreate={vi.fn()} onClose={vi.fn()} capture={(controller) => { captured.current = controller; }} />);
    await waitFor(() => expect(captured.current?.store.listing?.path).toBe("/workspace/rlab"));

    act(() => {
      captured.current?.chooseCurrentFolder();
    });

    expect(captured.current?.store.path).toBe("/workspace/rlab");
    expect(captured.current?.store.name).toBe("rlab");
    expect(captured.current?.store.mode).toBe("form");
  });

  it("creates a project from folder info", async () => {
    listDirectoriesMock.mockResolvedValueOnce({ path: "/workspace", parent: "/", entries: [] });
    loadFolderInfoMock.mockResolvedValueOnce({ path: "/workspace/rlab", name: "rlab" });
    const onCreate = vi.fn();
    const onClose = vi.fn();
    const captured: { current: CreateProjectDialogController | null } = { current: null };

    render(<Harness onCreate={onCreate} onClose={onClose} capture={(controller) => { captured.current = controller; }} />);
    await waitFor(() => expect(captured.current).not.toBeNull());

    act(() => {
      captured.current?.store.setPath("/workspace/rlab");
    });
    await act(async () => {
      await captured.current?.create();
    });

    expect(loadFolderInfoMock).toHaveBeenCalledWith("/workspace/rlab");
    expect(onCreate).toHaveBeenCalledWith({ name: "rlab", path: "/workspace/rlab", profile: defaultProfile });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
