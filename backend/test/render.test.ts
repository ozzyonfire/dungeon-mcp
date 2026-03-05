import { describe, expect, test } from "bun:test";
import { renderForPlayer } from "../src/sim/render/ascii";
import type { WorldState } from "../src/sim/world";

function world(playerPos = { x: 3, y: 3 }): WorldState {
  return {
    seed: 1,
    width: 7,
    height: 7,
    visionRadius: 2,
    hearingRadius: 4,
    committedTick: 0,
    goal: {
      pos: { x: 5, y: 5 },
      revealAtTick: 50,
    },
    tiles: Array.from({ length: 7 }, (_, y) =>
      Array.from({ length: 7 }, (_, x) => (x === 0 || y === 0 || x === 6 || y === 6 ? "wall" : "floor")),
    ),
    players: {
      p1: {
        id: "p1",
        name: "p1",
        pos: playerPos,
        hp: 10,
        maxHp: 10,
        speed: 10,
        alive: true,
        escaped: false,
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
        escaped: false,
        lastActionResult: "",
        inventory: [],
      },
    },
    mobs: {},
    items: {},
  };
}

describe("ascii render", () => {
  test("returns centered square view with player marker", () => {
    const output = renderForPlayer(world(), "p1");
    expect(output.view.ascii.length).toBe(5);
    expect(output.view.ascii[0]?.length).toBe(5);
    expect(output.view.ascii[2]?.[2]).toBe("@");
  });

  test("shows out-of-bounds as unknown near map edges", () => {
    const output = renderForPlayer(world({ x: 1, y: 1 }), "p1");
    expect(output.view.ascii[0]?.[0]).toBe("?");
    expect(output.view.ascii[2]?.[2]).toBe("@");
  });

  test("uses square visibility for visible entities", () => {
    const state = world();
    const output = renderForPlayer(state, "p1");

    // p2 at (1,1) is outside Manhattan radius 2 but inside square radius 2 from (3,3).
    expect(output.visible.players.some((p) => p.id === "p2")).toBeTrue();
  });

  test("hides goal before reveal tick and shows after", () => {
    const hidden = world();
    hidden.players.p1!.pos = { x: 4, y: 4 };
    hidden.committedTick = 49;
    const before = renderForPlayer(hidden, "p1");
    expect(before.view.ascii.join("")).not.toContain("G");

    const shown = world();
    shown.players.p1!.pos = { x: 4, y: 4 };
    shown.committedTick = 50;
    const after = renderForPlayer(shown, "p1");
    expect(after.view.ascii.join("")).toContain("G");
  });
});
