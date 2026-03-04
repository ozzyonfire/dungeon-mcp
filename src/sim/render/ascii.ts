import { canSee, LEGEND, type Pos, type Snapshot, type WorldState } from "../world";

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

  const visibleTiles = new Set<string>();
  for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) {
      if (canSee(world, player.pos, { x, y })) {
        visibleTiles.add(`${x},${y}`);
      }
    }
  }

  const visiblePlayers = Object.values(world.players)
    .filter((p) => p.id !== playerId)
    .filter((p) => p.alive && visibleTiles.has(posKey(p.pos)))
    .map((p) => ({ id: p.id, kind: "player", pos: { ...p.pos }, hp: p.hp }));

  const visibleMobs = Object.values(world.mobs)
    .filter((m) => m.alive && visibleTiles.has(posKey(m.pos)))
    .map((m) => ({ id: m.id, kind: m.kind, pos: { ...m.pos }, hp: m.hp }));

  const visibleItems = Object.values(world.items)
    .filter((i) => visibleTiles.has(posKey(i.pos)))
    .map((i) => ({ id: i.id, kind: i.kind, pos: { ...i.pos } }));

  const ascii: string[] = [];
  for (let y = 0; y < world.height; y += 1) {
    let row = "";
    for (let x = 0; x < world.width; x += 1) {
      const key = `${x},${y}`;
      if (!visibleTiles.has(key)) {
        row += "?";
        continue;
      }

      if (player.pos.x === x && player.pos.y === y) {
        row += "@";
        continue;
      }

      const mob = visibleMobs.find((m) => m.pos.x === x && m.pos.y === y);
      if (mob) {
        row += "m";
        continue;
      }

      const otherPlayer = visiblePlayers.find((p) => p.pos.x === x && p.pos.y === y);
      if (otherPlayer) {
        row += "p";
        continue;
      }

      const item = visibleItems.find((i) => i.pos.x === x && i.pos.y === y);
      if (item) {
        row += "i";
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
      radius: world.visionRadius,
    },
    visible: {
      players: visiblePlayers,
      mobs: visibleMobs,
      items: visibleItems,
    },
  };
}
