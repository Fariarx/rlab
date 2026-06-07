import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Message } from "../src/components/agent";
import { type ChatMessage } from "../src/components/agent/types";
import { type WorkspaceUiApi, WorkspaceUiProvider } from "../src/components/workspace/workspace-ui";
import { renderWithTheme } from "./util/render-with-theme";

const diffMessage: ChatMessage = {
  id: "a1",
  role: "agent",
  blocks: [
    { kind: "reasoning", text: "Thinking about the fix.", duration: "2s" },
    { kind: "text", text: "Applied the change." },
    {
      kind: "diff",
      file: "src/login.ts",
      additions: 1,
      deletions: 1,
      lines: [
        { type: "del", text: "const a = 1;" },
        { type: "add", text: "const a = 2;" },
      ],
    },
  ],
};

describe("agent message diffs", () => {
  it("surfaces the diff under the message (not inside the collapsed reasoning) with revert + open-in-git", () => {
    const ui: WorkspaceUiApi = { openPreview: vi.fn(), openGitFile: vi.fn(), revertFile: vi.fn() };
    renderWithTheme(
      <WorkspaceUiProvider value={ui}>
        <Message message={diffMessage} index={0} />
      </WorkspaceUiProvider>,
    );

    // The diff card is visible (open) without expanding the reasoning container.
    expect(screen.getByText("src/login.ts")).toBeInTheDocument();
    expect(screen.getByText("const a = 2;")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Открыть в Git"));
    expect(ui.openGitFile).toHaveBeenCalledWith("src/login.ts");

    fireEvent.click(screen.getByLabelText("Отменить изменения"));
    expect(ui.revertFile).toHaveBeenCalledWith("src/login.ts");
  });

  it("omits diff actions when there is no workspace context", () => {
    renderWithTheme(<Message message={diffMessage} index={0} />);
    expect(screen.getByText("src/login.ts")).toBeInTheDocument();
    expect(screen.queryByLabelText("Открыть в Git")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Отменить изменения")).not.toBeInTheDocument();
  });
});
