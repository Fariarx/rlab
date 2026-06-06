import { CommandCard, SearchCard, ToolCall } from "./actions";
import { ApprovalRequest } from "./ApprovalRequest";
import { DiffCard } from "./DiffCard";
import { OptionSelect } from "./OptionSelect";
import { PlanSteps } from "./PlanSteps";
import { Reasoning } from "./Reasoning";
import { CodeBlock, Citations, MessageText, StatusNote, SuggestedActions } from "./parts";
import { type AgentBlock } from "./types";

/** Maps an agent block to its renderer. The single switch keeps the block union
 * exhaustive — adding a kind to types.ts surfaces a missing case here. */
export function AgentBlockRenderer({ block }: { readonly block: AgentBlock }) {
  switch (block.kind) {
    case "text":
      return <MessageText text={block.text} streaming={block.streaming} />;
    case "reasoning":
      return <Reasoning block={block} />;
    case "tool":
      return <ToolCall block={block} />;
    case "command":
      return <CommandCard block={block} />;
    case "diff":
      return <DiffCard block={block} />;
    case "search":
      return <SearchCard block={block} />;
    case "plan":
      return <PlanSteps block={block} />;
    case "options":
      return <OptionSelect block={block} />;
    case "approval":
      return <ApprovalRequest block={block} />;
    case "code":
      return <CodeBlock language={block.language} code={block.code} />;
    case "status":
      return <StatusNote level={block.level}>{block.text}</StatusNote>;
    case "citation":
      return <Citations sources={block.sources} />;
    case "suggested":
      return <SuggestedActions actions={block.actions} />;
    default:
      return null;
  }
}
