import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE } from "../src/components/agent";
import { buildInitialWorkspaceState, cloneWorkspaceState } from "../src/lib/workspace-state";

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
        reasoningAutoExpand: true,
        showTerminal: false,
        sidebarWidth: 300,
        theme: "dark",
      },
      general: {
        confirmDestructiveActions: true,
        desktopNotifications: true,
        locale: "ru",
        telemetry: false,
        previewServerHost: "",
        voice: {
          provider: "none",
          language: "ru-RU",
        },
      },
      agents: {
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

  it("normalizes persisted conversations with agents that are no longer in the active catalog", () => {
    const state = buildInitialWorkspaceState();
    const staleState = {
      ...state,
      chats: [
        {
          ...state.chats[0],
          agent: "amp",
          profile: { agent: "amp", model: "default", reasoning: "default", mode: "default" },
        },
        ...state.chats.slice(1),
      ],
    } as unknown as typeof state;

    const restored = cloneWorkspaceState(staleState);

    expect(restored.chats[0].agent).toBe(DEFAULT_PROFILE.agent);
    expect(restored.chats[0].profile).toEqual(DEFAULT_PROFILE);
  });

  it("deduplicates persisted message ids inside a thread", () => {
    const state = {
      ...buildInitialWorkspaceState(),
      threads: {
        "chat-2": [
          { id: "u-1001", role: "user", text: "first" },
          { id: "u-1001", role: "user", text: "second" },
        ],
      },
    } as unknown as ReturnType<typeof buildInitialWorkspaceState>;

    const restored = cloneWorkspaceState(state);

    expect(restored.threads["chat-2"].map((message) => message.id)).toEqual(["u-1001", "u-1001-2"]);
  });
});
