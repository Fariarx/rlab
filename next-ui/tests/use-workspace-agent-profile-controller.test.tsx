import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AgentCliInfo, AgentId, AgentProfile, AgentSystemStatus, ConversationSummary } from "../src/components/agent";
import {
  buildWorkspaceComposerModes,
  useWorkspaceAgentProfileController,
  type ComposerModeOption,
  type UseWorkspaceAgentProfileControllerResult,
} from "../src/components/workspace/hooks/use-workspace-agent-profile-controller";

const defaultProfile: AgentProfile = { agent: "codex", model: "default", reasoning: "default", mode: "default" };

function conversation(profile: AgentProfile = defaultProfile): ConversationSummary {
  return {
    id: "chat-1",
    title: "Chat",
    snippet: "Snippet",
    time: "12:00",
    status: "idle",
    agent: profile.agent,
    profile,
  };
}

function cliInfo(modes: NonNullable<AgentCliInfo["modes"]>): AgentCliInfo {
  return {
    status: "available" satisfies AgentSystemStatus,
    bins: [],
    resolvedBin: null,
    runAdapter: true,
    selectable: true,
    env: [],
    installCommand: null,
    modes,
  };
}

function t(key: "agentModeFast" | "agentModePlan" | "agentModeReview" | "agentModeBuild" | "agentModeExplore" | "agentModeSummary"): string {
  return {
    agentModeFast: "Fast",
    agentModePlan: "Plan",
    agentModeReview: "Review",
    agentModeBuild: "Build",
    agentModeExplore: "Explore",
    agentModeSummary: "Summary",
  }[key];
}

function Harness({
  profile = defaultProfile,
  selected = conversation(profile),
  defaultProfileValue = defaultProfile,
  cliInfoOf = () => null,
  setProfile,
  setConversationProfile,
  capture,
}: {
  readonly profile?: AgentProfile;
  readonly selected?: ConversationSummary | null;
  readonly defaultProfileValue?: AgentProfile;
  readonly cliInfoOf?: (id: AgentId) => AgentCliInfo | null;
  readonly setProfile: (profile: AgentProfile) => void;
  readonly setConversationProfile: (conversationId: string, profile: AgentProfile) => void;
  readonly capture: (controller: {
  readonly handleAutoConfirmChange: (enabled: boolean) => void;
  readonly handleModeChange: (modeId: string) => void;
  readonly handleModifierModeChange: (modeId: string, enabled: boolean) => void;
  readonly handlePicked: (picked: AgentProfile) => void;
  readonly supportedModes: readonly ComposerModeOption[];
  }) => void;
}) {
  const controller = useWorkspaceAgentProfileController({
    defaultProfile: defaultProfileValue,
    profile,
    selected,
    selectedId: "chat-1",
    setConversationProfile,
    setProfile,
    cliInfoOf,
    t,
  });

  useEffect(() => {
    capture(controller);
  }, [capture, controller]);

  return null;
}

