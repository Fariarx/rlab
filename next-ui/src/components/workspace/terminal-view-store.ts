import { action, makeObservable, observable } from "mobx";

interface TerminalStatus {
  readonly connecting: boolean;
  readonly running: boolean;
  readonly error: string | null;
  readonly exitCode: number | null;
}

interface TerminalInputModifiers {
  readonly ctrl: boolean;
  readonly alt: boolean;
}

type StateUpdater<T> = T | ((current: T) => T);

function resolveState<T>(current: T, updater: StateUpdater<T>): T {
  return typeof updater === "function" ? (updater as (value: T) => T)(current) : updater;
}

export class TerminalViewStore {
  status: TerminalStatus;

  terminalEpoch = 0;

  inputModifiers: TerminalInputModifiers;

  constructor(initialStatus: TerminalStatus, initialInputModifiers: TerminalInputModifiers) {
    this.status = initialStatus;
    this.inputModifiers = initialInputModifiers;
    makeObservable(this, {
      status: observable.ref,
      terminalEpoch: observable,
      inputModifiers: observable.ref,
      setStatus: action.bound,
      setTerminalEpoch: action.bound,
      setInputModifiers: action.bound,
    });
  }

  setStatus(value: StateUpdater<TerminalStatus>): void {
    this.status = resolveState(this.status, value);
  }

  setTerminalEpoch(value: StateUpdater<number>): void {
    this.terminalEpoch = resolveState(this.terminalEpoch, value);
  }

  setInputModifiers(value: StateUpdater<TerminalInputModifiers>): void {
    this.inputModifiers = resolveState(this.inputModifiers, value);
  }
}
