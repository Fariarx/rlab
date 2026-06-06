import CloseIcon from "@mui/icons-material/Close";
import RefreshIcon from "@mui/icons-material/Refresh";
import { Alert, Box, Chip, CircularProgress, Drawer, Stack, Tab, Tabs, Typography } from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { type I18nApi, useI18n } from "../../i18n/I18nProvider";
import { type GitFileStatus, type GitStatusPayload } from "../../lib/git-status";
import { type DiffBlock } from "../agent";
import { Button, IconButton } from "../ui";
import { GitDiffViewer, gitDiffViewerLinesFromBlock, gitDiffViewerLinesFromUnified } from "./GitDiffViewer";

interface GitPanelProps {
  readonly cwd?: string;
  readonly lastTurnDiffs?: readonly DiffBlock[];
  readonly open: boolean;
  readonly onClose: () => void;
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

async function commitGit(cwd: string, message: string): Promise<GitStatusPayload> {
  const response = await fetch("/api/git-commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, message }),
  });
  const payload = await readGitApiPayload<GitStatusPayload>(response);
  return assertGitApiOk("Git commit", response, payload);
}

async function pushGit(cwd: string): Promise<GitStatusPayload> {
  const response = await fetch("/api/git-push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  const payload = await readGitApiPayload<GitStatusPayload>(response);
  return assertGitApiOk("Git push", response, payload);
}

function gitFileStatusLabel(file: GitFileStatus, t: I18nApi["t"]): string {
  if (file.code === "??") {
    return t("gitFileUntracked");
  }
  if (file.code.includes("U")) {
    return t("gitFileConflict");
  }
  if (file.code.includes("R")) {
    return t("gitFileRenamed");
  }
  if (file.code.includes("C")) {
    return t("gitFileCopied");
  }
  if (file.code.includes("A")) {
    return t("gitFileAdded");
  }
  if (file.code.includes("D")) {
    return t("gitFileDeleted");
  }
  if (file.code.includes("M")) {
    return t("gitFileModified");
  }
  return t("gitFileChanged");
}

function fileTabMode(tab: GitPanelTab): GitDiffMode | null {
  if (tab === "unstaged") {
    return "worktree";
  }
  if (tab === "staged") {
    return "staged";
  }
  return null;
}

function changedFilesForTab(status: GitStatusPayload | null, tab: GitPanelTab): readonly GitFileStatus[] {
  if (!status) {
    return [];
  }
  if (tab === "unstaged") {
    return status.files.filter((file) => file.unstaged);
  }
  if (tab === "staged") {
    return status.files.filter((file) => file.staged);
  }
  return [];
}

function tabLabel(label: string, count?: number): string {
  return typeof count === "number" ? `${label} ${count}` : label;
}

export function GitPanel({ cwd, lastTurnDiffs = [], open, onClose }: GitPanelProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<GitStatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeTab, setActiveTab] = useState<GitPanelTab>("unstaged");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedLastTurnFile, setSelectedLastTurnFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<GitDiffPayload | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");

  useEffect(() => {
    if (!open || !cwd) {
      setStatus(null);
      setError(null);
      setLoading(false);
      setSelectedPath(null);
      setSelectedLastTurnFile(null);
      setDiff(null);
      return;
    }

    let alive = true;
    setLoading(true);
    setError(null);
    void fetchGitStatus(cwd)
      .then((next) => {
        if (!alive) {
          return;
        }
        setStatus(next);
        setSelectedPath((current) => {
          if (current && next.files.some((file) => file.gitPath === current)) {
            return current;
          }
          return null;
        });
        setDiff(null);
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
  }, [cwd, open, reloadKey, t]);

  const unstagedFiles = useMemo(() => changedFilesForTab(status, "unstaged"), [status]);
  const stagedFiles = useMemo(() => changedFilesForTab(status, "staged"), [status]);
  const activeGitFiles = activeTab === "staged" ? stagedFiles : activeTab === "unstaged" ? unstagedFiles : [];
  const selectedFile = activeGitFiles.find((file) => file.gitPath === selectedPath) ?? null;
  const selectedLastTurnDiff = lastTurnDiffs.find((block) => block.file === selectedLastTurnFile) ?? null;
  const hasStagedFiles = stagedFiles.length > 0;
  const canPush = Boolean(status?.upstream && status.ahead > 0);

  useEffect(() => {
    if (activeTab !== "unstaged" && activeTab !== "staged") {
      return;
    }
    setSelectedPath((current) => {
      if (current && activeGitFiles.some((file) => file.gitPath === current)) {
        return current;
      }
      return activeGitFiles[0]?.gitPath ?? null;
    });
  }, [activeGitFiles, activeTab]);

  useEffect(() => {
    setSelectedLastTurnFile((current) => {
      if (current && lastTurnDiffs.some((block) => block.file === current)) {
        return current;
      }
      return lastTurnDiffs[0]?.file ?? null;
    });
  }, [lastTurnDiffs]);

  useEffect(() => {
    const mode = fileTabMode(activeTab);
    if (!open || !cwd || !selectedFile || !mode) {
      setDiff(null);
      setDiffLoading(false);
      return;
    }

    let alive = true;
    setDiff(null);
    setDiffLoading(true);
    setError(null);
    void fetchGitDiff(cwd, selectedFile, mode)
      .then((next) => {
        if (alive) {
          setDiff(next);
        }
      })
      .catch((loadError) => {
        if (alive) {
          setDiff(null);
          setError(loadError instanceof Error && loadError.message ? loadError.message : t("gitStatusUnavailable"));
        }
      })
      .finally(() => {
        if (alive) {
          setDiffLoading(false);
        }
      });

    return () => {
      alive = false;
    };
  }, [activeTab, cwd, open, selectedFile, t]);

  const stageFile = (file: GitFileStatus) => {
    if (!cwd) {
      return;
    }
    setActionLoading(true);
    setError(null);
    void mutateGitFile("/api/git-stage", cwd, file)
      .then((nextStatus) => {
        setStatus(nextStatus);
        setSelectedPath(null);
        setDiff(null);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error && loadError.message ? loadError.message : t("gitStatusUnavailable"));
      })
      .finally(() => setActionLoading(false));
  };

  const unstageFile = (file: GitFileStatus) => {
    if (!cwd) {
      return;
    }
    setActionLoading(true);
    setError(null);
    void mutateGitFile("/api/git-unstage", cwd, file)
      .then((nextStatus) => {
        setStatus(nextStatus);
        setSelectedPath(null);
        setDiff(null);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error && loadError.message ? loadError.message : t("gitStatusUnavailable"));
      })
      .finally(() => setActionLoading(false));
  };

  const commitStagedFiles = () => {
    if (!cwd) {
      return;
    }
    const message = commitMessage.trim();
    if (!message) {
      return;
    }
    setActionLoading(true);
    setError(null);
    void commitGit(cwd, message)
      .then((nextStatus) => {
        setStatus(nextStatus);
        setSelectedPath(null);
        setDiff(null);
        setCommitMessage("");
      })
      .catch((loadError) => {
        setError(loadError instanceof Error && loadError.message ? loadError.message : t("gitStatusUnavailable"));
      })
      .finally(() => setActionLoading(false));
  };

  const pushAheadCommits = () => {
    if (!cwd || !canPush) {
      return;
    }
    setActionLoading(true);
    setError(null);
    void pushGit(cwd)
      .then((nextStatus) => {
        setStatus(nextStatus);
        setSelectedPath(null);
        setDiff(null);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error && loadError.message ? loadError.message : t("gitStatusUnavailable"));
      })
      .finally(() => setActionLoading(false));
  };

  const titleId = "git-panel-title";

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      aria-labelledby={titleId}
      slotProps={{
        paper: {
          sx: {
            width: { xs: "100%", sm: 720, lg: 900 },
            backgroundImage: "none",
            backgroundColor: (theme) => theme.custom.surfaces.s1,
          },
        },
      }}
    >
      <Stack sx={{ height: "100%", minHeight: 0 }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{
            alignItems: "center",
            justifyContent: "space-between",
            px: 2,
            py: 1.5,
            borderBottom: (theme) => `1px solid ${theme.custom.borders.subtle}`,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography id={titleId} component="h2" variant="h6" sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.95rem" }}>
              {t("git")}
            </Typography>
            {cwd && (
              <Typography noWrap sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.68rem", color: "text.secondary" }}>
                {cwd}
              </Typography>
            )}
          </Box>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
            <Button variant="subtle" size="small" startIcon={<RefreshIcon sx={{ fontSize: 15 }} />} disabled={!cwd || loading} onClick={() => setReloadKey((key) => key + 1)}>
              {t("refresh")}
            </Button>
            <IconButton aria-label={t("cancel")} onClick={onClose}>
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Stack>
        </Stack>

        <Stack spacing={1.5} sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 2 }}>
          {!cwd && <Alert severity="info">{t("gitNoProject")}</Alert>}
          {loading && (
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", color: "text.secondary" }}>
              <CircularProgress size={16} />
              <Typography>{t("gitLoading")}</Typography>
            </Stack>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {status && (
            <Stack spacing={1.5} sx={{ minHeight: 0 }}>
              <GitStatusSummary status={status} canPush={canPush} actionLoading={actionLoading} onPush={pushAheadCommits} t={t} />

              <Tabs value={activeTab} onChange={(_, value: GitPanelTab) => setActiveTab(value)} aria-label={t("gitStatus")}>
                <Tab value="unstaged" label={tabLabel(t("gitUnstagedTab"), unstagedFiles.length)} />
                <Tab value="staged" label={tabLabel(t("gitStagedTab"), stagedFiles.length)} />
                <Tab value="commit" label={t("gitCommitTab")} />
                <Tab value="last-turn" label={tabLabel(t("gitLastTurnTab"), lastTurnDiffs.length)} />
              </Tabs>

              {activeTab === "unstaged" && (
                <GitFileChangesTab
                  actionLoading={actionLoading}
                  diff={diff}
                  diffLoading={diffLoading}
                  emptyText={t("gitNoUnstagedChanges")}
                  files={unstagedFiles}
                  mode="worktree"
                  onSelect={(file) => setSelectedPath(file.gitPath)}
                  onStage={stageFile}
                  selectedFile={selectedFile}
                  selectedPath={selectedPath}
                  t={t}
                />
              )}

              {activeTab === "staged" && (
                <GitFileChangesTab
                  actionLoading={actionLoading}
                  diff={diff}
                  diffLoading={diffLoading}
                  emptyText={t("gitNoStagedChanges")}
                  files={stagedFiles}
                  mode="staged"
                  onSelect={(file) => setSelectedPath(file.gitPath)}
                  onUnstage={unstageFile}
                  selectedFile={selectedFile}
                  selectedPath={selectedPath}
                  t={t}
                />
              )}

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

              {activeTab === "last-turn" && (
                <LastTurnChangesTab
                  diffs={lastTurnDiffs}
                  emptyText={t("gitNoLastTurnChanges")}
                  onSelect={(block) => setSelectedLastTurnFile(block.file)}
                  selectedDiff={selectedLastTurnDiff}
                  selectedFile={selectedLastTurnFile}
                />
              )}
            </Stack>
          )}
        </Stack>
      </Stack>
    </Drawer>
  );
}

