import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { type CommandPaletteController, type CommandPaletteItem, useCommandPaletteController } from "../src/components/workspace/hooks/use-command-palette-controller";

const items: readonly CommandPaletteItem[] = [
  { id: "new", label: "New chat", keywords: ["conversation"], action: vi.fn() },
  { id: "settings", label: "Settings", keywords: ["preferences"], action: vi.fn() },
  { id: "git", label: "Git status", keywords: ["changes"], action: vi.fn() },
];

function Harness({
  open = true,
  onClose,
  capture,
}: {
  readonly open?: boolean;
  readonly onClose: () => void;
  readonly capture: (controller: CommandPaletteController) => void;
}) {
  const controller = useCommandPaletteController({ open, items, onClose });
  useEffect(() => {
    capture(controller);
  }, [capture, controller]);
  return null;
}

describe("useCommandPaletteController", () => {
  it("filters visible commands by label and keywords", async () => {
    const captured: { current: CommandPaletteController | null } = { current: null };

    render(<Harness onClose={vi.fn()} capture={(controller) => { captured.current = controller; }} />);

    await waitFor(() => expect(captured.current).not.toBeNull());
    act(() => {
      captured.current?.setQuery("preferences");
    });

    await waitFor(() => expect(captured.current?.visibleItems.map((item) => item.id)).toEqual(["settings"]));
  });

  it("wraps active command navigation", async () => {
    const captured: { current: CommandPaletteController | null } = { current: null };

    render(<Harness onClose={vi.fn()} capture={(controller) => { captured.current = controller; }} />);

    await waitFor(() => expect(captured.current).not.toBeNull());
    act(() => {
      captured.current?.moveActive(-1);
    });

    await waitFor(() => expect(captured.current?.activeItem?.id).toBe("git"));
  });

  it("runs a command and closes the palette", async () => {
    const action = vi.fn();
    const onClose = vi.fn();
    const captured: { current: CommandPaletteController | null } = { current: null };

    function CustomHarness() {
      const controller = useCommandPaletteController({
        open: true,
        items: [{ id: "custom", label: "Custom", action }],
        onClose,
      });
      useEffect(() => {
        captured.current = controller;
      }, [controller]);
      return null;
    }

    render(<CustomHarness />);

    await waitFor(() => expect(captured.current?.activeItem?.id).toBe("custom"));
    act(() => {
      if (captured.current?.activeItem) {
        captured.current.runCommand(captured.current.activeItem);
      }
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
