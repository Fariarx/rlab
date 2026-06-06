import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalView } from "../src/components/workspace/TerminalView";
import { renderWithTheme } from "./util/render-with-theme";

describe("TerminalView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes terminal output as a polite live log", () => {
    renderWithTheme(<TerminalView cwd="/root/workspace/rlab" />);

    const output = screen.getByRole("log", { name: "Вывод терминала" });
    expect(output).toHaveAttribute("aria-live", "polite");
    expect(output).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("textbox", { name: "Команда терминала" })).toBeInTheDocument();
  });

  it("aborts a running terminal command from the UI", async () => {
    let signal: AbortSignal | null = null;
    const encoder = new TextEncoder();
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal ?? null;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: "out", chunk: "still running\n" })}\n`));
          },
        }),
        { headers: { "Content-Type": "application/x-ndjson" } },
      );
    });
    vi.stubGlobal("fetch", fetch);

    renderWithTheme(<TerminalView cwd="/root/workspace/rlab" />);

    const input = screen.getByRole("textbox", { name: "Команда терминала" });
    fireEvent.change(input, { target: { value: "npm test" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("still running")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Остановить команду" }));

    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    expect(await screen.findByText("Остановлено")).toBeInTheDocument();
    expect(screen.getByRole("log", { name: "Вывод терминала" })).toHaveAttribute("aria-busy", "false");
  });
});
