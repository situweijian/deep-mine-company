import {
  MAX_MANUAL_QUEUE,
  SAVE_VERSION,
  createNewGame,
  ensureDailyState,
  normalizeGameState,
} from './engine';
import type {
  CargoInventory,
  CargoPart,
  GameState,
  LayerCargoState,
  LayerMiningState,
  LineId,
  ManagerId,
} from './types';
import { LINE_IDS } from './types';

export const SAVE_KEY = 'mine-company-save-v1';
export const SAVE_BACKUP_KEY = 'mine-company-save-backup-v1';
export const SAVE_VERSION_KEY = SAVE_VERSION;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LoadSaveResult {
  state: GameState;
  source: 'primary' | 'backup' | 'new';
  warning: string | null;
  isNew: boolean;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nonNegative(value: unknown, fallback = 0): number {
  return Math.max(0, finiteNumber(value, fallback));
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function integerValue(value: unknown, fallback: number): number {
  return Math.max(0, Math.floor(finiteNumber(value, fallback)));
}

function parseCargo(raw: unknown): CargoInventory {
  if (!isRecord(raw)) return { units: 0, totalValue: 0 };
  return {
    units: nonNegative(raw.units),
    totalValue: nonNegative(raw.totalValue),
  };
}

function parseCargoParts(raw: unknown): CargoPart[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): CargoPart | null => {
      if (!isRecord(entry)) return null;
      const layer = Math.floor(finiteNumber(entry.layer, 0));
      if (layer < 1) return null;
      return {
        layer,
        units: nonNegative(entry.units),
        totalValue: nonNegative(entry.totalValue),
      };
    })
    .filter((entry): entry is CargoPart => Boolean(entry && entry.units > 0));
}

function parseLayerMining(raw: unknown): LayerMiningState {
  const record = isRecord(raw) ? raw : {};
  return {
    progress: nonNegative(record.progress),
    active: booleanValue(record.active, false),
    automated: booleanValue(record.automated, false),
    crewLevel: Math.min(5, Math.max(1, integerValue(record.crewLevel, 1))),
    queued: Math.min(MAX_MANUAL_QUEUE, integerValue(record.queued, 0)),
    payload: parseCargo(record.payload),
    payloadLayer: integerValue(record.payloadLayer, 0),
    tripDuration: nonNegative(record.tripDuration),
  };
}

function parseLayerCargo(raw: unknown): LayerCargoState {
  const record = isRecord(raw) ? raw : {};
  return {
    underground: parseCargo(record.underground),
    surface: parseCargo(record.surface),
  };
}

