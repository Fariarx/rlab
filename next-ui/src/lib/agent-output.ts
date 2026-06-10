const CLI_PERMISSION_DENIED_TEXT = "The user rejected permission to use this specific tool call.";
const CLI_PERMISSION_DENIED_DISPLAY_TEXT = "CLI permission gate denied this tool call before execution. No approval or rejection was recorded in the app.";
export const MAX_AGENT_TOOL_OUTPUT_CHARS = 20_000;

export function normalizeAgentToolOutput(value: string): string {
  return value.split(CLI_PERMISSION_DENIED_TEXT).join(CLI_PERMISSION_DENIED_DISPLAY_TEXT);
}

export function truncateAgentToolOutput(value: string, max = MAX_AGENT_TOOL_OUTPUT_CHARS): string {
  if (value.length <= max) {
    return value;
  }
  const marker = `\n\n[tool output truncated: ${value.length - max} chars omitted]\n\n`;
  const headLength = Math.max(0, Math.floor((max - marker.length) * 0.7));
  const tailLength = Math.max(0, max - marker.length - headLength);
  return `${value.slice(0, headLength)}${marker}${tailLength > 0 ? value.slice(-tailLength) : ""}`;
}
