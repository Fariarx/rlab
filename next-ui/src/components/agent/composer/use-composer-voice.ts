import { useCallback, useEffect, type MutableRefObject, type RefObject } from "react";
import { transcribeVoice } from "../../../client/api/voice-api";
import { useI18n } from "../../../i18n/I18nProvider";
import type { ComposerVoiceProvider } from "./composer-model";
import type { ComposerStore, ComposerVoiceSelectionRange } from "./composer-store";
import type { ComposerDraft } from "../core/types";
import { blobToBase64 } from "./composer-utils";
import {
  VOICE_NO_SPEECH_NOTICE_DELAY_MS,
  formatVoiceDuration,
  isMobileSpeechRecognitionRuntime,
  preferredAudioMimeType,
  speechRecognitionConstructor,
  voiceAmbientLevels,
  voiceIdleLevels,
  voiceLevelsFromTimeDomainData,
} from "./ComposerVoice";

export interface ComposerVoiceController {
  readonly cancelVoiceInput: () => void;
  readonly finishVoiceInput: () => Promise<void>;
  readonly setVoiceLevelCountForWidth: (levelCount: number) => void;
  readonly toggleVoiceInput: () => Promise<void>;
  readonly voiceAmbient: boolean;
  readonly voiceAvailable: boolean;
  readonly voiceDuration: string;
  readonly voiceInputActive: boolean;
  readonly voiceLabel: string;
  readonly voiceLevels: readonly number[];
  readonly voiceState: ComposerStore["voiceState"];
}

function normalizedDictationText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function draftEndsWithDictation(draftText: string, dictation: string): boolean {
  return normalizedDictationText(draftText).endsWith(dictation);
}

function clampedSelectionRange(text: string, textarea: HTMLTextAreaElement | null): { readonly start: number; readonly end: number } {
  if (!textarea) {
    return { start: text.length, end: text.length };
  }
  return clampedTextSelectionRange(text, { start: textarea.selectionStart, end: textarea.selectionEnd });
}

function clampedTextSelectionRange(text: string, selection: Pick<ComposerVoiceSelectionRange, "start" | "end">): { readonly start: number; readonly end: number } {
  const selectionStart = Math.max(0, Math.min(selection.start, text.length));
  const selectionEnd = Math.max(0, Math.min(selection.end, text.length));
  return {
    start: Math.min(selectionStart, selectionEnd),
    end: Math.max(selectionStart, selectionEnd),
  };
}

function insertDictationAtSelection(
  text: string,
  selection: { readonly start: number; readonly end: number },
  dictation: string,
): { readonly text: string; readonly caret: number } {
  const before = text.slice(0, selection.start);
  const after = text.slice(selection.end);
  const prefix = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const suffix = after.length > 0 && !/^\s/.test(after) ? " " : "";
  const nextText = `${before}${prefix}${dictation}${suffix}${after}`;
  return { text: nextText, caret: before.length + prefix.length + dictation.length + suffix.length };
}

