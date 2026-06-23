import { ThemeProvider } from "@mui/material/styles";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitView, type DiffCommentApi } from "../src/components/workspace/git/GitPanel";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { appTheme } from "../src/theme/app-theme";

const statusPayload = {
  branch: "main",
  branches: ["main"],
  ahead: 0,
  behind: 0,
  clean: false,
  files: [{ code: " M", label: "Modified", path: "src/auth.ts", gitPath: "src/auth.ts", staged: false, unstaged: true }],
};

const unifiedDiff = [
  "diff --git a/src/auth.ts b/src/auth.ts",
  "index 1111111..2222222 100644",
  "--- a/src/auth.ts",
  "+++ b/src/auth.ts",
  "@@ -1 +1 @@",
  "-oldAuth",
  "+needsRefactor",
].join("\n");

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function requestPath(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.pathname;
  }
  return new URL(input.url).pathname;
}

function renderGitView(review: DiffCommentApi) {
  return (
    <ThemeProvider theme={appTheme}>
      <I18nProvider locale="ru">
        <GitView cwd="/repo" active review={review} />
      </I18nProvider>
    </ThemeProvider>
  );
}

describe("GitView diff card state", () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>(async (input) => {
      const path = requestPath(input);
      if (path === "/api/git-status") {
        return jsonResponse(statusPayload);
      }
      if (path === "/api/git-diff") {
        return jsonResponse({ diff: unifiedDiff, mode: "worktree", path: "src/auth.ts" });
      }
      return jsonResponse({ commits: [], branchHeads: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps an open review comment composer mounted across git status refreshes", async () => {
    const review: DiffCommentApi = {
      comments: [],
      onAddComment: vi.fn(),
      onDeleteComment: vi.fn(),
      onUpdateComment: vi.fn(),
    };
    render(renderGitView(review));

    const changedLine = await screen.findByText("needsRefactor");
    const changedLineRow = changedLine.closest("li")?.firstElementChild;
    expect(changedLineRow).toBeInstanceOf(HTMLElement);
    fireEvent.click(changedLineRow as HTMLElement);
    const input = await screen.findByTestId("git-comment-input");
    fireEvent.change(input, { target: { value: "keep this draft" } });

    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));

    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => requestPath(input) === "/api/git-status")).toHaveLength(2));
    expect(screen.getByTestId("git-comment-input")).toHaveValue("keep this draft");
  });
});
