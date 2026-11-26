import { getLayerDefinition } from './layers';
import type { GameState, LineId } from './types';
import { LINE_IDS } from './types';

export const MAX_LAYER = 10_000;
export const OFFLINE_BASE_CAP_SECONDS = 12 * 60 * 60;
export const OFFLINE_MAX_CAP_SECONDS = 24 * 60 * 60;
export const AD_BOOST_SECONDS = 15 * 60;
export const AD_BOOST_RESERVE_SECONDS = 30 * 60;
export const AD_CREW_SECONDS = 12 * 60;
export const AD_CREW_RESERVE_SECONDS = 20 * 60;
export const GOLDEN_SHIFT_SECONDS = 10 * 60;
export const TUTORIAL_BOOST_SECONDS = 5 * 60;
export const MAX_LAYER_CREW = 5;
const MAX_ECONOMY_VALUE = Number.MAX_SAFE_INTEGER;

function scaledAmount(base: number, growth: number, steps: number): number {
  const logValue = Math.log(base) + Math.max(0, steps) * Math.log(growth);
  if (logValue >= Math.log(MAX_ECONOMY_VALUE)) return MAX_ECONOMY_VALUE;
  return Math.ceil(base * Math.exp(Math.max(0, steps) * Math.log(growth)));
}

interface LineConfig {
  label: string;
  baseUpgradeCost: number;
  automationCost: number;
  baseCapacity: number;
  capacityPerLevel: number;
  speedPerLevel: number;
}

export const LINE_CONFIG: Record<LineId, LineConfig> = {
  drill: {
    label: '钻探',
    baseUpgradeCost: 12,
    automationCost: 90,
    baseCapacity: 1,
    capacityPerLevel: 0.36,
    speedPerLevel: 1.18,
  },
  lift: {
    label: '起吊',
    baseUpgradeCost: 24,
    automationCost: 520,
    baseCapacity: 1.08,
    capacityPerLevel: 0.43,
    speedPerLevel: 1.16,
  },
  truck: {
    label: '运输',
    baseUpgradeCost: 40,
    automationCost: 1_800,
    baseCapacity: 1.16,
    capacityPerLevel: 0.5,
    speedPerLevel: 1.15,
  },
};

function hasManager(state: GameState, id: keyof GameState['managers']): boolean {
  return state.managers[id];
}

export function getGlobalSpeedMultiplier(state: GameState, line: LineId): number {
  let multiplier = hasManager(state, 'dong-shi') ? 1.12 : 1;
  if (line === 'drill' && hasManager(state, 'a-zuan')) multiplier *= 1.22;
  if (line === 'lift' && hasManager(state, 'gang-suo')) multiplier *= 1.22;
  if (line === 'truck' && hasManager(state, 'a-lu')) multiplier *= 1.22;
  return multiplier;
}

export function getLineCapacity(state: GameState, line: LineId): number {
  const lineState = state.lines[line];
  const config = LINE_CONFIG[line];
  const base =
    config.baseCapacity + (Math.max(1, lineState.level) - 1) * config.capacityPerLevel;
  return base * (hasManager(state, 'cang-ku') ? 1.2 : 1);
}

export function getLayerCrewLevel(state: GameState, layerIndex: number): number {
  return Math.min(
    MAX_LAYER_CREW,
    Math.max(1, Math.floor(state.layers[layerIndex]?.crewLevel ?? 1)),
  );
}

export function getDrillCapacityAtLayer(
  state: GameState,
  layerIndex: number,
): number {
  const crewLevel = getLayerCrewLevel(state, layerIndex);
  return getLineCapacity(state, 'drill') * (1 + (crewLevel - 1) * 0.45);
}

function getDrillCrewSpeedMultiplier(state: GameState, layerIndex: number): number {
  const crewLevel = getLayerCrewLevel(state, layerIndex);
  return 1 + (crewLevel - 1) * 0.07;
}

export function getLayerCrewUpgradeCost(
  state: GameState,
  layerIndex: number,
): number {
  const crewLevel = getLayerCrewLevel(state, layerIndex);
  if (crewLevel >= MAX_LAYER_CREW) return 0;
  const safeLayer = Math.max(1, Math.floor(layerIndex));
  const layerBaseCost = Math.max(
    60,
    getLayerDefinition(safeLayer).baseValue * 10,
  );
  return scaledAmount(layerBaseCost, 2.15, crewLevel - 1);
}

