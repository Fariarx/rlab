const AM_PM_TIME_RE = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP])\.?M\.?$/i;
const ISO_LIKE_RE = /^\d{4}-\d{2}-\d{2}T/;
const WEEKDAY_LABEL_TO_INDEX: Readonly<Record<string, number>> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function twoDigit(value: number): string {
  return value.toString().padStart(2, "0");
}

export function formatClock24(date: Date = new Date()): string {
  return `${twoDigit(date.getHours())}:${twoDigit(date.getMinutes())}`;
}

export function formatDateTime24(date: Date): string {
  return `${date.toLocaleDateString()} ${formatClock24(date)}`;
}

function formatCalendarDateLabel(date: Date, now: Date): string {
  const dayMonth = `${twoDigit(date.getDate())}.${twoDigit(date.getMonth() + 1)}`;
  return date.getFullYear() === now.getFullYear() ? dayMonth : `${dayMonth}.${date.getFullYear()}`;
}

function legacyWeekdayDateLabel(value: string | undefined, now: Date): string | undefined {
  const dayIndex = value ? WEEKDAY_LABEL_TO_INDEX[value.trim().toLowerCase()] : undefined;
  if (dayIndex === undefined) {
    return undefined;
  }
  const currentDay = now.getDay();
  const daysAgo = ((currentDay - dayIndex + 7) % 7) || 7;
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return formatCalendarDateLabel(date, now);
}

export function formatConversationListTime(
  time: string | undefined,
  updatedAtMs: number | undefined,
  now: Date = new Date(),
): string | undefined {
  if (updatedAtMs === undefined || !Number.isFinite(updatedAtMs)) {
    return legacyWeekdayDateLabel(time, now) ?? normalizeClockLabel(time);
  }
  const date = new Date(updatedAtMs);
  if (!Number.isFinite(date.getTime())) {
    return legacyWeekdayDateLabel(time, now) ?? normalizeClockLabel(time);
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  const sameDay = sameYear && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay) {
    return formatClock24(date);
  }
  return formatCalendarDateLabel(date, now);
}

export function normalizeClockLabel(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }
  const text = value.trim();
  const amPm = AM_PM_TIME_RE.exec(text);
  if (amPm) {
    const rawHour = Number(amPm[1]);
    const minute = amPm[2];
    const marker = amPm[3].toUpperCase();
    if (rawHour >= 1 && rawHour <= 12) {
      const hour = marker === "A" ? rawHour % 12 : (rawHour % 12) + 12;
      return `${twoDigit(hour)}:${minute}`;
    }
  }
  if (ISO_LIKE_RE.test(text)) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) {
      return formatClock24(date);
    }
  }
  return text;
}
