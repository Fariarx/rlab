import type { AgentBlock } from "../core/types";

export type KeyedAgentBlock<T extends AgentBlock> = { readonly block: T; readonly key: string; readonly order: number };

function recordSignature(record: Readonly<Record<string, string>> | undefined): string {
  return Object.entries(record ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("|");
}

function agentBlockIdentity(block: AgentBlock): string {
  switch (block.kind) {
    case "reasoning":
      return `reasoning:${block.startedAtMs ?? ""}:${block.duration ?? ""}:${block.active === true ? "active" : "done"}:${block.text}`;
    case "text":
      return `text:${block.result === true ? "result" : "narration"}:${block.streaming === true ? "streaming" : "done"}:${block.text}`;
    case "tool":
      return `tool:${block.name}:${block.state}:${block.duration ?? ""}:${block.summary ?? ""}:${recordSignature(block.args)}:${block.output ?? ""}`;
    case "command":
      return `command:${block.state}:${block.exitCode ?? ""}:${block.command}:${block.output ?? ""}`;
    case "diff":
      return `diff:${block.file}:${block.additions}:${block.deletions}:${block.lines.map((line) => `${line.type}:${line.text}`).join("\n")}`;
    case "search":
      return `search:${block.state}:${block.query}:${block.results.map((result) => `${result.title}:${result.url}`).join("|")}`;
    case "plan":
      return `plan:${block.steps.map((step) => `${step.state}:${step.label}`).join("|")}`;
    case "code":
      return `code:${block.language}:${block.code}`;
    case "options":
      return `options:${block.id ?? ""}:${block.prompt}:${block.multi === true ? "multi" : "single"}:${block.options.map((option) => `${option.id}:${option.label}:${option.description ?? ""}`).join("|")}:${(block.selected ?? []).join(",")}`;
    case "approval":
      return `approval:${block.id ?? ""}:${block.title}:${block.detail ?? ""}:${block.decision ?? ""}`;
    case "status":
      return `status:${block.level}:${block.text}`;
    case "citation":
      return `citation:${block.sources.map((source) => `${source.label}:${source.url}`).join("|")}`;
    case "suggested":
      return `suggested:${block.actions.map((action) => `${action.id}:${action.label}:${action.icon ?? ""}:${action.tone ?? ""}`).join("|")}`;
    case "review":
      return `review:${block.comments.map((comment) => `${comment.id}:${comment.file}:${comment.line}:${comment.lineText}:${comment.body}`).join("|")}`;
  }
}

export function keyedAgentBlocks<T extends AgentBlock>(blocks: readonly T[]): readonly KeyedAgentBlock<T>[] {
  const occurrences = new Map<string, number>();
  const keyed: KeyedAgentBlock<T>[] = [];
  let order = 0;
  for (const block of blocks) {
    const baseKey = agentBlockIdentity(block);
    const occurrence = occurrences.get(baseKey) ?? 0;
    occurrences.set(baseKey, occurrence + 1);
    keyed.push({ block, key: occurrence === 0 ? baseKey : `${baseKey}#${occurrence + 1}`, order });
    order += 1;
  }
  return keyed;
}
