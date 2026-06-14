import { useCallback, useEffect, useState } from "react";
import { installAgentCli, loadAgentConfig, saveAgentApiKey } from "../../client/api/settings-api";
import type { AgentDef } from "../agent";
import { AgentsSectionStore } from "./settings-dialog-store";
import { agentConfigAfterApiKeySaved, errorMessage } from "./settings-dialog-model";

export interface AgentsSectionController {
  readonly store: AgentsSectionStore;
  readonly retryLoadConfig: () => void;
  readonly saveApiKey: (agent: AgentDef) => void;
  readonly installAgent: (agent: AgentDef) => void;
}

export function useAgentsSectionController(reloadAgentStatus: () => void): AgentsSectionController {
  const [store] = useState(() => new AgentsSectionStore());
  const {
    configReloadToken,
    setConfig,
    setConfigReloadToken,
    setConfigError,
    draftKeys,
    setDraftKeys,
    setSavingKey,
    setInstalling,
    setOperationNotice,
  } = store;

  useEffect(() => {
    void configReloadToken;
    let active = true;

    async function loadConfig(): Promise<void> {
      setConfigError(null);
      try {
        const payload = await loadAgentConfig();
        if (active) {
          setConfig(payload);
        }
      } catch (error) {
        if (active) {
          setConfigError(errorMessage(error));
        }
      }
    }

    void loadConfig();
    return () => {
      active = false;
    };
  }, [configReloadToken, setConfig, setConfigError]);

  const retryLoadConfig = useCallback(() => {
    setConfigReloadToken((current) => current + 1);
  }, [setConfigReloadToken]);

  const saveApiKey = useCallback(
    (agent: AgentDef) => {
      const apiKey = draftKeys[agent.id]?.trim();
      if (!apiKey) {
        return;
      }
      setSavingKey(agent.id);
      setOperationNotice(null);
      void (async () => {
        try {
          await saveAgentApiKey(agent.id, apiKey);
          setConfig((current) => agentConfigAfterApiKeySaved(current, agent.id));
          setDraftKeys((current) => ({ ...current, [agent.id]: "" }));
          setOperationNotice({ type: "api-key-saved", agent: agent.name });
          reloadAgentStatus();
        } catch (error) {
          setOperationNotice({ type: "api-key-save-failed", agent: agent.name, error: errorMessage(error) });
        } finally {
          setSavingKey(null);
        }
      })();
    },
    [draftKeys, reloadAgentStatus, setConfig, setDraftKeys, setOperationNotice, setSavingKey],
  );

  const installAgent = useCallback(
    (agent: AgentDef) => {
      setInstalling(agent.id);
      setOperationNotice(null);
      void (async () => {
        try {
          const payload = await installAgentCli(agent.id);
          setOperationNotice({ type: "install-completed", agent: agent.name, command: payload.command });
          reloadAgentStatus();
        } catch (error) {
          setOperationNotice({ type: "install-failed", agent: agent.name, error: errorMessage(error) });
        } finally {
          setInstalling(null);
        }
      })();
    },
    [reloadAgentStatus, setInstalling, setOperationNotice],
  );

  return { store, retryLoadConfig, saveApiKey, installAgent };
}
