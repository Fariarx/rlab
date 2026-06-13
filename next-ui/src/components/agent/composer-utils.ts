import type { ComposerAttachmentDraft, ComposerDraft } from "./types";

/** Pastes longer than this become a text-file attachment instead of flooding the input. */
export const PASTE_AS_FILE_CHARS = 1500;

// Pasted-file fallback names only (a filename, not a React key).
let attachmentIdSeq = 0;

/** A process-unique attachment id. Must NOT derive from file metadata + a
 *  module counter: the counter resets on every page load, so the same file
 *  re-attached after a reload (or in a second tab) would mint a colliding id,
 *  and a persisted-draft round-trip could surface two list entries with the same
 *  React key — which React reconciles by duplicating or dropping tiles, so
 *  attachments appeared to vanish or multiply. A UUID is collision-free. */
function newAttachmentId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `att-${Date.now().toString(36)}-${(attachmentIdSeq++).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "yaml", "yml", "toml", "csv", "tsv", "js", "jsx", "ts", "tsx", "mjs", "cjs",
  "css", "scss", "less", "html", "xml", "sh", "bash", "zsh", "py", "rb", "go", "rs", "java", "kt", "c", "h",
  "cpp", "hpp", "cc", "cs", "php", "sql", "log", "env", "gitignore", "dockerfile", "ini", "conf", "cfg", "diff", "patch",
]);

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/[[\]\\]/g, "\\$&");
}

export function isImageMime(type: string): boolean {
  return type.startsWith("image/");
}

function isTextLikeFile(file: File): boolean {
  const type = file.type;
  if (type.startsWith("text/")) {
    return true;
  }
  if (/^application\/(json|xml|javascript|x-yaml|yaml|x-sh|toml|x-www-form-urlencoded)$/.test(type)) {
    return true;
  }
  if (type === "") {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    return TEXT_EXTENSIONS.has(ext);
  }
  return false;
}

export function mentionQuery(value: string): string | null {
  const match = value.match(/(?:^|\s)@([^\s@/]*)$/);
  return match ? match[1].toLowerCase() : null;
}

export function pluginLinkQuery(value: string): string | null {
  const match = value.match(/(?:^|\s)\$([^\s$]*)$/);
  return match ? match[1].toLowerCase() : null;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function displayPluginToken(token: string): string {
  return token.replace(/^\$/, "").replace(/^ScheduleWakeup$/, "TaskWakeup");
}

export function attachmentBlock(attachment: ComposerAttachmentDraft): string {
  // Non-text files are referenced by their on-disk path (vibe-kanban style) so
  // the agent reads them with its own tools instead of receiving garbled bytes.
  if (attachment.path) {
    const label = escapeMarkdownLabel(attachment.name);
    return isImageMime(attachment.type) ? `![${label}](${attachment.path})` : `[${label}](${attachment.path})`;
  }
  const type = attachment.type || "text/plain";
  return [`<attachment name="${escapeXml(attachment.name)}" type="${escapeXml(type)}">`, attachment.content, "</attachment>"].join("\n");
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read audio"));
    reader.readAsDataURL(blob);
  });
}

export async function readComposerResponseError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error ?? fallback;
}

export async function fileToAttachmentDraft(file: File): Promise<ComposerAttachmentDraft> {
  const base = {
    id: newAttachmentId(),
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    lastModified: file.lastModified,
  };
  if (isTextLikeFile(file)) {
    return { ...base, content: await file.text() };
  }
  const dataBase64 = await fileToBase64(file);
  const response = await fetch("/api/attachments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, mimeType: base.type, dataBase64 }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Upload failed (${response.status})`);
  }
  const { path } = (await response.json()) as { path: string };
  return { ...base, content: "", path };
}

function composerAttachmentsEqual(left: readonly ComposerAttachmentDraft[], right: readonly ComposerAttachmentDraft[]): boolean {
  return left.length === right.length && left.every((attachment, index) => {
    const other = right[index];
    return (
      other !== undefined
      && attachment.id === other.id
      && attachment.name === other.name
      && attachment.type === other.type
      && attachment.content === other.content
      && attachment.size === other.size
      && attachment.lastModified === other.lastModified
      && attachment.path === other.path
    );
  });
}

export function composerDraftsEqual(left: ComposerDraft, right: ComposerDraft): boolean {
  return left.text === right.text && composerAttachmentsEqual(left.attachments, right.attachments);
}