function GitStatusSummary({
  actionLoading,
  canPush,
  onPush,
  status,
  t,
}: {
  readonly actionLoading: boolean;
  readonly canPush: boolean;
  readonly onPush: () => void;
  readonly status: GitStatusPayload;
  readonly t: I18nApi["t"];
}) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={1}
      sx={{
        alignItems: { xs: "stretch", sm: "center" },
        justifyContent: "space-between",
        p: 1.25,
        border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
        borderRadius: (theme) => `${theme.custom.radii.md}px`,
        backgroundColor: (theme) => theme.custom.surfaces.s2,
      }}
    >
      <Stack spacing={0.5} sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
          <Typography variant="microLabel" sx={{ color: "text.secondary" }}>
            {t("gitBranch")}
          </Typography>
          <Typography noWrap sx={{ fontFamily: (theme) => theme.custom.fonts.mono }}>
            {status.branch}
          </Typography>
        </Stack>
        {status.upstream && (
          <Typography noWrap sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.72rem", color: "text.secondary" }}>
            {t("gitUpstream")}: {status.upstream}
          </Typography>
        )}
      </Stack>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexWrap: "wrap", justifyContent: { xs: "flex-start", sm: "flex-end" } }}>
        {status.ahead > 0 && <Chip size="small" label={t("gitAhead", { count: status.ahead })} />}
        {status.behind > 0 && <Chip size="small" label={t("gitBehind", { count: status.behind })} />}
        {status.clean && <Chip size="small" color="success" label={t("gitClean")} />}
        <Button variant="subtle" size="small" disabled={!canPush || actionLoading} onClick={onPush}>
          {t("gitPushCommits")}
        </Button>
      </Stack>
    </Stack>
  );
}

