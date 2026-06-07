import { ThemeProvider } from "@mui/material/styles";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { appTheme } from "../../theme/app-theme";
import { Message } from "./Message";
import type { ChatMessage } from "./types";

function renderMessage(message: ChatMessage, actions?: Parameters<typeof Message>[0]["actions"]) {
  return render(
    <ThemeProvider theme={appTheme}>
      <I18nProvider locale="ru">
        <Message message={message} actions={actions} />
      </I18nProvider>
    </ThemeProvider>,
  );
}

describe("Message", () => {
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
});
