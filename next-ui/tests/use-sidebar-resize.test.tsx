import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_SIDEBAR_WIDTH } from "../src/lib/app-settings";
import { useSidebarResize } from "../src/components/workspace/hooks/use-sidebar-resize";

function SidebarResizeHarness({ initialPersistedWidth, onPersist }: { readonly initialPersistedWidth: number; readonly onPersist: (width: number) => void }) {
  const [persistedWidth, setPersistedWidth] = useState(initialPersistedWidth);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const { sidebarShellRef, sidebarInnerRef, startSidebarResize } = useSidebarResize({
    sidebarCollapsed: false,
    sidebarWidth,
    isResizingSidebar,
    persistedSidebarWidth: persistedWidth,
    setSidebarWidth,
    setIsResizingSidebar,
    persistSidebarWidth: (width) => {
      onPersist(width);
      setPersistedWidth(width);
    },
  });

  return (
    <div>
      <div ref={sidebarShellRef} data-testid="shell">
        <div ref={sidebarInnerRef} data-testid="inner" />
      </div>
      <button data-testid="handle" type="button" onMouseDown={startSidebarResize}>
        resize
      </button>
    </div>
  );
}

describe("useSidebarResize", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("syncs DOM widths from persisted settings", async () => {
    render(<SidebarResizeHarness initialPersistedWidth={410} onPersist={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("shell")).toHaveStyle({ width: "410px" });
      expect(screen.getByTestId("inner")).toHaveStyle({ width: "410px" });
    });
  });

  it("persists the normalized width after dragging", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const onPersist = vi.fn();
    render(<SidebarResizeHarness initialPersistedWidth={300} onPersist={onPersist} />);

    fireEvent.mouseDown(screen.getByTestId("handle"), { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 1000 });
    fireEvent.mouseUp(window);

    expect(onPersist).toHaveBeenCalledWith(MAX_SIDEBAR_WIDTH);
    await waitFor(() => {
      expect(screen.getByTestId("shell")).toHaveStyle({ width: `${MAX_SIDEBAR_WIDTH}px` });
      expect(screen.getByTestId("inner")).toHaveStyle({ width: `${MAX_SIDEBAR_WIDTH}px` });
    });
  });
});
