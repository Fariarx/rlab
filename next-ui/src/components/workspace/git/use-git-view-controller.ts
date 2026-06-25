import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  branchOptionsFor,
  checkoutGitBranch,
  cherryPickGitCommit,
  commitGit,
  fetchGitStatus,
  fetchGitTree,
  initGitRepo,
  mutateGitFile,
  resetGitTo,
  revertGitCommit,
} from "../../../client/api/git-panel-api";
import type { I18nApi } from "../../../i18n/I18nProvider";
import type { GitFileStatus, GitStatusPayload } from "../../../lib/git-status";
import type { DiffBlock } from "../../agent";
import { changedFilesForTab, gitGraphBranchHeadsFromCommits, gitOperationErrorMessage, gitPanelFocusTabForPath, type GitCommitAction } from "./git-panel-model";
import { GitViewStore, type GitPanelTab } from "./git-panel-store";

export interface UseGitViewControllerOptions {
  readonly cwd?: string;
  readonly active: boolean;
  readonly lastTurnDiffs: readonly DiffBlock[];
  readonly focusPath?: string;
  readonly focusNonce: number;
  readonly reloadSignal: number;
  readonly autoRefreshPaused?: boolean;
  readonly onUnstagedStatsChange?: (stats: { readonly additions: number; readonly deletions: number }) => void;
  readonly t: I18nApi["t"];
}

export interface GitViewController {
  readonly store: GitViewStore;
  readonly unstagedFiles: readonly GitFileStatus[];
  readonly stagedFiles: readonly GitFileStatus[];
  readonly hasStagedFiles: boolean;
  readonly branchOptions: readonly string[];
  readonly focusSignalFor: (path: string) => number;
  readonly refreshStatus: () => void;
  readonly setActiveTab: (tab: GitPanelTab) => void;
  readonly setRefPickerOpen: (open: boolean) => void;
  readonly setCommitMessage: (message: string) => void;
  readonly stageFile: (file: GitFileStatus) => void;
  readonly unstageFile: (file: GitFileStatus) => void;
  readonly discardFile: (file: GitFileStatus) => void;
  readonly commitStagedFiles: () => void;
  readonly checkoutRef: (ref: string) => void;
  readonly commitAction: (action: GitCommitAction, hash: string) => void;
  readonly initRepo: () => void;
}

