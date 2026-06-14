import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useComposerDockHeight } from "../src/components/workspace/hooks/use-composer-dock-height";

const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");

function Harness({
  visible,
  setHeight,
}: {
  readonly visible: boolean;
  readonly setHeight: (height: number) => void;
}) {
  const ref = useComposerDockHeight({ visible, setHeight });
  return <div ref={ref} />;
}

describe("useComposerDockHeight", () => {
  afterEach(() => {
    if (originalOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
    }
  });

  it("clears the height when the composer is hidden", () => {
    const setHeight = vi.fn();

    render(<Harness visible={false} setHeight={setHeight} />);

    expect(setHeight).toHaveBeenCalledWith(0);
  });

  it("reports the mounted composer dock height", () => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get: () => 48,
    });
    const setHeight = vi.fn();

    render(<Harness visible setHeight={setHeight} />);

    expect(setHeight).toHaveBeenCalledWith(48);
  });
});
