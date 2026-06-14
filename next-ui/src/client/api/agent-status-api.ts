import { responseErrorMessage } from "./http";

export async function loadAgentStatusPayload(): Promise<unknown> {
  const response = await fetch("/api/agents", { method: "GET", cache: "no-store" });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `Agent detection failed (${response.status})`));
  }
  return response.json();
}
