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
    expect(screen.queryByTestId("key-hint-enter-icon")).not.toBeInTheDocument();
    expect(screen.getByText("⏎")).toBeInTheDocument();
  });

  it("renders the agent placeholder with an icon instead of the handwriting glyph", () => {
    renderWithTheme(<Composer placeholder="Написать: CODEX/GPT-5.5/XHIGH" />);

    const input = screen.getByTestId("composer-input");
    expect(input).toBe(screen.getByPlaceholderText("CODEX/GPT-5.5/XHIGH"));
    expect(input.getAttribute("placeholder")).not.toContain("✍");
    expect(screen.getByTestId("composer-placeholder-hint")).toHaveTextContent("CODEX/GPT-5.5/XHIGH");
    expect(screen.getByTestId("composer-placeholder-label")).toHaveStyle({ textTransform: "uppercase", letterSpacing: "0.12em" });
    expect(screen.getByTestId("composer-placeholder-icon")).toBeInTheDocument();
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

  it("renders edit attachments below the input and sends them once", async () => {
    const onSend = vi.fn();
    renderWithTheme(
      <Composer
        variant="edit"
        placeholder="Изменить сообщение"
        initialValue="Review this"
        initialAttachments={[
          { id: "edit-att-1", name: "notes.txt", type: "text/plain", content: "hello", size: 5, lastModified: 0 },
        ]}
        onSend={onSend}
      />,
    );

    const inlineAttachments = screen.getByTestId("composer-inline-attachments");
    const attachmentTag = within(inlineAttachments).getByTestId("attachment-tag");
    expect(attachmentTag).toHaveStyle({ height: "28px" });
    expect(attachmentTag).toHaveTextContent("notes.txt");

    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    const payload = onSend.mock.calls[0]?.[0] as string;
    expect(payload.match(/<attachment name="notes\.txt"/g)).toHaveLength(1);
  });

  it("sends typed text with pending review comments in the same turn", async () => {
    const onSend = vi.fn();
    const onSendReview = vi.fn();
    renderWithTheme(<Composer placeholder="Написать" reviewCount={2} onSend={onSend} onSendReview={onSendReview} />);

    const input = screen.getByPlaceholderText("Написать");
    fireEvent.change(input, { target: { value: "проверь комментарии" } });
    fireEvent.click(screen.getByTestId("composer-send-button"));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith("проверь комментарии", { includeReviewComments: true }));
    expect(onSendReview).not.toHaveBeenCalled();
  });

  it("clears all pending review comments from the review tag remove button", () => {
    const onClearReviewComments = vi.fn();
    renderWithTheme(<Composer placeholder="Написать" reviewCount={3} onClearReviewComments={onClearReviewComments} />);

    expect(screen.getByTestId("composer-review-tag")).toHaveTextContent("3 комментариев");
    fireEvent.click(screen.getByRole("button", { name: "Удалить комментарии ревью" }));

    expect(onClearReviewComments).toHaveBeenCalledTimes(1);
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

  it("sends the current draft as a queue goal from the options menu", async () => {
    const onSendAsGoal = vi.fn();
    renderWithTheme(<Composer placeholder="Написать" onSendAsGoal={onSendAsGoal} />);

    const input = screen.getByPlaceholderText("Написать");
    fireEvent.change(input, { target: { value: "держать цель до завершения" } });
    fireEvent.click(screen.getByTestId("composer-options-button"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Отправить как цель" }));

    await waitFor(() => expect(onSendAsGoal).toHaveBeenCalledWith("держать цель до завершения"));
    expect(input).toHaveValue("");
  });

  it("defers the current draft to a paused queue from the options menu", async () => {
    const onDeferToQueue = vi.fn();
    renderWithTheme(<Composer placeholder="Написать" onDeferToQueue={onDeferToQueue} />);

    const input = screen.getByPlaceholderText("Написать");
    fireEvent.change(input, { target: { value: "отложить обычное сообщение" } });
    fireEvent.click(screen.getByTestId("composer-options-button"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Отложить в очередь" }));

    await waitFor(() => expect(onDeferToQueue).toHaveBeenCalledWith("отложить обычное сообщение"));
    expect(input).toHaveValue("");
  });

  it("ignores stale browser change events that reinsert a sent message tail", async () => {
    const onSend = vi.fn();
    renderWithTheme(<Composer placeholder="Написать" onSend={onSend} />);
    const input = screen.getByPlaceholderText("Написать");
    const message = "часто, в длинном диалоге, нужно поправить чтобы скрол был всегда внизу";
    const staleTail = "чтобы скрол был всегда внизу";

    fireEvent.change(input, { target: { value: message } });
    fireEvent.click(screen.getByTestId("composer-send-button"));

    expect(onSend).toHaveBeenCalledWith(message);
    expect(input).toHaveValue("");

    fireEvent.change(input, { target: { value: staleTail } });

    expect(input).toHaveValue("");
  });

  it("ignores delayed stale browser change events after a sent message", async () => {
    const onSend = vi.fn();
    renderWithTheme(<Composer placeholder="Написать" onSend={onSend} />);
    const input = screen.getByPlaceholderText("Написать");
    const message = "после отправки этот текст не должен возвращаться в черновик";

    fireEvent.change(input, { target: { value: message } });
    fireEvent.click(screen.getByTestId("composer-send-button"));

    expect(onSend).toHaveBeenCalledWith(message);
    expect(input).toHaveValue("");

    await new Promise((resolve) => setTimeout(resolve, 850));
    fireEvent.change(input, { target: { value: message } });

    expect(input).toHaveValue("");
  });

  it("ignores stale submitted text after the composer remounts", async () => {
    const message = "у меня нет там обученных моделей и 100к бэнков";
    const mounted = renderWithTheme(<Composer placeholder="Написать" onSend={() => undefined} />);
    let input = screen.getByPlaceholderText("Написать");

    fireEvent.change(input, { target: { value: message } });
    fireEvent.click(screen.getByTestId("composer-send-button"));
    expect(input).toHaveValue("");

    mounted.unmount();
    renderWithTheme(<Composer placeholder="Написать" recentlySubmittedValue={message} />);
    input = screen.getByPlaceholderText("Написать");

    await new Promise((resolve) => setTimeout(resolve, 850));
    fireEvent.change(input, { target: { value: message } });

    expect(input).toHaveValue("");
  });

  it("allows intentional typing after a sent message guard is armed", () => {
    const message = "у меня нет там обученных моделей и 100к бэнков";
    const nextMessage = "у меня есть новый ввод";
    renderWithTheme(<Composer placeholder="Написать" recentlySubmittedValue={message} />);
    const input = screen.getByPlaceholderText("Написать");

    fireEvent.keyDown(input, { key: "у" });
    fireEvent.change(input, { target: { value: nextMessage } });

    expect(input).toHaveValue(nextMessage);
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

  it("finishes browser voice input from the inline stop button without discarding interim text", async () => {
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
        initialValue="alpha omega"
        voiceProvider={{ id: "web-speech", name: "Browser Web Speech", kind: "browser", language: "ru-RU", configured: true }}
      />,
    );

    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.click(await screen.findByTestId("composer-voice-button"));
    await waitFor(() => {
      expect(FakeSpeechRecognition.current).not.toBeNull();
    });
    input.setSelectionRange("alpha ".length, "alpha ".length);
    act(() => {
      FakeSpeechRecognition.current?.emitInterim("ручная остановка");
    });

    fireEvent.click(screen.getByTestId("composer-voice-stop-button"));

    expect(input).toHaveValue("alpha ручная остановка omega");
    await waitFor(() => {
      expect(input.selectionStart).toBe("alpha ручная остановка ".length);
      expect(input.selectionEnd).toBe("alpha ручная остановка ".length);
    });
    expect(screen.queryByTestId("composer-voice-recording-strip")).not.toBeInTheDocument();
  });

  it("returns focus to the composer after stopping browser voice input without transcript", async () => {
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

    const input = screen.getByTestId("composer-input");
    fireEvent.click(await screen.findByTestId("composer-voice-button"));
    await waitFor(() => {
      expect(FakeSpeechRecognition.current).not.toBeNull();
    });

    fireEvent.click(screen.getByTestId("composer-voice-stop-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("composer-voice-recording-strip")).not.toBeInTheDocument();
      expect(input).toHaveFocus();
    });
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

  it("keeps send visible while voice input is active", async () => {
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
        placeholder="Написать: Голосовой ввод"
        voiceProvider={{ id: "web-speech", name: "Browser Web Speech", kind: "browser", language: "ru-RU", configured: true }}
      />,
    );

    fireEvent.click(await screen.findByTestId("composer-voice-button"));

    expect(await screen.findByTestId("composer-voice-recording-strip")).toBeInTheDocument();
    expect(screen.getByTestId("composer-input-area")).toHaveAttribute("data-expanded", "true");
    expect(screen.getByTestId("composer-voice-input-panel")).toBeInTheDocument();
    expect(screen.getByTestId("composer-voice-recording-strip")).toHaveAttribute("data-layout", "inline");
    expect(screen.getByTestId("composer-input-root")).toHaveStyle({ paddingRight: "0px" });
    expect(screen.getByTestId("composer-placeholder-hint")).toHaveTextContent("Голосовой ввод");
    expect(screen.getByTestId("composer-placeholder-hint")).toHaveStyle({ top: "calc(100% - 59px)" });
    expect(screen.getByTestId("composer-placeholder-icon")).toBeInTheDocument();
    expect(screen.queryByText("⏎")).not.toBeInTheDocument();
    expect(screen.getByTestId("composer-voice-input-panel")).toHaveStyle({ gap: "6px" });
    expect(screen.getByTestId("composer-voice-action-buttons")).toHaveStyle({ gap: "6px" });
    expect(screen.queryByTestId("composer-voice-button")).not.toBeInTheDocument();
    expect(screen.getByTestId("composer-voice-cancel-button")).toHaveStyle({ height: "30px" });
    expect(screen.getByTestId("composer-voice-stop-button")).toHaveStyle({ height: "30px" });
    expect(screen.getByTestId("composer-send-button")).toBeEnabled();
    expect(screen.queryByTestId("composer-stop-button")).not.toBeInTheDocument();
  });

  it("stops browser voice input before sending interim text with Enter", async () => {
    const onSend = vi.fn();
    class FakeSpeechRecognition {
      static current: FakeSpeechRecognition | null = null;
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: ((event: { readonly resultIndex: number; readonly results: { readonly length: number; readonly 0: { readonly length: number; readonly isFinal: boolean; readonly 0: { readonly transcript: string } } } }) => void) | null = null;
      onerror: ((event: { readonly error?: string; readonly message?: string }) => void) | null = null;
      onend: (() => void) | null = null;
      interim = "";
      stop = vi.fn(() => {
        if (this.interim) {
          this.onresult?.({
            resultIndex: 0,
            results: {
              length: 1,
              0: { length: 1, isFinal: true, 0: { transcript: this.interim } },
            },
          });
        }
        this.onend?.();
      });

      constructor() {
        FakeSpeechRecognition.current = this;
      }

      start(): void {}

      emitInterim(text: string): void {
        this.interim = text;
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
        onSend={onSend}
        voiceProvider={{ id: "web-speech", name: "Browser Web Speech", kind: "browser", language: "ru-RU", configured: true }}
      />,
    );

    fireEvent.click(await screen.findByTestId("composer-voice-button"));
    await waitFor(() => {
      expect(FakeSpeechRecognition.current).not.toBeNull();
    });
    act(() => {
      FakeSpeechRecognition.current?.emitInterim("голосовой текст");
    });

    expect(screen.getByPlaceholderText("Написать")).toHaveValue("");

    fireEvent.keyDown(screen.getByPlaceholderText("Написать"), { key: "Enter" });

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("голосовой текст");
    });
    expect(FakeSpeechRecognition.current?.stop).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("composer-voice-recording-strip")).not.toBeInTheDocument();
  });

  it("waits for browser voice input before sending from the send button", async () => {
    const onSend = vi.fn();
    class FakeSpeechRecognition {
      static current: FakeSpeechRecognition | null = null;
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: ((event: { readonly resultIndex: number; readonly results: { readonly length: number; readonly 0: { readonly length: number; readonly isFinal: boolean; readonly 0: { readonly transcript: string } } } }) => void) | null = null;
      onerror: ((event: { readonly error?: string; readonly message?: string }) => void) | null = null;
      onend: (() => void) | null = null;
      interim = "";
      stop = vi.fn(() => {
        if (this.interim) {
          this.onresult?.({
            resultIndex: 0,
            results: {
              length: 1,
              0: { length: 1, isFinal: true, 0: { transcript: this.interim } },
            },
          });
        }
        this.onend?.();
      });

      constructor() {
        FakeSpeechRecognition.current = this;
      }

      start(): void {}

      emitInterim(text: string): void {
        this.interim = text;
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
        onSend={onSend}
        voiceProvider={{ id: "web-speech", name: "Browser Web Speech", kind: "browser", language: "ru-RU", configured: true }}
      />,
    );

    fireEvent.click(await screen.findByTestId("composer-voice-button"));
    await waitFor(() => {
      expect(FakeSpeechRecognition.current).not.toBeNull();
    });
    act(() => {
      FakeSpeechRecognition.current?.emitInterim("текст через кнопку");
    });

    fireEvent.click(screen.getByTestId("composer-send-button"));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("текст через кнопку");
    });
    expect(FakeSpeechRecognition.current?.stop).toHaveBeenCalledTimes(1);
  });

  it("cancels cloud voice input without sending audio for transcription", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    class FakeMediaRecorder {
      static current: FakeMediaRecorder | null = null;
      static isTypeSupported(): boolean {
        return true;
      }

      state: RecordingState = "inactive";
      readonly mimeType = "audio/webm";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onerror: ((event: { readonly error: Error }) => void) | null = null;
      onstop: (() => void) | null = null;

      constructor() {
        FakeMediaRecorder.current = this;
      }

      start(): void {
        this.state = "recording";
      }

      stop(): void {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["voice"], { type: this.mimeType }) } as BlobEvent);
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    installVoiceCaptureMocks();

    renderWithTheme(
      <Composer
        placeholder="Написать"
        voiceProvider={{ id: "openai", name: "OpenAI", kind: "cloud", language: "ru", configured: true }}
      />,
    );

    fireEvent.click(await screen.findByTestId("composer-voice-button"));
    await waitFor(() => {
      expect(FakeMediaRecorder.current?.state).toBe("recording");
    });

    fireEvent.click(screen.getByTestId("composer-voice-cancel-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("composer-voice-recording-strip")).not.toBeInTheDocument();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("Написать")).toHaveValue("");
  });

  it("waits for cloud transcription before sending from the send button", async () => {
    const onSend = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ text: "облачный текст" }));
    vi.stubGlobal("fetch", fetchMock);
    class FakeMediaRecorder {
      static current: FakeMediaRecorder | null = null;
      static isTypeSupported(): boolean {
        return true;
      }

      state: RecordingState = "inactive";
      readonly mimeType = "audio/webm";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onerror: ((event: { readonly error: Error }) => void) | null = null;
      onstop: (() => void) | null = null;

      constructor() {
        FakeMediaRecorder.current = this;
      }

      start(): void {
        this.state = "recording";
      }

      stop(): void {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["voice"], { type: this.mimeType }) } as BlobEvent);
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    installVoiceCaptureMocks();

    renderWithTheme(
      <Composer
        placeholder="Написать"
        onSend={onSend}
        voiceProvider={{ id: "openai", name: "OpenAI", kind: "cloud", language: "ru", configured: true }}
      />,
    );

    fireEvent.click(await screen.findByTestId("composer-voice-button"));
    await waitFor(() => {
      expect(FakeMediaRecorder.current?.state).toBe("recording");
    });

    fireEvent.click(screen.getByTestId("composer-send-button"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/voice/transcribe",
        expect.objectContaining({ method: "POST" }),
      );
      expect(onSend).toHaveBeenCalledWith("облачный текст");
    });
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

  it("shows an attachment skeleton while selected files are still loading", async () => {
    const onSend = vi.fn();
    renderWithTheme(<Composer placeholder="Написать" onSend={onSend} />);

    let resolveText!: (value: string) => void;
    const textPromise = new Promise<string>((resolve) => {
      resolveText = resolve;
    });
    const file = new File(["pending"], "slow.txt", { type: "text/plain" });
    vi.spyOn(file, "text").mockImplementation(() => textPromise);

    fireEvent.change(screen.getByLabelText("Выбрать файлы"), { target: { files: [file] } });
    fireEvent.change(screen.getByPlaceholderText("Написать"), { target: { value: "Read this" } });

    expect(await screen.findByTestId("attachment-upload-skeleton")).toHaveAccessibleName("Файл прикрепляется…");
    expect(screen.queryByText("slow.txt")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отправить" })).toBeDisabled();

    await act(async () => {
      resolveText("loaded file text");
      await textPromise;
    });

    expect(await screen.findByText("slow.txt")).toBeInTheDocument();
    expect(screen.queryByTestId("attachment-upload-skeleton")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отправить" })).toBeEnabled();
  });

  it("converts large mobile paste input into a text attachment", async () => {
    const onSend = vi.fn();
    renderWithTheme(<Composer placeholder="Написать" onSend={onSend} />);
    const input = screen.getByPlaceholderText("Написать");
    const pasted = "x".repeat(1501);

    fireEvent.input(input, { target: { value: pasted }, inputType: "insertFromPaste" });

    expect(input).toHaveValue("");
    expect(await screen.findByText("pasted-1501.txt")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith(
        [
          "<attachment name=\"pasted-1501.txt\" type=\"text/plain\">",
          pasted,
          "</attachment>",
        ].join("\n"),
      );
    });
  });

  it("converts large mobile beforeinput paste into a text attachment before textarea insertion", async () => {
    const onSend = vi.fn();
    renderWithTheme(<Composer placeholder="Написать" onSend={onSend} />);
    const input = screen.getByPlaceholderText("Написать");
    const pasted = "y".repeat(1501);
    const event = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: pasted,
      inputType: "insertFromPaste",
    });

    fireEvent(input, event);

    expect(event.defaultPrevented).toBe(true);
    expect(input).toHaveValue("");
    expect(await screen.findByText("pasted-1501.txt")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith(
        [
          "<attachment name=\"pasted-1501.txt\" type=\"text/plain\">",
          pasted,
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

  it("cancels browser speech interim text when Android reports aborted during dictation cancel", async () => {
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
    fireEvent.click(screen.getByTestId("composer-voice-cancel-button"));

    expect(screen.getByPlaceholderText("Написать")).toHaveValue("");
    expect(screen.queryByTestId("composer-voice-recording-strip")).not.toBeInTheDocument();
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

  it("sets the visible draft handed in by the parent", () => {
    const ref = createRef<ComposerHandle>();
    const onDraftChange = vi.fn();
    renderWithTheme(<Composer ref={ref} placeholder="Написать" onDraftChange={onDraftChange} />);

    const draft = { text: "Edited queued turn", attachments: [] };
    act(() => {
      ref.current?.setDraft(draft);
    });

    expect(screen.getByPlaceholderText("Написать")).toHaveValue("Edited queued turn");
    expect(onDraftChange).toHaveBeenCalledWith(draft);
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

  it("lifts the focused input when a single long line overflows", async () => {
    renderWithTheme(<Composer placeholder="Написать" />);
    const input = screen.getByPlaceholderText("Написать");
    Object.defineProperties(input, {
      scrollWidth: { configurable: true, value: 360 },
      clientWidth: { configurable: true, value: 180 },
      scrollHeight: { configurable: true, value: 24 },
      clientHeight: { configurable: true, value: 24 },
    });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "single long prompt that does not fit in the composer row" } });

    await waitFor(() => expect(screen.getByTestId("composer-input-area")).toHaveAttribute("data-expanded", "true"));
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

  it("separates work modes from modifier modes in the options menu", () => {
    renderWithTheme(
      <Composer
        placeholder="Написать"
        modes={[
          { id: "fast", label: "Быстрый" },
          { id: "plan", label: "План" },
          { id: "review", label: "Ревью" },
        ]}
        supportsAutoConfirm
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Опции/ }));

    const menu = screen.getByRole("menu");
    const text = menu.textContent ?? "";
    expect(text.indexOf("Прикрепить")).toBeLessThan(text.indexOf("План"));
    expect(text.indexOf("Ревью")).toBeLessThan(text.indexOf("Быстрый"));
    expect(text.indexOf("Быстрый")).toBeLessThan(text.indexOf("Автоподтверждение"));
    expect(within(menu).getAllByRole("separator").length).toBeGreaterThanOrEqual(2);
    expect(within(menu).getByTestId("SpeedRoundedIcon")).toBeInTheDocument();
    expect(within(menu).getByTestId("TaskAltRoundedIcon")).toBeInTheDocument();
  });

  it("does not show the fast modifier as the active work mode indicator", () => {
    renderWithTheme(
      <Composer
        placeholder="Написать"
        modes={[
          { id: "fast", label: "Быстрый" },
          { id: "plan", label: "План" },
        ]}
        activeMode="fast"
      />,
    );

    expect(screen.getByTestId("composer-options-button")).toBe(screen.getByRole("button", { name: /Опции/ }));
    expect(screen.queryByTestId("active-mode-indicator")).not.toBeInTheDocument();
  });

  it("toggles fast through the modifier callback instead of replacing the work mode", () => {
    const onModeChange = vi.fn();
    const onModifierModeChange = vi.fn();
    renderWithTheme(
      <Composer
        placeholder="Написать"
        modes={[
          { id: "fast", label: "Быстрый" },
          { id: "plan", label: "План" },
        ]}
        activeMode="plan"
        activeModifierModes={[]}
        onModeChange={onModeChange}
        onModifierModeChange={onModifierModeChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /План/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Быстрый" }));

    expect(onModifierModeChange).toHaveBeenCalledWith("fast", true);
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it("renders fast as a checked modifier independently of the active work mode", () => {
    renderWithTheme(
      <Composer
        placeholder="Написать"
        modes={[
          { id: "fast", label: "Быстрый" },
          { id: "plan", label: "План" },
        ]}
        activeMode="plan"
        activeModifierModes={["fast"]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /План/ }));

    expect(within(screen.getByRole("menuitem", { name: "План" })).getByRole("switch")).toBeChecked();
    expect(within(screen.getByRole("menuitem", { name: "Быстрый" })).getByRole("switch")).toBeChecked();
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

  it("keeps the options menu inside the vertical viewport and scrollable", () => {
    renderWithTheme(<Composer placeholder="Написать" />);

    const button = screen.getByTestId("composer-options-button");
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
      x: 24,
      y: 180,
      top: 180,
      right: 58,
      bottom: 214,
      left: 24,
      width: 34,
      height: 34,
      toJSON: () => ({}),
    });
    fireEvent.click(button);

    const menuPaper = screen.getByRole("menu").closest(".MuiPaper-root");
    expect(menuPaper).toHaveStyle({ maxHeight: "160px", overflowY: "auto" });
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

  it("renders composer floating controls as compact, width-capped tags", async () => {
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

    const floatingAccessories = screen.getByTestId("composer-floating-accessories");
    const root = floatingAccessories.parentElement;
    const inputArea = screen.getByTestId("composer-input-area");
    expect(root).not.toBeNull();
    vi.spyOn(root as HTMLElement, "getBoundingClientRect").mockReturnValue({
      x: 36,
      y: 1000,
      left: 36,
      top: 1000,
      right: 886,
      bottom: 1058,
      width: 850,
      height: 58,
      toJSON: () => ({}),
    });
    vi.spyOn(inputArea, "getBoundingClientRect").mockReturnValue({
      x: 130,
      y: 1010,
      left: 130,
      top: 1010,
      right: 714,
      bottom: 1048,
      width: 584,
      height: 38,
      toJSON: () => ({}),
    });
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(floatingAccessories).toHaveStyle({ paddingLeft: "94px", paddingRight: "172px" });

    // The wakeup is a compact tag (like an attachment), not a 76px square, and
    // its label is width-capped so a long schedule string can't blow out the row.
    const wakeupTile = screen.getByTestId("scheduled-wakeup-tile-wake-1");
    expect(wakeupTile).toHaveStyle({ height: "28px", maxWidth: "220px", borderRadius: "999px" });

    // Clicking the tag opens a popover with the full wakeup details.
    fireEvent.click(screen.getByRole("button", { name: "Wakeup установлен: 10.06.2026, 14:18:00" }));
    const popover = screen.getByTestId("scheduled-wakeup-popover-wake-1");
    expect(popover).toBeInTheDocument();
    expect(within(popover).getByText("проверь деплой")).toBeInTheDocument();
    expect(within(popover).getByText("TaskWakeup · по времени")).toBeInTheDocument();

    // The active agent mode is shown as a small icon on the options (gear)
    // button — not a square tile and not an inline chip that eats input width.
    expect(screen.queryByTestId("active-mode-tile")).not.toBeInTheDocument();
    expect(screen.queryByTestId("active-mode-chip")).not.toBeInTheDocument();
    const modeIndicator = screen.getByTestId("active-mode-indicator");
    expect(modeIndicator).toHaveTextContent("");
    expect(within(modeIndicator).getByTestId("RateReviewOutlinedIcon")).toBeInTheDocument();
  });
});
