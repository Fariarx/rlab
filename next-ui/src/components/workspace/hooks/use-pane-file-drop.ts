import { type DragEvent, useCallback, useState } from "react";

export interface PaneFileDropController {
  readonly paneDragging: boolean;
  readonly onPaneDragEnter: (event: DragEvent) => void;
  readonly onPaneDragOver: (event: DragEvent) => void;
  readonly onPaneDragLeave: (event: DragEvent) => void;
  readonly onPaneDrop: (event: DragEvent) => void;
}

export interface UsePaneFileDropOptions {
  readonly addFiles: (files: readonly File[]) => void | Promise<void>;
}

function paneDragHasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types ?? []).includes("Files");
}

export function usePaneFileDrop({ addFiles }: UsePaneFileDropOptions): PaneFileDropController {
  const [paneDragDepth, setPaneDragDepth] = useState(0);
  const paneDragging = paneDragDepth > 0;

  const onPaneDragEnter = useCallback((event: DragEvent) => {
    if (!paneDragHasFiles(event)) {
      return;
    }
    event.preventDefault();
    setPaneDragDepth((depth) => depth + 1);
  }, []);

  const onPaneDragOver = useCallback((event: DragEvent) => {
    if (!paneDragHasFiles(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onPaneDragLeave = useCallback((event: DragEvent) => {
    if (!paneDragHasFiles(event)) {
      return;
    }
    setPaneDragDepth((depth) => Math.max(0, depth - 1));
  }, []);

  const onPaneDrop = useCallback((event: DragEvent) => {
    if (!paneDragHasFiles(event)) {
      return;
    }
    event.preventDefault();
    setPaneDragDepth(0);
    void addFiles(Array.from(event.dataTransfer.files));
  }, [addFiles]);

  return { paneDragging, onPaneDragEnter, onPaneDragOver, onPaneDragLeave, onPaneDrop };
}
