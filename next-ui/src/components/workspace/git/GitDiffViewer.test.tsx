import { ThemeProvider } from "@mui/material/styles";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
}: {
  readonly lines: readonly DiffViewerLine[];
  readonly composerShared?: ComposerSharedProps;
  readonly comments?: readonly ReviewCommentEntry[];
  readonly onAddComment?: (line: number, lineText: string, body: string) => void;
}) {
  const node = <GitDiffLines lines={lines} path="src/auth.ts" comments={comments} onAddComment={onAddComment} />;
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
