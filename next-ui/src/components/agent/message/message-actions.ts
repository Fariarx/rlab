import { normalizeAgentToolOutput } from "../../../lib/agent-output";
import { reviewCommentsPromptText } from "../../../lib/agent-prompt";
import type { AgentBlock, ApprovalDecision, ChatMessage } from "../core/types";

export interface MessageActionHandlers {
  readonly onCopy?: (message: ChatMessage) => void;
  readonly onRetry?: (message: ChatMessage) => void;
  readonly onFork?: (message: ChatMessage) => void;
  readonly onEditAndResend?: (message: ChatMessage, text: string) => void;
  readonly onApprovalDecision?: (approvalId: string, decision: ApprovalDecision) => void | Promise<void>;
  readonly onOptionSelection?: (optionBlockId: string, selectedLabels: readonly string[]) => void | Promise<void>;
}

export function messageToPlainText(message: ChatMessage): string {
  if (message.role === "user") {
    return message.text ?? "";
  }
  return (message.blocks ?? []).map(blockToPlainText).filter(Boolean).join("\n\n");
}

function blockToPlainText(block: AgentBlock): string {
  switch (block.kind) {
    case "text":
    case "reasoning":
    case "status":
      return block.text;
    case "code":
      return block.code;
    case "command":
      return [block.command, block.output ? normalizeAgentToolOutput(block.output) : undefined].filter(Boolean).join("\n");
    case "tool":
      return [block.name, block.summary, block.output ? normalizeAgentToolOutput(block.output) : undefined].filter(Boolean).join("\n");
    case "diff":
      return `${block.file}\n${block.lines.map((line) => `${line.type}: ${line.text}`).join("\n")}`;
    case "search":
      return [block.query, ...block.results.map((result) => `${result.title} ${result.url}`)].join("\n");
    case "plan":
      return block.steps.map((step) => `${step.state}: ${step.label}`).join("\n");
    case "options":
      return [block.prompt, ...block.options.map((option) => option.label)].join("\n");
    case "approval":
      return [block.title, block.detail].filter(Boolean).join("\n");
    case "citation":
      return block.sources.map((source) => `${source.label} ${source.url}`).join("\n");
    case "suggested":
      return block.actions.map((action) => action.label).join("\n");
    case "review":
      return reviewCommentsPromptText(block.comments);
  }
}
