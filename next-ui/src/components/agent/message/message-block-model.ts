import type { AgentBlock, DiffBlock, PlanBlock, StatusBlock } from "../core/types";

const ANSWER_BLOCK_KINDS: ReadonlySet<AgentBlock["kind"]> = new Set(["text", "options", "approval", "suggested"]);
const DIFF_KIND: AgentBlock["kind"] = "diff";
type VisibleTerminalStatusBlock = StatusBlock & { readonly level: "warn" | "error" };
type SurfacedStatusBlock = VisibleTerminalStatusBlock & { readonly surface: true };

export interface AgentMessageBlockModel {
  readonly answerBlocks: readonly AgentBlock[];
  readonly answerStreaming: boolean;
  readonly completedPlanSignature: string;
  readonly detailBlocks: readonly AgentBlock[];
  readonly diffBlocks: readonly DiffBlock[];
  readonly hasCompletedPlan: boolean;
  readonly hasResolvedInput: boolean;
  readonly resolvedInputsSignature: string;
  readonly visiblePlanBlocks: readonly PlanBlock[];
}

/** Whether the agent turn is still producing output (so diffs aren't surfaced
 *  until the turn settles). */
export function isMessageLive(blocks: readonly AgentBlock[]): boolean {
  return blocks.some((block) => {
    switch (block.kind) {
      case "text":
        return block.streaming === true;
      case "reasoning":
        return block.active === true;
      case "tool":
      case "command":
      case "search":
        return block.state === "running";
      case "plan":
        return block.steps.some((step) => step.state === "running");
      default:
        return false;
    }
  });
}

function isCompletedPlanBlock(block: AgentBlock): block is PlanBlock {
  return block.kind === "plan" && block.steps.length > 0 && block.steps.every((step) => step.state === "ok" || step.state === "error");
}

function planStateSignature(blocks: readonly PlanBlock[]): string {
  return blocks.map((block) => block.steps.map((step) => `${step.state}:${step.label}`).join("|")).join("\n");
}

function isResolvedInputBlock(block: AgentBlock): boolean {
  if (block.kind === "approval") {
    return block.decision != null;
  }
  if (block.kind === "options") {
    return (block.selected?.length ?? 0) > 0;
  }
  return false;
}

function resolvedInputSignature(blocks: readonly AgentBlock[]): string {
  return blocks
    .filter(isResolvedInputBlock)
    .map((block) => {
      if (block.kind === "approval") {
        return `approval:${block.id ?? ""}:${block.decision ?? ""}`;
      }
      if (block.kind === "options") {
        return `options:${block.id ?? ""}:${(block.selected ?? []).join(",")}`;
      }
      return "";
    })
    .join("\n");
}

export function diffTotals(blocks: readonly DiffBlock[]): { readonly additions: number; readonly deletions: number } {
  return blocks.reduce(
    (total, block) => ({
      additions: total.additions + block.additions,
      deletions: total.deletions + block.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}

function isVisibleTerminalStatus(block: AgentBlock): block is VisibleTerminalStatusBlock {
  return block.kind === "status" && (block.level === "warn" || block.level === "error");
}

function isSurfacedStatus(block: AgentBlock): block is SurfacedStatusBlock {
  return isVisibleTerminalStatus(block) && block.surface === true;
}

function terminalStatusAnswerBlock(blocks: readonly AgentBlock[], live: boolean, hasVisibleAnswerOutput: boolean): VisibleTerminalStatusBlock | null {
  if (live) {
    return null;
  }
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (isSurfacedStatus(block)) {
      return block;
    }
  }
  if (hasVisibleAnswerOutput) {
    return null;
  }
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.kind === DIFF_KIND || block.kind === "plan") {
      continue;
    }
    return isVisibleTerminalStatus(block) ? block : null;
  }
  return null;
}

function lastTimelineNonTextBlockIndex(blocks: readonly AgentBlock[]): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.kind === "reasoning" || block.kind === "tool" || block.kind === "command" || block.kind === "search" || block.kind === "code") {
      return index;
    }
  }
  return -1;
}

export function createAgentMessageBlockModel({
  blocks,
  hideCompletedPlans,
  hideResolvedInputs,
  isImageAnswerBlock,
  live,
}: {
  readonly blocks: readonly AgentBlock[];
  readonly hideCompletedPlans: boolean;
  readonly hideResolvedInputs: boolean;
  readonly isImageAnswerBlock: (block: AgentBlock) => boolean;
  readonly live: boolean;
}): AgentMessageBlockModel {
  const diffBlocks = blocks.filter((block): block is DiffBlock => block.kind === DIFF_KIND);
  const planBlocks = blocks.filter((block): block is PlanBlock => block.kind === "plan");
  const completedPlanSignature = planStateSignature(planBlocks);
  const hasCompletedPlan = planBlocks.some(isCompletedPlanBlock);
  const visiblePlanBlocks = planBlocks.filter((block) => !hideCompletedPlans || !isCompletedPlanBlock(block));
  const archivedPlanBlocks = hideCompletedPlans ? planBlocks.filter(isCompletedPlanBlock) : [];
  const resolvedInputsSignature = resolvedInputSignature(blocks);
  const hasResolvedInput = resolvedInputsSignature.length > 0;
  const lastNonTextBlockIndex = lastTimelineNonTextBlockIndex(blocks);
  const hasSurfacedStatus = blocks.some(isSurfacedStatus);
  const isResultText = (block: AgentBlock, index: number): boolean => block.kind === "text" && !live && (block.result !== false || (!hasSurfacedStatus && index > lastNonTextBlockIndex));
  const isAnswerBlock = (block: AgentBlock, index: number): boolean =>
    isImageAnswerBlock(block) || isResultText(block, index) || (ANSWER_BLOCK_KINDS.has(block.kind) && block.kind !== "text" && (!isResolvedInputBlock(block) || !hideResolvedInputs));
  const baseAnswerBlocks = blocks.filter((block, index) => isAnswerBlock(block, index));
  const visibleTerminalStatus = terminalStatusAnswerBlock(blocks, live, baseAnswerBlocks.length > 0);
  const detailBlocks = [
    ...blocks.filter((block, index) => !isAnswerBlock(block, index) && block.kind !== DIFF_KIND && block.kind !== "plan" && !isVisibleTerminalStatus(block)),
    ...archivedPlanBlocks,
  ];
  const answerBlocks = [...baseAnswerBlocks, ...(visibleTerminalStatus ? [visibleTerminalStatus] : [])];
  const answerStreaming = answerBlocks.some((block) => block.kind === "text" && block.streaming === true);
  return {
    answerBlocks,
    answerStreaming,
    completedPlanSignature,
    detailBlocks,
    diffBlocks,
    hasCompletedPlan,
    hasResolvedInput,
    resolvedInputsSignature,
    visiblePlanBlocks,
  };
}
