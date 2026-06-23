import { action, makeObservable, observable } from "mobx";
import { voiceIdleLevels, type SpeechRecognitionLike } from "./ComposerVoice";
import type { ComposerAttachmentDraft } from "../core/types";

type StateUpdater<T> = T | ((current: T) => T);

export type ComposerVoiceState = "idle" | "recording" | "transcribing";

export interface ComposerVoiceSelectionRange {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export type ComposerVoiceStopIntent = "recording" | "finish" | "cancel";

export interface ComposerVoiceStopWaiter {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function resolveState<T>(current: T, updater: StateUpdater<T>): T {
  return typeof updater === "function" ? (updater as (value: T) => T)(current) : updater;
}

export class ComposerStore {
  internalValue: string;

  internalAttachments: readonly ComposerAttachmentDraft[];

  sending = false;

  activeSuggestion = 0;

  suggestDismissed = false;

  modeMenuAnchor: HTMLElement | null = null;

  optionsMenuMaxHeight: number | undefined = undefined;

  expanded = false;

  overlayLift = 0;

  previewAttachment: ComposerAttachmentDraft | null = null;

  limitOpen = false;

  voiceState: ComposerVoiceState = "idle";

  voiceRecordingStartedAt: number | null = null;

  voiceClock = 0;

  voiceLevels: readonly number[];

  voiceAmbient = false;

  browserVoiceSupported = false;

  voiceRecognition: SpeechRecognitionLike | null = null;

  voiceMediaRecorder: MediaRecorder | null = null;

  voiceMediaStream: MediaStream | null = null;

  voiceAudioContext: AudioContext | null = null;

  voiceAnalyserFrame: number | null = null;

  voiceNoSpeechTimer: number | null = null;

  voiceNoSpeechNotified = false;

  voiceRecognized = false;

  voiceManualStop = false;

  voiceBrowserInterimTranscript = "";

  voiceCommittedInterimTranscript = "";

  voiceLevelValues: readonly number[];

  voiceLevelLastPaint = 0;

  voiceLevelCount: number;

  voiceStopIntent: ComposerVoiceStopIntent = "recording";

  voiceStopWaiter: ComposerVoiceStopWaiter | null = null;

  voicePendingSelection: ComposerVoiceSelectionRange | null = null;

  constructor(initialValue: string, initialAttachments: readonly ComposerAttachmentDraft[], initialVoiceLevels: readonly number[]) {
    this.internalValue = initialValue;
    this.internalAttachments = initialAttachments;
    this.voiceLevels = initialVoiceLevels;
    this.voiceLevelValues = initialVoiceLevels;
    this.voiceLevelCount = initialVoiceLevels.length;
    makeObservable(this, {
      internalValue: observable,
      internalAttachments: observable.ref,
      sending: observable,
      activeSuggestion: observable,
      suggestDismissed: observable,
      modeMenuAnchor: observable.ref,
      optionsMenuMaxHeight: observable,
      expanded: observable,
      overlayLift: observable,
      previewAttachment: observable.ref,
      limitOpen: observable,
      voiceState: observable,
      voiceRecordingStartedAt: observable,
      voiceClock: observable,
      voiceLevels: observable.ref,
      voiceAmbient: observable,
      browserVoiceSupported: observable,
      voicePendingSelection: observable.ref,
      setInternalValue: action.bound,
      setInternalAttachments: action.bound,
      setSending: action.bound,
      setActiveSuggestion: action.bound,
      setSuggestDismissed: action.bound,
      setModeMenuAnchor: action.bound,
      setOptionsMenuMaxHeight: action.bound,
      setExpanded: action.bound,
      setOverlayLift: action.bound,
      setPreviewAttachment: action.bound,
      setLimitOpen: action.bound,
      setVoiceState: action.bound,
      setVoiceRecordingStartedAt: action.bound,
      setVoiceClock: action.bound,
      setVoiceLevels: action.bound,
      setVoiceAmbient: action.bound,
      setBrowserVoiceSupported: action.bound,
      setVoicePendingSelection: action.bound,
      cancelVoiceSession: action.bound,
      clearVoiceRuntimeResources: action.bound,
    });
  }

  setInternalValue(value: StateUpdater<string>): void {
    this.internalValue = resolveState(this.internalValue, value);
  }

