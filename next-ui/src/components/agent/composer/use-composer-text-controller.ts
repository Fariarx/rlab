import type { ChangeEvent, ClipboardEvent, FormEvent, KeyboardEvent, RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { I18nApi } from "../../../i18n/I18nProvider";
import { clipboardFilesForComposer, composerSendPayload, mergeComposerAttachments, pastedTextFileForComposer } from "./composer-attachments-model";
import { emptyComposerHistoryState, navigateComposerHistory, resetComposerHistoryState, type ComposerHistoryState } from "./composer-history-model";
import { applyComposerSuggestion, type ComposerSuggestion } from "./composer-suggestions-model";
import {
  normalizePluginTokenDeletion,
  type ComposerPluginTokenRange,
  tokenRangeForDeleteKey,
} from "./composer-plugin-tokens";
import { composerDraftsEqual, fileToAttachmentDraft } from "./composer-utils";
import type { ComposerAttachmentDraft, ComposerDraft } from "../core/types";

interface UseComposerTextControllerInput {
  readonly attachmentsControlled: boolean;
  readonly composerAttachments: readonly ComposerAttachmentDraft[];
  readonly composerValue: string;
  readonly history: readonly string[];
  readonly initialAttachments: readonly ComposerAttachmentDraft[];
  readonly initialValue: string;
  readonly onAttachmentError?: (message: string) => void;
  readonly onDraftChange?: (draft: ComposerDraft) => void;
  readonly onSend?: (value: string) => void;
  readonly onSendReview?: () => void;
  readonly pluginTokenRanges: readonly ComposerPluginTokenRange[];
  readonly reviewCount: number;
  readonly sending: boolean;
  readonly setActiveSuggestion: (value: number | ((current: number) => number)) => void;
  readonly setInternalAttachments: (value: readonly ComposerAttachmentDraft[]) => void;
  readonly setInternalValue: (value: string) => void;
  readonly setSending: (value: boolean) => void;
  readonly setSuggestDismissed: (value: boolean) => void;
  readonly suggestions: readonly ComposerSuggestion[];
  readonly suggestionsActiveIndex: number;
  readonly suggestionsOpen: boolean;
  readonly t: I18nApi["t"];
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly valueControlled: boolean;
}

interface UseComposerTextControllerResult {
  readonly addFiles: (files: readonly File[]) => Promise<void>;
  readonly applySuggestion: (suggestion: ComposerSuggestion) => void;
  readonly canSend: boolean;
  readonly handleBeforeInput: (event: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  readonly handleComposerChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  readonly handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly handlePaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  readonly hasComposerPayload: boolean;
  readonly latestDraftRef: RefObject<ComposerDraft>;
  readonly send: () => Promise<void>;
  readonly setComposerAttachments: (nextAttachments: readonly ComposerAttachmentDraft[]) => void;
  readonly setComposerValue: (nextValue: string) => void;
  readonly updateDraft: (draft: ComposerDraft) => void;
}

export function useComposerTextController({
  attachmentsControlled,
  composerAttachments,
  composerValue,
  history,
  initialAttachments,
  initialValue,
  onAttachmentError,
  onDraftChange,
  onSend,
  onSendReview,
  pluginTokenRanges,
  reviewCount,
  sending,
  setActiveSuggestion,
  setInternalAttachments,
  setInternalValue,
  setSending,
  setSuggestDismissed,
  suggestions,
  suggestionsActiveIndex,
  suggestionsOpen,
  t,
  textareaRef,
  valueControlled,
}: UseComposerTextControllerInput): UseComposerTextControllerResult {
  const historyStateRef = useRef<ComposerHistoryState>(emptyComposerHistoryState);
  const pendingCaretToEndRef = useRef(false);
  const pendingSelectionRef = useRef<{ readonly start: number; readonly end: number } | null>(null);
  const initialDraftRef = useRef<ComposerDraft>({ text: initialValue, attachments: initialAttachments });
  const localDraftDirtyRef = useRef(false);
  const latestDraftRef = useRef<ComposerDraft>({ text: composerValue, attachments: composerAttachments });
  latestDraftRef.current = { text: composerValue, attachments: composerAttachments };

  const updateDraft = useCallback((draft: ComposerDraft) => {
    localDraftDirtyRef.current = true;
    latestDraftRef.current = draft;
    if (!valueControlled) {
      setInternalValue(draft.text);
    }
    if (!attachmentsControlled) {
      setInternalAttachments(draft.attachments);
    }
    onDraftChange?.(draft);
  }, [attachmentsControlled, onDraftChange, setInternalAttachments, setInternalValue, valueControlled]);

  useEffect(() => {
    if (valueControlled || attachmentsControlled || localDraftDirtyRef.current) {
      return;
    }
    const nextInitialDraft: ComposerDraft = { text: initialValue, attachments: initialAttachments };
    if (composerDraftsEqual(initialDraftRef.current, nextInitialDraft)) {
      return;
    }
    initialDraftRef.current = nextInitialDraft;
    latestDraftRef.current = nextInitialDraft;
    setInternalValue(nextInitialDraft.text);
    setInternalAttachments(nextInitialDraft.attachments);
  }, [attachmentsControlled, initialAttachments, initialValue, setInternalAttachments, setInternalValue, valueControlled]);

  useLayoutEffect(() => {
    void composerValue;
    const pendingSelection = pendingSelectionRef.current;
    if (pendingSelection) {
      pendingSelectionRef.current = null;
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(pendingSelection.start, pendingSelection.end);
      }
      return;
    }
    if (!pendingCaretToEndRef.current) {
      return;
    }
    pendingCaretToEndRef.current = false;
    const el = textareaRef.current;
    if (el) {
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }
  }, [composerValue, textareaRef]);

  const setComposerValue = useCallback((nextValue: string) => {
    setSuggestDismissed(false);
    historyStateRef.current = resetComposerHistoryState(historyStateRef.current);
    updateDraft({ text: nextValue, attachments: latestDraftRef.current.attachments });
  }, [setSuggestDismissed, updateDraft]);

  // Accepting a mention/plugin suggestion always rewrites the trailing token at
  // the end of the value, so the caret belongs at the very end afterwards. We
  // pin it explicitly: a controlled textarea otherwise leaves the native caret
  // wherever the IME last put it, which on Android desyncs the visible caret
  // from the real selection once a mention is in the field.
  const applySuggestion = useCallback((suggestion: ComposerSuggestion) => {
    pendingCaretToEndRef.current = true;
    setComposerValue(applyComposerSuggestion(latestDraftRef.current.text, suggestion));
  }, [setComposerValue]);

  const replaceComposerRange = useCallback((start: number, end: number, replacement = "") => {
    const caret = start + replacement.length;
    pendingSelectionRef.current = { start: caret, end: caret };
    setComposerValue(composerValue.slice(0, start) + replacement + composerValue.slice(end));
  }, [composerValue, setComposerValue]);

  const deleteComposerPluginToken = useCallback((key: "Backspace" | "Delete"): boolean => {
    const el = textareaRef.current;
    if (!el || pluginTokenRanges.length === 0) {
      return false;
    }
    const range = tokenRangeForDeleteKey(pluginTokenRanges, el.selectionStart, el.selectionEnd, key);
    if (!range) {
      return false;
    }
    replaceComposerRange(range.start, range.end);
    return true;
  }, [pluginTokenRanges, replaceComposerRange, textareaRef]);

  const applyHistoryValue = useCallback((nextValue: string) => {
    pendingCaretToEndRef.current = true;
    updateDraft({ text: nextValue, attachments: latestDraftRef.current.attachments });
  }, [updateDraft]);

  const navigateHistory = useCallback((direction: "up" | "down"): boolean => {
    const result = navigateComposerHistory({ history, state: historyStateRef.current, currentValue: composerValue, direction });
    historyStateRef.current = result.state;
    if (result.value !== undefined) {
      applyHistoryValue(result.value);
    }
    return result.handled;
  }, [applyHistoryValue, composerValue, history]);

  const setComposerAttachments = useCallback((nextAttachments: readonly ComposerAttachmentDraft[]) => {
    updateDraft({ text: latestDraftRef.current.text, attachments: nextAttachments });
  }, [updateDraft]);

  const send = useCallback(async () => {
    const trimmed = composerValue.trim();
    const hasInput = trimmed.length > 0 || composerAttachments.length > 0;
    if (!hasInput && reviewCount === 0) {
      return;
    }
    setSending(true);
    if (hasInput) {
      onSend?.(composerSendPayload(trimmed, composerAttachments));
      updateDraft({ text: "", attachments: [] });
    }
    if (reviewCount > 0) {
      onSendReview?.();
    }
    setSending(false);
  }, [composerAttachments, composerValue, onSend, onSendReview, reviewCount, setSending, updateDraft]);

  const handleComposerChange = useCallback((event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const nextValue = event.target.value;
    const normalized = normalizePluginTokenDeletion(composerValue, nextValue, pluginTokenRanges);
    if (normalized) {
      pendingSelectionRef.current = { start: normalized.caret, end: normalized.caret };
      setComposerValue(normalized.value);
      return;
    }
    setComposerValue(nextValue);
  }, [composerValue, pluginTokenRanges, setComposerValue]);

  const handleBeforeInput = useCallback((event: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const nativeEvent = event.nativeEvent as InputEvent;
    if (nativeEvent.inputType === "deleteContentBackward" && deleteComposerPluginToken("Backspace")) {
      event.preventDefault();
      return;
    }
    if (nativeEvent.inputType === "deleteContentForward" && deleteComposerPluginToken("Delete")) {
      event.preventDefault();
    }
  }, [deleteComposerPluginToken]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestionsOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveSuggestion((index) => (index + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveSuggestion((index) => (index - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        const suggestion = suggestions[suggestionsActiveIndex];
        if (suggestion) {
          applySuggestion(suggestion);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSuggestDismissed(true);
        return;
      }
    }
    if ((event.key === "Backspace" || event.key === "Delete") && deleteComposerPluginToken(event.key)) {
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const el = textareaRef.current;
      const atStart = !el || (el.selectionStart === 0 && el.selectionEnd === 0);
      const atEnd = !el || (el.selectionStart === composerValue.length && el.selectionEnd === composerValue.length);
      const browsing = historyStateRef.current.index !== -1;
      if (event.key === "ArrowUp" && (browsing || atStart)) {
        if (navigateHistory("up")) {
          event.preventDefault();
          return;
        }
      }
      if (event.key === "ArrowDown" && browsing && atEnd) {
        if (navigateHistory("down")) {
          event.preventDefault();
          return;
        }
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }, [
    applySuggestion,
    composerValue,
    deleteComposerPluginToken,
    navigateHistory,
    send,
    setActiveSuggestion,
    setSuggestDismissed,
    suggestions,
    suggestionsActiveIndex,
    suggestionsOpen,
    textareaRef,
  ]);

  const addFiles = useCallback(async (files: readonly File[]) => {
    if (files.length === 0) {
      return;
    }
    const results = await Promise.allSettled(files.map(fileToAttachmentDraft));
    const ready: ComposerAttachmentDraft[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        ready.push(result.value);
      } else {
        onAttachmentError?.(t("attachmentFailed", { name: files[index].name }));
      }
    });
    if (ready.length > 0) {
      setComposerAttachments(mergeComposerAttachments(latestDraftRef.current.attachments, ready));
    }
  }, [onAttachmentError, setComposerAttachments, t]);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const clipboard = event.clipboardData;
    if (!clipboard) {
      return;
    }
    const pastedFiles = clipboardFilesForComposer(clipboard);
    if (pastedFiles.length > 0) {
      event.preventDefault();
      void addFiles(pastedFiles);
      return;
    }
    const pasted = clipboard.getData("text/plain") ?? "";
    const pastedTextFile = pastedTextFileForComposer(pasted);
    if (pastedTextFile) {
      event.preventDefault();
      void addFiles([pastedTextFile]);
    }
  }, [addFiles]);

  const hasComposerPayload = composerValue.trim().length > 0 || composerAttachments.length > 0;

  return {
    addFiles,
    applySuggestion,
    canSend: (hasComposerPayload || reviewCount > 0) && !sending,
    handleBeforeInput,
    handleComposerChange,
    handleKeyDown,
    hasComposerPayload,
    latestDraftRef,
    send,
    setComposerAttachments,
    setComposerValue,
    updateDraft,
    handlePaste,
  };
}
