import { describe, expect, it } from "vitest";
import type { GitGraphCommit } from "../src/client/api/git-panel-api";
import type { GitFileStatus, GitStatusPayload } from "../src/lib/git-status";
import {
  changedFilesForTab,
  gitGraphBranchHeadsFromCommits,
  gitOperationErrorMessage,
  gitGraphRefName,
  gitPanelFocusTabForPath,
} from "../src/components/workspace/git/git-panel-model";

function file(patch: Pick<GitFileStatus, "gitPath" | "staged" | "unstaged">): GitFileStatus {
  return {
    code: " M",
    gitPath: patch.gitPath,
    label: "Modified",
    path: patch.gitPath,
    staged: patch.staged,
    unstaged: patch.unstaged,
  };
}

function status(files: readonly GitFileStatus[]): GitStatusPayload {
  return {
    branch: "main",
    ahead: 0,
    behind: 0,
    clean: files.length === 0,
    files,
  };
}

function commit(patch: Partial<GitGraphCommit> & Pick<GitGraphCommit, "hash">): GitGraphCommit {
  const base: GitGraphCommit = {
    graph: "*",
    hash: patch.hash,
    shortHash: patch.hash.slice(0, 7),
    parents: [],
    author: "Alice",
    date: "2026-06-14",
    refs: [],
    subject: "Subject",
  };
  return { ...base, ...patch };
}

describe("git-panel-model", () => {
  it("filters changed files for staged and unstaged tabs", () => {
    const unstagedOnly = file({ gitPath: "src/unstaged.ts", staged: false, unstaged: true });
    const stagedOnly = file({ gitPath: "src/staged.ts", staged: true, unstaged: false });
    const both = file({ gitPath: "src/both.ts", staged: true, unstaged: true });
    const payload = status([unstagedOnly, stagedOnly, both]);

    expect(changedFilesForTab(payload, "unstaged").map((item) => item.gitPath)).toEqual(["src/unstaged.ts", "src/both.ts"]);
    expect(changedFilesForTab(payload, "staged").map((item) => item.gitPath)).toEqual(["src/staged.ts", "src/both.ts"]);
    expect(changedFilesForTab(null, "unstaged")).toEqual([]);
  });

  it("resolves the Git focus tab with staged changes taking priority", () => {
    expect(
      gitPanelFocusTabForPath({
        focusPath: "src/file.ts",
        stagedFiles: [{ gitPath: "src/file.ts" }],
        lastTurnDiffs: [{ file: "src/file.ts" }],
      }),
    ).toBe("staged");

    expect(
      gitPanelFocusTabForPath({
        focusPath: "src/from-last-turn.ts",
        stagedFiles: [],
        lastTurnDiffs: [{ file: "src/from-last-turn.ts" }],
      }),
    ).toBe("last-turn");

    expect(
      gitPanelFocusTabForPath({
        focusPath: "src/working-tree.ts",
        stagedFiles: [],
        lastTurnDiffs: [],
      }),
    ).toBe("unstaged");
  });

  it("normalizes git graph refs and derives first branch heads from commits", () => {
    expect(gitGraphRefName("HEAD")).toBeNull();
    expect(gitGraphRefName(" HEAD -> main ")).toBe("main");
    expect(gitGraphRefName("origin/main")).toBe("origin/main");

    const branchHeads = gitGraphBranchHeadsFromCommits([
      commit({ hash: "aaa1111", refs: ["HEAD -> main", "origin/main"] }),
      commit({ hash: "bbb2222", refs: ["main", "feature"] }),
      commit({ hash: "ccc3333", refs: ["feature"] }),
    ]);

    expect(branchHeads).toEqual([
      { name: "main", hash: "aaa1111" },
      { name: "origin/main", hash: "aaa1111" },
      { name: "feature", hash: "bbb2222" },
    ]);
  });

  it("normalizes git operation errors with a fallback", () => {
    expect(gitOperationErrorMessage(new Error("Git status failed"), "fallback")).toBe("Git status failed");
    expect(gitOperationErrorMessage(new Error(""), "fallback")).toBe("fallback");
    expect(gitOperationErrorMessage("plain", "fallback")).toBe("fallback");
  });
});
