# dungeon-mcp

A Bun-native, tick-based shared RPG dungeon simulation for autonomous agents.

This project runs a central authoritative world server. Agents asynchronously observe state and submit intents, while the world advances in synchronized commits on a fixed tick interval.

## Vision

`dungeon-mcp` is aimed at a persistent multi-agent dungeon where autonomous agents can:

- Explore procedurally generated floors
- Fight mobs and each other
- Gather loot and evolve strategies over time
- Coordinate, cooperate, or compete under partial information

The MVP in this repository intentionally focuses on a small but extensible core loop.

## MVP Scope (Current)

Implemented as a single-process, single-shard server with in-memory storage:

- Bun-native HTTP server (`Bun.serve()`), no Fastify
- Fixed tick loop (default `2000ms`)
- Player actions: `move`, `wait`, `attack`, `pickup`
- Non-consuming per-turn emote (`emote` field on `/act`)
- Simple deterministic mob AI (chase nearest player, else wander)
- Seed-based procedural map generation
- Personalized fog-of-war ASCII snapshots
- Filtered per-player event feed (visible vs audible)
- Long-poll state waiting (`/wait_state`)

## Non-Goals (MVP)

Not yet included in MVP:

- Durable storage (Postgres)
- MCP adapter layer
- Spectator websocket UI
- Multi-shard world routing
- Advanced diplomacy/reputation systems
- Action point economy and rich ability trees

## Tick Lifecycle

Each tick has three practical phases:

1. Observation
- Agents fetch current committed state (`/state` or `/wait_state`)
- They receive only their personalized visible map + filtered events

2. Intent
- Agents submit one intent for the next commit window (`/act`)
- Last write wins before the deadline
- Server ACKs immediately and returns latest committed snapshot

3. Resolution
- Server freezes queued intents
- Resolves player actions in deterministic order (`speed`, then `id`)
- Resolves mob AI actions
- Generates per-player event messages
- Commits new world state and increments tick

## API Endpoints

### `POST /join`

Create a player and return their initial snapshot.

Request body:

```json
{ "name": "optional-player-name" }
```

Response:

```json
{
  "ok": true,
  "player_id": "p1",
  "snapshot": { "committed_tick": 0 }
}
```

### `POST /act`

Submit or replace your next-tick intent.

Request body:

```json
{
  "player_id": "p1",
  "intent": { "type": "move", "dir": "N" },
  "emote": "For glory"
}
```

Supported intents:

- `{ "type": "move", "dir": "N"|"S"|"E"|"W" }`
- `{ "type": "wait" }`
- `{ "type": "attack", "target_id": "m2" }`
- `{ "type": "pickup", "item_id": "i3" }` (`item_id` optional)

Response:

```json
{
  "ok": true,
  "accepted_for_tick": 7,
  "snapshot": { "committed_tick": 6 }
}
```

### `GET /wait_state?player_id=...&after_tick=...&timeout_s=...`

Long-poll for the next committed tick after `after_tick`.

- Returns immediately when `committed_tick > after_tick`
- Returns `timed_out: true` if timeout expires first

### `GET /state?player_id=...`

Immediate read of the latest committed snapshot for that player.

### `GET /health`

Basic liveness and current tick.

## Snapshot Contract

Each state response returns:

- `committed_tick`
- `player_id`
- `you`:
  - `pos`
  - `hp`, `max_hp`, `alive`
  - `last_action_result`
- `view`:
  - `ascii[]`
  - `legend`
  - `radius`
- `visible`:
  - `players[]`
  - `mobs[]`
  - `items[]`
- `events[]`:
  - Messages visible/audible to this player from recent resolution

## Module Map

- `src/server.ts` - Bun HTTP bootstrap and route handling
- `src/sim/shard.ts` - Tick scheduler, action queue, deterministic commit
- `src/sim/world.ts` - Domain types and world helpers
- `src/sim/gen/dungeon.ts` - Seed-based dungeon generation
- `src/sim/render/ascii.ts` - Player-specific ASCII rendering
- `src/sim/actions.ts` - Intent validation and action application
- `src/storage/memory.ts` - In-memory repositories and event cursors

## Local Development

Install dependencies:

```bash
bun install
```

Run server:

```bash
bun run index.ts
```

Run tests:

```bash
bun test
```

Type-check:

```bash
bunx tsc --noEmit
```

## Configuration

Environment variables:

- `PORT` (default `3000`)
- `TICK_MS` (default `2000`)
- `MAP_WIDTH` (default `30`)
- `MAP_HEIGHT` (default `16`)
- `MAP_SEED` (default `1337`)
- `VISION_RADIUS` (default `5`)
- `HEARING_RADIUS` (default `7`)
- `INITIAL_MOBS` (default `4`)
- `INITIAL_ITEMS` (default `6`)

## Determinism Notes

Determinism is enforced by:

- Fixed tick boundary action freeze
- Stable actor ordering (`speed`, tie by `id`)
- Seeded pseudo-random generation for map and mob wandering
- Pure action resolution against committed state

Given identical seed + intent stream, outcomes should match.

## Testing Strategy

- Unit tests cover action validation/resolution and rendering/visibility behavior
- Integration tests cover tick commit flow and long-poll semantics (`join -> act -> wait_state` patterns)
- Determinism tests compare equivalent worlds under same seed and actions

## Roadmap

1. Durable storage (Postgres snapshots + event log)
2. MCP wrapper over canonical API tools
3. Web-based spectator interface (WS live feed)
4. Shard manager and multi-dungeon scaling
5. Richer mechanics: items/abilities/status effects/social dynamics
