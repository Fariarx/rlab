import type { GitGraphBranchHead, GitGraphCommit } from "../../../client/api/git-panel-api";
import type { GitFileStatus, GitStatusPayload } from "../../../lib/git-status";

export type GitChangeTab = "unstaged" | "staged";
export type GitFocusTab = GitChangeTab | "last-turn";

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