export function useComposerVoice({
  latestDraftRef,
  onVoiceError,
  store,
  textareaRef,
  updateDraft,
  voiceProvider,
  cancelOnUnmount = true,
}: {
  readonly latestDraftRef: MutableRefObject<ComposerDraft>;
  readonly onVoiceError?: (message: string) => void;
  readonly store: ComposerStore;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly updateDraft: (draft: ComposerDraft) => void;
  readonly voiceProvider?: ComposerVoiceProvider;
  readonly cancelOnUnmount?: boolean;
}): ComposerVoiceController {
  const { t } = useI18n();
  const {
    voiceState,
    setVoiceState,
    voiceRecordingStartedAt,
    setVoiceRecordingStartedAt,
    voiceClock,
    setVoiceClock,
    voiceLevels,
    setVoiceLevels,
    voiceAmbient,
    setVoiceAmbient,
    browserVoiceSupported,
    setBrowserVoiceSupported,
    setVoicePendingSelection,
  } = store;

  const resolveVoiceStopWaiter = useCallback(() => {
    const waiter = store.voiceStopWaiter;
    store.voiceStopWaiter = null;
    waiter?.resolve();
  }, [store]);

  const restoreComposerFocus = useCallback(() => {
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }
      textarea.focus({ preventScroll: true });
    });
  }, [textareaRef]);

  const voiceStopWaiter = useCallback((): Promise<void> => {
    if (store.voiceStopWaiter) {
      return store.voiceStopWaiter.promise;
    }
    let resolveWaiter: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      resolveWaiter = resolve;
    });
    store.voiceStopWaiter = { promise, resolve: resolveWaiter };
    return promise;
  }, [store]);

  const setVoiceLevelCountForWidth = useCallback(
    (levelCount: number) => {
      if (store.voiceLevelCount === levelCount) {
        return;
      }
      store.voiceLevelCount = levelCount;
      setVoiceLevels((current) => (current.length === levelCount ? current : voiceAmbient ? voiceAmbientLevels(levelCount) : voiceIdleLevels(levelCount)));
    },
    [setVoiceLevels, store, voiceAmbient],
  );

  const setAmbientVoiceLevels = useCallback(
    (enabled: boolean) => {
      setVoiceAmbient(enabled);
      if (enabled) {
        const levels = voiceAmbientLevels(store.voiceLevelCount);
        store.voiceLevelValues = levels;
        setVoiceLevels(levels);
      }
    },
    [setVoiceAmbient, setVoiceLevels, store],
  );

  const clearVoiceNoSpeechNotice = useCallback(() => {
    if (store.voiceNoSpeechTimer !== null) {
      window.clearTimeout(store.voiceNoSpeechTimer);
      store.voiceNoSpeechTimer = null;
    }
  }, [store]);

  const scheduleVoiceNoSpeechNotice = useCallback(() => {
    if (store.voiceRecognized || store.voiceNoSpeechNotified || store.voiceNoSpeechTimer !== null) {
      return;
    }
    store.voiceNoSpeechTimer = window.setTimeout(() => {
      store.voiceNoSpeechTimer = null;
      if (!store.voiceRecognized) {
        store.voiceNoSpeechNotified = true;
        onVoiceError?.(t("voiceNoSpeech"));
      }
    }, VOICE_NO_SPEECH_NOTICE_DELAY_MS);
  }, [onVoiceError, store, t]);

  const appendDictation = useCallback(
    (text: string): boolean => {
      const cleanText = text.trim();
      if (!cleanText) {
        return false;
      }
      store.voiceRecognized = true;
      clearVoiceNoSpeechNotice();
      const currentText = latestDraftRef.current.text;
      const pendingSelection = store.voicePendingSelection;
      setVoicePendingSelection(null);
      const selection = pendingSelection && pendingSelection.text === currentText
        ? clampedTextSelectionRange(currentText, pendingSelection)
        : clampedSelectionRange(currentText, textareaRef.current);
      const inserted = insertDictationAtSelection(currentText, selection, cleanText);
      updateDraft({ text: inserted.text, attachments: latestDraftRef.current.attachments });
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) {
          return;
        }
        textarea.focus();
        textarea.setSelectionRange(inserted.caret, inserted.caret);
      });
      return true;
    },
    [clearVoiceNoSpeechNotice, latestDraftRef, setVoicePendingSelection, store, textareaRef, updateDraft],
  );

  const commitBrowserInterimDictation = useCallback((): boolean => {
    const interim = store.voiceBrowserInterimTranscript;
    store.voiceBrowserInterimTranscript = "";
    const cleanInterim = normalizedDictationText(interim);
    const committed = appendDictation(interim);
    if (committed) {
      store.voiceCommittedInterimTranscript = cleanInterim;
    }
    return committed;
  }, [appendDictation, store]);

  const stopVoiceAnalyser = useCallback(() => {
    setVoiceAmbient(false);
    if (store.voiceAnalyserFrame !== null) {
      cancelAnimationFrame(store.voiceAnalyserFrame);
      store.voiceAnalyserFrame = null;
    }
    const context = store.voiceAudioContext;
    store.voiceAudioContext = null;
    if (context && context.state !== "closed") {
      void context.close();
    }
    const idleLevels = voiceIdleLevels(store.voiceLevelCount);
    store.voiceLevelValues = idleLevels;
    setVoiceLevels(idleLevels);
  }, [setVoiceAmbient, setVoiceLevels, store]);

  const stopVoiceTracks = useCallback(() => {
    stopVoiceAnalyser();
    store.voiceMediaStream?.getTracks().forEach((track) => {
      track.stop();
    });
    store.voiceMediaStream = null;
  }, [stopVoiceAnalyser, store]);

  const startVoiceAnalyser = useCallback(
    (stream: MediaStream) => {
      stopVoiceAnalyser();
      const AudioContextConstructor = window.AudioContext;
      const context = new AudioContextConstructor();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.35;
      context.createMediaStreamSource(stream).connect(analyser);
      store.voiceAudioContext = context;
      const data = new Uint8Array(analyser.fftSize);
      const tick = (now: number) => {
        analyser.getByteTimeDomainData(data);
        const next = voiceLevelsFromTimeDomainData(data, store.voiceLevelCount);
        store.voiceLevelValues = next;
        if (now - store.voiceLevelLastPaint > 70) {
          store.voiceLevelLastPaint = now;
          setVoiceLevels(next);
        }
        store.voiceAnalyserFrame = requestAnimationFrame(tick);
      };
      store.voiceAnalyserFrame = requestAnimationFrame(tick);
    },
    [setVoiceLevels, stopVoiceAnalyser, store],
  );

  useEffect(() => {
    setBrowserVoiceSupported(voiceProvider?.kind === "browser" && speechRecognitionConstructor() !== null);
  }, [setBrowserVoiceSupported, voiceProvider?.kind]);

  useEffect(
    () => () => {
      if (!cancelOnUnmount) {
        return;
      }
      store.voiceStopIntent = "cancel";
      clearVoiceNoSpeechNotice();
      store.voiceRecognition?.stop();
      if (store.voiceMediaRecorder?.state === "recording") {
        store.voiceMediaRecorder.stop();
      }
      stopVoiceTracks();
      setVoiceState("idle");
      resolveVoiceStopWaiter();
    },
    [cancelOnUnmount, clearVoiceNoSpeechNotice, resolveVoiceStopWaiter, setVoiceState, stopVoiceTracks, store],
  );

  useEffect(() => {
    if (voiceState !== "recording") {
      setVoiceRecordingStartedAt(null);
      return undefined;
    }
    if (voiceRecordingStartedAt === null) {
      setVoiceRecordingStartedAt(Date.now());
    }
    const timer = window.setInterval(() => setVoiceClock((value) => value + 1), 250);
    return () => window.clearInterval(timer);
  }, [setVoiceClock, setVoiceRecordingStartedAt, voiceRecordingStartedAt, voiceState]);

  const transcribeCloudAudio = useCallback(
    async (blob: Blob) => {
      if (voiceProvider?.kind !== "cloud") {
        return;
      }
      const text = await transcribeVoice({
        provider: voiceProvider.id,
        mimeType: blob.type || "application/octet-stream",
        dataBase64: await blobToBase64(blob),
        language: voiceProvider.language,
      });
      if (!appendDictation(text)) {
        scheduleVoiceNoSpeechNotice();
      }
    },
    [appendDictation, scheduleVoiceNoSpeechNotice, voiceProvider],
  );

  const startBrowserDictation = useCallback(async () => {
    if (voiceProvider?.kind !== "browser") {
      return;
    }
    const Recognition = speechRecognitionConstructor();
    if (!Recognition) {
      onVoiceError?.(t("voiceInputUnavailable", { provider: voiceProvider.name }));
      return;
    }
    try {
      const isMobileRuntime = isMobileSpeechRecognitionRuntime();
      if (!isMobileRuntime && navigator.mediaDevices && typeof window.AudioContext !== "undefined") {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        store.voiceMediaStream = stream;
        startVoiceAnalyser(stream);
      } else {
        setAmbientVoiceLevels(true);
      }
      const recognition = new Recognition();
      const allowAutoRestart = !isMobileRuntime;
      recognition.lang = voiceProvider.language;
      recognition.continuous = allowAutoRestart;
      recognition.interimResults = true;
      const finishRecognition = () => {
        store.voiceRecognition = null;
        clearVoiceNoSpeechNotice();
        stopVoiceTracks();
        setVoiceState("idle");
        resolveVoiceStopWaiter();
      };
      recognition.onresult = (event) => {
        if (store.voiceStopIntent === "cancel") {
          return;
        }
        let finalTranscript = "";
        let interimTranscript = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (result?.isFinal) {
            finalTranscript += result[0]?.transcript ?? "";
          } else {
            interimTranscript += result?.[0]?.transcript ?? "";
          }
        }
        const cleanFinalTranscript = normalizedDictationText(finalTranscript);
        if (cleanFinalTranscript) {
          store.voiceBrowserInterimTranscript = "";
          if (
            store.voiceCommittedInterimTranscript === cleanFinalTranscript
            && draftEndsWithDictation(latestDraftRef.current.text, cleanFinalTranscript)
          ) {
            store.voiceCommittedInterimTranscript = "";
            return;
          }
          store.voiceCommittedInterimTranscript = "";
          appendDictation(finalTranscript);
          return;
        }
        if (interimTranscript.trim()) {
          store.voiceBrowserInterimTranscript = interimTranscript;
          store.voiceRecognized = true;
          clearVoiceNoSpeechNotice();
        }
      };
      recognition.onerror = (event) => {
        if (store.voiceManualStop && (event.error === "aborted" || event.error === "no-speech")) {
          if (store.voiceStopIntent !== "cancel") {
            commitBrowserInterimDictation();
          }
          finishRecognition();
          return;
        }
        if (!store.voiceManualStop && event.error === "no-speech") {
          scheduleVoiceNoSpeechNotice();
          return;
        }
        clearVoiceNoSpeechNotice();
        store.voiceManualStop = true;
        stopVoiceTracks();
        onVoiceError?.(t("voiceTranscriptionFailed", { error: event.message || event.error || "unknown" }));
        setVoiceState("idle");
        resolveVoiceStopWaiter();
      };
      recognition.onend = () => {
        const canceled = store.voiceStopIntent === "cancel";
        const committed = canceled ? false : commitBrowserInterimDictation();
        const shouldReportNoSpeech = !canceled && !committed && !store.voiceManualStop && !store.voiceRecognized;
        if (!canceled && allowAutoRestart && !store.voiceManualStop && store.voiceRecognition === recognition) {
          window.setTimeout(() => {
            if (store.voiceManualStop || store.voiceRecognition !== recognition) {
              return;
            }
            try {
              recognition.start();
            } catch (error) {
              store.voiceManualStop = true;
              store.voiceRecognition = null;
              clearVoiceNoSpeechNotice();
              stopVoiceTracks();
              setVoiceState("idle");
              onVoiceError?.(t("voiceTranscriptionFailed", { error: error instanceof Error ? error.message : String(error) }));
            }
          }, 120);
          return;
        }
        finishRecognition();
        if (shouldReportNoSpeech) {
          scheduleVoiceNoSpeechNotice();
        }
      };
      store.voiceManualStop = false;
      store.voiceStopIntent = "recording";
      store.voiceStopWaiter = null;
      store.voiceRecognized = false;
      store.voiceNoSpeechNotified = false;
      store.voiceBrowserInterimTranscript = "";
      store.voiceCommittedInterimTranscript = "";
      clearVoiceNoSpeechNotice();
      store.voiceRecognition = recognition;
      setVoiceRecordingStartedAt(Date.now());
      setVoiceState("recording");
      recognition.start();
    } catch (error) {
      clearVoiceNoSpeechNotice();
      stopVoiceTracks();
      setVoiceState("idle");
      onVoiceError?.(t("voiceTranscriptionFailed", { error: error instanceof Error ? error.message : String(error) }));
    }
  }, [appendDictation, clearVoiceNoSpeechNotice, commitBrowserInterimDictation, latestDraftRef, onVoiceError, resolveVoiceStopWaiter, scheduleVoiceNoSpeechNotice, setAmbientVoiceLevels, setVoiceRecordingStartedAt, setVoiceState, startVoiceAnalyser, stopVoiceTracks, store, t, voiceProvider]);

  const startCloudDictation = useCallback(async () => {
    if (voiceProvider?.kind !== "cloud") {
      return;
    }
    if (!voiceProvider.configured || !navigator.mediaDevices || typeof MediaRecorder === "undefined") {
      onVoiceError?.(t("voiceInputUnavailable", { provider: voiceProvider.name }));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      store.voiceMediaStream = stream;
      startVoiceAnalyser(stream);
      const chunks: Blob[] = [];
      const mimeType = preferredAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      store.voiceMediaRecorder = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onerror = (event) => {
        onVoiceError?.(t("voiceTranscriptionFailed", { error: event.error.message }));
        store.voiceMediaRecorder = null;
        stopVoiceTracks();
        setVoiceState("idle");
        resolveVoiceStopWaiter();
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || "audio/webm";
        const audio = new Blob(chunks, { type });
        store.voiceMediaRecorder = null;
        stopVoiceTracks();
        if (store.voiceStopIntent === "cancel") {
          setVoiceState("idle");
          resolveVoiceStopWaiter();
          return;
        }
        if (audio.size === 0) {
          setVoiceState("idle");
          scheduleVoiceNoSpeechNotice();
          resolveVoiceStopWaiter();
          return;
        }
        setVoiceState("transcribing");
        void transcribeCloudAudio(audio)
          .catch((error: unknown) => onVoiceError?.(t("voiceTranscriptionFailed", { error: error instanceof Error ? error.message : String(error) })))
          .finally(() => {
            setVoiceState("idle");
            resolveVoiceStopWaiter();
          });
      };
      store.voiceRecognized = false;
      store.voiceStopIntent = "recording";
      store.voiceStopWaiter = null;
      store.voiceNoSpeechNotified = false;
      clearVoiceNoSpeechNotice();
      setVoiceRecordingStartedAt(Date.now());
      setVoiceState("recording");
      recorder.start();
    } catch (error) {
      clearVoiceNoSpeechNotice();
      stopVoiceTracks();
      setVoiceState("idle");
      onVoiceError?.(t("voiceTranscriptionFailed", { error: error instanceof Error ? error.message : String(error) }));
    }
  }, [clearVoiceNoSpeechNotice, onVoiceError, resolveVoiceStopWaiter, scheduleVoiceNoSpeechNotice, setVoiceRecordingStartedAt, setVoiceState, startVoiceAnalyser, stopVoiceTracks, store, t, transcribeCloudAudio, voiceProvider]);

  const stopRecording = useCallback((intent: Exclude<typeof store.voiceStopIntent, "recording">): Promise<void> => {
    if (voiceState !== "recording") {
      return Promise.resolve();
    }
    store.voiceStopIntent = intent;
    store.voiceManualStop = true;
    clearVoiceNoSpeechNotice();
    const waitForStop = voiceStopWaiter();
    let requestedStop = false;
    const recognition = store.voiceRecognition;
    if (recognition) {
      requestedStop = true;
      try {
        recognition.stop();
      } catch (error) {
        store.voiceRecognition = null;
        stopVoiceTracks();
        setVoiceState("idle");
        resolveVoiceStopWaiter();
        onVoiceError?.(t("voiceTranscriptionFailed", { error: error instanceof Error ? error.message : String(error) }));
      }
    }
    const recorder = store.voiceMediaRecorder;
    if (recorder?.state === "recording") {
      requestedStop = true;
      try {
        recorder.stop();
      } catch (error) {
        store.voiceMediaRecorder = null;
        stopVoiceTracks();
        setVoiceState("idle");
        resolveVoiceStopWaiter();
        onVoiceError?.(t("voiceTranscriptionFailed", { error: error instanceof Error ? error.message : String(error) }));
      }
    }
    if (!requestedStop) {
      stopVoiceTracks();
      setVoiceState("idle");
      resolveVoiceStopWaiter();
    }
    return waitForStop.finally(restoreComposerFocus);
  }, [clearVoiceNoSpeechNotice, onVoiceError, resolveVoiceStopWaiter, restoreComposerFocus, setVoiceState, stopVoiceTracks, store, t, voiceState, voiceStopWaiter]);

  const cancelVoiceInput = useCallback(() => {
    if (voiceState === "recording") {
      void stopRecording("cancel");
    }
  }, [stopRecording, voiceState]);

  const finishVoiceInput = useCallback(() => stopRecording("finish"), [stopRecording]);

  const toggleVoiceInput = useCallback(async () => {
    if (voiceState === "recording") {
      cancelVoiceInput();
      return;
    }
    if (!voiceProvider || voiceState !== "idle") {
      return;
    }
    if (voiceProvider.kind === "browser") {
      await startBrowserDictation();
      return;
    }
    await startCloudDictation();
  }, [cancelVoiceInput, startBrowserDictation, startCloudDictation, voiceProvider, voiceState]);

  const browserProviderAvailable = voiceProvider?.kind === "browser" && browserVoiceSupported;
  const cloudProviderAvailable =
    voiceProvider?.kind === "cloud"
    && voiceProvider.configured
    && typeof navigator !== "undefined"
    && Boolean(navigator.mediaDevices)
    && typeof MediaRecorder !== "undefined";
  const voiceAvailable = browserProviderAvailable || cloudProviderAvailable;
  const voiceLabel =
    voiceState === "recording"
      ? t("cancelVoiceInput")
      : voiceState === "transcribing"
        ? t("voiceInputTranscribing")
        : t("startVoiceInput", { provider: voiceProvider?.name ?? "" });

  return {
    cancelVoiceInput,
    finishVoiceInput,
    setVoiceLevelCountForWidth,
    toggleVoiceInput,
    voiceAmbient,
    voiceAvailable,
    voiceDuration: voiceClock >= 0 ? formatVoiceDuration(voiceRecordingStartedAt) : "0:00",
    voiceInputActive: voiceState !== "idle",
    voiceLabel,
    voiceLevels,
    voiceState,
  };
}
