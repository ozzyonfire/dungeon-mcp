import { describe, expect, test } from "bun:test";
import { applyIntent, isIntent } from "../src/sim/actions";
import type { WorldState } from "../src/sim/world";

function testWorld(): WorldState {
  return {
    seed: 1,
    width: 5,
    height: 5,
    visionRadius: 3,
    hearingRadius: 5,
    committedTick: 0,
    tiles: [
      ["wall", "wall", "wall", "wall", "wall"],
      ["wall", "floor", "floor", "floor", "wall"],
      ["wall", "floor", "floor", "floor", "wall"],
      ["wall", "floor", "floor", "floor", "wall"],
      ["wall", "wall", "wall", "wall", "wall"],
    ],
    players: {
      p1: {
        id: "p1",
        name: "p1",
        pos: { x: 2, y: 2 },
        hp: 12,
        maxHp: 12,
        speed: 10,
        alive: true,
        lastActionResult: "",
        inventory: [],
      },
    },
    mobs: {
      m1: {
        id: "m1",
        kind: "goblin",
        pos: { x: 3, y: 2 },
        hp: 8,
        maxHp: 8,
        speed: 7,
        alive: true,
        lastActionResult: "",
      },
    },
    items: {
      i1: {
        id: "i1",
        kind: "coin",
        pos: { x: 2, y: 2 },
      },
    },
  };
}

describe("intent validation", () => {
  test("accepts valid intents", () => {
    expect(isIntent({ type: "wait" })).toBeTrue();
    expect(isIntent({ type: "move", dir: "N" })).toBeTrue();
    expect(isIntent({ type: "attack", target_id: "m1" })).toBeTrue();
    expect(isIntent({ type: "pickup" })).toBeTrue();
  });

  test("rejects invalid intent", () => {
    expect(isIntent({ type: "move", dir: "NE" })).toBeFalse();
  });
});

describe("action resolution", () => {
  test("moves when walkable", () => {
    const world = testWorld();
    const player = world.players.p1!;
    const result = applyIntent(world, player, { type: "move", dir: "N" });
    expect(result.code).toBe("moved");
    expect(world.players.p1!.pos).toEqual({ x: 2, y: 1 });
  });

  test("attacks adjacent target", () => {
    const world = testWorld();
    const player = world.players.p1!;
    const result = applyIntent(world, player, { type: "attack", target_id: "m1" });
    expect(["attacked", "killed"]).toContain(result.code);
    expect(world.mobs.m1!.hp).toBeLessThan(8);
  });

  test("picks up item on tile", () => {
    const world = testWorld();
    const player = world.players.p1!;
    const result = applyIntent(world, player, { type: "pickup" });
    expect(result.code).toBe("picked_up");
    expect(world.players.p1!.inventory).toContain("i1");
    expect(world.items.i1).toBeUndefined();
  });
});
