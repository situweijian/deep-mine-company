import {
  getBottleneckLine,
  getOfflineCapSeconds,
  getOfflineEfficiency,
} from './economy';
import {
  advanceGame,
  ensureDailyState,
  normalizeGameState,
} from './engine';
import type { CargoInventory, GameState, OfflineReport } from './types';
import { LINE_IDS } from './types';

function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

function ensureLayerCargo(state: GameState, layerIndex: number): void {
  state.layerCargo ??= {};
  state.layerCargo[layerIndex] ??= {
    underground: { units: 0, totalValue: 0 },
    surface: { units: 0, totalValue: 0 },
  };
}

function returnCargo(
  target: CargoInventory,
  cargo: CargoInventory,
): void {
  if (cargo.units <= 0) return;
  target.units += cargo.units;
  target.totalValue += cargo.totalValue;
}

function returnInterruptedCargo(state: GameState): void {
  for (const line of ['lift', 'truck'] as const) {
    const lineState = state.lines[line];
    if (lineState.payload.units > 0 && lineState.payloadLayer > 0) {
      ensureLayerCargo(state, lineState.payloadLayer);
      const source = line === 'lift' ? 'underground' : 'surface';
      returnCargo(
        state.layerCargo[lineState.payloadLayer][source],
        lineState.payload,
      );
    }
    lineState.active = false;
    lineState.progress = 0;
    lineState.payload = { units: 0, totalValue: 0 };
    lineState.payloadLayer = 0;
    lineState.tripDuration = 0;
  }

  for (const layer of Object.values(state.layers)) {
    layer.active = false;
    layer.progress = 0;
    layer.payload = { units: 0, totalValue: 0 };
    layer.payloadLayer = 0;
    layer.tripDuration = 0;
  }
}

function hasPermanentAutomation(state: GameState): boolean {
  return (
    Object.values(state.layers).some((layer) => layer.automated) ||
    state.lines.lift.automated ||
    state.lines.truck.automated
  );
}

export function calculateOfflineProgress(
  sourceState: GameState,
  now = Date.now(),
): OfflineReport {
  const state = cloneState(sourceState);
  const onlineBoosts = {
    adBoostSeconds: state.adBoostSeconds,
    adCrewSeconds: state.adCrewSeconds,
    goldenShiftSeconds: state.goldenShiftSeconds,
    richVeinSeconds: state.richVeinSeconds,
  };
  state.adBoostSeconds = 0;
  state.adCrewSeconds = 0;
  state.goldenShiftSeconds = 0;
  state.richVeinSeconds = 0;
  normalizeGameState(state);
  ensureDailyState(state, now);

  const elapsedSeconds = Math.max(0, Math.floor((now - sourceState.lastSeenAt) / 1000));
  const capSeconds = getOfflineCapSeconds(state);
  const creditedSeconds = Math.min(elapsedSeconds, capSeconds);
  const fromLayer = sourceState.currentLayer;
  const startingMoney = state.lifetimeEarnings;
  const startingTrips = state.stats.totalTrips;
  const startingUnits = state.stats.totalUnits;

  returnInterruptedCargo(state);
  for (const line of LINE_IDS) state.lines[line].queued = 0;
  for (const layer of Object.values(state.layers)) layer.queued = 0;
  normalizeGameState(state);

  if (creditedSeconds > 0 && hasPermanentAutomation(state)) {
    const step = 5;
    let remaining = creditedSeconds;
    while (remaining > 0) {
      const delta = Math.min(step, remaining);
      advanceGame(state, delta, { offline: true, now });
      remaining -= delta;
    }
  }

  state.adBoostSeconds = onlineBoosts.adBoostSeconds;
  state.adCrewSeconds = onlineBoosts.adCrewSeconds;
  state.goldenShiftSeconds = onlineBoosts.goldenShiftSeconds;
  state.richVeinSeconds = onlineBoosts.richVeinSeconds;

  const rawEarnings = Math.max(0, state.lifetimeEarnings - startingMoney);
  const efficiency = getOfflineEfficiency(state);
  const efficiencyBonus = rawEarnings * Math.max(0, efficiency - 1);
  state.money += efficiencyBonus;
  state.lifetimeEarnings += efficiencyBonus;

  const baseEarnings = rawEarnings + efficiencyBonus;
  const trips = Math.max(0, state.stats.totalTrips - startingTrips);
  const units = Math.max(0, state.stats.totalUnits - startingUnits);
  state.stats.longestOfflineSeconds = Math.max(
    state.stats.longestOfflineSeconds,
    creditedSeconds,
  );
  state.lastSeenAt = now;
  normalizeGameState(state);

  return {
    state,
    elapsedSeconds,
    creditedSeconds,
    capSeconds,
    capped: elapsedSeconds > capSeconds,
    baseEarnings,
    trips,
    units,
    bottleneck: getBottleneckLine(state),
    eligibleForAdBonus: baseEarnings > 0,
    fromLayer,
    toLayer: state.currentLayer,
  };
}
