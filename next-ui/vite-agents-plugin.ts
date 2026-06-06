import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import process from "node:process";
import type { Plugin, ViteDevServer, PreviewServer } from "vite";

/**
 * Real agent detection. Scans PATH (and required env vars) for each coding
 * agent's CLI and reports its status — the live stand-in for vibe-kanban's
 * executor discovery. Pure filesystem checks, no shell spawning (per AGENTS.md).
 *
 * Exposed at GET /api/agents during `vite dev` and `vite preview`.
 */
type AgentStatus = "available" | "running" | "needs-setup" | "unavailable";

interface Detect {
  readonly bins: readonly string[];
  /** If set, at least one of these env vars must be present, else `needs-setup`. */
  readonly env?: readonly string[];
}

// Keys must match AgentId in src/components/agent/agents.ts.
const DETECT: Record<string, Detect> = {
  "claude-code": { bins: ["claude"] },
  codex: { bins: ["codex"], env: ["OPENAI_API_KEY", "CODEX_API_KEY"] },
  gemini: { bins: ["gemini"], env: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_API_KEY"] },
  amp: { bins: ["amp"], env: ["AMP_API_KEY"] },
  opencode: { bins: ["opencode"] },
  cursor: { bins: ["cursor-agent", "cursor"] },
  qwen: { bins: ["qwen", "qwen-code"], env: ["DASHSCOPE_API_KEY"] },
  copilot: { bins: ["copilot"] },
  droid: { bins: ["droid"], env: ["FACTORY_API_KEY"] },
};

function onPath(bin: string): boolean {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, bin + ext);
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          return true;
        }
      } catch {
        // ignore unreadable PATH entries
      }
    }
  }
  return false;
}

function detectAgents(): Record<string, AgentStatus> {
  const result: Record<string, AgentStatus> = {};
  for (const [id, cfg] of Object.entries(DETECT)) {
    const found = cfg.bins.some(onPath);
    if (!found) {
      result[id] = "unavailable";
    } else if (cfg.env && !cfg.env.some((name) => process.env[name])) {
      result[id] = "needs-setup";
    } else {
      result[id] = "available";
    }
  }
  return result;
}

/* ------------------------------ Real agent run ------------------------------ */

// CLI invocation per agent. Only agents with a real adapter run; others report
// "not wired" so the UI degrades honestly.
const RUN: Record<string, { bin: string; args: (prompt: string) => string[] }> = {
  "claude-code": {
    bin: "claude",
    args: (prompt) => ["-p", prompt, "--output-format", "stream-json", "--verbose"],
  },
};

type RunEvent =
  | { type: "start" }
  | { type: "reasoning"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; summary?: string; args?: Record<string, string> }
  | { type: "tool_result"; id: string; ok: boolean; output: string }
  | { type: "status"; level: "info" | "ok" | "warn" | "error"; text: string }
  | { type: "error"; text: string }
  | { type: "done"; costUsd?: number };

function clip(value: unknown, max = 600): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s && s.length > max ? `${s.slice(0, max)}…` : (s ?? "");
}

function toArgs(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>).slice(0, 5)) {
    out[k] = clip(v, 160);
  }
  return out;
}

function resultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : clip(c, 120))).join("\n");
  }
  return clip(content, 600);
}

/** Translate one Claude `stream-json` line into zero or more normalized events. */
function translateClaude(line: string): RunEvent[] {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return [];
  }
  const events: RunEvent[] = [];
  const type = msg.type;

  if (type === "system" && msg.subtype === "init") {
    const model = typeof msg.model === "string" ? msg.model : "agent";
    events.push({ type: "status", level: "info", text: `model · ${model}` });
  } else if (type === "assistant") {
    const content = ((msg.message as { content?: unknown[] })?.content) ?? [];
    for (const block of content as Array<Record<string, unknown>>) {
      if (block.type === "text" && typeof block.text === "string") {
        events.push({ type: "text", text: block.text });
      } else if (block.type === "thinking" && typeof block.thinking === "string") {
        events.push({ type: "reasoning", text: block.thinking });
      } else if (block.type === "tool_use") {
        events.push({ type: "tool", id: String(block.id), name: String(block.name), summary: clip((block.input as Record<string, unknown>)?.command ?? (block.input as Record<string, unknown>)?.file_path ?? "", 80), args: toArgs(block.input) });
      }
    }
  } else if (type === "user") {
    const content = ((msg.message as { content?: unknown[] })?.content) ?? [];
    for (const block of content as Array<Record<string, unknown>>) {
      if (block.type === "tool_result") {
        events.push({ type: "tool_result", id: String(block.tool_use_id), ok: block.is_error !== true, output: resultText(block.content) });
      }
    }
  } else if (type === "result") {
    if (msg.is_error === true) {
      events.push({ type: "error", text: typeof msg.result === "string" ? msg.result : String(msg.subtype ?? "run failed") });
    }
    events.push({ type: "done", costUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : undefined });
  }
  return events;
}

