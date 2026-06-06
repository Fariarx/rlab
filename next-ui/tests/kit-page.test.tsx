import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KitPage } from "../src/components/kit/KitPage";
import { renderWithTheme } from "./util/render-with-theme";

describe("KitPage", () => {
  it("renders the showcase sections without throwing", () => {
    renderWithTheme(<KitPage />);

    expect(screen.getByRole("heading", { name: /цвета и токены/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /типографика/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /кнопки/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /блоки агента/i })).toBeInTheDocument();
    expect(screen.getByText("Стримящийся блок ответа")).toBeInTheDocument();
    expect(screen.getAllByText("src/session.ts").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: /статусы и теги/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /данные и состояния/i })).toBeInTheDocument();
  });
});
