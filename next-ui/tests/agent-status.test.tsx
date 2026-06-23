import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentStatusProvider, useAgentStatus, useAgentStatusError, useAgentStatusLive, useReloadAgentStatus } from "../src/components/agent";

function Probe() {
  const statusOf = useAgentStatus();
  const error = useAgentStatusError();
  const live = useAgentStatusLive();
  return (
    <div>
      <output data-testid="error">{error ?? "none"}</output>
      <output data-testid="live">{live ? "live" : "offline"}</output>
      <output data-testid="claude">{statusOf("claude-code")}</output>
    </div>
  );
}

function ReloadProbe() {
  const reload = useReloadAgentStatus();
  return <button onClick={reload}>reload</button>;
}

describe("AgentStatusProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries failed agent detection every 15 seconds", async () => {
    vi.useFakeTimers();
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
        if (path === "/api/agents") {
          reads += 1;
          if (reads === 1) {
            throw new TypeError("Failed to fetch");
          }
          return Response.json({ "claude-code": "available" });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    render(
      <AgentStatusProvider>
        <Probe />
      </AgentStatusProvider>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("error")).toHaveTextContent("Failed to fetch");
    expect(screen.getByTestId("claude")).toHaveTextContent("unavailable");
    expect(reads).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999);
    });
    expect(reads).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(screen.getByTestId("error")).toHaveTextContent("none");
    expect(screen.getByTestId("live")).toHaveTextContent("live");
    expect(screen.getByTestId("claude")).toHaveTextContent("available");
    expect(reads).toBe(2);
  });

  it("refreshes successful agent detection every 5 minutes", async () => {
    vi.useFakeTimers();
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const path = typeof url === "string" ? url : url instanceof URL ? url.pathname : url.url;
        if (path === "/api/agents") {
          reads += 1;
          return Response.json({ "claude-code": "available" });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    render(
      <AgentStatusProvider>
        <Probe />
      </AgentStatusProvider>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(reads).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299_999);
    });
    expect(reads).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(screen.getByTestId("live")).toHaveTextContent("live");
    expect(reads).toBe(2);
  });

  it("uses cheap status detection automatically and live model discovery only on manual reload", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const value = typeof url === "string" ? url : url instanceof URL ? `${url.pathname}${url.search}` : url.url;
        urls.push(value);
        return Response.json({ "claude-code": "available" });
      }),
    );

    render(
      <AgentStatusProvider>
        <Probe />
        <ReloadProbe />
      </AgentStatusProvider>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(urls).toEqual(["/api/agents"]);

    fireEvent.click(screen.getByRole("button", { name: "reload" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(urls).toEqual(["/api/agents", "/api/agents?live=1"]);
  });
});
