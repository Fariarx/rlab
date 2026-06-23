import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiHandler, ApiMiddlewareStack, MiddlewareHandler, MiddlewareNext } from "./api-router";

interface MountedMiddleware {
  readonly path: string | null;
  readonly handler: MiddlewareHandler | ApiHandler;
}

type RequestWithOriginalUrl = IncomingMessage & { originalUrl?: string };

function strippedMountedUrl(mountPath: string, requestUrl: string): string | null {
  if (mountPath === "/") {
    return requestUrl || "/";
  }
  const parsed = new URL(requestUrl || "/", "http://localhost");
  if (parsed.pathname !== mountPath && !parsed.pathname.startsWith(`${mountPath}/`)) {
    return null;
  }
  const restPath = parsed.pathname.slice(mountPath.length);
  return `${restPath.length > 0 ? restPath : "/"}${parsed.search}`;
}

export class ProdMiddlewareStack implements ApiMiddlewareStack {
  private readonly handlers: MountedMiddleware[] = [];

  use(handler: MiddlewareHandler): void;
  use(path: string, handler: MiddlewareHandler | ApiHandler): void;
  use(pathOrHandler: string | MiddlewareHandler, maybeHandler?: MiddlewareHandler | ApiHandler): void {
    if (typeof pathOrHandler === "string") {
      if (!maybeHandler) {
        throw new Error(`Missing middleware handler for ${pathOrHandler}.`);
      }
      this.handlers.push({ path: pathOrHandler, handler: maybeHandler });
      return;
    }
    this.handlers.push({ path: null, handler: pathOrHandler });
  }

  handle(req: IncomingMessage, res: ServerResponse, done: MiddlewareNext): void {
    const run = (index: number): void => {
      if (res.writableEnded) {
        return;
      }
      const layer = this.handlers[index];
      if (!layer) {
        done();
        return;
      }

      const request = req as RequestWithOriginalUrl;
      const previousUrl = req.url;
      if (!request.originalUrl) {
        request.originalUrl = previousUrl ?? "/";
      }
      if (layer.path) {
        const mountedUrl = strippedMountedUrl(layer.path, previousUrl ?? "/");
        if (!mountedUrl) {
          run(index + 1);
          return;
        }
        req.url = mountedUrl;
      }

      let nextCalled = false;
      const next: MiddlewareNext = (error) => {
        if (nextCalled) {
          return;
        }
        nextCalled = true;
        req.url = previousUrl;
        if (error) {
          done(error);
          return;
        }
        run(index + 1);
      };

      try {
        (layer.handler as MiddlewareHandler)(req, res, next);
      } catch (error) {
        req.url = previousUrl;
        done(error);
      }
    };

    run(0);
  }
}