  setInternalAttachments(value: StateUpdater<readonly ComposerAttachmentDraft[]>): void {
    this.internalAttachments = resolveState(this.internalAttachments, value);
  }

  setSending(value: StateUpdater<boolean>): void {
    this.sending = resolveState(this.sending, value);
  }

  setActiveSuggestion(value: StateUpdater<number>): void {
    this.activeSuggestion = resolveState(this.activeSuggestion, value);
  }

  setSuggestDismissed(value: StateUpdater<boolean>): void {
    this.suggestDismissed = resolveState(this.suggestDismissed, value);
  }

  setModeMenuAnchor(value: StateUpdater<HTMLElement | null>): void {
    this.modeMenuAnchor = resolveState(this.modeMenuAnchor, value);
  }

  setOptionsMenuMaxHeight(value: StateUpdater<number | undefined>): void {
    this.optionsMenuMaxHeight = resolveState(this.optionsMenuMaxHeight, value);
  }

  setExpanded(value: StateUpdater<boolean>): void {
    this.expanded = resolveState(this.expanded, value);
  }

  setOverlayLift(value: StateUpdater<number>): void {
    this.overlayLift = resolveState(this.overlayLift, value);
  }

  setPreviewAttachment(value: StateUpdater<ComposerAttachmentDraft | null>): void {
    this.previewAttachment = resolveState(this.previewAttachment, value);
  }

  setLimitOpen(value: StateUpdater<boolean>): void {
    this.limitOpen = resolveState(this.limitOpen, value);
  }

  setVoiceState(value: StateUpdater<ComposerVoiceState>): void {
    this.voiceState = resolveState(this.voiceState, value);
  }

  setVoiceRecordingStartedAt(value: StateUpdater<number | null>): void {
    this.voiceRecordingStartedAt = resolveState(this.voiceRecordingStartedAt, value);
  }

  setVoiceClock(value: StateUpdater<number>): void {
    this.voiceClock = resolveState(this.voiceClock, value);
  }

  setVoiceLevels(value: StateUpdater<readonly number[]>): void {
    this.voiceLevels = resolveState(this.voiceLevels, value);
  }

  setVoiceAmbient(value: StateUpdater<boolean>): void {
    this.voiceAmbient = resolveState(this.voiceAmbient, value);
  }

  setBrowserVoiceSupported(value: StateUpdater<boolean>): void {
    this.browserVoiceSupported = resolveState(this.browserVoiceSupported, value);
  }

  setVoicePendingSelection(value: StateUpdater<ComposerVoiceSelectionRange | null>): void {
    this.voicePendingSelection = resolveState(this.voicePendingSelection, value);
  }

  cancelVoiceSession(): void {
    this.voiceStopIntent = "cancel";
    this.voiceManualStop = true;
    if (this.voiceNoSpeechTimer !== null) {
      window.clearTimeout(this.voiceNoSpeechTimer);
      this.voiceNoSpeechTimer = null;
    }
    let requestedStop = false;
    if (this.voiceRecognition) {
      requestedStop = true;
      try {
        this.voiceRecognition.stop();
      } catch {
        this.voiceRecognition = null;
      }
    }
    if (this.voiceMediaRecorder?.state === "recording") {
      requestedStop = true;
      try {
        this.voiceMediaRecorder.stop();
      } catch {
        this.voiceMediaRecorder = null;
      }
    }
    if (!requestedStop) {
      this.clearVoiceRuntimeResources();
    }
  }

  clearVoiceRuntimeResources(): void {
    if (this.voiceAnalyserFrame !== null) {
      cancelAnimationFrame(this.voiceAnalyserFrame);
      this.voiceAnalyserFrame = null;
    }
    const context = this.voiceAudioContext;
    this.voiceAudioContext = null;
    if (context && context.state !== "closed") {
      void context.close();
    }
    this.voiceMediaStream?.getTracks().forEach((track) => {
      track.stop();
    });
    this.voiceMediaStream = null;
    this.voiceMediaRecorder = null;
    this.voiceRecognition = null;
    this.voiceState = "idle";
    this.voiceRecordingStartedAt = null;
    this.voiceAmbient = false;
    this.voiceLevelValues = voiceIdleLevels(this.voiceLevelCount);
    this.voiceLevels = this.voiceLevelValues;
    const waiter = this.voiceStopWaiter;
    this.voiceStopWaiter = null;
    waiter?.resolve();
  }
}
