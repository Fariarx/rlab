import { type ChangeEvent, type Ref, type RefObject, useCallback, useImperativeHandle, useRef } from "react";

/** Imperative handle so a parent drop-zone (the whole chat pane) can hand files
 *  to the composer's attachment pipeline. */
export interface ComposerHandle {
  readonly addFiles: (files: readonly File[]) => Promise<void>;
  readonly focus: () => void;
}

export interface UseComposerFileControllerInput {
  readonly addFiles: (files: readonly File[]) => Promise<void>;
  readonly forwardedRef: Ref<ComposerHandle>;
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

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  useImperativeHandle(forwardedRef, () => ({ addFiles, focus: focusComposerInput }), [addFiles, focusComposerInput]);

  return {
    chooseFiles,
    fileInputRef,
    openFilePicker,
  };
}
