import { useCallback, useEffect, useState } from "react";
import { loadVoiceConfig, saveVoiceApiKey } from "../../client/api/settings-api";
import { getVoiceProvider, type VoiceProviderId } from "../../lib/voice-providers";
import { VoiceSectionStore } from "./settings-dialog-store";
import { errorMessage, voiceConfigAfterApiKeySaved } from "./settings-dialog-model";

export interface VoiceSectionController {
  readonly store: VoiceSectionStore;
  readonly retryLoadConfig: () => void;
  readonly saveApiKey: (provider: VoiceProviderId) => void;
}

export function useVoiceSectionController({
  onVoiceConfigChange,
  successMessage,
  failureMessage,
}: {
  readonly onVoiceConfigChange?: () => void;
  readonly successMessage: (providerName: string) => string;
  readonly failureMessage: (providerName: string, error: string) => string;
}): VoiceSectionController {
  const [store] = useState(() => new VoiceSectionStore());
  const {
    setConfig,
    setConfigError,
    reloadToken,
    setReloadToken,
    draftKeys,
    setDraftKeys,
    setSavingKey,
    setNotice,
  } = store;

  useEffect(() => {
    void reloadToken;
    let active = true;
    void (async () => {
      setConfigError(null);
      try {
        const payload = await loadVoiceConfig();
        if (active) {
          setConfig(payload);
        }
      } catch (error) {
        if (active) {
          setConfigError(errorMessage(error));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadToken, setConfig, setConfigError]);

  const retryLoadConfig = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, [setReloadToken]);

  const saveApiKey = useCallback(
    (provider: VoiceProviderId) => {
      const apiKey = draftKeys[provider]?.trim();
      if (!apiKey) {
        return;
      }
      setSavingKey(provider);
      setNotice(null);
      void (async () => {
        try {
          await saveVoiceApiKey(provider, apiKey);
          const providerDef = getVoiceProvider(provider);
          setConfig((current) => voiceConfigAfterApiKeySaved(current, provider, providerDef.envVar ?? ""));
          setDraftKeys((current) => ({ ...current, [provider]: "" }));
          setNotice({ severity: "success", message: successMessage(providerDef.name) });
          onVoiceConfigChange?.();
        } catch (error) {
          setNotice({ severity: "error", message: failureMessage(getVoiceProvider(provider).name, errorMessage(error)) });
        } finally {
          setSavingKey(null);
        }
      })();
    },
    [draftKeys, failureMessage, onVoiceConfigChange, setConfig, setDraftKeys, setNotice, setSavingKey, successMessage],
  );

  return { store, retryLoadConfig, saveApiKey };
}
