import type { GitGraphCommit } from "../../../client/api/git-panel-api";

/** Lane colours, cycled by column index. Mirrors the previous graph palette. */
export const GIT_GRAPH_LANE_COLORS = [
  "#F59E0B",
  "#60A5FA",
  "#F87171",
  "#A78BFA",
  "#34D399",
  "#FBBF24",
  "#22D3EE",
  "#FB7185",
  "#C084FC",
  "#2DD4BF",
] as const;

export function gitGraphLaneColor(lane: number): string {
  const length = GIT_GRAPH_LANE_COLORS.length;
  return GIT_GRAPH_LANE_COLORS[((lane % length) + length) % length];
}

export interface GitGraphLaneLine {
  readonly lane: number;
  readonly color: string;
}

export interface GitGraphRowLayout {
  readonly commit: GitGraphCommit;
  /** Column index of this commit's node. */
  readonly lane: number;
  readonly color: string;
  /** Lanes passing straight through this row (full-height vertical lines). */
  readonly through: readonly GitGraphLaneLine[];
  /** Lanes feeding into this commit from the row above (top → node). */
  readonly merges: readonly GitGraphLaneLine[];
  /** Parent lanes leaving this commit toward the row below (node → bottom). */
  readonly parents: readonly GitGraphLaneLine[];
  /** Whether history continues straight into this node from the row above (so a
   *  top → node segment must be drawn to avoid a gap above the node). */
  readonly hasIncoming: boolean;
}

export interface GitGraphLayout {
  readonly rows: readonly GitGraphRowLayout[];
  /** Max number of simultaneously active lanes (for sizing the graph column). */
  readonly laneCount: number;
}

/**
 * Assigns each commit a lane and computes the edge segments needed to draw a
 * `git log --graph`-style DAG. Commits are expected in child-before-parent order
 * (as produced by `git log --all`). Lane indices are stable: a freed lane stays
 * empty until reused by a new branch tip, so "through" lanes are simple verticals
 * and only branch/merge points produce diagonals.
 */
export function buildGitGraphLayout(commits: readonly GitGraphCommit[]): GitGraphLayout {
  const lanes: (string | null)[] = [];
  const rows: GitGraphRowLayout[] = [];
  let laneCount = 0;

  const firstFreeLane = (): number => {
    const free = lanes.indexOf(null);
    return free >= 0 ? free : lanes.length;
  };
  const setLane = (lane: number, value: string | null): void => {
    while (lanes.length <= lane) {
      lanes.push(null);
    }
    lanes[lane] = value;
  };

  for (const commit of commits) {
    const before = [...lanes];
    const targets: number[] = [];
    before.forEach((hash, lane) => {
      if (hash === commit.hash) {
        targets.push(lane);
      }
    });
    const nodeLane = targets.length > 0 ? Math.min(...targets) : firstFreeLane();
    for (const lane of targets) {
      lanes[lane] = null;
    }

    const parentLines: GitGraphLaneLine[] = [];
    if (commit.parents.length > 0) {
      setLane(nodeLane, commit.parents[0]);
      parentLines.push({ lane: nodeLane, color: gitGraphLaneColor(nodeLane) });
      for (let index = 1; index < commit.parents.length; index += 1) {
        const parentLane = firstFreeLane();
        setLane(parentLane, commit.parents[index]);
        parentLines.push({ lane: parentLane, color: gitGraphLaneColor(parentLane) });
      }
    } else {
      setLane(nodeLane, null);
    }

    const through: GitGraphLaneLine[] = [];
    const merges: GitGraphLaneLine[] = [];
    before.forEach((hash, lane) => {
      if (hash === null) {
        return;
      }
      if (hash === commit.hash) {
        if (lane !== nodeLane) {
          merges.push({ lane, color: gitGraphLaneColor(lane) });
        }
      } else {
        through.push({ lane, color: gitGraphLaneColor(lane) });
      }
    });

    laneCount = Math.max(laneCount, before.length, lanes.length, nodeLane + 1);
    rows.push({ commit, lane: nodeLane, color: gitGraphLaneColor(nodeLane), through, merges, parents: parentLines, hasIncoming: targets.length > 0 });
  }

  return { rows, laneCount: Math.max(1, laneCount) };
}
