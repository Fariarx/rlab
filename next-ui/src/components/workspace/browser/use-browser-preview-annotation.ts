import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useCallback, useMemo } from "react";
import type { I18nApi } from "../../../i18n/I18nProvider";
import {
  createBrowserPreviewAnnotationState,
  viewportFromElement,
  type BrowserComponentSelection,
  type BrowserPoint,
  type BrowserSelectionRect,
  type BrowserSnapshot,
  type BrowserViewport,
  type PreviewMode,
} from "../../../lib/browser-preview-model";
import {
  annotationPanelSx,
  buildAnnotationMessage,
  buildComponentAnnotationMessage,
  cropComponentScreenshot,
  pickBrowserComponent,
  pointFromPointerEvent,
  selectionRectBetween,
} from "./browser-preview-selection";

type StateSetter<T> = (value: T | ((current: T) => T)) => void;

interface UseBrowserPreviewAnnotationInput {
  readonly comment: string;
  readonly componentSelection: BrowserComponentSelection | null;
  readonly dragStart: BrowserPoint | null;
  readonly frameRef: RefObject<HTMLIFrameElement | null>;
  readonly liveUrl: string | null;
  readonly mode: PreviewMode;
  readonly onAnnotationSent: () => void;
  readonly onSendAnnotation?: (message: string) => void;
  readonly selection: BrowserSelectionRect | null;
  readonly selectionViewport: BrowserViewport | null;
  readonly setComment: StateSetter<string>;
  readonly setComponentSelection: StateSetter<BrowserComponentSelection | null>;
  readonly setDragStart: StateSetter<BrowserPoint | null>;
  readonly setError: StateSetter<string | null>;
  readonly setMode: StateSetter<PreviewMode>;
  readonly setSelection: StateSetter<BrowserSelectionRect | null>;
  readonly setSelectionViewport: StateSetter<BrowserViewport | null>;
  readonly snapshot: BrowserSnapshot | null;
  readonly t: I18nApi["t"];
  readonly title: string;
}

export function useBrowserPreviewAnnotation({
  comment,
  componentSelection,
  dragStart,
  frameRef,
  liveUrl,
  mode,
  onAnnotationSent,
  onSendAnnotation,
  selection,
  selectionViewport,
  setComment,
  setComponentSelection,
  setDragStart,
  setError,
  setMode,
  setSelection,
  setSelectionViewport,
  snapshot,
  t,
  title,
}: UseBrowserPreviewAnnotationInput) {
  const viewport = selectionViewport ?? snapshot?.viewport;
  const annotationState = createBrowserPreviewAnnotationState({
    liveUrl,
    selection,
    dragStart,
    componentSelection,
    viewport,
    comment,
    canSend: onSendAnnotation !== undefined,
    regionLabel: t("browserPreviewRegionLabel"),
    regionDescription: selection
      ? t("browserPreviewRegionDescription", { x: selection.x, y: selection.y, width: selection.width, height: selection.height })
      : "",
  });
  const panelState = annotationState.panel;
  const panelPosition = useMemo(
    () => (panelState !== null ? annotationPanelSx(panelState.rect, panelState.viewport) : null),
    [panelState],
  );

  const clearSelection = useCallback(() => {
    setSelection(null);
    setComponentSelection(null);
    setDragStart(null);
    setSelectionViewport(null);
    setComment("");
  }, [setComment, setComponentSelection, setDragStart, setSelection, setSelectionViewport]);

  const changeMode = useCallback((_event: ReactMouseEvent<HTMLElement>, nextMode: PreviewMode | null) => {
    if (!nextMode) {
      return;
    }
    if (nextMode !== mode) {
      clearSelection();
    }
    setMode(nextMode);
  }, [clearSelection, mode, setMode]);

  const sendAnnotation = useCallback(() => {
    if (!liveUrl || !onSendAnnotation) {
      return;
    }
    if (componentSelection && annotationState.canSendComponent) {
      onSendAnnotation(buildComponentAnnotationMessage({ url: liveUrl, title }, componentSelection, comment));
    } else if (selection && annotationState.canSendAnnotation) {
      onSendAnnotation(buildAnnotationMessage({ url: liveUrl, title }, selection, comment));
    } else {
      return;
    }
    clearSelection();
    onAnnotationSent();
  }, [
    annotationState.canSendAnnotation,
    annotationState.canSendComponent,
    clearSelection,
    comment,
    componentSelection,
    liveUrl,
    onAnnotationSent,
    onSendAnnotation,
    selection,
    title,
  ]);

  const startSelection = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!liveUrl || mode !== "annotate") {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const nextViewport = viewportFromElement(event.currentTarget, snapshot?.viewport);
    setSelectionViewport(nextViewport);
    const point = pointFromPointerEvent(event, nextViewport);
    setDragStart(point);
    setSelection({ x: point.x, y: point.y, width: 0, height: 0 });
  }, [liveUrl, mode, setDragStart, setSelection, setSelectionViewport, snapshot]);

  const moveSelection = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!selectionViewport || !dragStart) {
      return;
    }
    event.preventDefault();
    setSelection(selectionRectBetween(dragStart, pointFromPointerEvent(event, selectionViewport)));
  }, [dragStart, selectionViewport, setSelection]);

  const finishSelection = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!dragStart) {
      return;
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setSelection(selection && selection.width >= 4 && selection.height >= 4 ? selection : null);
    setDragStart(null);
  }, [dragStart, selection, setDragStart, setSelection]);

  const pickComponent = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!liveUrl || mode !== "component") {
      return;
    }
    try {
      const picked = pickBrowserComponent(frameRef.current, event);
      setComponentSelection(picked);
      void cropComponentScreenshot(snapshot?.screenshot, picked.rect, picked.viewport).then((screenshotDataUrl) => {
        if (!screenshotDataUrl) {
          return;
        }
        setComponentSelection((current) => {
          if (
            !current
            || current.selector !== picked.selector
            || current.rect.x !== picked.rect.x
            || current.rect.y !== picked.rect.y
            || current.rect.width !== picked.rect.width
            || current.rect.height !== picked.rect.height
          ) {
            return current;
          }
          return { ...current, screenshotDataUrl };
        });
      });
      setSelection(null);
      setSelectionViewport(null);
      setError(null);
    } catch (pickError) {
      const message = pickError instanceof Error ? pickError.message : String(pickError);
      setComponentSelection(null);
      setError(t("browserPreviewComponentPickError", { error: message }));
    }
  }, [frameRef, liveUrl, mode, setComponentSelection, setError, setSelection, setSelectionViewport, snapshot, t]);

  return {
    annotationState,
    clearSelection,
    changeMode,
    finishSelection,
    moveSelection,
    panelPosition,
    panelState,
    pickComponent,
    sendAnnotation,
    startSelection,
    viewport,
  };
}