function validateState(raw: unknown, now: number): GameState {
  if (!isRecord(raw)) throw new Error('存档内容不是对象。');
  const version = integerValue(raw.version, 0);
  if (version <= 0) throw new Error('存档缺少版本号。');
  if (version > SAVE_VERSION) {
    throw new Error(`存档版本 ${version} 高于当前支持版本 ${SAVE_VERSION}。`);
  }

  const base = createNewGame(now);
  base.version = SAVE_VERSION;
  base.money = nonNegative(raw.money);
  base.lifetimeEarnings = nonNegative(raw.lifetimeEarnings, base.money);
  base.companyXp = nonNegative(raw.companyXp);
  base.companyLevel = Math.max(1, integerValue(raw.companyLevel, 1));
  base.deepestLayer = Math.max(1, integerValue(raw.deepestLayer, 1));
  base.currentLayer = Math.max(1, integerValue(raw.currentLayer, base.deepestLayer));
  base.currentLayer = Math.min(base.currentLayer, base.deepestLayer);
  base.tutorialStep = Math.min(7, integerValue(raw.tutorialStep, 0));
  base.tutorialCompleted = booleanValue(raw.tutorialCompleted, base.tutorialStep >= 7);
  base.tutorialRewardClaimed = booleanValue(
    raw.tutorialRewardClaimed,
    base.tutorialCompleted,
  );
  base.adBoostSeconds = Math.min(1800, nonNegative(raw.adBoostSeconds));
  base.adCrewSeconds = Math.min(20 * 60, nonNegative(raw.adCrewSeconds));
  base.goldenShiftSeconds = Math.min(1800, nonNegative(raw.goldenShiftSeconds));
  base.richVeinSeconds = Math.min(60, nonNegative(raw.richVeinSeconds));
  base.eventCountdown = Math.max(0, finiteNumber(raw.eventCountdown, 180));
  base.prestigeMarks = Math.min(25, integerValue(raw.prestigeMarks, 0));
  base.prestigeCount = integerValue(raw.prestigeCount, 0);
  base.playSeconds = nonNegative(raw.playSeconds);
  base.lastSeenAt = nonNegative(raw.lastSeenAt, now);
  base.lastSavedAt = nonNegative(raw.lastSavedAt, now);
  base.seed = integerValue(raw.seed, base.seed);

  if (isRecord(raw.lines)) {
    for (const line of LINE_IDS) {
      const savedLine = raw.lines[line];
      if (!isRecord(savedLine)) continue;
      const automated = booleanValue(savedLine.automated, false);
      const payload =
        version >= 2 ? parseCargo(savedLine.payload) : parseCargo(null);
      const payloadLayer =
        version >= 2 ? integerValue(savedLine.payloadLayer, 0) : 0;
      const savedPayloadParts =
        version >= 2 ? parseCargoParts(savedLine.payloadParts) : [];
      const payloadParts =
        savedPayloadParts.length > 0
          ? savedPayloadParts
          : payloadLayer > 0 && payload.units > 0
            ? [{ layer: payloadLayer, ...payload }]
            : [];
      const savedPayloadLayers =
        version >= 2 && Array.isArray(savedLine.payloadLayers)
          ? savedLine.payloadLayers
              .map((value) => Math.floor(finiteNumber(value, 0)))
              .filter((value) => value > 0)
          : [];
      base.lines[line] = {
        level: Math.max(1, integerValue(savedLine.level, 1)),
        progress: version >= 2 ? nonNegative(savedLine.progress) : 0,
        active: version >= 2 ? booleanValue(savedLine.active, false) : false,
        automated,
        queued: Math.min(MAX_MANUAL_QUEUE, integerValue(savedLine.queued, 0)),
        payload,
        payloadLayer,
        payloadLayers:
          savedPayloadLayers.length > 0
            ? savedPayloadLayers
            : payloadParts.map((part) => part.layer),
        payloadParts,
        tripDuration:
          version >= 2 ? nonNegative(savedLine.tripDuration) : 0,
        automationLayer:
          line === 'drill' && automated ? base.currentLayer : 0,
      };
    }
  }

  if (version >= 2 && isRecord(raw.layers)) {
    for (const [key, value] of Object.entries(raw.layers)) {
      const layerIndex = Math.floor(Number(key));
      if (!Number.isFinite(layerIndex) || layerIndex < 1) continue;
      base.layers[layerIndex] = parseLayerMining(value);
    }
  }

  if (version >= 2 && isRecord(raw.layerCargo)) {
    for (const [key, value] of Object.entries(raw.layerCargo)) {
      const layerIndex = Math.floor(Number(key));
      if (!Number.isFinite(layerIndex) || layerIndex < 1) continue;
      base.layerCargo[layerIndex] = parseLayerCargo(value);
    }
  }

  if (isRecord(raw.underground)) {
    base.underground.units = nonNegative(raw.underground.units);
    base.underground.totalValue = nonNegative(raw.underground.totalValue);
  }
  if (isRecord(raw.surface)) {
    base.surface.units = nonNegative(raw.surface.units);
    base.surface.totalValue = nonNegative(raw.surface.totalValue);
  }
  if (isRecord(raw.managers)) {
    for (const id of Object.keys(base.managers) as ManagerId[]) {
      base.managers[id] = booleanValue(raw.managers[id], false);
    }
  }
  if (Array.isArray(raw.museum)) {
    base.museum = [
      ...new Set(
        raw.museum
          .filter((layer): layer is number => typeof layer === 'number')
          .map((layer) => Math.max(1, Math.floor(layer))),
      ),
    ].sort((a, b) => a - b);
  }
  if (isRecord(raw.settings)) {
    base.settings.sound = booleanValue(raw.settings.sound, true);
    base.settings.music = booleanValue(raw.settings.music, true);
    base.settings.sfxVolume = Math.min(
      1,
      Math.max(0, finiteNumber(raw.settings.sfxVolume, base.settings.sfxVolume)),
    );
    base.settings.musicVolume = Math.min(
      1,
      Math.max(0, finiteNumber(raw.settings.musicVolume, base.settings.musicVolume)),
    );
    base.settings.vibration = booleanValue(raw.settings.vibration, true);
    base.settings.screenShake = booleanValue(raw.settings.screenShake, true);
    base.settings.reduceFlash = booleanValue(raw.settings.reduceFlash, false);
  }
  if (isRecord(raw.stats)) {
    base.stats.totalTrips = integerValue(raw.stats.totalTrips, 0);
    base.stats.totalUnits = nonNegative(raw.stats.totalUnits);
    base.stats.manualActions = integerValue(raw.stats.manualActions, 0);
    base.stats.lineStarts = integerValue(raw.stats.lineStarts, 0);
    base.stats.upgrades = integerValue(raw.stats.upgrades, 0);
    base.stats.adsWatched = integerValue(raw.stats.adsWatched, 0);
    base.stats.bestSale = nonNegative(raw.stats.bestSale);
    base.stats.longestOfflineSeconds = nonNegative(raw.stats.longestOfflineSeconds);
  }
  if (isRecord(raw.daily)) {
    base.daily = {
      date: typeof raw.daily.date === 'string' ? raw.daily.date : base.daily.date,
      trips: integerValue(raw.daily.trips, 0),
      upgrades: integerValue(raw.daily.upgrades, 0),
      starts: integerValue(raw.daily.starts, 0),
      rewardClaimed: booleanValue(raw.daily.rewardClaimed, false),
    };
  }

  if (version < 2) {
    base.lines.drill.automationLayer = base.lines.drill.automated
      ? base.currentLayer
      : 0;
    base.layers[base.currentLayer] ??= parseLayerMining({
      automated: base.lines.drill.automated,
    });
    base.layers[base.currentLayer].automated = base.lines.drill.automated;
    base.layers[base.currentLayer].queued = base.lines.drill.queued;
  }

  normalizeGameState(base);
  ensureDailyState(base, now);
  return base;
}

