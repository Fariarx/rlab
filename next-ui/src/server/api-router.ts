import type { IncomingMessage, ServerResponse } from "node:http";

export type HttpMethod = "DELETE" | "GET" | "POST" | "PUT";
export type ApiHandler = (req: IncomingMessage, res: ServerResponse) => void;
export type MiddlewareNext = (error?: unknown) => void;
export type MiddlewareHandler = (req: IncomingMessage, res: ServerResponse, next: MiddlewareNext) => void;

export interface ApiMiddlewareStack {
  use(handler: MiddlewareHandler): void;
  use(path: string, handler: MiddlewareHandler | ApiHandler): void;
}

export interface ExactApiRoute {
  readonly path: string;
  readonly handler: ApiHandler;
}

function sendRouteJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

export function isExactMountedRequest(req: IncomingMessage): boolean {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  return pathname === "" || pathname === "/";
}

export function methodOnly(method: HttpMethod, handler: ApiHandler): ApiHandler {
  return (req, res) => {
    if (req.method !== method) {
      res.statusCode = 405;
      res.end();
      return;
    }
    handler(req, res);
  };
}

export function attachExactApiRoutes(server: ApiMiddlewareStack, routes: readonly ExactApiRoute[]): void {
  for (const route of routes) {
    server.use(route.path, (req: IncomingMessage, res: ServerResponse) => {
      if (!isExactMountedRequest(req)) {
        sendRouteJson(res, 404, { error: `Unknown API endpoint: ${route.path}${req.url ?? ""}` });
        return;
      }
      route.handler(req, res);
    });
  }
}
