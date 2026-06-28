import AccountTreeIcon from "@mui/icons-material/AccountTree";
import AddIcon from "@mui/icons-material/Add";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import CloseIcon from "@mui/icons-material/Close";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import DescriptionIcon from "@mui/icons-material/Description";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import MergeIcon from "@mui/icons-material/Merge";
import RefreshIcon from "@mui/icons-material/Refresh";
import RemoveIcon from "@mui/icons-material/Remove";
import SyncIcon from "@mui/icons-material/Sync";
import UnfoldLessIcon from "@mui/icons-material/UnfoldLess";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import { Alert, Box, Checkbox, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Divider, FormControlLabel, MenuItem, Popover, Stack, Tab, Tabs, TextField, type Theme, Tooltip, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { type MouseEvent, type ReactNode, type RefObject, useMemo, useRef, useState } from "react";
import { type I18nApi, useI18n } from "../../../i18n/I18nProvider";
import type { GitFileStatus, GitStatusPayload } from "../../../lib/git-status";
import type { DiffBlock, ReviewCommentAnchor, ReviewCommentEntry } from "../../agent";
import { Button, EmptyState, IconButton } from "../../ui";
import type { GitDiffMode } from "../../../client/api/git-panel-api";
import { countDiffChanges, type DiffViewerLine, GitDiffLines, gitDiffViewerLinesFromBlock } from "./GitDiffViewer";
import { GitProjectFileTreeTab } from "./GitProjectFileTreeTab";
import { GitRefPicker } from "./GitRefPicker";
import { GitTreeTab } from "./GitTreeTab";
import { gitCommitActionConfirmation, gitCommitActionLabelKey, type GitCommitAction } from "./git-panel-model";
import type { GitPanelTab } from "./git-panel-store";
import { useDiffFileCardController } from "./use-diff-file-card-controller";
import { useGitFileDiff } from "./use-git-file-diff";
import { useGitViewController } from "./use-git-view-controller";

/** Code-review comment plumbing shared by the diff cards. The file path is bound
 *  at each card so individual diff lines only emit a compact source anchor. */
export interface DiffCommentApi {
  readonly comments: readonly ReviewCommentEntry[];
  readonly onAddComment: (file: string, anchor: ReviewCommentAnchor, body: string) => void;
  readonly onUpdateComment: (id: string, body: string) => void;
  readonly onDeleteComment: (id: string) => void;
  readonly onInputActivityChange?: (active: boolean) => void;
}

interface GitViewProps {
  readonly cwd?: string;
  readonly lastTurnDiffs?: readonly DiffBlock[];
  readonly review?: DiffCommentApi;
  /** Whether the Git view is the visible tab. Diffs only auto-load when active so
   *  a hidden (but mounted) Git view fetches status for the badge but no diffs. */
  readonly active?: boolean;
  /** Reports the unstaged line totals up for the header Git-tab badge. */
  readonly onUnstagedStatsChange?: (stats: { readonly additions: number; readonly deletions: number }) => void;
  /** Extra bottom space (px) reserved for the composer's floating tags row. */
  readonly bottomInset?: number;
  /** External "open in Git" target: the file path to focus and expand. */
  readonly focusPath?: string;
  /** Bumped on each focus request so re-selecting the same file re-scrolls. */
  readonly focusNonce?: number;
  /** Bumped to force a fresh `git status` fetch (e.g. after a revert). */
  readonly reloadSignal?: number;
  /** Worktree controls (shown only in unrestricted mode). */
  readonly worktree?: GitWorktreeControl;
}

/** Worktree workflow controls surfaced in the Git tab in unrestricted mode:
 *  move the conversation's work into an isolated worktree, then merge it back
 *  into the base repo (deleting the worktree). */
export interface GitWorktreeControl {
  readonly active: boolean;
  readonly inWorktree: boolean;
  readonly busy: boolean;
  readonly onCreate: () => void;
  readonly onMerge: () => void;
}

// A diff longer than this stays collapsed until the user opens it; one longer
// than the hard cap is never rendered (an error is shown instead).
const LARGE_DIFF_LINES = 240;
const GIGANTIC_DIFF_LINES = 2000;
const GIT_DIFF_SCROLL_END_GAP = 96;
// With few changed files we load every diff up-front (so small ones open
// automatically); with many, diffs load lazily on expand to avoid a request flood.
const EAGER_DIFF_LIMIT = 25;

type DiffOpenMode = "expand" | "collapse";

interface PendingGitCommitAction {
  readonly action: GitCommitAction;
  readonly hash: string;
}

interface PendingGitDiscardFile {
  readonly file: GitFileStatus;
}

type GitRemoteDialogMode = "fetch" | "pull" | "push";

interface GitRemoteFormState {
  readonly remote: string;
  readonly remoteBranch: string;
  readonly localBranch: string;
  readonly useDefaultDestination: boolean;
  readonly fetchAll: boolean;
  readonly rebase: boolean;
  readonly autostash: boolean;
  readonly pushTags: boolean;
  readonly force: boolean;
}

const DEFAULT_PUSH_DESTINATION = "__default__";

function uniqueNonEmpty(values: readonly (string | undefined)[]): readonly string[] {
  return Array.from(new Set(values.map((value) => value?.trim() ?? "").filter((value) => value.length > 0)));
}

function remoteFromBranch(remoteBranch: string): string {
  const slash = remoteBranch.indexOf("/");
  return slash > 0 ? remoteBranch.slice(0, slash) : "";
}

function remotesForStatus(status: GitStatusPayload | null): readonly string[] {
  const upstreamRemote = status?.upstream ? remoteFromBranch(status.upstream) : undefined;
  const branchRemotes = (status?.remoteBranches ?? []).map(remoteFromBranch);
  return uniqueNonEmpty([...(status?.remotes ?? []), upstreamRemote, ...branchRemotes]);
}

function defaultGitRemote(status: GitStatusPayload | null): string {
  const upstreamRemote = status?.upstream ? remoteFromBranch(status.upstream) : "";
  return upstreamRemote || remotesForStatus(status)[0] || "";
}

function remoteBranchesFor(status: GitStatusPayload | null, remote: string): readonly string[] {
  const branches = uniqueNonEmpty([status?.upstream, ...(status?.remoteBranches ?? [])]);
  return remote ? branches.filter((branch) => branch.startsWith(`${remote}/`)) : branches;
}

function defaultRemoteBranch(status: GitStatusPayload | null, remote: string): string {
  if (!status) {
    return "";
  }
  if (status.upstream && (!remote || status.upstream.startsWith(`${remote}/`))) {
    return status.upstream;
  }
  const sameName = remote && status.branch && status.branch !== "HEAD" ? `${remote}/${status.branch}` : "";
  return remoteBranchesFor(status, remote).find((branch) => branch === sameName) ?? remoteBranchesFor(status, remote)[0] ?? sameName;
}

function pushDestinationOptions(status: GitStatusPayload | null, remote: string, localBranch: string): readonly string[] {
  if (!status) {
    return [];
  }
  const sameName = remote && localBranch ? `${remote}/${localBranch}` : undefined;
  return uniqueNonEmpty([status.upstream, sameName, ...remoteBranchesFor(status, remote)]);
}

function remoteFormFromStatus(status: GitStatusPayload | null, branchOptions: readonly string[]): GitRemoteFormState {
  const remote = defaultGitRemote(status);
  const remoteBranch = defaultRemoteBranch(status, remote);
  return {
    remote,
    remoteBranch,
    localBranch: status?.branch && status.branch !== "HEAD" ? status.branch : branchOptions[0] ?? status?.branch ?? "",
    useDefaultDestination: Boolean(status?.upstream),
    fetchAll: false,
    rebase: false,
    autostash: false,
    pushTags: false,
    force: false,
  };
}

function tabLabel(label: string, count?: number): string {
  return typeof count === "number" ? `${label} ${count}` : label;
}

/** A single file's diff rendered as a collapsible card (kit DiffCard style):
 *  small diffs open by default, large ones stay collapsed, gigantic ones show
 *  an error instead of being rendered. */
const DiffFileCard = observer(function DiffFileCard({
  path,
  action,
  lines,
  loading = false,
  error = null,
  oldLineCount,
  newLineCount,
  onExpandContext,
  onFirstOpen,
  scrollRef,
  comments,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
  onInputActivityChange,
  focusSignal = 0,
  openMode,
  openSignal = 0,
  t,
}: {
  readonly path: string;
  readonly action?: ReactNode;
  readonly lines: readonly DiffViewerLine[] | null;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly oldLineCount?: number;
  readonly newLineCount?: number;
  readonly onExpandContext?: (direction: "before" | "after") => void;
  readonly onFirstOpen?: () => void;
  readonly scrollRef?: RefObject<HTMLDivElement | null>;
  readonly comments?: readonly ReviewCommentEntry[];
  readonly onAddComment?: (anchor: ReviewCommentAnchor, body: string) => void;
  readonly onUpdateComment?: (id: string, body: string) => void;
  readonly onDeleteComment?: (id: string) => void;
  readonly onInputActivityChange?: (active: boolean) => void;
  /** Increments when this card is the target of an external "open in Git" jump;
   *  each new value expands the card and scrolls it into view. */
  readonly focusSignal?: number;
  readonly openMode?: DiffOpenMode;
  readonly openSignal?: number;
  readonly t: I18nApi["t"];
}) {
  const lineCount = lines?.length ?? 0;
  const gigantic = lineCount > GIGANTIC_DIFF_LINES;
  const counts = lines ? countDiffChanges(lines) : null;
  const initialLoading = loading && lines === null;
  const blockingError = error && lines === null;
  const { handleHeaderClick, open, rootRef, sentinelRef, stuck } = useDiffFileCardController({
    autoOpenLineLimit: LARGE_DIFF_LINES,
    focusSignal,
    hasLines: lines !== null,
    lineCount,
    onFirstOpen,
    openMode,
    openSignal,
    scrollRef,
  });

  const radius = (theme: Theme) => `${theme.custom.radii.md}px`;
  const topRadius = stuck ? 0 : radius;

  return (
    <Box
      ref={rootRef}
      sx={{
        borderRadius: radius,
        border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
        backgroundColor: (theme) => theme.custom.surfaces.s2,
        // `clip` keeps the rounded corners from being overrun by the sticky
        // header when it reaches the card bottom, without creating a scroll
        // container (which `hidden` would, breaking the sticky header).
        overflow: "clip",
      }}
    >
      <Box ref={sentinelRef} aria-hidden="true" sx={{ height: 0 }} />
      <Stack
        direction="row"
        spacing={0.75}
        onClick={handleHeaderClick}
        sx={{
          alignItems: "center",
          px: 1,
          minHeight: 32,
          cursor: "pointer",
          position: "sticky",
          top: 0,
          zIndex: 1,
          borderTopLeftRadius: topRadius,
          borderTopRightRadius: topRadius,
          // When collapsed the header is the whole card, so it keeps the rounded
          // bottom corners; when open they belong to the diff body below.
          borderBottomLeftRadius: open ? 0 : radius,
          borderBottomRightRadius: open ? 0 : radius,
          backgroundColor: (theme) => theme.custom.surfaces.s2,
          "&:hover": { backgroundColor: (theme) => theme.custom.surfaces.s3 },
        }}
      >
        <DescriptionIcon sx={{ fontSize: 14, color: "text.secondary", flex: "0 0 auto" }} />
        <Typography component="span" sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.74rem", fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {path}
        </Typography>
        {counts && (counts.additions > 0 || counts.deletions > 0) && (
          <Box component="span" sx={{ display: "inline-flex", gap: 0.5, flex: "0 0 auto", fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.7rem" }}>
            {counts.additions > 0 && <Box component="span" sx={{ color: (theme) => theme.palette.status.ok.main }}>+{counts.additions}</Box>}
            {counts.deletions > 0 && <Box component="span" sx={{ color: (theme) => theme.palette.status.error.main }}>−{counts.deletions}</Box>}
          </Box>
        )}
        {action && (
          <Box sx={{ flex: "0 0 auto", display: "flex" }} onClick={(event) => event.stopPropagation()}>
            {action}
          </Box>
        )}
        <KeyboardArrowDownIcon sx={{ fontSize: 16, color: "text.secondary", flex: "0 0 auto", transition: "transform 180ms ease", transform: open ? "rotate(180deg)" : "none" }} />
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ borderTop: (theme) => `1px solid ${theme.custom.borders.subtle}`, borderBottomLeftRadius: radius, borderBottomRightRadius: radius, overflow: "hidden", backgroundColor: (theme) => theme.custom.surfaces.s1 }}>
          {initialLoading ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", color: "text.secondary", px: 1.5, py: 1.25 }}>
              <CircularProgress size={14} />
              <Typography sx={{ fontSize: "0.8rem" }}>{t("gitLoading")}</Typography>
            </Stack>
          ) : blockingError ? (
            <Alert severity="error" sx={{ m: 1.25 }}>
              {error}
            </Alert>
          ) : gigantic ? (
            <Alert severity="warning" sx={{ m: 1.25 }}>
              {t("gitDiffTooLarge", { count: lineCount })}
            </Alert>
          ) : lines && lines.length > 0 ? (
            <GitDiffLines
              lines={lines}
              path={path}
              oldLineCount={oldLineCount}
              newLineCount={newLineCount}
              contextLoading={loading}
              comments={comments}
              onAddComment={onAddComment}
              onUpdateComment={onUpdateComment}
              onDeleteComment={onDeleteComment}
              onExpandContext={onExpandContext}
              onInputActivityChange={onInputActivityChange}
            />
          ) : (
            <Typography sx={{ color: "text.secondary", fontSize: "0.8rem", px: 1.5, py: 1.25 }}>{t("gitDiffEmpty")}</Typography>
          )}
        </Box>
      </Collapse>
    </Box>
  );
});

