import AccountTreeIcon from "@mui/icons-material/AccountTree";
import AddIcon from "@mui/icons-material/Add";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import DescriptionIcon from "@mui/icons-material/Description";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import MergeIcon from "@mui/icons-material/Merge";
import RefreshIcon from "@mui/icons-material/Refresh";
import RemoveIcon from "@mui/icons-material/Remove";
import { Alert, Box, Chip, CircularProgress, Collapse, Stack, Tab, Tabs, type Theme, Tooltip, Typography } from "@mui/material";
import { type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type I18nApi, useI18n } from "../../i18n/I18nProvider";
import type { GitFileStatus, GitStatusPayload } from "../../lib/git-status";
import type { DiffBlock, ReviewCommentEntry } from "../agent";
import { Button, EmptyState, IconButton } from "../ui";
import { countDiffChanges, type DiffViewerLine, GitDiffLines, gitDiffViewerLinesFromBlock, gitDiffViewerLinesFromUnified } from "./GitDiffViewer";

/** Code-review comment plumbing shared by the diff cards. The file path is bound
 *  at each card so individual diff lines only deal with (line, text, body). */
export interface DiffCommentApi {
  readonly comments: readonly ReviewCommentEntry[];
  readonly onAddComment: (file: string, line: number, lineText: string, body: string) => void;
  readonly onUpdateComment: (id: string, body: string) => void;
  readonly onDeleteComment: (id: string) => void;
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

type GitApiErrorPayload = {
  readonly error?: string;
};

interface GitDiffPayload {
  readonly diff: string;
  readonly mode: "staged" | "worktree";
  readonly path: string;
}

type GitPanelTab = "unstaged" | "staged" | "commit" | "last-turn";
type GitDiffMode = GitDiffPayload["mode"];

// A diff longer than this stays collapsed until the user opens it; one longer
// than the hard cap is never rendered (an error is shown instead).
const LARGE_DIFF_LINES = 240;
const GIGANTIC_DIFF_LINES = 2000;
// With few changed files we load every diff up-front (so small ones open
// automatically); with many, diffs load lazily on expand to avoid a request flood.
const EAGER_DIFF_LIMIT = 25;

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

async function fetchGitStatus(cwd: string): Promise<GitStatusPayload> {
  const response = await fetch("/api/git-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  const payload = await readGitApiPayload<GitStatusPayload>(response);
  return assertGitApiOk("Git status", response, payload);
}

async function fetchGitDiff(cwd: string, file: GitFileStatus, mode: GitDiffMode): Promise<GitDiffPayload> {
  const response = await fetch("/api/git-diff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, path: file.gitPath, mode }),
  });
  const payload = await readGitApiPayload<GitDiffPayload>(response);
  return assertGitApiOk("Git diff", response, payload);
}

async function mutateGitFile(endpoint: "/api/git-stage" | "/api/git-unstage", cwd: string, file: GitFileStatus): Promise<GitStatusPayload> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, path: file.gitPath }),
  });
  const payload = await readGitApiPayload<GitStatusPayload>(response);
  return assertGitApiOk(endpoint === "/api/git-stage" ? "Git stage" : "Git unstage", response, payload);
}

async function initGitRepo(cwd: string): Promise<GitStatusPayload> {
  const response = await fetch("/api/git-init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  const payload = await readGitApiPayload<GitStatusPayload>(response);
  return assertGitApiOk("Git init", response, payload);
}

async function commitGit(cwd: string, message: string): Promise<GitStatusPayload> {
  const response = await fetch("/api/git-commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, message }),
  });
  const payload = await readGitApiPayload<GitStatusPayload>(response);
  return assertGitApiOk("Git commit", response, payload);
}

function changedFilesForTab(status: GitStatusPayload | null, tab: "unstaged" | "staged"): readonly GitFileStatus[] {
  const files = status?.files ?? [];
  return tab === "unstaged" ? files.filter((file) => file.unstaged) : files.filter((file) => file.staged);
}

