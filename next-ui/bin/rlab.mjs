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
const packageDistDir = resolve(packageRoot, "dist");

function configuredDistDir() {
  const explicitDistDir = process.env.RLAB_DIST_DIR?.trim();
  if (explicitDistDir) {
    return resolve(explicitDistDir);
  }
  const dataDir = process.env.RLAB_DATA_DIR?.trim();
  return dataDir ? resolve(dataDir, "dist") : packageDistDir;
}

const distDir = configuredDistDir();

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

const distExists = existsSync(resolve(distDir, "index.html"));
const isolatedDist = distDir !== packageDistDir;
if (isolatedDist || !distExists) {
  const reason = distExists ? "Isolated production build" : "No build found";
  console.log(`[rlab] ${reason} in ${distDir} — building the app (this can take a moment)...`);
  await build({ root: packageRoot, build: { outDir: distDir, emptyOutDir: true } });
}

const server = await preview({
  root: packageRoot,
  build: { outDir: distDir },
  preview: { host, port, strictPort: true },
});

console.log("\n  rlab — agent workspace");
server.printUrls();
console.log("\n  Tip: set PORT / HOST to change the bind, RLAB_DEMO=1 to seed demo data.\n");
