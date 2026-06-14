import type { AgentBlock } from "../domain/agent-types";

export function finishLiveBlock(block: AgentBlock, state: "ok" | "error"): AgentBlock {
  switch (block.kind) {
    case "reasoning":
      return block.active ? { ...block, active: false } : block;
    case "text":
      return block.streaming ? { ...block, streaming: false } : block;
    case "tool":
    case "command":
    case "search":
      return block.state === "running" ? { ...block, state } : block;
    case "plan":
      return block.steps.some((step) => step.state === "running")
        ? { ...block, steps: block.steps.map((step) => (step.state === "running" ? { ...step, state } : step)) }
        : block;
    default:
      return block;
  }
}
