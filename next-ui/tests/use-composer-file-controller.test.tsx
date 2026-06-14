import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, useEffect, useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { type ComposerFileController, type ComposerHandle, useComposerFileController } from "../src/components/agent/composer/use-composer-file-controller";

const Harness = forwardRef<ComposerHandle, {
  readonly addFiles: (files: readonly File[]) => Promise<void>;
  readonly capture?: (controller: ComposerFileController) => void;
}>(function Harness({ addFiles, capture }, ref) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const controller = useComposerFileController({ addFiles, forwardedRef: ref, textareaRef });

  useEffect(() => {
    capture?.(controller);
  }, [capture, controller]);

  return (
    <>
      <input data-testid="file-input" ref={controller.fileInputRef} type="file" multiple onChange={controller.chooseFiles} />
      <textarea data-testid="composer-textarea" ref={textareaRef} />
    </>
  );
});

describe("useComposerFileController", () => {
  it("forwards selected files to the attachment pipeline and clears the input", async () => {
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    const addFiles = vi.fn<(files: readonly File[]) => Promise<void>>(async () => undefined);

    render(<Harness addFiles={addFiles} />);
    const input = screen.getByTestId("file-input") as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(addFiles).toHaveBeenCalledWith([file]));
    expect(input.value).toBe("");
  });

  it("exposes file picker and imperative composer actions", async () => {
    const addFiles = vi.fn<(files: readonly File[]) => Promise<void>>(async () => undefined);
    const handleRef = { current: null as ComposerHandle | null };
    const controller: { current: ComposerFileController | null } = { current: null };

    render(<Harness ref={handleRef} addFiles={addFiles} capture={(next) => { controller.current = next; }} />);
    await waitFor(() => expect(controller.current).not.toBeNull());

    const input = screen.getByTestId("file-input") as HTMLInputElement;
    const click = vi.spyOn(input, "click").mockImplementation(() => undefined);
    controller.current?.openFilePicker();
    expect(click).toHaveBeenCalledTimes(1);

    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    await handleRef.current?.addFiles([file]);
    expect(addFiles).toHaveBeenCalledWith([file]);

    handleRef.current?.focus();
    expect(document.activeElement).toBe(screen.getByTestId("composer-textarea"));
  });
});
