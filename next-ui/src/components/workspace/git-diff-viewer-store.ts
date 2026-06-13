import { action, makeObservable, observable } from "mobx";

type StateUpdater<T> = T | ((current: T) => T);

function resolveState<T>(current: T, updater: StateUpdater<T>): T {
  return typeof updater === "function" ? (updater as (value: T) => T)(current) : updater;
}

export class GitDiffLinesStore {
  activeLine: number | null = null;

  constructor() {
    makeObservable(this, {
      activeLine: observable,
      setActiveLine: action.bound,
    });
  }

  setActiveLine(value: StateUpdater<number | null>): void {
    this.activeLine = resolveState(this.activeLine, value);
  }
}

export class DiffCommentRowStore {
  editing = false;

  constructor() {
    makeObservable(this, {
      editing: observable,
      setEditing: action.bound,
    });
  }

  setEditing(value: StateUpdater<boolean>): void {
    this.editing = resolveState(this.editing, value);
  }
}

export class DiffCommentComposerStore {
  draft: string;

  constructor(initial: string) {
    this.draft = initial;
    makeObservable(this, {
      draft: observable,
      setDraft: action.bound,
    });
  }

  setDraft(value: StateUpdater<string>): void {
    this.draft = resolveState(this.draft, value);
  }
}
