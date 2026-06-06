import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KitPage } from "../src/components/kit/KitPage";
import { renderWithTheme } from "./util/render-with-theme";

describe("KitPage", () => {
  it("renders the showcase sections without throwing", () => {
    renderWithTheme(<KitPage />);

    expect(screen.getByRole("heading", { name: /colors & tokens/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /typography/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /buttons/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /status & tags/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /data & state/i })).toBeInTheDocument();
  });
});
