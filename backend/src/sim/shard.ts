import { applyIntent, type ActionResult } from "./actions";
import { generateDungeon, pickSpawn, seededRng } from "./gen/dungeon";
import { renderForObserver, renderForPlayer } from "./render/ascii";
import {
  canHear,
  canSee,
  manhattan,
  mobOrderForTick,
  playerOrderForTick,
  type Intent,
  type Mob,
  type Player,
  type Pos,
  type ObserverSnapshot,
  type Snapshot,
  type WorldState,
} from "./world";
import { InMemoryStorage, type PendingAction, type StorageAdapter } from "../storage/memory";

export type ShardConfig = {
  tickMs: number;
  width: number;
  height: number;
  mapSeed: number;
  visionRadius: number;
  hearingRadius: number;
  initialMobCount: number;
  initialItemCount: number;
};

export type ActionTickStatus = "unspecified" | "stale" | "current" | "ahead";

type Waiter = {
  playerId: string;
  afterTick: number;
  resolve: (value: { snapshot: Snapshot; timed_out?: boolean }) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const DEFAULT_INTENT: Intent = { type: "wait" };

function itemKindByRoll(roll: number): string {
  if (roll < 0.33) return "potion";
  if (roll < 0.66) return "coin";
  return "scrap";
}

export function createInitialWorld(config: ShardConfig): WorldState {
  const dungeon = generateDungeon(config.mapSeed, config.width, config.height);
  return {
    seed: config.mapSeed,
    width: config.width,
    height: config.height,
    visionRadius: config.visionRadius,
    hearingRadius: config.hearingRadius,
    committedTick: 0,
    tiles: dungeon.tiles,
    players: {},
    mobs: {},
    items: {},
  };
}

export class GameShard {
  private storage: StorageAdapter;

  private readonly config: ShardConfig;

  private rng: () => number;

  private readonly walkable: Pos[];

  private readonly occupiedSpawns = new Set<string>();

  private waiters: Waiter[] = [];

  private loop: ReturnType<typeof setInterval> | undefined;
  private tickListeners = new Set<(snapshot: ObserverSnapshot) => void>();

  private nextPlayerId = 1;

  private nextMobId = 1;

  private nextItemId = 1;

  constructor(config: ShardConfig, storage?: StorageAdapter) {
    this.config = config;
    this.rng = seededRng(config.mapSeed);

    const dungeon = generateDungeon(config.mapSeed, config.width, config.height);
    this.walkable = dungeon.walkable;

    const world = createInitialWorld(config);
    this.storage = storage ?? new InMemoryStorage(world);

    this.seedInitialMobsAndItems();
  }

  start(): void {
    if (this.loop) return;
    this.loop = setInterval(() => this.commitTick(), this.config.tickMs);
  }

  stop(): void {
    if (!this.loop) return;
    clearInterval(this.loop);
    this.loop = undefined;
  }

  getCommittedTick(): number {
    return this.storage.getWorld().committedTick;
  }

  joinPlayer(name?: string): { player_id: string; snapshot: Snapshot } {
    const world = this.storage.getWorld();
    const playerId = `p${this.nextPlayerId++}`;
    const spawn = pickSpawn(this.walkable, this.occupiedSpawns, this.rng);

    world.players[playerId] = {
      id: playerId,
      name: name?.trim() || playerId,
      pos: spawn,
      hp: 12,
      maxHp: 12,
      speed: 10,
      alive: true,
      lastActionResult: "Joined the dungeon.",
      inventory: [],
    };

    this.storage.setWorld(world);
    this.storage.pushPlayerEvent(playerId, world.committedTick, "You enter the dungeon.");
    const snapshot = this.buildSnapshot(playerId);
    return { player_id: playerId, snapshot };
  }

  submitAction(action: PendingAction): { acceptedForTick: number; snapshot: Snapshot; tickStatus: ActionTickStatus } {
    const world = this.storage.getWorld();
    const player = world.players[action.player_id];
    if (!player) {
      throw new Error("PLAYER_NOT_FOUND");
    }

    if (action.emote && action.emote.length > 200) {
      throw new Error("EMOTE_TOO_LONG");
    }

    this.storage.setPendingAction(action);

    const acceptedForTick = world.committedTick + 1;
    const snapshot = this.buildSnapshot(action.player_id);
    const tickStatus: ActionTickStatus = action.client_tick === undefined
      ? "unspecified"
      : action.client_tick < world.committedTick
        ? "stale"
        : action.client_tick === world.committedTick
          ? "current"
          : "ahead";
    return { acceptedForTick, snapshot, tickStatus };
  }

  async waitForState(playerId: string, afterTick: number, timeoutSeconds: number): Promise<{ snapshot: Snapshot; timed_out?: boolean }> {
    const world = this.storage.getWorld();
    if (!world.players[playerId]) {
      throw new Error("PLAYER_NOT_FOUND");
    }

    if (world.committedTick > afterTick) {
      return { snapshot: this.buildSnapshot(playerId) };
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== resolve);
        resolve({ snapshot: this.buildSnapshot(playerId), timed_out: true });
      }, Math.max(1, timeoutSeconds) * 1000);

      this.waiters.push({
        playerId,
        afterTick,
        resolve,
        timeout,
      });
    });
  }

  getSnapshot(playerId: string): Snapshot {
    const world = this.storage.getWorld();
    if (!world.players[playerId]) {
      throw new Error("PLAYER_NOT_FOUND");
    }
    return this.buildSnapshot(playerId);
  }

  getObserverSnapshot(): ObserverSnapshot {
    const world = this.storage.getWorld();
    return {
      committed_tick: world.committedTick,
      map: renderForObserver(world),
      players: Object.values(world.players).map((player) => ({
        id: player.id,
        name: player.name,
        pos: { ...player.pos },
        hp: player.hp,
        max_hp: player.maxHp,
        alive: player.alive,
      })),
      mobs: Object.values(world.mobs).map((mob) => ({
        id: mob.id,
        kind: mob.kind,
        pos: { ...mob.pos },
        hp: mob.hp,
        max_hp: mob.maxHp,
        alive: mob.alive,
      })),
      items: Object.values(world.items).map((item) => ({
        id: item.id,
        kind: item.kind,
        pos: { ...item.pos },
      })),
    };
  }

  onTick(listener: (snapshot: ObserverSnapshot) => void): () => void {
    this.tickListeners.add(listener);
    return () => {
      this.tickListeners.delete(listener);
    };
  }

  private seedInitialMobsAndItems(): void {
    const world = this.storage.getWorld();
    for (let i = 0; i < this.config.initialMobCount; i += 1) {
      const mobId = `m${this.nextMobId++}`;
      const pos = pickSpawn(this.walkable, this.occupiedSpawns, this.rng);
      world.mobs[mobId] = {
        id: mobId,
        kind: "goblin",
        pos,
        hp: 8,
        maxHp: 8,
        speed: 7,
        alive: true,
        lastActionResult: "",
      };
    }

    for (let i = 0; i < this.config.initialItemCount; i += 1) {
      const itemId = `i${this.nextItemId++}`;
      const pos = pickSpawn(this.walkable, this.occupiedSpawns, this.rng);
      world.items[itemId] = {
        id: itemId,
        kind: itemKindByRoll(this.rng()),
        pos,
      };
    }

    this.storage.setWorld(world);
  }

  private commitTick(): void {
    const world = this.storage.getWorld();
    const nextTick = world.committedTick + 1;

    const frozenActions = new Map(this.storage.getPendingActions());
    this.storage.clearPendingActions();

    for (const player of playerOrderForTick(world)) {
      const submitted = frozenActions.get(player.id);
      const intent = submitted?.intent ?? DEFAULT_INTENT;
      const result = applyIntent(world, player, intent);
      player.lastActionResult = result.message;

      this.storage.pushPlayerEvent(player.id, nextTick, result.message);

      this.publishActionEvent(world, player, submitted?.emote, result, nextTick);
    }

    for (const mob of mobOrderForTick(world)) {
      const mobIntent = this.chooseMobIntent(world, mob);
      const result = applyIntent(world, mob, mobIntent);
      mob.lastActionResult = result.message;

      this.publishActionEvent(world, mob, undefined, result, nextTick);
    }

    world.committedTick = nextTick;
    this.storage.setWorld(world);
    this.notifyTickListeners();
    this.flushWaiters();
  }

  private notifyTickListeners(): void {
    if (this.tickListeners.size === 0) {
      return;
    }
    const snapshot = this.getObserverSnapshot();
    for (const listener of this.tickListeners) {
      listener(snapshot);
    }
  }

  private chooseMobIntent(world: WorldState, mob: Mob): Intent {
    const alivePlayers = Object.values(world.players).filter((p) => p.alive);
    if (alivePlayers.length === 0) {
      return { type: "wait" };
    }

    const sorted = [...alivePlayers].sort(
      (a, b) => manhattan(mob.pos, a.pos) - manhattan(mob.pos, b.pos) || a.id.localeCompare(b.id),
    );
    const target = sorted[0];
    if (!target) {
      return { type: "wait" };
    }
    const dist = manhattan(mob.pos, target.pos);

    if (dist <= 1) {
      return { type: "attack", target_id: target.id };
    }

    if (dist <= 6) {
      const dx = target.pos.x - mob.pos.x;
      const dy = target.pos.y - mob.pos.y;
      const axisFirst = Math.abs(dx) >= Math.abs(dy)
        ? [dx > 0 ? "E" : "W", dy > 0 ? "S" : "N"]
        : [dy > 0 ? "S" : "N", dx > 0 ? "E" : "W"];

      for (const dir of axisFirst) {
        if (dir === "E" || dir === "W" || dir === "N" || dir === "S") {
          const proposed = { type: "move", dir } as const;
          const preview = applyIntent(world, { ...mob, pos: { ...mob.pos } }, proposed);
          if (preview.code === "moved") {
            return proposed;
          }
        }
      }
    }

    const roll = this.rng();
    if (roll < 0.2) return { type: "wait" };
    if (roll < 0.4) return { type: "move", dir: "N" };
    if (roll < 0.6) return { type: "move", dir: "S" };
    if (roll < 0.8) return { type: "move", dir: "E" };
    return { type: "move", dir: "W" };
  }

  private publishActionEvent(world: WorldState, actor: Player | Mob, emote: string | undefined, result: ActionResult, tick: number): void {
    for (const player of Object.values(world.players)) {
      if (!player.alive) continue;

      if (player.id === actor.id) {
        if (emote?.trim()) {
          this.storage.pushPlayerEvent(player.id, tick, `You emote: "${emote.trim()}"`);
        }
        continue;
      }

      const sees = canSee(world, player.pos, result.origin);
      const hears = canHear(world, player.pos, result.origin);

      if (emote?.trim()) {
        if (sees) {
          this.storage.pushPlayerEvent(player.id, tick, `${actor.id} says: "${emote.trim()}"`);
        } else if (hears) {
          this.storage.pushPlayerEvent(player.id, tick, `You hear ${actor.id} nearby.`);
        }
      }

      if (sees && result.detail) {
        this.storage.pushPlayerEvent(player.id, tick, result.detail);
      } else if (!sees && hears && result.vague) {
        this.storage.pushPlayerEvent(player.id, tick, result.vague);
      }
    }
  }

  private buildSnapshot(playerId: string): Snapshot {
    const world = this.storage.getWorld();
    const player = world.players[playerId];
    if (!player) {
      throw new Error("PLAYER_NOT_FOUND");
    }

    const rendered = renderForPlayer(world, playerId);
    const events = this.storage.consumePlayerEvents(playerId, world.committedTick);

    const snapshot: Snapshot = {
      committed_tick: world.committedTick,
      player_id: playerId,
      you: {
        pos: { ...player.pos },
        hp: player.hp,
        max_hp: player.maxHp,
        alive: player.alive,
        last_action_result: player.lastActionResult,
      },
      view: rendered.view,
      visible: rendered.visible,
      events,
    };

    this.storage.setLastSnapshot(playerId, snapshot);
    return snapshot;
  }

  private flushWaiters(): void {
    const world = this.storage.getWorld();
    const stillWaiting: Waiter[] = [];

    for (const waiter of this.waiters) {
      if (world.committedTick > waiter.afterTick) {
        clearTimeout(waiter.timeout);
        waiter.resolve({ snapshot: this.buildSnapshot(waiter.playerId) });
      } else {
        stillWaiting.push(waiter);
      }
    }

    this.waiters = stillWaiting;
  }
}

export function defaultShardConfig(): ShardConfig {
  return {
    tickMs: Number(process.env.TICK_MS ?? 2000),
    width: Number(process.env.MAP_WIDTH ?? 30),
    height: Number(process.env.MAP_HEIGHT ?? 16),
    mapSeed: Number(process.env.MAP_SEED ?? 1337),
    visionRadius: Number(process.env.VISION_RADIUS ?? 5),
    hearingRadius: Number(process.env.HEARING_RADIUS ?? 7),
    initialMobCount: Number(process.env.INITIAL_MOBS ?? 4),
    initialItemCount: Number(process.env.INITIAL_ITEMS ?? 6),
  };
}
