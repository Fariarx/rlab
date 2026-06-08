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

/**
 * Turns a local filesystem path (an agent screenshot, a pasted attachment) into
 * a URL the browser can load, routed through the server's local-file endpoint.
 * Already-web URLs and data URIs are returned unchanged.
 */
export function localFileUrl(path: string): string {
  const value = path.trim();
  if (!value || /^(https?:|data:|blob:)/i.test(value) || value.startsWith("//")) {
    return value;
  }
  return `/api/local-file?path=${encodeURIComponent(value)}`;
}
