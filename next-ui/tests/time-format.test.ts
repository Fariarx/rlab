import { describe, expect, it } from "vitest";
import { formatClock24, formatConversationListTime, formatDateTime24, inferConversationUpdatedAtMs, normalizeClockLabel, normalizeConversationUpdatedAtMs } from "../src/lib/time-format";

describe("time-format", () => {
  it("formats generated times as 24-hour clock labels", () => {
    expect(formatClock24(new Date(2026, 5, 10, 3, 9))).toBe("03:09");
    expect(formatClock24(new Date(2026, 5, 10, 15, 19))).toBe("15:19");
  });

  it("normalizes persisted AM/PM labels", () => {
    expect(normalizeClockLabel("03:19 PM")).toBe("15:19");
    expect(normalizeClockLabel("12:05 AM")).toBe("00:05");
    expect(normalizeClockLabel("12:05 PM")).toBe("12:05");
  });

  it("normalizes ISO timestamps and leaves non-clock labels untouched", () => {
    expect(normalizeClockLabel("2026-06-10T15:19:00.000")).toBe("15:19");
    expect(normalizeClockLabel("Mon")).toBe("Mon");
  });

  it("formats date-time labels without AM/PM", () => {
    expect(formatDateTime24(new Date(2026, 5, 10, 15, 19))).toContain("15:19");
    expect(formatDateTime24(new Date(2026, 5, 10, 15, 19))).not.toMatch(/[AP]M/i);
  });

  it("formats conversation list labels by recency", () => {
    const now = new Date(2026, 5, 16, 22, 30);

    expect(formatConversationListTime("legacy", new Date(2026, 5, 16, 9, 7).getTime(), now)).toBe("09:07");
    expect(formatConversationListTime("legacy", new Date(2026, 5, 15, 23, 59).getTime(), now)).toBe("15.06");
    expect(formatConversationListTime("legacy", new Date(2025, 11, 31, 23, 59).getTime(), now)).toBe("31.12.2025");
  });

  it("infers absolute activity timestamps from legacy labels", () => {
    const now = new Date(2026, 5, 16, 22, 30);

    expect(formatConversationListTime("15:19", undefined, now)).toBe("15:19");
    expect(formatConversationListTime("Mon", undefined, now)).toBe("15.06");
    expect(inferConversationUpdatedAtMs("2025-12-31T23:59:00.000", now)).toBe(new Date("2025-12-31T23:59:00.000").getTime());
  });

  it("normalizes missing activity timestamps to an absolute value", () => {
    const now = new Date(2026, 5, 16, 22, 30);

    expect(normalizeConversationUpdatedAtMs("Mon", undefined, now)).toBe(new Date(2026, 5, 15).getTime());
    expect(normalizeConversationUpdatedAtMs("", undefined, now)).toBe(now.getTime());
  });

  it("falls back to the persisted clock label when no activity timestamp exists", () => {
    expect(formatConversationListTime("03:19 PM", undefined, new Date(2026, 5, 16, 22, 30))).toBe("15:19");
  });

  it("converts legacy weekday conversation labels to numeric dates", () => {
    const tuesday = new Date(2026, 5, 16, 22, 30);

    expect(formatConversationListTime("Mon", undefined, tuesday)).toBe("15.06");
    expect(formatConversationListTime("Tue", undefined, tuesday)).toBe("09.06");
  });
});
