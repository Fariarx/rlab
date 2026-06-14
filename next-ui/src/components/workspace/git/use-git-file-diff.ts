import { useCallback, useEffect, useRef, useState } from "react";
import { fetchGitDiff, type GitDiffMode } from "../../../client/api/git-panel-api";
import type { GitFileStatus } from "../../../lib/git-status";
import { gitDiffViewerLinesFromUnified, type DiffViewerLine } from "./GitDiffViewer";
import { GitFileDiffCardStore } from "./git-panel-store";

export interface UseGitFileDiffOptions {
  readonly cwd: string;
  readonly file: GitFileStatus;
  readonly mode: GitDiffMode;
  readonly autoLoad: boolean;
  readonly unavailableMessage: string;
}

export interface UseGitFileDiffResult {
  readonly lines: readonly DiffViewerLine[] | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly loadDiff: () => void;
}

export function useGitFileDiff({ cwd, file, mode, autoLoad, unavailableMessage }: UseGitFileDiffOptions): UseGitFileDiffResult {
  const [store] = useState(() => new GitFileDiffCardStore());
  const { lines, setLines, loading, setLoading, error, setError } = store;
  const requestedRef = useRef(false);

  const loadDiff = useCallback(() => {
    if (requestedRef.current) {
      return;
    }
    requestedRef.current = true;
    setLoading(true);
    setError(null);
    void fetchGitDiff(cwd, file, mode)
      .then((next) => setLines(next.diff.trim() ? gitDiffViewerLinesFromUnified(next.diff) : []))
      .catch((loadError) => setError(loadError instanceof Error && loadError.message ? loadError.message : unavailableMessage))
      .finally(() => setLoading(false));
  }, [cwd, file, mode, setError, setLines, setLoading, unavailableMessage]);

  useEffect(() => {
    if (autoLoad) {
      loadDiff();
    }
  }, [autoLoad, loadDiff]);

  return { lines, loading, error, loadDiff };
}
