import { useEffect, useMemo, useRef, useState } from "react";

type Pos = { x: number; y: number };

type ObserverSnapshot = {
  committed_tick: number;
  map: {
    ascii: string[];
    legend: Record<string, string>;
    width: number;
    height: number;
  };
  players: Array<{ id: string; name: string; pos: Pos; hp: number; max_hp: number; alive: boolean }>;
  mobs: Array<{ id: string; kind: string; pos: Pos; hp: number; max_hp: number; alive: boolean }>;
  items: Array<{ id: string; kind: string; pos: Pos }>;
};

type VisibleEntity = {
  id: string;
  kind: string;
  pos: Pos;
  hp?: number;
};

type PlayerSnapshot = {
  committed_tick: number;
  player_id: string;
  you: {
    pos: Pos;
    hp: number;
    max_hp: number;
    alive: boolean;
    escaped: boolean;
    last_action_result: string;
  };
  view: {
    ascii: string[];
    legend: Record<string, string>;
    radius: number;
  };
  visible: {
    players: VisibleEntity[];
    mobs: VisibleEntity[];
    items: VisibleEntity[];
  };
  events: string[];
};

type MoveDir = "N" | "S" | "E" | "W";
type ActionType = "move" | "wait" | "attack" | "pickup";

type ActIntent =
  | { type: "move"; dir: MoveDir }
  | { type: "wait" }
  | { type: "attack"; target_id: string }
  | { type: "pickup"; item_id?: string };

function formatPos(pos: Pos): string {
  return `(${pos.x}, ${pos.y})`;
}

async function parseJson<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T;
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return body;
}

