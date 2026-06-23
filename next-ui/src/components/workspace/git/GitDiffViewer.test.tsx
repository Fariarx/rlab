import { ThemeProvider } from "@mui/material/styles";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n/I18nProvider";
import { appTheme } from "../../../theme/app-theme";
import { ComposerSharedProvider, type ComposerSharedProps } from "../../agent/composer/composer-shared-context";
import type { ReviewCommentEntry } from "../../agent/core/types";
import { GitDiffLines, type DiffViewerLine } from "./GitDiffViewer";

function renderGitDiffLines({
  lines,
  composerShared,
  comments = [],
  onAddComment = vi.fn(),
  onInputActivityChange,
}: {
  readonly lines: readonly DiffViewerLine[];
  readonly composerShared?: ComposerSharedProps;
  readonly comments?: readonly ReviewCommentEntry[];
  readonly onAddComment?: (line: number, lineText: string, body: string) => void;
  readonly onInputActivityChange?: (active: boolean) => void;
}) {
  const node = <GitDiffLines lines={lines} path="src/auth.ts" comments={comments} onAddComment={onAddComment} onInputActivityChange={onInputActivityChange} />;
  render(
    <ThemeProvider theme={appTheme}>
      <I18nProvider locale="ru">
        {composerShared ? <ComposerSharedProvider value={composerShared}>{node}</ComposerSharedProvider> : node}
      </I18nProvider>
    </ThemeProvider>,
  );
  return { onAddComment };
}

