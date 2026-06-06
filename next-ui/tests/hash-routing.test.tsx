import { fireEvent, screen } from "@testing-library/react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";

describe("hash routing", () => {
  it("opens a chat deep link", () => {
    window.location.hash = "#/chat/chat-1";

    renderApp();

    expect(screen.getAllByText("Объясни auth flow").length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText("Написать: Объясни auth flow...")).toBeInTheDocument();
  });

  it("opens a project conversation deep link in Projects mode", () => {
    window.location.hash = "#/project/auth-service/c-jwt";

    renderApp();

    expect(screen.getByRole("button", { name: "Проекты" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText("Ротация JWT-секретов").length).toBeGreaterThan(0);
    expect(screen.getByText("Ждёт подтверждение deploy")).toBeInTheDocument();
  });

  it("updates the hash when a project conversation is selected", () => {
    window.location.hash = "#/project/auth-service/c-flaky";

    renderApp();
    fireEvent.click(screen.getByText("Ротация JWT-секретов"));

    expect(window.location.hash).toBe("#/project/auth-service/c-jwt");
  });
});

function renderApp() {
  return render(<App />);
}
