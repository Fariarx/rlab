import type { VoiceProviderId } from "../../lib/voice-providers";
import { isRecord, payloadErrorMessage, readJsonPayload } from "./http";

export async function transcribeVoice(input: {
  readonly provider: VoiceProviderId;
  readonly mimeType: string;
  readonly dataBase64: string;
  readonly language: string;
}): Promise<string> {
  const response = await fetch("/api/voice/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await readJsonPayload<{ readonly text?: unknown; readonly error?: string }>(response);
  if (!response.ok) {
    throw new Error(payloadErrorMessage(payload, `Voice transcription failed (${response.status})`));
  }
  if (!isRecord(payload) || typeof payload.text !== "string") {
    throw new Error("Voice transcription response is invalid.");
  }
  return payload.text;
}
