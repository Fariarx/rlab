import AccountTreeIcon from "@mui/icons-material/AccountTree";
import AddIcon from "@mui/icons-material/Add";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import DescriptionIcon from "@mui/icons-material/Description";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import MergeIcon from "@mui/icons-material/Merge";
import RefreshIcon from "@mui/icons-material/Refresh";
import RemoveIcon from "@mui/icons-material/Remove";
import { Alert, Box, Chip, CircularProgress, Collapse, Divider, Popover, Stack, Tab, Tabs, TextField, type Theme, Tooltip, Typography } from "@mui/material";
import { CommitGraph, type Branch, type Commit, type CommitNode, type GraphStyle } from "commit-graph";
import { type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type I18nApi, useI18n } from "../../i18n/I18nProvider";
import type { GitFileStatus, GitStatusPayload } from "../../lib/git-status";
import type { DiffBlock, ReviewCommentEntry } from "../agent";
import { Button, EmptyState, IconButton } from "../ui";
import {
  branchOptionsFor,
  checkoutGitBranch,
  commitGit,
  fetchGitDiff,
  fetchGitStatus,
  fetchGitTree,
  initGitRepo,
  mutateGitFile,
  type GitDiffMode,
  type GitGraphBranchHead,
  type GitGraphCommit,
  type GitTreePayload,
} from "./git-panel-api";
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

type GitPanelTab = "tree" | "unstaged" | "staged" | "commit" | "last-turn";

// A diff longer than this stays collapsed until the user opens it; one longer
// than the hard cap is never rendered (an error is shown instead).
const LARGE_DIFF_LINES = 240;
const GIGANTIC_DIFF_LINES = 2000;
// With few changed files we load every diff up-front (so small ones open
// automatically); with many, diffs load lazily on expand to avoid a request flood.
const EAGER_DIFF_LIMIT = 25;

