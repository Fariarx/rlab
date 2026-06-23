import { responseErrorMessage } from "./http";

export async function loadAgentStatusPayload({ liveModels = false }: { readonly liveModels?: boolean } = {}): Promise<unknown> {
  const response = await fetch(liveModels ? "/api/agents?live=1" : "/api/agents", { method: "GET", cache: "no-store" });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `Agent detection failed (${response.status})`));
  }
  return response.json();
}
