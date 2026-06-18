import AccountTreeIcon from "@mui/icons-material/AccountTree";
import AddIcon from "@mui/icons-material/Add";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import DescriptionIcon from "@mui/icons-material/Description";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import MergeIcon from "@mui/icons-material/Merge";
import RefreshIcon from "@mui/icons-material/Refresh";
import RemoveIcon from "@mui/icons-material/Remove";
import { Alert, Box, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Divider, Stack, Tab, Tabs, type Theme, Tooltip, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { type ReactNode, type RefObject, useMemo, useRef, useState } from "react";
import { type I18nApi, useI18n } from "../../../i18n/I18nProvider";
import type { GitFileStatus } from "../../../lib/git-status";
import type { DiffBlock, ReviewCommentEntry } from "../../agent";
import { Button, EmptyState, IconButton } from "../../ui";
import type { GitDiffMode } from "../../../client/api/git-panel-api";
import { countDiffChanges, type DiffViewerLine, GitDiffLines, gitDiffViewerLinesFromBlock } from "./GitDiffViewer";
import { GitRefPicker } from "./GitRefPicker";
import { GitTreeTab } from "./GitTreeTab";
import { gitCommitActionConfirmation, gitCommitActionLabelKey, type GitCommitAction } from "./git-panel-model";
import type { GitPanelTab } from "./git-panel-store";
import { useDiffFileCardController } from "./use-diff-file-card-controller";
import { useGitFileDiff } from "./use-git-file-diff";
import { useGitViewController } from "./use-git-view-controller";

/** Code-review comment plumbing shared by the diff cards. The file path is bound
 *  at each card so individual diff lines only deal with (line, text, body). */
export interface DiffCommentApi {
  readonly comments: readonly ReviewCommentEntry[];
  readonly onAddComment: (file: string, line: number, lineText: string, body: string) => void;
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
// With few changed files we load every diff up-front (so small ones open
// automatically); with many, diffs load lazily on expand to avoid a request flood.
const EAGER_DIFF_LIMIT = 25;

interface PendingGitCommitAction {
  readonly action: GitCommitAction;
  readonly hash: string;
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
  onFirstOpen,
  scrollRef,
  comments,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
  onInputActivityChange,
  focusSignal = 0,
  t,
}: {
  readonly path: string;
  readonly action?: ReactNode;
  readonly lines: readonly DiffViewerLine[] | null;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onFirstOpen?: () => void;
  readonly scrollRef?: RefObject<HTMLDivElement | null>;
  readonly comments?: readonly ReviewCommentEntry[];
  readonly onAddComment?: (line: number, lineText: string, body: string) => void;
  readonly onUpdateComment?: (id: string, body: string) => void;
  readonly onDeleteComment?: (id: string) => void;
  readonly onInputActivityChange?: (active: boolean) => void;
  /** Increments when this card is the target of an external "open in Git" jump;
   *  each new value expands the card and scrolls it into view. */
  readonly focusSignal?: number;
  readonly t: I18nApi["t"];
}) {
  const lineCount = lines?.length ?? 0;
  const gigantic = lineCount > GIGANTIC_DIFF_LINES;
  const counts = lines ? countDiffChanges(lines) : null;
  const { handleHeaderClick, open, rootRef, sentinelRef, stuck } = useDiffFileCardController({
    autoOpenLineLimit: LARGE_DIFF_LINES,
    focusSignal,
    hasLines: lines !== null,
    lineCount,
    onFirstOpen,
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
          {loading ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", color: "text.secondary", px: 1.5, py: 1.25 }}>
              <CircularProgress size={14} />
              <Typography sx={{ fontSize: "0.8rem" }}>{t("gitLoading")}</Typography>
            </Stack>
          ) : error ? (
            <Alert severity="error" sx={{ m: 1.25 }}>
              {error}
            </Alert>
          ) : gigantic ? (
            <Alert severity="warning" sx={{ m: 1.25 }}>
              {t("gitDiffTooLarge", { count: lineCount })}
            </Alert>
          ) : lines && lines.length > 0 ? (
            <GitDiffLines lines={lines} path={path} comments={comments} onAddComment={onAddComment} onUpdateComment={onUpdateComment} onDeleteComment={onDeleteComment} onInputActivityChange={onInputActivityChange} />
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
  scrollRef,
  review,
  focusSignal = 0,
  t,
}: {
  readonly cwd: string;
  readonly file: GitFileStatus;
  readonly mode: GitDiffMode;
  readonly action?: ReactNode;
  readonly autoLoad: boolean;
  readonly scrollRef?: RefObject<HTMLDivElement | null>;
  readonly review?: DiffCommentApi;
  readonly focusSignal?: number;
  readonly t: I18nApi["t"];
}) {
  const { lines, loading, error, loadDiff } = useGitFileDiff({ cwd, file, mode, autoLoad, unavailableMessage: t("gitStatusUnavailable") });

  return (
    <DiffFileCard
      path={file.gitPath}
      action={action}
      lines={lines}
      loading={loading}
      error={error}
      onFirstOpen={loadDiff}
      scrollRef={scrollRef}
      comments={review ? review.comments.filter((comment) => comment.file === file.gitPath) : undefined}
      onAddComment={review ? (line, lineText, body) => review.onAddComment(file.gitPath, line, lineText, body) : undefined}
      onUpdateComment={review?.onUpdateComment}
      onDeleteComment={review?.onDeleteComment}
      onInputActivityChange={review?.onInputActivityChange}
      focusSignal={focusSignal}
      t={t}
    />
  );
});

export const GitView = observer(function GitView({ cwd, lastTurnDiffs = [], review, active = true, onUnstagedStatsChange, bottomInset = 0, focusPath, focusNonce = 0, reloadSignal = 0, worktree }: GitViewProps) {
  const { t } = useI18n();
  const [reviewInputActive, setReviewInputActive] = useState(false);
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
    commitStagedFiles,
    checkoutRef,
    commitAction,
    initRepo,
  } = controller;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pendingCommitAction, setPendingCommitAction] = useState<PendingGitCommitAction | null>(null);
  const pendingConfirmation = pendingCommitAction ? gitCommitActionConfirmation(pendingCommitAction.action) : null;
  const pendingActionLabel = pendingCommitAction ? t(gitCommitActionLabelKey(pendingCommitAction.action)) : "";
  const pendingHashLabel = pendingCommitAction?.hash.slice(0, 12) ?? "";
  const requestCommitAction = (action: GitCommitAction, hash: string) => {
    setPendingCommitAction({ action, hash });
  };
  const confirmCommitAction = () => {
    if (!pendingCommitAction) {
      return;
    }
    commitAction(pendingCommitAction.action, pendingCommitAction.hash);
    setPendingCommitAction(null);
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
                <Stack
                  direction="row"
                  spacing={0.5}
                  sx={{
                    alignItems: "center",
                    minHeight: 28,
                    px: 0.75,
                    borderRadius: (theme) => `${theme.custom.radii.md}px`,
                    border: (theme) => `1px solid ${worktree.inWorktree ? theme.palette.status.running.border : theme.custom.borders.subtle}`,
                    backgroundColor: (theme) => (worktree.inWorktree ? theme.palette.status.running.soft : theme.custom.surfaces.s2),
                    color: worktree.inWorktree ? "text.primary" : "text.secondary",
                    flex: "0 0 auto",
                  }}
                >
                  <CallSplitIcon sx={{ fontSize: 14, flexShrink: 0, color: (theme) => (worktree.inWorktree ? theme.palette.status.running.main : theme.palette.text.secondary) }} />
                  <Typography noWrap sx={{ fontSize: "0.72rem", fontWeight: 600 }}>
                    {worktree.inWorktree ? t("worktreeActive") : t("worktreeIdle")}
                  </Typography>
                </Stack>
                {worktree.inWorktree ? (
                  <Button size="small" variant="contained" disabled={worktree.busy} onClick={worktree.onMerge} startIcon={<MergeIcon sx={{ fontSize: 14 }} />} sx={{ minHeight: 28, height: 28, px: 1, fontSize: "0.72rem", flex: "0 0 auto" }}>
                    {t("worktreeMerge")}
                  </Button>
                ) : (
                  <Button size="small" variant="subtle" disabled={worktree.busy} onClick={worktree.onCreate} startIcon={<CallSplitIcon sx={{ fontSize: 14 }} />} sx={{ minHeight: 28, height: 28, px: 1, fontSize: "0.72rem", flex: "0 0 auto" }}>
                    {t("worktreeCreate")}
                  </Button>
                )}
              </>
            )}
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
            <Tab value="unstaged" label={tabLabel(t("gitUnstagedTab"), unstagedFiles.length)} />
            <Tab value="staged" label={tabLabel(t("gitStagedTab"), stagedFiles.length)} />
            <Tab value="last-turn" label={tabLabel(t("gitLastTurnTab"), lastTurnDiffs.length)} />
          </Tabs>
        )}

        <Stack ref={scrollRef} spacing={1.5} sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 1.5, pt: 0, pb: `${16 + bottomInset}px` }}>
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

              {activeTab === "unstaged" &&
                cwd &&
                (unstagedFiles.length === 0 ? (
                  <Alert severity="info">{t("gitNoUnstagedChanges")}</Alert>
                ) : (
                  <Stack spacing={1.25}>
                    {unstagedFiles.map((file) => (
                      <GitFileDiffCard
                        key={`${cwd}:${statusVersion}:worktree:${file.code}:${file.gitPath}`}
                        cwd={cwd}
                        file={file}
                        mode="worktree"
                        autoLoad={active && unstagedFiles.length <= EAGER_DIFF_LIMIT}
                        scrollRef={scrollRef}
                        review={reviewWithActivity}
                        focusSignal={focusSignalFor(file.gitPath)}
                        t={t}
                        action={
                          <Tooltip title={t("gitStage")}>
                            <Box component="span" sx={{ display: "inline-flex" }}>
                              <IconButton size="small" disabled={actionLoading} aria-label={t("gitStageFile", { path: file.gitPath })} onClick={() => stageFile(file)} sx={{ width: 28, height: 28 }}>
                                <AddIcon sx={{ fontSize: 16 }} />
                              </IconButton>
                            </Box>
                          </Tooltip>
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
                        key={`${cwd}:${statusVersion}:staged:${file.code}:${file.gitPath}`}
                        cwd={cwd}
                        file={file}
                        mode="staged"
                        autoLoad={active && stagedFiles.length <= EAGER_DIFF_LIMIT}
                        scrollRef={scrollRef}
                        review={reviewWithActivity}
                        focusSignal={focusSignalFor(file.gitPath)}
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
                      <DiffFileCard key={block.file} path={block.file} lines={gitDiffViewerLinesFromBlock(block)} scrollRef={scrollRef} focusSignal={focusSignalFor(block.file)} t={t} />
                    ))}
                  </Stack>
                ))}
            </Stack>
          )}
        </Stack>
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
    </Stack>
  );
});

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
