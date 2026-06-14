import { describe, expect, it } from "vitest";
import type { ComposerAttachmentDraft } from "../src/components/agent";
import { clipboardFilesForComposer, composerSendPayload, mergeComposerAttachments, pastedTextFileForComposer } from "../src/components/agent/composer/composer-attachments-model";

function attachment(id: string, patch: Partial<ComposerAttachmentDraft> = {}): ComposerAttachmentDraft {
  return {
    id,
    name: `${id}.txt`,
    type: "text/plain",
    content: id,
    size: id.length,
    lastModified: 1,
    ...patch,
  };
}

function clipboardData(files: readonly File[], itemFiles: readonly File[] = [], text = ""): DataTransfer {
  return {
    files,
    items: itemFiles.map((file) => ({
      kind: "file",
      getAsFile: () => file,
    })),
    getData: (type: string) => (type === "text/plain" ? text : ""),
  } as unknown as DataTransfer;
}

describe("composer-attachments-model", () => {
  it("merges incoming attachments without duplicating existing ids", () => {
    expect(mergeComposerAttachments([attachment("a"), attachment("b")], [attachment("b", { content: "new" }), attachment("c")]).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("builds the send payload from text and serialized attachments", () => {
    expect(composerSendPayload(" hello ", [attachment("notes", { name: "notes.txt", content: "body" })])).toBe(
      'hello\n\n<attachment name="notes.txt" type="text/plain">\nbody\n</attachment>',
    );
    expect(composerSendPayload("   ", [attachment("notes", { content: "body" })])).toBe(
      '<attachment name="notes.txt" type="text/plain">\nbody\n</attachment>',
    );
  });

  it("uses clipboard files before clipboard items to avoid duplicate pasted files", () => {
    const direct = new File(["direct"], "direct.txt", { type: "text/plain" });
    const duplicate = new File(["duplicate"], "duplicate.txt", { type: "text/plain" });

    expect(clipboardFilesForComposer(clipboardData([direct], [duplicate]))).toEqual([direct]);
    expect(clipboardFilesForComposer(clipboardData([], [duplicate]))).toEqual([duplicate]);
  });

  it("names anonymous pasted files and converts long pasted text into a file", async () => {
    const anonymousImage = new File(["png"], "", { type: "image/png" });
    const [file] = clipboardFilesForComposer(clipboardData([anonymousImage]));

    expect(file?.name).toMatch(/^pasted-image-\d+\.png$/);
    expect(file?.type).toBe("image/png");

    expect(pastedTextFileForComposer("short")).toBeNull();
    const longText = "x".repeat(1501);
    const textFile = pastedTextFileForComposer(longText);
    expect(textFile?.name).toBe("pasted-1501.txt");
    expect(await textFile?.text()).toBe(longText);
  });
});
