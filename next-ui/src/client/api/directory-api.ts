import { payloadErrorMessage, readJsonPayload } from "./http";

export interface DirectoryListing {
  readonly path: string;
  readonly parent: string | null;
  readonly entries: ReadonlyArray<{ readonly name: string; readonly path: string }>;
}

export interface FolderInfo {
  readonly path: string;
  readonly name?: string;
}

export async function listDirectories(path?: string): Promise<DirectoryListing> {
  const response = await fetch("/api/list-directories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(path ? { path } : {}),
  });
  const payload = await readJsonPayload<Partial<DirectoryListing> & { readonly error?: string }>(response);
  if (!response.ok) {
    throw new Error(payloadErrorMessage(payload, `Directory list failed (${response.status})`));
  }
  if (typeof payload.path !== "string") {
    throw new Error("Directory list response is missing path.");
  }
  return {
    path: payload.path,
    parent: typeof payload.parent === "string" ? payload.parent : null,
    entries: Array.isArray(payload.entries) ? payload.entries : [],
  };
}

export async function loadFolderInfo(path: string): Promise<FolderInfo> {
  const response = await fetch("/api/folder-info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  const payload = await readJsonPayload<{ readonly path?: string | null; readonly name?: string; readonly error?: string }>(response);
  if (!response.ok || !payload.path) {
    throw new Error(payloadErrorMessage(payload, `Folder info failed (${response.status})`));
  }
  return { path: payload.path, name: payload.name };
}