/** A working-tree / staged file diff card that fetches its own diff. */
const GitFileDiffCard = observer(function GitFileDiffCard({
  cwd,
  file,
  mode,
  action,
  autoLoad,
  revisionKey,
  scrollRef,
  review,
  focusSignal = 0,
  openMode,
  openSignal = 0,
  t,
}: {
  readonly cwd: string;
  readonly file: GitFileStatus;
  readonly mode: GitDiffMode;
  readonly action?: ReactNode;
  readonly autoLoad: boolean;
  readonly revisionKey?: number | string;
  readonly scrollRef?: RefObject<HTMLDivElement | null>;
  readonly review?: DiffCommentApi;
  readonly focusSignal?: number;
  readonly openMode?: DiffOpenMode;
  readonly openSignal?: number;
  readonly t: I18nApi["t"];
}) {
  const { lines, loading, error, oldLineCount, newLineCount, expandContext, loadDiff } = useGitFileDiff({ cwd, file, mode, autoLoad, revisionKey, unavailableMessage: t("gitStatusUnavailable") });

  return (
    <DiffFileCard
      path={file.gitPath}
      action={action}
      lines={lines}
      loading={loading}
      error={error}
      oldLineCount={oldLineCount}
      newLineCount={newLineCount}
      onExpandContext={expandContext}
      onFirstOpen={loadDiff}
      scrollRef={scrollRef}
      comments={review ? review.comments.filter((comment) => comment.file === file.gitPath) : undefined}
      onAddComment={review ? (anchor, body) => review.onAddComment(file.gitPath, anchor, body) : undefined}
      onUpdateComment={review?.onUpdateComment}
      onDeleteComment={review?.onDeleteComment}
      onInputActivityChange={review?.onInputActivityChange}
      focusSignal={focusSignal}
      openMode={openMode}
      openSignal={openSignal}
      t={t}
    />
  );
});