function GitFileChangesTab({
  actionLoading,
  diff,
  diffLoading,
  emptyText,
  files,
  mode,
  onSelect,
  onStage,
  onUnstage,
  selectedFile,
  selectedPath,
  t,
}: {
  readonly actionLoading: boolean;
  readonly diff: GitDiffPayload | null;
  readonly diffLoading: boolean;
  readonly emptyText: string;
  readonly files: readonly GitFileStatus[];
  readonly mode: GitDiffMode;
  readonly onSelect: (file: GitFileStatus) => void;
  readonly onStage?: (file: GitFileStatus) => void;
  readonly onUnstage?: (file: GitFileStatus) => void;
  readonly selectedFile: GitFileStatus | null;
  readonly selectedPath: string | null;
  readonly t: I18nApi["t"];
}) {
  if (files.length === 0) {
    return <Alert severity="info">{emptyText}</Alert>;
  }

  const diffLines = diff?.diff.trim() ? gitDiffViewerLinesFromUnified(diff.diff) : [];

  return (
    <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} sx={{ minHeight: 0 }}>
      <FileList files={files} onSelect={onSelect} selectedPath={selectedPath} t={t} />
      <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
        {selectedFile ? (
          <>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between", minWidth: 0 }}>
              <Typography noWrap sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.8rem" }}>
                {selectedFile.gitPath}
              </Typography>
              <Stack direction="row" spacing={0.75}>
                {mode === "worktree" && onStage && (
                  <Button variant="subtle" size="small" disabled={actionLoading} aria-label={t("gitStageFile", { path: selectedFile.gitPath })} onClick={() => onStage(selectedFile)}>
                    {t("gitStage")}
                  </Button>
                )}
                {mode === "staged" && onUnstage && (
                  <Button variant="subtle" size="small" disabled={actionLoading} aria-label={t("gitUnstageFile", { path: selectedFile.gitPath })} onClick={() => onUnstage(selectedFile)}>
                    {t("gitUnstage")}
                  </Button>
                )}
              </Stack>
            </Stack>
            {diffLoading ? (
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", color: "text.secondary" }}>
                <CircularProgress size={16} />
                <Typography>{t("gitLoading")}</Typography>
              </Stack>
            ) : (
              <GitDiffViewer emptyText={t("gitDiffEmpty")} lines={diffLines} />
            )}
          </>
        ) : (
          <Alert severity="info">{t("gitSelectChangedFile")}</Alert>
        )}
      </Stack>
    </Stack>
  );
}

