import { describe, expect, test } from "bun:test";
import { GameShard, type ShardConfig } from "../src/sim/shard";

function config(): ShardConfig {
  return {
    tickMs: 30,
    width: 20,
    height: 12,
    mapSeed: 42,
    visionRadius: 5,
    hearingRadius: 7,
    initialMobCount: 2,
    initialItemCount: 2,
  };
}

describe("shard integration", () => {
  test("join, act, wait_state roundtrip", async () => {
    const shard = new GameShard(config());
    shard.start();

    const joined = shard.joinPlayer("alice");
    expect(joined.snapshot.player_id).toBe(joined.player_id);

    const afterTick = joined.snapshot.committed_tick;
    const act = shard.submitAction({
      player_id: joined.player_id,
      intent: { type: "wait" },
      emote: "hello",
    });

    expect(act.acceptedForTick).toBe(afterTick + 1);

    const waited = await shard.waitForState(joined.player_id, afterTick, 2);
    expect(waited.snapshot.committed_tick).toBeGreaterThan(afterTick);

    shard.stop();
  });

  test("deterministic snapshots with same seed and intents", async () => {
    const shardA = new GameShard(config());
    const shardB = new GameShard(config());
    shardA.start();
    shardB.start();

    const a = shardA.joinPlayer("A");
    const b = shardB.joinPlayer("A");

    shardA.submitAction({ player_id: a.player_id, intent: { type: "move", dir: "E" } });
    shardB.submitAction({ player_id: b.player_id, intent: { type: "move", dir: "E" } });

    const nextA = await shardA.waitForState(a.player_id, a.snapshot.committed_tick, 2);
    const nextB = await shardB.waitForState(b.player_id, b.snapshot.committed_tick, 2);

    expect(nextA.snapshot.you.pos).toEqual(nextB.snapshot.you.pos);
    expect(nextA.snapshot.committed_tick).toEqual(nextB.snapshot.committed_tick);

    shardA.stop();
    shardB.stop();
  });

  test("observer snapshot contains map and entities", () => {
    const shard = new GameShard(config());
    const joined = shard.joinPlayer("watch-target");
    const observer = shard.getObserverSnapshot();

    expect(observer.committed_tick).toBeGreaterThanOrEqual(0);
    expect(observer.map.ascii.length).toBe(config().height);
    expect(observer.map.ascii[0]?.length).toBe(config().width);
    expect(observer.players.some((p) => p.id === joined.player_id)).toBeTrue();
    expect(observer.mobs.length).toBe(config().initialMobCount);
    expect(observer.items.length).toBe(config().initialItemCount);
  });

  test("stale client tick is accepted and queued", async () => {
    const shard = new GameShard(config());
    shard.start();
    const joined = shard.joinPlayer("stale-client");

    const act = shard.submitAction({
      player_id: joined.player_id,
      intent: { type: "move", dir: "E" },
      client_tick: -10,
    });

    expect(act.tickStatus).toBe("stale");
    expect(act.acceptedForTick).toBeGreaterThan(joined.snapshot.committed_tick);

    const resolved = await shard.waitForState(joined.player_id, joined.snapshot.committed_tick, 2);
    expect(resolved.snapshot.committed_tick).toBeGreaterThan(joined.snapshot.committed_tick);

    shard.stop();
  });
});