export function useGitViewController({
  cwd,
  active,
  lastTurnDiffs,
  focusPath,
  focusNonce,
  reloadSignal,
  autoRefreshPaused = false,
  onUnstagedStatsChange,
  t,
}: UseGitViewControllerOptions): GitViewController {
  const [store] = useState(() => new GitViewStore());
  const {
    status,
    setStatus,
    setError,
    setLoading,
    setGraphCommits,
    setGraphBranchHeads,
    setTreeLoading,
    setTreeError,
    reloadKey,
    setReloadKey,
    activeTab,
    setActiveTab,
    refPickerOpen,
    setRefPickerOpen,
    setActionLoading,
    commitMessage,
    setCommitMessage,
    focused,
    setFocused,
    statusVersion,
    applyStatus,
    resetForCwd,
  } = store;
  const statusRef = useRef(status);
  const autoRefreshPausedRef = useRef(autoRefreshPaused);
  const silentRefreshInFlightRef = useRef(false);
  statusRef.current = status;

  useEffect(() => {
    void cwd;
    resetForCwd();
  }, [cwd, resetForCwd]);

  useEffect(() => {
    void reloadKey;
    void reloadSignal;
    if (!cwd) {
      setLoading(false);
      return;
    }

    let alive = true;
    setLoading(true);
    setError(null);
    void fetchGitStatus(cwd)
      .then((next) => {
        if (alive) {
          applyStatus(next);
        }
      })
      .catch((loadError) => {
        if (alive) {
          setStatus(null);
          setError(gitOperationErrorMessage(loadError, t("gitStatusUnavailable")));
        }
      })
      .finally(() => {
        if (alive) {
          setLoading(false);
        }
      });

    return () => {
      alive = false;
    };
  }, [applyStatus, cwd, reloadKey, reloadSignal, setError, setLoading, setStatus, t]);

  const refreshStatusSilently = useCallback(() => {
    if (!cwd || autoRefreshPaused || silentRefreshInFlightRef.current) {
      return;
    }
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }
    silentRefreshInFlightRef.current = true;
    void fetchGitStatus(cwd)
      .then((next) => {
        applyStatus(next);
        setError(null);
      })
      .catch((loadError) => {
        if (!statusRef.current) {
          setStatus(null);
          setError(gitOperationErrorMessage(loadError, t("gitStatusUnavailable")));
        }
      })
      .finally(() => {
        silentRefreshInFlightRef.current = false;
      });
  }, [applyStatus, autoRefreshPaused, cwd, setError, setStatus, t]);

  useEffect(() => {
    if (!cwd || autoRefreshPaused) {
      return;
    }
    const handleWindowFocus = () => refreshStatusSilently();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshStatusSilently();
      }
    };
    const interval = window.setInterval(refreshStatusSilently, 20_000);
    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [autoRefreshPaused, cwd, refreshStatusSilently]);

  useEffect(() => {
    const wasPaused = autoRefreshPausedRef.current;
    autoRefreshPausedRef.current = autoRefreshPaused;
    if (wasPaused && !autoRefreshPaused) {
      refreshStatusSilently();
    }
  }, [autoRefreshPaused, refreshStatusSilently]);

  useEffect(() => {
    void statusVersion;
    if (!active || !cwd || !status || (activeTab !== "tree" && !refPickerOpen)) {
      setTreeLoading(false);
      return;
    }

    let alive = true;
    setTreeLoading(true);
    setTreeError(null);
    void fetchGitTree(cwd)
      .then((payload) => {
        if (alive) {
          setGraphCommits(payload.commits);
          setGraphBranchHeads(payload.branchHeads ?? gitGraphBranchHeadsFromCommits(payload.commits));
        }
      })
      .catch((loadError) => {
        if (alive) {
          setGraphCommits([]);
          setGraphBranchHeads([]);
          setTreeError(gitOperationErrorMessage(loadError, t("gitTreeUnavailable")));
        }
      })
      .finally(() => {
        if (alive) {
          setTreeLoading(false);
        }
      });

    return () => {
      alive = false;
    };
  }, [active, activeTab, cwd, refPickerOpen, setGraphBranchHeads, setGraphCommits, setTreeError, setTreeLoading, status, statusVersion, t]);

  const unstagedFiles = useMemo(() => changedFilesForTab(status, "unstaged"), [status]);
  const stagedFiles = useMemo(() => changedFilesForTab(status, "staged"), [status]);
  const hasStagedFiles = stagedFiles.length > 0;
  const branchOptions = useMemo(() => (status ? branchOptionsFor(status) : []), [status]);

  useEffect(() => {
    if (!focusNonce || !focusPath) {
      return;
    }
    setActiveTab(gitPanelFocusTabForPath({ focusPath, stagedFiles, lastTurnDiffs }));
    setFocused({ path: focusPath, tick: focusNonce });
  }, [focusNonce, focusPath, stagedFiles, lastTurnDiffs, setActiveTab, setFocused]);

  const unstagedAdditions = status?.unstagedAdditions ?? 0;
  const unstagedDeletions = status?.unstagedDeletions ?? 0;
  useEffect(() => {
    onUnstagedStatsChange?.({ additions: unstagedAdditions, deletions: unstagedDeletions });
  }, [unstagedAdditions, unstagedDeletions, onUnstagedStatsChange]);

  const runGitAction = (action: () => Promise<GitStatusPayload>, onDone?: () => void) => {
    if (!cwd) {
      return;
    }
    setActionLoading(true);
    setError(null);
    void action()
      .then((nextStatus) => {
        applyStatus(nextStatus);
        onDone?.();
      })
      .catch((loadError) => {
        setError(gitOperationErrorMessage(loadError, t("gitStatusUnavailable")));
      })
      .finally(() => setActionLoading(false));
  };

  const stageFile = (file: GitFileStatus) => {
    if (cwd) {
      runGitAction(() => mutateGitFile("/api/git-stage", cwd, file));
    }
  };
  const unstageFile = (file: GitFileStatus) => {
    if (cwd) {
      runGitAction(() => mutateGitFile("/api/git-unstage", cwd, file));
    }
  };
  const discardFile = (file: GitFileStatus) => {
    if (cwd) {
      runGitAction(() => mutateGitFile("/api/git-discard-file", cwd, file));
    }
  };
  const commitStagedFiles = () => {
    const message = commitMessage.trim();
    if (cwd && message) {
      runGitAction(() => commitGit(cwd, message), () => setCommitMessage(""));
    }
  };
  const checkoutRef = (ref: string) => {
    if (cwd && ref !== status?.branch) {
      runGitAction(() => checkoutGitBranch(cwd, ref));
    }
  };
  const commitAction = (action: GitCommitAction, hash: string) => {
    if (!cwd) {
      return;
    }
    if (action === "cherry-pick") {
      runGitAction(() => cherryPickGitCommit(cwd, hash));
    } else if (action === "revert") {
      runGitAction(() => revertGitCommit(cwd, hash));
    } else {
      runGitAction(() => resetGitTo(cwd, hash, action === "reset-soft" ? "soft" : action === "reset-hard" ? "hard" : "mixed"));
    }
  };
  const initRepo = () => {
    if (cwd) {
      runGitAction(() => initGitRepo(cwd));
    }
  };

  return {
    store,
    unstagedFiles,
    stagedFiles,
    hasStagedFiles,
    branchOptions,
    focusSignalFor: (path) => (focused.path === path ? focused.tick : 0),
    refreshStatus: () => setReloadKey((key) => key + 1),
    setActiveTab,
    setRefPickerOpen,
    setCommitMessage,
    stageFile,
    unstageFile,
    discardFile,
    commitStagedFiles,
    checkoutRef,
    commitAction,
    initRepo,
  };
}
