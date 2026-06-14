import { payloadErrorMessage, readJsonPayload } from "./http";

export interface TerminalGeometry {
  readonly cols: number;
  readonly rows: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

export async function createTerminalSession(cwd: string, initialGeometry: TerminalGeometry | null): Promise<string> {
  const headers: Record<string, string> = { "X-Rlab-Terminal-Cwd": cwd };
  if (initialGeometry) {
    headers["X-Rlab-Terminal-Cols"] = String(initialGeometry.cols);
    headers["X-Rlab-Terminal-Rows"] = String(initialGeometry.rows);
    headers["X-Rlab-Terminal-Pixel-Width"] = String(initialGeometry.pixelWidth);
    headers["X-Rlab-Terminal-Pixel-Height"] = String(initialGeometry.pixelHeight);
  }
  const response = await fetch("/api/terminal", {
    method: "POST",
    headers,
  });
  const payload = await readJsonPayload<{ readonly id?: string; readonly error?: string }>(response);
  if (!response.ok || !payload.id) {
    throw new Error(payloadErrorMessage(payload, `Terminal failed (${response.status})`));
  }
  return payload.id;
}

export async function deleteTerminalSession(id: string): Promise<void> {
  const response = await fetch(`/api/terminal?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new Error(payloadErrorMessage(await readJsonPayload(response), `Terminal delete failed (${response.status})`));
  }
}
