import { describe, expect, it } from "vitest";
import { AgentGlyph, AgentMonogram } from "../src/components/agent";
import { renderWithTheme } from "./util/render-with-theme";

describe("agent brand icons", () => {
  it.each(["amp", "codex", "opencode"] as const)("renders %s as a brand SVG in monogram tiles", (agent) => {
    const { container, queryByText } = renderWithTheme(<AgentMonogram agent={agent} size={32} />);

    expect(container.querySelector(`svg[data-agent-brand-icon="${agent}"]`)).not.toBeNull();
    expect(queryByText(agent === "codex" ? "CX" : agent === "opencode" ? "OC" : "AM")).not.toBeInTheDocument();
  });

  it.each(["amp", "codex", "opencode"] as const)("renders %s as a brand SVG in compact glyphs", (agent) => {
    const { container, queryByText } = renderWithTheme(<AgentGlyph agent={agent} size={20} />);

    expect(container.querySelector(`svg[data-agent-brand-icon="${agent}"]`)).not.toBeNull();
    expect(queryByText(agent === "codex" ? "CX" : agent === "opencode" ? "OC" : "AM")).not.toBeInTheDocument();
  });
});
