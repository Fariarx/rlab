import CallSplitRoundedIcon from "@mui/icons-material/CallSplitRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";
import UndoRoundedIcon from "@mui/icons-material/UndoRounded";
import { Box, Divider, ListItemIcon, Menu, MenuItem, Stack, Typography } from "@mui/material";
import { type ReactNode, useMemo, useState } from "react";
import type { GitGraphCommit } from "../../../client/api/git-panel-api";
import type { I18nApi } from "../../../i18n/I18nProvider";
import { buildGitGraphLayout } from "./git-commit-graph-model";
import type { GitCommitAction } from "./use-git-view-controller";

const ROW_HEIGHT = 30;
const NODE_RADIUS = 3.5;
const LANE_WIDTH_MAX = 18;
const LANE_WIDTH_MIN = 12;
const GRAPH_PADDING = 9;
const GRAPH_COLUMN_MAX = 156;

interface GitRef {
  readonly raw: string;
  readonly name: string;
  readonly kind: "current" | "branch" | "remote" | "tag";
}

function classifyRef(raw: string, localBranches: ReadonlySet<string>): GitRef | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "HEAD") {
    return null;
  }
  if (trimmed.startsWith("tag:")) {
    const name = trimmed.slice(4).trim();
    return name ? { raw, name, kind: "tag" } : null;
  }
  if (trimmed.startsWith("HEAD -> ")) {
    const name = trimmed.slice(8).trim();
    return name ? { raw, name, kind: "current" } : null;
  }
  return { raw, name: trimmed, kind: localBranches.has(trimmed) ? "branch" : "remote" };
}

function RefChip({ gitRef }: { readonly gitRef: GitRef }) {
  const accent = gitRef.kind === "current";
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        maxWidth: 150,
        height: 19,
        px: 0.75,
        flex: "0 0 auto",
        borderRadius: (theme) => `${theme.custom.radii.sm}px`,
        border: (theme) => `1px solid ${accent ? theme.palette.status.running.border : theme.custom.borders.strong}`,
        backgroundColor: (theme) => (accent ? theme.palette.status.running.soft : theme.custom.surfaces.s3),
        color: (theme) => (accent ? theme.palette.status.running.main : gitRef.kind === "tag" ? theme.palette.status.warn.main : "text.primary"),
        fontFamily: (theme) => theme.custom.fonts.mono,
        fontSize: "0.66rem",
        fontWeight: 750,
        lineHeight: 1,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {gitRef.name}
    </Box>
  );
}

interface BranchMenuState {
  readonly anchor: HTMLElement;
  readonly commit: GitGraphCommit;
  readonly branches: readonly string[];
}

