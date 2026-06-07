import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

interface PackageJson {
  readonly scripts?: Record<string, string>;
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as PackageJson;
}

describe("package scripts", () => {
  it("exposes production preview, E2E, and real agent smoke commands", () => {
    const scripts = readPackageJson().scripts ?? {};

    expect(scripts.preview).toBe("cross-env NODE_ENV=production vite preview --host 0.0.0.0");
    expect(scripts.serve).toBe("cross-env NODE_ENV=production vite preview --host 0.0.0.0");
    expect(scripts["smoke:agents"]).toBe("node scripts/agent-smoke.mjs");
    expect(scripts["test:e2e"]).toBe("playwright test");
  });

  it("documents the supported live CLI smoke agents without Claude Code", () => {
    const script = join(process.cwd(), "scripts", "agent-smoke.mjs");

    expect(existsSync(script)).toBe(true);

    const result = spawnSync(process.execPath, [script, "--help"], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Default agents: codex,gemini,opencode");
    expect(result.stdout).not.toContain("claude-code");
  });

  it("keeps production browser smoke tests scoped away from Vitest unit tests", () => {
    const config = join(process.cwd(), "playwright.config.ts");
    const spec = join(process.cwd(), "tests", "e2e", "web-ui-smoke.spec.ts");

    expect(existsSync(config)).toBe(true);
    expect(existsSync(spec)).toBe(true);
    expect(readFileSync(config, "utf8")).toContain('testDir: "./tests/e2e"');
    expect(readFileSync(spec, "utf8")).toContain('["claude-code", "codex", "gemini", "opencode"]');
    expect(readFileSync(join(process.cwd(), "vitest.config.ts"), "utf8")).toContain("tests/e2e");
  });
});
