export type ComposerHistoryDirection = "up" | "down";

export interface ComposerHistoryState {
  readonly index: number;
  readonly draft: string;
}

export interface ComposerHistoryNavigationInput {
  readonly history: readonly string[];
  readonly state: ComposerHistoryState;
  readonly currentValue: string;
  readonly direction: ComposerHistoryDirection;
}

export interface ComposerHistoryNavigationResult {
  readonly handled: boolean;
  readonly state: ComposerHistoryState;
  readonly value?: string;
}

export const emptyComposerHistoryState: ComposerHistoryState = { index: -1, draft: "" };

export function resetComposerHistoryState(state: ComposerHistoryState): ComposerHistoryState {
  return state.index === -1 ? state : { ...state, index: -1 };
}

export function navigateComposerHistory({
  history,
  state,
  currentValue,
  direction,
}: ComposerHistoryNavigationInput): ComposerHistoryNavigationResult {
  if (history.length === 0) {
    return { handled: false, state };
  }
  const browsing = state.index !== -1;
  if (direction === "up") {
    if (!browsing) {
      const index = history.length - 1;
      return { handled: true, state: { index, draft: currentValue }, value: history[index] ?? "" };
    }
    if (state.index <= 0) {
      return { handled: true, state };
    }
    const index = state.index - 1;
    return { handled: true, state: { ...state, index }, value: history[index] ?? "" };
  }
  if (!browsing) {
    return { handled: false, state };
  }
  if (state.index < history.length - 1) {
    const index = state.index + 1;
    return { handled: true, state: { ...state, index }, value: history[index] ?? "" };
  }
  return { handled: true, state: { index: -1, draft: state.draft }, value: state.draft };
}
