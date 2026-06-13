import { action, makeObservable, observable } from "mobx";

export class ControlsSectionStore {
  view = "list";

  env = "staging";

  constructor() {
    makeObservable(this, {
      view: observable,
      env: observable,
      setView: action.bound,
      setEnv: action.bound,
    });
  }

  setView(value: string): void {
    this.view = value;
  }

  setEnv(value: string): void {
    this.env = value;
  }
}

export class OverlaysSectionStore {
  dialogOpen = false;

  anchor: HTMLElement | null = null;

  tab = 0;

  constructor() {
    makeObservable(this, {
      dialogOpen: observable,
      anchor: observable.ref,
      tab: observable,
      setDialogOpen: action.bound,
      setAnchor: action.bound,
      setTab: action.bound,
    });
  }

  setDialogOpen(value: boolean): void {
    this.dialogOpen = value;
  }

  setAnchor(value: HTMLElement | null): void {
    this.anchor = value;
  }

  setTab(value: number): void {
    this.tab = value;
  }
}
