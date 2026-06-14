import { action, computed, makeObservable, observable } from "mobx";
import type { AgentProfile, ConversationView, ReviewCommentEntry } from "../../agent";
import type { BrowserActivityEvent } from "../browser/BrowserPreview";

type StateUpdater<T> = T | ((current: T) => T);

function resolveState<T>(current: T, updater: StateUpdater<T>): T {
  return typeof updater === "function" ? (updater as (value: T) => T)(current) : updater;
}

export class WorkspacePageStore {
  searchOpen = false;

  profile: AgentProfile;

  pickerOpen = false;

  newChatMenuAnchor: HTMLElement | null = null;

  settingsOpen = false;

  commandPaletteOpen = false;

  projectDialogOpen = false;

  view: ConversationView = "chat";

  browserOpenRequest: { readonly url: string; readonly nonce: number } = { url: "", nonce: 0 };

  gitFocus: { readonly path: string; readonly nonce: number } = { path: "", nonce: 0 };

  gitReloadSignal = 0;

  gitUnstaged: { readonly additions: number; readonly deletions: number } = { additions: 0, deletions: 0 };

  composerTagsHeight = 0;

  composerOverlayLift = 0;

  composerDockHeight = 0;

  browserActivityEvents: readonly BrowserActivityEvent[] = [];

  reviewComments: readonly ReviewCommentEntry[] = [];

  drawerOpen = false;

  sidebarCollapsed = false;

  sidebarWidth: number;

  isResizingSidebar = false;

  confirmDelete: string | null = null;

  runKey = 0;

  constructor(initialProfile: AgentProfile, initialSidebarWidth: number) {
    this.profile = initialProfile;
    this.sidebarWidth = initialSidebarWidth;
    makeObservable(this, {
      searchOpen: observable,
      profile: observable.ref,
      pickerOpen: observable,
      newChatMenuAnchor: observable.ref,
      settingsOpen: observable,
      commandPaletteOpen: observable,
      projectDialogOpen: observable,
      view: observable,
      browserOpenRequest: observable.ref,
      gitFocus: observable.ref,
      gitReloadSignal: observable,
      gitUnstaged: observable.ref,
      composerTagsHeight: observable,
      composerOverlayLift: observable,
      composerDockHeight: observable,
      browserActivityEvents: observable.ref,
      reviewComments: observable.ref,
      drawerOpen: observable,
      sidebarCollapsed: observable,
      sidebarWidth: observable,
      isResizingSidebar: observable,
      confirmDelete: observable,
      runKey: observable,
      contentBottomInset: computed,
      composerVisible: computed,
      setSearchOpen: action.bound,
      setProfile: action.bound,
      setPickerOpen: action.bound,
      setNewChatMenuAnchor: action.bound,
      setSettingsOpen: action.bound,
      setCommandPaletteOpen: action.bound,
      setProjectDialogOpen: action.bound,
      setView: action.bound,
      setBrowserOpenRequest: action.bound,
      setGitFocus: action.bound,
      setGitReloadSignal: action.bound,
      setGitUnstaged: action.bound,
      setComposerTagsHeight: action.bound,
      setComposerOverlayLift: action.bound,
      setComposerDockHeight: action.bound,
      setBrowserActivityEvents: action.bound,
      setReviewComments: action.bound,
      setDrawerOpen: action.bound,
      setSidebarCollapsed: action.bound,
      setSidebarWidth: action.bound,
      setIsResizingSidebar: action.bound,
      setConfirmDelete: action.bound,
      setRunKey: action.bound,
    });
  }

  get contentBottomInset(): number {
    return this.composerDockHeight + (this.composerTagsHeight > 0 ? this.composerTagsHeight + 22 : 0) + this.composerOverlayLift;
  }

  get composerVisible(): boolean {
    return this.view !== "terminal";
  }

  setSearchOpen(value: StateUpdater<boolean>): void {
    this.searchOpen = resolveState(this.searchOpen, value);
  }

  setProfile(value: StateUpdater<AgentProfile>): void {
    this.profile = resolveState(this.profile, value);
  }

  setPickerOpen(value: StateUpdater<boolean>): void {
    this.pickerOpen = resolveState(this.pickerOpen, value);
  }

  setNewChatMenuAnchor(value: StateUpdater<HTMLElement | null>): void {
    this.newChatMenuAnchor = resolveState(this.newChatMenuAnchor, value);
  }

  setSettingsOpen(value: StateUpdater<boolean>): void {
    this.settingsOpen = resolveState(this.settingsOpen, value);
  }

  setCommandPaletteOpen(value: StateUpdater<boolean>): void {
    this.commandPaletteOpen = resolveState(this.commandPaletteOpen, value);
  }

  setProjectDialogOpen(value: StateUpdater<boolean>): void {
    this.projectDialogOpen = resolveState(this.projectDialogOpen, value);
  }

  setView(value: StateUpdater<ConversationView>): void {
    this.view = resolveState(this.view, value);
  }

  setBrowserOpenRequest(value: StateUpdater<{ readonly url: string; readonly nonce: number }>): void {
    this.browserOpenRequest = resolveState(this.browserOpenRequest, value);
  }

  setGitFocus(value: StateUpdater<{ readonly path: string; readonly nonce: number }>): void {
    this.gitFocus = resolveState(this.gitFocus, value);
  }

  setGitReloadSignal(value: StateUpdater<number>): void {
    this.gitReloadSignal = resolveState(this.gitReloadSignal, value);
  }

  setGitUnstaged(value: StateUpdater<{ readonly additions: number; readonly deletions: number }>): void {
    this.gitUnstaged = resolveState(this.gitUnstaged, value);
  }

  setComposerTagsHeight(value: StateUpdater<number>): void {
    this.composerTagsHeight = resolveState(this.composerTagsHeight, value);
  }

  setComposerOverlayLift(value: StateUpdater<number>): void {
    this.composerOverlayLift = resolveState(this.composerOverlayLift, value);
  }

  setComposerDockHeight(value: StateUpdater<number>): void {
    this.composerDockHeight = resolveState(this.composerDockHeight, value);
  }

  setBrowserActivityEvents(value: StateUpdater<readonly BrowserActivityEvent[]>): void {
    this.browserActivityEvents = resolveState(this.browserActivityEvents, value);
  }

  setReviewComments(value: StateUpdater<readonly ReviewCommentEntry[]>): void {
    this.reviewComments = resolveState(this.reviewComments, value);
  }

  setDrawerOpen(value: StateUpdater<boolean>): void {
    this.drawerOpen = resolveState(this.drawerOpen, value);
  }

  setSidebarCollapsed(value: StateUpdater<boolean>): void {
    this.sidebarCollapsed = resolveState(this.sidebarCollapsed, value);
  }

  setSidebarWidth(value: StateUpdater<number>): void {
    this.sidebarWidth = resolveState(this.sidebarWidth, value);
  }

  setIsResizingSidebar(value: StateUpdater<boolean>): void {
    this.isResizingSidebar = resolveState(this.isResizingSidebar, value);
  }

  setConfirmDelete(value: StateUpdater<string | null>): void {
    this.confirmDelete = resolveState(this.confirmDelete, value);
  }

  setRunKey(value: StateUpdater<number>): void {
    this.runKey = resolveState(this.runKey, value);
  }

}
