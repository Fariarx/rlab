import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentProfile, ConversationSummary, Project } from "../src/components/agent";
import type { HashRoute } from "../src/lib/use-hash-route";
import { useWorkspaceRouteSync } from "../src/components/workspace/hooks/use-workspace-route-sync";

const defaultProfile: AgentProfile = { agent: "codex", model: "gpt-5-codex", reasoning: "default", mode: "default" };

function conversation(id: string, profile: AgentProfile = defaultProfile): ConversationSummary {
  return {
    id,
    title: id,
    snippet: "",
    time: "",
    status: "idle",
    agent: profile.agent,
    profile,
  };
}

function Harness({
  route,
  chats,
  projects = [],
  selectedId = "",
  findConversation,
  selectConversation,
  setProfile,
  onNavigate,
}: {
  readonly route: HashRoute | undefined;
  readonly chats: readonly ConversationSummary[];
  readonly projects?: readonly Project[];
  readonly selectedId?: string;
  readonly findConversation: (conversationId: string) => ConversationSummary | null;
  readonly selectConversation: (conversationId: string) => void;
  readonly setProfile: (value: AgentProfile | ((current: AgentProfile) => AgentProfile)) => void;
  readonly onNavigate?: (route: HashRoute) => void;
}) {
  useWorkspaceRouteSync({
    route,
    chats,
    projects,
    selectedId,
    findConversation,
    selectConversation,
    setProfile,
    onNavigate,
  });
  return null;
}

describe("useWorkspaceRouteSync", () => {
  it("selects a conversation from a chat route and syncs its profile", () => {
    const target = conversation("chat-2", { agent: "codex", model: "gpt-5", reasoning: "default", mode: "default" });
    const selectConversation = vi.fn();
    const setProfile = vi.fn((update: AgentProfile | ((current: AgentProfile) => AgentProfile)) => {
      return typeof update === "function" ? update(defaultProfile) : update;
    });

    render(
      <Harness
        route={{ kind: "chat", conversationId: "chat-2" }}
        chats={[conversation("chat-1"), target]}
        selectedId="chat-1"
        findConversation={(id) => (id === target.id ? target : null)}
        selectConversation={selectConversation}
        setProfile={setProfile}
      />,
    );

    expect(selectConversation).toHaveBeenCalledWith("chat-2");
    expect(setProfile).toHaveReturnedWith(target.profile);
  });

  it("selects the first project conversation for a project route without conversation id", () => {
    const projectConversation = conversation("project-chat");
    const selectConversation = vi.fn();

    render(
      <Harness
        route={{ kind: "project", projectId: "project-1" }}
        chats={[]}
        projects={[{ id: "project-1", name: "Project", conversations: [projectConversation] }]}
        findConversation={(id) => (id === projectConversation.id ? projectConversation : null)}
        selectConversation={selectConversation}
        setProfile={vi.fn()}
      />,
    );

    expect(selectConversation).toHaveBeenCalledWith("project-chat");
  });

  it("navigates to the first visible fallback when the route target is missing", () => {
    const fallback = conversation("fallback");
    const selectConversation = vi.fn();
    const onNavigate = vi.fn();

    render(
      <Harness
        route={{ kind: "chat", conversationId: "missing" }}
        chats={[fallback]}
        findConversation={() => null}
        selectConversation={selectConversation}
        setProfile={vi.fn()}
        onNavigate={onNavigate}
      />,
    );

    expect(onNavigate).toHaveBeenCalledWith({ kind: "chat", conversationId: "fallback" });
    expect(selectConversation).toHaveBeenCalledWith("fallback");
  });
});
