import { action, makeObservable, observable } from "mobx";
import { VOICE_IDLE_LEVELS } from "../../agent/composer/ComposerVoice";
import { ComposerStore } from "../../agent/composer/composer-store";
import type { ComposerAttachmentDraft } from "../../agent/core/types";

type StateUpdater<T> = T | ((current: T) => T);

function resolveState<T>(current: T, updater: StateUpdater<T>): T {
  return typeof updater === "function" ? (updater as (value: T) => T)(current) : updater;
}

export class GitDiffLinesStore {
  activeLine: number | null = null;

  private readonly draftStores = new Map<string, ComposerStore>();

  constructor() {
    makeObservable(this, {
      activeLine: observable,
      setActiveLine: action.bound,
    });
  }

  setActiveLine(value: StateUpdater<number | null>): void {
    this.activeLine = resolveState(this.activeLine, value);
  }

  draftStore(key: string, initialText = "", initialAttachments: readonly ComposerAttachmentDraft[] = []): ComposerStore {
    const existing = this.draftStores.get(key);
    if (existing) {
      return existing;
    }
    const store = new ComposerStore(initialText, initialAttachments, VOICE_IDLE_LEVELS);
    this.draftStores.set(key, store);
    return store;
  }

  removeDraftStore(key: string): void {
    const store = this.draftStores.get(key);
    store?.cancelVoiceSession();
    this.draftStores.delete(key);
  }
}

export class DiffCommentRowStore {
  editing = false;

  private editorStore: ComposerStore | null = null;

  constructor() {
    makeObservable(this, {
      editing: observable,
      setEditing: action.bound,
    });
  }

  setEditing(value: StateUpdater<boolean>): void {
    this.editing = resolveState(this.editing, value);
  }

  draftStore(initialText = "", initialAttachments: readonly ComposerAttachmentDraft[] = []): ComposerStore {
    if (!this.editorStore) {
      this.editorStore = new ComposerStore(initialText, initialAttachments, VOICE_IDLE_LEVELS);
    }
    return this.editorStore;
  }

  clearDraftStore(): void {
    this.editorStore?.cancelVoiceSession();
    this.editorStore = null;
  }
}
