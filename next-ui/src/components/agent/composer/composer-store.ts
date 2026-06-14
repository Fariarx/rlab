import { action, makeObservable, observable } from "mobx";
import type { ComposerAttachmentDraft } from "../core/types";

type StateUpdater<T> = T | ((current: T) => T);

export type ComposerVoiceState = "idle" | "recording" | "transcribing";

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

  constructor(initialValue: string, initialAttachments: readonly ComposerAttachmentDraft[], initialVoiceLevels: readonly number[]) {
    this.internalValue = initialValue;
    this.internalAttachments = initialAttachments;
    this.voiceLevels = initialVoiceLevels;
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
}
