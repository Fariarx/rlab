import { expect, test } from "@playwright/test";

// Labels come from the default (Russian) locale in src/i18n/I18nProvider.tsx.
// The web server for these e2e runs boots with RLAB_DEMO=1 (see
// playwright.config.ts), so the workspace is seeded with demo conversations.
const L = {
  conversationList: "Список диалогов",
  viewSwitcher: "Переключатель Чат / Git / Ресурсы / Просмотр / Терминал",
  git: "Git",
  chatTab: "Чат",
  settings: "Настройки",
} as const;

test("agent workspace loads a thread, switches views, and opens settings", async ({ page }) => {
  await page.goto("/");

  // The app shell renders the conversation sidebar with at least one seeded thread.
  const conversations = page.getByRole("listbox", { name: L.conversationList });
  await expect(conversations).toBeVisible();
  await expect(conversations.getByRole("option").first()).toBeVisible();

  // The view switcher is always present; switch Chat -> Git -> Chat.
  const viewSwitcher = page.getByRole("group", { name: L.viewSwitcher });
  await expect(viewSwitcher).toBeVisible();
  const gitTab = viewSwitcher.getByRole("button", { name: L.git });
  await gitTab.click();
  await expect(gitTab).toHaveAttribute("aria-pressed", "true");
  const chatTab = viewSwitcher.getByRole("button", { name: L.chatTab });
  await chatTab.click();
  await expect(chatTab).toHaveAttribute("aria-pressed", "true");

  // The settings dialog opens and closes cleanly.
  await page.getByRole("button", { name: L.settings }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: L.settings })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
