import { describe, expect, test } from "bun:test";
import { renderForPlayer } from "../src/sim/render/ascii";
import type { WorldState } from "../src/sim/world";

function world(): WorldState {
  return {
    seed: 1,
    width: 7,
    height: 7,
    visionRadius: 2,
    hearingRadius: 4,
    committedTick: 0,
    tiles: Array.from({ length: 7 }, (_, y) =>
      Array.from({ length: 7 }, (_, x) => (x === 0 || y === 0 || x === 6 || y === 6 ? "wall" : "floor")),
    ),
    players: {
      p1: {
        id: "p1",
        name: "p1",
        pos: { x: 3, y: 3 },
        hp: 10,
        maxHp: 10,
        speed: 10,
        alive: true,
        lastActionResult: "",
        inventory: [],
      },
      p2: {
        id: "p2",
        name: "p2",
        pos: { x: 1, y: 1 },
        hp: 10,
        maxHp: 10,
        speed: 10,
        alive: true,
        lastActionResult: "",
        inventory: [],
      },
    },
    mobs: {},
    items: {},
  };
}

describe("ascii render", () => {
  test("applies fog of war and shows player marker", () => {
    const output = renderForPlayer(world(), "p1");
    expect(output.view.ascii.length).toBe(7);
    expect(output.view.ascii[3]?.[3]).toBe("@");
    expect(output.view.ascii[0]?.[0]).toBe("?");
  });
});
