import { useCallback, useMemo, useState } from "react";
import type { I18nApi } from "../../../i18n/I18nProvider";
import { createWorktree, mergeWorktree } from "../../../client/api/workspace-page-api";
import type { ToastOptions } from "../../ui";
import type { GitWorktreeControl } from "./GitPanel";

export interface UseGitWorktreeControlOptions {
  readonly conversationId: string | undefined;
  readonly basePath: string | undefined;
  readonly worktreePath: string | undefined;
  readonly setWorktree: (conversationId: string, worktreePath: string | undefined) => void;
  readonly reloadGit: () => void;
  readonly t: I18nApi["t"];
  readonly toast: (options: ToastOptions) => string;
}

export function useGitWorktreeControl({
  conversationId,
  basePath,
  worktreePath,
  setWorktree,
  reloadGit,
  t,
  toast,
}: UseGitWorktreeControlOptions): GitWorktreeControl | undefined {
  const [busy, setBusy] = useState(false);

  const onCreate = useCallback(() => {
    if (!conversationId || !basePath) {
      return;
    }
    const targetConversationId = conversationId;
    setBusy(true);
    createWorktree(basePath)
      .then(({ path }) => {
        setWorktree(targetConversationId, path);
        reloadGit();
        toast({ message: t("worktreeCreatedToast"), severity: "success", duration: 2500 });
      })
      .catch((error: unknown) => toast({ message: error instanceof Error ? error.message : String(error), severity: "error", duration: 3500 }))
      .finally(() => setBusy(false));
  }, [basePath, conversationId, reloadGit, setWorktree, t, toast]);

  const onMerge = useCallback(() => {
    if (!conversationId || !basePath || !worktreePath) {
      return;
    }
    const targetConversationId = conversationId;
    setBusy(true);
    mergeWorktree(basePath, worktreePath)
      .then(() => {
        setWorktree(targetConversationId, undefined);
        reloadGit();
        toast({ message: t("worktreeMergedToast"), severity: "success", duration: 2500 });
      })
      .catch((error: unknown) => toast({ message: error instanceof Error ? error.message : String(error), severity: "error", duration: 4000 }))
      .finally(() => setBusy(false));
  }, [basePath, conversationId, reloadGit, setWorktree, t, toast, worktreePath]);

  return useMemo(() => {
    if (!conversationId || !basePath) {
      return undefined;
    }
    return {
      active: true,
      inWorktree: Boolean(worktreePath),
      busy,
      onCreate,
      onMerge,
    };
  }, [basePath, busy, conversationId, onCreate, onMerge, worktreePath]);
}
