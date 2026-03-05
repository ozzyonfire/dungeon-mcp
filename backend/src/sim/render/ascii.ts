import { LEGEND, type ObserverSnapshot, type Pos, type Snapshot, type WorldState } from "../world";

export type RenderOutput = Pick<Snapshot, "view" | "visible">;

function posKey(pos: Pos): string {
  return `${pos.x},${pos.y}`;
}

export function renderForPlayer(world: WorldState, playerId: string): RenderOutput {
  const player = world.players[playerId];
  if (!player) {
    return {
      view: {
        ascii: [],
        legend: LEGEND,
        radius: world.visionRadius,
      },
      visible: {
        players: [],
        mobs: [],
        items: [],
      },
    };
  }

  const radius = world.visionRadius;
  const goalVisible = world.committedTick >= world.goal.revealAtTick;
  const goalKey = `${world.goal.pos.x},${world.goal.pos.y}`;
  const inSquareVision = (pos: Pos): boolean =>
    Math.max(Math.abs(pos.x - player.pos.x), Math.abs(pos.y - player.pos.y)) <= radius;

  const visiblePlayers = Object.values(world.players)
    .filter((p) => p.id !== playerId)
    .filter((p) => p.alive && inSquareVision(p.pos))
    .map((p) => ({ id: p.id, kind: "player", pos: { ...p.pos }, hp: p.hp }));

  const visibleMobs = Object.values(world.mobs)
    .filter((m) => m.alive && inSquareVision(m.pos))
    .map((m) => ({ id: m.id, kind: m.kind, pos: { ...m.pos }, hp: m.hp }));

  const visibleItems = Object.values(world.items)
    .filter((i) => inSquareVision(i.pos))
    .map((i) => ({ id: i.id, kind: i.kind, pos: { ...i.pos } }));

  const mobsByPos = new Set(visibleMobs.map((m) => posKey(m.pos)));
  const playersByPos = new Set(visiblePlayers.map((p) => posKey(p.pos)));
  const itemsByPos = new Set(visibleItems.map((i) => posKey(i.pos)));

  const ascii: string[] = [];
  for (let y = player.pos.y - radius; y <= player.pos.y + radius; y += 1) {
    let row = "";
    for (let x = player.pos.x - radius; x <= player.pos.x + radius; x += 1) {
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) {
        row += "?";
        continue;
      }

      const key = `${x},${y}`;
      if (player.pos.x === x && player.pos.y === y) {
        row += "@";
        continue;
      }

      if (mobsByPos.has(key)) {
        row += "m";
        continue;
      }

      if (playersByPos.has(key)) {
        row += "p";
        continue;
      }

      if (itemsByPos.has(key)) {
        row += "i";
        continue;
      }

      if (goalVisible && key === goalKey) {
        row += "G";
        continue;
      }

      row += world.tiles[y]?.[x] === "wall" ? "#" : ".";
    }
    ascii.push(row);
  }

  return {
    view: {
      ascii,
      legend: LEGEND,
      radius,
    },
    visible: {
      players: visiblePlayers,
      mobs: visibleMobs,
      items: visibleItems,
    },
  };
}

export function renderForObserver(world: WorldState): ObserverSnapshot["map"] {
  const goalVisible = world.committedTick >= world.goal.revealAtTick;
  const goalKey = `${world.goal.pos.x},${world.goal.pos.y}`;
  const playersByPos = new Map<string, number>();
  for (const player of Object.values(world.players)) {
    if (!player.alive) continue;
    playersByPos.set(posKey(player.pos), (playersByPos.get(posKey(player.pos)) ?? 0) + 1);
  }

  const mobsByPos = new Map<string, number>();
  for (const mob of Object.values(world.mobs)) {
    if (!mob.alive) continue;
    mobsByPos.set(posKey(mob.pos), (mobsByPos.get(posKey(mob.pos)) ?? 0) + 1);
  }

  const itemsByPos = new Map<string, number>();
  for (const item of Object.values(world.items)) {
    itemsByPos.set(posKey(item.pos), (itemsByPos.get(posKey(item.pos)) ?? 0) + 1);
  }

  const ascii: string[] = [];
  for (let y = 0; y < world.height; y += 1) {
    let row = "";
    for (let x = 0; x < world.width; x += 1) {
      const key = `${x},${y}`;
      const hasPlayers = (playersByPos.get(key) ?? 0) > 0;
      const hasMobs = (mobsByPos.get(key) ?? 0) > 0;
      const hasItems = (itemsByPos.get(key) ?? 0) > 0;

      if (hasPlayers) {
        row += "p";
      } else if (hasMobs) {
        row += "m";
      } else if (hasItems) {
        row += "i";
      } else if (goalVisible && key === goalKey) {
        row += "G";
      } else {
        row += world.tiles[y]?.[x] === "wall" ? "#" : ".";
      }
    }
    ascii.push(row);
  }

  return {
    ascii,
    legend: {
      "#": "Wall",
      ".": "Floor",
      G: "Goal (Escape)",
      p: "Player",
      m: "Mob",
      i: "Item",
    },
    width: world.width,
    height: world.height,
  };
}
