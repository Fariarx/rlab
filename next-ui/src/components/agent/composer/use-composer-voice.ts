import { useCallback, useEffect, useRef, type RefObject } from "react";
import { transcribeVoice } from "../../../client/api/voice-api";
import { useI18n } from "../../../i18n/I18nProvider";
import type { ComposerVoiceProvider } from "./composer-model";
import type { ComposerStore } from "./composer-store";
import type { ComposerDraft } from "../core/types";
import { blobToBase64 } from "./composer-utils";
import {
  VOICE_DEFAULT_LEVEL_COUNT,
  VOICE_IDLE_LEVELS,
  VOICE_NO_SPEECH_NOTICE_DELAY_MS,
  formatVoiceDuration,
  isMobileSpeechRecognitionRuntime,
  preferredAudioMimeType,
  speechRecognitionConstructor,
  type SpeechRecognitionLike,
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

export interface ComposerVoiceSelectionRange {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

type VoiceStopIntent = "recording" | "finish" | "cancel";

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
  pendingSelectionRef,
}: {
  readonly latestDraftRef: React.MutableRefObject<ComposerDraft>;
  readonly onVoiceError?: (message: string) => void;
  readonly store: ComposerStore;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly updateDraft: (draft: ComposerDraft) => void;
  readonly voiceProvider?: ComposerVoiceProvider;
  readonly pendingSelectionRef?: React.MutableRefObject<ComposerVoiceSelectionRange | null>;
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
  } = store;
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceAudioContextRef = useRef<AudioContext | null>(null);
  const voiceAnalyserFrameRef = useRef<number | null>(null);
  const voiceNoSpeechTimerRef = useRef<number | null>(null);
  const voiceNoSpeechNotifiedRef = useRef(false);
  const voiceRecognizedRef = useRef(false);
  const voiceManualStopRef = useRef(false);
  const voiceBrowserInterimTranscriptRef = useRef("");
  const voiceCommittedInterimTranscriptRef = useRef("");
  const voiceLevelValuesRef = useRef<readonly number[]>(VOICE_IDLE_LEVELS);
  const voiceLevelLastPaintRef = useRef(0);
  const voiceLevelCountRef = useRef(VOICE_DEFAULT_LEVEL_COUNT);
  const voiceStopIntentRef = useRef<VoiceStopIntent>("recording");
  const voiceStopWaiterRef = useRef<{ readonly promise: Promise<void>; readonly resolve: () => void } | null>(null);

  const resolveVoiceStopWaiter = useCallback(() => {
    const waiter = voiceStopWaiterRef.current;
    voiceStopWaiterRef.current = null;
    waiter?.resolve();
  }, []);

  const voiceStopWaiter = useCallback((): Promise<void> => {
    if (voiceStopWaiterRef.current) {
      return voiceStopWaiterRef.current.promise;
    }
    let resolveWaiter: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      resolveWaiter = resolve;
    });
    voiceStopWaiterRef.current = { promise, resolve: resolveWaiter };
    return promise;
  }, []);

  const setVoiceLevelCountForWidth = useCallback(
    (levelCount: number) => {
      if (voiceLevelCountRef.current === levelCount) {
        return;
      }
      voiceLevelCountRef.current = levelCount;
      setVoiceLevels((current) => (current.length === levelCount ? current : voiceAmbient ? voiceAmbientLevels(levelCount) : voiceIdleLevels(levelCount)));
    },
    [setVoiceLevels, voiceAmbient],
  );

  const setAmbientVoiceLevels = useCallback(
    (enabled: boolean) => {
      setVoiceAmbient(enabled);
      if (enabled) {
        const levels = voiceAmbientLevels(voiceLevelCountRef.current);
        voiceLevelValuesRef.current = levels;
        setVoiceLevels(levels);
      }
    },
    [setVoiceAmbient, setVoiceLevels],
  );

  const clearVoiceNoSpeechNotice = useCallback(() => {
    if (voiceNoSpeechTimerRef.current !== null) {
      window.clearTimeout(voiceNoSpeechTimerRef.current);
      voiceNoSpeechTimerRef.current = null;
    }
  }, []);

  const scheduleVoiceNoSpeechNotice = useCallback(() => {
    if (voiceRecognizedRef.current || voiceNoSpeechNotifiedRef.current || voiceNoSpeechTimerRef.current !== null) {
      return;
    }
    voiceNoSpeechTimerRef.current = window.setTimeout(() => {
      voiceNoSpeechTimerRef.current = null;
      if (!voiceRecognizedRef.current) {
        voiceNoSpeechNotifiedRef.current = true;
        onVoiceError?.(t("voiceNoSpeech"));
      }
    }, VOICE_NO_SPEECH_NOTICE_DELAY_MS);
  }, [onVoiceError, t]);

  const appendDictation = useCallback(
    (text: string): boolean => {
      const cleanText = text.trim();
      if (!cleanText) {
        return false;
      }
      voiceRecognizedRef.current = true;
      clearVoiceNoSpeechNotice();
      const currentText = latestDraftRef.current.text;
      const pendingSelection = pendingSelectionRef?.current;
      if (pendingSelectionRef) {
        pendingSelectionRef.current = null;
      }
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
    [clearVoiceNoSpeechNotice, latestDraftRef, pendingSelectionRef, textareaRef, updateDraft],
  );

  const commitBrowserInterimDictation = useCallback((): boolean => {
    const interim = voiceBrowserInterimTranscriptRef.current;
    voiceBrowserInterimTranscriptRef.current = "";
    const cleanInterim = normalizedDictationText(interim);
    const committed = appendDictation(interim);
    if (committed) {
      voiceCommittedInterimTranscriptRef.current = cleanInterim;
    }
    return committed;
  }, [appendDictation]);

  const stopVoiceAnalyser = useCallback(() => {
    setVoiceAmbient(false);
    if (voiceAnalyserFrameRef.current !== null) {
      cancelAnimationFrame(voiceAnalyserFrameRef.current);
      voiceAnalyserFrameRef.current = null;
    }
    const context = voiceAudioContextRef.current;
    voiceAudioContextRef.current = null;
    if (context && context.state !== "closed") {
      void context.close();
    }
    const idleLevels = voiceIdleLevels(voiceLevelCountRef.current);
    voiceLevelValuesRef.current = idleLevels;
    setVoiceLevels(idleLevels);
  }, [setVoiceAmbient, setVoiceLevels]);

  const stopVoiceTracks = useCallback(() => {
    stopVoiceAnalyser();
    mediaStreamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });
    mediaStreamRef.current = null;
  }, [stopVoiceAnalyser]);

  const startVoiceAnalyser = useCallback(
    (stream: MediaStream) => {
      stopVoiceAnalyser();
      const AudioContextConstructor = window.AudioContext;
      const context = new AudioContextConstructor();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.35;
      context.createMediaStreamSource(stream).connect(analyser);
      voiceAudioContextRef.current = context;
      const data = new Uint8Array(analyser.fftSize);
      const tick = (now: number) => {
        analyser.getByteTimeDomainData(data);
        const next = voiceLevelsFromTimeDomainData(data, voiceLevelCountRef.current);
        voiceLevelValuesRef.current = next;
        if (now - voiceLevelLastPaintRef.current > 70) {
          voiceLevelLastPaintRef.current = now;
          setVoiceLevels(next);
        }
        voiceAnalyserFrameRef.current = requestAnimationFrame(tick);
      };
      voiceAnalyserFrameRef.current = requestAnimationFrame(tick);
    },
    [setVoiceLevels, stopVoiceAnalyser],
  );

  useEffect(() => {
    setBrowserVoiceSupported(voiceProvider?.kind === "browser" && speechRecognitionConstructor() !== null);
  }, [setBrowserVoiceSupported, voiceProvider?.kind]);

  useEffect(
    () => () => {
      voiceStopIntentRef.current = "cancel";
      clearVoiceNoSpeechNotice();
      recognitionRef.current?.stop();
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      stopVoiceTracks();
      setVoiceState("idle");
      resolveVoiceStopWaiter();
    },
    [clearVoiceNoSpeechNotice, resolveVoiceStopWaiter, setVoiceState, stopVoiceTracks],
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
        mediaStreamRef.current = stream;
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
        recognitionRef.current = null;
        clearVoiceNoSpeechNotice();
        stopVoiceTracks();
        setVoiceState("idle");
        resolveVoiceStopWaiter();
      };
      recognition.onresult = (event) => {
        if (voiceStopIntentRef.current === "cancel") {
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
          voiceBrowserInterimTranscriptRef.current = "";
          if (
            voiceCommittedInterimTranscriptRef.current === cleanFinalTranscript
            && draftEndsWithDictation(latestDraftRef.current.text, cleanFinalTranscript)
          ) {
            voiceCommittedInterimTranscriptRef.current = "";
            return;
          }
          voiceCommittedInterimTranscriptRef.current = "";
          appendDictation(finalTranscript);
          return;
        }
        if (interimTranscript.trim()) {
          voiceBrowserInterimTranscriptRef.current = interimTranscript;
          voiceRecognizedRef.current = true;
          clearVoiceNoSpeechNotice();
        }
      };
      recognition.onerror = (event) => {
        if (voiceManualStopRef.current && (event.error === "aborted" || event.error === "no-speech")) {
          if (voiceStopIntentRef.current !== "cancel") {
            commitBrowserInterimDictation();
          }
          finishRecognition();
          return;
        }
        if (!voiceManualStopRef.current && event.error === "no-speech") {
          scheduleVoiceNoSpeechNotice();
          return;
        }
        clearVoiceNoSpeechNotice();
        voiceManualStopRef.current = true;
        stopVoiceTracks();
        onVoiceError?.(t("voiceTranscriptionFailed", { error: event.message || event.error || "unknown" }));
        setVoiceState("idle");
        resolveVoiceStopWaiter();
      };
      recognition.onend = () => {
        const canceled = voiceStopIntentRef.current === "cancel";
        const committed = canceled ? false : commitBrowserInterimDictation();
        const shouldReportNoSpeech = !canceled && !committed && !voiceManualStopRef.current && !voiceRecognizedRef.current;
        if (!canceled && allowAutoRestart && !voiceManualStopRef.current && recognitionRef.current === recognition) {
          window.setTimeout(() => {
            if (voiceManualStopRef.current || recognitionRef.current !== recognition) {
              return;
            }
            try {
              recognition.start();
            } catch (error) {
              voiceManualStopRef.current = true;
              recognitionRef.current = null;
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
      voiceManualStopRef.current = false;
      voiceStopIntentRef.current = "recording";
      voiceStopWaiterRef.current = null;
      voiceRecognizedRef.current = false;
      voiceNoSpeechNotifiedRef.current = false;
      voiceBrowserInterimTranscriptRef.current = "";
      voiceCommittedInterimTranscriptRef.current = "";
      clearVoiceNoSpeechNotice();
      recognitionRef.current = recognition;
      setVoiceRecordingStartedAt(Date.now());
      setVoiceState("recording");
      recognition.start();
    } catch (error) {
      clearVoiceNoSpeechNotice();
      stopVoiceTracks();
      setVoiceState("idle");
      onVoiceError?.(t("voiceTranscriptionFailed", { error: error instanceof Error ? error.message : String(error) }));
    }
  }, [appendDictation, clearVoiceNoSpeechNotice, commitBrowserInterimDictation, latestDraftRef, onVoiceError, resolveVoiceStopWaiter, scheduleVoiceNoSpeechNotice, setAmbientVoiceLevels, setVoiceRecordingStartedAt, setVoiceState, startVoiceAnalyser, stopVoiceTracks, t, voiceProvider]);

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
      mediaStreamRef.current = stream;
      startVoiceAnalyser(stream);
      const chunks: Blob[] = [];
      const mimeType = preferredAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onerror = (event) => {
        onVoiceError?.(t("voiceTranscriptionFailed", { error: event.error.message }));
        mediaRecorderRef.current = null;
        stopVoiceTracks();
        setVoiceState("idle");
        resolveVoiceStopWaiter();
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || "audio/webm";
        const audio = new Blob(chunks, { type });
        mediaRecorderRef.current = null;
        stopVoiceTracks();
        if (voiceStopIntentRef.current === "cancel") {
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
      voiceRecognizedRef.current = false;
      voiceStopIntentRef.current = "recording";
      voiceStopWaiterRef.current = null;
      voiceNoSpeechNotifiedRef.current = false;
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
  }, [clearVoiceNoSpeechNotice, onVoiceError, resolveVoiceStopWaiter, scheduleVoiceNoSpeechNotice, setVoiceRecordingStartedAt, setVoiceState, startVoiceAnalyser, stopVoiceTracks, t, transcribeCloudAudio, voiceProvider]);

  const stopRecording = useCallback((intent: Exclude<VoiceStopIntent, "recording">): Promise<void> => {
    if (voiceState !== "recording") {
      return Promise.resolve();
    }
    voiceStopIntentRef.current = intent;
    voiceManualStopRef.current = true;
    clearVoiceNoSpeechNotice();
    const waitForStop = voiceStopWaiter();
    let requestedStop = false;
    const recognition = recognitionRef.current;
    if (recognition) {
      requestedStop = true;
      try {
        recognition.stop();
      } catch (error) {
        recognitionRef.current = null;
        stopVoiceTracks();
        setVoiceState("idle");
        resolveVoiceStopWaiter();
        onVoiceError?.(t("voiceTranscriptionFailed", { error: error instanceof Error ? error.message : String(error) }));
      }
    }
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === "recording") {
      requestedStop = true;
      try {
        recorder.stop();
      } catch (error) {
        mediaRecorderRef.current = null;
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
    return waitForStop;
  }, [clearVoiceNoSpeechNotice, onVoiceError, resolveVoiceStopWaiter, setVoiceState, stopVoiceTracks, t, voiceState, voiceStopWaiter]);

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
