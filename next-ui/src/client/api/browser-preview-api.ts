import { isBrowserSnapshot, type BrowserSnapshot } from "../../lib/browser-preview-model";
import { payloadErrorMessage } from "./http";

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? (JSON.parse(text) as unknown) : null;
}

export async function postBrowserSnapshot(endpoint: string, body: object, invalidResponseMessage: string): Promise<BrowserSnapshot> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(payloadErrorMessage(payload, `HTTP ${response.status}`));
  }
  if (!isBrowserSnapshot(payload)) {
    throw new Error(invalidResponseMessage);
  }
  return payload;
}

export async function loadBrowserState(sessionId: string, invalidResponseMessage: string): Promise<BrowserSnapshot | null> {
  const response = await fetch(`/api/browser/bridge/snapshot?sessionId=${encodeURIComponent(sessionId)}`, { method: "GET", cache: "no-store" });
  if (response.status === 404) {
    return null;
  }
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(payloadErrorMessage(payload, invalidResponseMessage));
  }
  if (!isBrowserSnapshot(payload)) {
    throw new Error(invalidResponseMessage);
  }
  return payload;
}
