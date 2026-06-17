import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  DEFAULT_AGENT_OPTION_ID,
  agentProfileEquals,
  getAgent,
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
  readonly planLabel: string;
}

export function buildWorkspaceComposerModes({
  agentId,
  cliModes,
  planLabel,
}: BuildWorkspaceComposerModesInput): readonly ComposerModeOption[] {
  const def = getAgent(agentId);
  const sourceModes = cliModes && cliModes.length > 0 ? cliModes : def.modes;
  return sourceModes
    .filter((mode) => mode.id !== DEFAULT_AGENT_OPTION_ID && mode.id !== "auto" && mode.id !== "bypass-permissions")
    .map((mode) => ({
      id: mode.id,
      label: mode.id === "plan" ? planLabel : mode.label,
    }));
}

export interface UseWorkspaceAgentProfileControllerInput {
  readonly defaultProfile: AgentProfile;
  readonly profile: AgentProfile;
  readonly selected: ConversationSummary | null | undefined;
  readonly selectedId: string;
  readonly setConversationProfile: (conversationId: string, profile: AgentProfile) => void;
  readonly setProfile: (profile: AgentProfile) => void;
  readonly cliInfoOf: (id: AgentId) => AgentCliInfo | null;
  readonly t: (key: "agentModePlan") => string;
}

export interface UseWorkspaceAgentProfileControllerResult {
  readonly handleAutoConfirmChange: (enabled: boolean) => void;
  readonly handleModeChange: (modeId: string) => void;
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
        planLabel: t("agentModePlan"),
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
    updateSelectedProfile(normalizeAgentProfile({ ...profile, mode: modeId }));
  }, [profile, updateSelectedProfile]);

  const handleAutoConfirmChange = useCallback((enabled: boolean) => {
    updateSelectedProfile(normalizeAgentProfile({ ...profile, autoConfirm: enabled }));
  }, [profile, updateSelectedProfile]);

  return {
    handleAutoConfirmChange,
    handleModeChange,
    handlePicked,
    supportedModes,
  };
}
