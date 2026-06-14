import { fireEvent, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { AgentDetails } from "../src/components/agent/message/AgentDetails";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { renderWithTheme } from "./util/render-with-theme";

function renderAgentDetails(ui: ReactElement) {
  return renderWithTheme(<I18nProvider locale="ru">{ui}</I18nProvider>);
}

describe("AgentDetails", () => {
  it("renders reasoning details behind an accessible disclosure", () => {
    renderAgentDetails(<AgentDetails blocks={[{ kind: "reasoning", text: "Проверяю контекст", duration: "7s" }]} />);

    const disclosure = screen.getByRole("button", { name: /размышление/i });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(disclosure);

    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(within(screen.getByTestId("agent-details-body")).getByText("Проверяю контекст")).toBeInTheDocument();
  });

  it("does not expand empty reasoning-only details", () => {
    renderAgentDetails(<AgentDetails blocks={[{ kind: "reasoning", text: "", active: true }]} live showSpinner />);

    expect(screen.queryByRole("button", { name: /размышление/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("agent-details-body")).not.toBeInTheDocument();
  });
});
