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
  readonly revisionKey?: number | string;
  readonly unavailableMessage: string;
}

export interface UseGitFileDiffResult {
  readonly lines: readonly DiffViewerLine[] | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly loadDiff: () => void;
}

export function useGitFileDiff({ cwd, file, mode, autoLoad, revisionKey = 0, unavailableMessage }: UseGitFileDiffOptions): UseGitFileDiffResult {
  const [store] = useState(() => new GitFileDiffCardStore());
  const { lines, setLines, loading, setLoading, error, setError } = store;
  const requestedRevisionRef = useRef<number | string | null>(null);
  const requestSerialRef = useRef(0);

  const loadDiff = useCallback(() => {
    if (requestedRevisionRef.current === revisionKey) {
      return;
    }
    requestedRevisionRef.current = revisionKey;
    const requestSerial = requestSerialRef.current + 1;
    requestSerialRef.current = requestSerial;
    setLoading(true);
    setError(null);
    void fetchGitDiff(cwd, file, mode)
      .then((next) => {
        if (requestSerialRef.current === requestSerial) {
          setLines(next.diff.trim() ? gitDiffViewerLinesFromUnified(next.diff) : []);
        }
      })
      .catch((loadError) => {
        if (requestSerialRef.current === requestSerial) {
          setError(loadError instanceof Error && loadError.message ? loadError.message : unavailableMessage);
        }
      })
      .finally(() => {
        if (requestSerialRef.current === requestSerial) {
          setLoading(false);
        }
      });
  }, [cwd, file, mode, revisionKey, setError, setLines, setLoading, unavailableMessage]);

  useEffect(() => {
    if (autoLoad || requestedRevisionRef.current !== null) {
      loadDiff();
    }
  }, [autoLoad, loadDiff]);

  return { lines, loading, error, loadDiff };
}
