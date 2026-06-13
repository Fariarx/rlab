import { action, makeObservable, observable } from "mobx";
import type { AgentId, AgentProfile, AgentWorkMode } from "./agents";
import type { ApprovalDecision } from "./types";

export interface MessagePreviewAttachment {
  readonly name: string;
  readonly target?: string;
  readonly isImage: boolean;
}

type StateUpdater<T> = T | ((current: T) => T);

function resolveState<T>(current: T, updater: StateUpdater<T>): T {
  return typeof updater === "function" ? (updater as (value: T) => T)(current) : updater;
}

export class ToggleStore {
  open: boolean;

  constructor(initialOpen = false) {
    this.open = initialOpen;
    makeObservable(this, {
      open: observable,
      setOpen: action.bound,
    });
  }

  setOpen(value: StateUpdater<boolean>): void {
    this.open = resolveState(this.open, value);
  }
}

export class AnchorStore {
  anchor: HTMLElement | null = null;

  constructor() {
    makeObservable(this, {
      anchor: observable.ref,
      setAnchor: action.bound,
    });
  }

  setAnchor(value: StateUpdater<HTMLElement | null>): void {
    this.anchor = resolveState(this.anchor, value);
  }
}

export class ImageFailedStore {
  failed = false;

  constructor() {
    makeObservable(this, {
      failed: observable,
      setFailed: action.bound,
    });
  }

  setFailed(value: StateUpdater<boolean>): void {
    this.failed = resolveState(this.failed, value);
  }
}

export class AgentPickerStore {
  agent: AgentId;

  model: string;

  reasoning: string;

  mode: AgentWorkMode;

  autoConfirm: boolean;

  constructor(initialProfile: AgentProfile) {
    this.agent = initialProfile.agent;
    this.model = initialProfile.model;
    this.reasoning = initialProfile.reasoning;
    this.mode = initialProfile.mode;
    this.autoConfirm = initialProfile.autoConfirm ?? false;
    makeObservable(this, {
      agent: observable,
      model: observable,
      reasoning: observable,
      mode: observable,
      autoConfirm: observable,
      setAgent: action.bound,
      setModel: action.bound,
      setReasoning: action.bound,
      setMode: action.bound,
      setAutoConfirm: action.bound,
      setProfile: action.bound,
    });
  }

  setAgent(value: StateUpdater<AgentId>): void {
    this.agent = resolveState(this.agent, value);
  }

  setModel(value: StateUpdater<string>): void {
    this.model = resolveState(this.model, value);
  }

  setReasoning(value: StateUpdater<string>): void {
    this.reasoning = resolveState(this.reasoning, value);
  }

  setMode(value: StateUpdater<AgentWorkMode>): void {
    this.mode = resolveState(this.mode, value);
  }

  setAutoConfirm(value: StateUpdater<boolean>): void {
    this.autoConfirm = resolveState(this.autoConfirm, value);
  }

  setProfile(profile: AgentProfile): void {
    this.agent = profile.agent;
    this.model = profile.model;
    this.reasoning = profile.reasoning;
    this.mode = profile.mode;
    this.autoConfirm = profile.autoConfirm ?? false;
  }
}

export class ApprovalRequestStore {
  result: ApprovalDecision | null;

  pendingDecision: ApprovalDecision | null = null;

  decisionError: string | null = null;

  constructor(initialDecision: ApprovalDecision | null) {
    this.result = initialDecision;
    makeObservable(this, {
      result: observable,
      pendingDecision: observable,
      decisionError: observable,
      setResult: action.bound,
      setPendingDecision: action.bound,
      setDecisionError: action.bound,
    });
  }

  setResult(value: StateUpdater<ApprovalDecision | null>): void {
    this.result = resolveState(this.result, value);
  }

  setPendingDecision(value: StateUpdater<ApprovalDecision | null>): void {
    this.pendingDecision = resolveState(this.pendingDecision, value);
  }

  setDecisionError(value: StateUpdater<string | null>): void {
    this.decisionError = resolveState(this.decisionError, value);
  }
}

export class OptionSelectStore {
  selected: readonly string[];

  confirmed: boolean;

  pending = false;

  selectionError: string | null = null;

  constructor(initialSelected: readonly string[]) {
    this.selected = initialSelected;
    this.confirmed = initialSelected.length > 0;
    makeObservable(this, {
      selected: observable.ref,
      confirmed: observable,
      pending: observable,
      selectionError: observable,
      setSelected: action.bound,
      setConfirmed: action.bound,
      setPending: action.bound,
      setSelectionError: action.bound,
    });
  }

