import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KitPage } from "../src/components/kit/KitPage";
import { renderWithTheme } from "./util/render-with-theme";

describe("KitPage", () => {
  it("renders the showcase sections without throwing", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
    renderWithTheme(<KitPage />);

    expect(screen.getByRole("heading", { name: /цвета и токены/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /типографика/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /кнопки/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /блоки агента/i })).toBeInTheDocument();
    expect(screen.getByText("Стримящийся блок ответа")).toBeInTheDocument();
    expect(screen.getAllByText("src/session.ts").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: /рабочие поверхности/i })).toBeInTheDocument();
    expect(screen.getByRole("log", { name: "Вывод терминала" })).toBeInTheDocument();
    expect(screen.getByText("Агент может писать в /root/workspace/rlab")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /статусы и теги/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /данные и состояния/i })).toBeInTheDocument();
  });
});
