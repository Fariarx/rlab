import { ThemeProvider } from "@mui/material/styles";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { appTheme } from "../../theme/app-theme";
import { Conversation } from "./Conversation";
import type { ChatMessage } from "./types";

function renderConversation(messages: readonly ChatMessage[]) {
  return render(
    <ThemeProvider theme={appTheme}>
      <I18nProvider locale="ru">
        <Conversation messages={messages} />
      </I18nProvider>
    </ThemeProvider>,
  );
}

describe("Conversation", () => {
  it("announces running plan updates as live content", () => {
    renderConversation([
      {
        id: "agent-plan",
        role: "agent",
        blocks: [{ kind: "plan", steps: [{ label: "Проверить CLI", state: "running" }] }],
      },
    ]);

    expect(screen.getByTestId("conversation-virtual-list")).toHaveAttribute("aria-live", "polite");
  });
});
