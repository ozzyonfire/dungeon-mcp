import type { Pos, TileType } from "../world";

export type DungeonGenResult = {
  tiles: TileType[][];
  walkable: Pos[];
};

type Room = {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
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
  const tiles: TileType[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => "wall"),
  );

  const rooms: Room[] = [];
  const minRoomSize = 4;
  const maxRoomSize = 10;
  const maxPlacementAttempts = 200;

  function randomInt(min: number, max: number): number {
    return Math.floor(rng() * (max - min + 1)) + min;
  }

  function roomOverlaps(candidate: Room, existing: Room): boolean {
    const pad = 1;
    const cLeft = candidate.x - pad;
    const cRight = candidate.x + candidate.w - 1 + pad;
    const cTop = candidate.y - pad;
    const cBottom = candidate.y + candidate.h - 1 + pad;

    const eLeft = existing.x;
    const eRight = existing.x + existing.w - 1;
    const eTop = existing.y;
    const eBottom = existing.y + existing.h - 1;

    return !(cRight < eLeft || cLeft > eRight || cBottom < eTop || cTop > eBottom);
  }

  function carveAt(x: number, y: number): void {
    if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) {
      return;
    }
    const row = tiles[y];
    if (row) {
      row[x] = "floor";
    }
  }

  function carveRoom(room: Room): void {
    for (let y = room.y; y < room.y + room.h; y += 1) {
      for (let x = room.x; x < room.x + room.w; x += 1) {
        carveAt(x, y);
      }
    }
  }

  function carveCorridor(from: Room, to: Room): void {
    const horizontalFirst = rng() < 0.5;
    if (horizontalFirst) {
      const stepX = from.cx <= to.cx ? 1 : -1;
      for (let x = from.cx; x !== to.cx + stepX; x += stepX) {
        carveAt(x, from.cy);
      }
      const stepY = from.cy <= to.cy ? 1 : -1;
      for (let y = from.cy; y !== to.cy + stepY; y += stepY) {
        carveAt(to.cx, y);
      }
      return;
    }

    const stepY = from.cy <= to.cy ? 1 : -1;
    for (let y = from.cy; y !== to.cy + stepY; y += stepY) {
      carveAt(from.cx, y);
    }
    const stepX = from.cx <= to.cx ? 1 : -1;
    for (let x = from.cx; x !== to.cx + stepX; x += stepX) {
      carveAt(x, to.cy);
    }
  }

  for (let i = 0; i < maxPlacementAttempts; i += 1) {
    const w = randomInt(minRoomSize, Math.min(maxRoomSize, Math.max(minRoomSize, width - 2)));
    const h = randomInt(minRoomSize, Math.min(maxRoomSize, Math.max(minRoomSize, height - 2)));
    if (width - w - 1 <= 1 || height - h - 1 <= 1) {
      continue;
    }

    const x = randomInt(1, width - w - 1);
    const y = randomInt(1, height - h - 1);

    const room: Room = {
      x,
      y,
      w,
      h,
      cx: x + Math.floor(w / 2),
      cy: y + Math.floor(h / 2),
    };

    if (rooms.some((other) => roomOverlaps(room, other))) {
      continue;
    }

    rooms.push(room);
  }

  if (rooms.length === 0) {
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);
    for (let y = Math.max(1, cy - 1); y <= Math.min(height - 2, cy + 1); y += 1) {
      for (let x = Math.max(1, cx - 1); x <= Math.min(width - 2, cx + 1); x += 1) {
        carveAt(x, y);
      }
    }
  } else {
    for (const room of rooms) {
      carveRoom(room);
    }

    const sorted = [...rooms].sort((a, b) => a.cx - b.cx || a.cy - b.cy);
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const from = sorted[i];
      const to = sorted[i + 1];
      if (from && to) {
        carveCorridor(from, to);
      }
    }

    for (let i = 0; i < sorted.length - 1; i += 1) {
      if (rng() >= 0.15) continue;
      const from = sorted[i];
      const j = randomInt(i + 1, sorted.length - 1);
      const to = sorted[j];
      if (from && to) {
        carveCorridor(from, to);
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
