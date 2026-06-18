import { useMemo } from "react";
import type { I18nApi } from "../../../i18n/I18nProvider";
import type { CommandPaletteItem } from "./use-command-palette-controller";

export interface UseWorkspaceCommandItemsOptions {
  readonly t: I18nApi["t"];
  readonly createConversation: () => void;
  readonly openConversationSearch: () => void;
  readonly openSettings: () => void;
  readonly openGit: () => void;
  readonly openPreview: () => void;
  readonly previewEnabled: boolean;
  readonly toggleTheme: () => void;
  readonly openKit: () => void;
}

export function useWorkspaceCommandItems({
  t,
  createConversation,
  openConversationSearch,
  openSettings,
  openGit,
  openPreview,
  previewEnabled,
  toggleTheme,
  openKit,
}: UseWorkspaceCommandItemsOptions): readonly CommandPaletteItem[] {
  return useMemo(
    () => [
      {
        id: "new-conversation",
        label: t("commandNewConversation"),
        keywords: [t("newConversation"), t("newChat")],
        shortcut: ["Ctrl", "N"],
        action: createConversation,
      },
      {
        id: "search-conversations",
        label: t("searchConversations"),
        keywords: [t("chats"), t("projects"), "search"],
        action: openConversationSearch,
      },
      {
        id: "open-settings",
        label: t("commandOpenSettings"),
        keywords: [t("settings"), t("appearance"), t("general")],
        shortcut: ["Ctrl", ","],
        action: openSettings,
      },
      {
        id: "open-git",
        label: t("commandOpenGit"),
        keywords: [t("git"), t("gitStatus")],
        action: openGit,
      },
      ...(previewEnabled
        ? [
            {
              id: "open-preview",
              label: t("commandOpenPreview"),
              keywords: [t("previewTab"), t("browserPreviewTitle")],
              action: openPreview,
            },
          ]
        : []),
      {
        id: "toggle-theme",
        label: t("commandToggleTheme"),
        keywords: [t("theme"), t("dark"), t("light")],
        action: toggleTheme,
      },
      {
        id: "open-kit",
        label: t("commandOpenKit"),
        keywords: [t("kit")],
        action: openKit,
      },
    ],
    [createConversation, openConversationSearch, openGit, openKit, openPreview, openSettings, previewEnabled, t, toggleTheme],
  );
}
