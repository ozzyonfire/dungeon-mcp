import {
  canSee,
  isWalkable,
  manhattan,
  nextPos,
  type ActorBase,
  type Intent,
  type Mob,
  type Player,
  type Pos,
  type WorldState,
} from "./world";

export type ActionResult = {
  code:
    | "moved"
    | "blocked_wall"
    | "blocked_oob"
    | "waited"
    | "invalid_target"
    | "out_of_range"
    | "attacked"
    | "killed"
    | "picked_up"
    | "no_item"
    | "dead";
  message: string;
  origin: Pos;
  detail?: string;
  vague?: string;
};

export function isIntent(value: unknown): value is Intent {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.type === "wait") return true;
  if (record.type === "move") {
    return (
      record.dir === "N" ||
      record.dir === "S" ||
      record.dir === "E" ||
      record.dir === "W"
    );
  }
  if (record.type === "attack") {
    return typeof record.target_id === "string" && record.target_id.length > 0;
  }
  if (record.type === "pickup") {
    return record.item_id === undefined || typeof record.item_id === "string";
  }
  return false;
}

function applyMove(world: WorldState, actor: ActorBase, intent: Extract<Intent, { type: "move" }>): ActionResult {
  const destination = nextPos(actor.pos, intent.dir);
  if (destination.x < 0 || destination.x >= world.width || destination.y < 0 || destination.y >= world.height) {
    return {
      code: "blocked_oob",
      message: "Blocked: out of bounds.",
      origin: { ...actor.pos },
    };
  }

  if (!isWalkable(world, destination)) {
    return {
      code: "blocked_wall",
      message: "Blocked: wall.",
      origin: { ...actor.pos },
    };
  }

  actor.pos = destination;
  return {
    code: "moved",
    message: `Moved ${intent.dir}.`,
    origin: { ...destination },
    detail: "You move.",
    vague: "You hear footsteps.",
  };
}

function resolveTarget(world: WorldState, targetId: string): Player | Mob | undefined {
  const player = world.players[targetId];
  if (player) return player;
  const mob = world.mobs[targetId];
  if (mob) return mob;
  return undefined;
}

function applyAttack(world: WorldState, actor: Player | Mob, intent: Extract<Intent, { type: "attack" }>): ActionResult {
  const target = resolveTarget(world, intent.target_id);
  if (!target || !target.alive) {
    return {
      code: "invalid_target",
      message: "Attack failed: invalid target.",
      origin: { ...actor.pos },
    };
  }

  if (target.id === actor.id) {
    return {
      code: "invalid_target",
      message: "Attack failed: cannot attack yourself.",
      origin: { ...actor.pos },
    };
  }

  const distance = manhattan(actor.pos, target.pos);
  if (distance > 1 || !canSee(world, actor.pos, target.pos)) {
    return {
      code: "out_of_range",
      message: "Attack failed: out of range.",
      origin: { ...actor.pos },
    };
  }

  const damage = 3;
  target.hp = Math.max(0, target.hp - damage);
  if (target.hp === 0) {
    target.alive = false;
    return {
      code: "killed",
      message: `You defeated ${target.id}.`,
      origin: { ...target.pos },
      detail: `${actor.id} defeats ${target.id}.`,
      vague: "You hear a final blow nearby.",
    };
  }

  return {
    code: "attacked",
    message: `You hit ${target.id} for ${damage}.`,
    origin: { ...target.pos },
    detail: `${actor.id} strikes ${target.id}.`,
    vague: "You hear fighting nearby.",
  };
}

function applyPickup(world: WorldState, actor: Player, intent: Extract<Intent, { type: "pickup" }>): ActionResult {
  const candidates = Object.values(world.items).filter((item) => item.pos.x === actor.pos.x && item.pos.y === actor.pos.y);

  let item = candidates[0];
  if (intent.item_id) {
    item = world.items[intent.item_id];
    if (item && (item.pos.x !== actor.pos.x || item.pos.y !== actor.pos.y)) {
      item = undefined;
    }
  }

  if (!item) {
    return {
      code: "no_item",
      message: "Pickup failed: no item here.",
      origin: { ...actor.pos },
    };
  }

  actor.inventory.push(item.id);
  delete world.items[item.id];

  return {
    code: "picked_up",
    message: `Picked up ${item.kind}.`,
    origin: { ...actor.pos },
    detail: `${actor.id} picks up ${item.kind}.`,
    vague: "You hear someone rummaging nearby.",
  };
}

export function applyIntent(world: WorldState, actor: Player | Mob, intent: Intent): ActionResult {
  if (!actor.alive) {
    return {
      code: "dead",
      message: "You cannot act while downed.",
      origin: { ...actor.pos },
    };
  }

  if (intent.type === "wait") {
    return {
      code: "waited",
      message: "You wait.",
      origin: { ...actor.pos },
    };
  }

  if (intent.type === "move") {
    return applyMove(world, actor, intent);
  }

  if (intent.type === "attack") {
    return applyAttack(world, actor, intent);
  }

  if (intent.type === "pickup") {
    if (!("inventory" in actor)) {
      return {
        code: "no_item",
        message: "Pickup failed.",
        origin: { ...actor.pos },
      };
    }
    return applyPickup(world, actor, intent);
  }

  return {
    code: "waited",
    message: "You wait.",
    origin: { ...actor.pos },
  };
}
