import { isIntent } from "./sim/actions";
import { defaultShardConfig, GameShard } from "./sim/shard";

type ApiError = {
  code: string;
  message: string;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function error(status: number, code: string, message: string): Response {
  const payload: { ok: false; error: ApiError } = {
    ok: false,
    error: { code, message },
  };
  return json(payload, status);
}

const observerHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Dungeon Observer</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f1ea;
        --card: #fff9ef;
        --ink: #1f2724;
        --muted: #5a655f;
        --accent: #9f3f23;
        --line: #d7c9b1;
      }
      body {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, serif;
        color: var(--ink);
        background:
          radial-gradient(circle at 8% 12%, #fff4d6 0, transparent 30%),
          radial-gradient(circle at 90% 0%, #f0e2cb 0, transparent 24%),
          var(--bg);
      }
      .wrap {
        max-width: 1100px;
        margin: 2rem auto;
        padding: 0 1rem 2rem;
      }
      h1 {
        margin: 0 0 0.5rem;
        letter-spacing: 0.03em;
        font-size: 1.8rem;
      }
      .sub {
        color: var(--muted);
        margin-bottom: 1rem;
      }
      .grid {
        display: grid;
        grid-template-columns: minmax(300px, 1fr) minmax(260px, 320px);
        gap: 1rem;
      }
      .card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 12px;
        box-shadow: 0 8px 18px rgba(43, 33, 19, 0.07);
      }
      .card h2 {
        margin: 0;
        padding: 0.75rem 0.9rem;
        border-bottom: 1px solid var(--line);
        font-size: 1rem;
      }
      .card .body {
        padding: 0.9rem;
      }
      #meta {
        display: flex;
        justify-content: space-between;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      pre {
        margin: 0;
        overflow: auto;
        font-size: 14px;
        line-height: 1.05rem;
        padding: 0.75rem;
        border-radius: 8px;
        background: #111815;
        color: #e9ffe7;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
      }
      th, td {
        text-align: left;
        padding: 0.35rem 0.3rem;
        border-bottom: 1px dashed var(--line);
      }
      th {
        color: var(--muted);
        font-weight: 600;
      }
      .status {
        margin-top: 0.5rem;
        color: var(--muted);
      }
      .ok { color: #167e45; }
      .bad { color: #9b3320; }
      @media (max-width: 920px) {
        .grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Dungeon Observer</h1>
      <div class="sub">Live shared-world map, players, mobs, and items</div>
      <div class="grid">
        <section class="card">
          <h2>World Map</h2>
          <div class="body">
            <div id="meta">
              <span id="tick">tick: --</span>
              <span id="counts">players: 0 | mobs: 0 | items: 0</span>
            </div>
            <pre id="map">waiting for state...</pre>
            <div class="status" id="status">connecting...</div>
          </div>
        </section>
        <section class="card">
          <h2>Entities</h2>
          <div class="body">
            <h3>Players</h3>
            <table id="players"><thead><tr><th>id</th><th>pos</th><th>hp</th></tr></thead><tbody></tbody></table>
            <h3>Mobs</h3>
            <table id="mobs"><thead><tr><th>id</th><th>kind</th><th>pos</th><th>hp</th></tr></thead><tbody></tbody></table>
            <h3>Items</h3>
            <table id="items"><thead><tr><th>id</th><th>kind</th><th>pos</th></tr></thead><tbody></tbody></table>
          </div>
        </section>
      </div>
    </div>
    <script>
      const mapEl = document.getElementById("map");
      const statusEl = document.getElementById("status");
      const tickEl = document.getElementById("tick");
      const countsEl = document.getElementById("counts");
      const playersBody = document.querySelector("#players tbody");
      const mobsBody = document.querySelector("#mobs tbody");
      const itemsBody = document.querySelector("#items tbody");

      const fmtPos = (p) => "(" + p.x + "," + p.y + ")";

      function renderTableRows(tbody, rows) {
        tbody.innerHTML = rows.length ? rows.join("") : "<tr><td colspan='4'>none</td></tr>";
      }

      function render(snapshot) {
        tickEl.textContent = "tick: " + snapshot.committed_tick;
        countsEl.textContent =
          "players: " + snapshot.players.length +
          " | mobs: " + snapshot.mobs.length +
          " | items: " + snapshot.items.length;
        mapEl.textContent = snapshot.map.ascii.join("\\n");

        renderTableRows(
          playersBody,
          snapshot.players.map((p) =>
            "<tr><td>" + p.id + "</td><td>" + fmtPos(p.pos) + "</td><td>" + p.hp + "/" + p.max_hp + (p.alive ? "" : " (down)") + "</td></tr>"
          )
        );
        renderTableRows(
          mobsBody,
          snapshot.mobs.map((m) =>
            "<tr><td>" + m.id + "</td><td>" + m.kind + "</td><td>" + fmtPos(m.pos) + "</td><td>" + m.hp + "/" + m.max_hp + (m.alive ? "" : " (down)") + "</td></tr>"
          )
        );
        renderTableRows(
          itemsBody,
          snapshot.items.map((i) =>
            "<tr><td>" + i.id + "</td><td>" + i.kind + "</td><td>" + fmtPos(i.pos) + "</td></tr>"
          )
        );
      }

      function connect() {
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(protocol + "//" + location.host + "/ws/observer");

        ws.onopen = () => {
          statusEl.textContent = "connected";
          statusEl.className = "status ok";
        };
        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            if (payload.type === "observer_state" && payload.snapshot) {
              render(payload.snapshot);
            }
          } catch {
            statusEl.textContent = "message parse error";
            statusEl.className = "status bad";
          }
        };
        ws.onclose = () => {
          statusEl.textContent = "disconnected, retrying...";
          statusEl.className = "status bad";
          setTimeout(connect, 1200);
        };
      }

      fetch("/observer_state")
        .then((r) => r.json())
        .then((data) => {
          if (data.ok && data.snapshot) render(data.snapshot);
        })
        .catch(() => {});

      connect();
    </script>
  </body>
</html>`;

async function parseJson(req: Request): Promise<Record<string, unknown>> {
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
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (req.method === "GET" && path === "/ws/observer") {
        const upgraded = server.upgrade(req);
        if (upgraded) return;
        return error(400, "WS_UPGRADE_FAILED", "Could not upgrade websocket request.");
      }

      if (req.method === "GET" && path === "/observer") {
        return new Response(observerHtml, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      if (req.method === "GET" && path === "/observer_state") {
        return json({ ok: true, snapshot: shard.getObserverSnapshot() });
      }

      if (req.method === "POST" && path === "/join") {
        try {
          const body = await parseJson(req);
          const name = typeof body.name === "string" ? body.name : undefined;
          const joined = shard.joinPlayer(name);
          return json({ ok: true, player_id: joined.player_id, snapshot: joined.snapshot });
        } catch (err) {
          if (err instanceof Error && err.message === "INVALID_JSON") {
            return error(400, "INVALID_JSON", "Request body must be valid JSON.");
          }
          return error(500, "JOIN_FAILED", "Failed to join player.");
        }
      }

      if (req.method === "POST" && path === "/act") {
        try {
          const body = await parseJson(req);
          const player_id = body.player_id;
          const intent = body.intent;
          const emote = body.emote;

          if (typeof player_id !== "string" || !isIntent(intent)) {
            return error(400, "INVALID_ACTION", "Body must include player_id and a valid intent.");
          }

          if (emote !== undefined && typeof emote !== "string") {
            return error(400, "INVALID_EMOTE", "emote must be a string if provided.");
          }

          const result = shard.submitAction({ player_id, intent, emote });
          return json({
            ok: true,
            accepted_for_tick: result.acceptedForTick,
            snapshot: result.snapshot,
          });
        } catch (err) {
          if (err instanceof Error && err.message === "INVALID_JSON") {
            return error(400, "INVALID_JSON", "Request body must be valid JSON.");
          }
          if (err instanceof Error && err.message === "PLAYER_NOT_FOUND") {
            return error(404, "PLAYER_NOT_FOUND", "Unknown player_id.");
          }
          if (err instanceof Error && err.message === "EMOTE_TOO_LONG") {
            return error(400, "EMOTE_TOO_LONG", "emote length must be <= 200.");
          }
          return error(500, "ACT_FAILED", "Failed to submit action.");
        }
      }

      if (req.method === "GET" && path === "/wait_state") {
        try {
          const player_id = url.searchParams.get("player_id");
          const after_tick = Number(url.searchParams.get("after_tick") ?? "0");
          const timeout_s = Number(url.searchParams.get("timeout_s") ?? "20");

          if (!player_id || !Number.isFinite(after_tick) || !Number.isFinite(timeout_s)) {
            return error(400, "INVALID_QUERY", "player_id, after_tick and timeout_s are required.");
          }

          const cappedTimeout = Math.max(1, Math.min(30, timeout_s));
          const result = await shard.waitForState(player_id, after_tick, cappedTimeout);

          return json({ ok: true, timed_out: !!result.timed_out, snapshot: result.snapshot });
        } catch (err) {
          if (err instanceof Error && err.message === "PLAYER_NOT_FOUND") {
            return error(404, "PLAYER_NOT_FOUND", "Unknown player_id.");
          }
          return error(500, "WAIT_FAILED", "Failed to wait for state.");
        }
      }

      if (req.method === "GET" && path === "/state") {
        try {
          const player_id = url.searchParams.get("player_id");
          if (!player_id) {
            return error(400, "INVALID_QUERY", "player_id is required.");
          }
          const snapshot = shard.getSnapshot(player_id);
          return json({ ok: true, snapshot });
        } catch (err) {
          if (err instanceof Error && err.message === "PLAYER_NOT_FOUND") {
            return error(404, "PLAYER_NOT_FOUND", "Unknown player_id.");
          }
          return error(500, "STATE_FAILED", "Failed to read state.");
        }
      }

      if (req.method === "GET" && path === "/health") {
        return json({ ok: true, committed_tick: shard.getCommittedTick() });
      }

      return error(404, "NOT_FOUND", "Route not found.");
    },
    error(err) {
      console.error(err);
      return error(500, "INTERNAL", "Internal server error.");
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