function tabLabel(label: string, count?: number): string {
  return typeof count === "number" ? `${label} ${count}` : label;
}

/** A single file's diff rendered as a collapsible card (kit DiffCard style):
 *  small diffs open by default, large ones stay collapsed, gigantic ones show
 *  an error instead of being rendered. */
function DiffFileCard({
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
  /** Increments when this card is the target of an external "open in Git" jump;
   *  each new value expands the card and scrolls it into view. */
  readonly focusSignal?: number;
  readonly t: I18nApi["t"];
}) {
  const lineCount = lines?.length ?? 0;
  const gigantic = lineCount > GIGANTIC_DIFF_LINES;
  const counts = lines ? countDiffChanges(lines) : null;
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const [stuck, setStuck] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Auto-open small diffs once their content has loaded; leave large/gigantic
  // collapsed unless the user opens them.
  useEffect(() => {
    if (touched || !lines || lineCount === 0 || lineCount > LARGE_DIFF_LINES) {
      return;
    }
    setOpen(true);
  }, [lines, lineCount, touched]);

  // External "open in Git" jump: expand this card and bring it into view.
  useEffect(() => {
    if (focusSignal <= 0) {
      return;
    }
    setTouched(true);
    setOpen(true);
    onFirstOpen?.();
    const frame = requestAnimationFrame(() => rootRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [focusSignal]);

  // While the header is pinned (its sentinel scrolled out of the panel top) it
  // drops its rounded corners so it sits flush against the panel.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef?.current;
    if (!open || !sentinel || !root || typeof IntersectionObserver === "undefined") {
      setStuck(false);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), { root });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [open, scrollRef]);

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
        onClick={() => {
          setTouched(true);
          setOpen((value) => {
            const next = !value;
            if (next) {
              onFirstOpen?.();
            }
            return next;
          });
        }}
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
            <GitDiffLines lines={lines} path={path} comments={comments} onAddComment={onAddComment} onUpdateComment={onUpdateComment} onDeleteComment={onDeleteComment} />
          ) : (
            <Typography sx={{ color: "text.secondary", fontSize: "0.8rem", px: 1.5, py: 1.25 }}>{t("gitDiffEmpty")}</Typography>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

/** A working-tree / staged file diff card that fetches its own diff. */
function GitFileDiffCard({
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
  const [lines, setLines] = useState<readonly DiffViewerLine[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestedRef = useRef(false);

  // Fetches once (eagerly for small changesets, otherwise on first expand). The
  // card is keyed by file path, so a fresh instance resets the guard naturally.
  const loadDiff = useCallback(() => {
    if (requestedRef.current) {
      return;
    }
    requestedRef.current = true;
    setLoading(true);
    setError(null);
    void fetchGitDiff(cwd, file, mode)
      .then((next) => setLines(next.diff.trim() ? gitDiffViewerLinesFromUnified(next.diff) : []))
      .catch((loadError) => setError(loadError instanceof Error && loadError.message ? loadError.message : t("gitStatusUnavailable")))
      .finally(() => setLoading(false));
  }, [cwd, file.gitPath, mode, t]);

  useEffect(() => {
    if (autoLoad) {
      loadDiff();
    }
  }, [autoLoad, loadDiff]);

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
      focusSignal={focusSignal}
      t={t}
    />
  );
}

export function GitView({ cwd, lastTurnDiffs = [], review, active = true, onUnstagedStatsChange, bottomInset = 0, focusPath, focusNonce = 0, reloadSignal = 0, worktree }: GitViewProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<GitStatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeTab, setActiveTab] = useState<GitPanelTab>("unstaged");
  const [actionLoading, setActionLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  // The focused file plus a tick so re-selecting the same path re-scrolls.
  const [focused, setFocused] = useState<{ readonly path: string; readonly tick: number }>({ path: "", tick: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cwd) {
      setStatus(null);
      setError(null);
      setLoading(false);
      return;
    }

    let alive = true;
    setLoading(true);
    setError(null);
    void fetchGitStatus(cwd)
      .then((next) => {
        if (alive) {
          setStatus(next);
        }
      })
      .catch((loadError) => {
        if (alive) {
          setStatus(null);
          setError(loadError instanceof Error && loadError.message ? loadError.message : t("gitStatusUnavailable"));
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
  }, [cwd, reloadKey, reloadSignal, t]);

  const unstagedFiles = useMemo(() => changedFilesForTab(status, "unstaged"), [status]);
  const stagedFiles = useMemo(() => changedFilesForTab(status, "staged"), [status]);
  const hasStagedFiles = stagedFiles.length > 0;

  // Handle an external "open in Git" jump: switch to the tab that holds the file
  // and remember it so the matching card expands and scrolls into view. Re-runs
  // when status arrives so a focus requested before load still lands.
  useEffect(() => {
    if (!focusNonce || !focusPath) {
      return;
    }
    if (stagedFiles.some((file) => file.gitPath === focusPath)) {
      setActiveTab("staged");
    } else if (lastTurnDiffs.some((block) => block.file === focusPath)) {
      setActiveTab("last-turn");
    } else {
      setActiveTab("unstaged");
    }
    setFocused({ path: focusPath, tick: focusNonce });
  }, [focusNonce, focusPath, unstagedFiles, stagedFiles, lastTurnDiffs]);

  const focusSignalFor = (path: string) => (focused.path === path ? focused.tick : 0);

  // Report the unstaged line totals up for the header Git-tab badge.
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
        setStatus(nextStatus);
        onDone?.();
      })
      .catch((loadError) => {
        setError(loadError instanceof Error && loadError.message ? loadError.message : t("gitStatusUnavailable"));
      })
      .finally(() => setActionLoading(false));
  };

  const stageFile = (file: GitFileStatus) => cwd && runGitAction(() => mutateGitFile("/api/git-stage", cwd, file));
  const unstageFile = (file: GitFileStatus) => cwd && runGitAction(() => mutateGitFile("/api/git-unstage", cwd, file));
  const commitStagedFiles = () => {
    const message = commitMessage.trim();
    if (cwd && message) {
      runGitAction(() => commitGit(cwd, message), () => setCommitMessage(""));
    }
  };
  const initRepo = () => cwd && runGitAction(() => initGitRepo(cwd));

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
            flex: "0 0 auto",
            borderBottom: (theme) => `1px solid ${theme.custom.borders.subtle}`,
          }}
        >
          <Box sx={{ minWidth: 0, flex: "1 1 0", display: "flex", alignItems: "center", gap: 0.75 }}>
            <AccountTreeIcon sx={{ fontSize: 16, color: "text.secondary", flexShrink: 0 }} />
            <Typography component="span" noWrap sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontWeight: 700, fontSize: "0.82rem" }}>
              {status?.branch ?? t("git")}
            </Typography>
            {status?.commitHash && (
              <Typography component="span" sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.75rem", color: "text.secondary", flexShrink: 0, whiteSpace: "nowrap" }}>
                · {status.commitHash}
              </Typography>
            )}
            {status?.commitTitle && (
              <Typography component="span" noWrap sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.75rem", color: "text.tertiary", flex: "1 1 0", minWidth: 0 }}>
                · {status.commitTitle}
              </Typography>
            )}
          </Box>
          <Tooltip title={t("refresh")}>
            <span>
              <IconButton aria-label={t("refresh")} disabled={!cwd || loading} onClick={() => setReloadKey((key) => key + 1)}>
                <RefreshIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>

        {worktree?.active && cwd && (
          <Stack
            direction="row"
            spacing={1}
            sx={{
              alignItems: "center",
              justifyContent: "space-between",
              px: 1.5,
              py: 0.75,
              flex: "0 0 auto",
              borderBottom: (theme) => `1px solid ${theme.custom.borders.subtle}`,
              backgroundColor: (theme) => (worktree.inWorktree ? theme.palette.status.running.soft : theme.custom.surfaces.s1),
            }}
          >
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", minWidth: 0 }}>
              <CallSplitIcon sx={{ fontSize: 15, flexShrink: 0, color: (theme) => (worktree.inWorktree ? theme.palette.status.running.main : theme.palette.text.secondary) }} />
              <Typography noWrap sx={{ fontSize: "0.74rem", color: "text.secondary" }}>
                {worktree.inWorktree ? t("worktreeActive") : t("worktreeIdle")}
              </Typography>
            </Stack>
            {worktree.inWorktree ? (
              <Button size="small" variant="contained" disabled={worktree.busy} onClick={worktree.onMerge} startIcon={<MergeIcon sx={{ fontSize: 15 }} />}>
                {t("worktreeMerge")}
              </Button>
            ) : (
              <Button size="small" variant="subtle" disabled={worktree.busy} onClick={worktree.onCreate} startIcon={<CallSplitIcon sx={{ fontSize: 15 }} />}>
                {t("worktreeCreate")}
              </Button>
            )}
          </Stack>
        )}

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
            <Tab value="unstaged" label={tabLabel(t("gitUnstagedTab"), unstagedFiles.length)} />
            <Tab value="staged" label={tabLabel(t("gitStagedTab"), stagedFiles.length)} />
            <Tab value="commit" label={t("gitCommitTab")} />
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
              {activeTab === "unstaged" &&
                cwd &&
                (unstagedFiles.length === 0 ? (
                  <Alert severity="info">{t("gitNoUnstagedChanges")}</Alert>
                ) : (
                  <Stack spacing={1.25}>
                    {unstagedFiles.map((file) => (
                      <GitFileDiffCard
                        key={`${file.code}-${file.gitPath}`}
                        cwd={cwd}
                        file={file}
                        mode="worktree"
                        autoLoad={active && unstagedFiles.length <= EAGER_DIFF_LIMIT}
                        scrollRef={scrollRef}
                        review={review}
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
                    {stagedFiles.map((file) => (
                      <GitFileDiffCard
                        key={`${file.code}-${file.gitPath}`}
                        cwd={cwd}
                        file={file}
                        mode="staged"
                        autoLoad={active && stagedFiles.length <= EAGER_DIFF_LIMIT}
                        scrollRef={scrollRef}
                        review={review}
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

              {activeTab === "commit" && (
                <GitCommitTab
                  actionLoading={actionLoading}
                  commitMessage={commitMessage}
                  hasStagedFiles={hasStagedFiles}
                  onCommit={commitStagedFiles}
                  onMessageChange={setCommitMessage}
                  stagedFiles={stagedFiles}
                  t={t}
                />
              )}

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
    </Stack>
  );
}

function GitCommitTab({
  actionLoading,
  commitMessage,
  hasStagedFiles,
  onCommit,
  onMessageChange,
  stagedFiles,
  t,
}: {
  readonly actionLoading: boolean;
  readonly commitMessage: string;
  readonly hasStagedFiles: boolean;
  readonly onCommit: () => void;
  readonly onMessageChange: (value: string) => void;
  readonly stagedFiles: readonly GitFileStatus[];
  readonly t: I18nApi["t"];
}) {
  return (
    <Stack spacing={1.25} sx={{ maxWidth: 560 }}>
      <Typography variant="microLabel" sx={{ color: "text.secondary" }}>
        {t("gitCommit")}
      </Typography>
      <Box
        component="textarea"
        aria-label={t("gitCommitMessage")}
        placeholder={t("gitCommitMessagePlaceholder")}
        value={commitMessage}
        onChange={(event) => onMessageChange(event.currentTarget.value)}
        rows={4}
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
      {stagedFiles.length > 0 && (
        <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", gap: 0.75 }}>
          {stagedFiles.map((file) => (
            <Chip key={file.gitPath} size="small" label={file.path} />
          ))}
        </Stack>
      )}
      <Button variant="contained" size="small" disabled={!hasStagedFiles || actionLoading || commitMessage.trim().length === 0} onClick={onCommit}>
        {t("gitCommit")}
      </Button>
    </Stack>
  );
}
