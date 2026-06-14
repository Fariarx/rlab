import type { ComposerPluginLink } from "../../../lib/rlab-plugins";
import { mentionQuery, pluginLinkQuery } from "./composer-utils";

export type ComposerSuggestionKind = "file" | "plugin";

export interface ComposerSuggestion {
  readonly id: string;
  readonly label: string;
  readonly kind: ComposerSuggestionKind;
  readonly mono: boolean;
  readonly value: string;
}

export interface ComposerSuggestionsState {
  readonly suggestions: readonly ComposerSuggestion[];
  readonly open: boolean;
  readonly activeIndex: number;
  readonly key: string;
}

export function composerMentionSuggestions(value: string, mentionableFiles: readonly string[]): readonly string[] {
  const query = mentionQuery(value);
  return query == null ? [] : mentionableFiles.filter((file) => file.toLowerCase().includes(query)).slice(0, 8);
}

export function composerPluginSuggestions(value: string, plugins: readonly ComposerPluginLink[]): readonly ComposerPluginLink[] {
  const query = pluginLinkQuery(value);
  return query == null
    ? []
    : plugins
        .filter((plugin) => {
          const haystack = `${plugin.id} ${plugin.label} ${plugin.token}`.toLowerCase();
          return haystack.includes(query);
        })
        .slice(0, 8);
}

export function composerSuggestions(
  value: string,
  mentionableFiles: readonly string[],
  plugins: readonly ComposerPluginLink[],
  dismissed: boolean,
  activeSuggestion: number,
): ComposerSuggestionsState {
  const pluginSuggestions = composerPluginSuggestions(value, plugins);
  const suggestions =
    pluginSuggestions.length > 0
      ? pluginSuggestions.map((plugin): ComposerSuggestion => ({ id: plugin.id, label: plugin.token, kind: "plugin", mono: true, value: plugin.token }))
      : composerMentionSuggestions(value, mentionableFiles).map((file): ComposerSuggestion => ({ id: file, label: file, kind: "file", mono: true, value: file }));
  return {
    suggestions,
    open: suggestions.length > 0 && !dismissed,
    activeIndex: Math.min(activeSuggestion, Math.max(suggestions.length - 1, 0)),
    key: suggestions.map((suggestion) => suggestion.id).join("|"),
  };
}

export function applyComposerSuggestion(value: string, suggestion: ComposerSuggestion): string {
  return suggestion.kind === "plugin"
    ? value.replace(/(^|\s)\$([^\s$]*)$/, (_match, prefix: string) => `${prefix}${suggestion.value} `)
    : value.replace(/@([^\s@/]*)$/, `@${suggestion.value} `);
}
