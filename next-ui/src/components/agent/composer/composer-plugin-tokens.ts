import type { ComposerPluginLink } from "../../../lib/rlab-plugins";

export interface ComposerPluginTokenRange {
  readonly token: string;
  readonly start: number;
  readonly end: number;
}

export interface ComposerPluginPreviewTextPart {
  readonly type: "text";
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export interface ComposerPluginPreviewTokenPart {
  readonly type: "plugin";
  readonly token: string;
  readonly start: number;
  readonly end: number;
}

export type ComposerPluginPreviewPart = ComposerPluginPreviewTextPart | ComposerPluginPreviewTokenPart;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function pluginTokenPattern(plugins: readonly Pick<ComposerPluginLink, "token">[]): RegExp | null {
  const tokens = new Set<string>();
  plugins.forEach((plugin) => {
    if (plugin.token.startsWith("$")) {
      tokens.add(plugin.token);
    }
  });
  if (tokens.has("$TaskAwaiter")) {
    tokens.add("$ScheduleAwaiter");
  }
  if (tokens.size === 0) {
    return null;
  }
  return new RegExp(`(${Array.from(tokens).sort((left, right) => right.length - left.length).map(escapeRegExp).join("|")})\\b`, "g");
}

export function pluginTokenRanges(value: string, pattern: RegExp | null): readonly ComposerPluginTokenRange[] {
  if (!pattern) {
    return [];
  }
  return Array.from(value.matchAll(pattern)).flatMap((match) => {
    const token = match[0];
    const start = match.index;
    return typeof start === "number" && token.length > 0 ? [{ token, start, end: start + token.length }] : [];
  });
}

function selectionIntersectsRange(selectionStart: number, selectionEnd: number, range: ComposerPluginTokenRange): boolean {
  return selectionStart < range.end && selectionEnd > range.start;
}

export function tokenRangeForDeleteKey(ranges: readonly ComposerPluginTokenRange[], selectionStart: number, selectionEnd: number, key: "Backspace" | "Delete"): { readonly start: number; readonly end: number } | null {
  const selectedRanges = ranges.filter((range) => selectionIntersectsRange(selectionStart, selectionEnd, range));
  if (selectedRanges.length > 0) {
    return {
      start: Math.min(selectionStart, selectedRanges[0]?.start ?? selectionStart),
      end: Math.max(selectionEnd, selectedRanges[selectedRanges.length - 1]?.end ?? selectionEnd),
    };
  }
  if (key === "Backspace") {
    const range = ranges.find((item) => selectionStart > item.start && selectionStart <= item.end);
    return range ? { start: range.start, end: range.end } : null;
  }
  const range = ranges.find((item) => selectionStart >= item.start && selectionStart < item.end);
  return range ? { start: range.start, end: range.end } : null;
}

function commonPrefixLength(left: string, right: string): number {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function commonSuffixLength(left: string, right: string, prefixLength: number): number {
  let length = 0;
  while (
    length < left.length - prefixLength
    && length < right.length - prefixLength
    && left[left.length - 1 - length] === right[right.length - 1 - length]
  ) {
    length += 1;
  }
  return length;
}

export function normalizePluginTokenDeletion(previous: string, next: string, ranges: readonly ComposerPluginTokenRange[]): { readonly value: string; readonly caret: number } | null {
  if (next.length >= previous.length || ranges.length === 0) {
    return null;
  }
  const prefixLength = commonPrefixLength(previous, next);
  const suffixLength = commonSuffixLength(previous, next, prefixLength);
  const changedStart = prefixLength;
  const changedEnd = previous.length - suffixLength;
  const touchedRanges = ranges.filter((range) => selectionIntersectsRange(changedStart, changedEnd, range));
  if (touchedRanges.length === 0) {
    return null;
  }
  const start = Math.min(changedStart, touchedRanges[0]?.start ?? changedStart);
  const end = Math.max(changedEnd, touchedRanges[touchedRanges.length - 1]?.end ?? changedEnd);
  return { value: previous.slice(0, start) + previous.slice(end), caret: start };
}

export function pluginPreviewParts(value: string, ranges: readonly ComposerPluginTokenRange[]): readonly ComposerPluginPreviewPart[] {
  if (ranges.length === 0) {
    return [];
  }
  const parts: ComposerPluginPreviewPart[] = [];
  let lastIndex = 0;
  for (const range of ranges) {
    if (range.start > lastIndex) {
      parts.push({ type: "text", text: value.slice(lastIndex, range.start), start: lastIndex, end: range.start });
    }
    parts.push({ type: "plugin", token: range.token, start: range.start, end: range.end });
    lastIndex = range.end;
  }
  if (lastIndex < value.length) {
    parts.push({ type: "text", text: value.slice(lastIndex), start: lastIndex, end: value.length });
  }
  return parts.length === 1 && parts[0]?.type === "text" ? [] : parts;
}
