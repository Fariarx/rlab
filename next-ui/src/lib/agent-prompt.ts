import type { ChatMessage } from "../domain/agent-types";

/** A lean transcript line for one message: the user's text, or the agent's
 *  answer (text/code blocks only; reasoning and tool noise are omitted). */
function messageTranscriptText(message: ChatMessage): string {
  if (message.role === "user") {
    return (message.text ?? "").trim();
  }
  return (message.blocks ?? [])
    .map((block) => (block.kind === "text" ? block.text : block.kind === "code" ? block.code : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** Builds the agent prompt from the conversation so far. Each agent run is a
 *  fresh, stateless invocation (no session/resume), so prior turns must be
 *  replayed in the prompt or the agent loses the thread. First message in a
 *  conversation uses only the current text. */
export function buildAgentPrompt(priorMessages: readonly ChatMessage[], currentText: string): string {
  const turns = priorMessages
    .map((message) => {
      const content = messageTranscriptText(message);
      return content ? `${message.role === "user" ? "User" : "Assistant"}: ${content}` : null;
    })
    .filter((line): line is string => line !== null);
  if (turns.length === 0) {
    return currentText;
  }
  return `This is a continuing conversation; here are the earlier turns for context:\n\n${turns.join("\n\n")}\n\n---\n\nUser: ${currentText}`;
}

export function promptForUserTurn(
  thread: readonly ChatMessage[],
  userMsg: ChatMessage,
  canResume: boolean,
  promptOverride: string | undefined,
): string {
  const text = userMsg.text ?? "";
  if (promptOverride !== undefined) {
    return promptOverride;
  }
  if (canResume) {
    return text;
  }
  const userIndex = thread.findIndex((message) => message.id === userMsg.id);
  const priorMessages = userIndex >= 0 ? thread.slice(0, userIndex) : thread.filter((message) => message.id !== userMsg.id);
  return buildAgentPrompt(priorMessages, text);
}