describe("GitDiffLines", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds review comments with attachments and voice controls", async () => {
    class FakeSpeechRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      onresult = null;
      onerror = null;
      onend = null;
      start(): void {}
      stop(): void {}
    }
    vi.stubGlobal("SpeechRecognition", FakeSpeechRecognition);
    const lines: readonly DiffViewerLine[] = [{ kind: "add", text: "+needsRefactor" }];
    const { onAddComment } = renderGitDiffLines({
      lines,
      composerShared: {
        onAttachmentError: vi.fn(),
        voiceProvider: { id: "web-speech", name: "Browser Web Speech", kind: "browser", language: "ru-RU", configured: true },
      },
    });

    fireEvent.click(screen.getByText("needsRefactor"));
    const input = await screen.findByTestId("git-comment-input");
    fireEvent.focus(input);

    expect(screen.getByTestId("git-comment-attach-button")).toBeInTheDocument();
    expect(await screen.findByTestId("git-comment-voice-button")).toBeInTheDocument();

    const fileInput = screen.getByTestId("git-comment-file-input");
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(within(await screen.findByTestId("git-comment-attachments")).getByTestId("attachment-tag")).toHaveTextContent("notes.txt");

    fireEvent.change(input, { target: { value: "вынести в хелпер" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(onAddComment).toHaveBeenCalledTimes(1));
    expect(onAddComment).toHaveBeenCalledWith(
      1,
      "needsRefactor",
      "вынести в хелпер\n\n<attachment name=\"notes.txt\" type=\"text/plain\">\nhello\n</attachment>",
    );
  });

  it("keeps git review input activity active while dictation is running", async () => {
    class FakeSpeechRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      onresult = null;
      onerror = null;
      onend = null;
      start(): void {}
      stop(): void {}
    }
    vi.stubGlobal("SpeechRecognition", FakeSpeechRecognition);
    const onInputActivityChange = vi.fn();
    renderGitDiffLines({
      lines: [{ kind: "add", text: "+needsRefactor" }],
      composerShared: {
        voiceProvider: { id: "web-speech", name: "Browser Web Speech", kind: "browser", language: "ru-RU", configured: true },
      },
      onInputActivityChange,
    });

    fireEvent.click(screen.getByText("needsRefactor"));
    const input = await screen.findByTestId("git-comment-input");
    fireEvent.focus(input);
    await waitFor(() => expect(onInputActivityChange).toHaveBeenLastCalledWith(true));

    const voiceButton = await screen.findByTestId("git-comment-voice-button");
    const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    fireEvent(voiceButton, mouseDown);
    expect(mouseDown.defaultPrevented).toBe(true);
    fireEvent.click(voiceButton);
    await waitFor(() => expect(onInputActivityChange).toHaveBeenLastCalledWith(true));

    fireEvent.blur(input);
    expect(onInputActivityChange).toHaveBeenLastCalledWith(true);
  });

  it("inserts git review dictation at the original caret after browser focus changes", async () => {
    type FakeSpeechResultEvent = {
      readonly resultIndex: number;
      readonly results: {
        readonly length: number;
        readonly 0: { readonly length: number; readonly isFinal: boolean; readonly 0: { readonly transcript: string } };
      };
    };
    class FakeSpeechRecognition {
      static current: FakeSpeechRecognition | null = null;
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: ((event: FakeSpeechResultEvent) => void) | null = null;
      onerror: ((event: { readonly error?: string; readonly message?: string }) => void) | null = null;
      onend: (() => void) | null = null;

      constructor() {
        FakeSpeechRecognition.current = this;
      }

      start(): void {}

      stop(): void {
        this.onend?.();
      }

      emitInterim(text: string): void {
        this.onresult?.({
          resultIndex: 0,
          results: {
            length: 1,
            0: { length: 1, isFinal: false, 0: { transcript: text } },
          },
        });
      }
    }
    vi.stubGlobal("SpeechRecognition", FakeSpeechRecognition);
    renderGitDiffLines({
      lines: [{ kind: "add", text: "+needsRefactor" }],
      composerShared: {
        voiceProvider: { id: "web-speech", name: "Browser Web Speech", kind: "browser", language: "ru-RU", configured: true },
      },
    });

    fireEvent.click(screen.getByText("needsRefactor"));
    const input = await screen.findByTestId("git-comment-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "alpha omega" } });
    input.setSelectionRange("alpha ".length, "alpha ".length);

    fireEvent.click(await screen.findByTestId("git-comment-voice-button"));
    await waitFor(() => expect(FakeSpeechRecognition.current).not.toBeNull());

    input.setSelectionRange(input.value.length, input.value.length);
    act(() => {
      FakeSpeechRecognition.current?.emitInterim("ручная остановка");
    });
    fireEvent.click(await screen.findByTestId("git-comment-voice-button"));

    await waitFor(() => expect(input).toHaveValue("alpha ручная остановка omega"));
    await waitFor(() => {
      expect(input.selectionStart).toBe("alpha ручная остановка ".length);
      expect(input.selectionEnd).toBe("alpha ручная остановка ".length);
    });
  });

  it("converts large mobile beforeinput paste in review comments into a text attachment", async () => {
    const lines: readonly DiffViewerLine[] = [{ kind: "add", text: "+needsRefactor" }];
    const { onAddComment } = renderGitDiffLines({ lines });

    fireEvent.click(screen.getByText("needsRefactor"));
    const input = await screen.findByTestId("git-comment-input");
    const pasted = "z".repeat(1501);
    const event = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: pasted,
      inputType: "insertFromPaste",
    });

    fireEvent(input, event);

    expect(event.defaultPrevented).toBe(true);
    expect(input).toHaveValue("");
    expect(within(await screen.findByTestId("git-comment-attachments")).getByTestId("attachment-tag")).toHaveTextContent("pasted-1501.txt");

    fireEvent.change(input, { target: { value: "см. файл" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(onAddComment).toHaveBeenCalledTimes(1));
    expect(onAddComment).toHaveBeenCalledWith(
      1,
      "needsRefactor",
      [
        "см. файл",
        "",
        "<attachment name=\"pasted-1501.txt\" type=\"text/plain\">",
        pasted,
        "</attachment>",
      ].join("\n"),
    );
  });

  it("renders saved review comment attachments as tags", () => {
    renderGitDiffLines({
      lines: [{ kind: "add", text: "+needsRefactor" }],
      comments: [
        {
          id: "comment-1",
          file: "src/auth.ts",
          line: 1,
          lineText: "needsRefactor",
          body: "посмотри файл\n\n<attachment name=\"notes.txt\" type=\"text/plain\">\nhello\n</attachment>",
        },
      ],
    });

    expect(screen.getByText("посмотри файл")).toBeInTheDocument();
    expect(screen.getByTestId("attachment-tag")).toHaveTextContent("notes.txt");
    expect(screen.queryByText(/<attachment/)).not.toBeInTheDocument();
  });
});
