import { describe, expect, test } from "bun:test";
import { generateDungeon } from "../src/sim/gen/dungeon";
import type { Pos, TileType } from "../src/sim/world";

function key(pos: Pos): string {
  return `${pos.x},${pos.y}`;
}

function neighbors(pos: Pos): Pos[] {
  return [
    { x: pos.x + 1, y: pos.y },
    { x: pos.x - 1, y: pos.y },
    { x: pos.x, y: pos.y + 1 },
    { x: pos.x, y: pos.y - 1 },
  ];
}

function countConnectedFloor(tiles: TileType[][], start: Pos): number {
  const visited = new Set<string>();
  const queue: Pos[] = [start];
  visited.add(key(start));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    for (const next of neighbors(current)) {
      if (next.y < 0 || next.x < 0 || next.y >= tiles.length || next.x >= (tiles[0]?.length ?? 0)) {
        continue;
      }
      if (tiles[next.y]?.[next.x] !== "floor") continue;
      const k = key(next);
      if (visited.has(k)) continue;
      visited.add(k);
      queue.push(next);
    }
  }

  return visited.size;
}

describe("dungeon generation", () => {
  test("is deterministic for seed and size", () => {
    const a = generateDungeon(1337, 60, 36);
    const b = generateDungeon(1337, 60, 36);
    expect(a.tiles).toEqual(b.tiles);
    expect(a.walkable).toEqual(b.walkable);
  });

  test("keeps boundary walls", () => {
    const dungeon = generateDungeon(42, 60, 36);
    const lastY = dungeon.tiles.length - 1;
    const lastX = (dungeon.tiles[0]?.length ?? 0) - 1;

    for (let x = 0; x <= lastX; x += 1) {
      expect(dungeon.tiles[0]?.[x]).toBe("wall");
      expect(dungeon.tiles[lastY]?.[x]).toBe("wall");
    }

    for (let y = 0; y <= lastY; y += 1) {
      expect(dungeon.tiles[y]?.[0]).toBe("wall");
      expect(dungeon.tiles[y]?.[lastX]).toBe("wall");
    }
  });

  test("produces a single connected floor region", () => {
    const dungeon = generateDungeon(99, 60, 36);
    expect(dungeon.walkable.length).toBeGreaterThan(0);
    const start = dungeon.walkable[0];
    expect(start).toBeDefined();
    if (!start) return;

    const connected = countConnectedFloor(dungeon.tiles, start);
    expect(connected).toBe(dungeon.walkable.length);
  });
});
