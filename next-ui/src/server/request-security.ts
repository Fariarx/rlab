import type { IncomingMessage } from "node:http";

export interface RequestSecurityFailure {
  readonly statusCode: 400 | 403;
  readonly message: string;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const UNSAFE_METHODS = new Set(["DELETE", "PATCH", "POST", "PUT"]);

function firstHeader(value: string | readonly string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function normalizeHostname(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/\.$/, "");
  return trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
}

function normalizeAuthority(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export function isLoopbackHostname(value: string): boolean {
  return LOOPBACK_HOSTS.has(normalizeHostname(value));
}

export function hostHeaderHostname(hostHeader: string): string | null {
  const trimmed = hostHeader.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return normalizeHostname(new URL(`http://${trimmed}`).hostname);
  } catch {
    const withoutPort = trimmed.startsWith("[") ? trimmed.slice(1, trimmed.indexOf("]")) : trimmed.split(":")[0];
    return withoutPort ? normalizeHostname(withoutPort) : null;
  }
}

function allowedHostnamesFromEnv(env: NodeJS.ProcessEnv): ReadonlySet<string> {
  return new Set(
    (env.RLAB_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((entry) => hostHeaderHostname(entry) ?? normalizeHostname(entry))
      .filter((entry) => entry.length > 0),
  );
}

export function requestHostAllowed(hostHeader: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const hostname = hostHeaderHostname(hostHeader);
  if (!hostname) {
    return false;
  }
  if (isLoopbackHostname(hostname)) {
    return true;
  }
  return allowedHostnamesFromEnv(env).has(hostname);
}

function originAuthority(value: string): string | null {
  try {
    return normalizeAuthority(new URL(value).host);
  } catch {
    return null;
  }
}

function hostHeaderAuthority(hostHeader: string): string | null {
  const trimmed = hostHeader.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return normalizeAuthority(new URL(`http://${trimmed}`).host);
  } catch {
    return normalizeAuthority(trimmed);
  }
}

function sameOriginHost(origin: string, hostHeader: string): boolean {
  const originHost = originAuthority(origin);
  const requestHost = hostHeaderAuthority(hostHeader);
  return Boolean(originHost && requestHost && originHost === requestHost);
}

function fetchSiteHeader(req: IncomingMessage): string {
  return firstHeader(req.headers["sec-fetch-site"]).toLowerCase();
}

function isSameOriginFetchSite(fetchSite: string): boolean {
  return fetchSite === "same-origin" || fetchSite === "none";
}

export function validateRlabRequest(req: IncomingMessage, env: NodeJS.ProcessEnv = process.env): RequestSecurityFailure | null {
  const host = firstHeader(req.headers.host);
  if (!host) {
    return { statusCode: 400, message: "Host header is required." };
  }
  if (!requestHostAllowed(host, env)) {
    return { statusCode: 403, message: `Host is not allowed: ${hostHeaderHostname(host) ?? host}.` };
  }

  const method = (req.method ?? "GET").toUpperCase();
  const origin = firstHeader(req.headers.origin);
  const referer = firstHeader(req.headers.referer);
  const fetchSite = fetchSiteHeader(req);
  if (origin && !sameOriginHost(origin, host)) {
    return { statusCode: 403, message: "Cross-origin requests are not allowed." };
  }
  if (!origin && referer && !sameOriginHost(referer, host)) {
    return { statusCode: 403, message: "Cross-origin requests are not allowed." };
  }
  if (fetchSite === "cross-site") {
    return { statusCode: 403, message: "Cross-site requests are not allowed." };
  }
  if (UNSAFE_METHODS.has(method) && !origin && !referer && !isSameOriginFetchSite(fetchSite)) {
    return { statusCode: 403, message: "Unsafe requests require a same-origin browser signal." };
  }
  return null;
}
