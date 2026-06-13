import { action, makeObservable, observable } from "mobx";
import type { ConversationResource } from "../../lib/conversation-resources";

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

export class CommandPaletteStore {
  query = "";

  activeIndex = 0;

  constructor() {
    makeObservable(this, {
      query: observable,
      activeIndex: observable,
      setQuery: action.bound,
      setActiveIndex: action.bound,
    });
  }

  setQuery(value: StateUpdater<string>): void {
    this.query = resolveState(this.query, value);
  }

  setActiveIndex(value: StateUpdater<number>): void {
    this.activeIndex = resolveState(this.activeIndex, value);
  }
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

export class ResourceGroupStore {
  open = true;

  constructor() {
    makeObservable(this, {
      open: observable,
      setOpen: action.bound,
    });
  }

  setOpen(value: StateUpdater<boolean>): void {
    this.open = resolveState(this.open, value);
  }
}

export class ResourcesPanelStore {
  lightbox: ConversationResource | null = null;

  constructor() {
    makeObservable(this, {
      lightbox: observable.ref,
      setLightbox: action.bound,
    });
  }

  setLightbox(value: StateUpdater<ConversationResource | null>): void {
    this.lightbox = resolveState(this.lightbox, value);
  }
}
