const AM_PM_TIME_RE = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP])\.?M\.?$/i;
const ISO_LIKE_RE = /^\d{4}-\d{2}-\d{2}T/;

function twoDigit(value: number): string {
  return value.toString().padStart(2, "0");
}

export function formatClock24(date: Date = new Date()): string {
  return `${twoDigit(date.getHours())}:${twoDigit(date.getMinutes())}`;
}

export function formatDateTime24(date: Date): string {
  return `${date.toLocaleDateString()} ${formatClock24(date)}`;
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