export const GitView = observer(function GitView({ cwd, lastTurnDiffs = [], review, active = true, onUnstagedStatsChange, bottomInset = 0, focusPath, focusNonce = 0, reloadSignal = 0, worktree }: GitViewProps) {
  const { t } = useI18n();
  const [reviewInputActive, setReviewInputActive] = useState(false);
  const [diffOpenCommand, setDiffOpenCommand] = useState<{ readonly mode: DiffOpenMode; readonly signal: number }>({ mode: "expand", signal: 0 });
  const reviewWithActivity = useMemo<DiffCommentApi | undefined>(
    () => review ? { ...review, onInputActivityChange: setReviewInputActive } : undefined,
    [review],
  );
  const controller = useGitViewController({
    cwd,
    active,
    lastTurnDiffs,
    focusPath,
    focusNonce,
    reloadSignal,
    autoRefreshPaused: reviewInputActive,
    onUnstagedStatsChange,
    t,
  });
  const {
    status,
    error,
    loading,
    graphCommits,
    graphBranchHeads,
    treeLoading,
    treeError,
    projectFiles,
    projectFilesLoading,
    projectFilesError,
    activeTab,
    actionLoading,
    commitMessage,
    statusVersion,
  } = controller.store;
  const {
    unstagedFiles,
    stagedFiles,
    hasStagedFiles,
    branchOptions,
    focusSignalFor,
    refreshStatus,
    setActiveTab,
    setRefPickerOpen,
    setCommitMessage,
    stageFile,
    unstageFile,
    discardFile,
    commitStagedFiles,
    checkoutRef,
    commitAction,
    fetchRemote,
    pullRemote,
    pushRemote,
    initRepo,
  } = controller;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pendingCommitAction, setPendingCommitAction] = useState<PendingGitCommitAction | null>(null);
  const [pendingDiscardFile, setPendingDiscardFile] = useState<PendingGitDiscardFile | null>(null);
  const [worktreeConfirmAnchor, setWorktreeConfirmAnchor] = useState<HTMLElement | null>(null);
  const [remoteDialog, setRemoteDialog] = useState<GitRemoteDialogMode | null>(null);
  const [remoteForm, setRemoteForm] = useState<GitRemoteFormState>(() => remoteFormFromStatus(null, []));
  const pendingConfirmation = pendingCommitAction ? gitCommitActionConfirmation(pendingCommitAction.action) : null;
  const pendingActionLabel = pendingCommitAction ? t(gitCommitActionLabelKey(pendingCommitAction.action)) : "";
  const pendingHashLabel = pendingCommitAction?.hash.slice(0, 12) ?? "";
  const pendingDiscardPath = pendingDiscardFile?.file.gitPath ?? "";
  const worktreeConfirmOpen = Boolean(worktreeConfirmAnchor);
  const scrollBottomPadding = bottomInset + GIT_DIFF_SCROLL_END_GAP;
  const visibleDiffCount = activeTab === "unstaged" ? unstagedFiles.length : activeTab === "staged" ? stagedFiles.length : activeTab === "last-turn" ? lastTurnDiffs.length : 0;
  const activeTabHasDiffControls = activeTab === "unstaged" || activeTab === "staged" || activeTab === "last-turn";
  const diffOpenControlsDisabled = visibleDiffCount === 0;
  const remoteActionDisabled = !cwd || !status || loading || actionLoading;
  const remotes = remotesForStatus(status);
  const pullBranchOptions = remoteBranchesFor(status, remoteForm.remote);
  const pushBranchOptions = pushDestinationOptions(status, remoteForm.remote, remoteForm.localBranch);
  const remoteDialogCanSubmit = remoteDialog === "fetch"
    ? remoteForm.fetchAll || remoteForm.remote.length > 0
    : remoteDialog === "pull"
      ? remoteForm.remote.length > 0 && remoteForm.remoteBranch.length > 0
      : remoteDialog === "push"
        ? remoteForm.useDefaultDestination || (remoteForm.localBranch.length > 0 && remoteForm.remote.length > 0 && remoteForm.remoteBranch.length > 0)
        : false;
  const requestCommitAction = (action: GitCommitAction, hash: string) => {
    setPendingCommitAction({ action, hash });
  };
  const commandDiffCards = (mode: DiffOpenMode) => {
    setDiffOpenCommand((current) => ({ mode, signal: current.signal + 1 }));
  };
  const confirmCommitAction = () => {
    if (!pendingCommitAction) {
      return;
    }
    commitAction(pendingCommitAction.action, pendingCommitAction.hash);
    setPendingCommitAction(null);
  };
  const confirmDiscardFile = () => {
    if (!pendingDiscardFile) {
      return;
    }
    discardFile(pendingDiscardFile.file);
    setPendingDiscardFile(null);
  };
  const requestWorktreeCreate = (event: MouseEvent<HTMLElement>) => {
    setWorktreeConfirmAnchor(event.currentTarget);
  };
  const closeWorktreeConfirm = () => {
    setWorktreeConfirmAnchor(null);
  };
  const confirmWorktreeCreate = () => {
    worktree?.onCreate();
    closeWorktreeConfirm();
  };
  const openRemoteDialog = (mode: GitRemoteDialogMode) => {
    setRemoteForm(remoteFormFromStatus(status, branchOptions));
    setRemoteDialog(mode);
  };
  const closeRemoteDialog = () => {
    setRemoteDialog(null);
  };
  const updateRemoteForm = (patch: Partial<GitRemoteFormState>) => {
    setRemoteForm((current) => ({ ...current, ...patch }));
  };
  const updateRemote = (remote: string) => {
    updateRemoteForm({ remote, remoteBranch: defaultRemoteBranch(status, remote), useDefaultDestination: remoteForm.useDefaultDestination && Boolean(status?.upstream?.startsWith(`${remote}/`)) });
  };
  const updatePushDestination = (value: string) => {
    if (value === DEFAULT_PUSH_DESTINATION) {
      updateRemoteForm({ useDefaultDestination: true, remote: defaultGitRemote(status), remoteBranch: status?.upstream ?? "" });
      return;
    }
    const remote = remoteFromBranch(value) || remoteForm.remote;
    updateRemoteForm({ useDefaultDestination: false, remote, remoteBranch: value });
  };
  const updatePushLocalBranch = (localBranch: string) => {
    const remote = remoteForm.remote || defaultGitRemote(status);
    updateRemoteForm({
      localBranch,
      useDefaultDestination: false,
      remote,
      remoteBranch: remote && localBranch ? `${remote}/${localBranch}` : remoteForm.remoteBranch,
    });
  };
  const submitRemoteDialog = () => {
    if (!remoteDialog || !remoteDialogCanSubmit) {
      return;
    }
    if (remoteDialog === "fetch") {
      fetchRemote({ all: remoteForm.fetchAll, ...(remoteForm.fetchAll ? {} : { remote: remoteForm.remote }) });
    } else if (remoteDialog === "pull") {
      pullRemote({ remote: remoteForm.remote, branch: remoteForm.remoteBranch, rebase: remoteForm.rebase, autostash: remoteForm.autostash });
    } else {
      pushRemote({
        localBranch: remoteForm.localBranch,
        remote: remoteForm.remote,
        remoteBranch: remoteForm.remoteBranch,
        useDefaultDestination: remoteForm.useDefaultDestination,
        pushTags: remoteForm.pushTags,
        force: remoteForm.force,
      });
    }
    closeRemoteDialog();
  };

  return (
    <Stack sx={{ height: "100%", minHeight: 0, backgroundColor: (theme) => theme.custom.surfaces.s1 }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{
            alignItems: "center",
            justifyContent: "space-between",
            px: 1.5,
            py: 0.75,
            rowGap: 0.75,
            flexWrap: "wrap",
            flex: "0 0 auto",
            borderBottom: (theme) => `1px solid ${theme.custom.borders.subtle}`,
            backgroundColor: (theme) => (worktree?.active && worktree.inWorktree ? theme.palette.status.running.soft : theme.custom.surfaces.s1),
          }}
        >
          <Box sx={{ minWidth: 0, flex: "1 1 420px", display: "flex", alignItems: "center", gap: 0.75, rowGap: 0.75, flexWrap: "wrap" }}>
            <AccountTreeIcon sx={{ fontSize: 16, color: "text.secondary", flexShrink: 0 }} />
            {status ? (
              <GitRefPicker
                branches={branchOptions}
                commits={graphCommits}
                currentBranch={status.branch}
                currentHash={status.commitHash}
                currentTitle={status.commitTitle}
                dirty={!status.clean}
                disabled={!cwd || loading || actionLoading}
                loading={treeLoading}
                onClose={() => setRefPickerOpen(false)}
                onOpen={() => setRefPickerOpen(true)}
                onSelect={checkoutRef}
                t={t}
              />
            ) : (
              <Typography component="span" noWrap sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontWeight: 700, fontSize: "0.82rem" }}>
                {t("git")}
              </Typography>
            )}
            {status?.commitHash && (
              <Typography component="span" sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.75rem", color: "text.secondary", flexShrink: 0, whiteSpace: "nowrap" }}>
                · {status.commitHash}
              </Typography>
            )}
            {status?.commitTitle && (
              <Typography component="span" noWrap sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.75rem", color: "text.tertiary", flex: "1 1 220px", minWidth: 96, maxWidth: 520 }}>
                · {status.commitTitle}
              </Typography>
            )}
          </Box>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flex: "0 0 auto" }}>
            {/* Fixed-width slot on the left of the right cluster so the refresh
                button never shifts when the git refresh indicator appears. */}
            <Box sx={{ width: 16, height: 16, flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {(loading || treeLoading) && <CircularProgress size={14} thickness={5} aria-label={t("gitTreeLoading")} sx={{ color: "text.secondary" }} />}
            </Box>
            {worktree?.active && cwd && (
              <>
                <Typography
                  component="span"
                  noWrap
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    minHeight: 28,
                    px: 0.25,
                    color: "text.secondary",
                    fontSize: "0.72rem",
                    fontWeight: 600,
                    flex: "0 0 auto",
                  }}
                >
                  {worktree.inWorktree ? t("worktreeActive") : t("worktreeIdle")}
                </Typography>
                {worktree.inWorktree ? (
                  <Button size="small" variant="contained" disabled={worktree.busy} onClick={worktree.onMerge} startIcon={<MergeIcon sx={{ fontSize: 14 }} />} sx={{ minHeight: 28, height: 28, px: 1, fontSize: "0.72rem", flex: "0 0 auto" }}>
                    {t("worktreeMerge")}
                  </Button>
                ) : (
                  <Tooltip title={t("worktreeCreate")}>
                    <span>
                      <IconButton aria-label={t("worktreeCreate")} disabled={worktree.busy} onClick={requestWorktreeCreate}>
                        <CallSplitIcon sx={{ fontSize: 17 }} />
                      </IconButton>
                    </span>
                  </Tooltip>
                )}
              </>
            )}
            {activeTab === "tree" ? (
              <>
                <GitRemoteActionButton title={t("gitFetch")} disabled={remoteActionDisabled || remotes.length === 0} onClick={() => openRemoteDialog("fetch")} icon={<SyncIcon sx={{ fontSize: 17 }} />} />
                <GitRemoteActionButton title={t("gitPull")} count={status?.behind ?? 0} disabled={remoteActionDisabled || pullBranchOptions.length === 0} onClick={() => openRemoteDialog("pull")} icon={<CloudDownloadIcon sx={{ fontSize: 17 }} />} />
                <GitRemoteActionButton title={t("gitPush")} count={status?.ahead ?? 0} disabled={remoteActionDisabled || (status?.upstream ? false : pushBranchOptions.length === 0)} onClick={() => openRemoteDialog("push")} icon={<CloudUploadIcon sx={{ fontSize: 17 }} />} />
              </>
            ) : activeTabHasDiffControls ? (
              <>
                <Tooltip title={t("gitExpandAllDiffs")}>
                  <span>
                    <IconButton aria-label={t("gitExpandAllDiffs")} disabled={diffOpenControlsDisabled} onClick={() => commandDiffCards("expand")}>
                      <UnfoldMoreIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={t("gitCollapseAllDiffs")}>
                  <span>
                    <IconButton aria-label={t("gitCollapseAllDiffs")} disabled={diffOpenControlsDisabled} onClick={() => commandDiffCards("collapse")}>
                      <UnfoldLessIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  </span>
                </Tooltip>
              </>
            ) : null}
            <Tooltip title={t("refresh")}>
              <span>
                <IconButton aria-label={t("refresh")} disabled={!cwd || loading} onClick={refreshStatus}>
                  <RefreshIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Stack>

        {status && (
          <Tabs
            value={activeTab}
            onChange={(_, value: GitPanelTab) => setActiveTab(value)}
            variant="scrollable"
            scrollButtons={false}
            aria-label={t("gitStatus")}
            sx={{
              flex: "0 0 auto",
              minHeight: 40,
              px: 1,
              borderBottom: (theme) => `1px solid ${theme.custom.borders.subtle}`,
              "& .MuiTab-root": { minHeight: 40, py: 0, textTransform: "none", fontSize: "0.76rem", fontFamily: (theme) => theme.custom.fonts.mono },
            }}
          >
            <Tab value="tree" label={tabLabel(t("gitTreeTab"), graphCommits.length)} />
            <Tab value="files" label={tabLabel(t("gitFilesTab"), projectFiles.length)} />
            <Tab value="unstaged" label={tabLabel(t("gitUnstagedTab"), unstagedFiles.length)} />
            <Tab value="staged" label={tabLabel(t("gitStagedTab"), stagedFiles.length)} />
            <Tab value="last-turn" label={tabLabel(t("gitLastTurnTab"), lastTurnDiffs.length)} />
          </Tabs>
        )}

        <Stack
          ref={scrollRef}
          spacing={1.5}
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            px: 1.5,
            pt: 0,
            pb: `${scrollBottomPadding}px`,
            scrollPaddingBottom: `${scrollBottomPadding}px`,
          }}
        >
          {loading && (
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", color: "text.secondary", pt: 1.5 }}>
              <CircularProgress size={16} />
              <Typography>{t("gitLoading")}</Typography>
            </Stack>
          )}
          {!loading && !status && (
            <Stack sx={{ height: "100%", justifyContent: "center", alignItems: "center", px: 3, py: 4 }}>
              <EmptyState
                icon={<AccountTreeIcon />}
                title={t("gitEmptyTitle")}
                description={cwd ? error ?? t("gitNoRepoDescription") : t("gitNoProject")}
                action={cwd ? <Button variant="contained" disabled={actionLoading} onClick={initRepo}>{t("gitInitRepo")}</Button> : undefined}
              />
            </Stack>
          )}
          {status && (
            <Stack spacing={1.5} sx={{ minHeight: 0, pt: 1.5 }}>
              {activeTab === "tree" && <GitTreeTab commits={graphCommits} branchHeads={graphBranchHeads} currentBranch={status.branch} branches={status.branches} currentHash={status.commitHash} error={treeError} loading={treeLoading} onCheckoutBranch={checkoutRef} onCommitAction={requestCommitAction} actionsDisabled={!cwd || loading || actionLoading} canCheckout={Boolean(cwd) && status.clean && !loading && !actionLoading} t={t} />}

              {activeTab === "files" && <GitProjectFileTreeTab cwd={cwd} files={projectFiles} loading={projectFilesLoading} error={projectFilesError} t={t} />}

              {activeTab === "unstaged" &&
                cwd &&
                (unstagedFiles.length === 0 ? (
                  <Alert severity="info">{t("gitNoUnstagedChanges")}</Alert>
                ) : (
                  <Stack spacing={1.25}>
                    {unstagedFiles.map((file) => (
                      <GitFileDiffCard
                        key={`${cwd}:worktree:${file.gitPath}`}
                        cwd={cwd}
                        file={file}
                        mode="worktree"
                        autoLoad={active && unstagedFiles.length <= EAGER_DIFF_LIMIT}
                        revisionKey={statusVersion}
                        scrollRef={scrollRef}
                        review={reviewWithActivity}
                        focusSignal={focusSignalFor(file.gitPath)}
                        openMode={diffOpenCommand.mode}
                        openSignal={diffOpenCommand.signal}
                        t={t}
                        action={
                          <Stack direction="row" spacing={0.25} sx={{ alignItems: "center" }}>
                            <Tooltip title={t("gitDiscard")}>
                              <Box component="span" sx={{ display: "inline-flex" }}>
                                <IconButton size="small" disabled={actionLoading} aria-label={t("gitDiscardFile", { path: file.gitPath })} onClick={() => setPendingDiscardFile({ file })} sx={{ width: 28, height: 28 }}>
                                  <RemoveIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                              </Box>
                            </Tooltip>
                            <Tooltip title={t("gitStage")}>
                              <Box component="span" sx={{ display: "inline-flex" }}>
                                <IconButton size="small" disabled={actionLoading} aria-label={t("gitStageFile", { path: file.gitPath })} onClick={() => stageFile(file)} sx={{ width: 28, height: 28 }}>
                                  <AddIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                              </Box>
                            </Tooltip>
                          </Stack>
                        }
                      />
                    ))}
                  </Stack>
                ))}

              {activeTab === "staged" &&
                cwd &&
                (stagedFiles.length === 0 ? (
                  <Alert severity="info">{t("gitNoStagedChanges")}</Alert>
                ) : (
                  <Stack spacing={1.25}>
                    <Box sx={{ display: "flex", justifyContent: "center" }}>
                      <GitCommitForm
                        actionLoading={actionLoading}
                        commitMessage={commitMessage}
                        hasStagedFiles={hasStagedFiles}
                        onCommit={commitStagedFiles}
                        onMessageChange={setCommitMessage}
                        t={t}
                      />
                    </Box>
                    <Divider sx={{ borderColor: (theme) => theme.custom.borders.subtle }} />
                    {stagedFiles.map((file) => (
                      <GitFileDiffCard
                        key={`${cwd}:staged:${file.gitPath}`}
                        cwd={cwd}
                        file={file}
                        mode="staged"
                        autoLoad={active && stagedFiles.length <= EAGER_DIFF_LIMIT}
                        revisionKey={statusVersion}
                        scrollRef={scrollRef}
                        review={reviewWithActivity}
                        focusSignal={focusSignalFor(file.gitPath)}
                        openMode={diffOpenCommand.mode}
                        openSignal={diffOpenCommand.signal}
                        t={t}
                        action={
                          <Tooltip title={t("gitUnstage")}>
                            <Box component="span" sx={{ display: "inline-flex" }}>
                              <IconButton size="small" disabled={actionLoading} aria-label={t("gitUnstageFile", { path: file.gitPath })} onClick={() => unstageFile(file)} sx={{ width: 28, height: 28 }}>
                                <RemoveIcon sx={{ fontSize: 16 }} />
                              </IconButton>
                            </Box>
                          </Tooltip>
                        }
                      />
                    ))}
                  </Stack>
                ))}

              {activeTab === "last-turn" &&
                (lastTurnDiffs.length === 0 ? (
                  <Alert severity="info">{t("gitNoLastTurnChanges")}</Alert>
                ) : (
                  <Stack spacing={1.25}>
                    {lastTurnDiffs.map((block) => (
                      <DiffFileCard
                        key={block.file}
                        path={block.file}
                        lines={gitDiffViewerLinesFromBlock(block)}
                        scrollRef={scrollRef}
                        focusSignal={focusSignalFor(block.file)}
                        openMode={diffOpenCommand.mode}
                        openSignal={diffOpenCommand.signal}
                        t={t}
                      />
                    ))}
                  </Stack>
                ))}
            </Stack>
          )}
        </Stack>
        <GitRemoteDialog
          mode={remoteDialog}
          open={remoteDialog !== null}
          status={status}
          branchOptions={branchOptions}
          remotes={remotes}
          pullBranchOptions={pullBranchOptions}
          pushBranchOptions={pushBranchOptions}
          form={remoteForm}
          actionLoading={actionLoading}
          canSubmit={remoteDialogCanSubmit}
          onClose={closeRemoteDialog}
          onSubmit={submitRemoteDialog}
          onFormChange={updateRemoteForm}
          onRemoteChange={updateRemote}
          onPushLocalBranchChange={updatePushLocalBranch}
          onPushDestinationChange={updatePushDestination}
          t={t}
        />
        <Dialog open={pendingCommitAction !== null} onClose={() => setPendingCommitAction(null)} maxWidth="xs" fullWidth>
          <DialogTitle>{pendingConfirmation ? t(pendingConfirmation.titleKey) : ""}</DialogTitle>
          <DialogContent>
            <DialogContentText>
              {pendingConfirmation ? t(pendingConfirmation.bodyKey, { action: pendingActionLabel, hash: pendingHashLabel }) : ""}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPendingCommitAction(null)}>{t("cancel")}</Button>
            <Button variant="contained" color={pendingConfirmation?.danger ? "error" : "primary"} disabled={actionLoading} onClick={confirmCommitAction} autoFocus>
              {pendingConfirmation ? t(pendingConfirmation.confirmKey) : ""}
            </Button>
          </DialogActions>
        </Dialog>
        <Dialog open={pendingDiscardFile !== null} onClose={() => setPendingDiscardFile(null)} maxWidth="xs" fullWidth>
          <DialogTitle>{t("gitConfirmDiscardFileTitle")}</DialogTitle>
          <DialogContent>
            <DialogContentText>{t("gitConfirmDiscardFileBody", { path: pendingDiscardPath })}</DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPendingDiscardFile(null)}>{t("cancel")}</Button>
            <Button variant="contained" color="error" disabled={actionLoading} onClick={confirmDiscardFile} autoFocus>
              {t("gitConfirmDiscardFileConfirm")}
            </Button>
          </DialogActions>
        </Dialog>
        <Popover
          open={worktreeConfirmOpen}
          anchorEl={worktreeConfirmAnchor}
          onClose={closeWorktreeConfirm}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
          slotProps={{ paper: { sx: { mt: 0.75, width: 300, p: 1.25, borderRadius: (theme) => `${theme.custom.radii.md}px`, border: (theme) => `1px solid ${theme.custom.borders.subtle}`, backgroundColor: (theme) => theme.custom.surfaces.s2 } } }}
        >
          <Stack spacing={1}>
            <Typography sx={{ fontSize: "0.82rem", fontWeight: 700 }}>{t("worktreeConfirmCreateTitle")}</Typography>
            <Typography sx={{ fontSize: "0.76rem", color: "text.secondary", lineHeight: 1.45 }}>{t("worktreeConfirmCreateBody")}</Typography>
            <Stack direction="row" spacing={0.75} sx={{ justifyContent: "flex-end" }}>
              <Button size="small" variant="text" onClick={closeWorktreeConfirm}>
                {t("cancel")}
              </Button>
              <Button size="small" variant="contained" disabled={worktree?.busy} onClick={confirmWorktreeCreate} autoFocus>
                {t("confirm")}
              </Button>
            </Stack>
          </Stack>
        </Popover>
    </Stack>
  );
});

