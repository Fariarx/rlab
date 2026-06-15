import { describe, expect, it } from "vitest";
import type { GitGraphCommit } from "../src/client/api/git-panel-api";
import { buildGitGraphLayout } from "../src/components/workspace/git/git-commit-graph-model";

function commit(hash: string, parents: readonly string[]): GitGraphCommit {
  return { graph: "", hash, shortHash: hash, parents, author: "a", date: "d", refs: [], subject: hash };
}

const lanes = (lines: readonly { readonly lane: number }[]) => lines.map((line) => line.lane);

describe("buildGitGraphLayout", () => {
  it("keeps a linear history in a single lane", () => {
    const layout = buildGitGraphLayout([commit("A", ["B"]), commit("B", ["C"]), commit("C", [])]);
    expect(layout.laneCount).toBe(1);
    expect(layout.rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(layout.rows[2].parents).toEqual([]);
  });

  it("lays out a branch + merge across two lanes", () => {
    const layout = buildGitGraphLayout([commit("M", ["A", "B"]), commit("A", ["C"]), commit("B", ["C"]), commit("C", [])]);
    expect(layout.laneCount).toBe(2);

    // Merge commit M opens a second lane for its second parent.
    expect(layout.rows[0].lane).toBe(0);
    expect(lanes(layout.rows[0].parents)).toEqual([0, 1]);

    // A stays in lane 0 while B's lane passes straight through.
    expect(layout.rows[1].lane).toBe(0);
    expect(lanes(layout.rows[1].through)).toEqual([1]);

    // B sits in lane 1 while lane 0 passes through.
    expect(layout.rows[2].lane).toBe(1);
    expect(lanes(layout.rows[2].through)).toEqual([0]);

    // The shared ancestor C collapses lane 1 back into lane 0.
    expect(layout.rows[3].lane).toBe(0);
    expect(lanes(layout.rows[3].merges)).toEqual([1]);
    expect(layout.rows[3].parents).toEqual([]);
  });
});
