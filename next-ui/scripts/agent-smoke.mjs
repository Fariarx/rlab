#!/usr/bin/env node

const DEFAULT_AGENTS = ["codex", "gemini", "opencode"];
const SUPPORTED_AGENTS = new Set(DEFAULT_AGENTS);
const DEFAULT_URL = "http://127.0.0.1:5187";
const DEFAULT_PROMPT = "Reply exactly with: rlab-smoke-ok";
const DEFAULT_TIMEOUT_MS = 180000;

function usage() {
  return [
    "Usage: npm run smoke:agents -- [options]",
    "",
    "Runs real /api/run smoke checks against an already running web-ui server.",
    "",
    "Options:",
    `  --url <url>             Server URL. Default: ${DEFAULT_URL}`,
    "  --agents <list>         Comma-separated agents. Default agents: codex,gemini,opencode",
    `  --prompt <text>         Prompt to send. Default: ${DEFAULT_PROMPT}`,
    `  --timeout-ms <number>   Per-agent timeout. Default: ${DEFAULT_TIMEOUT_MS}`,
    "  --cwd <path>            Working directory sent to /api/run. Default: current directory",
    "  --access <mode>         read-only or unrestricted. Default: read-only",
    "  --models <map>          Comma map, for example codex=gpt-5.5,opencode=opencode/big-pickle",
    "  --reasoning <map>       Comma map, for example codex=high,opencode=medium",
    "  --help                  Show this help",
  ].join("\n");
}

function parseKeyValueMap(value, flag) {
  if (!value) {
    return new Map();
  }
  const result = new Map();
  for (const item of value.split(",")) {
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0 || separator === trimmed.length - 1) {
      throw new Error(`${flag} entries must use agent=value.`);
    }
    const agent = trimmed.slice(0, separator).trim();
    const selected = trimmed.slice(separator + 1).trim();
    if (!SUPPORTED_AGENTS.has(agent)) {
      throw new Error(`Unsupported smoke agent '${agent}'.`);
    }
    result.set(agent, selected);
  }
  return result;
}

function parseAgentList(value) {
  if (!value) {
    return DEFAULT_AGENTS;
  }
  const agents = value
    .split(",")
    .map((agent) => agent.trim())
    .filter(Boolean);
  if (agents.length === 0) {
    throw new Error("--agents must include at least one agent.");
  }
  for (const agent of agents) {
    if (!SUPPORTED_AGENTS.has(agent)) {
      throw new Error(`Unsupported smoke agent '${agent}'.`);
    }
  }
  return agents;
}

function readFlagValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    url: process.env.AGENT_SMOKE_URL || DEFAULT_URL,
    agents: DEFAULT_AGENTS,
    prompt: DEFAULT_PROMPT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    cwd: process.cwd(),
    accessMode: "read-only",
    models: new Map(),
    reasoning: new Map(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      return { ...options, help: true };
    }
    if (flag === "--url") {
      options.url = readFlagValue(argv, index, flag);
      index += 1;
      continue;
    }
    if (flag === "--agents") {
      options.agents = parseAgentList(readFlagValue(argv, index, flag));
      index += 1;
      continue;
    }
    if (flag === "--prompt") {
      options.prompt = readFlagValue(argv, index, flag);
      index += 1;
      continue;
    }
    if (flag === "--timeout-ms") {
      const value = Number(readFlagValue(argv, index, flag));
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("--timeout-ms must be a positive number.");
      }
      options.timeoutMs = value;
      index += 1;
      continue;
    }
    if (flag === "--cwd") {
      options.cwd = readFlagValue(argv, index, flag);
      index += 1;
      continue;
    }
    if (flag === "--access") {
      const value = readFlagValue(argv, index, flag);
      if (value !== "read-only" && value !== "unrestricted") {
        throw new Error("--access must be read-only or unrestricted.");
      }
      options.accessMode = value;
      index += 1;
      continue;
    }
    if (flag === "--models") {
      options.models = parseKeyValueMap(readFlagValue(argv, index, flag), flag);
      index += 1;
      continue;
    }
    if (flag === "--reasoning") {
      options.reasoning = parseKeyValueMap(readFlagValue(argv, index, flag), flag);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${flag}`);
  }
  return options;
}

function runUrl(baseUrl) {
  return new URL("/api/run", baseUrl);
}

function parseRunEvent(line) {
  const parsed = JSON.parse(line);
  if (!parsed || typeof parsed !== "object" || typeof parsed.type !== "string") {
    throw new Error(`Malformed run event: ${line}`);
  }
  return parsed;
}

async function readRunEvents(response) {
  if (!response.body) {
    throw new Error("Run response has no stream body.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  const consume = (line) => {
    const trimmed = line.trim();
    if (trimmed) {
      events.push(parseRunEvent(trimmed));
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      consume(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  consume(buffer);
  return events;
}

function summarizeEvents(agent, events) {
  const errors = events.filter((event) => event.type === "error");
  if (errors.length > 0) {
    throw new Error(`${agent}: ${errors.map((event) => event.text || "run error").join("; ")}`);
  }
  const blockingStatuses = events.filter((event) => event.type === "status" && (event.level === "warn" || event.level === "error"));
  if (blockingStatuses.length > 0) {
    throw new Error(`${agent}: ${blockingStatuses.map((event) => event.text || `${event.level} status`).join("; ")}`);
  }
  if (!events.some((event) => event.type === "done")) {
    throw new Error(`${agent}: run stream ended without done event.`);
  }
  const text = events
    .filter((event) => event.type === "text" && typeof event.text === "string")
    .map((event) => event.text)
    .join("")
    .trim();
  if (!text) {
    throw new Error(`${agent}: run completed without assistant text.`);
  }
  return { agent, text, events: events.length };
}

async function smokeAgent(options, agent) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(runUrl(options.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent,
        model: options.models.get(agent) ?? "default",
        reasoning: options.reasoning.get(agent) ?? "default",
        mode: "default",
        prompt: options.prompt,
        cwd: options.cwd,
        accessMode: options.accessMode,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${agent}: /api/run returned HTTP ${response.status}.`);
    }
    return summarizeEvents(agent, await readRunEvents(response));
  } catch (error) {
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
      throw new Error(`${agent}: timed out after ${options.timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const results = [];
  for (const agent of options.agents) {
    results.push(await smokeAgent(options, agent));
  }
  console.log(JSON.stringify({ ok: true, url: options.url, results }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
