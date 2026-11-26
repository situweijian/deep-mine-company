import { describe, expect, it } from 'vitest';
import { createNewGame } from '../src/core/engine';
import {
  SAVE_BACKUP_KEY,
  SAVE_KEY,
  SaveRepository,
  type StorageLike,
} from '../src/core/save';

class MemoryStorage implements StorageLike {
  values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('save repository', () => {
  it('round-trips a game state and keeps a backup', () => {
    const storage = new MemoryStorage();
    const repository = new SaveRepository(storage, () => 10_000);
    const state = createNewGame(1_000);
    state.money = 987;
    state.settings.music = false;
    state.settings.sfxVolume = 0.35;
    state.settings.musicVolume = 0.2;

    expect(repository.save(state).ok).toBe(true);
    state.money = 1234;
    expect(repository.save(state).ok).toBe(true);

    const loaded = repository.load();
    expect(loaded.source).toBe('primary');
    expect(loaded.state.money).toBe(1234);
    expect(loaded.state.settings.music).toBe(false);
    expect(loaded.state.settings.sfxVolume).toBeCloseTo(0.35, 8);
    expect(loaded.state.settings.musicVolume).toBeCloseTo(0.2, 8);
    expect(storage.getItem(SAVE_BACKUP_KEY)).not.toBeNull();
  });

  it('falls back to the backup when the primary save is corrupt', () => {
    const storage = new MemoryStorage();
    const repository = new SaveRepository(storage, () => 10_000);
    const state = createNewGame(1_000);
    state.money = 456;
    repository.save(state);
    state.money = 789;
    repository.save(state);

    storage.setItem(SAVE_KEY, '{"version":1,"money":');
    const loaded = repository.load();

    expect(loaded.source).toBe('backup');
    expect(loaded.state.money).toBe(456);
    expect(loaded.warning).toContain('已恢复');
  });

  it('refuses a save from a newer version', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 99 }));
    const repository = new SaveRepository(storage, () => 10_000);
    const loaded = repository.load();

    expect(loaded.source).toBe('new');
    expect(loaded.isNew).toBe(true);
  });

  it('migrates an old active line without losing source inventory', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      SAVE_KEY,
      JSON.stringify({
        version: 1,
        money: 25,
        deepestLayer: 3,
        currentLayer: 3,
        underground: { units: 2, totalValue: 9 },
        surface: { units: 1, totalValue: 4 },
        lines: {
          drill: {
            level: 2,
            progress: 0.8,
            active: true,
            automated: true,
            queued: 3,
          },
          lift: {
            level: 1,
            progress: 0.4,
            active: true,
            automated: false,
            queued: 1,
          },
          truck: {
            level: 1,
            progress: 0,
            active: false,
            automated: false,
            queued: 0,
          },
        },
      }),
    );

    const loaded = new SaveRepository(storage, () => 10_000).load();

    expect(loaded.source).toBe('primary');
    expect(loaded.state.version).toBe(2);
    expect(loaded.state.lines.drill.active).toBe(false);
    expect(loaded.state.lines.lift.active).toBe(false);
    expect(loaded.state.lines.drill.queued).toBe(3);
    expect(loaded.state.lines.drill.automationLayer).toBe(3);
    expect(loaded.state.underground.units).toBe(2);
    expect(loaded.state.surface.units).toBe(1);
  });

  it('round-trips locked in-flight cargo', () => {
    const storage = new MemoryStorage();
    const repository = new SaveRepository(storage, () => 10_000);
    const state = createNewGame(1_000);
    state.lines.truck.active = true;
    state.lines.truck.progress = 2;
    state.lines.truck.payload = { units: 1.25, totalValue: 8 };
    state.lines.truck.payloadLayer = 4;
    state.lines.truck.tripDuration = 3.5;
    state.lines.truck.queued = 5;

    repository.save(state);
    const loaded = repository.load().state;

    expect(loaded.lines.truck.active).toBe(true);
    expect(loaded.lines.truck.payload.units).toBeCloseTo(1.25, 8);
    expect(loaded.lines.truck.payload.totalValue).toBeCloseTo(8, 8);
    expect(loaded.lines.truck.payloadLayer).toBe(4);
    expect(loaded.lines.truck.payloadLayers).toEqual([4]);
    expect(loaded.lines.truck.payloadParts[0]?.units).toBeCloseTo(1.25, 8);
    expect(loaded.lines.truck.tripDuration).toBeCloseTo(3.5, 8);
    expect(loaded.lines.truck.queued).toBe(5);
  });

  it('round-trips independent mining and cargo state for every unlocked layer', () => {
    const storage = new MemoryStorage();
    const repository = new SaveRepository(storage, () => 10_000);
    const state = createNewGame(1_000);
    state.deepestLayer = 3;
    state.currentLayer = 3;
    state.layers[2] = {
      progress: 0.4,
      active: true,
      automated: true,
      crewLevel: 3,
      queued: 1,
      payload: { units: 2, totalValue: 8 },
      payloadLayer: 2,
      tripDuration: 2.5,
    };
    state.layerCargo[2] = {
      underground: { units: 3, totalValue: 12 },
      surface: { units: 1, totalValue: 4 },
    };

    repository.save(state);
    const loaded = repository.load().state;

    expect(loaded.layers[2].automated).toBe(true);
    expect(loaded.layers[2].crewLevel).toBe(3);
    expect(loaded.layers[2].payload.units).toBeCloseTo(2, 8);
    expect(loaded.layerCargo[2].underground.units).toBeCloseTo(3, 8);
    expect(loaded.layerCargo[2].surface.units).toBeCloseTo(1, 8);
  });
});