function parseSave(raw: string, now: number): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('存档 JSON 已损坏。');
  }
  return validateState(parsed, now);
}

export class SaveRepository {
  constructor(
    private readonly storage: StorageLike,
    private readonly now: () => number = Date.now,
  ) {}

  load(): LoadSaveResult {
    const now = this.now();
    const primary = this.storage.getItem(SAVE_KEY);
    const backup = this.storage.getItem(SAVE_BACKUP_KEY);

    if (primary) {
      try {
        return {
          state: parseSave(primary, now),
          source: 'primary',
          warning: null,
          isNew: false,
        };
      } catch (error) {
        if (backup) {
          try {
            return {
              state: parseSave(backup, now),
              source: 'backup',
              warning: `主存档读取失败，已恢复自动备份：${toMessage(error)}`,
              isNew: false,
            };
          } catch {
            // Fall through to a clean save after preserving the unreadable values.
          }
        }
      }
    } else if (backup) {
      try {
        return {
          state: parseSave(backup, now),
          source: 'backup',
          warning: '主存档缺失，已恢复自动备份。',
          isNew: false,
        };
      } catch {
        // Fall through to a clean save.
      }
    }

    return {
      state: createNewGame(now),
      source: 'new',
      warning: primary || backup ? '存档和备份都无法读取，已创建新公司。' : null,
      isNew: true,
    };
  }

  save(state: GameState): { ok: boolean; error: string | null } {
    try {
      state.version = SAVE_VERSION;
      state.lastSavedAt = this.now();
      const serialized = JSON.stringify(state);
      const previous = this.storage.getItem(SAVE_KEY);
      if (previous) this.storage.setItem(SAVE_BACKUP_KEY, previous);
      this.storage.setItem(SAVE_KEY, serialized);
      return { ok: true, error: null };
    } catch (error) {
      return { ok: false, error: toMessage(error) };
    }
  }

  clear(): void {
    this.storage.removeItem(SAVE_KEY);
    this.storage.removeItem(SAVE_BACKUP_KEY);
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getLineLabel(line: LineId): string {
  return line === 'drill' ? '钻探' : line === 'lift' ? '起吊' : '运输';
}
