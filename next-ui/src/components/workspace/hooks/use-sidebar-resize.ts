import { type MouseEvent as ReactMouseEvent, type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, normalizeSidebarWidth } from "../../../lib/app-settings";

export interface SidebarResizeController {
  readonly sidebarShellRef: RefObject<HTMLDivElement | null>;
  readonly sidebarInnerRef: RefObject<HTMLDivElement | null>;
  readonly startSidebarResize: (event: ReactMouseEvent) => void;
}

export interface SidebarResizeOptions {
  readonly sidebarCollapsed: boolean;
  readonly sidebarWidth: number;
  readonly isResizingSidebar: boolean;
  readonly persistedSidebarWidth: number;
  readonly setSidebarWidth: (value: number) => void;
  readonly setIsResizingSidebar: (value: boolean) => void;
  readonly persistSidebarWidth: (value: number) => void;
}

export function useSidebarResize({
  sidebarCollapsed,
  sidebarWidth,
  isResizingSidebar,
  persistedSidebarWidth,
  setSidebarWidth,
  setIsResizingSidebar,
  persistSidebarWidth,
}: SidebarResizeOptions): SidebarResizeController {
  const sidebarWidthRef = useRef(sidebarWidth);
  const sidebarShellRef = useRef<HTMLDivElement | null>(null);
  const sidebarInnerRef = useRef<HTMLDivElement | null>(null);
  const resizeFrameRef = useRef<number | null>(null);

  const cancelResizeFrame = useCallback(() => {
    if (resizeFrameRef.current == null) {
      return;
    }
    window.cancelAnimationFrame(resizeFrameRef.current);
    resizeFrameRef.current = null;
  }, []);

  useEffect(() => cancelResizeFrame, [cancelResizeFrame]);

  useEffect(() => {
    const normalizedWidth = normalizeSidebarWidth(persistedSidebarWidth);
    if (isResizingSidebar || sidebarWidthRef.current === normalizedWidth) {
      return;
    }
    sidebarWidthRef.current = normalizedWidth;
    setSidebarWidth(normalizedWidth);
  }, [isResizingSidebar, persistedSidebarWidth, setSidebarWidth]);

  useLayoutEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
    if (sidebarShellRef.current) {
      sidebarShellRef.current.style.width = sidebarCollapsed ? "0px" : `${sidebarWidth}px`;
    }
    if (sidebarInnerRef.current) {
      sidebarInnerRef.current.style.width = `${sidebarWidth}px`;
    }
  }, [sidebarCollapsed, sidebarWidth]);

  const startSidebarResize = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidthRef.current;
    let latestWidth = startWidth;
    setIsResizingSidebar(true);

    const applyWidth = (next: number) => {
      latestWidth = next;
      sidebarWidthRef.current = next;
      if (resizeFrameRef.current != null) {
        return;
      }
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        if (sidebarShellRef.current) {
          sidebarShellRef.current.style.width = `${sidebarWidthRef.current}px`;
        }
        if (sidebarInnerRef.current) {
          sidebarInnerRef.current.style.width = `${sidebarWidthRef.current}px`;
        }
      });
    };

    const onMove = (moveEvent: MouseEvent) => {
      const next = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, startWidth + (moveEvent.clientX - startX)));
      applyWidth(next);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      cancelResizeFrame();
      if (sidebarShellRef.current) {
        sidebarShellRef.current.style.width = `${latestWidth}px`;
      }
      if (sidebarInnerRef.current) {
        sidebarInnerRef.current.style.width = `${latestWidth}px`;
      }
      const normalizedWidth = normalizeSidebarWidth(latestWidth);
      setSidebarWidth(normalizedWidth);
      persistSidebarWidth(normalizedWidth);
      setIsResizingSidebar(false);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [cancelResizeFrame, persistSidebarWidth, setIsResizingSidebar, setSidebarWidth]);

  return { sidebarShellRef, sidebarInnerRef, startSidebarResize };
}
