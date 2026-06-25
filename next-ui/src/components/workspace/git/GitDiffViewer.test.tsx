import { ThemeProvider } from "@mui/material/styles";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n/I18nProvider";
import { appTheme } from "../../../theme/app-theme";
import { ComposerSharedProvider, type ComposerSharedProps } from "../../agent/composer/composer-shared-context";
import type { ReviewCommentAnchor, ReviewCommentEntry } from "../../agent/core/types";
import { GitDiffLines, gitDiffViewerLinesFromUnified, reviewCommentAnchorForLine, type DiffViewerLine } from "./GitDiffViewer";
import type { GitDiffContextDirection } from "./use-git-file-diff";

function renderGitDiffLines({
  lines,
  composerShared,
  comments = [],
  oldLineCount,
  newLineCount,
  onAddComment = vi.fn(),
  onExpandContext,
  onInputActivityChange,
}: {
  readonly lines: readonly DiffViewerLine[];
  readonly composerShared?: ComposerSharedProps;
  readonly comments?: readonly ReviewCommentEntry[];
  readonly oldLineCount?: number;
  readonly newLineCount?: number;
  readonly onAddComment?: (anchor: ReviewCommentAnchor, body: string) => void;
  readonly onExpandContext?: (direction: GitDiffContextDirection) => void;
  readonly onInputActivityChange?: (active: boolean) => void;
}) {
  const node = (
    <GitDiffLines
      lines={lines}
      path="src/auth.ts"
      oldLineCount={oldLineCount}
      newLineCount={newLineCount}
      comments={comments}
      onAddComment={onAddComment}
      onExpandContext={onExpandContext}
      onInputActivityChange={onInputActivityChange}
    />
  );
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

  it("builds compact review anchors with hunk and nearby diff context", () => {
    const anchor = reviewCommentAnchorForLine(
      [
        { kind: "meta", text: "@@ -10,6 +10,7 @@ function auth()" },
        { kind: "ctx", text: " const keep = true;" },
        { kind: "del", text: "-oldCall();" },
        { kind: "add", text: "+newCall();" },
        { kind: "ctx", text: " return keep;" },
      ],
      4,
    );

    expect(anchor).toEqual({
      line: 4,
      lineText: "newCall();",
      diffLine: "+newCall();",
      hunkHeader: "@@ -10,6 +10,7 @@ function auth()",
      diffContext: ["2:  const keep = true;", "3: -oldCall();", "4: +newCall();", "5:  return keep;"],
    });
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
      {
        line: 1,
        lineText: "needsRefactor",
        diffLine: "+needsRefactor",
        diffContext: ["1: +needsRefactor"],
      },
      "вынести в хелпер\n\n<attachment name=\"notes.txt\" type=\"text/plain\">\nhello\n</attachment>",
    );
  });

  it("renders context expansion controls on expandable hunk edges", () => {
    const onExpandContext = vi.fn<(direction: GitDiffContextDirection) => void>();
    renderGitDiffLines({
      lines: gitDiffViewerLinesFromUnified("@@ -21,4 +21,4 @@\n before\n-old\n+new\n after"),
      oldLineCount: 80,
      newLineCount: 80,
      onExpandContext,
    });

    fireEvent.click(screen.getByRole("button", { name: "Показать 20 строк выше" }));
    expect(onExpandContext).toHaveBeenLastCalledWith("before");

    fireEvent.click(screen.getByRole("button", { name: "Показать 20 строк ниже" }));
    expect(onExpandContext).toHaveBeenLastCalledWith("after");
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
      {
        line: 1,
        lineText: "needsRefactor",
        diffLine: "+needsRefactor",
        diffContext: ["1: +needsRefactor"],
      },
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
