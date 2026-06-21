#!/usr/bin/env node
// Production launcher for the rlab agent workspace. Serves the built SPA and
// the /api agents backend (the Vite plugin's preview middleware) over one port.
// Run directly (`npx rlab`) or wrap it in a service (systemd, pm2).
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(packageRoot);
process.env.NODE_ENV ||= "production";

const port = Number.parseInt(process.env.PORT ?? "", 10) || 4280;
const host = process.env.HOST ?? "127.0.0.1";

function normalizedHostname(value) {
  const trimmed = String(value ?? "").trim().toLowerCase();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isLoopbackBindHost(value) {
  return ["localhost", "127.0.0.1", "::1"].includes(normalizedHostname(value));
}

if (!isLoopbackBindHost(host) && process.env.RLAB_ALLOW_PUBLIC_BIND !== "1") {
  console.error(`[rlab] Refusing to bind to ${host}. Set RLAB_ALLOW_PUBLIC_BIND=1 and RLAB_ALLOWED_HOSTS to the public host if this is intentional.`);
  process.exit(1);
}

if (!existsSync(resolve(packageRoot, "dist/index.html"))) {
  console.log("[rlab] No build found — building the app once (this can take a moment)...");
  await build();
}

const server = await preview({
  root: packageRoot,
  preview: { host, port, strictPort: true },
});

console.log("\n  rlab — agent workspace");
server.printUrls();
console.log("\n  Tip: set PORT / HOST to change the bind, RLAB_DEMO=1 to seed demo data.\n");
