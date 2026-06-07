/**
 * Normalizes a link target into an absolute http(s) URL suitable for opening in
 * a new tab or the in-app Preview iframe. Bare domains (`vitest.dev/api`) get an
 * `https://` prefix; protocol-relative URLs are upgraded to https. Targets that
 * are not web links (file paths, anchors) return null so callers can fall back.
 */
export function normalizeExternalUrl(href: string): string | null {
  const value = href.trim();
  if (!value) {
    return null;
  }
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  if (value.startsWith("//")) {
    return `https:${value}`;
  }
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$|#|\?)/i.test(value)) {
    return `https://${value}`;
  }
  return null;
}