export default function App() {
  const [snapshot, setSnapshot] = useState<ObserverSnapshot | null>(null);
  const [status, setStatus] = useState("connecting");
  const [error, setError] = useState<string | null>(null);

  const [playerName, setPlayerName] = useState("human-agent");
  const [playerId, setPlayerId] = useState<string>("");
  const [playerSnapshot, setPlayerSnapshot] = useState<PlayerSnapshot | null>(null);
  const [agentInfo, setAgentInfo] = useState<string>("");
  const [agentError, setAgentError] = useState<string>("");

  const [actionType, setActionType] = useState<ActionType>("move");
  const [moveDir, setMoveDir] = useState<MoveDir>("N");
  const [targetId, setTargetId] = useState("");
  const [itemId, setItemId] = useState("");
  const [emote, setEmote] = useState("");
  const [autoWaitAfterAction, setAutoWaitAfterAction] = useState(true);
  const [isBusy, setIsBusy] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let mounted = true;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const fetchInitial = async () => {
      try {
        const res = await fetch("/api/observer_state");
        const data = await parseJson<{ ok: boolean; snapshot?: ObserverSnapshot }>(res);
        if (mounted && data.ok && data.snapshot) {
          setSnapshot(data.snapshot);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to fetch initial state");
        }
      }
    };

    const connect = () => {
      setStatus("connecting");
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${protocol}://${window.location.host}/ws/observer`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mounted) return;
        setStatus("connected");
        setError(null);
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as { type?: string; snapshot?: ObserverSnapshot };
          if (payload.type === "observer_state" && payload.snapshot) {
            setSnapshot(payload.snapshot);
          }
        } catch {
          if (mounted) setError("Failed to parse websocket payload");
        }
      };

      ws.onclose = () => {
        if (!mounted) return;
        setStatus("reconnecting");
        retryTimer = setTimeout(() => {
          if (mounted) connect();
        }, 1200);
      };

      ws.onerror = () => {
        if (mounted) setError("websocket error");
      };
    };

    fetchInitial();
    // Delay the initial connect one tick to avoid React StrictMode's
    // throwaway mount from opening/closing a socket immediately in dev.
    connectTimer = setTimeout(connect, 0);

    // Fallback polling keeps observer state fresh even if websocket drops messages.
    const pollTimer = setInterval(() => {
      fetchInitial().catch(() => {});
    }, 2000);

    return () => {
      mounted = false;
      if (connectTimer) clearTimeout(connectTimer);
      if (retryTimer) clearTimeout(retryTimer);
      clearInterval(pollTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  const observerMapText = useMemo(() => snapshot?.map.ascii.join("\n") ?? "waiting for world state...", [snapshot]);
  const playerMapText = useMemo(
    () => playerSnapshot?.view.ascii.join("\n") ?? "join as player to get your fog-of-war view...",
    [playerSnapshot],
  );

  const joinAsPlayer = async () => {
    setIsBusy(true);
    setAgentError("");
    setAgentInfo("");
    try {
      const res = await fetch("/api/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: playerName.trim() || undefined }),
      });
      const data = await parseJson<{ ok: boolean; player_id: string; snapshot: PlayerSnapshot }>(res);
      setPlayerId(data.player_id);
      setPlayerSnapshot(data.snapshot);
      setAgentInfo(`Joined as ${data.player_id}`);
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : "Join failed");
    } finally {
      setIsBusy(false);
    }
  };

  const refreshPlayerState = async () => {
    if (!playerId) {
      setAgentError("Join first.");
      return;
    }
    setIsBusy(true);
    setAgentError("");
    try {
      const res = await fetch(`/api/state?player_id=${encodeURIComponent(playerId)}`);
      const data = await parseJson<{ ok: boolean; snapshot: PlayerSnapshot }>(res);
      setPlayerSnapshot(data.snapshot);
      setAgentInfo(`Refreshed player state at tick ${data.snapshot.committed_tick}`);
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : "State fetch failed");
    } finally {
      setIsBusy(false);
    }
  };

  const waitForNextTick = async (afterTick: number): Promise<{ timedOut: boolean; snapshot: PlayerSnapshot }> => {
    const res = await fetch(
      `/api/wait_state?player_id=${encodeURIComponent(playerId)}&after_tick=${afterTick}&timeout_s=20`,
    );
    const data = await parseJson<{ ok: boolean; timed_out: boolean; snapshot: PlayerSnapshot }>(res);
    return { timedOut: data.timed_out, snapshot: data.snapshot };
  };

  const waitNextTick = async () => {
    if (!playerId || !playerSnapshot) {
      setAgentError("Join first.");
      return;
    }
    setIsBusy(true);
    setAgentError("");
    try {
      const { timedOut, snapshot } = await waitForNextTick(playerSnapshot.committed_tick);
      setPlayerSnapshot(snapshot);
      setAgentInfo(
        timedOut
          ? `No commit yet. Still at tick ${snapshot.committed_tick}`
          : `Advanced to tick ${snapshot.committed_tick}`,
      );
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : "wait_state failed");
    } finally {
      setIsBusy(false);
    }
  };

  const submitIntent = async (intentOverride?: ActIntent) => {
    if (!playerId) {
      setAgentError("Join first.");
      return;
    }

    let intent: ActIntent;
    if (intentOverride) {
      intent = intentOverride;
    } else if (actionType === "move") {
      intent = { type: "move", dir: moveDir };
    } else if (actionType === "wait") {
      intent = { type: "wait" };
    } else if (actionType === "attack") {
      if (!targetId.trim()) {
        setAgentError("attack requires target id");
        return;
      }
      intent = { type: "attack", target_id: targetId.trim() };
    } else {
      intent = itemId.trim() ? { type: "pickup", item_id: itemId.trim() } : { type: "pickup" };
    }

    setIsBusy(true);
    setAgentError("");
    setAgentInfo("");

    try {
      const res = await fetch("/api/act", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          player_id: playerId,
          intent,
          client_tick: playerSnapshot?.committed_tick,
          emote: emote.trim() ? emote.trim() : undefined,
        }),
      });
      const data = await parseJson<{
        ok: boolean;
        accepted_for_tick: number;
        tick_status?: "unspecified" | "stale" | "current" | "ahead";
        snapshot: PlayerSnapshot;
      }>(res);
      setPlayerSnapshot(data.snapshot);
      if (autoWaitAfterAction) {
        const { timedOut, snapshot } = await waitForNextTick(data.snapshot.committed_tick);
        setPlayerSnapshot(snapshot);
        setAgentInfo(
          timedOut
            ? `Action queued for tick ${data.accepted_for_tick}, still waiting at tick ${snapshot.committed_tick}.`
            : `Action resolved at tick ${snapshot.committed_tick}.`,
        );
      } else {
        const tickStatus = data.tick_status ? ` (${data.tick_status})` : "";
        setAgentInfo(
          `Action accepted for tick ${data.accepted_for_tick}. Last commit ${data.snapshot.committed_tick}${tickStatus}.`,
        );
      }
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <main className="app">
      <header className="hero">
        <h1>Dungeon Control Center</h1>
        <p>Observe the shared world and simulate a human-controlled agent using the same API flow.</p>
      </header>

      <section className="stats">
        <div className="stat-card">
          <span>Tick</span>
          <strong>{snapshot?.committed_tick ?? "--"}</strong>
        </div>
        <div className="stat-card">
          <span>Players</span>
          <strong>{snapshot?.players.length ?? 0}</strong>
        </div>
        <div className="stat-card">
          <span>Mobs</span>
          <strong>{snapshot?.mobs.length ?? 0}</strong>
        </div>
        <div className="stat-card">
          <span>Items</span>
          <strong>{snapshot?.items.length ?? 0}</strong>
        </div>
      </section>

      <section className="layout">
        <article className="panel map-panel">
          <h2>World Observer Map</h2>
          <pre>{observerMapText}</pre>
          <div className="status-row">
            <span className={`badge ${status}`}>{status}</span>
            {error ? <span className="error">{error}</span> : null}
          </div>
        </article>

        <article className="panel control-panel">
          <h2>Human Agent Simulator</h2>

          <div className="control-group">
            <label htmlFor="playerName">Name</label>
            <input
              id="playerName"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="agent name"
            />
            <button disabled={isBusy} onClick={joinAsPlayer}>
              Join
            </button>
          </div>

          <div className="control-row">
            <button disabled={isBusy || !playerId} onClick={refreshPlayerState}>Refresh /state</button>
            <button disabled={isBusy || !playerId} onClick={waitNextTick}>Wait Next Tick</button>
          </div>

          <div className="control-row">
            <label className="mini checkbox-label">
              <input
                type="checkbox"
                checked={autoWaitAfterAction}
                onChange={(e) => setAutoWaitAfterAction(e.target.checked)}
              />
              Auto-wait for action resolution
            </label>
          </div>

          <div className="status-row">
            <span className="mini">player_id: {playerId || "--"}</span>
            {agentInfo ? <span className="ok-text">{agentInfo}</span> : null}
            {agentError ? <span className="error">{agentError}</span> : null}
          </div>

          <div className="control-group">
            <label htmlFor="actionType">Action</label>
            <select id="actionType" value={actionType} onChange={(e) => setActionType(e.target.value as ActionType)}>
              <option value="move">move</option>
              <option value="wait">wait</option>
              <option value="attack">attack</option>
              <option value="pickup">pickup</option>
            </select>
          </div>

          {actionType === "move" ? (
            <div className="control-group">
              <label htmlFor="moveDir">Direction</label>
              <select id="moveDir" value={moveDir} onChange={(e) => setMoveDir(e.target.value as MoveDir)}>
                <option value="N">N</option>
                <option value="S">S</option>
                <option value="E">E</option>
                <option value="W">W</option>
              </select>
            </div>
          ) : null}

          {actionType === "attack" ? (
            <div className="control-group">
              <label htmlFor="targetId">Target ID</label>
              <input
                id="targetId"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                placeholder="m1 or p2"
              />
            </div>
          ) : null}

          {actionType === "pickup" ? (
            <div className="control-group">
              <label htmlFor="itemId">Item ID (optional)</label>
              <input
                id="itemId"
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
                placeholder="i2"
              />
            </div>
          ) : null}

          <div className="control-group">
            <label htmlFor="emote">Emote / message (optional)</label>
            <input
              id="emote"
              value={emote}
              onChange={(e) => setEmote(e.target.value)}
              placeholder="one-line message"
            />
          </div>

          <div className="control-row">
            <button disabled={isBusy || !playerId} onClick={() => submitIntent()}>
              Submit Action
            </button>
          </div>

          <div className="dpad">
            <button disabled={isBusy || !playerId} onClick={() => submitIntent({ type: "move", dir: "N" })}>N</button>
            <div className="dpad-mid">
              <button disabled={isBusy || !playerId} onClick={() => submitIntent({ type: "move", dir: "W" })}>W</button>
              <button disabled={isBusy || !playerId} onClick={() => submitIntent({ type: "wait" })}>WAIT</button>
              <button disabled={isBusy || !playerId} onClick={() => submitIntent({ type: "move", dir: "E" })}>E</button>
            </div>
            <button disabled={isBusy || !playerId} onClick={() => submitIntent({ type: "move", dir: "S" })}>S</button>
          </div>
        </article>
      </section>

      <section className="layout">
        <article className="panel map-panel">
          <h2>Player View (Fog of War)</h2>
          <pre>{playerMapText}</pre>
          {playerSnapshot ? (
            <div className="mini-block">
              <div>tick: {playerSnapshot.committed_tick}</div>
              <div>you: {formatPos(playerSnapshot.you.pos)} | hp {playerSnapshot.you.hp}/{playerSnapshot.you.max_hp}</div>
              <div>status: {playerSnapshot.you.escaped ? "escaped" : playerSnapshot.you.alive ? "alive" : "downed"}</div>
              <div>last action: {playerSnapshot.you.last_action_result}</div>
            </div>
          ) : null}
        </article>

        <article className="panel">
          <h2>Player Events</h2>
          <ul className="events-list">
            {playerSnapshot?.events.length ? (
              playerSnapshot.events.map((event, idx) => <li key={`${idx}-${event}`}>{event}</li>)
            ) : (
              <li>No recent events</li>
            )}
          </ul>

          <h2>Visible Entities</h2>
          <table>
            <thead>
              <tr>
                <th>id</th>
                <th>kind</th>
                <th>pos</th>
                <th>hp</th>
              </tr>
            </thead>
            <tbody>
              {[...(playerSnapshot?.visible.players ?? []), ...(playerSnapshot?.visible.mobs ?? []), ...(playerSnapshot?.visible.items ?? [])].length ? (
                [
                  ...(playerSnapshot?.visible.players ?? []),
                  ...(playerSnapshot?.visible.mobs ?? []),
                  ...(playerSnapshot?.visible.items ?? []),
                ].map((entity) => (
                  <tr key={entity.id}>
                    <td>{entity.id}</td>
                    <td>{entity.kind}</td>
                    <td>{formatPos(entity.pos)}</td>
                    <td>{entity.hp === undefined ? "-" : entity.hp}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4}>No visible entities</td>
                </tr>
              )}
            </tbody>
          </table>
        </article>
      </section>

      <section className="layout">
        <article className="panel">
          <h2>Players</h2>
          <table>
            <thead>
              <tr>
                <th>id</th>
                <th>name</th>
                <th>pos</th>
                <th>hp</th>
              </tr>
            </thead>
            <tbody>
              {snapshot?.players.length ? (
                snapshot.players.map((p) => (
                  <tr key={p.id}>
                    <td>{p.id}</td>
                    <td>{p.name}</td>
                    <td>{formatPos(p.pos)}</td>
                    <td>{p.hp}/{p.max_hp}{p.alive ? "" : " (down)"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4}>No players</td>
                </tr>
              )}
            </tbody>
          </table>
        </article>

        <article className="panel">
          <h2>Mobs</h2>
          <table>
            <thead>
              <tr>
                <th>id</th>
                <th>kind</th>
                <th>pos</th>
                <th>hp</th>
              </tr>
            </thead>
            <tbody>
              {snapshot?.mobs.length ? (
                snapshot.mobs.map((m) => (
                  <tr key={m.id}>
                    <td>{m.id}</td>
                    <td>{m.kind}</td>
                    <td>{formatPos(m.pos)}</td>
                    <td>{m.hp}/{m.max_hp}{m.alive ? "" : " (down)"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4}>No mobs</td>
                </tr>
              )}
            </tbody>
          </table>

          <h2>Items</h2>
          <table>
            <thead>
              <tr>
                <th>id</th>
                <th>kind</th>
                <th>pos</th>
              </tr>
            </thead>
            <tbody>
              {snapshot?.items.length ? (
                snapshot.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.id}</td>
                    <td>{i.kind}</td>
                    <td>{formatPos(i.pos)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3}>No items</td>
                </tr>
              )}
            </tbody>
          </table>
        </article>
      </section>
    </main>
  );
}
