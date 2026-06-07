import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentBlockRenderer } from "../src/components/agent";
import { type WorkspaceUiApi, WorkspaceUiProvider } from "../src/components/workspace/workspace-ui";
import { renderWithTheme } from "./util/render-with-theme";

function makeUi(): WorkspaceUiApi {
  return { openPreview: vi.fn(), openGitFile: vi.fn(), revertFile: vi.fn() };
}

describe("chat link menu", () => {
  it("opens a menu offering preview or external open, and routes preview", () => {
    const ui = makeUi();
    renderWithTheme(
      <WorkspaceUiProvider value={ui}>
        <AgentBlockRenderer block={{ kind: "text", text: "Read [the docs](https://vitest.dev/api)." }} />
      </WorkspaceUiProvider>,
    );

    fireEvent.click(screen.getByText("the docs"));

    expect(screen.getByText("Открыть в просмотре")).toBeInTheDocument();
    expect(screen.getByText("Открыть ссылку")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Открыть в просмотре"));
    expect(ui.openPreview).toHaveBeenCalledWith("https://vitest.dev/api");
  });

  it("upgrades a bare-domain link before previewing it", () => {
    const ui = makeUi();
    renderWithTheme(
      <WorkspaceUiProvider value={ui}>
        <AgentBlockRenderer block={{ kind: "text", text: "Open [docs](vitest.dev/api/vi)." }} />
      </WorkspaceUiProvider>,
    );

    fireEvent.click(screen.getByText("docs"));
    fireEvent.click(screen.getByText("Открыть в просмотре"));
    expect(ui.openPreview).toHaveBeenCalledWith("https://vitest.dev/api/vi");
  });

  it("renders a plain link (no menu) outside the workspace", () => {
    renderWithTheme(<AgentBlockRenderer block={{ kind: "text", text: "Read [the docs](https://vitest.dev/api)." }} />);

    const link = screen.getByText("the docs");
    fireEvent.click(link);
    expect(screen.queryByText("Открыть в просмотре")).not.toBeInTheDocument();
    expect(link.closest("a")).toHaveAttribute("href", "https://vitest.dev/api");
  });
});
