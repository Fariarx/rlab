export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readJsonPayload<T = unknown>(response: Response): Promise<T> {
  const body = await response.text();
  if (body.trim().length === 0) {
    throw new Error(`Expected JSON response, got empty body (${response.status}).`);
  }
  try {
    return JSON.parse(body) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Expected JSON response (${response.status}): ${message}`);
  }
}

export function payloadErrorMessage(payload: unknown, defaultMessage: string): string {
  return isRecord(payload) && typeof payload.error === "string" && payload.error.trim().length > 0 ? payload.error.trim() : defaultMessage;
}

export async function responseErrorMessage(response: Response, defaultMessage: string): Promise<string> {
  const body = await response.text();
  if (body.trim().length === 0) {
    return defaultMessage;
  }
  try {
    return payloadErrorMessage(JSON.parse(body), defaultMessage);
  } catch {
    return defaultMessage;
  }
}
