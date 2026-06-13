import type { GitFileStatus, GitStatusPayload } from "../../lib/git-status";

type GitApiErrorPayload = {
  readonly error?: string;
};

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

async function readGitApiPayload<T>(response: Response): Promise<T | GitApiErrorPayload> {
  try {
    return (await response.json()) as T | GitApiErrorPayload;
  } catch {
    return {};
  }
}

function gitApiErrorMessage(label: string, response: Response, payload: unknown): string {
  const error = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string" ? payload.error.trim() : "";
  return error ? error : `${label} failed (${response.status})`;
}

function assertGitApiOk<T>(label: string, response: Response, payload: T | GitApiErrorPayload): T {
  if (!response.ok) {
    throw new Error(gitApiErrorMessage(label, response, payload));
  }
  return payload as T;
}

export async function fetchGitStatus(cwd: string): Promise<GitStatusPayload> {
  const response = await fetch("/api/git-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  const payload = await readGitApiPayload<GitStatusPayload>(response);
  return assertGitApiOk("Git status", response, payload);
}

export async function fetchGitTree(cwd: string): Promise<GitTreePayload> {
  const response = await fetch("/api/git-tree", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  const payload = await readGitApiPayload<GitTreePayload>(response);
  return assertGitApiOk("Git tree", response, payload);
}

export async function fetchGitDiff(cwd: string, file: GitFileStatus, mode: GitDiffMode): Promise<GitDiffPayload> {
  const response = await fetch("/api/git-diff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, path: file.gitPath, mode }),
  });
  const payload = await readGitApiPayload<GitDiffPayload>(response);
  return assertGitApiOk("Git diff", response, payload);
}

export async function mutateGitFile(endpoint: "/api/git-stage" | "/api/git-unstage", cwd: string, file: GitFileStatus): Promise<GitStatusPayload> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, path: file.gitPath }),
  });
  const payload = await readGitApiPayload<GitStatusPayload>(response);
  return assertGitApiOk(endpoint === "/api/git-stage" ? "Git stage" : "Git unstage", response, payload);
}

export async function initGitRepo(cwd: string): Promise<GitStatusPayload> {
  const response = await fetch("/api/git-init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  const payload = await readGitApiPayload<GitStatusPayload>(response);
  return assertGitApiOk("Git init", response, payload);
}

export async function commitGit(cwd: string, message: string): Promise<GitStatusPayload> {
  const response = await fetch("/api/git-commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, message }),
  });
  const payload = await readGitApiPayload<GitStatusPayload>(response);
  return assertGitApiOk("Git commit", response, payload);
}

export async function checkoutGitBranch(cwd: string, branch: string): Promise<GitStatusPayload> {
  const response = await fetch("/api/git-checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, branch }),
  });
  const payload = await readGitApiPayload<GitStatusPayload>(response);
  return assertGitApiOk("Git checkout", response, payload);
}

export function branchOptionsFor(status: GitStatusPayload): readonly string[] {
  return Array.from(new Set([status.branch, ...(status.branches ?? [])].filter((branch) => branch.trim().length > 0)));
}