function GitRemoteActionButton({
  title,
  icon,
  count = 0,
  disabled,
  onClick,
}: {
  readonly title: string;
  readonly icon: ReactNode;
  readonly count?: number;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  const label = count > 0 ? `${title} (${count})` : title;
  return (
    <Tooltip title={label}>
      <Box component="span" sx={{ position: "relative", display: "inline-flex" }}>
        <IconButton aria-label={label} disabled={disabled} onClick={onClick}>
          {icon}
        </IconButton>
        {count > 0 && (
          <Box
            component="span"
            sx={{
              position: "absolute",
              top: -3,
              right: -4,
              minWidth: 15,
              height: 15,
              px: 0.35,
              borderRadius: 999,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.58rem",
              fontWeight: 800,
              lineHeight: 1,
              color: (theme) => theme.palette.common.white,
              backgroundColor: (theme) => theme.palette.status.running.main,
              border: (theme) => `1px solid ${theme.custom.surfaces.s1}`,
              pointerEvents: "none",
            }}
          >
            {count > 99 ? "99+" : count}
          </Box>
        )}
      </Box>
    </Tooltip>
  );
}

function GitRemoteDialog({
  mode,
  open,
  status,
  branchOptions,
  remotes,
  pullBranchOptions,
  pushBranchOptions,
  form,
  actionLoading,
  canSubmit,
  onClose,
  onSubmit,
  onFormChange,
  onRemoteChange,
  onPushLocalBranchChange,
  onPushDestinationChange,
  t,
}: {
  readonly mode: GitRemoteDialogMode | null;
  readonly open: boolean;
  readonly status: GitStatusPayload | null;
  readonly branchOptions: readonly string[];
  readonly remotes: readonly string[];
  readonly pullBranchOptions: readonly string[];
  readonly pushBranchOptions: readonly string[];
  readonly form: GitRemoteFormState;
  readonly actionLoading: boolean;
  readonly canSubmit: boolean;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
  readonly onFormChange: (patch: Partial<GitRemoteFormState>) => void;
  readonly onRemoteChange: (remote: string) => void;
  readonly onPushLocalBranchChange: (branch: string) => void;
  readonly onPushDestinationChange: (value: string) => void;
  readonly t: I18nApi["t"];
}) {
  const title = mode === "fetch" ? t("gitFetch") : mode === "pull" ? t("gitPull") : t("gitPush");
  const description = mode === "fetch" ? t("gitFetchDescription") : mode === "pull" ? t("gitPullDescription") : t("gitPushDescription");
  const confirmLabel = title;
  const pushDestinationValue = form.useDefaultDestination ? DEFAULT_PUSH_DESTINATION : form.remoteBranch;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ px: 2, pt: 1.8, pb: 0.25, pr: 6, position: "relative", fontSize: "1rem", fontWeight: 800 }}>
        {title}
        <IconButton aria-label={t("close")} disabled={actionLoading} onClick={onClose} sx={{ position: "absolute", top: 8, right: 8 }}>
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ px: 2, pt: 0.25, pb: 1.25 }}>
        <Stack spacing={1.25}>
          <Typography sx={{ color: "text.secondary", fontSize: "0.9rem" }}>{description}</Typography>
          {mode === "fetch" && (
            <>
              <GitRemoteFormRow label={t("gitFetchRemote")}>
                <GitRemoteSelect value={form.remote} disabled={actionLoading || form.fetchAll} options={remotes} onChange={onRemoteChange} />
              </GitRemoteFormRow>
              <GitRemoteFormRow>
                <FormControlLabel
                  control={<Checkbox size="small" checked={form.fetchAll} onChange={(event) => onFormChange({ fetchAll: event.currentTarget.checked })} />}
                  label={t("gitFetchAllRemotes")}
                  sx={{ m: 0, "& .MuiFormControlLabel-label": { fontSize: "0.82rem" } }}
                />
              </GitRemoteFormRow>
            </>
          )}
          {mode === "pull" && (
            <>
              <GitRemoteFormRow label={t("gitPullRemote")}>
                <GitRemoteSelect value={form.remote} disabled={actionLoading} options={remotes} onChange={onRemoteChange} />
              </GitRemoteFormRow>
              <GitRemoteFormRow label={t("gitPullBranch")}>
                <GitRemoteSelect value={form.remoteBranch} disabled={actionLoading} options={pullBranchOptions} onChange={(remoteBranch) => onFormChange({ remoteBranch })} />
              </GitRemoteFormRow>
              <GitRemoteFormRow label={t("gitPullInto")}>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", minHeight: 32, color: "text.primary" }}>
                  <CallSplitIcon sx={{ fontSize: 15, color: "text.secondary" }} />
                  <Typography sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.84rem", fontWeight: 700 }}>{status?.branch ?? "-"}</Typography>
                </Stack>
              </GitRemoteFormRow>
              <GitRemoteFormRow>
                <FormControlLabel
                  control={<Checkbox size="small" checked={form.rebase} onChange={(event) => onFormChange({ rebase: event.currentTarget.checked })} />}
                  label={t("gitPullRebase")}
                  sx={{ m: 0, "& .MuiFormControlLabel-label": { fontSize: "0.82rem" } }}
                />
              </GitRemoteFormRow>
              <GitRemoteFormRow>
                <FormControlLabel
                  control={<Checkbox size="small" checked={form.autostash} onChange={(event) => onFormChange({ autostash: event.currentTarget.checked })} />}
                  label={t("gitPullAutostash")}
                  sx={{ m: 0, "& .MuiFormControlLabel-label": { fontSize: "0.82rem" } }}
                />
              </GitRemoteFormRow>
            </>
          )}
          {mode === "push" && (
            <>
              <GitRemoteFormRow label={t("gitPushBranch")}>
                <GitRemoteSelect value={form.localBranch} disabled={actionLoading} options={branchOptions} onChange={onPushLocalBranchChange} />
              </GitRemoteFormRow>
              <GitRemoteFormRow label={t("gitPushTo")}>
                <TextField
                  select
                  size="small"
                  value={pushDestinationValue}
                  disabled={actionLoading}
                  onChange={(event) => onPushDestinationChange(event.target.value)}
                  sx={gitRemoteFieldSx}
                >
                  {status?.upstream && (
                    <MenuItem value={DEFAULT_PUSH_DESTINATION}>
                      {t("gitDefaultRemoteDestination", { branch: status.upstream })}
                    </MenuItem>
                  )}
                  {pushBranchOptions
                    .filter((remoteBranch) => remoteBranch !== status?.upstream)
                    .map((remoteBranch) => (
                      <MenuItem key={remoteBranch} value={remoteBranch}>
                        {remoteBranch}
                      </MenuItem>
                    ))}
                </TextField>
              </GitRemoteFormRow>
              <GitRemoteFormRow>
                <FormControlLabel
                  control={<Checkbox size="small" checked={form.pushTags} onChange={(event) => onFormChange({ pushTags: event.currentTarget.checked })} />}
                  label={t("gitPushAllTags")}
                  sx={{ m: 0, "& .MuiFormControlLabel-label": { fontSize: "0.82rem" } }}
                />
              </GitRemoteFormRow>
              <GitRemoteFormRow>
                <FormControlLabel
                  control={<Checkbox size="small" checked={form.force} onChange={(event) => onFormChange({ force: event.currentTarget.checked })} />}
                  label={t("gitPushForce")}
                  sx={{ m: 0, "& .MuiFormControlLabel-label": { fontSize: "0.82rem" } }}
                />
              </GitRemoteFormRow>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 2, pt: 0, pb: 1.5 }}>
        <Button onClick={onClose}>{t("cancel")}</Button>
        <Button variant="contained" disabled={actionLoading || !canSubmit} onClick={onSubmit} autoFocus>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function GitRemoteFormRow({ label, children }: { readonly label?: string; readonly children: ReactNode }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "72px minmax(0, 1fr)", sm: "80px minmax(0, 1fr)" }, columnGap: 1.25, alignItems: "center" }}>
      <Typography component="span" sx={{ justifySelf: "end", color: "text.primary", fontSize: "0.82rem", fontWeight: 700 }}>
        {label ?? ""}
      </Typography>
      <Box sx={{ minWidth: 0 }}>{children}</Box>
    </Box>
  );
}

