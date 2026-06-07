import { type AgentBlock, type ChatMessage, type ComposerDraft, type ConversationSummary, type Project } from "../components/agent/types";
import { normalizeAgentProfile } from "./agent-catalog";
import { cloneAppSettings, defaultAppSettings, type AppSettings } from "./app-settings";
import { buildInitialThreads, initialChats, initialProjects } from "./workspace-sample-data";

export interface WorkspaceState {
  readonly chats: ConversationSummary[];
  readonly projects: Project[];
  readonly threads: Record<string, ChatMessage[]>;
  readonly composerDrafts: Record<string, ComposerDraft>;
  readonly selectedId: string;
  readonly settings: AppSettings;
}

export function buildInitialWorkspaceState(): WorkspaceState {
  return {
    chats: [...initialChats],
    projects: initialProjects.map((project) => ({
      ...project,
      conversations: [...project.conversations],
    })),
    threads: buildInitialThreads(),
    composerDrafts: {},
    selectedId: "chat-2",
    settings: cloneAppSettings(defaultAppSettings),
  };
}

export function cloneWorkspaceState(state: WorkspaceState): WorkspaceState {
  return {
    chats: state.chats.map(cloneConversation),
    projects: state.projects.map((project) => ({
      ...project,
      conversations: project.conversations.map(cloneConversation),
    })),
    threads: Object.fromEntries(
      Object.entries(state.threads).map(([id, messages]) => [
        id,
        cloneThreadMessages(messages),
      ]),
    ),
    composerDrafts: Object.fromEntries(
      Object.entries(state.composerDrafts).map(([id, draft]) => [
        id,
        {
          text: draft.text,
          attachments: draft.attachments.map((attachment) => ({ ...attachment })),
        },
      ]),
    ),
    selectedId: state.selectedId,
    settings: cloneAppSettings(state.settings),
  };
}

function cloneConversation(conversation: ConversationSummary): ConversationSummary {
  const profile = normalizeAgentProfile(conversation.profile, conversation.agent);
  return { ...conversation, agent: profile.agent, profile };
}

function cloneThreadMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  const seen = new Map<string, number>();
  return messages.map((message) => {
    const count = seen.get(message.id) ?? 0;
    seen.set(message.id, count + 1);
    const id = count === 0 ? message.id : `${message.id}-${count + 1}`;
    return {
      ...message,
      id,
      blocks: message.blocks?.map(cloneBlock),
    };
  });
}

function cloneBlock(block: AgentBlock): AgentBlock {
  return JSON.parse(JSON.stringify(block)) as AgentBlock;
}
