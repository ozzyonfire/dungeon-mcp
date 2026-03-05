export type Direction = "N" | "S" | "E" | "W";

export type MoveIntent = { type: "move"; dir: Direction };
export type WaitIntent = { type: "wait" };
export type AttackIntent = { type: "attack"; target_id: string };
export type PickupIntent = { type: "pickup"; item_id?: string };

export type Intent = MoveIntent | WaitIntent | AttackIntent | PickupIntent;

export type ActionEnvelope = {
  player_id: string;
  intent: Intent;
  emote?: string;
};

export type Pos = { x: number; y: number };

export type TileType = "wall" | "floor";

export type EntityBase = {
  id: string;
  pos: Pos;
};

export type ActorBase = EntityBase & {
  hp: number;
  maxHp: number;
  speed: number;
  alive: boolean;
  lastActionResult: string;
};

export type Player = ActorBase & {
  name: string;
  inventory: string[];
  escaped: boolean;
};

export type Mob = ActorBase & {
  kind: string;
};

export type Item = EntityBase & {
  kind: string;
};

export type WorldState = {
  seed: number;
  width: number;
  height: number;
  visionRadius: number;
  hearingRadius: number;
  committedTick: number;
  goal: {
    pos: Pos;
    revealAtTick: number;
  };
  tiles: TileType[][];
  players: Record<string, Player>;
  mobs: Record<string, Mob>;
  items: Record<string, Item>;
};

export type VisibleEntity = {
  id: string;
  kind: string;
  pos: Pos;
  hp?: number;
};

export type Snapshot = {
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

export type ObserverSnapshot = {
  committed_tick: number;
  map: {
    ascii: string[];
    legend: Record<string, string>;
    width: number;
    height: number;
  };
  players: Array<{
    id: string;
    name: string;
    pos: Pos;
    hp: number;
    max_hp: number;
    alive: boolean;
  }>;
  mobs: Array<{
    id: string;
    kind: string;
    pos: Pos;
    hp: number;
    max_hp: number;
    alive: boolean;
  }>;
  items: Array<{
    id: string;
    kind: string;
    pos: Pos;
  }>;
};

export const LEGEND: Record<string, string> = {
  "#": "Wall",
  ".": "Floor",
  G: "Goal (Escape)",
  "@": "You",
  p: "Player",
  m: "Mob",
  i: "Item",
  "?": "Unknown",
};

export function clonePos(pos: Pos): Pos {
  return { x: pos.x, y: pos.y };
}

export function manhattan(a: Pos, b: Pos): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function isInBounds(world: WorldState, pos: Pos): boolean {
  return pos.x >= 0 && pos.x < world.width && pos.y >= 0 && pos.y < world.height;
}

export function isWalkable(world: WorldState, pos: Pos): boolean {
  return isInBounds(world, pos) && world.tiles[pos.y]?.[pos.x] === "floor";
}

export function nextPos(pos: Pos, dir: Direction): Pos {
  if (dir === "N") return { x: pos.x, y: pos.y - 1 };
  if (dir === "S") return { x: pos.x, y: pos.y + 1 };
  if (dir === "E") return { x: pos.x + 1, y: pos.y };
  return { x: pos.x - 1, y: pos.y };
}

export function canSee(world: WorldState, observerPos: Pos, targetPos: Pos): boolean {
  return manhattan(observerPos, targetPos) <= world.visionRadius;
}

export function canHear(world: WorldState, observerPos: Pos, targetPos: Pos): boolean {
  return manhattan(observerPos, targetPos) <= world.hearingRadius;
}

export function playerOrderForTick(world: WorldState): Player[] {
  return Object.values(world.players)
    .filter((p) => p.alive)
    .sort((a, b) => b.speed - a.speed || a.id.localeCompare(b.id));
}

export function mobOrderForTick(world: WorldState): Mob[] {
  return Object.values(world.mobs)
    .filter((m) => m.alive)
    .sort((a, b) => b.speed - a.speed || a.id.localeCompare(b.id));
}
