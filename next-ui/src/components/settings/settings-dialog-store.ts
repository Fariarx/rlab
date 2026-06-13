import { action, makeObservable, observable } from "mobx";
import type { VoiceProviderId } from "../../lib/voice-providers";
import type { AgentId } from "../agent";

interface AgentConfigInfo {
  readonly envVar: string;
  readonly configured: boolean;
}

interface AgentConfigResponse {
  readonly agents: Partial<Record<AgentId, AgentConfigInfo>>;
}

interface VoiceProviderConfigInfo {
  readonly envVar: string;
  readonly configured: boolean;
}

interface VoiceConfigResponse {
  readonly providers: Partial<Record<VoiceProviderId, VoiceProviderConfigInfo>>;
}

type AgentOperationNotice =
  | {
      readonly type: "install-completed";
      readonly agent: string;
      readonly command: string;
    }
  | {
      readonly type: "install-failed";
      readonly agent: string;
      readonly error: string;
    }
  | {
      readonly type: "api-key-save-failed";
      readonly agent: string;
      readonly error: string;
    }
  | {
      readonly type: "api-key-saved";
      readonly agent: string;
    };

type VoiceOperationNotice = { readonly severity: "success" | "error"; readonly message: string };
type StateUpdater<T> = T | ((current: T) => T);

function resolveState<T>(current: T, updater: StateUpdater<T>): T {
  return typeof updater === "function" ? (updater as (value: T) => T)(current) : updater;
}

export class BrowserPreviewSetupStore {
  installed: boolean | null = null;

  installing = false;

  error: string | null = null;

  constructor() {
    makeObservable(this, {
      installed: observable,
      installing: observable,
      error: observable,
      setInstalled: action.bound,
      setInstalling: action.bound,
      setError: action.bound,
    });
  }

  setInstalled(value: StateUpdater<boolean | null>): void {
    this.installed = resolveState(this.installed, value);
  }

  setInstalling(value: StateUpdater<boolean>): void {
    this.installing = resolveState(this.installing, value);
  }

  setError(value: StateUpdater<string | null>): void {
    this.error = resolveState(this.error, value);
  }
}

export class AgentsSectionStore {
  config: AgentConfigResponse = { agents: {} };

  configReloadToken = 0;

  configError: string | null = null;

  draftKeys: Partial<Record<AgentId, string>> = {};

  savingKey: AgentId | null = null;

  installing: AgentId | null = null;

  operationNotice: AgentOperationNotice | null = null;

  keyPopover: { readonly id: AgentId; readonly anchor: HTMLElement } | null = null;

  constructor() {
    makeObservable(this, {
      config: observable.ref,
      configReloadToken: observable,
      configError: observable,
      draftKeys: observable.ref,
      savingKey: observable,
      installing: observable,
      operationNotice: observable.ref,
      keyPopover: observable.ref,
      setConfig: action.bound,
      setConfigReloadToken: action.bound,
      setConfigError: action.bound,
      setDraftKeys: action.bound,
      setSavingKey: action.bound,
      setInstalling: action.bound,
      setOperationNotice: action.bound,
      setKeyPopover: action.bound,
    });
  }

  setConfig(value: StateUpdater<AgentConfigResponse>): void {
    this.config = resolveState(this.config, value);
  }

  setConfigReloadToken(value: StateUpdater<number>): void {
    this.configReloadToken = resolveState(this.configReloadToken, value);
  }

  setConfigError(value: StateUpdater<string | null>): void {
    this.configError = resolveState(this.configError, value);
  }

  setDraftKeys(value: StateUpdater<Partial<Record<AgentId, string>>>): void {
    this.draftKeys = resolveState(this.draftKeys, value);
  }

  setSavingKey(value: StateUpdater<AgentId | null>): void {
    this.savingKey = resolveState(this.savingKey, value);
  }

  setInstalling(value: StateUpdater<AgentId | null>): void {
    this.installing = resolveState(this.installing, value);
  }

  setOperationNotice(value: StateUpdater<AgentOperationNotice | null>): void {
    this.operationNotice = resolveState(this.operationNotice, value);
  }

  setKeyPopover(value: StateUpdater<{ readonly id: AgentId; readonly anchor: HTMLElement } | null>): void {
    this.keyPopover = resolveState(this.keyPopover, value);
  }
}

export class VoiceSectionStore {
  config: VoiceConfigResponse = { providers: {} };

  configError: string | null = null;

  reloadToken = 0;

  draftKeys: Partial<Record<VoiceProviderId, string>> = {};

  savingKey: VoiceProviderId | null = null;

  notice: VoiceOperationNotice | null = null;

  keyPopover: { readonly id: VoiceProviderId; readonly anchor: HTMLElement } | null = null;

  constructor() {
    makeObservable(this, {
      config: observable.ref,
      configError: observable,
      reloadToken: observable,
      draftKeys: observable.ref,
      savingKey: observable,
      notice: observable.ref,
      keyPopover: observable.ref,
      setConfig: action.bound,
      setConfigError: action.bound,
      setReloadToken: action.bound,
      setDraftKeys: action.bound,
      setSavingKey: action.bound,
      setNotice: action.bound,
      setKeyPopover: action.bound,
    });
  }

  setConfig(value: StateUpdater<VoiceConfigResponse>): void {
    this.config = resolveState(this.config, value);
  }

  setConfigError(value: StateUpdater<string | null>): void {
    this.configError = resolveState(this.configError, value);
  }

  setReloadToken(value: StateUpdater<number>): void {
    this.reloadToken = resolveState(this.reloadToken, value);
  }

  setDraftKeys(value: StateUpdater<Partial<Record<VoiceProviderId, string>>>): void {
    this.draftKeys = resolveState(this.draftKeys, value);
  }

  setSavingKey(value: StateUpdater<VoiceProviderId | null>): void {
    this.savingKey = resolveState(this.savingKey, value);
  }

  setNotice(value: StateUpdater<VoiceOperationNotice | null>): void {
    this.notice = resolveState(this.notice, value);
  }

  setKeyPopover(value: StateUpdater<{ readonly id: VoiceProviderId; readonly anchor: HTMLElement } | null>): void {
    this.keyPopover = resolveState(this.keyPopover, value);
  }
}

export class SettingsDialogStore {
  tab = 0;

  constructor() {
    makeObservable(this, {
      tab: observable,
      setTab: action.bound,
    });
  }

  setTab(value: StateUpdater<number>): void {
    this.tab = resolveState(this.tab, value);
  }
}
