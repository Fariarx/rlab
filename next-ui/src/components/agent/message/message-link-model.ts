import { defaultUrlTransform } from "react-markdown";

export const RLAB_TOOL_LINK_RE = /\$(TaskAwaiter|ScheduleAwaiter|TaskWakeup|ScheduleWakeup|TaskTracker|TaskGoal|AskUserQuestion|BrowserPreview)\b/g;

export function normalizedRlabToolName(value: string): string {
  return value === "ScheduleAwaiter" || value === "TaskWakeup" || value === "ScheduleWakeup" ? "TaskAwaiter" : value;
}

export function rlabToolMarkdownLinks(text: string): string {
  return text.replace(RLAB_TOOL_LINK_RE, (_match, tool: string) => `[${normalizedRlabToolName(tool)}](rlab-tool:${normalizedRlabToolName(tool)})`);
}

export function messageMarkdownUrlTransform(url: string): string {
  return url.startsWith("rlab-tool:") ? url : defaultUrlTransform(url);
}

export function isFilePathLike(value: string): boolean {
  if (/^[a-z]:[\\/]/i.test(value)) {
    return true;
  }
  if (!value || /^https?:\/\//i.test(value) || value.startsWith("//") || value.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return false;
  }
  return /[\\/]/.test(value) || /\.[a-z0-9]{1,8}$/i.test(value);
}

export function fileBaseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
