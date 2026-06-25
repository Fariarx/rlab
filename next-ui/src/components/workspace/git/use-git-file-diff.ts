import { useCallback, useEffect, useRef, useState } from "react";
import { fetchGitDiff, type GitDiffMode } from "../../../client/api/git-panel-api";
import type { GitFileStatus } from "../../../lib/git-status";
import { gitDiffViewerLinesFromUnified, type DiffViewerLine } from "./GitDiffViewer";
import { GitFileDiffCardStore } from "./git-panel-store";

export type GitDiffContextDirection = "before" | "after";

const DEFAULT_GIT_DIFF_CONTEXT_LINES = 3;
const GIT_DIFF_CONTEXT_EXPAND_LINES = 20;

export interface UseGitFileDiffOptions {
  readonly cwd: string;
  readonly file: GitFileStatus;
  readonly mode: GitDiffMode;
  readonly autoLoad: boolean;
  readonly revisionKey?: number | string;
  readonly unavailableMessage: string;
}

export interface UseGitFileDiffResult {
  readonly contextLines: number;
  readonly lines: readonly DiffViewerLine[] | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly oldLineCount?: number;
  readonly newLineCount?: number;
  readonly expandContext: (direction: GitDiffContextDirection) => void;
  readonly loadDiff: () => void;
}

export function useGitFileDiff({ cwd, file, mode, autoLoad, revisionKey = 0, unavailableMessage }: UseGitFileDiffOptions): UseGitFileDiffResult {
  const [store] = useState(() => new GitFileDiffCardStore());
  const { lines, setLines, loading, setLoading, error, setError } = store;
  const [contextLines, setContextLines] = useState(DEFAULT_GIT_DIFF_CONTEXT_LINES);
  const [lineCounts, setLineCounts] = useState<{ readonly oldLineCount?: number; readonly newLineCount?: number }>({});
  const requestedKeyRef = useRef<string | null>(null);
  const requestSerialRef = useRef(0);
  const targetKey = `${cwd}\u0000${mode}\u0000${file.gitPath}`;

  const loadDiffWithContext = useCallback((nextContextLines: number) => {
    const requestKey = `${targetKey}:${revisionKey}:${nextContextLines}`;
    if (requestedKeyRef.current === requestKey) {
      return;
    }
    requestedKeyRef.current = requestKey;
    const requestSerial = requestSerialRef.current + 1;
    requestSerialRef.current = requestSerial;
    setLoading(true);
    setError(null);
    const requestedContextLines = nextContextLines === DEFAULT_GIT_DIFF_CONTEXT_LINES ? undefined : nextContextLines;
    void fetchGitDiff(cwd, file, mode, requestedContextLines)
      .then((next) => {
        if (requestSerialRef.current === requestSerial) {
          const resolvedContextLines = next.contextLines ?? nextContextLines;
          setLines(next.diff.trim() ? gitDiffViewerLinesFromUnified(next.diff) : []);
          setLineCounts({ oldLineCount: next.oldLineCount, newLineCount: next.newLineCount });
          setContextLines(resolvedContextLines);
          requestedKeyRef.current = `${targetKey}:${revisionKey}:${resolvedContextLines}`;
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
  }, [cwd, file, mode, revisionKey, setError, setLines, setLoading, targetKey, unavailableMessage]);

  const loadDiff = useCallback(() => {
    loadDiffWithContext(contextLines);
  }, [contextLines, loadDiffWithContext]);

  const expandContext = useCallback((_direction: GitDiffContextDirection) => {
    const nextContextLines = contextLines + GIT_DIFF_CONTEXT_EXPAND_LINES;
    setContextLines(nextContextLines);
    loadDiffWithContext(nextContextLines);
  }, [contextLines, loadDiffWithContext]);

  useEffect(() => {
    requestedKeyRef.current = null;
    requestSerialRef.current += 1;
    setLines(null);
    setError(null);
    setLoading(false);
    setLineCounts({});
    setContextLines(DEFAULT_GIT_DIFF_CONTEXT_LINES);
  }, [setError, setLines, setLoading, targetKey]);

  useEffect(() => {
    if (autoLoad || requestedKeyRef.current !== null) {
      loadDiff();
    }
  }, [autoLoad, loadDiff]);

  return { contextLines, lines, loading, error, oldLineCount: lineCounts.oldLineCount, newLineCount: lineCounts.newLineCount, expandContext, loadDiff };
}
