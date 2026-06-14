import { useLayoutEffect, useRef, type RefObject } from "react";

export interface UseComposerDockHeightOptions {
  readonly visible: boolean;
  readonly setHeight: (height: number) => void;
}

export function useComposerDockHeight({ visible, setHeight }: UseComposerDockHeightOptions): RefObject<HTMLDivElement | null> {
  const dockRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const node = dockRef.current;
    if (!visible || !node) {
      setHeight(0);
      return;
    }
    const update = () => setHeight(node.offsetHeight);
    update();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [setHeight, visible]);

  return dockRef;
}
