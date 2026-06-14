import { createContext, type ReactNode, useContext } from "react";

/**
 * Workspace-level UI actions that deeply nested chat components (markdown links,
 * diff cards under a message) need to drive — without threading callbacks through
 * Conversation -> Message -> AgentBlockRenderer. The provider lives in
 * WorkspacePageView; consumers read it through {@link useWorkspaceUi}.
 *
 * The context is nullable: outside the workspace (kit showcase, isolated tests)
 * components fall back to inert behavior (e.g. a link stays a plain link).
 */
export interface WorkspaceUiApi {
  /** Switch to the Preview (browser) tab and open the given URL there. */
  readonly openPreview: (url: string) => void;
  /** Switch to the Git tab and focus/expand the diff for the given file path. */
  readonly openGitFile: (file: string) => void;
}

const WorkspaceUiContext = createContext<WorkspaceUiApi | null>(null);

export function WorkspaceUiProvider({ value, children }: { readonly value: WorkspaceUiApi; readonly children: ReactNode }) {
  return <WorkspaceUiContext.Provider value={value}>{children}</WorkspaceUiContext.Provider>;
}

/** Returns the workspace UI actions, or null when rendered outside a provider. */
export function useWorkspaceUi(): WorkspaceUiApi | null {
  return useContext(WorkspaceUiContext);
}
