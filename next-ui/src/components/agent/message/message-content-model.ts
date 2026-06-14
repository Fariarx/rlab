import type { AgentBlock } from "../core/types";

export interface MessageAttachment {
  readonly id: string;
  readonly name: string;
  /** Path/URL for path-based file links; absent for inline text-file blocks. */
  readonly target?: string;
  readonly isImage: boolean;
}

const MESSAGE_IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?|#|$)/i;
const READ_ONLY_IMAGE_TOOL_NAMES = new Set(["read", "readfile", "read_file", "viewimage", "view_image", "image", "openimage", "open_image"]);

export function isMessageImageTarget(target: string): boolean {
  return MESSAGE_IMAGE_RE.test(target);
}

function isExternalUrlTarget(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(target);
}

function isPathAttachmentTarget(target: string): boolean {
  return !isExternalUrlTarget(target) && (/[\\/]/.test(target) || /\.[a-z0-9]{1,8}$/i.test(target));
}

export function splitUserContent(raw: string): { readonly text: string; readonly attachments: readonly MessageAttachment[] } {
  const attachments: MessageAttachment[] = [];
  let attachmentId = 0;
  let text = raw.replace(/(!?)\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole: string, bang: string, label: string, target: string) => {
    if (isPathAttachmentTarget(target)) {
      attachmentId += 1;
      attachments.push({ id: `link:${attachmentId}:${label}:${target}`, name: label, target, isImage: bang === "!" || isMessageImageTarget(target) });
      return "";
    }
    return whole;
  });
  text = text.replace(/<attachment\s+name="([^"]*)"[^>]*>[\s\S]*?<\/attachment>/g, (_match, name: string) => {
    attachmentId += 1;
    attachments.push({ id: `inline:${attachmentId}:${name}`, name, isImage: false });
    return "";
  });
  return { text: text.trim(), attachments };
}

export function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const leaf = normalized.split("/").filter(Boolean).at(-1);
  return leaf && leaf.trim().length > 0 ? leaf : path;
}

function toolLeafName(name: string): string {
  return name.split("/").at(-1)?.replace(/[-\s]/g, "_").toLowerCase() ?? name.toLowerCase();
}

export function readOnlyImageToolPath(block: AgentBlock): string | null {
  if (block.kind !== "tool" || block.state === "error") {
    return null;
  }
  const leaf = toolLeafName(block.name);
  if (!READ_ONLY_IMAGE_TOOL_NAMES.has(leaf) && !READ_ONLY_IMAGE_TOOL_NAMES.has(leaf.replace(/_/g, ""))) {
    return null;
  }
  const args = block.args ?? {};
  const candidates = [
    args.path,
    args.file,
    args.file_path,
    args.filePath,
    args.image,
    args.image_path,
    args.imagePath,
    args.source,
    args.input,
    block.summary,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return candidates.find((value) => isMessageImageTarget(value.trim()))?.trim() ?? null;
}
