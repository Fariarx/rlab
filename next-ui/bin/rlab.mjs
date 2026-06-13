#!/usr/bin/env node
// Production launcher for the rlab agent workspace. Serves the built SPA and
// the /api agents backend (the Vite plugin's preview middleware) over one port.
// Run directly (`npx rlab`) or wrap it in a service (systemd, pm2).
import { existsSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(packageRoot);
process.env.NODE_ENV ||= "production";

function workspaceDataDir() {
  const configured = process.env.RLAB_DATA_DIR;
  return configured ? (isAbsolute(configured) ? configured : resolve(process.cwd(), configured)) : join(packageRoot, ".data");
}

function resetEventStore() {
  if (!process.argv.includes("--yes")) {
    console.error("[rlab] Refusing to reset the event store without --yes.");
    process.exitCode = 1;
    return;
  }
  const dataDir = workspaceDataDir();
  const files = ["events.db", "events.db-wal", "events.db-shm"].map((name) => join(dataDir, name));
  for (const file of files) {
    if (existsSync(file)) {
      unlinkSync(file);
    }
  }
  console.log(`[rlab] Reset workspace event store in ${dataDir}`);
}

if (process.argv[2] === "reset") {
  resetEventStore();
  process.exit(process.exitCode ?? 0);
}

const port = Number.parseInt(process.env.PORT ?? "", 10) || 4280;
const host = process.env.HOST ?? "0.0.0.0";

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
