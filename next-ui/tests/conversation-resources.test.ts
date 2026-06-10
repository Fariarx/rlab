import { describe, expect, it } from "vitest";
import { type ChatMessage } from "../src/components/agent/types";
import { collectResources } from "../src/lib/conversation-resources";
import { normalizeExternalUrl } from "../src/lib/external-url";

describe("normalizeExternalUrl", () => {
  it("keeps absolute http(s) urls", () => {
    expect(normalizeExternalUrl("https://vitest.dev/api")).toBe("https://vitest.dev/api");
    expect(normalizeExternalUrl("http://example.com")).toBe("http://example.com");
  });

  it("upgrades bare domains and protocol-relative urls to https", () => {
    expect(normalizeExternalUrl("vitest.dev/api/vi#x")).toBe("https://vitest.dev/api/vi#x");
    expect(normalizeExternalUrl("//cdn.example.com/x.js")).toBe("https://cdn.example.com/x.js");
  });

  it("returns null for non-web targets", () => {
    expect(normalizeExternalUrl("src/index.ts")).toBeNull();
    expect(normalizeExternalUrl("")).toBeNull();
    expect(normalizeExternalUrl("#anchor")).toBeNull();
  });
});

describe("collectResources", () => {
  it("extracts files, links, and images from a thread in first-seen order", () => {
    const messages: readonly ChatMessage[] = [
      { id: "u1", role: "user", time: "10:00", text: 'See <attachment name="notes.txt"></attachment> and https://example.com/a' },
      {
        id: "a1",
        role: "agent",
        time: "10:01",
        blocks: [
          { kind: "text", text: "Docs at [Vitest](https://vitest.dev) and a chart ![chart](https://cdn.example.com/chart.png)." },
          { kind: "diff", file: "src/login.ts", additions: 1, deletions: 0, lines: [] },
          { kind: "tool", name: "read_file", state: "ok", args: { path: "src/util.ts" } },
          { kind: "search", query: "q", state: "ok", results: [{ title: "MDN", url: "developer.mozilla.org/en-US/docs" }] },
        ],
      },
    ];

    const resources = collectResources(messages);
    const kinds = resources.map((resource) => `${resource.kind}:${resource.url}`);

    expect(kinds).toContain("file:notes.txt");
    expect(kinds).toContain("link:https://example.com/a");
    expect(kinds).toContain("link:https://vitest.dev");
    expect(kinds).toContain("image:https://cdn.example.com/chart.png");
    expect(kinds).toContain("link:developer.mozilla.org/en-US/docs");
    expect(kinds).not.toContain("file:src/login.ts");
    expect(kinds).not.toContain("file:src/util.ts");

    // Resources lists direct mentions and uploads, not files merely touched by
    // tool/diff blocks.
    const fileUrls = resources.filter((resource) => resource.kind === "file").map((resource) => resource.url);
    expect(fileUrls).toEqual(["notes.txt"]);
  });

  it("deduplicates repeated references and ignores command/code bodies", () => {
    const messages: readonly ChatMessage[] = [
      {
        id: "a1",
        role: "agent",
        blocks: [
          { kind: "command", command: "npm test https://should-not-leak.example", state: "ok" },
          { kind: "code", language: "ts", code: "const url = 'https://also-not.example';" },
          { kind: "text", text: "Link https://example.com once." },
          { kind: "text", text: "Link https://example.com again." },
        ],
      },
    ];

    const resources = collectResources(messages);
    expect(resources.filter((resource) => resource.url === "https://example.com")).toHaveLength(1);
    // Command and code bodies are not scraped for resources.
    expect(resources.some((resource) => resource.url.includes("should-not-leak"))).toBe(false);
    expect(resources.some((resource) => resource.url.includes("also-not"))).toBe(false);
  });
});
