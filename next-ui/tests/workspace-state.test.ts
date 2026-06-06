import { describe, expect, it } from "vitest";
import { buildInitialWorkspaceState } from "../src/components/workspace/workspace-state";

describe("workspace state", () => {
  it("includes serializable seeded threads in the persisted workspace snapshot", () => {
    const state = buildInitialWorkspaceState();
    const restored = JSON.parse(JSON.stringify(state)) as ReturnType<typeof buildInitialWorkspaceState>;

    expect(restored.threads["chat-2"]).toEqual(state.threads["chat-2"]);
    expect(restored.threads["c-flaky"].some((message) => message.blocks?.some((block) => block.kind === "suggested"))).toBe(true);
    expect(JSON.stringify(restored)).toContain("\"icon\":\"arrow-forward\"");
  });

  it("includes serializable application settings in the persisted workspace snapshot", () => {
    const state = buildInitialWorkspaceState();
    const restored = JSON.parse(JSON.stringify(state)) as ReturnType<typeof buildInitialWorkspaceState>;

    expect(restored.settings).toEqual({
      appearance: {
        density: "comfortable",
        reduceMotion: false,
        sidebarWidth: 300,
        theme: "dark",
      },
      general: {
        confirmDestructiveActions: true,
        desktopNotifications: true,
        locale: "ru",
        telemetry: false,
      },
      agents: {
        accessMode: "read-only",
        defaultProfile: {
          agent: "claude-code",
          model: "default",
          reasoning: "default",
          mode: "default",
        },
      },
    });
  });

  it("keeps composer drafts serializable outside browser storage", () => {
    const state = {
      ...buildInitialWorkspaceState(),
      composerDrafts: {
        "chat-2": {
          text: "Черновик",
          attachments: [
            {
              id: "notes",
              name: "notes.txt",
              type: "text/plain",
              content: "hello",
              size: 5,
              lastModified: 1,
            },
          ],
        },
      },
    };
    const restored = JSON.parse(JSON.stringify(state)) as typeof state;

    expect(restored.composerDrafts["chat-2"]).toEqual(state.composerDrafts["chat-2"]);
  });
});
