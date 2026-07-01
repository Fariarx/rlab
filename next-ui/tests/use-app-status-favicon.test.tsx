import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStatusFavicon } from "../src/components/workspace/hooks/use-app-status-favicon";
import type { WorkspaceAttentionStatus } from "../src/components/workspace/models/workspace-attention-status-model";

function Harness({ status }: { readonly status: WorkspaceAttentionStatus | null }) {
  useAppStatusFavicon(status);
  return null;
}

describe("useAppStatusFavicon", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    document.head.innerHTML = "";
  });

  it("sets a static attention favicon without starting a frame timer", () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const initial = document.createElement("link");
    initial.rel = "icon";
    initial.href = "/favicon.ico";
    document.head.appendChild(initial);

    const { rerender } = render(<Harness status="action" />);

    const activeLink = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    expect(activeLink?.getAttribute("href")).toContain("data:image/svg+xml");
    expect(setIntervalSpy).not.toHaveBeenCalled();

    rerender(<Harness status={null} />);

    const restoredLink = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    expect(restoredLink?.getAttribute("href")).toBe("/favicon.ico");
  });
});
