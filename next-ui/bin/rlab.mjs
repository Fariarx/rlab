#!/usr/bin/env node
// Production launcher for the rlab agent workspace. It starts the built Node
// runtime server; Vite is used only during dev/build, never inside this process.
// Run directly (`npx rlab`) or wrap it in a service (systemd, pm2).
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(packageRoot);
process.env.NODE_ENV ||= "production";

const serverEntry = resolve(packageRoot, "dist-server", "prod-server.mjs");
if (!existsSync(serverEntry)) {
  console.error(`[rlab] Missing production server bundle at ${serverEntry}. Run npm run build before starting rlab.`);
  process.exit(1);
}

await import(pathToFileURL(serverEntry).href);
