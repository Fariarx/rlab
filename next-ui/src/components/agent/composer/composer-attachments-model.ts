import type { ComposerAttachmentDraft } from "../core/types";
import { attachmentBlock, isImageMime, PASTE_AS_FILE_CHARS } from "./composer-utils";

let pastedFileNameSeq = 0;

export function mergeComposerAttachments(
  existing: readonly ComposerAttachmentDraft[],
  incoming: readonly ComposerAttachmentDraft[],
): ComposerAttachmentDraft[] {
  const seen = new Set(existing.map((item) => item.id));
  return [...existing, ...incoming.filter((item) => !seen.has(item.id))];
}

export function composerSendPayload(text: string, attachments: readonly ComposerAttachmentDraft[]): string {
  return [text.trim(), ...attachments.map(attachmentBlock)].filter(Boolean).join("\n\n");
}

function namedClipboardFile(file: File): File {
  if (file.name) {
    return file;
  }
  const ext = file.type.split("/")[1] || "bin";
  const kind = isImageMime(file.type) ? "image" : "file";
  return new File([file], `pasted-${kind}-${pastedFileNameSeq++}.${ext}`, { type: file.type });
}

export function clipboardFilesForComposer(clipboard: DataTransfer): File[] {
  const rawFiles: File[] = Array.from(clipboard.files ?? []);
  if (rawFiles.length === 0) {
    for (const item of Array.from(clipboard.items ?? [])) {
      if (item.kind !== "file") {
        continue;
      }
      const file = item.getAsFile();
      if (file) {
        rawFiles.push(file);
      }
    }
  }
  return rawFiles.map(namedClipboardFile);
}

export function pastedTextFileForComposer(text: string): File | null {
  return text.length > PASTE_AS_FILE_CHARS ? new File([text], `pasted-${text.length}.txt`, { type: "text/plain" }) : null;
}