function handleRun(req: IncomingMessage, res: ServerResponse): void {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    let agent = "";
    let prompt = "";
    let requestedCwd = "";
    try {
      const parsed = JSON.parse(body || "{}") as { agent?: string; prompt?: string; cwd?: string };
      agent = parsed.agent ?? "";
      prompt = (parsed.prompt ?? "").trim();
      requestedCwd = parsed.cwd ?? "";
    } catch {
      // ignore
    }

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-store");
    const send = (event: RunEvent) => res.write(`${JSON.stringify(event)}\n`);

    if (!prompt) {
      send({ type: "error", text: "Empty prompt" });
      send({ type: "done" });
      res.end();
      return;
    }

    const spec = RUN[agent];
    if (!spec || !onPath(spec.bin)) {
      send({ type: "start" });
      send({ type: "status", level: "warn", text: spec ? `${spec.bin} is not installed on this machine` : `Running ${agent || "this agent"} isn't wired yet — try Claude Code` });
      send({ type: "done" });
      res.end();
      return;
    }

    // Use the requested working directory when it's a real directory (so the
    // agent reads/operates on real project files); otherwise a temp scratch dir.
    // Default permission mode is kept (read tools work; edits/bash are denied),
    // so pointing at a real repo stays safe.
    let cwd = join(tmpdir(), "rlab-agent-scratch");
    if (requestedCwd) {
      try {
        if (existsSync(requestedCwd) && statSync(requestedCwd).isDirectory()) {
          cwd = requestedCwd;
        }
      } catch {
        // fall back to scratch
      }
    }
    try {
      mkdirSync(cwd, { recursive: true });
    } catch {
      // ignore
    }

    send({ type: "start" });
    if (cwd !== join(tmpdir(), "rlab-agent-scratch")) {
      send({ type: "status", level: "info", text: `cwd · ${cwd}` });
    }
    // stdin = /dev/null so the CLI doesn't wait for piped input (it otherwise
    // stalls ~3s: "no stdin data received").
    const child = spawn(spec.bin, spec.args(prompt), { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });

    const timeout = setTimeout(() => {
      send({ type: "error", text: "Run timed out after 120s" });
      child.kill("SIGTERM");
    }, 120_000);

    let buffer = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) {
          for (const event of translateClaude(line)) {
            send(event);
          }
        }
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      send({ type: "error", text: `Failed to launch ${spec.bin}: ${err.message}` });
      send({ type: "done" });
      res.end();
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0 && stderr) {
        send({ type: "error", text: clip(stderr, 400) });
      }
      send({ type: "done" });
      res.end();
    });

    // Abort the child if the client disconnects. Listen on the RESPONSE, not the
    // request — `req`'s "close" fires as soon as the POST body is consumed.
    res.on("close", () => {
      clearTimeout(timeout);
      if (child.exitCode === null) {
        child.kill("SIGTERM");
      }
    });
  });
}

function attach(server: ViteDevServer | PreviewServer): void {
  server.middlewares.use("/api/agents", (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(detectAgents()));
  });
  server.middlewares.use("/api/run", (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    handleRun(req, res);
  });
}

export function agentsApiPlugin(): Plugin {
  return {
    name: "rlab:agents-api",
    configureServer(server) {
      attach(server);
    },
    configurePreviewServer(server) {
      attach(server);
    },
  };
}
