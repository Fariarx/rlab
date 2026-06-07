const CLI_PERMISSION_DENIED_TEXT = "The user rejected permission to use this specific tool call.";
const CLI_PERMISSION_DENIED_DISPLAY_TEXT = "CLI permission gate denied this tool call before execution. No approval or rejection was recorded in the app.";

export function normalizeAgentToolOutput(value: string): string {
  return value.split(CLI_PERMISSION_DENIED_TEXT).join(CLI_PERMISSION_DENIED_DISPLAY_TEXT);
}