export function isDrillLayerAutomated(
  state: GameState,
  layerIndex: number,
  includeTemporary = true,
): boolean {
  if (includeTemporary && state.adCrewSeconds > 0) return true;
  return state.layers[layerIndex]?.automated ?? false;
}

export function isLineAutomated(
  state: GameState,
  line: LineId,
  includeTemporary = true,
): boolean {
  if (includeTemporary && state.adCrewSeconds > 0) return true;
  const lineState = state.lines[line];
  if (!lineState.automated) return false;
  if (line === 'drill') {
    return isDrillLayerAutomated(state, state.currentLayer, false);
  }
  return true;
}

export function getAutomatedDrillLayerCount(
  state: GameState,
  includeTemporary = false,
): number {
  if (includeTemporary && state.adCrewSeconds > 0) {
    return Math.max(1, Object.keys(state.layers).length);
  }
  return Object.values(state.layers).filter((layer) => layer.automated).length;
}

export function getTotalCargoUnits(
  state: GameState,
  source: 'underground' | 'surface',
): number {
  if (source === 'underground') return state.underground.units;
  return state.surface.units;
}

function getLineDurationAtLayer(
  state: GameState,
  line: LineId,
  layerIndex: number,
): number {
  const lineState = state.lines[line];
  const speed = Math.pow(
    LINE_CONFIG[line].speedPerLevel,
    Math.max(1, lineState.level) - 1,
  );
  const globalSpeed = getGlobalSpeedMultiplier(state, line);
  const safeLayer = Math.max(1, layerIndex);

  if (line === 'drill') {
    const depthExponent = hasManager(state, 'yan-xin') ? 0.82 : 1;
    const depthAdjustedBase =
      1.6 * Math.pow(1.08, (safeLayer - 1) * depthExponent);
    return Math.max(0.82, depthAdjustedBase / (speed * globalSpeed));
  }

  if (line === 'lift') {
    const depthPenalty = 1 + (safeLayer - 1) * 0.018;
    return Math.max(1.8, (2.55 * depthPenalty) / (speed * globalSpeed));
  }

  return Math.max(2.1, 2.8 / (speed * globalSpeed));
}

export function getLineDuration(
  state: GameState,
  line: LineId,
  layerIndex = state.currentLayer,
): number {
  return getLineDurationAtLayer(state, line, layerIndex);
}

export function getLineTripDuration(
  state: GameState,
  line: LineId,
  payloadUnits: number,
  layerIndex = state.currentLayer,
  stopCount = 1,
): number {
  let baseDuration = getLineDurationAtLayer(state, line, layerIndex);
  if (line === 'drill') {
    return baseDuration / getDrillCrewSpeedMultiplier(state, layerIndex);
  }

  const capacity = Math.max(0.001, getLineCapacity(state, line));
  const loadRatio = Math.min(1, Math.max(0, payloadUnits / capacity));
  const weightPenalty = 1 + loadRatio * (line === 'lift' ? 0.35 : 0.45);
  const stopPenalty =
    line === 'lift' ? 1 + Math.max(0, stopCount - 1) * 0.16 : 1;
  const tripDuration = baseDuration * weightPenalty * stopPenalty;
  return line === 'lift'
    ? Math.max(tripDuration, Math.max(0, stopCount) * 0.54)
    : tripDuration;
}

export function getLineUpgradeCost(line: LineId, currentLevel: number): number {
  return Math.ceil(
    LINE_CONFIG[line].baseUpgradeCost * Math.pow(2.02, Math.max(1, currentLevel) - 1),
  );
}

export function getAutomationCost(line: LineId, layerIndex = 1): number {
  if (line !== 'drill') return LINE_CONFIG[line].automationCost;
  const safeLayer = Math.max(1, Math.floor(layerIndex));
  return Math.ceil(
    Math.max(
      LINE_CONFIG.drill.automationCost,
      getLayerDefinition(safeLayer).baseValue * 14,
    ),
  );
}

export function getNextLayerCost(nextLayer: number): number {
  const safeLayer = Math.max(2, Math.floor(nextLayer));
  return scaledAmount(130, 2.4, safeLayer - 2);
}

export function getCompanyLevelRequirement(level: number): number {
  return Math.ceil(50 * Math.pow(1.28, Math.max(1, level) - 1));
}

