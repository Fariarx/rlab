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
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
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

function originHostname(value: string): string | null {
  try {
    return normalizeHostname(new URL(value).hostname);
  } catch {
    return null;
  }
}

function sameOriginHost(origin: string, hostHeader: string): boolean {
  const originHost = originHostname(origin);
  const requestHost = hostHeaderHostname(hostHeader);
  return Boolean(originHost && requestHost && originHost === requestHost);
}

function isCrossSiteFetch(req: IncomingMessage): boolean {
  const fetchSite = firstHeader(req.headers["sec-fetch-site"]).toLowerCase();
  return fetchSite === "cross-site";
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
  if (origin && !sameOriginHost(origin, host)) {
    return { statusCode: 403, message: "Cross-origin requests are not allowed." };
  }
  if (!origin && referer && !sameOriginHost(referer, host)) {
    return { statusCode: 403, message: "Cross-origin requests are not allowed." };
  }
  if (UNSAFE_METHODS.has(method) && isCrossSiteFetch(req)) {
    return { statusCode: 403, message: "Cross-site requests are not allowed." };
  }
  return null;
}
