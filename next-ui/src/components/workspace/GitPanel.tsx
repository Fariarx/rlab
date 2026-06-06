import CloseIcon from "@mui/icons-material/Close";
import RefreshIcon from "@mui/icons-material/Refresh";
import { Alert, Box, Chip, CircularProgress, Drawer, Stack, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { type GitFileStatus, type GitStatusPayload } from "../../lib/git-status";
import { type I18nApi, useI18n } from "../../i18n/I18nProvider";
import { Button, IconButton } from "../ui";

interface GitPanelProps {
  readonly cwd?: string;
  readonly open: boolean;
  readonly onClose: () => void;
}

type GitApiErrorPayload = {
  readonly error?: string;
};

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

interface GitDiffPayload {
  readonly diff: string;
  readonly mode: "staged" | "worktree";
  readonly path: string;
}

async function fetchGitDiff(cwd: string, file: GitFileStatus): Promise<GitDiffPayload> {
  const mode = file.unstaged ? "worktree" : "staged";
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

export function GitPanel({ cwd, open, onClose }: GitPanelProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<GitStatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
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
      setDiff(null);
      return;
    }

    let alive = true;
    setLoading(true);
    setError(null);
    void fetchGitStatus(cwd)
      .then((next) => {
        if (alive) {
          setStatus(next);
          setSelectedPath((current) => {
            if (current && next.files.some((file) => file.gitPath === current)) {
              return current;
            }
            return null;
          });
          setDiff(null);
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
  }, [cwd, open, reloadKey, t]);

  const selectedFile = status?.files.find((file) => file.gitPath === selectedPath) ?? null;
  const hasStagedFiles = status?.files.some((file) => file.staged) ?? false;
  const canPush = Boolean(status?.upstream && status.ahead > 0);

  const selectFile = (file: GitFileStatus) => {
    if (!cwd) {
      return;
    }
    setSelectedPath(file.gitPath);
    setDiff(null);
    setDiffLoading(true);
    setError(null);
    void fetchGitDiff(cwd, file)
      .then(setDiff)
      .catch((loadError) => {
        setDiff(null);
        setError(loadError instanceof Error && loadError.message ? loadError.message : t("gitStatusUnavailable"));
      })
      .finally(() => setDiffLoading(false));
  };

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
            width: { xs: "100%", sm: 420 },
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

        <Stack spacing={2} sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 2 }}>
          {!cwd && <Alert severity="info">{t("gitNoProject")}</Alert>}
          {loading && (
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", color: "text.secondary" }}>
              <CircularProgress size={16} />
              <Typography>{t("gitLoading")}</Typography>
            </Stack>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {status && (
            <Stack spacing={2}>
              <Stack spacing={1.25}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}>
                  <Typography variant="microLabel" sx={{ color: "text.secondary" }}>
                    {t("gitBranch")}
                  </Typography>
                  <Typography sx={{ fontFamily: (theme) => theme.custom.fonts.mono }}>{status.branch}</Typography>
                </Stack>
                {status.upstream && (
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}>
                    <Typography variant="microLabel" sx={{ color: "text.secondary" }}>
                      {t("gitUpstream")}
                    </Typography>
                    <Typography sx={{ fontFamily: (theme) => theme.custom.fonts.mono, color: "text.secondary" }}>{status.upstream}</Typography>
                  </Stack>
                )}
                <Stack direction="row" spacing={0.75}>
                  {status.ahead > 0 && <Chip size="small" label={t("gitAhead", { count: status.ahead })} />}
                  {status.behind > 0 && <Chip size="small" label={t("gitBehind", { count: status.behind })} />}
                  {status.clean && <Chip size="small" color="success" label={t("gitClean")} />}
                </Stack>
                <Stack spacing={0.75}>
                  <Button variant="subtle" size="small" disabled={!canPush || actionLoading} onClick={pushAheadCommits}>
                    {t("gitPushCommits")}
                  </Button>
                  {!canPush && <Typography sx={{ fontSize: "0.72rem", color: "text.secondary" }}>{t("gitPushNoAhead")}</Typography>}
                </Stack>
              </Stack>

              <Stack spacing={1}>
                <Typography variant="microLabel" sx={{ color: "text.secondary" }}>
                  {t("gitCommit")}
                </Typography>
                <Box
                  component="textarea"
                  aria-label={t("gitCommitMessage")}
                  placeholder={t("gitCommitMessagePlaceholder")}
                  value={commitMessage}
                  onChange={(event) => setCommitMessage(event.currentTarget.value)}
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
                {!hasStagedFiles && <Alert severity="info">{t("gitCommitNoStaged")}</Alert>}
                <Button
                  variant="contained"
                  size="small"
                  disabled={!hasStagedFiles || actionLoading || commitMessage.trim().length === 0}
                  onClick={commitStagedFiles}
                >
                  {t("gitCommit")}
                </Button>
              </Stack>

              <Stack spacing={1}>
                <Typography variant="microLabel" sx={{ color: "text.secondary" }}>
                  {t("gitChanges")}
                </Typography>
                {status.files.length === 0 ? (
                  <Alert severity="success">{t("gitClean")}</Alert>
                ) : (
                  <Stack spacing={0.75}>
                    {status.files.map((file) => {
                      const selected = file.gitPath === selectedPath;
                      const label = gitFileStatusLabel(file, t);
                      return (
                      <Button
                        key={`${file.code}-${file.path}`}
                        variant="subtle"
                        aria-label={`${file.path} ${label}`}
                        onClick={() => selectFile(file)}
                        sx={{
                          width: "100%",
                          alignItems: "center",
                          justifyContent: "space-between",
                          p: 1,
                          borderRadius: (theme) => `${theme.custom.radii.md}px`,
                          borderColor: (theme) => (selected ? theme.palette.status.running.border : theme.custom.borders.subtle),
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
                )}
              </Stack>
              {selectedFile && (
                <Stack spacing={1}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}>
                    <Typography variant="microLabel" sx={{ color: "text.secondary" }}>
                      {t("gitDiff")}
                    </Typography>
                    <Stack direction="row" spacing={0.75}>
                      {selectedFile.unstaged && (
                        <Button variant="subtle" size="small" disabled={actionLoading} aria-label={t("gitStageFile", { path: selectedFile.gitPath })} onClick={() => stageFile(selectedFile)}>
                          {t("gitStage")}
                        </Button>
                      )}
                      {selectedFile.staged && (
                        <Button variant="subtle" size="small" disabled={actionLoading} aria-label={t("gitUnstageFile", { path: selectedFile.gitPath })} onClick={() => unstageFile(selectedFile)}>
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
                    <Box
                      component="pre"
                      sx={{
                        m: 0,
                        maxHeight: 360,
                        overflow: "auto",
                        p: 1.25,
                        borderRadius: (theme) => `${theme.custom.radii.md}px`,
                        border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
                        backgroundColor: (theme) => theme.custom.surfaces.s2,
                        color: "text.primary",
                        fontFamily: (theme) => theme.custom.fonts.mono,
                        fontSize: "0.72rem",
                        lineHeight: 1.55,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {diff?.diff.trim() ? diff.diff : t("gitDiffEmpty")}
                    </Box>
                  )}
                </Stack>
              )}
            </Stack>
          )}
        </Stack>
      </Stack>
    </Drawer>
  );
}
