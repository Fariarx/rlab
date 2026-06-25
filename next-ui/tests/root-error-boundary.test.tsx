import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RootErrorBoundary } from "../src/RootErrorBoundary";

function StableChild() {
  return <div>workspace rendered</div>;
}

describe("RootErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children when the app tree is healthy", () => {
    render(
      <RootErrorBoundary>
        <StableChild />
      </RootErrorBoundary>,
    );

    expect(screen.getByText("workspace rendered")).toBeInTheDocument();
    expect(screen.queryByTestId("root-error-boundary")).not.toBeInTheDocument();
  });

  it("shows a diagnostic root crash screen for render errors", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const BrokenChild = () => {
      throw new Error("mobile composer exploded");
    };

    render(
      <RootErrorBoundary>
        <BrokenChild />
      </RootErrorBoundary>,
    );

    expect(screen.getByTestId("root-error-boundary")).toBeInTheDocument();
    expect(screen.getByText("rlab client crashed")).toBeInTheDocument();
    expect(screen.getAllByText(/mobile composer exploded/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Component stack:/)).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("[rlab] Uncaught React render error"), expect.any(Error), expect.any(String));
  });

  it("can retry rendering after the crashing condition is gone", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let shouldThrow = true;
    const MaybeBrokenChild = () => {
      if (shouldThrow) {
        throw new Error("temporary render failure");
      }
      return <div>workspace recovered</div>;
    };

    render(
      <RootErrorBoundary>
        <MaybeBrokenChild />
      </RootErrorBoundary>,
    );

    expect(screen.getByTestId("root-error-boundary")).toBeInTheDocument();
    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry render" }));

    expect(screen.getByText("workspace recovered")).toBeInTheDocument();
    expect(screen.queryByTestId("root-error-boundary")).not.toBeInTheDocument();
  });

  it("does not crash the app for browser ResizeObserver loop notifications", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <RootErrorBoundary>
        <StableChild />
      </RootErrorBoundary>,
    );

    act(() => {
      window.dispatchEvent(
        new ErrorEvent("error", {
          message: "ResizeObserver loop completed with undelivered notifications.",
          error: new Error("ResizeObserver loop completed with undelivered notifications."),
        }),
      );
    });

    expect(screen.getByText("workspace rendered")).toBeInTheDocument();
    expect(screen.queryByTestId("root-error-boundary")).not.toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("still reports real window errors", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <RootErrorBoundary>
        <StableChild />
      </RootErrorBoundary>,
    );

    act(() => {
      window.dispatchEvent(new ErrorEvent("error", { message: "real window failure", error: new Error("real window failure") }));
    });

    expect(screen.getByTestId("root-error-boundary")).toBeInTheDocument();
    expect(screen.getAllByText(/real window failure/).length).toBeGreaterThan(0);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("[rlab] Uncaught window error"), expect.any(Error));
  });
});
