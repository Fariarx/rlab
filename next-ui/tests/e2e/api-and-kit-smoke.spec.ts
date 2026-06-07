import { expect, test } from "@playwright/test";

const visibleAgents = ["claude-code", "codex", "gemini", "opencode"] as const;
const hiddenAgents = ["amp", "cursor", "qwen", "copilot", "droid"] as const;

function keys(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value).sort();
}

test("production server exposes health, visible agents, and the kit route", async ({ page, request }) => {
  const healthResponse = await request.get("/api/health");
  expect(healthResponse.ok()).toBe(true);
  await expect(healthResponse).toBeOK();
  const health = (await healthResponse.json()) as { readonly agents?: { readonly visible?: readonly string[] } };
  expect(health.agents?.visible).toEqual([...visibleAgents]);

  const agentsResponse = await request.get("/api/agents");
  await expect(agentsResponse).toBeOK();
  const agents = await agentsResponse.json();
  expect(keys(agents)).toEqual([...visibleAgents].sort());
  for (const agent of hiddenAgents) {
    expect(keys(agents)).not.toContain(agent);
  }

  await page.goto("/#/kit");
  await expect(page.getByText("rlab/ui-kit")).toBeVisible();
  await expect(page.getByText("библиотека компонентов")).toBeVisible();
});
