import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer, type ComposerHandle } from "../src/components/agent";
import { voiceLevelCountFromWidth, voiceLevelsFromTimeDomainData } from "../src/components/agent/composer/Composer";
import { renderWithTheme } from "./util/render-with-theme";

const originalMediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
const originalUserAgentDescriptor = Object.getOwnPropertyDescriptor(navigator, "userAgent");

function installVoiceCaptureMocks(): { readonly getUserMedia: ReturnType<typeof vi.fn> } {
  const stream = {
    getTracks: () => [{ stop: vi.fn() }],
  } as unknown as MediaStream;
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
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
  return { getUserMedia };
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
    if (originalUserAgentDescriptor) {
      Object.defineProperty(navigator, "userAgent", originalUserAgentDescriptor);
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

  it("uses minimal chrome for editing a sent message", () => {
    renderWithTheme(
      <Composer
        variant="edit"
        placeholder="Изменить сообщение"
        modes={[{ id: "plan", label: "Plan" }]}
        activeMode="plan"
        supportsAutoConfirm
        autoConfirm
        agentId="claude-code"
        browserActivityEvents={[]}
      />,
    );

    expect(screen.getByTestId("composer-input")).toBe(screen.getByPlaceholderText("Изменить сообщение"));
    expect(screen.getByTestId("composer-attach-button")).toBe(screen.getByRole("button", { name: "Прикрепить" }));
    expect(screen.getByTestId("composer-send-button")).toBe(screen.getByRole("button", { name: "Отправить" }));
    expect(screen.queryByTestId("composer-options-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("active-mode-indicator")).not.toBeInTheDocument();
    expect(screen.queryByText("Plan")).not.toBeInTheDocument();
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

  it("shows only the dictation stop action while voice input is active", async () => {
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
    expect(screen.queryByTestId("composer-send-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("composer-stop-button")).not.toBeInTheDocument();
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

  it("does not show composer suggestions for slash commands", () => {
    renderWithTheme(<Composer placeholder="Написать" registeredPlugins={[{ id: "TaskWakeup", label: "TaskWakeup", token: "$TaskWakeup" }]} />);

    fireEvent.change(screen.getByPlaceholderText("Написать"), { target: { value: "/" } });

    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("navigates plugin suggestions with the arrow keys and inserts a tool link", () => {
    renderWithTheme(
      <Composer
        placeholder="Написать"
        registeredPlugins={[
          { id: "AskUserQuestion", label: "AskUserQuestion", token: "$AskUserQuestion" },
          { id: "TaskWakeup", label: "TaskWakeup", token: "$TaskWakeup" },
        ]}
      />,
    );
    const input = screen.getByPlaceholderText("Написать");

    fireEvent.change(input, { target: { value: "$" } });
    // The list opens with the first item active.
    expect(screen.getByRole("option", { name: "$AskUserQuestion" })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "$TaskWakeup" })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("$TaskWakeup ");
    // The token lives as plain visible text in the textarea — no transparent
    // overlay — so the native caret can never drift on mobile.
    expect(screen.queryByTestId("composer-plugin-preview")).not.toBeInTheDocument();
  });

  it("deletes parsed plugin tool links as atomic composer tokens", () => {
    renderWithTheme(<Composer placeholder="Написать" registeredPlugins={[{ id: "TaskWakeup", label: "TaskWakeup", token: "$TaskWakeup" }]} />);
    const input = screen.getByPlaceholderText("Написать") as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: "Run $TaskWakeup now" } });
    input.setSelectionRange("Run $TaskWakeup".length, "Run $TaskWakeup".length);
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(input).toHaveValue("Run  now");

    fireEvent.change(input, { target: { value: "Run $TaskWakeup now" } });
    input.setSelectionRange("Run $Ta".length, "Run $Ta".length);
    fireEvent.keyDown(input, { key: "Delete" });
    expect(input).toHaveValue("Run  now");
  });

  it("normalizes mobile partial deletion inside a plugin tool link", () => {
    renderWithTheme(<Composer placeholder="Написать" registeredPlugins={[{ id: "TaskWakeup", label: "TaskWakeup", token: "$TaskWakeup" }]} />);
    const input = screen.getByPlaceholderText("Написать");

    fireEvent.change(input, { target: { value: "Run $TaskWakeup now" } });
    fireEvent.change(input, { target: { value: "Run $TaskWakeu now" } });

    expect(input).toHaveValue("Run  now");
    expect(screen.queryByTestId("composer-plugin-preview")).not.toBeInTheDocument();
  });

  it("commits browser speech interim text when mobile recognition ends before a final result", async () => {
    class FakeSpeechRecognition {
      static current: FakeSpeechRecognition | null = null;
      startCount = 0;
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: ((event: { readonly resultIndex: number; readonly results: { readonly length: number; readonly 0: { readonly length: number; readonly isFinal: boolean; readonly 0: { readonly transcript: string } } } }) => void) | null = null;
      onerror: ((event: { readonly error?: string; readonly message?: string }) => void) | null = null;
      onend: (() => void) | null = null;

      constructor() {
        FakeSpeechRecognition.current = this;
      }

      start(): void {
        this.startCount += 1;
      }

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
    const capture = installVoiceCaptureMocks();
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36",
    });

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
    expect(FakeSpeechRecognition.current?.continuous).toBe(false);
    expect(capture.getUserMedia).not.toHaveBeenCalled();
    expect(await screen.findByTestId("composer-voice-recording-strip")).toHaveAttribute("data-ambient", "true");

    act(() => {
      FakeSpeechRecognition.current?.emitInterim("текст с телефона");
    });
    expect(screen.getByPlaceholderText("Написать")).toHaveValue("");

    act(() => {
      FakeSpeechRecognition.current?.onend?.();
    });

    expect(screen.getByPlaceholderText("Написать")).toHaveValue("текст с телефона");
    expect(FakeSpeechRecognition.current?.startCount).toBe(1);
  });

  it("commits browser speech interim text when Android reports aborted during manual stop", async () => {
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
        this.onerror?.({ error: "aborted" });
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
    const capture = installVoiceCaptureMocks();
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36",
    });

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
    expect(capture.getUserMedia).not.toHaveBeenCalled();

    act(() => {
      FakeSpeechRecognition.current?.emitInterim("ручная остановка");
    });
    fireEvent.click(screen.getByTestId("composer-voice-button"));

    expect(screen.getByPlaceholderText("Написать")).toHaveValue("ручная остановка");
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
    renderWithTheme(<Composer placeholder="Написать" onSend={onSend} registeredPlugins={[{ id: "TaskWakeup", label: "TaskWakeup", token: "$TaskWakeup" }]} />);
    const input = screen.getByPlaceholderText("Написать");

    fireEvent.change(input, { target: { value: "$" } });
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

  it("lifts the options menu 12px above its default popover position", () => {
    renderWithTheme(<Composer placeholder="Написать" />);

    fireEvent.click(screen.getByRole("button", { name: /Опции/ }));

    expect(screen.getByRole("menu").closest(".MuiPaper-root")).toHaveStyle({ marginTop: "-12px" });
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

  it("renders composer options as a plain icon button without context progress", () => {
    renderWithTheme(<Composer placeholder="Написать" agentId="codex" contextTokens={120000} contextWindow={272000} />);

    expect(screen.getByTestId("composer-options-button")).toHaveAttribute("aria-label", "Опции");
    expect(screen.queryByLabelText(/Контекст/)).not.toBeInTheDocument();
  });

  it("requests shared account-limit refresh only when the collapsed menu section is opened", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Опции" }));
    expect(onRefreshAgentLimits).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Лимиты аккаунта" })).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByRole("button", { name: "Лимиты аккаунта" }));
    expect(onRefreshAgentLimits).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: "Лимиты аккаунта" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/42%/)).toBeInTheDocument();
    const menuText = screen.getByRole("menu").textContent ?? "";
    const usageIndex = menuText.indexOf("42%");
    const labelIndex = menuText.indexOf("Лимиты аккаунта");
    expect(usageIndex).toBeGreaterThanOrEqual(0);
    expect(labelIndex).toBeGreaterThanOrEqual(0);
    expect(usageIndex).toBeLessThan(labelIndex);
    expect(screen.queryByTestId("agent-limit-warning")).not.toBeInTheDocument();
  });

  it("renders composer floating controls as compact, width-capped tags", () => {
    renderWithTheme(
      <Composer
        placeholder="Написать"
        scheduledWakeups={[
          {
            id: "wake-1",
            label: "Wakeup установлен: 10.06.2026, 14:18:00",
            removeLabel: "Убрать запланированную задачу",
            onRemove: vi.fn(),
            detail: {
              heading: "TaskWakeup · по времени",
              rows: [
                { label: "Сработает", value: "10.06.2026, 14:18:00" },
                { label: "Агент", value: "claude-code" },
              ],
              promptLabel: "Промпт",
              prompt: "проверь деплой",
            },
          },
        ]}
        modes={[{ id: "review", label: "Review" }]}
        activeMode="review"
      />,
    );

    // The wakeup is a compact tag (like an attachment), not a 76px square, and
    // its label is width-capped so a long schedule string can't blow out the row.
    const wakeupTile = screen.getByTestId("scheduled-wakeup-tile-wake-1");
    expect(wakeupTile).toHaveStyle({ height: "28px", maxWidth: "220px" });

    // Clicking the tag opens a popover with the full wakeup details.
    fireEvent.click(screen.getByRole("button", { name: "Wakeup установлен: 10.06.2026, 14:18:00" }));
    const popover = screen.getByTestId("scheduled-wakeup-popover-wake-1");
    expect(popover).toBeInTheDocument();
    expect(within(popover).getByText("проверь деплой")).toBeInTheDocument();
    expect(within(popover).getByText("TaskWakeup · по времени")).toBeInTheDocument();

    // The active agent mode is shown as a small badge on the options (gear)
    // button — not a square tile and not an inline chip that eats input width.
    expect(screen.queryByTestId("active-mode-tile")).not.toBeInTheDocument();
    expect(screen.queryByTestId("active-mode-chip")).not.toBeInTheDocument();
    expect(screen.getByTestId("active-mode-indicator")).toBeInTheDocument();
  });
});
