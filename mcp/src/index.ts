import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

type ActIntent =
  | { type: "move"; dir: "N" | "S" | "E" | "W" }
  | { type: "wait" }
  | { type: "attack"; target_id: string }
  | { type: "pickup"; item_id?: string };

const backendBase = process.env.BACKEND_URL ?? "http://localhost:3000";

async function backendRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${backendBase}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const body = (await res.json()) as T | { ok?: false; error?: { code?: string; message?: string } };
  if (!res.ok) {
    const errorBody = body as { error?: { code?: string; message?: string } };
    const message = errorBody.error?.message ?? `Backend request failed (${res.status})`;
    throw new Error(message);
  }

  return body as T;
}

function textResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

const server = new McpServer(
  {
    name: "dungeon-mcp-agent-server",
    version: "0.1.0",
  },
  {
    instructions:
      "MCP server for interacting with the dungeon backend. Tools support join, act, state, wait_state, and observer_state.",
  },
);

server.registerTool("health", { description: "Get backend health and committed tick." }, async () => {
  const data = await backendRequest<{ ok: boolean; committed_tick: number }>("/health", { method: "GET" });
  return textResult(data);
});

server.registerTool("observer_state", { description: "Get full observer snapshot of the world." }, async () => {
  const data = await backendRequest<{ ok: boolean; snapshot: unknown }>("/observer_state", { method: "GET" });
  return textResult(data);
});

server.registerTool(
  "join_player",
  {
    description: "Join as a new player and return player_id + initial snapshot.",
    inputSchema: {
      name: z.string().optional(),
    },
  },
  async ({ name }) => {
    const data = await backendRequest<{ ok: boolean; player_id: string; snapshot: unknown }>("/join", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    return textResult(data);
  },
);

server.registerTool(
  "get_state",
  {
    description: "Get current committed player snapshot.",
    inputSchema: {
      player_id: z.string(),
    },
  },
  async ({ player_id }) => {
    const data = await backendRequest<{ ok: boolean; snapshot: unknown }>(
      `/state?player_id=${encodeURIComponent(player_id)}`,
      { method: "GET" },
    );
    return textResult(data);
  },
);

server.registerTool(
  "wait_state",
  {
    description: "Wait for a state newer than after_tick (long poll).",
    inputSchema: {
      player_id: z.string(),
      after_tick: z.number(),
      timeout_s: z.number().optional(),
    },
  },
  async ({ player_id, after_tick, timeout_s }) => {
    const timeout = timeout_s ?? 20;
    const data = await backendRequest<{ ok: boolean; timed_out: boolean; snapshot: unknown }>(
      `/wait_state?player_id=${encodeURIComponent(player_id)}&after_tick=${after_tick}&timeout_s=${timeout}`,
      { method: "GET" },
    );
    return textResult(data);
  },
);

server.registerTool(
  "act",
  {
    description: "Submit next-tick action intent (move, wait, attack, pickup), optionally with emote/client_tick.",
    inputSchema: {
      player_id: z.string(),
      action: z.enum(["move", "wait", "attack", "pickup"]),
      dir: z.enum(["N", "S", "E", "W"]).optional(),
      target_id: z.string().optional(),
      item_id: z.string().optional(),
      emote: z.string().optional(),
      client_tick: z.number().optional(),
    },
  },
  async ({ player_id, action, dir, target_id, item_id, emote, client_tick }) => {
    let intent: ActIntent;
    if (action === "move") {
      if (!dir) {
        throw new Error("dir is required when action is move");
      }
      intent = { type: "move", dir };
    } else if (action === "wait") {
      intent = { type: "wait" };
    } else if (action === "attack") {
      if (!target_id) {
        throw new Error("target_id is required when action is attack");
      }
      intent = { type: "attack", target_id };
    } else {
      intent = item_id ? { type: "pickup", item_id } : { type: "pickup" };
    }

    const data = await backendRequest<{
      ok: boolean;
      accepted_for_tick: number;
      tick_status: "unspecified" | "stale" | "current" | "ahead";
      snapshot: unknown;
    }>("/act", {
      method: "POST",
      body: JSON.stringify({
        player_id,
        intent,
        emote,
        client_tick,
      }),
    });
    return textResult(data);
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[dungeon-mcp] MCP server connected over stdio (backend: ${backendBase})`);
}

main().catch((err) => {
  console.error("[dungeon-mcp] Failed to start MCP server", err);
  process.exit(1);
});
