import type { GitFileStatus, GitStatusPayload } from "../../lib/git-status";
import { readJsonPayload, responseErrorMessage } from "./http";

export interface GitDiffPayload {
  readonly diff: string;
  readonly mode: "staged" | "worktree";
  readonly path: string;
}

export interface GitTreePayload {
  readonly commits: readonly GitGraphCommit[];
  readonly branchHeads?: readonly GitGraphBranchHead[];
}

export interface GitGraphBranchHead {
  readonly name: string;
  readonly hash: string;
}

export interface GitGraphCommit {
  readonly graph: string;
  readonly hash: string;
  readonly shortHash: string;
  readonly parents: readonly string[];
  readonly author: string;
  readonly date: string;
  readonly refs: readonly string[];
  readonly subject: string;
}

export type GitDiffMode = GitDiffPayload["mode"];

async function readGitApiPayload<T>(label: string, response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `${label} failed (${response.status})`));
  }
  return readJsonPayload<T>(response);
}

export async function fetchGitStatus(cwd: string): Promise<GitStatusPayload> {
  const response = await fetch("/api/git-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  return readGitApiPayload("Git status", response);
}

export async function fetchGitTree(cwd: string): Promise<GitTreePayload> {
  const response = await fetch("/api/git-tree", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  return readGitApiPayload("Git tree", response);
}

export async function fetchGitDiff(cwd: string, file: GitFileStatus, mode: GitDiffMode): Promise<GitDiffPayload> {
  const response = await fetch("/api/git-diff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, path: file.gitPath, mode }),
  });
  return readGitApiPayload("Git diff", response);
}

export async function mutateGitFile(endpoint: "/api/git-stage" | "/api/git-unstage", cwd: string, file: GitFileStatus): Promise<GitStatusPayload> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, path: file.gitPath }),
  });
  return readGitApiPayload(endpoint === "/api/git-stage" ? "Git stage" : "Git unstage", response);
}

export async function initGitRepo(cwd: string): Promise<GitStatusPayload> {
  const response = await fetch("/api/git-init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  return readGitApiPayload("Git init", response);
}

export async function commitGit(cwd: string, message: string): Promise<GitStatusPayload> {
  const response = await fetch("/api/git-commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, message }),
  });
  return readGitApiPayload("Git commit", response);
}

export async function checkoutGitBranch(cwd: string, branch: string): Promise<GitStatusPayload> {
  const response = await fetch("/api/git-checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, branch }),
  });
  return readGitApiPayload("Git checkout", response);
}

export type GitResetMode = "soft" | "mixed" | "hard";

async function postGitCommitAction(endpoint: string, label: string, body: Record<string, unknown>): Promise<GitStatusPayload> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readGitApiPayload(label, response);
}

export function cherryPickGitCommit(cwd: string, hash: string): Promise<GitStatusPayload> {
  return postGitCommitAction("/api/git-cherry-pick", "Git cherry-pick", { cwd, hash });
}

export function revertGitCommit(cwd: string, hash: string): Promise<GitStatusPayload> {
  return postGitCommitAction("/api/git-revert", "Git revert", { cwd, hash });
}

export function resetGitTo(cwd: string, hash: string, mode: GitResetMode): Promise<GitStatusPayload> {
  return postGitCommitAction("/api/git-reset", "Git reset", { cwd, hash, mode });
}

export function branchOptionsFor(status: GitStatusPayload): readonly string[] {
  return Array.from(new Set([status.branch, ...(status.branches ?? [])].filter((branch) => branch.trim().length > 0)));
}
