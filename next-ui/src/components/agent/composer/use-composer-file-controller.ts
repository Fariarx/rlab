import { type ChangeEvent, type Ref, type RefObject, useCallback, useImperativeHandle, useRef } from "react";
import type { ComposerDraft } from "../core/types";

/** Imperative handle so a parent drop-zone (the whole chat pane) can hand files
 *  to the composer's attachment pipeline. */
export interface ComposerHandle {
  readonly addFiles: (files: readonly File[]) => Promise<void>;
  readonly focus: () => void;
  readonly setDraft: (draft: ComposerDraft) => void;
}

export interface UseComposerFileControllerInput {
  readonly addFiles: (files: readonly File[]) => Promise<void>;
  readonly forwardedRef: Ref<ComposerHandle>;
  readonly setDraft: (draft: ComposerDraft) => void;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export interface ComposerFileController {
  readonly chooseFiles: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  readonly fileInputRef: RefObject<HTMLInputElement | null>;
  readonly openFilePicker: () => void;
}

export function useComposerFileController({
  addFiles,
  forwardedRef,
  setDraft,
  textareaRef,
}: UseComposerFileControllerInput): ComposerFileController {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const chooseFiles = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    await addFiles(files);
  }, [addFiles]);

  const focusComposerInput = useCallback(() => {
    textareaRef.current?.focus();
  }, [textareaRef]);

  const setComposerDraft = useCallback((draft: ComposerDraft) => {
    setDraft(draft);
    const moveCaretToEnd = () => {
      const input = textareaRef.current;
      if (!input) {
        return;
      }
      input.focus();
      const position = input.value.length;
      input.setSelectionRange(position, position);
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(moveCaretToEnd);
    } else {
      window.setTimeout(moveCaretToEnd, 0);
    }
  }, [setDraft, textareaRef]);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  useImperativeHandle(forwardedRef, () => ({ addFiles, focus: focusComposerInput, setDraft: setComposerDraft }), [addFiles, focusComposerInput, setComposerDraft]);

  return {
    chooseFiles,
    fileInputRef,
    openFilePicker,
  };
}
