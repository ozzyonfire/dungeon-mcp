---
description: Project-specific guidance for dungeon-mcp workspace (backend, frontend, mcp).
globs: "**/*"
alwaysApply: false
---

# dungeon-mcp Contributor Guide

This repository is a Bun workspace with three packages:

- `backend/`: game simulation + HTTP/WebSocket server
- `frontend/`: Vite + React observer and human-agent simulator UI
- `mcp/`: stdio MCP server that forwards tool calls to backend HTTP APIs

## Core Principles

- Prefer Bun tooling (`bun install`, `bun run`, `bun test`, `bunx`) over npm/pnpm/yarn.
- Keep the backend API authoritative for game state transitions.
- Frontend and MCP are adapters over backend APIs; avoid duplicating game logic there.
- Preserve deterministic tick behavior in simulation changes.

## Workspace Commands

Run from repo root:

- Install all workspace deps: `bun install`
- Backend dev server (debug tick default): `bun run dev:server`
- Backend tests: `bun run test:backend`
- Backend typecheck: `bun run typecheck:backend`
- Frontend dev: `bun run dev:frontend`
- Frontend build: `bun run build:frontend`
- MCP dev (stdio): `bun run dev:mcp`
- MCP typecheck: `bun run typecheck:mcp`

## Backend (`backend/`)

- Entry: `backend/index.ts`
- Server/router: `backend/src/server.ts` (Hono + `Bun.serve`)
- Simulation loop: `backend/src/sim/shard.ts`
- Game rules/actions: `backend/src/sim/actions.ts`
- Rendering: `backend/src/sim/render/ascii.ts`
- In-memory state: `backend/src/storage/memory.ts`

### Backend Conventions

- Keep API error responses consistent (`{ ok: false, error: { code, message } }`).
- Preserve optional `client_tick` behavior: stale actions are accepted and queued.
- WebSocket observer channel is `/ws/observer`; observer snapshot endpoint is `/observer_state`.
- `idleTimeout` is configurable via `IDLE_TIMEOUT_S`.

## Frontend (`frontend/`)

- Uses Vite + React.
- In dev, call backend through Vite proxy using `/api/*` paths.
- WebSocket endpoint uses `/ws/observer` via Vite ws proxy.
- Do not hardcode backend port in app code; use Vite env/proxy settings.

### Frontend Conventions

- Keep observer and agent simulator UI resilient:
  - WebSocket real-time updates
  - Polling fallback for observer state
- Agent simulator should mirror real agent flow (`join -> act -> wait_state`).

## MCP (`mcp/`)

- Transport: stdio (`StdioServerTransport`).
- Server: `mcp/src/index.ts` using `@modelcontextprotocol/sdk`.
- Use `registerTool` (not deprecated `tool`).
- `BACKEND_URL` controls which backend instance MCP forwards to.

## Environment Variables

Backend:

- `PORT` (default `3000`)
- `IDLE_TIMEOUT_S` (default `120`)
- `TICK_MS` (dev script defaults to `10000` unless overridden)
- `MAP_WIDTH`, `MAP_HEIGHT`, `MAP_SEED`
- `VISION_RADIUS`, `HEARING_RADIUS`
- `INITIAL_MOBS`, `INITIAL_ITEMS`

Frontend (Vite):

- `BACKEND_HOST` (default `localhost`)
- `BACKEND_PORT` (default `3000`)
- `BACKEND_PROTOCOL` (default `http`)

MCP:

- `BACKEND_URL` (default `http://localhost:3000`)

## Testing Expectations

When changing backend simulation/API behavior:

- Run `bun run typecheck:backend`
- Run `bun run test:backend`

When changing frontend behavior:

- Run `bun run build:frontend`

When changing MCP behavior:

- Run `bun run typecheck:mcp`

## Notes

- `frontend/dist/` is build output.
- Keep docs in `README.md` aligned with API/tooling changes.
- If adding new endpoints used by agents, consider exposing them in MCP tools as well.