function GitRefPicker({
  branches,
  commits,
  disabled,
  dirty,
  loading,
  onClose,
  onOpen,
  onSelect,
  t,
  currentBranch,
  currentHash,
  currentTitle,
}: {
  readonly branches: readonly string[];
  readonly commits: readonly GitGraphCommit[];
  readonly disabled: boolean;
  readonly dirty: boolean;
  readonly loading: boolean;
  readonly onClose: () => void;
  readonly onOpen: () => void;
  readonly onSelect: (ref: string) => void;
  readonly t: I18nApi["t"];
  readonly currentBranch: string;
  readonly currentHash?: string;
  readonly currentTitle?: string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const open = Boolean(anchor);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredBranches = useMemo(
    () => branches.filter((branch) => normalizedQuery.length === 0 || branch.toLowerCase().includes(normalizedQuery)),
    [branches, normalizedQuery],
  );
  const filteredCommits = useMemo(
    () =>
      commits
        .filter((commit) => normalizedQuery.length === 0 || commit.shortHash.toLowerCase().includes(normalizedQuery) || commit.hash.toLowerCase().includes(normalizedQuery) || commit.subject.toLowerCase().includes(normalizedQuery))
        .slice(0, 80),
    [commits, normalizedQuery],
  );
  const blocked = dirty || disabled;
  const close = () => {
    setAnchor(null);
    onClose();
  };
  const selectRef = (ref: string) => {
    if (blocked) {
      return;
    }
    close();
    onSelect(ref);
  };

  return (
    <>
      <Tooltip title={dirty ? t("gitSwitchBranchDirty") : t("gitRefPickerOpen")}>
        <Box
          component="button"
          type="button"
          aria-label={t("gitSwitchBranch")}
          disabled={disabled}
          onClick={(event) => {
            if (disabled) {
              return;
            }
            setAnchor(event.currentTarget);
            onOpen();
          }}
          sx={{
            appearance: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 0.4,
            maxWidth: { xs: "100%", sm: 300 },
            minHeight: 24,
            px: 0,
            border: 0,
            borderRadius: 0,
            backgroundColor: "transparent",
            color: open ? "status.running.main" : "text.secondary",
            cursor: disabled ? "default" : "pointer",
            font: "inherit",
            minWidth: 0,
            "&:hover": disabled
              ? undefined
              : {
                  color: "text.primary",
                  textDecoration: "underline",
                  textUnderlineOffset: "3px",
                },
            "&:disabled": {
              opacity: 0.65,
            },
          }}
        >
          <Typography component="span" noWrap sx={{ minWidth: 0, fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.82rem", fontWeight: 800 }}>
            {currentBranch}
          </Typography>
          <KeyboardArrowDownIcon sx={{ fontSize: 16, color: "currentColor", flex: "0 0 auto", transform: open ? "rotate(180deg)" : "none", transition: "transform 160ms ease" }} />
        </Box>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        sx={{ zIndex: (theme) => theme.zIndex.modal + 20 }}
        slotProps={{
          paper: {
            sx: {
              position: "relative",
              zIndex: (theme) => theme.zIndex.modal + 21,
              mt: 0.75,
              width: 420,
              maxWidth: "calc(100vw - 24px)",
              border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
              borderRadius: (theme) => `${theme.custom.radii.lg}px`,
              backgroundColor: (theme) => theme.custom.surfaces.s2,
              backgroundImage: "none",
              opacity: 1,
              boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
              overflow: "hidden",
            },
          },
        }}
      >
        <Stack spacing={1} sx={{ p: 1, backgroundColor: (theme) => theme.custom.surfaces.s2 }}>
          <Stack spacing={0.25} sx={{ px: 0.5, pt: 0.25 }}>
            <Typography sx={{ fontSize: "0.76rem", fontWeight: 800, color: "text.primary" }}>{t("gitRefPickerTitle")}</Typography>
            <Typography noWrap sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.68rem", color: "text.secondary" }}>
              {currentHash ? `${currentHash} · ${currentTitle || "-"}` : currentTitle || "-"}
            </Typography>
          </Stack>
          <TextField
            autoFocus
            size="small"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("gitRefPickerSearch")}
            slotProps={{
              htmlInput: { "aria-label": t("gitRefPickerSearch") },
            }}
            sx={{
              "& .MuiInputBase-root": {
                minHeight: 34,
                borderRadius: (theme) => `${theme.custom.radii.md}px`,
                backgroundColor: (theme) => theme.custom.surfaces.s1,
              },
              "& .MuiInputBase-input": {
                fontFamily: (theme) => theme.custom.fonts.mono,
                fontSize: "0.76rem",
              },
            }}
          />
          {dirty && <Alert severity="warning">{t("gitSwitchBranchDirty")}</Alert>}
          <Stack spacing={0.5}>
            <Typography sx={{ px: 0.5, fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.66rem", fontWeight: 900, letterSpacing: "0.12em", color: "text.tertiary", textTransform: "uppercase" }}>
              {t("gitRefPickerBranches")}
            </Typography>
            <Stack sx={{ maxHeight: 132, overflow: "auto", borderRadius: (theme) => `${theme.custom.radii.md}px` }}>
              {filteredBranches.length === 0 ? (
                <Typography sx={{ px: 1, py: 0.8, color: "text.secondary", fontSize: "0.78rem" }}>{t("gitNoBranches")}</Typography>
              ) : (
                filteredBranches.map((branch) => (
                  <GitRefPickerRow key={branch} disabled={blocked || branch === currentBranch} active={branch === currentBranch} label={branch} meta={branch === currentBranch ? t("gitRefCurrent") : t("gitBranch")} onClick={() => selectRef(branch)} />
                ))
              )}
            </Stack>
          </Stack>
          <Divider sx={{ borderColor: (theme) => theme.custom.borders.subtle }} />
          <Stack spacing={0.5}>
            <Typography sx={{ px: 0.5, fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.66rem", fontWeight: 900, letterSpacing: "0.12em", color: "text.tertiary", textTransform: "uppercase" }}>
              {t("gitRefPickerCommits")}
            </Typography>
            <Stack sx={{ maxHeight: 260, overflow: "auto", borderRadius: (theme) => `${theme.custom.radii.md}px` }}>
              {loading ? (
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", px: 1, py: 1, color: "text.secondary" }}>
                  <CircularProgress size={14} />
                  <Typography sx={{ fontSize: "0.78rem" }}>{t("gitTreeLoading")}</Typography>
                </Stack>
              ) : filteredCommits.length === 0 ? (
                <Typography sx={{ px: 1, py: 0.8, color: "text.secondary", fontSize: "0.78rem" }}>{t("gitTreeEmpty")}</Typography>
              ) : (
                filteredCommits.map((commit) => (
                  <GitRefPickerRow
                    key={commit.hash}
                    disabled={blocked || commit.shortHash === currentHash || commit.hash === currentHash}
                    active={commit.shortHash === currentHash || commit.hash === currentHash}
                    label={commit.subject || "-"}
                    meta={`${commit.shortHash} · ${commit.author} · ${commit.date}`}
                    onClick={() => selectRef(commit.hash)}
                  />
                ))
              )}
            </Stack>
          </Stack>
        </Stack>
      </Popover>
    </>
  );
}

function GitRefPickerRow({
  active,
  disabled,
  label,
  meta,
  onClick,
}: {
  readonly active: boolean;
  readonly disabled: boolean;
  readonly label: string;
  readonly meta: string;
  readonly onClick: () => void;
}) {
  return (
    <Box
      component="button"
      type="button"
      disabled={disabled}
      onClick={onClick}
      sx={{
        appearance: "none",
        width: "100%",
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1,
        py: 0.75,
        border: 0,
        borderRadius: (theme) => `${theme.custom.radii.sm}px`,
        backgroundColor: (theme) => (active ? theme.palette.status.running.soft : "transparent"),
        color: "inherit",
        textAlign: "left",
        cursor: disabled ? "default" : "pointer",
        "&:hover": disabled
          ? undefined
          : {
              backgroundColor: (theme) => theme.custom.surfaces.s3,
            },
        "&:disabled": {
          opacity: active ? 1 : 0.52,
        },
      }}
    >
      <Box sx={{ width: 7, height: 7, borderRadius: 99, backgroundColor: (theme) => (active ? theme.palette.status.running.main : theme.palette.text.secondary), flex: "0 0 auto" }} />
      <Stack sx={{ minWidth: 0 }}>
        <Typography noWrap sx={{ fontSize: "0.78rem", fontWeight: 750, color: "text.primary" }}>
          {label}
        </Typography>
        <Typography noWrap sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.66rem", color: "text.secondary" }}>
          {meta}
        </Typography>
      </Stack>
    </Box>
  );
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
  const [statusVersion, setStatusVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [graphCommits, setGraphCommits] = useState<readonly GitGraphCommit[]>([]);
  const [graphBranchHeads, setGraphBranchHeads] = useState<readonly GitGraphBranchHead[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeTab, setActiveTab] = useState<GitPanelTab>("unstaged");
  const [refPickerOpen, setRefPickerOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  // The focused file plus a tick so re-selecting the same path re-scrolls.
  const [focused, setFocused] = useState<{ readonly path: string; readonly tick: number }>({ path: "", tick: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const applyStatus = useCallback((nextStatus: GitStatusPayload) => {
    setStatus(nextStatus);
    setStatusVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    setStatus(null);
    setStatusVersion((version) => version + 1);
    setError(null);
    setGraphCommits([]);
    setTreeError(null);
    setTreeLoading(false);
    setRefPickerOpen(false);
    setActiveTab("unstaged");
    setFocused({ path: "", tick: 0 });
  }, [cwd]);

  useEffect(() => {
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
  }, [applyStatus, cwd, reloadKey, reloadSignal, t]);

  useEffect(() => {
    if (!cwd || !status || (activeTab !== "tree" && !refPickerOpen)) {
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
          setTreeError(loadError instanceof Error && loadError.message ? loadError.message : t("gitTreeUnavailable"));
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
  }, [activeTab, cwd, refPickerOpen, status, statusVersion, t]);

  const unstagedFiles = useMemo(() => changedFilesForTab(status, "unstaged"), [status]);
  const stagedFiles = useMemo(() => changedFilesForTab(status, "staged"), [status]);
  const hasStagedFiles = stagedFiles.length > 0;
  const branchOptions = useMemo(() => (status ? branchOptionsFor(status) : []), [status]);

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
        applyStatus(nextStatus);
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
  const checkoutRef = (ref: string) => cwd && ref !== status?.branch && runGitAction(() => checkoutGitBranch(cwd, ref));
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
          </Box>
          <Tooltip title={t("refresh")}>
            <span>
              <IconButton aria-label={t("refresh")} disabled={!cwd || loading} onClick={() => setReloadKey((key) => key + 1)}>
                <RefreshIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </span>
          </Tooltip>
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
              {activeTab === "tree" && <GitTreeTab commits={graphCommits} branchHeads={graphBranchHeads} currentBranch={status.branch} currentHash={status.commitHash} error={treeError} loading={treeLoading} t={t} />}

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
                        key={`${cwd}:${statusVersion}:staged:${file.code}:${file.gitPath}`}
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

const GIT_GRAPH_COLORS = ["#F59E0B", "#60A5FA", "#F87171", "#A78BFA", "#34D399", "#FBBF24", "#22D3EE", "#FB7185", "#C084FC", "#2DD4BF"];

const GIT_GRAPH_STYLE: GraphStyle = {
  commitSpacing: 40,
  branchSpacing: 10,
  branchColors: GIT_GRAPH_COLORS,
  nodeRadius: 3,
};

function gitGraphRefName(ref: string): string | null {
  const trimmed = ref.trim();
  if (!trimmed || trimmed === "HEAD") {
    return null;
  }
  const arrowIndex = trimmed.indexOf(" -> ");
  if (arrowIndex >= 0) {
    const target = trimmed.slice(arrowIndex + 4).trim();
    return target.length > 0 ? target : null;
  }
  return trimmed;
}

function gitGraphBranchHeadsFromCommits(commits: readonly GitGraphCommit[]): readonly GitGraphBranchHead[] {
  const branchHeads = new Map<string, string>();
  for (const commit of commits) {
    for (const ref of commit.refs) {
      const name = gitGraphRefName(ref);
      if (name && !branchHeads.has(name)) {
        branchHeads.set(name, commit.hash);
      }
    }
  }
  return Array.from(branchHeads, ([name, hash]) => ({ name, hash }));
}

function gitGraphCommitToLibraryCommit(commit: GitGraphCommit): Commit {
  return {
    sha: commit.hash,
    commit: {
      author: {
        name: commit.author,
        date: commit.date,
      },
      message: commit.subject || "-",
    },
    parents: commit.parents.map((parent) => ({ sha: parent })),
  };
}

function gitGraphBranchHeadToLibraryBranch(head: GitGraphBranchHead): Branch {
  return {
    name: head.name,
    commit: { sha: head.hash },
  };
}

function GitGraphRefChip({ active, label }: { readonly active: boolean; readonly label: string }) {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 20,
        maxWidth: 190,
        px: 0.75,
        borderRadius: (theme) => `${theme.custom.radii.sm}px`,
        border: (theme) => `1px solid ${active ? theme.palette.status.running.border : theme.custom.borders.strong}`,
        backgroundColor: (theme) => (active ? theme.palette.status.running.soft : theme.custom.surfaces.s3),
        color: "text.primary",
        fontFamily: (theme) => theme.custom.fonts.mono,
        fontSize: "0.67rem",
        fontWeight: 750,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {label}
    </Box>
  );
}

function gitGraphDateLabel(value: string | number | Date): string {
  if (typeof value === "string") {
    return value;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
}

function GitTreeTab({
  commits,
  branchHeads,
  currentBranch,
  currentHash,
  error,
  loading,
  t,
}: {
  readonly commits: readonly GitGraphCommit[];
  readonly branchHeads: readonly GitGraphBranchHead[];
  readonly currentBranch: string;
  readonly currentHash?: string;
  readonly error: string | null;
  readonly loading: boolean;
  readonly t: I18nApi["t"];
}) {
  const graphCommits = useMemo<Commit[]>(() => commits.map(gitGraphCommitToLibraryCommit), [commits]);
  const graphBranches = useMemo<Branch[]>(() => branchHeads.map(gitGraphBranchHeadToLibraryBranch), [branchHeads]);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const selectedCommit = selectedHash ? commits.find((commit) => commit.hash === selectedHash) ?? null : null;
  const activeHash = currentHash ? commits.find((commit) => commit.shortHash === currentHash || commit.hash.startsWith(currentHash))?.hash ?? currentHash : null;
  const activeCommit = activeHash ? commits.find((commit) => commit.hash === activeHash) ?? null : null;
  const visibleCommit = selectedCommit ?? activeCommit;
  const handleCommitClick = useCallback((commit: CommitNode) => setSelectedHash(commit.hash), []);

  return (
    <Stack spacing={1.25} sx={{ minHeight: 0, flex: "0 0 auto" }}>
      {loading && (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", color: "text.secondary" }}>
          <CircularProgress size={16} />
          <Typography>{t("gitTreeLoading")}</Typography>
        </Stack>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {!loading && !error && commits.length === 0 && <Alert severity="info">{t("gitTreeEmpty")}</Alert>}
      {commits.length > 0 && (
        <Stack spacing={1.25} sx={{ minHeight: 0, flex: "0 0 auto" }}>
          <Box
            data-testid="git-commit-graph"
            sx={{
              flex: "0 0 auto",
              minHeight: 0,
              overflowX: "auto",
              overflowY: "visible",
              pt: 1,
              pb: 1.5,
              color: "text.primary",
              scrollbarWidth: "thin",
              "& [class*='index-module_container__mhEMW']": {
                minWidth: { xs: "680px", md: "820px" },
                paddingTop: "6px",
                fontFamily: (theme) => theme.custom.fonts.sans,
              },
              "& [class*='index-module_commitInfoContainer']": {
                left: { xs: "170px !important", md: "210px !important" },
                right: 0,
                width: { xs: "calc(100% - 170px) !important", md: "calc(100% - 210px) !important" },
                minWidth: { xs: "470px", md: "560px" },
                paddingTop: "6px",
              },
              "& [class*='index-module_details']": {
                minHeight: 36,
                height: 36,
                px: 1,
                borderRadius: (theme) => `${theme.custom.radii.sm}px`,
                borderBottom: (theme) => `1px solid ${theme.custom.borders.subtle}`,
                color: "text.primary",
                fontFamily: (theme) => theme.custom.fonts.sans,
                transform: "translateY(14px)",
              },
              "& [class*='index-module_details'] + [class*='index-module_details']": {
                marginTop: 0,
              },
              "& [class*='index-module_details']:hover": {
                backgroundColor: (theme) => theme.custom.surfaces.s2,
              },
              "& [class*='index-module_block']": {
                height: 36,
                borderRadius: (theme) => `${theme.custom.radii.sm}px`,
                transform: "translateY(14px)",
              },
              "& [class*='index-module_hovered']": {
                backgroundColor: (theme) => theme.custom.surfaces.s3,
                opacity: 1,
              },
              "& [class*='index-module_clicked']": {
                backgroundColor: (theme) => theme.palette.status.running.soft,
                opacity: 1,
              },
              "& [class*='index-module_svg']": {
                maxWidth: { xs: 170, md: 210 },
                overflow: "hidden",
                position: "relative",
                zIndex: 0,
                flex: "0 0 auto",
              },
              "& [class*='index-module_container__wEBx3']": {
                width: "100%",
                maxWidth: "none",
                fontFamily: (theme) => theme.custom.fonts.sans,
                fontSize: { xs: "0.72rem", md: "0.76rem" },
                color: "text.primary",
              },
              "& [class*='index-module_labelAndLink']": {
                gap: 1.25,
                justifyContent: "flex-start",
              },
              "& [class*='index-module_msg']": {
                color: "text.primary",
                fontSize: { xs: "0.76rem", md: "0.8rem" },
                lineHeight: 1.25,
                marginTop: "1px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              },
              "& [class*='index-module_bold']": {
                color: "text.secondary",
                fontFamily: (theme) => theme.custom.fonts.mono,
                fontSize: { xs: "0.66rem", md: "0.7rem" },
              },
              "& [class*='index-module_outer'], & [class*='index-module_number']": {
                height: 20,
                lineHeight: "18px",
                px: 0.75,
                borderRadius: (theme) => `${theme.custom.radii.sm}px`,
                backgroundColor: (theme) => theme.custom.surfaces.s3,
                fontFamily: (theme) => theme.custom.fonts.mono,
                fontSize: "0.67rem",
              },
              "& [class*='index-module_dropdown']": {
                backgroundColor: (theme) => theme.custom.surfaces.s2,
                border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
                p: 0.5,
              },
              "& [class*='index-module_dropdownItem']": {
                backgroundColor: "transparent",
              },
            }}
          >
            <CommitGraph
              commits={graphCommits}
              branchHeads={graphBranches}
              currentBranch={currentBranch}
              graphStyle={GIT_GRAPH_STYLE}
              dateFormatFn={gitGraphDateLabel}
              fullSha={false}
              onCommitClick={handleCommitClick}
            />
          </Box>
          {visibleCommit && <GitCommitSummaryRow commit={visibleCommit} currentBranch={currentBranch} />}
        </Stack>
      )}
    </Stack>
  );
}

function GitCommitSummaryRow({ commit, currentBranch }: { readonly commit: GitGraphCommit; readonly currentBranch: string }) {
  return (
    <Box
      data-testid="git-current-commit-summary"
      sx={{
        flex: "0 0 auto",
        px: 1,
        py: 0.85,
        borderRadius: (theme) => `${theme.custom.radii.md}px`,
        border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
        backgroundColor: (theme) => theme.custom.surfaces.s2,
        display: "flex",
        alignItems: "center",
        gap: 1,
        minWidth: 0,
      }}
    >
      <Typography component="span" sx={{ flex: "0 0 auto", fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.72rem", fontWeight: 800, color: "text.secondary" }}>
        {commit.shortHash}
      </Typography>
      {commit.refs.map((ref) => {
        const label = gitGraphRefName(ref);
        return label ? <GitGraphRefChip key={ref} label={label} active={label === currentBranch} /> : null;
      })}
      <Typography noWrap sx={{ minWidth: 0, flex: 1, fontSize: "0.82rem", color: "text.primary" }}>
        {commit.subject || "-"}
      </Typography>
      <Typography component="span" sx={{ display: { xs: "none", md: "inline" }, flex: "0 0 auto", fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.68rem", color: "text.tertiary" }}>
        {commit.author} · {commit.date}
      </Typography>
    </Box>
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
