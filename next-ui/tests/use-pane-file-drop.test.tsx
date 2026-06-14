import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePaneFileDrop } from "../src/components/workspace/hooks/use-pane-file-drop";

function Harness({ addFiles }: { readonly addFiles: (files: readonly File[]) => void }) {
  const paneFileDrop = usePaneFileDrop({ addFiles });
  return (
    <div
      data-testid="drop-zone"
      onDragEnter={paneFileDrop.onPaneDragEnter}
      onDragOver={paneFileDrop.onPaneDragOver}
      onDragLeave={paneFileDrop.onPaneDragLeave}
      onDrop={paneFileDrop.onPaneDrop}
    >
      {paneFileDrop.paneDragging ? "dragging" : "idle"}
    </div>
  );
}

describe("usePaneFileDrop", () => {
  it("ignores drag events without files", () => {
    const addFiles = vi.fn();
    render(<Harness addFiles={addFiles} />);

    fireEvent.dragEnter(screen.getByTestId("drop-zone"), { dataTransfer: { types: ["text/plain"], files: [] } });

    expect(screen.getByTestId("drop-zone")).toHaveTextContent("idle");
  });

  it("tracks nested file drag depth", () => {
    const addFiles = vi.fn();
    render(<Harness addFiles={addFiles} />);
    const dropZone = screen.getByTestId("drop-zone");

    fireEvent.dragEnter(dropZone, { dataTransfer: { types: ["Files"], files: [] } });
    fireEvent.dragEnter(dropZone, { dataTransfer: { types: ["Files"], files: [] } });
    fireEvent.dragLeave(dropZone, { dataTransfer: { types: ["Files"], files: [] } });

    expect(dropZone).toHaveTextContent("dragging");

    fireEvent.dragLeave(dropZone, { dataTransfer: { types: ["Files"], files: [] } });

    expect(dropZone).toHaveTextContent("idle");
  });

  it("sets copy drop effect during file drag over", () => {
    const addFiles = vi.fn();
    render(<Harness addFiles={addFiles} />);
    const dataTransfer = { types: ["Files"], files: [], dropEffect: "none" };

    fireEvent.dragOver(screen.getByTestId("drop-zone"), { dataTransfer });

    expect(dataTransfer.dropEffect).toBe("copy");
  });

  it("passes dropped files to the callback and clears drag state", () => {
    const addFiles = vi.fn();
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    render(<Harness addFiles={addFiles} />);
    const dropZone = screen.getByTestId("drop-zone");

    fireEvent.dragEnter(dropZone, { dataTransfer: { types: ["Files"], files: [file] } });
    fireEvent.drop(dropZone, { dataTransfer: { types: ["Files"], files: [file] } });

    expect(addFiles).toHaveBeenCalledWith([file]);
    expect(dropZone).toHaveTextContent("idle");
  });
});
