import { useMemo } from "react";
import { normalizeExternalUrl } from "../../../lib/external-url";
import type { WorkspaceUiApi } from "../../../lib/workspace-ui";
import type { ConversationView } from "../../agent";

interface BrowserOpenRequest {
  readonly url: string;
  readonly nonce: number;
}

interface GitFocusRequest {
  readonly path: string;
  readonly nonce: number;
}

type StateUpdater<T> = T | ((current: T) => T);

export interface UseWorkspaceUiApiOptions {
  readonly showView: (view: ConversationView) => void;
  readonly previewEnabled: boolean;
  readonly setBrowserOpenRequest: (value: StateUpdater<BrowserOpenRequest>) => void;
  readonly setGitFocus: (value: StateUpdater<GitFocusRequest>) => void;
}

export function useWorkspaceUiApi({
  showView,
  previewEnabled,
  setBrowserOpenRequest,
  setGitFocus,
}: UseWorkspaceUiApiOptions): WorkspaceUiApi {
  return useMemo(
    () => ({
      openPreview: (url: string) => {
        if (!previewEnabled) {
          return;
        }
        const target = normalizeExternalUrl(url) ?? url;
        setBrowserOpenRequest((prev) => ({ url: target, nonce: prev.nonce + 1 }));
        showView("preview");
      },
      openGitFile: (file: string) => {
        setGitFocus((prev) => ({ path: file, nonce: prev.nonce + 1 }));
        showView("git");
      },
    }),
    [previewEnabled, setBrowserOpenRequest, setGitFocus, showView],
  );
}
