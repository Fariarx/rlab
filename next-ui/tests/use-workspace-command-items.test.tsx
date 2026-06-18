import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import type { I18nApi } from "../src/i18n/I18nProvider";
import type { CommandPaletteItem } from "../src/components/workspace/hooks/use-command-palette-controller";
import { useWorkspaceCommandItems, type UseWorkspaceCommandItemsOptions } from "../src/components/workspace/hooks/use-workspace-command-items";

const t: I18nApi["t"] = (key) => key;

function Harness({
  options,
  capture,
}: {
  readonly options: UseWorkspaceCommandItemsOptions;
  readonly capture: (items: readonly CommandPaletteItem[]) => void;
}) {
  const items = useWorkspaceCommandItems(options);
  useEffect(() => {
    capture(items);
  }, [capture, items]);
  return null;
}

function options(): UseWorkspaceCommandItemsOptions {
  return {
    t,
    createConversation: vi.fn(),
    openConversationSearch: vi.fn(),
    openSettings: vi.fn(),
    openGit: vi.fn(),
    openPreview: vi.fn(),
    previewEnabled: true,
    toggleTheme: vi.fn(),
    openKit: vi.fn(),
  };
}

describe("useWorkspaceCommandItems", () => {
  it("builds the workspace command list in display order", async () => {
    const captured: { current: readonly CommandPaletteItem[] } = { current: [] };

    render(<Harness options={options()} capture={(items) => { captured.current = items; }} />);

    await waitFor(() => expect(captured.current.map((item) => item.id)).toEqual([
      "new-conversation",
      "search-conversations",
      "open-settings",
      "open-git",
      "open-preview",
      "toggle-theme",
      "open-kit",
    ]));
  });

  it("binds command actions to their workspace callbacks", async () => {
    const commandOptions = options();
    const captured: { current: readonly CommandPaletteItem[] } = { current: [] };

    render(<Harness options={commandOptions} capture={(items) => { captured.current = items; }} />);

    await waitFor(() => expect(captured.current.length).toBeGreaterThan(0));
    captured.current.find((item) => item.id === "open-git")?.action();
    captured.current.find((item) => item.id === "toggle-theme")?.action();

    expect(commandOptions.openGit).toHaveBeenCalledTimes(1);
    expect(commandOptions.toggleTheme).toHaveBeenCalledTimes(1);
  });

  it("omits the Preview command when the Preview tool is disabled", async () => {
    const captured: { current: readonly CommandPaletteItem[] } = { current: [] };

    render(<Harness options={{ ...options(), previewEnabled: false }} capture={(items) => { captured.current = items; }} />);

    await waitFor(() => expect(captured.current.map((item) => item.id)).not.toContain("open-preview"));
  });
});
