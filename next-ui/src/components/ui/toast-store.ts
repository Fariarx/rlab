import { action, makeObservable, observable } from "mobx";
import type { ReactNode } from "react";
import type { ToastSeverity } from "./Toast";

export interface ToastOptions {
  readonly message: ReactNode;
  readonly severity?: ToastSeverity;
  /** Auto-dismiss delay in ms; defaults to 5000. Pass 0 to disable. */
  readonly duration?: number;
  readonly action?: ReactNode;
}

export interface ActiveToast extends ToastOptions {
  readonly id: string;
}

export class ToastProviderStore {
  toasts: readonly ActiveToast[] = [];

  constructor() {
    makeObservable(this, {
      toasts: observable.ref,
      addToast: action.bound,
      dismissToast: action.bound,
    });
  }

  addToast(toast: ActiveToast): void {
    this.toasts = [...this.toasts, toast];
  }

  dismissToast(id: string): void {
    this.toasts = this.toasts.filter((item) => item.id !== id);
  }
}
