import type { ChangeEvent, ClipboardEvent, FormEvent, KeyboardEvent, RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { I18nApi } from "../../../i18n/I18nProvider";
import { clipboardFilesForComposer, composerSendPayload, isLargePasteInputType, mergeComposerAttachments, pastedTextFileForComposer, pastedTextFileFromBeforeInput } from "./composer-attachments-model";
import { emptyComposerHistoryState, navigateComposerHistory, resetComposerHistoryState, type ComposerHistoryState } from "./composer-history-model";
import { applyComposerSuggestion, type ComposerSuggestion } from "./composer-suggestions-model";
import {
  normalizePluginTokenDeletion,
  type ComposerPluginTokenRange,
  tokenRangeForDeleteKey,
} from "./composer-plugin-tokens";
import { composerDraftsEqual, fileToAttachmentDraft } from "./composer-utils";
import type { ComposerAttachmentDraft, ComposerDraft } from "../core/types";

const STALE_SUBMIT_CHANGE_GUARD_MIN_CHARS = 8;

interface StaleSubmitChangeGuard {
  readonly submittedText: string;
  userInputObserved: boolean;
}

interface UseComposerTextControllerInput {
  readonly attachmentsControlled: boolean;
  readonly composerAttachments: readonly ComposerAttachmentDraft[];
  readonly composerValue: string;
  readonly canSendWithoutPayload?: boolean;
  readonly history: readonly string[];
  readonly initialAttachments: readonly ComposerAttachmentDraft[];
  readonly initialValue: string;
  readonly onAttachmentError?: (message: string) => void;
  readonly onBeforeSend?: () => void | Promise<void>;
  readonly onDraftChange?: (draft: ComposerDraft) => void;
  readonly onSend?: (value: string, options?: { readonly includeReviewComments: boolean }) => void;
  readonly onSendReview?: () => void;
  readonly pluginTokenRanges: readonly ComposerPluginTokenRange[];
  readonly recentlySubmittedValue?: string;
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
  readonly attachmentUploadCount: number;
  readonly canSend: boolean;
  readonly handleBeforeInput: (event: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  readonly handleComposerChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  readonly handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly handlePaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  readonly hasComposerPayload: boolean;
  readonly latestDraftRef: RefObject<ComposerDraft>;
  readonly send: () => Promise<void>;
  readonly submitDraft: (handler: (value: string) => void) => Promise<boolean>;
  readonly setComposerAttachments: (nextAttachments: readonly ComposerAttachmentDraft[]) => void;
  readonly setComposerValue: (nextValue: string) => void;
  readonly updateDraft: (draft: ComposerDraft) => void;
}

function changeEventInputType(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): string | null {
  const nativeEvent = event.nativeEvent as Event & { readonly inputType?: unknown };
  return typeof nativeEvent.inputType === "string" ? nativeEvent.inputType : null;
}

function submittedChangeGuard(value: string | undefined): StaleSubmitChangeGuard | null {
  const submittedText = value?.trim() ?? "";
  return submittedText.length > 0 ? { submittedText, userInputObserved: false } : null;
}

function looksLikeStaleSubmittedChange(guard: StaleSubmitChangeGuard, previousValue: string, nextValue: string): boolean {
  const normalizedNextValue = nextValue.trim();
  return (
    !guard.userInputObserved
    && previousValue.trim().length === 0
    && normalizedNextValue.length >= STALE_SUBMIT_CHANGE_GUARD_MIN_CHARS
    && (guard.submittedText.includes(normalizedNextValue) || normalizedNextValue.includes(guard.submittedText))
  );
}

function isComposerEditingKey(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return false;
  }
  return event.key.length === 1 || event.key === "Backspace" || event.key === "Delete";
}

function insertedTextFromChange(previous: string, next: string): string {
  if (next.length <= previous.length) {
    return "";
  }
  let prefixLength = 0;
  while (prefixLength < previous.length && prefixLength < next.length && previous[prefixLength] === next[prefixLength]) {
    prefixLength += 1;
  }
  let suffixLength = 0;
  while (
    suffixLength < previous.length - prefixLength
    && suffixLength < next.length - prefixLength
    && previous[previous.length - 1 - suffixLength] === next[next.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }
  return next.slice(prefixLength, next.length - suffixLength);
}

export function useComposerTextController({
  attachmentsControlled,
  composerAttachments,
  composerValue,
  canSendWithoutPayload = false,
  history,
  initialAttachments,
  initialValue,
  onAttachmentError,
  onBeforeSend,
  onDraftChange,
  onSend,
  onSendReview,
  pluginTokenRanges,
  recentlySubmittedValue,
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
  const staleSubmitChangeGuardRef = useRef<StaleSubmitChangeGuard | null>(submittedChangeGuard(recentlySubmittedValue));
  const [attachmentUploadCount, setAttachmentUploadCount] = useState(0);
  latestDraftRef.current = { text: composerValue, attachments: composerAttachments };

  const clearStaleSubmitChangeGuard = useCallback(() => {
    staleSubmitChangeGuardRef.current = null;
  }, []);

  const armStaleSubmitChangeGuard = useCallback((submittedText: string) => {
    staleSubmitChangeGuardRef.current = submittedChangeGuard(submittedText);
  }, []);

  const markUserInputAfterSubmit = useCallback(() => {
    const guard = staleSubmitChangeGuardRef.current;
    if (guard) {
      guard.userInputObserved = true;
    }
  }, []);

  useEffect(() => {
    const guard = submittedChangeGuard(recentlySubmittedValue);
    if (!guard || latestDraftRef.current.text.trim().length > 0) {
      return;
    }
    if (staleSubmitChangeGuardRef.current?.submittedText !== guard.submittedText) {
      staleSubmitChangeGuardRef.current = guard;
    }
  }, [recentlySubmittedValue]);

  useEffect(() => clearStaleSubmitChangeGuard, [clearStaleSubmitChangeGuard]);

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

  const submitDraft = useCallback(async (handler: (value: string) => void): Promise<boolean> => {
    if (sending) {
      return false;
    }
    setSending(true);
    try {
      const beforeSend = onBeforeSend?.();
      if (beforeSend && typeof beforeSend.then === "function") {
        await beforeSend;
      }
      const draft = latestDraftRef.current;
      const trimmed = draft.text.trim();
      const hasInput = trimmed.length > 0 || draft.attachments.length > 0;
      if (!hasInput) {
        return false;
      }
      const payload = composerSendPayload(trimmed, draft.attachments);
      armStaleSubmitChangeGuard(draft.text);
      updateDraft({ text: "", attachments: [] });
      handler(payload);
      return true;
    } finally {
      setSending(false);
    }
  }, [armStaleSubmitChangeGuard, onBeforeSend, sending, setSending, updateDraft]);

  const send = useCallback(async () => {
    if (sending) {
      return;
    }
    const submitted = await submitDraft((payload) => {
      if (reviewCount > 0) {
        onSend?.(payload, { includeReviewComments: true });
        return;
      }
      onSend?.(payload);
    });
    if (!submitted && reviewCount === 0) {
      return;
    }
    try {
      if (!submitted && reviewCount > 0) {
        onSendReview?.();
      }
    } finally {
    }
  }, [onSend, onSendReview, reviewCount, sending, submitDraft]);

  const addFiles = useCallback(async (files: readonly File[]) => {
    if (files.length === 0) {
      return;
    }
    setAttachmentUploadCount((current) => current + files.length);
    try {
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
    } finally {
      setAttachmentUploadCount((current) => Math.max(0, current - files.length));
    }
  }, [onAttachmentError, setComposerAttachments, t]);

  useLayoutEffect(() => {
    // The textarea node can swap when composer overlays mount, so bind to the
    // current DOM node rather than relying on React's synthetic beforeinput.
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    const handleNativeBeforeInput = (event: InputEvent) => {
      const pastedTextFile = pastedTextFileFromBeforeInput(event);
      if (!pastedTextFile) {
        return;
      }
      event.preventDefault();
      clearStaleSubmitChangeGuard();
      void addFiles([pastedTextFile]);
    };
    el.addEventListener("beforeinput", handleNativeBeforeInput);
    return () => {
      el.removeEventListener("beforeinput", handleNativeBeforeInput);
    };
  });

  const handleComposerChange = useCallback((event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const nextValue = event.target.value;
    const insertedText = insertedTextFromChange(composerValue, nextValue);
    const inputType = changeEventInputType(event);
    const pastedTextFile = insertedText.length > 0 && isLargePasteInputType(inputType) ? pastedTextFileForComposer(insertedText) : null;
    if (pastedTextFile) {
      event.target.value = composerValue;
      clearStaleSubmitChangeGuard();
      void addFiles([pastedTextFile]);
      return;
    }
    const staleSubmittedChangeGuard = staleSubmitChangeGuardRef.current;
    if (staleSubmittedChangeGuard) {
      if (looksLikeStaleSubmittedChange(staleSubmittedChangeGuard, composerValue, nextValue)) {
        event.target.value = composerValue;
        return;
      }
      clearStaleSubmitChangeGuard();
    }
    const normalized = normalizePluginTokenDeletion(composerValue, nextValue, pluginTokenRanges);
    if (normalized) {
      pendingSelectionRef.current = { start: normalized.caret, end: normalized.caret };
      setComposerValue(normalized.value);
      return;
    }
    setComposerValue(nextValue);
  }, [addFiles, clearStaleSubmitChangeGuard, composerValue, pluginTokenRanges, setComposerValue]);

  const handleBeforeInput = useCallback((event: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const nativeEvent = event.nativeEvent as InputEvent;
    const pastedTextFile = pastedTextFileFromBeforeInput(nativeEvent);
    if (pastedTextFile) {
      event.preventDefault();
      clearStaleSubmitChangeGuard();
      void addFiles([pastedTextFile]);
      return;
    }
    if (nativeEvent.inputType === "deleteContentBackward" && deleteComposerPluginToken("Backspace")) {
      event.preventDefault();
      return;
    }
    if (nativeEvent.inputType === "deleteContentForward" && deleteComposerPluginToken("Delete")) {
      event.preventDefault();
    }
  }, [addFiles, clearStaleSubmitChangeGuard, deleteComposerPluginToken]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposerEditingKey(event)) {
      markUserInputAfterSubmit();
    }
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
    markUserInputAfterSubmit,
    navigateHistory,
    send,
    setActiveSuggestion,
    setSuggestDismissed,
    suggestions,
    suggestionsActiveIndex,
    suggestionsOpen,
    textareaRef,
  ]);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    markUserInputAfterSubmit();
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
  }, [addFiles, markUserInputAfterSubmit]);

  const hasComposerPayload = composerValue.trim().length > 0 || composerAttachments.length > 0;

  return {
    addFiles,
    applySuggestion,
    attachmentUploadCount,
    canSend: (hasComposerPayload || reviewCount > 0 || canSendWithoutPayload) && !sending && attachmentUploadCount === 0,
    handleBeforeInput,
    handleComposerChange,
    handleKeyDown,
    hasComposerPayload,
    latestDraftRef,
    send,
    submitDraft,
    setComposerAttachments,
    setComposerValue,
    updateDraft,
    handlePaste,
  };
}
