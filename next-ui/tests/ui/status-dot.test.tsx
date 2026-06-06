import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusDot } from "../../src/components/ui";
import { renderWithTheme } from "../util/render-with-theme";

describe("StatusDot", () => {
  it("exposes its status through an accessible label", () => {
    renderWithTheme(<StatusDot status="running" label="Running" />);

    expect(screen.getByRole("img", { name: "Running" })).toBeInTheDocument();
  });

  it("labels distinct statuses distinctly", () => {
    renderWithTheme(<StatusDot status="error" label="Failed" />);

    expect(screen.getByRole("img", { name: "Failed" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Running" })).not.toBeInTheDocument();
  });
});
