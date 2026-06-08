import type { ChatMessage } from "../components/agent/types";

export type ResourceKind = "image" | "link" | "file";

/** A file, link, or image referenced somewhere in a conversation thread. */
export interface ConversationResource {
  readonly id: string;
  readonly kind: ResourceKind;
  /** href for link/image resources, path for file resources. */
  readonly url: string;
  readonly label: string;
  readonly time?: string;
  readonly origin: "user" | "agent";
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?|#|$)/i;
const HTTPISH = /^(https?:)?\/\//i;
const DOMAINISH = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$|#|\?)/i;
const FILE_EXT = /\.[a-z0-9]{1,8}$/i;

function isImageUrl(value: string): boolean {
  return IMAGE_EXT.test(value);
}

function isHttpish(value: string): boolean {
  return HTTPISH.test(value) || DOMAINISH.test(value);
}

function looksLikeFilePath(value: string): boolean {
  return !isHttpish(value) && (/[\\/]/.test(value) || FILE_EXT.test(value));
}

function classify(value: string): ResourceKind | null {
  if (isImageUrl(value)) {
    return "image";
  }
  if (isHttpish(value)) {
    return "link";
  }
  if (looksLikeFilePath(value)) {
    return "file";
  }
  return null;
}

function fileLabel(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

/** Accumulates resources while keeping their first (chronological) appearance. */
class ResourceCollector {
  private readonly seen = new Set<string>();
  private seq = 0;
  readonly items: ConversationResource[] = [];

  add(kind: ResourceKind, url: string, label: string, origin: "user" | "agent", time?: string): void {
    const trimmed = url.trim();
    if (!trimmed) {
      return;
    }
    const key = `${kind}:${trimmed}`;
    if (this.seen.has(key)) {
      return;
    }
    this.seen.add(key);
    this.items.push({ id: `res-${++this.seq}`, kind, url: trimmed, label: label.trim() || fileLabel(trimmed), origin, time });
  }

  /** Adds a value by inferring its kind; forces image when from `![]()` syntax. */
  addInferred(url: string, label: string, origin: "user" | "agent", time?: string, forceImage = false): void {
    const kind = forceImage ? "image" : classify(url);
    if (kind) {
      this.add(kind, url, label, origin, time);
    }
  }
}

const MD_IMAGE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
const MD_LINK = /(?<!!)\[([^\]]+)\]\(([^)\s]+)\)/g;
const BARE_URL = /\bhttps?:\/\/[^\s<>()]+/g;
const ATTACHMENT = /<attachment\s+name="([^"]*)"[^>]*>/g;

function harvestText(text: string, origin: "user" | "agent", time: string | undefined, out: ResourceCollector): void {
  for (const match of text.matchAll(ATTACHMENT)) {
    const name = match[1] ?? "";
    out.add(looksLikeFilePath(name) || FILE_EXT.test(name) ? "file" : "file", name, name, origin, time);
  }
  for (const match of text.matchAll(MD_IMAGE)) {
    out.addInferred(match[2] ?? "", match[1] ?? "", origin, time, true);
  }
  for (const match of text.matchAll(MD_LINK)) {
    out.addInferred(match[2] ?? "", match[1] ?? "", origin, time);
  }
  for (const match of text.matchAll(BARE_URL)) {
    out.addInferred(match[0], match[0], origin, time);
  }
}

/**
 * Walks a thread in order and returns the files, links, and images it mentions —
 * the raw resources, not the agent's actions on them (tool output, commands, and
 * code bodies are intentionally skipped).
 */
export function collectResources(messages: readonly ChatMessage[]): readonly ConversationResource[] {
  const out = new ResourceCollector();
  for (const message of messages) {
    const origin = message.role;
    const time = message.time;
    if (message.text) {
      harvestText(message.text, origin, time, out);
    }
    for (const block of message.blocks ?? []) {
      switch (block.kind) {
        case "text":
          // Skip narration text (inside the reasoning container); only harvest result text.
          if (block.result !== false) {
            harvestText(block.text, origin, time, out);
          }
          break;
        case "diff":
          out.add("file", block.file, fileLabel(block.file), origin, time);
          break;
        case "search":
          for (const result of block.results) {
            out.addInferred(result.url, result.title, origin, time);
          }
          break;
        case "citation":
          for (const source of block.sources) {
            out.addInferred(source.url, source.label, origin, time);
          }
          break;
        default:
          break;
      }
    }
  }
  return out.items;
}
