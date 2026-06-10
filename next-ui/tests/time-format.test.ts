import { describe, expect, it } from "vitest";
import { formatClock24, formatDateTime24, normalizeClockLabel } from "../src/lib/time-format";

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
});
