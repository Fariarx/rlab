import type { GitGraphBranchHead, GitGraphCommit } from "../../../client/api/git-panel-api";
import type { TranslationKey } from "../../../i18n/i18n-catalog";
import type { GitFileStatus, GitStatusPayload } from "../../../lib/git-status";

export type GitChangeTab = "unstaged" | "staged";
export type GitCommitAction = "cherry-pick" | "revert" | "reset-soft" | "reset-mixed" | "reset-hard";
export type GitFocusTab = GitChangeTab | "last-turn";

export interface GitCommitActionConfirmation {
  readonly titleKey: TranslationKey;
  readonly bodyKey: TranslationKey;
  readonly confirmKey: TranslationKey;
  readonly danger: boolean;
}

export function changedFilesForTab(status: GitStatusPayload | null, tab: GitChangeTab): readonly GitFileStatus[] {
  const files = status?.files ?? [];
  return tab === "unstaged" ? files.filter((file) => file.unstaged) : files.filter((file) => file.staged);
}

export function gitPanelFocusTabForPath({
  focusPath,
  stagedFiles,
  lastTurnDiffs,
}: {
  readonly focusPath: string;
  readonly stagedFiles: readonly Pick<GitFileStatus, "gitPath">[];
  readonly lastTurnDiffs: readonly { readonly file: string }[];
}): GitFocusTab {
  if (stagedFiles.some((file) => file.gitPath === focusPath)) {
    return "staged";
  }
  if (lastTurnDiffs.some((block) => block.file === focusPath)) {
    return "last-turn";
  }
  return "unstaged";
}

export function gitGraphRefName(ref: string): string | null {
  const trimmed = ref.trim();
  if (!trimmed || trimmed === "HEAD") {
    return null;
  }
  const arrowIndex = trimmed.indexOf(" -> ");
  if (arrowIndex >= 0) {
    const target = trimmed.slice(arrowIndex + 4).trim();
    return target.length > 0 ? target : null;
  }
  return trimmed;
}

export function gitGraphBranchHeadsFromCommits(commits: readonly GitGraphCommit[]): readonly GitGraphBranchHead[] {
  const branchHeads = new Map<string, string>();
  for (const commit of commits) {
    for (const ref of commit.refs) {
      const name = gitGraphRefName(ref);
      if (name && !branchHeads.has(name)) {
        branchHeads.set(name, commit.hash);
      }
    }
  }
  return Array.from(branchHeads, ([name, hash]) => ({ name, hash }));
}

export function gitOperationErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function gitCommitActionLabelKey(action: GitCommitAction): TranslationKey {
  switch (action) {
    case "cherry-pick":
      return "gitCherryPick";
    case "revert":
      return "gitRevert";
    case "reset-soft":
      return "gitResetSoft";
    case "reset-mixed":
      return "gitResetMixed";
    case "reset-hard":
      return "gitResetHard";
  }
}

export function gitCommitActionConfirmation(action: GitCommitAction): GitCommitActionConfirmation {
  if (action === "reset-hard") {
    return {
      titleKey: "gitConfirmResetHardTitle",
      bodyKey: "gitConfirmResetHardBody",
      confirmKey: "gitConfirmResetHardConfirm",
      danger: true,
    };
  }
  if (action === "reset-soft" || action === "reset-mixed") {
    return {
      titleKey: "gitConfirmResetTitle",
      bodyKey: "gitConfirmResetBody",
      confirmKey: "gitConfirmResetConfirm",
      danger: true,
    };
  }
  return {
    titleKey: "gitConfirmCommitActionTitle",
    bodyKey: "gitConfirmCommitActionBody",
    confirmKey: "gitConfirmCommitActionConfirm",
    danger: false,
  };
}
