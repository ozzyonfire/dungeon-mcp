import type { Pos, TileType } from "../world";

export type DungeonGenResult = {
  tiles: TileType[][];
  walkable: Pos[];
};

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateDungeon(seed: number, width: number, height: number): DungeonGenResult {
  const rng = mulberry32(seed);
  const tiles: TileType[][] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        return "wall";
      }
      return "floor";
    }),
  );

  const wallChance = 0.12;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (rng() < wallChance) {
        const row = tiles[y];
        if (row) {
          row[x] = "wall";
        }
      }
    }
  }

  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  for (let y = Math.max(1, cy - 1); y <= Math.min(height - 2, cy + 1); y += 1) {
    for (let x = Math.max(1, cx - 1); x <= Math.min(width - 2, cx + 1); x += 1) {
      const row = tiles[y];
      if (row) {
        row[x] = "floor";
      }
    }
  }

  const walkable: Pos[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (tiles[y]?.[x] === "floor") {
        walkable.push({ x, y });
      }
    }
  }

  return { tiles, walkable };
}

export function pickSpawn(walkable: Pos[], occupied: Set<string>, seedRng: () => number): Pos {
  if (walkable.length === 0) {
    return { x: 1, y: 1 };
  }

  for (let i = 0; i < walkable.length; i += 1) {
    const idx = Math.floor(seedRng() * walkable.length);
    const pos = walkable[idx];
    if (!pos) continue;
    const key = `${pos.x},${pos.y}`;
    if (!occupied.has(key)) {
      occupied.add(key);
      return { x: pos.x, y: pos.y };
    }
  }

  const fallback = walkable[0] ?? { x: 1, y: 1 };
  occupied.add(`${fallback.x},${fallback.y}`);
  return { x: fallback.x, y: fallback.y };
}

export function seededRng(seed: number): () => number {
  return mulberry32(seed);
}
