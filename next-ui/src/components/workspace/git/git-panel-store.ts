import { action, makeObservable, observable } from "mobx";
import type { GitStatusPayload } from "../../../lib/git-status";
import type { DiffViewerLine } from "./GitDiffViewer";
import type { GitGraphBranchHead, GitGraphCommit } from "../../../client/api/git-panel-api";

export type GitPanelTab = "tree" | "unstaged" | "staged" | "commit" | "last-turn";

type StateUpdater<T> = T | ((current: T) => T);

function resolveState<T>(current: T, updater: StateUpdater<T>): T {
  return typeof updater === "function" ? (updater as (value: T) => T)(current) : updater;
}

export class GitRefPickerStore {
  anchor: HTMLElement | null = null;

  query = "";

  constructor() {
    makeObservable(this, {
      anchor: observable.ref,
      query: observable,
      setAnchor: action.bound,
      setQuery: action.bound,
    });
  }

  setAnchor(value: StateUpdater<HTMLElement | null>): void {
    this.anchor = resolveState(this.anchor, value);
  }

  setQuery(value: StateUpdater<string>): void {
    this.query = resolveState(this.query, value);
  }
}

export class DiffFileCardStore {
  open = false;

  touched = false;

  stuck = false;

  constructor() {
    makeObservable(this, {
      open: observable,
      touched: observable,
      stuck: observable,
      setOpen: action.bound,
      setTouched: action.bound,
      setStuck: action.bound,
    });
  }

  setOpen(value: StateUpdater<boolean>): void {
    this.open = resolveState(this.open, value);
  }

  setTouched(value: StateUpdater<boolean>): void {
    this.touched = resolveState(this.touched, value);
  }

  setStuck(value: StateUpdater<boolean>): void {
    this.stuck = resolveState(this.stuck, value);
  }
}

export class GitFileDiffCardStore {
  lines: readonly DiffViewerLine[] | null = null;

  loading = false;

  error: string | null = null;

  constructor() {
    makeObservable(this, {
      lines: observable.ref,
      loading: observable,
      error: observable,
      setLines: action.bound,
      setLoading: action.bound,
      setError: action.bound,
    });
  }

  setLines(value: StateUpdater<readonly DiffViewerLine[] | null>): void {
    this.lines = resolveState(this.lines, value);
  }

  setLoading(value: StateUpdater<boolean>): void {
    this.loading = resolveState(this.loading, value);
  }

  setError(value: StateUpdater<string | null>): void {
    this.error = resolveState(this.error, value);
  }
}

export class GitViewStore {
  status: GitStatusPayload | null = null;

  statusVersion = 0;

  error: string | null = null;

  loading = false;

  graphCommits: readonly GitGraphCommit[] = [];

  graphBranchHeads: readonly GitGraphBranchHead[] = [];

  treeLoading = false;

  treeError: string | null = null;

  reloadKey = 0;

  activeTab: GitPanelTab = "unstaged";

  refPickerOpen = false;

  actionLoading = false;

  commitMessage = "";

  focused: { readonly path: string; readonly tick: number } = { path: "", tick: 0 };

  constructor() {
    makeObservable(this, {
      status: observable.ref,
      statusVersion: observable,
      error: observable,
      loading: observable,
      graphCommits: observable.ref,
      graphBranchHeads: observable.ref,
      treeLoading: observable,
      treeError: observable,
      reloadKey: observable,
      activeTab: observable,
      refPickerOpen: observable,
      actionLoading: observable,
      commitMessage: observable,
      focused: observable.ref,
      setStatus: action.bound,
      applyStatus: action.bound,
      bumpStatusVersion: action.bound,
      setError: action.bound,
      setLoading: action.bound,
      setGraphCommits: action.bound,
      setGraphBranchHeads: action.bound,
      setTreeLoading: action.bound,
      setTreeError: action.bound,
      setReloadKey: action.bound,
      setActiveTab: action.bound,
      setRefPickerOpen: action.bound,
      setActionLoading: action.bound,
      setCommitMessage: action.bound,
      setFocused: action.bound,
      resetForCwd: action.bound,
    });
  }

  setStatus(value: StateUpdater<GitStatusPayload | null>): void {
    this.status = resolveState(this.status, value);
  }

  applyStatus(status: GitStatusPayload): void {
    this.status = status;
    this.statusVersion += 1;
  }

  bumpStatusVersion(): void {
    this.statusVersion += 1;
  }

  setError(value: StateUpdater<string | null>): void {
    this.error = resolveState(this.error, value);
  }

  setLoading(value: StateUpdater<boolean>): void {
    this.loading = resolveState(this.loading, value);
  }

  setGraphCommits(value: StateUpdater<readonly GitGraphCommit[]>): void {
    this.graphCommits = resolveState(this.graphCommits, value);
  }

  setGraphBranchHeads(value: StateUpdater<readonly GitGraphBranchHead[]>): void {
    this.graphBranchHeads = resolveState(this.graphBranchHeads, value);
  }

  setTreeLoading(value: StateUpdater<boolean>): void {
    this.treeLoading = resolveState(this.treeLoading, value);
  }

  setTreeError(value: StateUpdater<string | null>): void {
    this.treeError = resolveState(this.treeError, value);
  }

  setReloadKey(value: StateUpdater<number>): void {
    this.reloadKey = resolveState(this.reloadKey, value);
  }

  setActiveTab(value: StateUpdater<GitPanelTab>): void {
    this.activeTab = resolveState(this.activeTab, value);
  }

  setRefPickerOpen(value: StateUpdater<boolean>): void {
    this.refPickerOpen = resolveState(this.refPickerOpen, value);
  }

  setActionLoading(value: StateUpdater<boolean>): void {
    this.actionLoading = resolveState(this.actionLoading, value);
  }

  setCommitMessage(value: StateUpdater<string>): void {
    this.commitMessage = resolveState(this.commitMessage, value);
  }

  setFocused(value: StateUpdater<{ readonly path: string; readonly tick: number }>): void {
    this.focused = resolveState(this.focused, value);
  }

  resetForCwd(): void {
    this.status = null;
    this.statusVersion += 1;
    this.error = null;
    this.graphCommits = [];
    this.treeError = null;
    this.treeLoading = false;
    this.refPickerOpen = false;
    this.activeTab = "unstaged";
    this.focused = { path: "", tick: 0 };
  }
}

export class GitTreeTabStore {
  selectedHash: string | null = null;

  constructor() {
    makeObservable(this, {
      selectedHash: observable,
      setSelectedHash: action.bound,
    });
  }

  setSelectedHash(value: StateUpdater<string | null>): void {
    this.selectedHash = resolveState(this.selectedHash, value);
  }
}
