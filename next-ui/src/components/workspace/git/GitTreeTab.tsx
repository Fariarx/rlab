import { Alert, Box, CircularProgress, Stack, Typography } from "@mui/material";
import { CommitGraph, type Branch, type Commit, type CommitNode } from "commit-graph";
import { observer } from "mobx-react-lite";
import { useCallback, useMemo, useState } from "react";
import type { GitGraphBranchHead, GitGraphCommit } from "../../../client/api/git-panel-api";
import type { I18nApi } from "../../../i18n/I18nProvider";
import { GitTreeTabStore } from "./git-panel-store";
import { GIT_GRAPH_STYLE, gitGraphBranchHeadToLibraryBranch, gitGraphCommitToLibraryCommit, gitGraphDateLabel, gitGraphRefName } from "./git-panel-model";

export const GitTreeTab = observer(function GitTreeTab({
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
  const [store] = useState(() => new GitTreeTabStore());
  const { selectedHash, setSelectedHash } = store;
  const selectedCommit = selectedHash ? commits.find((commit) => commit.hash === selectedHash) ?? null : null;
  const activeHash = currentHash ? commits.find((commit) => commit.shortHash === currentHash || commit.hash.startsWith(currentHash))?.hash ?? currentHash : null;
  const activeCommit = activeHash ? commits.find((commit) => commit.hash === activeHash) ?? null : null;
  const visibleCommit = selectedCommit ?? activeCommit;
  const handleCommitClick = useCallback((commit: CommitNode) => setSelectedHash(commit.hash), [setSelectedHash]);

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
});

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
