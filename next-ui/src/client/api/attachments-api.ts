import { isRecord, payloadErrorMessage, readJsonPayload } from "./http";

export async function uploadAttachment(input: { readonly name: string; readonly mimeType: string; readonly dataBase64: string }): Promise<string> {
  const response = await fetch("/api/attachments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await readJsonPayload<{ readonly path?: string; readonly error?: string }>(response);
  if (!response.ok) {
    throw new Error(payloadErrorMessage(payload, `Upload failed (${response.status})`));
  }
  if (!isRecord(payload) || typeof payload.path !== "string" || payload.path.length === 0) {
    throw new Error("Upload response did not include path.");
  }
  return payload.path;
}