export function getCompanyProgress(state: GameState): number {
  return Math.min(1, state.companyXp / getCompanyLevelRequirement(state.companyLevel));
}

export function getOutputMultiplier(state: GameState): number {
  const companyBonus = 1 + (Math.max(1, state.companyLevel) - 1) * 0.015;
  const museumBonus = 1 + state.museum.length * 0.01;
  const prestigeBonus = 1 + state.prestigeMarks * 0.1;
  const salesManagerBonus = hasManager(state, 'suan-pan') ? 1.15 : 1;
  const chairmanBonus = hasManager(state, 'dong-shi') ? 1.05 : 1;
  const runMultiplier = getPrestigeRunMultiplier(state);
  return (
    companyBonus *
    museumBonus *
    prestigeBonus *
    salesManagerBonus *
    chairmanBonus *
    runMultiplier
  );
}

export function getPrestigeRunMultiplier(state: GameState): number {
  return 1 + Math.min(10, Math.max(0, state.prestigeCount)) * 0.03;
}

export function getBoostMultiplier(state: GameState): number {
  const adMultiplier = state.adBoostSeconds > 0 ? 2 : 1;
  const goldenMultiplier = state.goldenShiftSeconds > 0 ? 1.5 : 1;
  const richVeinBase = hasManager(state, 'xing-yun') ? 3.25 : 2.5;
  const richVeinMultiplier = state.richVeinSeconds > 0 ? richVeinBase : 1;
  return adMultiplier * goldenMultiplier * richVeinMultiplier;
}

export function getSaleMultiplier(state: GameState): number {
  return getOutputMultiplier(state) * getBoostMultiplier(state);
}

export function getUnitSaleValue(state: GameState): number {
  return getLayerDefinition(state.currentLayer).baseValue * getSaleMultiplier(state);
}

export function getOfflineCapSeconds(state: GameState): number {
  const nightBonus = hasManager(state, 'ye-ban') ? 4 * 60 * 60 : 0;
  const prestigeBonus = Math.min(4 * 60 * 60, state.prestigeMarks * 30 * 60);
  return Math.min(
    OFFLINE_MAX_CAP_SECONDS,
    OFFLINE_BASE_CAP_SECONDS + nightBonus + prestigeBonus,
  );
}

export function getOfflineEfficiency(state: GameState): number {
  return hasManager(state, 'ye-ban') ? 1.15 : 1;
}

export function getAllLinesAutomated(state: GameState): boolean {
  return LINE_IDS.every((line) => isLineAutomated(state, line, false));
}

export function getLineThroughput(state: GameState, line: LineId): number {
  const capacity =
    line === 'drill'
      ? getDrillCapacityAtLayer(state, state.currentLayer)
      : getLineCapacity(state, line);
  return capacity / Math.max(
    0.001,
    getLineTripDuration(state, line, capacity, state.currentLayer),
  );
}

export function getBottleneckLine(state: GameState): LineId | null {
  const manualLine = LINE_IDS.find((line) => !isLineAutomated(state, line));
  if (manualLine) return manualLine;

  return LINE_IDS.reduce((slowest, line) => {
    return getLineThroughput(state, line) < getLineThroughput(state, slowest)
      ? line
      : slowest;
  }, LINE_IDS[0]);
}

export function getEstimatedRevenuePerSecond(
  state: GameState,
  includeTemporary = false,
): number {
  if (
    !LINE_IDS.every((line) =>
      isLineAutomated(state, line, includeTemporary),
    )
  ) {
    return 0;
  }
  const flow = Math.min(...LINE_IDS.map((line) => getLineThroughput(state, line)));
  return flow * getUnitSaleValue(state);
}

export function getRecommendedUpgradeLine(state: GameState): LineId {
  return LINE_IDS.reduce((weakest, line) => {
    return getLineThroughput(state, line) < getLineThroughput(state, weakest)
      ? line
      : weakest;
  }, LINE_IDS[0]);
}

export function getPrestigeMarksForRun(deepestLayer: number): number {
  if (deepestLayer < 20) return 0;
  return Math.min(25, 1 + Math.floor((deepestLayer - 20) / 5));
}

export function getPrestigeLayerRequirement(prestigeCount: number): number {
  const completed = Math.max(0, Math.floor(prestigeCount));
  return Math.min(MAX_LAYER, 20 + completed * 10);
}
