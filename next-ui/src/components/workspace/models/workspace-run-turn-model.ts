import type { ChatMessage, ConversationSummary } from "../../agent";
import { previewSnippet } from "../../../lib/conversation-preview";
import { truncate } from "../sample-data";
import { promptForUserTurn } from "./workspace-thread-actions-model";
import { conversationProfile, conversationSessionId, isDefaultConversationTitle } from "./workspace-state-utils";

export interface WorkspaceRunTurnOptions {
  readonly promptOverride?: string;
  readonly initialContextTokens?: number;
}

export interface PrepareWorkspaceRunTurnInput {
  readonly conversation: ConversationSummary | null;
  readonly thread: readonly ChatMessage[];
  readonly userMessage: ChatMessage;
  readonly runId: string;
  readonly agentMessageId: string;
  readonly agentMessageTime: string;
  readonly agentStartedAtMs: number;
  readonly options?: WorkspaceRunTurnOptions;
}

export interface PreparedWorkspaceRunTurn {
  readonly profile: ReturnType<typeof conversationProfile>;
  readonly resume: string | undefined;
  readonly prompt: string;
  readonly conversationPatch: Partial<ConversationSummary>;
  readonly agentMessage: ChatMessage;
}

export function prepareWorkspaceRunTurn({
  conversation,
  thread,
  userMessage,
  runId,
  agentMessageId,
  agentMessageTime,
  agentStartedAtMs,
  options,
}: PrepareWorkspaceRunTurnInput): PreparedWorkspaceRunTurn {
  const profile = conversationProfile(conversation);
  const text = userMessage.text ?? "";
  const resume = conversationSessionId(conversation, profile.agent);
  const prompt = promptForUserTurn(thread, userMessage, Boolean(resume), options?.promptOverride);
  const runningPatch: Partial<ConversationSummary> = {
    activeRunId: runId,
    status: "running",
    snippet: previewSnippet(text, 60),
    time: agentMessageTime,
    unread: false,
    costUsd: undefined,
    usage: options?.initialContextTokens === undefined
      ? undefined
      : { ...(conversation?.usage ?? {}), contextTokens: options.initialContextTokens },
  };

  return {
    profile,
    resume,
    prompt,
    conversationPatch: isDefaultConversationTitle(conversation?.title) ? { ...runningPatch, title: truncate(text, 40) } : runningPatch,
    agentMessage: {
      id: agentMessageId,
      role: "agent",
      time: agentMessageTime,
      startedAtMs: agentStartedAtMs,
      profile,
      blocks: [],
    },
  };
}
