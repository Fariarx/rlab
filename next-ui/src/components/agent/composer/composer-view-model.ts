import { useMemo } from "react";
import type { I18nApi } from "../../../i18n/I18nProvider";
import type { AgentRateLimit } from "../../../lib/agent-limits";
import type { ComposerPluginLink } from "../../../lib/rlab-plugins";
import { composerContextUsage, composerLimitLines } from "./composer-limits-model";
import { pluginPreviewParts as buildPluginPreviewParts, pluginTokenPattern, pluginTokenRanges } from "./composer-plugin-tokens";
import { composerSuggestions } from "./composer-suggestions-model";

export interface ComposerViewModelInput {
  readonly activeSuggestion: number;
  readonly agentId?: string;
  readonly agentLimit: AgentRateLimit | null;
  readonly agentLimitLoaded: boolean;
  readonly agentLimitRefreshError: string | null;
  readonly agentLimitRefreshing: boolean;
  readonly composerValue: string;
  readonly contextTokens?: number;
  readonly contextWindow?: number;
  readonly limitOpen: boolean;
  readonly mentionableFiles: readonly string[];
  readonly registeredPlugins: readonly ComposerPluginLink[];
  readonly suggestDismissed: boolean;
  readonly t: I18nApi["t"];
}

export function composerViewModel({
  registeredPlugins,
  ...input
}: ComposerViewModelInput) {
  return composerViewModelWithTokenPattern({ ...input, registeredPlugins }, pluginTokenPattern(registeredPlugins));
}

function composerViewModelWithTokenPattern({
  activeSuggestion,
  agentId,
  agentLimit,
  agentLimitLoaded,
  agentLimitRefreshError,
  agentLimitRefreshing,
  composerValue,
  contextTokens,
  contextWindow,
  limitOpen,
  mentionableFiles,
  registeredPlugins,
  suggestDismissed,
  t,
}: ComposerViewModelInput, tokenPattern: RegExp | null) {
  const suggestionsState = composerSuggestions(composerValue, mentionableFiles, registeredPlugins, suggestDismissed, activeSuggestion);
  const tokenRanges = pluginTokenRanges(composerValue, tokenPattern);
  const pluginPreviewParts = buildPluginPreviewParts(composerValue, tokenRanges);
  const limitLines = composerLimitLines(agentLimit, t);

  return {
    context: composerContextUsage({ agentId, contextTokens, contextWindow }),
    limitLayoutKey: `${agentLimitLoaded}:${agentLimitRefreshError ?? ""}:${agentLimitRefreshing}:${limitOpen}:${limitLines.length}`,
    limitLines,
    pluginPreviewParts,
    pluginTokenRanges: tokenRanges,
    suggestionsState,
  };
}

export function useComposerViewModel(input: ComposerViewModelInput) {
  const {
    activeSuggestion,
    agentId,
    agentLimit,
    agentLimitLoaded,
    agentLimitRefreshError,
    agentLimitRefreshing,
    composerValue,
    contextTokens,
    contextWindow,
    limitOpen,
    mentionableFiles,
    registeredPlugins,
    suggestDismissed,
    t,
  } = input;
  const tokenPattern = useMemo(() => pluginTokenPattern(registeredPlugins), [registeredPlugins]);

  return useMemo(
    () =>
      composerViewModelWithTokenPattern({
        activeSuggestion,
        agentId,
        agentLimit,
        agentLimitLoaded,
        agentLimitRefreshError,
        agentLimitRefreshing,
        composerValue,
        contextTokens,
        contextWindow,
        limitOpen,
        mentionableFiles,
        registeredPlugins,
        suggestDismissed,
        t,
      }, tokenPattern),
    [
      activeSuggestion,
      agentId,
      agentLimit,
      agentLimitLoaded,
      agentLimitRefreshError,
      agentLimitRefreshing,
      composerValue,
      contextTokens,
      contextWindow,
      limitOpen,
      mentionableFiles,
      registeredPlugins,
      suggestDismissed,
      t,
      tokenPattern,
    ],
  );
}