export function GitCommitGraph({
  commits,
  currentBranch,
  branches,
  selectedHash,
  activeHash,
  onSelectCommit,
  onCheckoutBranch,
  onCommitAction,
  canCheckout,
  actionsDisabled = false,
  t,
}: {
  readonly commits: readonly GitGraphCommit[];
  readonly currentBranch: string;
  readonly branches: readonly string[];
  readonly selectedHash: string | null;
  readonly activeHash: string | null;
  readonly onSelectCommit: (hash: string) => void;
  readonly onCheckoutBranch: (branch: string) => void;
  readonly onCommitAction?: (action: GitCommitAction, hash: string) => void;
  readonly canCheckout: boolean;
  readonly actionsDisabled?: boolean;
  readonly t: I18nApi["t"];
}) {
  const layout = useMemo(() => buildGitGraphLayout(commits), [commits]);
  const localBranches = useMemo(() => new Set(branches), [branches]);
  const [menu, setMenu] = useState<BranchMenuState | null>(null);
  const laneWidth = layout.laneCount <= 1 ? LANE_WIDTH_MAX : Math.max(LANE_WIDTH_MIN, Math.min(LANE_WIDTH_MAX, Math.floor((GRAPH_COLUMN_MAX - GRAPH_PADDING * 2) / layout.laneCount)));
  const graphWidth = GRAPH_PADDING * 2 + layout.laneCount * laneWidth;
  const totalHeight = layout.rows.length * ROW_HEIGHT;
  const laneX = (lane: number) => GRAPH_PADDING + lane * laneWidth + laneWidth / 2;

  const closeMenu = () => setMenu(null);
  const runAction = (action: GitCommitAction) => {
    if (menu) {
      onCommitAction?.(action, menu.commit.hash);
    }
    closeMenu();
  };
  const handleRowClick = (commit: GitGraphCommit, branchNames: readonly string[], element: HTMLElement) => {
    onSelectCommit(commit.hash);
    setMenu({ anchor: element, commit, branches: branchNames });
  };

  return (
    <Box sx={{ position: "relative", minHeight: 0 }}>
      <Box
        component="svg"
        width={graphWidth}
        height={totalHeight}
        viewBox={`0 0 ${graphWidth} ${totalHeight}`}
        sx={{ position: "absolute", top: 0, left: 0, pointerEvents: "none", zIndex: 2, overflow: "visible" }}
        aria-hidden="true"
      >
        {layout.rows.map((row, index) => {
          const y0 = index * ROW_HEIGHT;
          const cy = y0 + ROW_HEIGHT / 2;
          const nodeX = laneX(row.lane);
          const segments: ReactNode[] = [];
          for (const line of row.through) {
            const x = laneX(line.lane);
            segments.push(<line key={`t-${row.commit.hash}-${line.lane}`} x1={x} y1={y0} x2={x} y2={y0 + ROW_HEIGHT} stroke={line.color} strokeWidth={2} />);
          }
          if (row.hasIncoming) {
            segments.push(<line key={`in-${row.commit.hash}`} x1={nodeX} y1={y0} x2={nodeX} y2={cy} stroke={row.color} strokeWidth={2} />);
          }
          for (const line of row.merges) {
            const x = laneX(line.lane);
            const midY = (y0 + cy) / 2;
            segments.push(<path key={`m-${row.commit.hash}-${line.lane}`} d={`M ${x} ${y0} C ${x} ${midY} ${nodeX} ${midY} ${nodeX} ${cy}`} fill="none" stroke={line.color} strokeWidth={2} />);
          }
          for (const line of row.parents) {
            const x = laneX(line.lane);
            const midY = (cy + y0 + ROW_HEIGHT) / 2;
            segments.push(
              x === nodeX ? (
                <line key={`p-${row.commit.hash}-${line.lane}`} x1={nodeX} y1={cy} x2={nodeX} y2={y0 + ROW_HEIGHT} stroke={line.color} strokeWidth={2} />
              ) : (
                <path key={`p-${row.commit.hash}-${line.lane}`} d={`M ${nodeX} ${cy} C ${nodeX} ${midY} ${x} ${midY} ${x} ${y0 + ROW_HEIGHT}`} fill="none" stroke={line.color} strokeWidth={2} />
              ),
            );
          }
          const isActive = row.commit.hash === activeHash;
          return (
            <g key={`g-${row.commit.hash}`}>
              {segments}
              <Box
                component="circle"
                cx={nodeX}
                cy={cy}
                r={isActive ? NODE_RADIUS + 1.5 : NODE_RADIUS}
                sx={{ fill: (theme) => theme.custom.surfaces.s1, stroke: row.color, strokeWidth: isActive ? 3 : 2.5 }}
              />
            </g>
          );
        })}
      </Box>
      <Stack sx={{ position: "relative", zIndex: 1 }}>
        {layout.rows.map((row) => {
          const commit = row.commit;
          const selected = commit.hash === selectedHash;
          const refs = commit.refs.map((ref) => classifyRef(ref, localBranches)).filter((value): value is GitRef => value !== null);
          const switchableBranches = refs.filter((ref) => (ref.kind === "branch" || ref.kind === "current") && ref.name !== currentBranch).map((ref) => ref.name);
          return (
            <Box
              key={commit.hash}
              component="button"
              type="button"
              data-testid="git-commit-row"
              onClick={(event) => handleRowClick(commit, canCheckout ? switchableBranches : [], event.currentTarget)}
              sx={{
                height: ROW_HEIGHT,
                width: "100%",
                pl: `${graphWidth + 4}px`,
                pr: 1,
                display: "flex",
                alignItems: "center",
                gap: 1,
                minWidth: 0,
                textAlign: "left",
                border: 0,
                borderRadius: (theme) => `${theme.custom.radii.sm}px`,
                cursor: "pointer",
                backgroundColor: (theme) => (selected ? theme.palette.status.running.soft : "transparent"),
                transition: "background-color 120ms ease",
                "&:hover": { backgroundColor: (theme) => (selected ? theme.palette.status.running.soft : theme.custom.surfaces.s2) },
              }}
            >
              {refs.map((gitRef) => (
                <RefChip key={gitRef.raw} gitRef={gitRef} />
              ))}
              <Typography noWrap sx={{ minWidth: 0, flex: 1, fontSize: "0.8rem", color: "text.primary" }}>
                {commit.subject || "-"}
              </Typography>
              <Typography component="span" sx={{ flex: "0 0 auto", fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.68rem", fontWeight: 700, color: "text.secondary" }}>
                {commit.shortHash}
              </Typography>
              <Typography component="span" sx={{ display: { xs: "none", md: "inline" }, flex: "0 0 auto", fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.66rem", color: "text.secondary", opacity: 0.75, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {commit.author} · {commit.date}
              </Typography>
            </Box>
          );
        })}
      </Stack>
      <Menu
        anchorEl={menu?.anchor ?? null}
        open={menu !== null}
        onClose={closeMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{ paper: { sx: { minWidth: 232 } } }}
      >
        <Box sx={{ px: 1.5, py: 0.5 }}>
          <Typography noWrap sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.72rem", fontWeight: 700, color: "text.secondary" }}>
            {menu?.commit.shortHash}
          </Typography>
        </Box>
        <Divider />
        {(menu?.branches ?? []).map((branch) => (
          <MenuItem
            key={branch}
            onClick={() => {
              onCheckoutBranch(branch);
              closeMenu();
            }}
            sx={{ gap: 0, fontSize: "0.8rem" }}
          >
            <ListItemIcon sx={{ minWidth: 30 }}>
              <CallSplitRoundedIcon sx={{ fontSize: 16, color: "text.secondary" }} />
            </ListItemIcon>
            {t("gitSwitchToBranch", { branch })}
          </MenuItem>
        ))}
        {(menu?.branches.length ?? 0) > 0 && <Divider />}
        <MenuItem disabled={actionsDisabled} onClick={() => runAction("cherry-pick")} sx={{ gap: 0, fontSize: "0.8rem" }}>
          <ListItemIcon sx={{ minWidth: 30 }}>
            <ContentCopyRoundedIcon sx={{ fontSize: 16, color: "text.secondary" }} />
          </ListItemIcon>
          {t("gitCherryPick")}
        </MenuItem>
        <MenuItem disabled={actionsDisabled} onClick={() => runAction("revert")} sx={{ gap: 0, fontSize: "0.8rem" }}>
          <ListItemIcon sx={{ minWidth: 30 }}>
            <UndoRoundedIcon sx={{ fontSize: 16, color: "text.secondary" }} />
          </ListItemIcon>
          {t("gitRevert")}
        </MenuItem>
        <Divider />
        <MenuItem disabled={actionsDisabled} onClick={() => runAction("reset-soft")} sx={{ gap: 0, fontSize: "0.8rem" }}>
          <ListItemIcon sx={{ minWidth: 30 }}>
            <RestartAltRoundedIcon sx={{ fontSize: 16, color: "text.secondary" }} />
          </ListItemIcon>
          {t("gitResetSoft")}
        </MenuItem>
        <MenuItem disabled={actionsDisabled} onClick={() => runAction("reset-mixed")} sx={{ gap: 0, fontSize: "0.8rem" }}>
          <ListItemIcon sx={{ minWidth: 30 }}>
            <RestartAltRoundedIcon sx={{ fontSize: 16, color: "text.secondary" }} />
          </ListItemIcon>
          {t("gitResetMixed")}
        </MenuItem>
        <MenuItem disabled={actionsDisabled} onClick={() => runAction("reset-hard")} sx={{ gap: 0, fontSize: "0.8rem", color: (theme) => theme.palette.status.error.main }}>
          <ListItemIcon sx={{ minWidth: 30 }}>
            <RestartAltRoundedIcon sx={{ fontSize: 16, color: (theme) => theme.palette.status.error.main }} />
          </ListItemIcon>
          {t("gitResetHard")}
        </MenuItem>
      </Menu>
    </Box>
  );
}
