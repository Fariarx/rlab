#!/usr/bin/env node
// Production launcher for the next-ui agent workspace. Serves the built SPA and
// the /api agents backend (the Vite plugin's preview middleware) over one port.
// Run directly (`npx @kanban/next-ui`) or wrap it in a service (systemd, pm2).
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(packageRoot);
process.env.NODE_ENV ||= "production";

const port = Number.parseInt(process.env.PORT ?? "", 10) || 4280;
const host = process.env.HOST ?? "0.0.0.0";

if (!existsSync(resolve(packageRoot, "dist/index.html"))) {
  console.log("[next-ui] No build found — building the app once (this can take a moment)...");
  await build();
}

const server = await preview({
  root: packageRoot,
  preview: { host, port, strictPort: false },
});

console.log("\n  next-ui — agent workspace");
server.printUrls();
console.log("\n  Tip: set PORT / HOST to change the bind, NEXT_UI_DEMO=1 to seed demo data.\n");
