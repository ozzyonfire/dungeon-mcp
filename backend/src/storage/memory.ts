import { type Intent, type Snapshot, type WorldState } from "../sim/world";

export type PendingAction = {
  player_id: string;
  intent: Intent;
  emote?: string;
  client_tick?: number;
};

export interface StorageAdapter {
  getWorld(): WorldState;
  setWorld(world: WorldState): void;
  setPendingAction(action: PendingAction): void;
  getPendingActions(): Map<string, PendingAction>;
  clearPendingActions(): void;
  pushPlayerEvent(playerId: string, tick: number, event: string): void;
  consumePlayerEvents(playerId: string, committedTick: number): string[];
  setLastSnapshot(playerId: string, snapshot: Snapshot): void;
  getLastSnapshot(playerId: string): Snapshot | undefined;
}

type PlayerEventsState = {
  cursorTick: number;
  entries: Array<{ tick: number; event: string }>;
};

export class InMemoryStorage implements StorageAdapter {
  private world: WorldState;

  private pendingActions = new Map<string, PendingAction>();

  private playerEvents = new Map<string, PlayerEventsState>();

  private lastSnapshots = new Map<string, Snapshot>();

  constructor(initialWorld: WorldState) {
    this.world = initialWorld;
  }

  getWorld(): WorldState {
    return this.world;
  }

  setWorld(world: WorldState): void {
    this.world = world;
  }

  setPendingAction(action: PendingAction): void {
    this.pendingActions.set(action.player_id, action);
  }

  getPendingActions(): Map<string, PendingAction> {
    return this.pendingActions;
  }

  clearPendingActions(): void {
    this.pendingActions = new Map<string, PendingAction>();
  }

  pushPlayerEvent(playerId: string, tick: number, event: string): void {
    const state = this.playerEvents.get(playerId) ?? {
      cursorTick: 0,
      entries: [],
    };
    state.entries.push({ tick, event });
    this.playerEvents.set(playerId, state);
  }

  consumePlayerEvents(playerId: string, committedTick: number): string[] {
    const state = this.playerEvents.get(playerId) ?? {
      cursorTick: 0,
      entries: [],
    };

    const events = state.entries
      .filter((entry) => entry.tick > state.cursorTick && entry.tick <= committedTick)
      .map((entry) => entry.event);

    state.cursorTick = committedTick;
    state.entries = state.entries.filter((entry) => entry.tick > committedTick - 20);
    this.playerEvents.set(playerId, state);

    return events;
  }

  setLastSnapshot(playerId: string, snapshot: Snapshot): void {
    this.lastSnapshots.set(playerId, snapshot);
  }

  getLastSnapshot(playerId: string): Snapshot | undefined {
    return this.lastSnapshots.get(playerId);
  }
}
