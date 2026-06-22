import { action, makeObservable, observable } from "mobx";
import type { ConversationResource, ResourceKind } from "../../../lib/conversation-resources";

interface DirectoryListing {
  readonly path: string;
  readonly parent: string | null;
  readonly entries: ReadonlyArray<{ readonly name: string; readonly path: string }>;
}

type CreateProjectMode = "form" | "browse";
type BrowseCancelAction = "close" | "form";
type StateUpdater<T> = T | ((current: T) => T);

function resolveState<T>(current: T, updater: StateUpdater<T>): T {
  return typeof updater === "function" ? (updater as (value: T) => T)(current) : updater;
}

export class CreateProjectDialogStore {
  name = "";

  path = "";

  error: string | null = null;

  busy = false;

  mode: CreateProjectMode = "browse";

  browseCancelAction: BrowseCancelAction = "close";

  listing: DirectoryListing | null = null;

  listingBusy = false;

  pathInput = "";

  constructor() {
    makeObservable(this, {
      name: observable,
      path: observable,
      error: observable,
      busy: observable,
      mode: observable,
      browseCancelAction: observable,
      listing: observable.ref,
      listingBusy: observable,
      pathInput: observable,
      setName: action.bound,
      setPath: action.bound,
      setError: action.bound,
      setBusy: action.bound,
      setMode: action.bound,
      setBrowseCancelAction: action.bound,
      setListing: action.bound,
      setListingBusy: action.bound,
      setPathInput: action.bound,
      reset: action.bound,
    });
  }

  setName(value: StateUpdater<string>): void {
    this.name = resolveState(this.name, value);
  }

  setPath(value: StateUpdater<string>): void {
    this.path = resolveState(this.path, value);
  }

  setError(value: StateUpdater<string | null>): void {
    this.error = resolveState(this.error, value);
  }

  setBusy(value: StateUpdater<boolean>): void {
    this.busy = resolveState(this.busy, value);
  }

  setMode(value: StateUpdater<CreateProjectMode>): void {
    this.mode = resolveState(this.mode, value);
  }

  setBrowseCancelAction(value: StateUpdater<BrowseCancelAction>): void {
    this.browseCancelAction = resolveState(this.browseCancelAction, value);
  }

  setListing(value: StateUpdater<DirectoryListing | null>): void {
    this.listing = resolveState(this.listing, value);
  }

  setListingBusy(value: StateUpdater<boolean>): void {
    this.listingBusy = resolveState(this.listingBusy, value);
  }

  setPathInput(value: StateUpdater<string>): void {
    this.pathInput = resolveState(this.pathInput, value);
  }

  reset(): void {
    this.name = "";
    this.path = "";
    this.error = null;
    this.busy = false;
    this.mode = "browse";
    this.browseCancelAction = "close";
    this.listing = null;
    this.pathInput = "";
  }
}

export class ImageBannerStore {
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

export class ResourcesPanelStore {
  lightbox: ConversationResource | null = null;

  resources: readonly ConversationResource[] = [];

  resourcesConversationId: string | null = null;

  resourcesRevisionKey: string | null = null;

  resourcesLoading = false;

  resourcesLoadError: string | null = null;

  openResourceKind: ResourceKind | null = null;

  resourceAccordionTouched = false;

  constructor() {
    makeObservable(this, {
      lightbox: observable.ref,
      resources: observable.ref,
      resourcesConversationId: observable,
      resourcesRevisionKey: observable,
      resourcesLoading: observable,
      resourcesLoadError: observable,
      openResourceKind: observable,
      resourceAccordionTouched: observable,
      clearResources: action.bound,
      failResourceLoad: action.bound,
      finishResourceLoad: action.bound,
      startResourceLoad: action.bound,
      setLightbox: action.bound,
      syncResourceKinds: action.bound,
      toggleResourceKind: action.bound,
    });
  }

  setLightbox(value: StateUpdater<ConversationResource | null>): void {
    this.lightbox = resolveState(this.lightbox, value);
  }

  clearResources(): void {
    this.resources = [];
    this.resourcesConversationId = null;
    this.resourcesRevisionKey = null;
    this.resourcesLoading = false;
    this.resourcesLoadError = null;
    this.syncResourceKinds([]);
  }

  startResourceLoad(conversationId: string, revisionKey: string): void {
    const sameConversation = this.resourcesConversationId === conversationId;
    this.resourcesConversationId = conversationId;
    this.resourcesRevisionKey = revisionKey;
    this.resourcesLoading = true;
    this.resourcesLoadError = null;
    if (!sameConversation) {
      this.resources = [];
      this.syncResourceKinds([]);
    }
  }

  finishResourceLoad(conversationId: string, revisionKey: string, resources: readonly ConversationResource[]): void {
    if (this.resourcesConversationId !== conversationId || this.resourcesRevisionKey !== revisionKey) {
      return;
    }
    this.resources = resources;
    this.resourcesLoading = false;
    this.resourcesLoadError = null;
    if (resources.length === 0) {
      this.syncResourceKinds([]);
    }
  }

  failResourceLoad(conversationId: string, revisionKey: string, error: string): void {
    if (this.resourcesConversationId !== conversationId || this.resourcesRevisionKey !== revisionKey) {
      return;
    }
    this.resourcesLoading = false;
    this.resourcesLoadError = error;
  }

  syncResourceKinds(kinds: readonly ResourceKind[]): void {
    if (kinds.length === 0) {
      this.openResourceKind = null;
      this.resourceAccordionTouched = false;
      return;
    }
    if (this.openResourceKind && kinds.includes(this.openResourceKind)) {
      return;
    }
    if (!this.resourceAccordionTouched || this.openResourceKind !== null) {
      this.openResourceKind = kinds[0];
    }
  }

  toggleResourceKind(kind: ResourceKind): void {
    this.resourceAccordionTouched = true;
    this.openResourceKind = this.openResourceKind === kind ? null : kind;
  }
}
