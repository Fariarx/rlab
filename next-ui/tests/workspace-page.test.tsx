import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspacePage } from "../src/components/workspace/WorkspacePage";
import { renderWithTheme } from "./util/render-with-theme";

describe("WorkspacePage", () => {
  it("renders the sidebar, chats list, and conversation thread", () => {
    renderWithTheme(<WorkspacePage />);

    expect(screen.getByText("rlab / agents")).toBeInTheDocument();
    // Appears in both the sidebar row and the pane header.
    expect(screen.getAllByText(/Draft release notes/i).length).toBeGreaterThan(0);
    // Default conversation thread (release notes) is rendered in the pane.
    expect(screen.getByText(/from the merged PRs/i)).toBeInTheDocument();
  });

  it("switches to the Projects mode", () => {
    renderWithTheme(<WorkspacePage />);

    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    expect(screen.getByText("auth-service")).toBeInTheDocument();
  });

  it("opens the agent picker from the agent badge", () => {
    renderWithTheme(<WorkspacePage />);

    fireEvent.click(screen.getByRole("button", { name: /Change agent/i }));
    expect(screen.getByText("Choose agent")).toBeInTheDocument();
  });

  it("sends a message into the active conversation", () => {
    renderWithTheme(<WorkspacePage />);

    const input = screen.getByPlaceholderText(/^Message /);
    fireEvent.change(input, { target: { value: "Ship it" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Appears as the new user message in the thread (and as the sidebar snippet).
    expect(screen.getAllByText("Ship it").length).toBeGreaterThan(0);
  });
});