function FileList({
  files,
  onSelect,
  selectedPath,
  t,
}: {
  readonly files: readonly GitFileStatus[];
  readonly onSelect: (file: GitFileStatus) => void;
  readonly selectedPath: string | null;
  readonly t: I18nApi["t"];
}) {
  return (
    <Stack spacing={0.75} sx={{ width: { xs: "100%", md: 280 }, flex: "0 0 auto" }}>
      {files.map((file) => {
        const selected = file.gitPath === selectedPath;
        const label = gitFileStatusLabel(file, t);
        return (
          <Button
            key={`${file.code}-${file.gitPath}`}
            variant="subtle"
            aria-label={`${file.path} ${label}`}
            onClick={() => onSelect(file)}
            sx={{
              width: "100%",
              alignItems: "center",
              justifyContent: "space-between",
              p: 1,
              borderRadius: (theme) => `${theme.custom.radii.md}px`,
              borderColor: (theme) => (selected ? theme.palette.status.running.border : theme.custom.borders.subtle),
              gap: 1,
            }}
          >
            <Typography noWrap sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.78rem" }}>
              {file.path}
            </Typography>
            <Chip size="small" label={label} />
          </Button>
        );
      })}
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
        <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap" }}>
          {stagedFiles.map((file) => (
            <Chip key={file.gitPath} size="small" label={file.path} />
          ))}
        </Stack>
      )}
      {!hasStagedFiles && <Alert severity="info">{t("gitCommitNoStaged")}</Alert>}
      <Button variant="contained" size="small" disabled={!hasStagedFiles || actionLoading || commitMessage.trim().length === 0} onClick={onCommit}>
        {t("gitCommit")}
      </Button>
    </Stack>
  );
}

function LastTurnChangesTab({
  diffs,
  emptyText,
  onSelect,
  selectedDiff,
  selectedFile,
}: {
  readonly diffs: readonly DiffBlock[];
  readonly emptyText: string;
  readonly onSelect: (block: DiffBlock) => void;
  readonly selectedDiff: DiffBlock | null;
  readonly selectedFile: string | null;
}) {
  if (diffs.length === 0) {
    return <Alert severity="info">{emptyText}</Alert>;
  }

  return (
    <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} sx={{ minHeight: 0 }}>
      <Stack spacing={0.75} sx={{ width: { xs: "100%", md: 280 }, flex: "0 0 auto" }}>
        {diffs.map((block) => {
          const selected = block.file === selectedFile;
          return (
            <Button
              key={block.file}
              variant="subtle"
              aria-label={block.file}
              onClick={() => onSelect(block)}
              sx={{
                width: "100%",
                alignItems: "center",
                justifyContent: "space-between",
                p: 1,
                borderRadius: (theme) => `${theme.custom.radii.md}px`,
                borderColor: (theme) => (selected ? theme.palette.status.running.border : theme.custom.borders.subtle),
                gap: 1,
              }}
            >
              <Typography noWrap sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.78rem" }}>
                {block.file}
              </Typography>
              <Stack direction="row" spacing={0.5}>
                <Chip size="small" color="success" label={`+${block.additions}`} />
                <Chip size="small" color="error" label={`-${block.deletions}`} />
              </Stack>
            </Button>
          );
        })}
      </Stack>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <GitDiffViewer emptyText={emptyText} lines={selectedDiff ? gitDiffViewerLinesFromBlock(selectedDiff) : []} />
      </Box>
    </Stack>
  );
}
