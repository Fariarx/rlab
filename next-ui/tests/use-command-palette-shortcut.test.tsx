import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCommandPaletteShortcut } from "../src/components/workspace/hooks/use-command-palette-shortcut";

function Harness({ setCommandPaletteOpen }: { readonly setCommandPaletteOpen: (open: boolean) => void }) {
  useCommandPaletteShortcut({ setCommandPaletteOpen });
  return null;
}

describe("useCommandPaletteShortcut", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens the command palette with ctrl+k and prevents the browser default", () => {
    const setCommandPaletteOpen = vi.fn();
    render(<Harness setCommandPaletteOpen={setCommandPaletteOpen} />);

    const event = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(setCommandPaletteOpen).toHaveBeenCalledTimes(1);
    expect(setCommandPaletteOpen).toHaveBeenCalledWith(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores plain k presses", () => {
    const setCommandPaletteOpen = vi.fn();
    render(<Harness setCommandPaletteOpen={setCommandPaletteOpen} />);

    const event = new KeyboardEvent("keydown", {
      key: "k",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(setCommandPaletteOpen).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
