import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { Composer, type ComposerHandle } from "../src/components/agent";
import { renderWithTheme } from "./util/render-with-theme";

describe("Composer", () => {
  it("sends selected text attachments with the prompt", async () => {
    const onSend = vi.fn();
    renderWithTheme(<Composer placeholder="Написать" onSend={onSend} />);

    const fileInput = screen.getByLabelText("Выбрать файлы");
    const file = new File(["hello from file"], "notes.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.change(screen.getByPlaceholderText("Написать"), { target: { value: "Read this" } });

    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith(
        [
          "Read this",
          "",
          "<attachment name=\"notes.txt\" type=\"text/plain\">",
          "hello from file",
          "</attachment>",
        ].join("\n"),
      );
    });
  });

  it("inserts a mentioned project file into the prompt", () => {
    renderWithTheme(<Composer placeholder="Написать" mentionableFiles={["src/auth.ts", "README.md"]} />);

    fireEvent.change(screen.getByPlaceholderText("Написать"), { target: { value: "Read @" } });
    fireEvent.click(screen.getByRole("option", { name: "src/auth.ts" }));

    expect(screen.getByPlaceholderText("Написать")).toHaveValue("Read @src/auth.ts ");
  });

  it("expands slash commands into working prompts", () => {
    renderWithTheme(<Composer placeholder="Написать" />);

    fireEvent.change(screen.getByPlaceholderText("Написать"), { target: { value: "/" } });
    fireEvent.click(screen.getByRole("option", { name: "/plan" }));

    expect(screen.getByPlaceholderText("Написать")).toHaveValue("Составь план реализации перед изменениями. ");
  });

  it("navigates the suggestion popover with the arrow keys and selects with Enter", () => {
    renderWithTheme(<Composer placeholder="Написать" />);
    const input = screen.getByPlaceholderText("Написать");

    fireEvent.change(input, { target: { value: "/" } });
    // The list opens with the first item active.
    expect(screen.getByRole("option", { name: "/plan" })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "/test" })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("Запусти релевантные тесты и сообщи результат. ");
  });

  it("attaches files handed in by the parent drop zone", async () => {
    const ref = createRef<ComposerHandle>();
    renderWithTheme(<Composer ref={ref} placeholder="Написать" />);

    const file = new File(["payload"], "drop.txt", { type: "text/plain" });
    await act(async () => {
      await ref.current?.addFiles([file]);
    });

    expect(await screen.findByText("drop.txt")).toBeInTheDocument();
  });

  it("dismisses the suggestion popover with Escape without sending", () => {
    const onSend = vi.fn();
    renderWithTheme(<Composer placeholder="Написать" onSend={onSend} />);
    const input = screen.getByPlaceholderText("Написать");

    fireEvent.change(input, { target: { value: "/" } });
    expect(screen.getByRole("listbox", { name: "Подсказки" })).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Подсказки" })).not.toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("lifts the input into an overlay when the text becomes multiline", () => {
    renderWithTheme(<Composer placeholder="Написать" />);
    const area = screen.getByTestId("composer-input-area");
    expect(area).toHaveAttribute("data-expanded", "false");

    fireEvent.change(screen.getByPlaceholderText("Написать"), { target: { value: "line one\nline two" } });

    expect(area).toHaveAttribute("data-expanded", "true");
    // The same single field is reused — no duplicate input is rendered behind the overlay.
    expect(screen.getAllByPlaceholderText("Написать")).toHaveLength(1);
  });

  it("collapses the overlay back to a single row when multiline content is cleared", () => {
    renderWithTheme(<Composer placeholder="Написать" />);
    const input = screen.getByPlaceholderText("Написать");

    fireEvent.change(input, { target: { value: "a\nb" } });
    expect(screen.getByTestId("composer-input-area")).toHaveAttribute("data-expanded", "true");

    fireEvent.change(input, { target: { value: "a" } });
    expect(screen.getByTestId("composer-input-area")).toHaveAttribute("data-expanded", "false");
  });

  it("pins work mode switches to the menu edge", () => {
    renderWithTheme(
      <Composer
        placeholder="Написать"
        modes={[
          { id: "plan", label: "Plan" },
          { id: "review", label: "Review" },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Опции" }));

    const planItem = screen.getByRole("menuitem", { name: "Plan" });
    const switchRoot = within(planItem).getByRole("switch").closest(".MuiSwitch-root");

    expect(planItem).toHaveStyle({ paddingRight: "4px" });
    expect(switchRoot).toHaveStyle({ marginLeft: "auto", marginRight: "-1px" });
  });
});
