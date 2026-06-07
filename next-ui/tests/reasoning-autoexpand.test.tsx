import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Message } from "../src/components/agent";
import { type ChatMessage } from "../src/components/agent/types";
import { renderWithTheme } from "./util/render-with-theme";

function thinkingMessage(active: boolean): ChatMessage {
  return {
    id: "a1",
    role: "agent",
    time: "10:01",
    blocks: [{ kind: "reasoning", text: "weighing the options carefully", active }],
  };
}

describe("reasoning auto-expand", () => {
  it("expands the reasoning while the agent is thinking when the setting is on", () => {
    renderWithTheme(<Message message={thinkingMessage(true)} index={0} displayPrefs={{ showTokens: false, showCost: false, reasoningAutoExpand: true }} />);
    expect(screen.getByText("weighing the options carefully")).toBeInTheDocument();
  });

  it("keeps reasoning collapsed while thinking when the setting is off", () => {
    renderWithTheme(<Message message={thinkingMessage(true)} index={0} displayPrefs={{ showTokens: false, showCost: false, reasoningAutoExpand: false }} />);
    expect(screen.queryByText("weighing the options carefully")).not.toBeInTheDocument();
  });

  it("collapses reasoning once the turn is no longer active, even with auto-expand on", () => {
    renderWithTheme(<Message message={thinkingMessage(false)} index={0} displayPrefs={{ showTokens: false, showCost: false, reasoningAutoExpand: true }} />);
    expect(screen.queryByText("weighing the options carefully")).not.toBeInTheDocument();
  });
});
