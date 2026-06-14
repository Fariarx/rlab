import type { AgentId } from "../../lib/agent-catalog";
import type { VoiceProviderId } from "../../lib/voice-providers";
import { isRecord, payloadErrorMessage, readJsonPayload, responseErrorMessage } from "./http";

export interface AgentConfigInfo {
  readonly envVar: string;
  readonly configured: boolean;
}

export interface AgentConfigResponse {
  readonly agents: Partial<Record<AgentId, AgentConfigInfo>>;
}

export interface VoiceProviderConfigInfo {
  readonly envVar: string;
  readonly configured: boolean;
}

export interface VoiceConfigResponse {
  readonly providers: Partial<Record<VoiceProviderId, VoiceProviderConfigInfo>>;
}

export interface AgentInstallResponse {
  readonly command: string;
}

function isAgentConfigResponse(value: unknown): value is AgentConfigResponse {
  return isRecord(value) && isRecord(value.agents);
}

function isVoiceConfigResponse(value: unknown): value is VoiceConfigResponse {
  return isRecord(value) && isRecord(value.providers);
}

function isAgentInstallResponse(value: unknown): value is AgentInstallResponse {
  return isRecord(value) && typeof value.command === "string" && value.command.trim().length > 0;
}

export async function loadBrowserPreviewInstallStatus(): Promise<boolean | null> {
  const response = await fetch("/api/health", { method: "GET", cache: "no-store" });
  const payload = await readJsonPayload<{ readonly browser?: { readonly installed?: unknown }; readonly error?: string }>(response);
  if (!response.ok) {
    throw new Error(payloadErrorMessage(payload, `Health check failed (${response.status})`));
  }
  return isRecord(payload.browser) && typeof payload.browser.installed === "boolean" ? payload.browser.installed : null;
}

export async function loadBrowserPreviewInstalled(): Promise<boolean> {
  return (await loadBrowserPreviewInstallStatus()) ?? false;
}

export async function installBrowserPreview(): Promise<void> {
  const response = await fetch("/api/playwright-install", { method: "POST" });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `Playwright install failed (${response.status})`));
  }
}

export async function loadAgentConfig(): Promise<AgentConfigResponse> {
  const response = await fetch("/api/agent-config", { method: "GET", cache: "no-store" });
  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw new Error(payloadErrorMessage(payload, `Agent config load failed (${response.status})`));
  }
  if (!isAgentConfigResponse(payload)) {
    throw new Error("Agent config response is invalid.");
  }
  return payload;
}

export async function saveAgentApiKey(agent: AgentId, apiKey: string): Promise<void> {
  const response = await fetch("/api/agent-config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent, apiKey }),
  });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `Agent config save failed (${response.status})`));
  }
}

export async function installAgentCli(agent: AgentId): Promise<AgentInstallResponse> {
  const response = await fetch("/api/agent-install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent }),
  });
  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw new Error(payloadErrorMessage(payload, `Agent install failed (${response.status})`));
  }
  if (!isAgentInstallResponse(payload)) {
    throw new Error("Agent install response did not include command.");
  }
  return { command: payload.command };
}

export async function loadVoiceConfig(): Promise<VoiceConfigResponse> {
  const response = await fetch("/api/voice-config", { method: "GET", cache: "no-store" });
  const payload = await readJsonPayload(response);
  if (!response.ok) {
    throw new Error(payloadErrorMessage(payload, `Voice config load failed (${response.status})`));
  }
  if (!isVoiceConfigResponse(payload)) {
    throw new Error("Voice config response is invalid.");
  }
  return payload;
}

export async function saveVoiceApiKey(provider: VoiceProviderId, apiKey: string): Promise<void> {
  const response = await fetch("/api/voice-config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, apiKey }),
  });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `Voice provider config save failed (${response.status})`));
  }
}