  setSelected(value: StateUpdater<readonly string[]>): void {
    this.selected = resolveState(this.selected, value);
  }

  setConfirmed(value: StateUpdater<boolean>): void {
    this.confirmed = resolveState(this.confirmed, value);
  }

  setPending(value: StateUpdater<boolean>): void {
    this.pending = resolveState(this.pending, value);
  }

  setSelectionError(value: StateUpdater<string | null>): void {
    this.selectionError = resolveState(this.selectionError, value);
  }
}

export class MessageShellStore {
  editing = false;

  draft: string;

  previewImage: MessagePreviewAttachment | null = null;

  constructor(initialDraft: string) {
    this.draft = initialDraft;
    makeObservable(this, {
      editing: observable,
      draft: observable,
      previewImage: observable.ref,
      setEditing: action.bound,
      setDraft: action.bound,
      setPreviewImage: action.bound,
    });
  }

  setEditing(value: StateUpdater<boolean>): void {
    this.editing = resolveState(this.editing, value);
  }

  setDraft(value: StateUpdater<string>): void {
    this.draft = resolveState(this.draft, value);
  }

  setPreviewImage(value: StateUpdater<MessagePreviewAttachment | null>): void {
    this.previewImage = resolveState(this.previewImage, value);
  }
}

export class AgentMessageStore {
  hideCompletedPlans = false;

  hideResolvedInputs = false;

  previewImage: MessagePreviewAttachment | null = null;

  tick = 0;

  constructor() {
    makeObservable(this, {
      hideCompletedPlans: observable,
      hideResolvedInputs: observable,
      previewImage: observable.ref,
      tick: observable,
      setHideCompletedPlans: action.bound,
      setHideResolvedInputs: action.bound,
      setPreviewImage: action.bound,
      bumpTick: action.bound,
    });
  }

  setHideCompletedPlans(value: StateUpdater<boolean>): void {
    this.hideCompletedPlans = resolveState(this.hideCompletedPlans, value);
  }

  setHideResolvedInputs(value: StateUpdater<boolean>): void {
    this.hideResolvedInputs = resolveState(this.hideResolvedInputs, value);
  }

  setPreviewImage(value: StateUpdater<MessagePreviewAttachment | null>): void {
    this.previewImage = resolveState(this.previewImage, value);
  }

  bumpTick(): void {
    this.tick += 1;
  }
}

export class AgentDetailsStore {
  open: boolean;

  tick = 0;

  constructor(initialOpen: boolean) {
    this.open = initialOpen;
    makeObservable(this, {
      open: observable,
      tick: observable,
      setOpen: action.bound,
      bumpTick: action.bound,
    });
  }

  setOpen(value: StateUpdater<boolean>): void {
    this.open = resolveState(this.open, value);
  }

  bumpTick(): void {
    this.tick += 1;
  }
}

export class ConversationSearchStore {
  query = "";

  constructor() {
    makeObservable(this, {
      query: observable,
      setQuery: action.bound,
    });
  }

  setQuery(value: StateUpdater<string>): void {
    this.query = resolveState(this.query, value);
  }
}

export class ConversationRowStore {
  menuAnchor: HTMLElement | null = null;

  editing = false;

  draft: string;

  constructor(initialDraft: string) {
    this.draft = initialDraft;
    makeObservable(this, {
      menuAnchor: observable.ref,
      editing: observable,
      draft: observable,
      setMenuAnchor: action.bound,
      setEditing: action.bound,
      setDraft: action.bound,
    });
  }

  setMenuAnchor(value: StateUpdater<HTMLElement | null>): void {
    this.menuAnchor = resolveState(this.menuAnchor, value);
  }

  setEditing(value: StateUpdater<boolean>): void {
    this.editing = resolveState(this.editing, value);
  }

  setDraft(value: StateUpdater<string>): void {
    this.draft = resolveState(this.draft, value);
  }
}

export class ConversationListStore {
  collapsedGroups: ReadonlySet<string> = new Set();

  constructor() {
    makeObservable(this, {
      collapsedGroups: observable.ref,
      setCollapsedGroups: action.bound,
    });
  }

  setCollapsedGroups(value: StateUpdater<ReadonlySet<string>>): void {
    this.collapsedGroups = resolveState(this.collapsedGroups, value);
  }
}
