import { describe, expect, it } from "vitest";
import config from "../vite.config";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function chunkGroupNames(): readonly string[] {
  const output = config.build?.rolldownOptions?.output;
  if (!isRecord(output) || !isRecord(output.codeSplitting) || !Array.isArray(output.codeSplitting.groups)) {
    return [];
  }
  return output.codeSplitting.groups
    .map((group) => (isRecord(group) && typeof group.name === "string" ? group.name : ""))
    .filter(Boolean);
}

describe("vite build config", () => {
  it("splits large vendor families into targeted production chunks", () => {
    expect(chunkGroupNames()).toEqual(
      expect.arrayContaining([
        "react-vendor",
        "kit-route",
        "mui-icons-vendor",
        "mui-material-vendor",
        "emotion-vendor",
        "state-vendor",
        "vendor",
      ]),
    );
  });
});
