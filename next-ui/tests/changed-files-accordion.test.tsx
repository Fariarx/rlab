import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChangedFilesAccordion } from "../src/components/agent/message/ChangedFilesAccordion";
import type { DiffBlock } from "../src/components/agent/core/types";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { renderWithTheme } from "./util/render-with-theme";

const diffBlocks: readonly DiffBlock[] = [
  {
    kind: "diff",
    file: "src/app.ts",
    additions: 2,
    deletions: 1,
    lines: [
      { type: "ctx", text: "const value = 1;" },
      { type: "del", text: "oldCall();" },
      { type: "add", text: "newCall();" },
    ],
  },
  {
    kind: "diff",
    file: "src/model.ts",
    additions: 1,
    deletions: 0,
    lines: [{ type: "add", text: "export const ready = true;" }],
  },
];

function renderAccordion() {
  return renderWithTheme(
    <I18nProvider locale="ru">
      <ChangedFilesAccordion blocks={diffBlocks} delay={0} />
    </I18nProvider>,
  );
}

describe("ChangedFilesAccordion", () => {
  it("summarizes changed files and reveals diff cards on expand", () => {
    renderAccordion();

    const disclosure = screen.getByRole("button", { name: /изменённые файлы/i });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("2 файлов")).toBeInTheDocument();
    expect(screen.getByText("+3")).toBeInTheDocument();
    expect(screen.getByText("−1")).toBeInTheDocument();
    expect(screen.queryByText(/src\/app\.ts/)).not.toBeInTheDocument();

    fireEvent.click(disclosure);

    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/src\/app\.ts/)).toBeInTheDocument();
    expect(screen.getByText(/src\/model\.ts/)).toBeInTheDocument();
  });
});
