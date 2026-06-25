import type { ChatMessage, ReviewCommentEntry } from "../domain/agent-types";

const REVIEW_PROMPT_LINE_MAX = 220;

function compactPromptLine(value: string): string {
  const line = value.replace(/\s+$/u, "");
  return line.length > REVIEW_PROMPT_LINE_MAX ? `${line.slice(0, REVIEW_PROMPT_LINE_MAX - 3)}...` : line;
}

function reviewCommentPromptLines(comment: ReviewCommentEntry, index: number): readonly string[] {
  const lines = [`${index + 1}. ${comment.file}:${comment.line}`];
  if (comment.hunkHeader) {
    lines.push(`Hunk: ${compactPromptLine(comment.hunkHeader)}`);
  }
  if (comment.diffLine) {
    lines.push(`Line: ${compactPromptLine(comment.diffLine)}`);
  } else if (comment.lineText) {
    lines.push(`Line: ${compactPromptLine(comment.lineText)}`);
  }
  if (comment.diffContext && comment.diffContext.length > 0) {
    lines.push("Context:");
    for (const contextLine of comment.diffContext) {
      lines.push(`  ${compactPromptLine(contextLine)}`);
    }
  }
  lines.push(`Comment: ${comment.body}`);
  return lines;
}

export function reviewCommentsPromptText(comments: readonly ReviewCommentEntry[]): string {
  if (comments.length === 0) {
    return "";
  }
  return [
    "Git review comments. Use file, hunk, line, and compact diff context to locate each target exactly.",
    ...comments.flatMap((comment, index) => ["", ...reviewCommentPromptLines(comment, index)]),
  ].join("\n");
}

function userMessagePromptText(message: ChatMessage): string {
  const text = (message.text ?? "").trim();
  const reviewText = (message.blocks ?? [])
    .filter((block) => block.kind === "review")
    .map((block) => reviewCommentsPromptText(block.comments))
    .filter(Boolean)
    .join("\n\n");
  return [text, reviewText].filter(Boolean).join("\n\n");
}

/** A lean transcript line for one message: the user's text, or the agent's
 *  answer (text/code blocks only; reasoning and tool noise are omitted). */
function messageTranscriptText(message: ChatMessage): string {
  if (message.role === "user") {
    return userMessagePromptText(message);
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
  const text = userMessagePromptText(userMsg);
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
