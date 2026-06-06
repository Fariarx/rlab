import { type AgentBlock, type ChatMessage, type ComposerDraft, type ConversationSummary, type Project } from "../agent/types";
import { cloneAppSettings, defaultAppSettings, type AppSettings } from "./app-settings";
import { buildInitialThreads, initialChats, initialProjects } from "./sample-data";

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
        messages.map((message) => ({
          ...message,
          blocks: message.blocks?.map(cloneBlock),
        })),
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
  const profile = conversation.profile ?? { agent: conversation.agent, variant: "DEFAULT" };
  return { ...conversation, agent: profile.agent, profile };
}

function cloneBlock(block: AgentBlock): AgentBlock {
  return JSON.parse(JSON.stringify(block)) as AgentBlock;
}
