import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  DEFAULT_AGENT_OPTION_ID,
  agentProfileEquals,
  getAgent,
  isAgentModifierModeId,
  normalizeAgentProfile,
  type AgentCliInfo,
  type AgentId,
  type AgentProfile,
  type AgentOption,
  type ConversationSummary,
} from "../../agent";
import { conversationProfile } from "../models/workspace-state-utils";

export interface ComposerModeOption {
  readonly id: string;
  readonly label: string;
}

export interface BuildWorkspaceComposerModesInput {
  readonly agentId: AgentId;
  readonly cliModes?: readonly AgentOption[];
  readonly modeLabels: WorkModeLabels;
}

type WorkModeLabelKey = "agentModeFast" | "agentModePlan" | "agentModeReview" | "agentModeBuild" | "agentModeExplore" | "agentModeSummary";
type WorkModeLabels = Record<WorkModeLabelKey, string>;

function modeLabel(mode: AgentOption, labels: WorkModeLabels): string {
  switch (mode.id) {
    case "fast":
      return labels.agentModeFast;
    case "plan":
      return labels.agentModePlan;
    case "review":
      return labels.agentModeReview;
    case "build":
      return labels.agentModeBuild;
    case "explore":
      return labels.agentModeExplore;
    case "summary":
      return labels.agentModeSummary;
    default:
      return mode.label;
  }
}

function modeLabelKey(label: string): string {
  return label.trim().toLowerCase().replace(/[\s._-]+/g, "-");
}

export function buildWorkspaceComposerModes({
  agentId,
  cliModes,
  modeLabels,
}: BuildWorkspaceComposerModesInput): readonly ComposerModeOption[] {
  const def = getAgent(agentId);
  const sourceModes = [...def.modes, ...(cliModes ?? [])];
  const seenIds = new Set<string>();
  const seenLabels = new Set<string>();
  const modes: ComposerModeOption[] = [];
  for (const mode of sourceModes) {
    if (mode.id === DEFAULT_AGENT_OPTION_ID || mode.id === "auto" || mode.id === "bypass-permissions") {
      continue;
    }
    const label = modeLabel(mode, modeLabels);
    const labelKey = modeLabelKey(label);
    const sourceLabelKey = modeLabelKey(mode.label);
    if (seenIds.has(mode.id) || seenLabels.has(labelKey) || seenLabels.has(sourceLabelKey)) {
      continue;
    }
    seenIds.add(mode.id);
    seenLabels.add(labelKey);
    seenLabels.add(sourceLabelKey);
    modes.push({ id: mode.id, label });
  }
  return modes;
}

export interface UseWorkspaceAgentProfileControllerInput {
  readonly defaultProfile: AgentProfile;
  readonly profile: AgentProfile;
  readonly selected: ConversationSummary | null | undefined;
  readonly selectedId: string;
  readonly setConversationProfile: (conversationId: string, profile: AgentProfile) => void;
  readonly setProfile: (profile: AgentProfile) => void;
  readonly cliInfoOf: (id: AgentId) => AgentCliInfo | null;
  readonly t: (key: WorkModeLabelKey) => string;
}

export interface UseWorkspaceAgentProfileControllerResult {
  readonly handleAutoConfirmChange: (enabled: boolean) => void;
  readonly handleModeChange: (modeId: string) => void;
  readonly handleModifierModeChange: (modeId: string, enabled: boolean) => void;
  readonly handlePicked: (picked: AgentProfile) => void;
  readonly supportedModes: readonly ComposerModeOption[];
}

export function useWorkspaceAgentProfileController({
  defaultProfile,
  profile,
  selected,
  selectedId,
  setConversationProfile,
  setProfile,
  cliInfoOf,
  t,
}: UseWorkspaceAgentProfileControllerInput): UseWorkspaceAgentProfileControllerResult {
  const lastSyncedConversationIdRef = useRef<string | null>(null);
  const userPickedConversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selected) {
      lastSyncedConversationIdRef.current = null;
      userPickedConversationIdRef.current = null;
      setProfile(defaultProfile);
      return;
    }
    const selectedProfile = conversationProfile(selected);
    if (lastSyncedConversationIdRef.current !== selected.id) {
      lastSyncedConversationIdRef.current = selected.id;
      userPickedConversationIdRef.current = null;
      setProfile(selectedProfile);
      return;
    }
    if (userPickedConversationIdRef.current !== selected.id && !agentProfileEquals(profile, selectedProfile)) {
      setProfile(selectedProfile);
    }
  }, [defaultProfile, profile, selected, setProfile]);

  const supportedModes = useMemo(
    () =>
      buildWorkspaceComposerModes({
        agentId: profile.agent,
        cliModes: cliInfoOf(profile.agent)?.modes,
        modeLabels: {
          agentModeFast: t("agentModeFast"),
          agentModePlan: t("agentModePlan"),
          agentModeReview: t("agentModeReview"),
          agentModeBuild: t("agentModeBuild"),
          agentModeExplore: t("agentModeExplore"),
          agentModeSummary: t("agentModeSummary"),
        },
      }),
    [cliInfoOf, profile.agent, t],
  );

  const updateSelectedProfile = useCallback((next: AgentProfile) => {
    setProfile(next);
    if (selectedId) {
      userPickedConversationIdRef.current = selectedId;
      setConversationProfile(selectedId, next);
    }
  }, [selectedId, setConversationProfile, setProfile]);

  const handlePicked = useCallback((picked: AgentProfile) => {
    updateSelectedProfile(picked);
  }, [updateSelectedProfile]);

  const handleModeChange = useCallback((modeId: string) => {
    if (isAgentModifierModeId(modeId)) {
      updateSelectedProfile(normalizeAgentProfile({ ...profile, fast: modeId === "fast" ? !(profile.fast ?? false) : false }));
      return;
    }
    updateSelectedProfile(normalizeAgentProfile({ ...profile, mode: modeId }));
  }, [profile, updateSelectedProfile]);

  const handleModifierModeChange = useCallback((modeId: string, enabled: boolean) => {
    if (modeId === "fast") {
      updateSelectedProfile(normalizeAgentProfile({ ...profile, fast: enabled }));
    }
  }, [profile, updateSelectedProfile]);

  const handleAutoConfirmChange = useCallback((enabled: boolean) => {
    updateSelectedProfile(normalizeAgentProfile({ ...profile, autoConfirm: enabled }));
  }, [profile, updateSelectedProfile]);

  return {
    handleAutoConfirmChange,
    handleModeChange,
    handleModifierModeChange,
    handlePicked,
    supportedModes,
  };
}
