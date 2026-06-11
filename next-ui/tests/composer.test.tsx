import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer, type ComposerHandle } from "../src/components/agent";
import { voiceLevelCountFromWidth, voiceLevelsFromTimeDomainData } from "../src/components/agent/Composer";
import { renderWithTheme } from "./util/render-with-theme";

const originalMediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");

function installVoiceCaptureMocks(): void {
  const stream = {
    getTracks: () => [{ stop: vi.fn() }],
  } as unknown as MediaStream;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  });
  class FakeAudioContext {
    state: AudioContextState = "running";

    createAnalyser(): AnalyserNode {
      return {
        fftSize: 1024,
        smoothingTimeConstant: 0.35,
        getByteTimeDomainData: (data: Uint8Array) => data.fill(148),
      } as unknown as AnalyserNode;
    }

    createMediaStreamSource(): MediaStreamAudioSourceNode {
      return { connect: () => undefined } as unknown as MediaStreamAudioSourceNode;
    }

    close(): Promise<void> {
      this.state = "closed";
      return Promise.resolve();
    }
  }
  vi.stubGlobal("AudioContext", FakeAudioContext);
}

describe("Composer", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (originalMediaDevicesDescriptor) {
      Object.defineProperty(navigator, "mediaDevices", originalMediaDevicesDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "mediaDevices");
    }
  });

  it("exposes stable DOM targets for browser bridge agents", () => {
    renderWithTheme(<Composer placeholder="Написать" />);

    expect(screen.getByTestId("composer-bar")).toBeInTheDocument();
    expect(screen.getByTestId("composer-input")).toBe(screen.getByPlaceholderText("Написать"));
    expect(screen.getByTestId("composer-file-input")).toBe(screen.getByLabelText("Выбрать файлы"));
    expect(screen.getByTestId("composer-options-button")).toBe(screen.getByRole("button", { name: /Опции/ }));
    expect(screen.getByTestId("composer-send-button")).toBe(screen.getByRole("button", { name: "Отправить" }));
  });

  it("tracks pointer coordinates for the animated composer border", () => {
    renderWithTheme(<Composer placeholder="Написать" />);

    const bar = screen.getByTestId("composer-bar");
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({
      x: 20,
      y: 30,
      left: 20,
      top: 30,
      right: 220,
      bottom: 70,
      width: 200,
      height: 40,
      toJSON: () => ({}),
    });

    fireEvent.pointerMove(bar, { clientX: 64, clientY: 48 });

    expect(bar.style.getPropertyValue("--composer-border-x")).toBe("44px");
    expect(bar.style.getPropertyValue("--composer-border-y")).toBe("18px");
    expect(bar.style.getPropertyValue("--composer-border-hover-opacity")).toBe("1");

    fireEvent.pointerLeave(bar);

    expect(bar.style.getPropertyValue("--composer-border-hover-opacity")).toBe("0");
  });

  it("hides voice input when no provider is configured", () => {
    renderWithTheme(<Composer placeholder="Написать" />);

    expect(screen.queryByTestId("composer-voice-button")).not.toBeInTheDocument();
  });

  it("shows the agent stop control in the send slot only when a running composer is empty", () => {
    const onStop = vi.fn();

    renderWithTheme(<Composer placeholder="Написать" running onStop={onStop} />);

    expect(screen.getByTestId("composer-stop-button")).toBe(screen.getByRole("button", { name: "Остановить запуск" }));
    expect(screen.queryByTestId("composer-send-button")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("composer-stop-button"));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("keeps the send control visible for queued text while an agent is running", async () => {
    const onSend = vi.fn();
    const onStop = vi.fn();

    renderWithTheme(<Composer placeholder="Написать" running onSend={onSend} onStop={onStop} />);

    fireEvent.change(screen.getByPlaceholderText("Написать"), { target: { value: "follow up" } });

    expect(screen.queryByTestId("composer-stop-button")).not.toBeInTheDocument();
    expect(screen.getByTestId("composer-send-button")).toBeEnabled();
    fireEvent.click(screen.getByTestId("composer-send-button"));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("follow up");
    });
    expect(onStop).not.toHaveBeenCalled();
  });

  it("calculates live voice levels across the full recording strip width", () => {
    const data = new Uint8Array(76);
    data.fill(148);

    const levels = voiceLevelsFromTimeDomainData(data, voiceLevelCountFromWidth(960));

    expect(levels).toHaveLength(160);
    expect(levels.every((level) => level > 0.6)).toBe(true);
  });

  it("dictates through the browser Web Speech provider", async () => {
    class FakeSpeechRecognition {
      static current: FakeSpeechRecognition | null = null;
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: ((event: { readonly resultIndex: number; readonly results: { readonly length: number; readonly 0: { readonly length: number; readonly isFinal: boolean; readonly 0: { readonly transcript: string } } } }) => void) | null = null;
      onerror: ((event: { readonly error?: string; readonly message?: string }) => void) | null = null;
      onend: (() => void) | null = null;

      constructor() {
        FakeSpeechRecognition.current = this;
      }

      start(): void {}

      stop(): void {
        this.onend?.();
      }

      emitFinal(text: string): void {
        this.onresult?.({
          resultIndex: 0,
          results: {
            length: 1,
            0: { length: 1, isFinal: true, 0: { transcript: text } },
          },
        });
        this.onend?.();
      }
    }
    vi.stubGlobal("SpeechRecognition", FakeSpeechRecognition);
    installVoiceCaptureMocks();

    renderWithTheme(
      <Composer
        placeholder="Написать"
        voiceProvider={{ id: "web-speech", name: "Browser Web Speech", kind: "browser", language: "ru-RU", configured: true }}
      />,
    );

    fireEvent.click(await screen.findByTestId("composer-voice-button"));
    await waitFor(() => {
      expect(FakeSpeechRecognition.current).not.toBeNull();
    });
    expect(FakeSpeechRecognition.current?.continuous).toBe(true);
    act(() => {
      FakeSpeechRecognition.current?.emitFinal("привет голосом");
    });

    expect(screen.getByPlaceholderText("Написать")).toHaveValue("привет голосом");
  });

  it("ignores browser speech interim events without spamming no-speech errors", async () => {
    const onVoiceError = vi.fn();
    class FakeSpeechRecognition {
      static current: FakeSpeechRecognition | null = null;
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: ((event: { readonly resultIndex: number; readonly results: { readonly length: number; readonly 0: { readonly length: number; readonly isFinal: boolean; readonly 0: { readonly transcript: string } } } }) => void) | null = null;
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
    installVoiceCaptureMocks();

    renderWithTheme(
      <Composer
        placeholder="Написать"
        onVoiceError={onVoiceError}
        voiceProvider={{ id: "web-speech", name: "Browser Web Speech", kind: "browser", language: "ru-RU", configured: true }}
      />,
    );

    fireEvent.click(await screen.findByTestId("composer-voice-button"));
    await waitFor(() => {
      expect(FakeSpeechRecognition.current).not.toBeNull();
    });
    act(() => {
      FakeSpeechRecognition.current?.emitInterim("п");
      FakeSpeechRecognition.current?.emitInterim("пр");
      FakeSpeechRecognition.current?.emitInterim("");
    });

    expect(onVoiceError).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("Написать")).toHaveValue("");
  });

  it("debounces browser no-speech and suppresses it after recognized speech", async () => {
    const onVoiceError = vi.fn();
    class FakeSpeechRecognition {
      static current: FakeSpeechRecognition | null = null;
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: ((event: { readonly resultIndex: number; readonly results: { readonly length: number; readonly 0: { readonly length: number; readonly isFinal: boolean; readonly 0: { readonly transcript: string } } } }) => void) | null = null;
      onerror: ((event: { readonly error?: string; readonly message?: string }) => void) | null = null;
      onend: (() => void) | null = null;

      constructor() {
        FakeSpeechRecognition.current = this;
      }

      start(): void {}
      stop(): void {
        this.onend?.();
      }

      emitFinal(text: string): void {
        this.onresult?.({
          resultIndex: 0,
          results: {
            length: 1,
            0: { length: 1, isFinal: true, 0: { transcript: text } },
          },
        });
      }
    }
    vi.stubGlobal("SpeechRecognition", FakeSpeechRecognition);
    installVoiceCaptureMocks();

    renderWithTheme(
      <Composer
        placeholder="Написать"
        onVoiceError={onVoiceError}
        voiceProvider={{ id: "web-speech", name: "Browser Web Speech", kind: "browser", language: "ru-RU", configured: true }}
      />,
    );

    fireEvent.click(await screen.findByTestId("composer-voice-button"));
    await waitFor(() => {
      expect(FakeSpeechRecognition.current).not.toBeNull();
    });
    vi.useFakeTimers();
    act(() => {
      FakeSpeechRecognition.current?.onerror?.({ error: "no-speech" });
      FakeSpeechRecognition.current?.onerror?.({ error: "no-speech" });
      vi.advanceTimersByTime(799);
    });
    expect(onVoiceError).not.toHaveBeenCalled();

    act(() => {
      FakeSpeechRecognition.current?.emitFinal("текст");
      vi.advanceTimersByTime(1);
      FakeSpeechRecognition.current?.onerror?.({ error: "no-speech" });
      vi.advanceTimersByTime(900);
    });

    expect(onVoiceError).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("Написать")).toHaveValue("текст");
  });

  it("shows at most one browser no-speech notice per recording", async () => {
    const onVoiceError = vi.fn();
    class FakeSpeechRecognition {
      static current: FakeSpeechRecognition | null = null;
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: ((event: { readonly resultIndex: number; readonly results: { readonly length: number } }) => void) | null = null;
      onerror: ((event: { readonly error?: string; readonly message?: string }) => void) | null = null;
      onend: (() => void) | null = null;

      constructor() {
        FakeSpeechRecognition.current = this;
      }

      start(): void {}
      stop(): void {
        this.onend?.();
      }
    }
    vi.stubGlobal("SpeechRecognition", FakeSpeechRecognition);
    installVoiceCaptureMocks();

    renderWithTheme(
      <Composer
        placeholder="Написать"
        onVoiceError={onVoiceError}
        voiceProvider={{ id: "web-speech", name: "Browser Web Speech", kind: "browser", language: "ru-RU", configured: true }}
      />,
    );

    fireEvent.click(await screen.findByTestId("composer-voice-button"));
    await waitFor(() => {
      expect(FakeSpeechRecognition.current).not.toBeNull();
    });
    vi.useFakeTimers();

    act(() => {
      FakeSpeechRecognition.current?.onerror?.({ error: "no-speech" });
      FakeSpeechRecognition.current?.onerror?.({ error: "no-speech" });
      vi.advanceTimersByTime(800);
      FakeSpeechRecognition.current?.onerror?.({ error: "no-speech" });
      vi.advanceTimersByTime(900);
    });

    expect(onVoiceError).toHaveBeenCalledTimes(1);
    expect(onVoiceError).toHaveBeenCalledWith("Речь не распознана.");
  });

  it("shows the recording strip and hides the send key hint while voice input is active", async () => {
    class FakeSpeechRecognition {
      static current: FakeSpeechRecognition | null = null;
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: ((event: { readonly resultIndex: number; readonly results: { readonly length: number } }) => void) | null = null;
      onerror: ((event: { readonly error?: string; readonly message?: string }) => void) | null = null;
      onend: (() => void) | null = null;

      constructor() {
        FakeSpeechRecognition.current = this;
      }

      start(): void {}
      stop(): void {
        this.onend?.();
      }
    }
    vi.stubGlobal("SpeechRecognition", FakeSpeechRecognition);
    installVoiceCaptureMocks();

    renderWithTheme(
      <Composer
        placeholder="Написать"
        voiceProvider={{ id: "web-speech", name: "Browser Web Speech", kind: "browser", language: "ru-RU", configured: true }}
      />,
    );

    fireEvent.click(await screen.findByTestId("composer-voice-button"));

    expect(await screen.findByTestId("composer-voice-recording-strip")).toBeInTheDocument();
    expect(screen.queryByText("⏎")).not.toBeInTheDocument();
    expect(screen.getByTestId("composer-voice-button")).toHaveStyle({ height: "30px" });
    expect(screen.getByTestId("composer-send-button")).toHaveStyle({ width: "30px", height: "30px", minWidth: "30px" });
  });

  it("shows a manual send-now tile for queued messages", () => {
    const onSendQueuedNow = vi.fn();
    renderWithTheme(<Composer placeholder="Написать" queuedMessageCount={2} onSendQueuedNow={onSendQueuedNow} />);

    fireEvent.click(screen.getByRole("button", { name: "Отправить сейчас · 2" }));

    expect(screen.getByTestId("queued-message-send-now")).toHaveStyle({ width: "76px", height: "76px" });
    expect(onSendQueuedNow).toHaveBeenCalledTimes(1);
  });

  it("sends selected text attachments with the prompt", async () => {
    const onSend = vi.fn();
    renderWithTheme(<Composer placeholder="Написать" onSend={onSend} />);

    const fileInput = screen.getByLabelText("Выбрать файлы");
    const file = new File(["hello from file"], "notes.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.change(screen.getByPlaceholderText("Написать"), { target: { value: "Read this" } });

    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith(
        [
          "Read this",
          "",
          "<attachment name=\"notes.txt\" type=\"text/plain\">",
          "hello from file",
          "</attachment>",
        ].join("\n"),
      );
    });
  });

  it("inserts a mentioned project file into the prompt", () => {
    renderWithTheme(<Composer placeholder="Написать" mentionableFiles={["src/auth.ts", "README.md"]} />);

    fireEvent.change(screen.getByPlaceholderText("Написать"), { target: { value: "Read @" } });
    fireEvent.click(screen.getByRole("option", { name: "src/auth.ts" }));

    expect(screen.getByPlaceholderText("Написать")).toHaveValue("Read @src/auth.ts ");
  });

  it("expands slash commands into working prompts", () => {
    renderWithTheme(<Composer placeholder="Написать" />);

    fireEvent.change(screen.getByPlaceholderText("Написать"), { target: { value: "/" } });
    fireEvent.click(screen.getByRole("option", { name: "/plan" }));

    expect(screen.getByPlaceholderText("Написать")).toHaveValue("Составь план реализации перед изменениями. ");
  });

  it("navigates the suggestion popover with the arrow keys and selects with Enter", () => {
    renderWithTheme(<Composer placeholder="Написать" />);
    const input = screen.getByPlaceholderText("Написать");

    fireEvent.change(input, { target: { value: "/" } });
    // The list opens with the first item active.
    expect(screen.getByRole("option", { name: "/plan" })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "/test" })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("Запусти релевантные тесты и сообщи результат. ");
  });

  it("attaches files handed in by the parent drop zone", async () => {
    const ref = createRef<ComposerHandle>();
    renderWithTheme(<Composer ref={ref} placeholder="Написать" />);

    const file = new File(["payload"], "drop.txt", { type: "text/plain" });
    await act(async () => {
      await ref.current?.addFiles([file]);
    });

    expect(await screen.findByText("drop.txt")).toBeInTheDocument();
  });

  it("dismisses the suggestion popover with Escape without sending", () => {
    const onSend = vi.fn();
    renderWithTheme(<Composer placeholder="Написать" onSend={onSend} />);
    const input = screen.getByPlaceholderText("Написать");

    fireEvent.change(input, { target: { value: "/" } });
    expect(screen.getByRole("listbox", { name: "Подсказки" })).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Подсказки" })).not.toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("lifts the input into an overlay when the text becomes multiline", () => {
    renderWithTheme(<Composer placeholder="Написать" />);
    const area = screen.getByTestId("composer-input-area");
    expect(area).toHaveAttribute("data-expanded", "false");

    fireEvent.change(screen.getByPlaceholderText("Написать"), { target: { value: "line one\nline two" } });

    expect(area).toHaveAttribute("data-expanded", "true");
    // The same single field is reused — no duplicate input is rendered behind the overlay.
    expect(screen.getAllByPlaceholderText("Написать")).toHaveLength(1);
  });

  it("collapses the overlay back to a single row when multiline content is cleared", () => {
    renderWithTheme(<Composer placeholder="Написать" />);
    const input = screen.getByPlaceholderText("Написать");

    fireEvent.change(input, { target: { value: "a\nb" } });
    expect(screen.getByTestId("composer-input-area")).toHaveAttribute("data-expanded", "true");

    fireEvent.change(input, { target: { value: "a" } });
    expect(screen.getByTestId("composer-input-area")).toHaveAttribute("data-expanded", "false");
  });

  it("pins work mode switches to the menu edge", () => {
    renderWithTheme(
      <Composer
        placeholder="Написать"
        modes={[
          { id: "plan", label: "Plan" },
          { id: "review", label: "Review" },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Опции/ }));

    const planItem = screen.getByRole("menuitem", { name: "Plan" });
    const switchRoot = within(planItem).getByRole("switch").closest(".MuiSwitch-root");

    expect(planItem).toHaveStyle({ paddingLeft: "16px", paddingRight: "8px" });
    expect(switchRoot).toHaveStyle({ marginLeft: "auto", marginRight: "0px" });
  });

  it("uses a restrained shadow for the options menu window", () => {
    renderWithTheme(<Composer placeholder="Написать" modes={[{ id: "plan", label: "Plan" }]} />);

    fireEvent.click(screen.getByRole("button", { name: /Опции/ }));

    const menuPaper = screen.getByRole("menu").closest(".MuiPaper-root");

    expect(menuPaper).toHaveStyle({ boxShadow: "0 4px 12px rgba(0, 0, 0, 0.14)" });
  });

  it("shows browser agent activity in the options menu only when provided", () => {
    const { unmount } = renderWithTheme(<Composer placeholder="Написать" />);

    fireEvent.click(screen.getByRole("button", { name: /Опции/ }));
    expect(screen.queryByTestId("composer-browser-activity-section")).not.toBeInTheDocument();

    unmount();
    renderWithTheme(
      <Composer
        placeholder="Написать"
        browserActivityEvents={[
          {
            id: 1,
            type: "navigation.done",
            label: "Navigation finished",
            detail: "https://example.com/",
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Опции/ }));

    expect(screen.getByTestId("composer-browser-activity-section")).toHaveTextContent("Агент в браузере");
    expect(screen.getByTestId("composer-browser-activity-section")).toHaveTextContent("Navigation finished");
    expect(screen.getByTestId("composer-browser-activity-section")).toHaveTextContent("https://example.com/");
  });

  it("shows compaction window controls only for agents with backend support", () => {
    const claude = renderWithTheme(<Composer placeholder="Написать" agentId="claude-code" />);

    fireEvent.click(screen.getByRole("button", { name: /Опции/ }));
    expect(screen.getByText("Авто-сжатие контекста")).toBeInTheDocument();
    expect(screen.getByLabelText("Окно сжатия")).toBeInTheDocument();

    claude.unmount();
    const codex = renderWithTheme(<Composer placeholder="Написать" agentId="codex" />);

    fireEvent.click(screen.getByRole("button", { name: /Опции/ }));
    expect(screen.queryByText("Авто-сжатие контекста")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Окно сжатия")).toBeInTheDocument();

    codex.unmount();
    for (const agentId of ["gemini", "opencode"]) {
      const unsupported = renderWithTheme(<Composer placeholder="Написать" agentId={agentId} />);

      fireEvent.click(screen.getByRole("button", { name: /Опции/ }));
      expect(screen.queryByText("Авто-сжатие контекста")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Окно сжатия")).not.toBeInTheDocument();
      expect(screen.getByText("Сжать сейчас")).toBeInTheDocument();

      unsupported.unmount();
    }
  });

  it("requests shared account-limit refresh only when the collapsed section is opened", () => {
    const onRefreshAgentLimits = vi.fn();

    renderWithTheme(
      <Composer
        placeholder="Написать"
        agentId="claude-code"
        agentLimit={{
          updatedAt: Date.now(),
          windows: [{ kind: "five_hour", usedPercent: 42, resetsAt: Math.floor(Date.now() / 1000) + 3600 }],
        }}
        agentLimitLoaded
        onRefreshAgentLimits={onRefreshAgentLimits}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Опции/ }));
    expect(onRefreshAgentLimits).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Лимиты аккаунта" }));
    expect(onRefreshAgentLimits).toHaveBeenCalledWith(true);
    expect(screen.getByText(/42%/)).toBeInTheDocument();
  });

  it("shows a shared low-limit warning tile for the current CLI agent", () => {
    renderWithTheme(
      <Composer
        placeholder="Написать"
        agentId="claude-code"
        agentLimit={{
          updatedAt: Date.now(),
          windows: [{ kind: "weekly", usedPercent: 88, resetsAt: Math.floor(Date.now() / 1000) + 86400 }],
        }}
        agentLimitLoaded
      />,
    );

    expect(screen.getByTestId("agent-limit-warning")).toHaveStyle({ width: "76px", height: "76px" });
    expect(screen.getByText("Лимиты на исходе · Неделя 88%")).toBeInTheDocument();
  });

  it("shows the context gauge when context tokens and window are available", () => {
    renderWithTheme(<Composer placeholder="Написать" agentId="codex" contextTokens={120000} contextWindow={272000} />);

    expect(screen.getByTestId("composer-options-button")).toHaveAttribute("aria-label", "Опции · Контекст · 44%");
  });

  it("keeps the context gauge visible when only the model window is known", () => {
    renderWithTheme(<Composer placeholder="Написать" agentId="codex" contextWindow={272000} />);

    expect(screen.getByTestId("composer-options-button")).toHaveAttribute("aria-label", "Опции · Контекст · 0%");
  });

  it("renders composer floating controls as square tiles", () => {
    renderWithTheme(
      <Composer
        placeholder="Написать"
        scheduledWakeups={[
          {
            id: "wake-1",
            label: "Wakeup установлен: 10.06.2026, 14:18:00",
            removeLabel: "Убрать запланированную задачу",
            onRemove: vi.fn(),
          },
        ]}
        modes={[{ id: "review", label: "Review" }]}
        activeMode="review"
      />,
    );

    const wakeupTile = screen.getByTestId("scheduled-wakeup-tile-wake-1");
    const modeTile = screen.getByTestId("active-mode-tile");

    expect(wakeupTile).toHaveStyle({ width: "76px", height: "76px", boxShadow: "0 1px 4px rgba(0, 0, 0, 0.18)" });
    expect(modeTile).toHaveStyle({ width: "76px", height: "76px" });
  });
});
