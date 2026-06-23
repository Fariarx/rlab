import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { attachRlabApi } from "../../vite-agents-plugin";
import { ProdMiddlewareStack } from "./prod-middleware-stack";

const DEFAULT_PORT = 4280;
const LOOPBACK_BIND_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const STATIC_CONTENT_TYPES = new Map<string, string>([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function packageRootFromModule(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return basename(moduleDir) === "dist-server" ? resolve(moduleDir, "..") : resolve(moduleDir, "..", "..");
}

const packageRoot = packageRootFromModule();
process.chdir(packageRoot);
process.env.NODE_ENV ||= "production";

function normalizedHostname(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
}

function isLoopbackBindHost(value: string): boolean {
  return LOOPBACK_BIND_HOSTS.has(normalizedHostname(value));
}

function configuredDistDir(): string {
  const explicitDistDir = process.env.RLAB_DIST_DIR?.trim();
  if (explicitDistDir) {
    return isAbsolute(explicitDistDir) ? explicitDistDir : resolve(packageRoot, explicitDistDir);
  }
  return resolve(packageRoot, "dist");
}

const port = Number.parseInt(process.env.PORT ?? "", 10) || DEFAULT_PORT;
const host = process.env.HOST ?? "127.0.0.1";
const distDir = configuredDistDir();
const indexPath = resolve(distDir, "index.html");

if (!isLoopbackBindHost(host) && process.env.RLAB_ALLOW_PUBLIC_BIND !== "1") {
  console.error(`[rlab] Refusing to bind to ${host}. Set RLAB_ALLOW_PUBLIC_BIND=1 and RLAB_ALLOWED_HOSTS to the public host if this is intentional.`);
  process.exit(1);
}

if (!existsSync(indexPath)) {
  console.error(`[rlab] Missing production build at ${indexPath}. Run npm run build before starting rlab.`);
  process.exit(1);
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

function sendPlain(res: ServerResponse, statusCode: number, message: string): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(message));
  res.end(message);
}

function decodedPathname(pathname: string): string | null {
  try {
    const decoded = decodeURIComponent(pathname);
    return decoded.includes("\0") ? null : decoded;
  } catch {
    return null;
  }
}

function isWithinDirectory(root: string, child: string): boolean {
  const relativePath = relative(root, child);
  return relativePath === "" || (relativePath.length > 0 && !relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function staticPathForRequest(pathname: string): string | null {
  const decoded = decodedPathname(pathname);
  if (!decoded) {
    return null;
  }
  const candidate = resolve(distDir, decoded.replace(/^\/+/, ""));
  return isWithinDirectory(distDir, candidate) ? candidate : null;
}

function shouldServeSpaIndex(pathname: string, acceptHeader: string): boolean {
  if (pathname.startsWith("/api/") || pathname.startsWith("/preview-proxy/")) {
    return false;
  }
  if (extname(pathname).length > 0) {
    return false;
  }
  return acceptHeader.trim().length === 0 || acceptHeader.includes("text/html") || acceptHeader.includes("*/*");
}

function setStaticCacheHeaders(res: ServerResponse, pathname: string): void {
  if (pathname.startsWith("/assets/")) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return;
  }
  res.setHeader("Cache-Control", "no-cache");
}

async function serveFile(res: ServerResponse, method: string, filePath: string, requestPathname: string): Promise<boolean> {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    return false;
  }
  const contentType = STATIC_CONTENT_TYPES.get(extname(filePath).toLowerCase()) ?? "application/octet-stream";
  res.statusCode = 200;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", fileStat.size);
  res.setHeader("X-Content-Type-Options", "nosniff");
  setStaticCacheHeaders(res, requestPathname);
  if (method === "HEAD") {
    res.end();
    return true;
  }
  const stream = createReadStream(filePath);
  stream.on("error", (error) => {
    res.destroy(error);
  });
  stream.pipe(res);
  return true;
}

async function serveStatic(reqUrl: string, method: string, acceptHeader: string, res: ServerResponse): Promise<void> {
  const parsed = new URL(reqUrl || "/", "http://localhost");
  if (parsed.pathname.startsWith("/api/")) {
    sendJson(res, 404, { error: `Unknown API endpoint: ${parsed.pathname}` });
    return;
  }
  if (method !== "GET" && method !== "HEAD") {
    sendPlain(res, 405, "Method not allowed.");
    return;
  }

  const staticPath = staticPathForRequest(parsed.pathname);
  if (staticPath) {
    try {
      if (await serveFile(res, method, staticPath, parsed.pathname)) {
        return;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  if (shouldServeSpaIndex(parsed.pathname, acceptHeader)) {
    await serveFile(res, method, indexPath, "/index.html");
    return;
  }

  sendPlain(res, 404, "Not found.");
}

const middlewares = new ProdMiddlewareStack();
const server = createServer((req, res) => {
  middlewares.handle(req, res, (error) => {
    if (error) {
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      return;
    }
    void serveStatic(req.url ?? "/", req.method ?? "GET", String(req.headers.accept ?? ""), res).catch((serveError: unknown) => {
      if (res.headersSent) {
        res.destroy(serveError instanceof Error ? serveError : new Error(String(serveError)));
        return;
      }
      sendJson(res, 500, { error: serveError instanceof Error ? serveError.message : String(serveError) });
    });
  });
});

attachRlabApi({ middlewares, httpServer: server });

server.listen(port, host, () => {
  const address = `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
  console.log("\n  rlab — agent workspace");
  console.log(`  Local: ${address}/`);
  console.log("\n  Tip: set PORT / HOST to change the bind, RLAB_DEMO=1 to seed demo data.\n");
});
