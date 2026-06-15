import { Alert, Box, CircularProgress, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import type { GitGraphBranchHead, GitGraphCommit } from "../../../client/api/git-panel-api";
import type { I18nApi } from "../../../i18n/I18nProvider";
import { GitCommitGraph } from "./GitCommitGraph";
import type { GitCommitAction } from "./git-panel-model";
import { GitTreeTabStore } from "./git-panel-store";

export const GitTreeTab = observer(function GitTreeTab({
  commits,
  currentBranch,
  branches = [],
  currentHash,
  error,
  loading,
  onCheckoutBranch,
  onCommitAction,
  actionsDisabled = false,
  canCheckout = false,
  t,
}: {
  readonly commits: readonly GitGraphCommit[];
  readonly branchHeads: readonly GitGraphBranchHead[];
  readonly currentBranch: string;
  readonly branches?: readonly string[];
  readonly currentHash?: string;
  readonly error: string | null;
  readonly loading: boolean;
  readonly onCheckoutBranch?: (branch: string) => void;
  readonly onCommitAction?: (action: GitCommitAction, hash: string) => void;
  readonly actionsDisabled?: boolean;
  readonly canCheckout?: boolean;
  readonly t: I18nApi["t"];
}) {
  const [store] = useState(() => new GitTreeTabStore());
  const { selectedHash, setSelectedHash } = store;
  const selectedCommit = selectedHash ? commits.find((commit) => commit.hash === selectedHash) ?? null : null;
  const activeHash = currentHash ? commits.find((commit) => commit.shortHash === currentHash || commit.hash.startsWith(currentHash))?.hash ?? currentHash : null;
  const activeCommit = activeHash ? commits.find((commit) => commit.hash === activeHash) ?? null : null;
  const visibleCommit = selectedCommit ?? activeCommit;

  return (
    <Stack spacing={1.25} sx={{ minHeight: 0, flex: "0 0 auto" }}>
      {loading && commits.length === 0 && (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", color: "text.secondary" }}>
          <CircularProgress size={16} />
          <Typography>{t("gitTreeLoading")}</Typography>
        </Stack>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {!loading && !error && commits.length === 0 && <Alert severity="info">{t("gitTreeEmpty")}</Alert>}
      {commits.length > 0 && (
        <Stack spacing={1.25} sx={{ minHeight: 0, flex: "0 0 auto" }}>
          <Box data-testid="git-commit-graph" sx={{ flex: "0 0 auto", minWidth: 0, pt: 0.5, pb: 0.5, color: "text.primary" }}>
            <GitCommitGraph
              commits={commits}
              currentBranch={currentBranch}
              branches={branches}
              selectedHash={selectedHash}
              activeHash={activeHash}
              onSelectCommit={setSelectedHash}
              onCheckoutBranch={(branch) => onCheckoutBranch?.(branch)}
              onCommitAction={(action, hash) => onCommitAction?.(action, hash)}
              canCheckout={canCheckout && Boolean(onCheckoutBranch)}
              actionsDisabled={actionsDisabled}
              t={t}
            />
          </Box>
          {visibleCommit && <GitCommitSummaryRow commit={visibleCommit} />}
        </Stack>
      )}
    </Stack>
  );
});

function GitCommitSummaryRow({ commit }: { readonly commit: GitGraphCommit }) {
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
      <Typography noWrap sx={{ minWidth: 0, flex: 1, fontSize: "0.82rem", color: "text.primary" }}>
        {commit.subject || "-"}
      </Typography>
      <Typography component="span" sx={{ display: { xs: "none", md: "inline" }, flex: "0 0 auto", fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.68rem", color: "text.tertiary" }}>
        {commit.author} · {commit.date}
      </Typography>
    </Box>
  );
}
