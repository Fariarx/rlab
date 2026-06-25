#!/usr/bin/env node
// Standalone stdio MCP server that exposes rlab's chat tools to agents that
// load external MCP servers (Claude SDK, OpenCode, Gemini). Codex uses native
// dynamic tools instead.
//
// The handler only acknowledges the call: rlab's run-stream translator watches
// the agent's tool call/result and does the real scheduling/cancel/list server
// side (see wakeupFollowupEvents in vite-agents-plugin.ts). So this server just
// makes the tool *callable*.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const ACK = "rlab accepted the request and handles it server-side. Finish this turn after reporting the result.";

const server = new McpServer({ name: "rlab", version: "1.0.0" });

server.registerTool(
  "TaskWakeup",
  {
    description:
      "Schedule, cancel, or list an rlab task wakeup in the current chat. To schedule, provide prompt plus delaySeconds, fireAt, cron, or script (with intervalSeconds/cron). To cancel, provide action='cancel' plus wakeupId/id or all=true. To inspect, action='list'. rlab fires the wakeup server-side and updates the tool result with the current wakeup list after schedule/cancel.",
    inputSchema: {
      action: z.string().optional(),
      prompt: z.string().optional(),
      reason: z.string().optional(),
      delaySeconds: z.number().optional(),
      fireAt: z.string().optional(),
      cron: z.string().optional(),
      script: z.string().optional(),
      intervalSeconds: z.number().optional(),
      wakeupId: z.string().optional(),
      id: z.string().optional(),
      all: z.boolean().optional(),
    },
  },
  async () => ({ content: [{ type: "text", text: ACK }] }),
);

server.registerTool(
  "TaskGoal",
  {
    description:
      "Create or manage a persistent rlab goal in the current chat queue. Use action='add' with description. Use action='complete' or action='remove' with goalId/id when achieved or no longer needed. action='list' inspects goals.",
    inputSchema: {
      action: z.string().optional(),
      description: z.string().optional(),
      goalId: z.string().optional(),
      id: z.string().optional(),
      afterItemId: z.string().optional(),
    },
  },
  async () => ({ content: [{ type: "text", text: ACK }] }),
);

await server.connect(new StdioServerTransport());
