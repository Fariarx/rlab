import type { AgentBlock, ComposerAttachmentDraft, ComposerDraft } from "../core/types";

export interface MessageAttachment {
  readonly id: string;
  readonly name: string;
  /** Path/URL for path-based file links; absent for inline text-file blocks. */
  readonly target?: string;
  readonly isImage: boolean;
}

export interface TaskGoalUserMessage {
  readonly id: string;
  readonly description: string;
  readonly instructions: string;
}

const MESSAGE_IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?|#|$)/i;
const READ_ONLY_IMAGE_TOOL_NAMES = new Set(["read", "readfile", "read_file", "viewimage", "view_image", "image", "openimage", "open_image"]);
const TASK_GOAL_BLOCK_RE = /^\s*🎯\s*<rlab-task-goal\s+id="([^"]+)">\s*<summary>[\s\S]*?<\/summary>\s*<description>([\s\S]*?)<\/description>\s*<instructions>([\s\S]*?)<\/instructions>\s*<\/rlab-task-goal>\s*$/;
const LEGACY_TASK_GOAL_RE = /^\s*🎯\s*TaskGoal queue item \(id:\s*([^)]+)\)\.\s*Work on this standing goal\.\s*When it is achieved, call TaskGoal with action='complete' for this id; to cancel it, call TaskGoal with action='remove'\.\s*Goal:\s*([\s\S]*?)\s*$/;

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

function unescapeXml(value: string): string {
  return value.replaceAll("&quot;", "\"").replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
}

export function parseTaskGoalUserMessage(raw: string): TaskGoalUserMessage | null {
  const blockMatch = TASK_GOAL_BLOCK_RE.exec(raw);
  if (blockMatch) {
    return {
      id: unescapeXml(blockMatch[1] ?? "").trim(),
      description: unescapeXml(blockMatch[2] ?? "").trim(),
      instructions: unescapeXml(blockMatch[3] ?? "").trim(),
    };
  }

  const legacyMatch = LEGACY_TASK_GOAL_RE.exec(raw);
  if (!legacyMatch) {
    return null;
  }
  const id = (legacyMatch[1] ?? "").trim();
  return {
    id,
    description: (legacyMatch[2] ?? "").trim(),
    instructions: `Work on this standing goal. When it is achieved, call TaskGoal with action="complete" and goalId="${id}"; to cancel it, call TaskGoal with action="remove" and goalId="${id}".`,
  };
}

function unescapeMarkdownLabel(value: string): string {
  return value.replace(/\\([[\]\\])/g, "$1");
}

/** Inverse of the composer's attachment serialization (see `attachmentBlock`):
 *  turn a stored user message back into an editable `ComposerDraft` so the real
 *  Composer can re-open it with its attachment tiles intact. The round-trip is
 *  lossless — re-sending an untouched message reproduces the same content. */
export function parseUserDraft(raw: string): ComposerDraft {
  const attachments: ComposerAttachmentDraft[] = [];
  let seq = 0;
  let text = raw.replace(/(!?)\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole: string, bang: string, label: string, target: string) => {
    if (!isPathAttachmentTarget(target)) {
      return whole;
    }
    seq += 1;
    const isImage = bang === "!" || isMessageImageTarget(target);
    attachments.push({
      id: `edit-att-${seq}`,
      name: unescapeMarkdownLabel(label),
      type: isImage ? "image/*" : "application/octet-stream",
      content: "",
      size: 0,
      lastModified: 0,
      path: target,
    });
    return "";
  });
  text = text.replace(/<attachment\s+name="([^"]*)"(?:\s+type="([^"]*)")?[^>]*>([\s\S]*?)<\/attachment>/g, (_match, name: string, type: string | undefined, content: string) => {
    seq += 1;
    const inner = content.replace(/^\n/, "").replace(/\n$/, "");
    attachments.push({
      id: `edit-att-${seq}`,
      name: unescapeXml(name),
      type: type ? unescapeXml(type) : "text/plain",
      content: inner,
      size: inner.length,
      lastModified: 0,
    });
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