describe("useWorkspaceAgentProfileController", () => {
  it("builds composer modes from CLI metadata and filters non-chat modes", () => {
    expect(
      buildWorkspaceComposerModes({
        agentId: "codex",
        modeLabels: {
          agentModeFast: "Fast",
          agentModePlan: "Plan",
          agentModeReview: "Review",
          agentModeBuild: "Build",
          agentModeExplore: "Explore",
          agentModeSummary: "Summary",
        },
        cliModes: [
          { id: "default", label: "Default" },
          { id: "plan", label: "Plan raw" },
          { id: "auto", label: "Auto" },
          { id: "bypass-permissions", label: "Bypass" },
          { id: "review", label: "Review" },
          { id: "custom-reviewer", label: "Custom Reviewer" },
        ],
      }),
    ).toEqual([
      { id: "fast", label: "Fast" },
      { id: "plan", label: "Plan" },
      { id: "review", label: "Review" },
      { id: "build", label: "Build" },
      { id: "explore", label: "Explore" },
      { id: "summary", label: "Summary" },
      { id: "custom-reviewer", label: "Custom Reviewer" },
    ]);
  });

  it("syncs local profile from the selected conversation", () => {
    const setProfile = vi.fn();
    const selectedProfile: AgentProfile = { agent: "gemini", model: "default", reasoning: "default", mode: "default" };

    render(
      <Harness
        profile={defaultProfile}
        selected={conversation(selectedProfile)}
        setProfile={setProfile}
        setConversationProfile={vi.fn()}
        capture={vi.fn()}
      />,
    );

    expect(setProfile).toHaveBeenCalledWith(selectedProfile);
  });

  it("does not reset a user-picked profile when the same conversation updates", async () => {
    const setProfile = vi.fn();
    const setConversationProfile = vi.fn();
    const captured: { current: UseWorkspaceAgentProfileControllerResult | null } = { current: null };
    const pickedProfile: AgentProfile = { agent: "gemini", model: "default", reasoning: "default", mode: "default" };
    const selected = conversation(defaultProfile);

    const { rerender } = render(
      <Harness
        profile={defaultProfile}
        selected={selected}
        setProfile={setProfile}
        setConversationProfile={setConversationProfile}
        capture={(controller) => {
          captured.current = controller;
        }}
      />,
    );

    await waitFor(() => expect(captured.current).not.toBeNull());
    setProfile.mockClear();
    captured.current?.handlePicked(pickedProfile);

    expect(setProfile).toHaveBeenCalledWith(pickedProfile);
    setProfile.mockClear();

    rerender(
      <Harness
        profile={pickedProfile}
        selected={{ ...selected, status: "running", time: "12:01" }}
        setProfile={setProfile}
        setConversationProfile={setConversationProfile}
        capture={(controller) => {
          captured.current = controller;
        }}
      />,
    );

    expect(setProfile).not.toHaveBeenCalled();
  });

  it("syncs local profile from defaults when no conversation is selected", () => {
    const setProfile = vi.fn();
    const fallbackProfile: AgentProfile = { agent: "claude-code", model: "default", reasoning: "default", mode: "default" };

    render(
      <Harness
        selected={null}
        defaultProfileValue={fallbackProfile}
        setProfile={setProfile}
        setConversationProfile={vi.fn()}
        capture={vi.fn()}
      />,
    );

    expect(setProfile).toHaveBeenCalledWith(fallbackProfile);
  });

  it("persists mode and auto-confirm changes to the selected conversation", async () => {
    const setProfile = vi.fn();
    const setConversationProfile = vi.fn();
    const captured: { current: UseWorkspaceAgentProfileControllerResult | null } = { current: null };

    render(
      <Harness
        setProfile={setProfile}
        setConversationProfile={setConversationProfile}
        capture={(controller) => {
          captured.current = controller;
        }}
      />,
    );

    await waitFor(() => expect(captured.current).not.toBeNull());
    captured.current?.handleModeChange("plan");
    captured.current?.handleAutoConfirmChange(true);

    expect(setConversationProfile).toHaveBeenCalledWith("chat-1", expect.objectContaining({ mode: "plan" }));
    expect(setConversationProfile).toHaveBeenCalledWith("chat-1", expect.objectContaining({ autoConfirm: true }));
    expect(setProfile).toHaveBeenCalledWith(expect.objectContaining({ mode: "plan" }));
    expect(setProfile).toHaveBeenCalledWith(expect.objectContaining({ autoConfirm: true }));
  });

  it("persists fast as a modifier without replacing the work mode", async () => {
    const setProfile = vi.fn();
    const setConversationProfile = vi.fn();
    const captured: { current: UseWorkspaceAgentProfileControllerResult | null } = { current: null };
    const profile: AgentProfile = { agent: "codex", model: "default", reasoning: "default", mode: "plan" };

    render(
      <Harness
        profile={profile}
        selected={conversation(profile)}
        setProfile={setProfile}
        setConversationProfile={setConversationProfile}
        capture={(controller) => {
          captured.current = controller;
        }}
      />,
    );

    await waitFor(() => expect(captured.current).not.toBeNull());
    captured.current?.handleModifierModeChange("fast", true);

    expect(setConversationProfile).toHaveBeenCalledWith("chat-1", expect.objectContaining({ mode: "plan", fast: true }));
    expect(setProfile).toHaveBeenCalledWith(expect.objectContaining({ mode: "plan", fast: true }));
  });

  it("exposes CLI-provided supported modes", async () => {
    const captured: { current: UseWorkspaceAgentProfileControllerResult | null } = { current: null };

    render(
      <Harness
        setProfile={vi.fn()}
        setConversationProfile={vi.fn()}
        cliInfoOf={() => cliInfo([{ id: "review", label: "Review" }])}
        capture={(controller) => {
          captured.current = controller;
        }}
      />,
    );

    await waitFor(() =>
      expect(captured.current?.supportedModes).toEqual([
        { id: "fast", label: "Fast" },
        { id: "plan", label: "Plan" },
        { id: "review", label: "Review" },
        { id: "build", label: "Build" },
        { id: "explore", label: "Explore" },
        { id: "summary", label: "Summary" },
      ]),
    );
  });
});