const gitRemoteFieldSx = {
  width: "100%",
  "& .MuiInputBase-root": {
    height: 34,
    borderRadius: (theme: Theme) => `${theme.custom.radii.md}px`,
    fontSize: "0.86rem",
    fontFamily: (theme: Theme) => theme.custom.fonts.mono,
    backgroundColor: (theme: Theme) => theme.custom.surfaces.s2,
  },
};

function GitRemoteSelect({ value, options, disabled, onChange }: { readonly value: string; readonly options: readonly string[]; readonly disabled: boolean; readonly onChange: (value: string) => void }) {
  const selected = options.includes(value) ? value : options[0] ?? "";
  return (
    <TextField select size="small" value={selected} disabled={disabled || options.length === 0} onChange={(event) => onChange(event.target.value)} sx={gitRemoteFieldSx}>
      {options.map((option) => (
        <MenuItem key={option} value={option}>
          {option}
        </MenuItem>
      ))}
    </TextField>
  );
}

/** Commit message + button, shown centered at the top of the staged tab (only
 *  when there are staged files). The staged files themselves are listed below. */
function GitCommitForm({
  actionLoading,
  commitMessage,
  hasStagedFiles,
  onCommit,
  onMessageChange,
  t,
}: {
  readonly actionLoading: boolean;
  readonly commitMessage: string;
  readonly hasStagedFiles: boolean;
  readonly onCommit: () => void;
  readonly onMessageChange: (value: string) => void;
  readonly t: I18nApi["t"];
}) {
  return (
    <Stack spacing={1.25} sx={{ width: "100%", maxWidth: 560 }}>
      <Typography variant="microLabel" sx={{ color: "text.secondary" }}>
        {t("gitCommit")}
      </Typography>
      <Box
        component="textarea"
        aria-label={t("gitCommitMessage")}
        placeholder={t("gitCommitMessagePlaceholder")}
        value={commitMessage}
        onChange={(event) => onMessageChange(event.currentTarget.value)}
        rows={3}
        sx={{
          width: "100%",
          resize: "vertical",
          border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
          borderRadius: (theme) => `${theme.custom.radii.md}px`,
          bgcolor: (theme) => theme.custom.surfaces.s2,
          color: "text.primary",
          font: "inherit",
          fontSize: "0.84rem",
          lineHeight: 1.45,
          p: 1,
          outline: 0,
          "&:focus": {
            borderColor: (theme) => theme.custom.borders.focus,
          },
        }}
      />
      <Button variant="contained" size="small" disabled={!hasStagedFiles || actionLoading || commitMessage.trim().length === 0} onClick={onCommit}>
        {t("gitCommit")}
      </Button>
    </Stack>
  );
}
