import { Hono } from "hono";
import { isIntent } from "./sim/actions";
import { defaultShardConfig, GameShard } from "./sim/shard";

type ApiError = {
  code: string;
  message: string;
};

function apiError(status: number, code: string, message: string): Response {
  const payload: { ok: false; error: ApiError } = {
    ok: false,
    error: { code, message },
  };
  return Response.json(payload, { status });
}

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as unknown;
    if (!body || typeof body !== "object") {
      throw new Error("Invalid JSON object");
    }
    return body as Record<string, unknown>;
  } catch {
    throw new Error("INVALID_JSON");
  }
}

export function startServer(port = Number(process.env.PORT ?? 3000)) {
  const shard = new GameShard(defaultShardConfig());
  shard.start();

  const app = new Hono();

  app.get("/observer_state", (c) => {
    return c.json({ ok: true, snapshot: shard.getObserverSnapshot() });
  });

  app.post("/join", async (c) => {
    try {
      const body = await parseBody(c.req.raw);
      const name = typeof body.name === "string" ? body.name : undefined;
      const joined = shard.joinPlayer(name);
      return c.json({ ok: true, player_id: joined.player_id, snapshot: joined.snapshot });
    } catch (err) {
      if (err instanceof Error && err.message === "INVALID_JSON") {
        return apiError(400, "INVALID_JSON", "Request body must be valid JSON.");
      }
      return apiError(500, "JOIN_FAILED", "Failed to join player.");
    }
  });

  app.post("/act", async (c) => {
    try {
      const body = await parseBody(c.req.raw);
      const player_id = body.player_id;
      const intent = body.intent;
      const emote = body.emote;

      if (typeof player_id !== "string" || !isIntent(intent)) {
        return apiError(400, "INVALID_ACTION", "Body must include player_id and a valid intent.");
      }

      if (emote !== undefined && typeof emote !== "string") {
        return apiError(400, "INVALID_EMOTE", "emote must be a string if provided.");
      }

      const result = shard.submitAction({ player_id, intent, emote });
      return c.json({
        ok: true,
        accepted_for_tick: result.acceptedForTick,
        snapshot: result.snapshot,
      });
    } catch (err) {
      if (err instanceof Error && err.message === "INVALID_JSON") {
        return apiError(400, "INVALID_JSON", "Request body must be valid JSON.");
      }
      if (err instanceof Error && err.message === "PLAYER_NOT_FOUND") {
        return apiError(404, "PLAYER_NOT_FOUND", "Unknown player_id.");
      }
      if (err instanceof Error && err.message === "EMOTE_TOO_LONG") {
        return apiError(400, "EMOTE_TOO_LONG", "emote length must be <= 200.");
      }
      return apiError(500, "ACT_FAILED", "Failed to submit action.");
    }
  });

  app.get("/wait_state", async (c) => {
    try {
      const player_id = c.req.query("player_id");
      const after_tick = Number(c.req.query("after_tick") ?? "0");
      const timeout_s = Number(c.req.query("timeout_s") ?? "20");

      if (!player_id || !Number.isFinite(after_tick) || !Number.isFinite(timeout_s)) {
        return apiError(400, "INVALID_QUERY", "player_id, after_tick and timeout_s are required.");
      }

      const cappedTimeout = Math.max(1, Math.min(30, timeout_s));
      const result = await shard.waitForState(player_id, after_tick, cappedTimeout);
      return c.json({ ok: true, timed_out: !!result.timed_out, snapshot: result.snapshot });
    } catch (err) {
      if (err instanceof Error && err.message === "PLAYER_NOT_FOUND") {
        return apiError(404, "PLAYER_NOT_FOUND", "Unknown player_id.");
      }
      return apiError(500, "WAIT_FAILED", "Failed to wait for state.");
    }
  });

  app.get("/state", (c) => {
    try {
      const player_id = c.req.query("player_id");
      if (!player_id) {
        return apiError(400, "INVALID_QUERY", "player_id is required.");
      }
      const snapshot = shard.getSnapshot(player_id);
      return c.json({ ok: true, snapshot });
    } catch (err) {
      if (err instanceof Error && err.message === "PLAYER_NOT_FOUND") {
        return apiError(404, "PLAYER_NOT_FOUND", "Unknown player_id.");
      }
      return apiError(500, "STATE_FAILED", "Failed to read state.");
    }
  });

  app.get("/health", () => {
    return Response.json({ ok: true, committed_tick: shard.getCommittedTick() });
  });

  app.notFound(() => apiError(404, "NOT_FOUND", "Route not found."));

  const server = Bun.serve({
    port,
    websocket: {
      open(ws) {
        ws.subscribe("observer");
        ws.send(JSON.stringify({ type: "observer_state", snapshot: shard.getObserverSnapshot() }));
      },
      message() {
      },
      close() {
      },
    },
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/ws/observer" && req.method === "GET") {
        const upgraded = server.upgrade(req);
        if (upgraded) return;
        return apiError(400, "WS_UPGRADE_FAILED", "Could not upgrade websocket request.");
      }
      return app.fetch(req);
    },
    error(err) {
      console.error(err);
      return apiError(500, "INTERNAL", "Internal server error.");
    },
  });

  shard.onTick((snapshot) => {
    server.publish("observer", JSON.stringify({ type: "observer_state", snapshot }));
  });

  return {
    port: server.port,
    stop: () => {
      shard.stop();
      server.stop();
    },
  };
}
