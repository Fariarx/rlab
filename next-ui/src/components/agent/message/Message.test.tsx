import { ThemeProvider } from "@mui/material/styles";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n/I18nProvider";
import { appTheme } from "../../../theme/app-theme";
import { ComposerSharedProvider, type ComposerSharedProps } from "../composer/composer-shared-context";
import { InlineDraftEditor } from "../composer/InlineDraftEditor";
import { VOICE_IDLE_LEVELS } from "../composer/ComposerVoice";
import { ComposerStore } from "../composer/composer-store";
import { Message, type MessageDisplayPrefs } from "./Message";
import type { ChatMessage } from "../core/types";
import { ToastProvider } from "../../ui";

function renderMessage(
  message: ChatMessage,
  actions?: Parameters<typeof Message>[0]["actions"],
  agentProfile?: Parameters<typeof Message>[0]["agentProfile"],
  displayPrefs?: MessageDisplayPrefs,
  composerShared?: ComposerSharedProps,
) {
  const node = <Message message={message} actions={actions} agentProfile={agentProfile} displayPrefs={displayPrefs} />;
  return render(
    <ThemeProvider theme={appTheme}>
      <I18nProvider locale="ru">
        <ToastProvider>{composerShared ? <ComposerSharedProvider value={composerShared}>{node}</ComposerSharedProvider> : node}</ToastProvider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

describe("Message", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders retry action for agent messages", () => {
    const onRetry = vi.fn();
    const message: ChatMessage = {
      id: "agent-1",
      role: "agent",
      blocks: [{ kind: "text", text: "Готово" }],
    };

    renderMessage(message, { onRetry });

    fireEvent.click(screen.getByRole("button", { name: "Повторить сообщение" }));

    expect(onRetry).toHaveBeenCalledWith(message);
  });

  it("renders fork action for agent messages", () => {
    const onFork = vi.fn();
    const message: ChatMessage = {
      id: "agent-fork",
      role: "agent",
      blocks: [{ kind: "text", text: "Готово" }],
    };

    renderMessage(message, { onFork });

    fireEvent.click(screen.getByRole("button", { name: "Форкнуть диалог" }));

    expect(onFork).toHaveBeenCalledWith(message);
  });

  it("renders persisted AM/PM message times as 24-hour labels", () => {
    const message: ChatMessage = {
      id: "agent-time",
      role: "agent",
      time: "03:19 PM",
      blocks: [{ kind: "text", text: "Готово" }],
    };

    renderMessage(message);

    expect(screen.getByText("15:19")).toBeInTheDocument();
    expect(screen.queryByText("03:19 PM")).not.toBeInTheDocument();
  });

  it("renders rlab tool tokens as inline tool links", () => {
    renderMessage({ id: "user-plugin-link", role: "user", text: "$TaskAwaiter что это" });

    const link = screen.getByRole("link", { name: "TaskAwaiter" });
    expect(link).toHaveAttribute("href", "rlab-tool:TaskAwaiter");
  });

  it("collapses structured TaskGoal user prompts", () => {
    renderMessage({
      id: "user-goal",
      role: "user",
      text: [
        '🎯 <rlab-task-goal id="goal-123">',
        "<summary>TaskGoal queue item.</summary>",
        "<description>Проверять очередь до зелёного состояния</description>",
        '<instructions>Work on this standing goal. When it is achieved, call TaskGoal with action="complete" and goalId="goal-123".</instructions>',
        "</rlab-task-goal>",
      ].join("\n"),
    });

    expect(screen.getByTestId("task-goal-user-message")).toHaveTextContent("Цель");
    expect(screen.getByTestId("task-goal-user-message")).toHaveTextContent("Проверять очередь до зелёного состояния");
    expect(screen.getByTestId("task-goal-user-message")).not.toHaveTextContent("goal-123");
    expect(screen.getByTestId("task-goal-user-message")).not.toHaveTextContent("Служебное описание TaskGoal скрыто");
    expect(screen.queryByText(/TaskGoal with action="complete"/)).not.toBeInTheDocument();
  });

  it("collapses structured TaskTracker user prompts", () => {
    renderMessage({
      id: "user-tracker",
      role: "user",
      text: [
        '📋 <rlab-task-tracker id="tracker-123">',
        "<summary>TaskTracker queue item.</summary>",
        "<title>Release checklist</title>",
        "<tasks>",
        '<task id="task-1">Проверить очередь</task>',
        '<task id="task-2">Обновить тесты</task>',
        "</tasks>",
        '<instructions>Work on these open tasks. When a task is done, call TaskTracker with action="complete".</instructions>',
        "</rlab-task-tracker>",
      ].join("\n"),
    });

    const card = screen.getByTestId("task-tracker-user-message");
    expect(card).toHaveTextContent("Трекер задач");
    expect(card).toHaveTextContent("Release checklist");
    expect(card).toHaveTextContent("Проверить очередь");
    expect(card).toHaveTextContent("Обновить тесты");
    expect(card).not.toHaveTextContent("tracker-123");
    expect(card).not.toHaveTextContent("task-1");
    expect(screen.queryByText(/TaskTracker with action="complete"/)).not.toBeInTheDocument();
  });

  it("collapses legacy TaskGoal user prompts", () => {
    renderMessage({
      id: "user-goal-legacy",
      role: "user",
      text: "🎯 TaskGoal queue item (id: goal-old). Work on this standing goal. When it is achieved, call TaskGoal with action='complete' for this id; to cancel it, call TaskGoal with action='remove'. Goal: Проверять старую цель",
    });

    expect(screen.getByTestId("task-goal-user-message")).toHaveTextContent("Проверять старую цель");
    expect(screen.queryByText(/Work on this standing goal/)).not.toBeInTheDocument();
  });

  it("edits user messages with a lightweight multiline editor instead of mounting the dock composer", async () => {
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
    const onEditAndResend = vi.fn();
    const message: ChatMessage = {
      id: "user-edit",
      role: "user",
      text: "original\n\n<attachment name=\"notes.txt\" type=\"text/plain\">\nhello\n</attachment>",
    };

    renderMessage(
      message,
      { onEditAndResend },
      undefined,
      undefined,
      {
        onAttachmentError: vi.fn(),
        voiceProvider: { id: "web-speech", name: "Browser Web Speech", kind: "browser", language: "ru-RU", configured: true },
      },
    );

    fireEvent.click(screen.getByRole("button", { name: "Изменить и отправить" }));
    const input = screen.getByTestId("message-edit-input");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "updated" } });

    expect(screen.queryByTestId("composer-input")).not.toBeInTheDocument();
    expect(screen.getByTestId("message-edit-attach-button")).toBeInTheDocument();
    expect(await screen.findByTestId("message-edit-voice-button")).toBeInTheDocument();
    expect(within(screen.getByTestId("message-edit-attachments")).getByTestId("attachment-tag")).toHaveTextContent("notes.txt");

    fireEvent.click(screen.getByRole("button", { name: "Отправить изменённое сообщение" }));

    await waitFor(() => expect(onEditAndResend).toHaveBeenCalledWith(message, "updated\n\n<attachment name=\"notes.txt\" type=\"text/plain\">\nhello\n</attachment>"));
  });

  it("keeps inline edit dictation in the store across editor remounts", async () => {
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
    const editorStore = new ComposerStore("", [], VOICE_IDLE_LEVELS);
    const onInputActivityChange = vi.fn();
    const onSubmit = vi.fn();
    const shared: ComposerSharedProps = {
      voiceProvider: { id: "web-speech", name: "Browser Web Speech", kind: "browser", language: "ru-RU", configured: true },
    };
    const renderEditor = (key: string) => (
      <ThemeProvider theme={appTheme}>
        <I18nProvider locale="ru">
          <ComposerSharedProvider value={shared}>
            <InlineDraftEditor
              key={key}
              ariaLabel="Редактировать"
              submitLabel="Отправить"
              onSubmit={onSubmit}
              onInputActivityChange={onInputActivityChange}
              testIdPrefix="message-edit"
              store={editorStore}
            />
          </ComposerSharedProvider>
        </I18nProvider>
      </ThemeProvider>
    );

    const view = render(renderEditor("before-remount"));
    fireEvent.click(await screen.findByTestId("message-edit-voice-button"));
    await waitFor(() => expect(FakeSpeechRecognition.current).not.toBeNull());
    await waitFor(() => expect(editorStore.voiceState).toBe("recording"));
    onInputActivityChange.mockClear();

    act(() => {
      FakeSpeechRecognition.current?.emitInterim("текст голосом");
    });
    view.rerender(renderEditor("after-remount"));

    expect(onInputActivityChange.mock.calls.some(([active]) => active === false)).toBe(false);

    fireEvent.click(await screen.findByTestId("message-edit-voice-button"));

    await waitFor(() => expect(screen.getByTestId("message-edit-input")).toHaveValue("текст голосом"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders bare urls in user messages as links", () => {
    renderMessage({
      id: "user-links",
      role: "user",
      text: "Ссылки:\nhttps://github.com/MiniMax-AI/MSA\nhttps://huggingface.co/blog/AtlasCloud-AI/minimax-goes-sparse",
    });

    expect(screen.getByRole("link", { name: "https://github.com/MiniMax-AI/MSA" })).toHaveAttribute("href", "https://github.com/MiniMax-AI/MSA");
    expect(screen.getByRole("link", { name: "https://huggingface.co/blog/AtlasCloud-AI/minimax-goes-sparse" })).toHaveAttribute(
      "href",
      "https://huggingface.co/blog/AtlasCloud-AI/minimax-goes-sparse",
    );
  });

  it("shows real elapsed time for an empty live agent message", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:07.000Z"));
    const message: ChatMessage = {
      id: "agent-live-empty",
      role: "agent",
      startedAtMs: new Date("2026-06-10T12:00:00.000Z").getTime(),
      blocks: [],
    };

    renderMessage(message);

    expect(screen.getByText("7с")).toBeInTheDocument();
  });

  it("keeps live thinking dots and elapsed time only in the details header", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:07.000Z"));
    const message: ChatMessage = {
      id: "agent-live-reasoning",
      role: "agent",
      startedAtMs: new Date("2026-06-10T12:00:00.000Z").getTime(),
      blocks: [{ kind: "reasoning", text: "Проверяю контекст", active: true, startedAtMs: new Date("2026-06-10T12:00:00.000Z").getTime() }],
    };

    renderMessage(message);

    expect(screen.getAllByText("7с")).toHaveLength(1);
    expect(within(screen.getByTestId("agent-details-body")).queryByText("7с")).not.toBeInTheDocument();
  });

  it("collapses heavy live details once user input cards are visible", () => {
    const message: ChatMessage = {
      id: "agent-live-options",
      role: "agent",
      blocks: [
        { kind: "reasoning", text: "Проверяю контекст", active: true },
        { kind: "tool", name: "Read", summary: "huge-file.md", state: "ok", output: "very large tool output" },
        {
          kind: "options",
          id: "question-1",
          prompt: "Что выбрать?",
          options: [{ id: "A", label: "A", description: "Первый вариант" }],
        },
      ],
    };

    renderMessage(message);

    expect(screen.getByRole("button", { name: /размышление/i })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Что выбрать?")).toBeInTheDocument();
    expect(screen.queryByText("very large tool output")).not.toBeInTheDocument();
  });

  it("does not invent elapsed time when a live start timestamp is missing", () => {
    const message: ChatMessage = {
      id: "agent-live-persisted",
      role: "agent",
      blocks: [],
    };

    renderMessage(message);

    expect(screen.queryByText(/\d+с/)).not.toBeInTheDocument();
  });

  it("renders agent details header as an accessible expandable button", () => {
    const message: ChatMessage = {
      id: "agent-2",
      role: "agent",
      blocks: [{ kind: "reasoning", text: "Проверяю контекст", duration: "2s" }],
    };

    renderMessage(message);

    const disclosure = screen.getByRole("button", { name: /размышление/i });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(disclosure);

    expect(disclosure).toHaveAttribute("aria-expanded", "true");
  });

  it("surfaces a persisted trailing result:false text block as the completed answer", () => {
    const message: ChatMessage = {
      id: "agent-persisted-result",
      role: "agent",
      blocks: [
        { kind: "text", text: "Сначала проверю файлы", result: false },
        { kind: "tool", name: "Shell", summary: "git status", state: "ok", output: "" },
        { kind: "text", text: "Финальный ответ", result: false },
      ],
    };

    renderMessage(message);

    expect(screen.getByText("Финальный ответ")).toBeInTheDocument();
    expect(screen.queryByText("Сначала проверю файлы")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /размышление/i })).toHaveAttribute("aria-expanded", "false");
  });

  it("surfaces only the last terminal warning when a completed agent turn has no answer output", () => {
    const message: ChatMessage = {
      id: "agent-warning-only",
      role: "agent",
      blocks: [
        { kind: "reasoning", text: "Проверяю контекст", duration: "16m 42s" },
        { kind: "status", level: "warn", text: "api retry · overloaded #1" },
        { kind: "status", level: "warn", text: "api retry · overloaded #2" },
      ],
    };

    renderMessage(message);

    const disclosure = screen.getByRole("button", { name: /размышление/i });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    const terminalWarning = screen.getByText("api retry · overloaded #2").closest("[data-testid='status-note']");
    expect(terminalWarning).toBeInTheDocument();
    expect(terminalWarning).toHaveStyle({ display: "inline-flex", width: "fit-content", alignSelf: "flex-start" });
    expect(screen.queryByText("api retry · overloaded #1")).not.toBeInTheDocument();
  });

  it("does not surface a terminal warning when it is followed by another reasoning event", () => {
    const message: ChatMessage = {
      id: "agent-warning-not-last",
      role: "agent",
      blocks: [
        { kind: "reasoning", text: "Проверяю контекст", duration: "2s" },
        { kind: "status", level: "warn", text: "api retry · overloaded" },
        { kind: "reasoning", text: "Продолжаю после ретрая", duration: "1s" },
      ],
    };

    renderMessage(message);

    expect(screen.getByRole("button", { name: /размышление/i })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("api retry · overloaded")).not.toBeInTheDocument();
  });

  it("keeps terminal warnings folded when the completed agent turn already has answer output", () => {
    const message: ChatMessage = {
      id: "agent-answer-with-warning",
      role: "agent",
      blocks: [
        { kind: "reasoning", text: "Проверяю контекст", duration: "2s" },
        { kind: "text", text: "Готово" },
        { kind: "status", level: "warn", text: "api retry · overloaded" },
      ],
    };

    renderMessage(message);

    expect(screen.getByText("Готово")).toBeInTheDocument();
    expect(screen.queryByText("api retry · overloaded")).not.toBeInTheDocument();
  });

  it("surfaces a canceled-run warning instead of promoting partial text to an answer", () => {
    const message: ChatMessage = {
      id: "agent-canceled",
      role: "agent",
      blocks: [
        { kind: "reasoning", text: "Проверяю контекст", duration: "2с" },
        { kind: "text", text: "Последнее промежуточное рассуждение", result: false },
        { kind: "status", level: "warn", text: "Запуск остановлен", surface: true },
      ],
    };

    renderMessage(message);

    expect(screen.getByText("Запуск остановлен")).toBeInTheDocument();
    expect(screen.queryByText("Последнее промежуточное рассуждение")).not.toBeInTheDocument();
  });

  it("does not surface terminal warnings while reasoning is still active", () => {
    const message: ChatMessage = {
      id: "agent-live-warning",
      role: "agent",
      blocks: [
        { kind: "reasoning", text: "Проверяю контекст", active: true },
        { kind: "status", level: "warn", text: "api retry · overloaded" },
      ],
    };

    renderMessage(message, undefined, undefined, { reasoningAutoExpand: false });

    expect(screen.queryByText("api retry · overloaded")).not.toBeInTheDocument();
  });

  it("collapses changed files by default and summarizes their diff totals", () => {
    const message: ChatMessage = {
      id: "agent-diff-summary",
      role: "agent",
      blocks: [
        { kind: "text", text: "Готово" },
        { kind: "diff", file: "src/added.ts", additions: 10, deletions: 0, lines: [{ type: "add", text: "export const added = true;" }] },
        { kind: "diff", file: "src/removed.ts", additions: 0, deletions: 10, lines: [{ type: "del", text: "export const removed = true;" }] },
      ],
    };

    renderMessage(message);

    const disclosure = screen.getByRole("button", { name: /изменённые файлы/i });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(within(disclosure).getByText("2 файлов")).toBeInTheDocument();
    expect(within(disclosure).getByText("+10")).toBeInTheDocument();
    expect(within(disclosure).getByText("−10")).toBeInTheDocument();
    expect(screen.queryByText((content) => content.includes("src/added.ts"))).not.toBeInTheDocument();
    expect(screen.getByTestId("changed-files-accordion")).toBeInTheDocument();

    fireEvent.click(disclosure);

    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText((content) => content.includes("src/added.ts"))).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes("src/removed.ts"))).toBeInTheDocument();
  });

  it("keeps the agent details header sticky while expanded", () => {
    const message: ChatMessage = {
      id: "agent-sticky",
      role: "agent",
      blocks: [{ kind: "reasoning", text: "Проверяю контекст", duration: "2s" }],
    };

    renderMessage(message);

    expect(screen.getByRole("button", { name: /размышление/i })).toHaveStyle({ position: "sticky", top: "0px" });
  });

  it("keeps nested tool headers flush to the reasoning container when sticky", () => {
    const message: ChatMessage = {
      id: "agent-tool-sticky",
      role: "agent",
      blocks: [
        { kind: "reasoning", text: "Проверяю контекст", duration: "2s" },
        { kind: "command", command: "echo ok", output: "ok", state: "ok" },
      ],
    };

    renderMessage(message);

    fireEvent.click(screen.getByRole("button", { name: /размышление/i }));

    expect(screen.getByTestId("agent-details-body")).toHaveStyle("--agent-sticky-top: 0px");
    expect(screen.getByText("echo ok")).toBeInTheDocument();
  });

  it("archives a completed plan into agent details after a short delay", () => {
    vi.useFakeTimers();
    const message: ChatMessage = {
      id: "agent-plan",
      role: "agent",
      blocks: [
        { kind: "reasoning", text: "Собрал план", duration: "1s" },
        { kind: "plan", steps: [{ label: "Проверить sticky", state: "ok" }] },
      ],
    };

    renderMessage(message);

    expect(screen.getByText("Plan")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.queryByText("Plan")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /размышление/i }));

    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("Проверить sticky")).toBeInTheDocument();
  });

  it("moves resolved option prompts into agent details", () => {
    const message: ChatMessage = {
      id: "agent-options",
      role: "agent",
      blocks: [
        {
          kind: "options",
          id: "question-1",
          prompt: "Как форматировать ответ?",
          options: [
            { id: "Summary", label: "Summary" },
            { id: "Detailed", label: "Detailed" },
          ],
          selected: ["Summary"],
        },
      ],
    };

    renderMessage(message);

    expect(screen.queryByText("Как форматировать ответ?")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /размышление/i }));

    expect(screen.getByText("Как форматировать ответ?")).toBeInTheDocument();
    expect(screen.getByText("Выбрано: Summary")).toBeInTheDocument();
    // Archived prompts collapse to a one-line recap: the chosen label survives
    // inside the summary, but the unselected options are no longer rendered.
    expect(screen.queryByText("Detailed")).not.toBeInTheDocument();
  });

  it("shows the agent model next to the agent label", () => {
    const message: ChatMessage = {
      id: "agent-3",
      role: "agent",
      blocks: [{ kind: "text", text: "Готово" }],
    };

    renderMessage(message, undefined, { agent: "codex", model: "gpt-5.5", reasoning: "default", mode: "default" });

    expect(screen.getByText("Агент")).toBeInTheDocument();
    expect(screen.getByText("codex/gpt-5.5")).toBeInTheDocument();
  });

  it("renders read-only image tool calls as openable images instead of tool cards", () => {
    const imagePath = "C:\\tmp\\picked-element.png";
    const message: ChatMessage = {
      id: "agent-image-read",
      role: "agent",
      blocks: [{ kind: "tool", name: "Read", summary: imagePath, args: { path: imagePath }, state: "ok", output: "image bytes" }],
    };

    renderMessage(message);

    expect(screen.queryByText("Read")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "picked-element.png" })).toHaveAttribute("src", `/api/local-file?path=${encodeURIComponent(imagePath)}`);

    fireEvent.click(screen.getByRole("button", { name: "picked-element.png" }));

    expect(screen.getAllByRole("img", { name: "picked-element.png" })).toHaveLength(2);
  });

  it("keeps long unbroken agent text inside the message column", () => {
    const longToken = "x".repeat(180);
    const message: ChatMessage = {
      id: "agent-long-line",
      role: "agent",
      blocks: [{ kind: "text", text: `prefix ${longToken} suffix` }],
    };

    renderMessage(message);

    const paragraph = screen.getByText(`prefix ${longToken} suffix`);
    expect(paragraph).toHaveStyle({ overflowWrap: "anywhere", wordBreak: "break-word", maxWidth: "100%" });
  });

  it("keeps long code blocks scrolling inside their own frame", () => {
    const longCode = `const token = "${"x".repeat(180)}";`;
    const message: ChatMessage = {
      id: "agent-long-code",
      role: "agent",
      blocks: [{ kind: "text", text: `\`\`\`ts\n${longCode}\n\`\`\`` }],
    };

    renderMessage(message);

    const codeBlock = screen.getByText(longCode);
    expect(codeBlock).toHaveStyle({ overflow: "auto", maxWidth: "100%" });
  });
});
