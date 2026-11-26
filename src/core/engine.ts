import {
  AD_BOOST_RESERVE_SECONDS,
  AD_CREW_RESERVE_SECONDS,
  AD_CREW_SECONDS,
  GOLDEN_SHIFT_SECONDS,
  MAX_LAYER,
  TUTORIAL_BOOST_SECONDS,
  getAutomationCost,
  getBottleneckLine,
  getCompanyLevelRequirement,
  getDrillCapacityAtLayer,
  getLayerCrewUpgradeCost,
  getLineCapacity,
  getLineTripDuration,
  getLineUpgradeCost,
  getNextLayerCost,
  getPrestigeLayerRequirement,
  getPrestigeMarksForRun,
  getRecommendedUpgradeLine,
  getSaleMultiplier,
} from './economy';
import { clamp, formatMoney } from './format';
import {
  DESKTOP_VISIBLE_LAYERS,
  getVisibleLayerWindow,
} from './layer-window';
import { getLayerDefinition } from './layers';
import { MANAGER_BY_ID } from './managers';
import type {
  ActionOutcome,
  CargoInventory,
  CargoPart,
  GameEvent,
  GameState,
  LayerCargoState,
  LayerMiningState,
  LineId,
  ManagerId,
  ProductionLineState,
} from './types';
import { LINE_IDS } from './types';

export const SAVE_VERSION = 2;
export const DAILY_GOALS = {
  trips: 30,
  upgrades: 4,
  starts: 20,
} as const;

const EPSILON = 1e-9;
export const MAX_MANUAL_QUEUE = 5;
const MAX_CYCLES_PER_LINE_STEP = 20_000;

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function emptyDaily(timestamp: number): GameState['daily'] {
  return {
    date: localDateKey(timestamp),
    trips: 0,
    upgrades: 0,
    starts: 0,
    rewardClaimed: false,
  };
}

function emptyCargo(): CargoInventory {
  return { units: 0, totalValue: 0 };
}

function createLineState(): ProductionLineState {
  return {
    level: 1,
    progress: 0,
    active: false,
    automated: false,
    queued: 0,
    payload: emptyCargo(),
    payloadLayer: 0,
    payloadLayers: [],
    payloadParts: [],
    tripDuration: 0,
    automationLayer: 0,
  };
}

function createLayerMiningState(): LayerMiningState {
  return {
    progress: 0,
    active: false,
    automated: false,
    crewLevel: 1,
    queued: 0,
    payload: emptyCargo(),
    payloadLayer: 0,
    tripDuration: 0,
  };
}

function createLayerCargoState(): LayerCargoState {
  return {
    underground: emptyCargo(),
    surface: emptyCargo(),
  };
}

export function createNewGame(now = Date.now()): GameState {
  const lines = Object.fromEntries(
    LINE_IDS.map((line) => [line, createLineState()]),
  ) as GameState['lines'];

  return {
    version: SAVE_VERSION,
    money: 0,
    lifetimeEarnings: 0,
    companyXp: 0,
    companyLevel: 1,
    deepestLayer: 1,
    currentLayer: 1,
    lines,
    layers: { 1: createLayerMiningState() },
    layerCargo: { 1: createLayerCargoState() },
    underground: { units: 0, totalValue: 0 },
    surface: { units: 0, totalValue: 0 },
    managers: {
      'a-zuan': false,
      'gang-suo': false,
      'a-lu': false,
      'suan-pan': false,
      'yan-xin': false,
      'ye-ban': false,
      'cang-ku': false,
      'xing-yun': false,
      'dong-shi': false,
    },
    museum: [],
    tutorialStep: 0,
    tutorialCompleted: false,
    tutorialRewardClaimed: false,
    adBoostSeconds: 0,
    adCrewSeconds: 0,
    goldenShiftSeconds: 0,
    richVeinSeconds: 0,
    eventCountdown: 180,
    daily: emptyDaily(now),
    settings: {
      sound: true,
      music: true,
      sfxVolume: 0.62,
      musicVolume: 0.52,
      vibration: true,
      screenShake: true,
      reduceFlash: false,
    },
    stats: {
      totalTrips: 0,
      totalUnits: 0,
      manualActions: 0,
      lineStarts: 0,
      upgrades: 0,
      adsWatched: 0,
      bestSale: 0,
      longestOfflineSeconds: 0,
    },
    prestigeMarks: 0,
    prestigeCount: 0,
    playSeconds: 0,
    lastSeenAt: now,
    lastSavedAt: 0,
    seed: Math.floor(Math.random() * 2_147_483_647),
  };
}

export function ensureDailyState(state: GameState, now = Date.now()): boolean {
  const today = localDateKey(now);
  if (state.daily.date === today) return false;
  state.daily = emptyDaily(now);
  return true;
}

function safeAdd(value: number, addition: number): number {
  const next = value + addition;
  return Number.isFinite(next) ? next : Number.MAX_VALUE;
}

function safeMultiply(value: number, multiplier: number): number {
  const next = value * multiplier;
  return Number.isFinite(next) ? next : Number.MAX_VALUE;
}

function ensureLayerState(state: GameState, layerIndex: number): LayerMiningState {
  const safeLayer = Math.max(1, Math.floor(layerIndex));
  state.layers ??= {};
  state.layerCargo ??= {};
  state.layers[safeLayer] ??= createLayerMiningState();
  state.layerCargo[safeLayer] ??= createLayerCargoState();
  return state.layers[safeLayer];
}

function layerIndices(state: GameState): number[] {
  const deepest = Math.max(1, Math.floor(state.deepestLayer));
  const indices = new Set<number>([state.currentLayer]);
  for (let layer = 1; layer <= deepest; layer += 1) {
    indices.add(layer);
  }
  for (const key of [...Object.keys(state.layers), ...Object.keys(state.layerCargo)]) {
    const layer = Math.floor(Number(key));
    if (Number.isFinite(layer) && layer >= 1) indices.add(layer);
  }

  return [...indices]
    .sort((a, b) => a - b)
    .map((layer) => {
      ensureLayerState(state, layer);
      return layer;
    });
}

function sumLayerCargo(
  state: GameState,
  source: 'underground' | 'surface',
): CargoInventory {
  const total = emptyCargo();
  for (const layer of layerIndices(state)) {
    const cargo = state.layerCargo[layer]?.[source];
    if (!cargo) continue;
    total.units = safeAdd(total.units, cargo.units);
    total.totalValue = safeAdd(total.totalValue, cargo.totalValue);
  }
  return total;
}

function syncCargoMirrors(state: GameState): void {
  state.underground = sumLayerCargo(state, 'underground');
  state.surface = sumLayerCargo(state, 'surface');
}

function importLegacyAggregateCargo(
  state: GameState,
  source: 'underground' | 'surface',
): void {
  const aggregate = state[source];
  const layered = sumLayerCargo(state, source);
  const missingUnits = Math.max(0, aggregate.units - layered.units);
  if (missingUnits <= EPSILON) return;

  const missingValue = Math.max(0, aggregate.totalValue - layered.totalValue);
  ensureLayerState(state, state.currentLayer);
  const target = state.layerCargo[state.currentLayer][source];
  addCargo(target, missingUnits, missingValue);
}

function syncDrillMirror(state: GameState): void {
  const layer = ensureLayerState(state, state.currentLayer);
  const line = state.lines.drill;
  line.progress = layer.progress;
  line.active = layer.active;
  line.automated = layer.automated;
  line.queued = layer.queued;
  line.payload = { ...layer.payload };
  line.payloadLayer = layer.payloadLayer;
  line.payloadLayers = layer.payloadLayer > 0 ? [layer.payloadLayer] : [];
  line.payloadParts =
    layer.payloadLayer > 0
      ? [{ layer: layer.payloadLayer, ...layer.payload }]
      : [];
  line.tripDuration = layer.tripDuration;
  line.automationLayer = layer.automated ? state.currentLayer : 0;
}

function ensureRuntimeState(state: GameState): void {
  state.layers ??= {};
  state.layerCargo ??= {};
  state.deepestLayer = Math.max(1, Math.floor(state.deepestLayer));
  state.currentLayer = Math.min(
    state.deepestLayer,
    Math.max(1, Math.floor(state.currentLayer)),
  );
  if (!Number.isFinite(state.adCrewSeconds)) state.adCrewSeconds = 0;

  const lineAutomationWasSet =
    state.lines.drill.automated &&
    !ensureLayerState(state, state.currentLayer).automated &&
    state.lines.drill.automationLayer === 0;
  if (lineAutomationWasSet) {
    ensureLayerState(state, state.currentLayer).automated = true;
  }

  layerIndices(state);
  importLegacyAggregateCargo(state, 'underground');
  importLegacyAggregateCargo(state, 'surface');
  syncCargoMirrors(state);
  syncDrillMirror(state);
}

export function normalizeGameState(state: GameState): void {
  ensureRuntimeState(state);
}

function cargoLayerIndices(
  state: GameState,
): number[] {
  return layerIndices(state).sort((a, b) => a - b);
}

function findCargoLayer(
  state: GameState,
  source: 'underground' | 'surface',
): number {
  const ready = cargoLayerIndices(state).filter(
    (layer) => (state.layerCargo[layer]?.[source]?.units ?? 0) > EPSILON,
  );
  if (ready.length === 0) return 0;

  // Rotate ready layers so a busy deep layer cannot permanently starve upper piles.
  const offset =
    (state.stats.lineStarts + (source === 'surface' ? 1 : 0)) % ready.length;
  return ready[offset];
}

function addCompanyXp(state: GameState, xp: number, events: GameEvent[]): void {
  state.companyXp = safeAdd(state.companyXp, Math.max(0, xp));
  let guard = 0;
  while (
    state.companyXp + EPSILON >= getCompanyLevelRequirement(state.companyLevel) &&
    guard < 1000
  ) {
    state.companyXp -= getCompanyLevelRequirement(state.companyLevel);
    state.companyLevel += 1;
    events.push({ type: 'company_level_up', level: state.companyLevel });
    guard += 1;
  }
}

function addCargo(inventory: CargoInventory, units: number, totalValue: number): void {
  if (units <= 0) return;
  inventory.units = safeAdd(inventory.units, units);
  inventory.totalValue = safeAdd(inventory.totalValue, totalValue);
}

function takeCargo(
  inventory: CargoInventory,
  requestedUnits: number,
): { units: number; totalValue: number } {
  if (inventory.units <= EPSILON || requestedUnits <= EPSILON) {
    return { units: 0, totalValue: 0 };
  }

  const units = Math.min(inventory.units, requestedUnits);
  const ratio = units / inventory.units;
  const totalValue = inventory.totalValue * ratio;
  inventory.units = Math.max(0, inventory.units - units);
  inventory.totalValue = Math.max(0, inventory.totalValue - totalValue);

  if (inventory.units <= EPSILON) {
    inventory.units = 0;
    inventory.totalValue = 0;
  }

  return { units, totalValue };
}

function startDrillCycle(
  state: GameState,
  layerIndex: number,
  events: GameEvent[],
): boolean {
  const layer = ensureLayerState(state, layerIndex);
  if (layer.active) return true;

  const units = getDrillCapacityAtLayer(state, layerIndex);
  const duration = Math.max(
    0.001,
    getLineTripDuration(state, 'drill', units, layerIndex),
  );
  layer.active = true;
  layer.progress = 0;
  layer.payload = {
    units,
    totalValue: units * getLayerDefinition(layerIndex).baseValue,
  };
  layer.payloadLayer = layerIndex;
  layer.tripDuration = duration;
  state.stats.lineStarts += 1;
  state.daily.starts += 1;
  events.push({
    type: 'line_started',
    line: 'drill',
    units,
    layer: layerIndex,
    tripDuration: duration,
  });
  return true;
}

function completeDrillCycle(
  state: GameState,
  layerIndex: number,
  events: GameEvent[],
): void {
  const layer = ensureLayerState(state, layerIndex);
  const cargo = layer.payload;
  if (cargo.units > EPSILON) {
    addCargo(
      state.layerCargo[layerIndex].underground,
      cargo.units,
      cargo.totalValue,
    );
  }

  const firstSample = !state.museum.includes(layerIndex);
  if (firstSample) {
    state.museum.push(layerIndex);
    state.museum.sort((a, b) => a - b);
  }
  events.push({
    type: 'mine_completed',
    line: 'drill',
    units: cargo.units,
    value: cargo.totalValue,
    layer: layerIndex,
    firstSample,
  });

  layer.active = false;
  layer.progress = 0;
  layer.payload = emptyCargo();
  layer.payloadLayer = 0;
  layer.tripDuration = 0;
  if (layer.queued > 0) layer.queued -= 1;
}

function processDrillLayer(
  state: GameState,
  layerIndex: number,
  deltaSeconds: number,
  events: GameEvent[],
): void {
  const layer = ensureLayerState(state, layerIndex);
  let remaining = Math.max(0, deltaSeconds);
  let cycles = 0;

  while (remaining > EPSILON && cycles < MAX_CYCLES_PER_LINE_STEP) {
    const automated =
      layer.automated || (state.adCrewSeconds > 0 && layerIndex >= 1);
    if (!automated && layer.queued <= 0) break;
    if (!layer.active && !startDrillCycle(state, layerIndex, events)) break;

    const duration = Math.max(
      0.001,
      layer.tripDuration || getLineTripDuration(
        state,
        'drill',
        layer.payload.units,
        layerIndex,
      ),
    );
    const needed = Math.max(0, duration - layer.progress);
    if (needed > remaining) {
      layer.progress += remaining;
      remaining = 0;
      break;
    }

    layer.progress = duration;
    remaining -= needed;
    completeDrillCycle(state, layerIndex, events);
    cycles += 1;
    if (!automated && layer.queued <= 0) break;
  }
}

function startFreightCycle(
  state: GameState,
  line: 'lift' | 'truck',
  events: GameEvent[],
  visibleLayerCount: number,
): boolean {
  const lineState = state.lines[line];
  if (lineState.active) return true;

  const source = line === 'lift' ? 'underground' : 'surface';
  const liftRouteLayers =
    line === 'lift'
      ? getVisibleLayerWindow(
          state.currentLayer,
          state.deepestLayer,
          visibleLayerCount,
        ).filter((layer) => layer <= state.deepestLayer)
      : [];
  const startLayer =
    line === 'lift'
      ? liftRouteLayers.at(-1) ?? state.currentLayer
      : findCargoLayer(state, source);
  if (startLayer <= 0) return false;

  const availableLayers =
    line === 'lift'
      ? liftRouteLayers.filter(
          (layer) =>
            (state.layerCargo[layer]?.[source]?.units ?? 0) > EPSILON,
        )
      : cargoLayerIndices(state).filter(
          (layer) =>
            (state.layerCargo[layer]?.[source]?.units ?? 0) > EPSILON,
        );
  if (line === 'lift') {
    availableLayers.sort((a, b) => b - a);
  } else {
    const startIndex = Math.max(0, availableLayers.indexOf(startLayer));
    availableLayers.push(...availableLayers.splice(0, startIndex));
  }

  const cargo = emptyCargo();
  const cargoParts: CargoPart[] = [];
  const pickupLayers: number[] = [];
  const capacity = getLineCapacity(state, line);
  for (const layer of availableLayers) {
    const remainingCapacity = capacity - cargo.units;
    if (remainingCapacity <= EPSILON) break;
    const picked = takeCargo(
      state.layerCargo[layer][source],
      remainingCapacity,
    );
    if (picked.units <= EPSILON) continue;
    addCargo(cargo, picked.units, picked.totalValue);
    pickupLayers.push(layer);
    cargoParts.push({ layer, ...picked });
  }
  if (cargo.units <= EPSILON) return false;
  const sourceLayer =
    line === 'lift' ? startLayer : pickupLayers[0] ?? startLayer;

  const duration = Math.max(
    0.001,
    getLineTripDuration(
      state,
      line,
      cargo.units,
      sourceLayer,
      line === 'lift'
        ? Math.max(1, liftRouteLayers.length)
        : pickupLayers.length,
    ),
  );
  lineState.active = true;
  lineState.progress = 0;
  lineState.payload = cargo;
  lineState.payloadLayer = sourceLayer;
  lineState.payloadLayers = pickupLayers;
  lineState.payloadParts = cargoParts;
  lineState.tripDuration = duration;
  state.stats.lineStarts += 1;
  state.daily.starts += 1;
  events.push({
    type: 'line_started',
    line,
    units: cargo.units,
    layer: sourceLayer,
    layers: pickupLayers,
    tripDuration: duration,
  });
  syncCargoMirrors(state);
  return true;
}

function completeFreightCycle(
  state: GameState,
  line: 'lift' | 'truck',
  events: GameEvent[],
): void {
  const lineState = state.lines[line];
  const cargo = lineState.payload;
  const sourceLayer = lineState.payloadLayer;
  if (cargo.units <= EPSILON || sourceLayer <= 0) {
    lineState.active = false;
    lineState.progress = 0;
    lineState.payload = emptyCargo();
    lineState.payloadLayer = 0;
    lineState.payloadLayers = [];
    lineState.payloadParts = [];
    lineState.tripDuration = 0;
    return;
  }

  if (line === 'lift') {
    const parts =
      lineState.payloadParts.length > 0
        ? lineState.payloadParts
        : [{ layer: sourceLayer, ...cargo }];
    for (const part of parts) {
      ensureLayerState(state, part.layer);
      addCargo(
        state.layerCargo[part.layer].surface,
        part.units,
        part.totalValue,
      );
    }
    events.push({
      type: 'lift_completed',
      line,
      units: cargo.units,
      value: cargo.totalValue,
      layer: sourceLayer,
      layers: lineState.payloadLayers,
    });
  } else {
    const multiplier = getSaleMultiplier(state);
    const revenue = safeMultiply(cargo.totalValue, multiplier);
    state.money = safeAdd(state.money, revenue);
    state.lifetimeEarnings = safeAdd(state.lifetimeEarnings, revenue);
    state.stats.totalTrips += 1;
    state.stats.totalUnits = safeAdd(state.stats.totalUnits, cargo.units);
    state.stats.bestSale = Math.max(state.stats.bestSale, revenue);
    state.daily.trips += 1;
    addCompanyXp(
      state,
      Math.max(1, Math.round(5 + sourceLayer * 1.4 + cargo.units * 0.25)),
      events,
    );
    events.push({
      type: 'sale_completed',
      line,
      units: cargo.units,
      baseValue: cargo.totalValue,
      revenue,
      layer: sourceLayer,
      layers: lineState.payloadLayers,
      multiplier,
    });
  }

  lineState.active = false;
  lineState.progress = 0;
  lineState.payload = emptyCargo();
  lineState.payloadLayer = 0;
  lineState.payloadLayers = [];
  lineState.payloadParts = [];
  lineState.tripDuration = 0;
  if (lineState.queued > 0) lineState.queued -= 1;
  syncCargoMirrors(state);
}

function processFreightLine(
  state: GameState,
  line: 'lift' | 'truck',
  deltaSeconds: number,
  events: GameEvent[],
  visibleLayerCount: number,
): void {
  const lineState = state.lines[line];
  const temporaryAutomation = state.adCrewSeconds > 0;
  const automated = lineState.automated || temporaryAutomation;
  let remaining = Math.max(0, deltaSeconds);
  let cycles = 0;

  while (remaining > EPSILON && cycles < MAX_CYCLES_PER_LINE_STEP) {
    if (!automated && lineState.queued <= 0) break;
    if (
      !lineState.active &&
      !startFreightCycle(state, line, events, visibleLayerCount)
    ) {
      break;
    }

    const duration = Math.max(
      0.001,
      lineState.tripDuration || getLineTripDuration(
        state,
        line,
        lineState.payload.units,
        lineState.payloadLayer,
      ),
    );
    const needed = Math.max(0, duration - lineState.progress);
    if (needed > remaining) {
      lineState.progress += remaining;
      remaining = 0;
      break;
    }

    lineState.progress = duration;
    remaining -= needed;
    completeFreightCycle(state, line, events);
    cycles += 1;
    if (!automated && lineState.queued <= 0) break;
  }
}

function triggerRichVein(state: GameState, events: GameEvent[]): void {
  state.richVeinSeconds = Math.max(state.richVeinSeconds, 20);
  state.eventCountdown = 150 + Math.floor((state.seed % 90));
  state.seed = (state.seed * 1_103_515_245 + 12_345) >>> 0;
  events.push({ type: 'rich_vein_started', seconds: 20 });
}

function updateTimers(
  state: GameState,
  deltaSeconds: number,
  events: GameEvent[],
  offline: boolean,
): void {
  if (!offline) {
    state.playSeconds += deltaSeconds;

    if (state.adBoostSeconds > 0) {
      const before = state.adBoostSeconds;
      state.adBoostSeconds = Math.max(0, state.adBoostSeconds - deltaSeconds);
      if (before > 0 && state.adBoostSeconds === 0) {
        events.push({ type: 'boost_ended', boost: 'ad' });
      }
    }

    if (state.adCrewSeconds > 0) {
      const before = state.adCrewSeconds;
      state.adCrewSeconds = Math.max(0, state.adCrewSeconds - deltaSeconds);
      if (before > 0 && state.adCrewSeconds === 0) {
        events.push({ type: 'boost_ended', boost: 'ad-crew' });
      }
    }

    if (state.goldenShiftSeconds > 0) {
      const before = state.goldenShiftSeconds;
      state.goldenShiftSeconds = Math.max(0, state.goldenShiftSeconds - deltaSeconds);
      if (before > 0 && state.goldenShiftSeconds === 0) {
        events.push({ type: 'boost_ended', boost: 'golden' });
      }
    }

    if (state.richVeinSeconds > 0) {
      const before = state.richVeinSeconds;
      state.richVeinSeconds = Math.max(0, state.richVeinSeconds - deltaSeconds);
      if (before > 0 && state.richVeinSeconds === 0) {
        events.push({ type: 'rich_vein_ended' });
      }
    } else if (state.deepestLayer >= 5) {
      state.eventCountdown -= deltaSeconds;
      if (state.eventCountdown <= 0 && LINE_IDS.some((line) => state.lines[line].automated)) {
        triggerRichVein(state, events);
      }
    }
  }
}

export function advanceGame(
  state: GameState,
  deltaSeconds: number,
  options: {
    offline?: boolean;
    now?: number;
    visibleLayerCount?: number;
  } = {},
): GameEvent[] {
  const events: GameEvent[] = [];
  const safeDelta = clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 60);
  ensureRuntimeState(state);
  ensureDailyState(state, options.now);
  updateTimers(state, safeDelta, events, options.offline ?? false);

  for (const layerIndex of layerIndices(state)) {
    processDrillLayer(state, layerIndex, safeDelta, events);
  }
  for (const line of ['lift', 'truck'] as const) {
    processFreightLine(
      state,
      line,
      safeDelta,
      events,
      Math.max(
        1,
        Math.floor(options.visibleLayerCount ?? DESKTOP_VISIBLE_LAYERS),
      ),
    );
  }

  syncCargoMirrors(state);
  syncDrillMirror(state);
  state.lastSeenAt = options.now ?? Date.now();
  return events;
}

function advanceTutorial(state: GameState, expectedStep: number, nextStep: number): boolean {
  if (state.tutorialCompleted || state.tutorialStep !== expectedStep) return false;
  state.tutorialStep = nextStep;
  return true;
}

export function queueLine(
  state: GameState,
  line: LineId,
  layerIndex = state.currentLayer,
): ActionOutcome {
  ensureRuntimeState(state);
  const lineState = state.lines[line];
  const requestedLayer = Math.floor(layerIndex);
  if (line === 'drill' && (!Number.isFinite(requestedLayer) || requestedLayer < 1)) {
    return { ok: false, message: '矿层编号无效。', events: [] };
  }
  if (line === 'drill' && requestedLayer > state.deepestLayer) {
    return { ok: false, message: '这一矿层还没有解锁。', events: [] };
  }
  const drillLayer = line === 'drill' ? ensureLayerState(state, requestedLayer) : null;
  const automated =
    line === 'drill'
      ? Boolean(drillLayer?.automated || state.adCrewSeconds > 0)
      : Boolean(lineState.automated || state.adCrewSeconds > 0);
  if (automated) {
    return {
      ok: false,
      message:
        state.adCrewSeconds > 0
          ? '临时工班正在代管这条生产线。'
          : line === 'drill'
            ? '这一层已经有工头自动值守。'
            : '这条生产线已经有监工值守。',
      events: [],
    };
  }

  const queued =
    line === 'drill'
      ? drillLayer?.queued ?? 0
      : lineState.queued;
  if (queued >= MAX_MANUAL_QUEUE) {
    return {
      ok: false,
      message: `这一层最多预排 ${MAX_MANUAL_QUEUE} 次，先让机器动起来。`,
      events: [],
    };
  }
  if (line === 'drill') {
    if (!drillLayer) return { ok: false, message: '矿层尚未准备就绪。', events: [] };
    drillLayer.queued += 1;
  } else {
    lineState.queued += 1;
  }
  state.stats.manualActions += 1;
  syncDrillMirror(state);

  if (line === 'drill') advanceTutorial(state, 0, 1);
  if (line === 'lift') advanceTutorial(state, 1, 2);
  if (line === 'truck') advanceTutorial(state, 2, 3);

  return {
    ok: true,
    message:
      line === 'drill'
        ? `第 ${requestedLayer} 层钻探班已排班。`
        : '任务已排入生产线。',
    events: [],
  };
}

export function queueLineToCapacity(
  state: GameState,
  line: LineId,
  layerIndex = state.currentLayer,
): ActionOutcome {
  ensureRuntimeState(state);
  const targetLayer = Math.floor(layerIndex);
  let added = 0;
  let lastMessage = '';

  while (true) {
    const queued =
      line === 'drill'
        ? state.layers[targetLayer]?.queued ?? 0
        : state.lines[line].queued;
    if (queued >= MAX_MANUAL_QUEUE) break;
    const outcome = queueLine(state, line, targetLayer);
    if (!outcome.ok) {
      lastMessage = outcome.message;
      break;
    }
    added += 1;
  }

  if (added === 0) {
    return {
      ok: false,
      message: lastMessage || '这条生产线最多只能预排 5 个班次。',
      events: [],
    };
  }

  return {
    ok: true,
    message:
      line === 'drill'
        ? `第 ${targetLayer} 层已补满到 ${MAX_MANUAL_QUEUE} 个钻探班次。`
        : `${LINE_LABELS[line]}已补满到 ${MAX_MANUAL_QUEUE} 个班次。`,
    events: [],
  };
}

export function buyLineUpgrade(state: GameState, line: LineId): ActionOutcome {
  ensureRuntimeState(state);
  const lineState = state.lines[line];
  const cost = getLineUpgradeCost(line, lineState.level);
  if (state.money + EPSILON < cost) {
    return { ok: false, message: `还差 ${formatMoney(cost - state.money)}。`, events: [] };
  }

  state.money -= cost;
  lineState.level += 1;
  state.stats.upgrades += 1;
  state.daily.upgrades += 1;
  if (line === 'drill') advanceTutorial(state, 3, 4);

  return {
    ok: true,
    message: `${LINE_LABELS[line]}设备升到 ${lineState.level} 级。`,
    events: [],
  };
}

export function buyRecommendedUpgrade(state: GameState): ActionOutcome {
  const line = getRecommendedUpgradeLine(state);
  return buyLineUpgrade(state, line);
}

export function buyAutomation(
  state: GameState,
  line: LineId,
  layerIndex = state.currentLayer,
): ActionOutcome {
  ensureRuntimeState(state);
  const targetLayer = Math.floor(layerIndex);
  if (
    line === 'drill' &&
    (!Number.isFinite(targetLayer) || targetLayer < 1 || targetLayer > state.deepestLayer)
  ) {
    return { ok: false, message: '这一矿层还没有解锁。', events: [] };
  }
  const lineState = state.lines[line];
  const layerState = ensureLayerState(
    state,
    line === 'drill' ? targetLayer : state.currentLayer,
  );
  const alreadyAutomated =
    line === 'drill' ? layerState.automated : lineState.automated;
  if (alreadyAutomated) {
    return { ok: false, message: '这条生产线已经有工头值守。', events: [] };
  }

  const cost = getAutomationCost(
    line,
    line === 'drill' ? targetLayer : state.currentLayer,
  );
  if (state.money + EPSILON < cost) {
    return { ok: false, message: `雇佣工头还差 ${formatMoney(cost - state.money)}。`, events: [] };
  }

  state.money -= cost;
  if (line === 'drill') {
    layerState.automated = true;
    layerState.queued = 0;
    lineState.automationLayer = targetLayer;
    syncDrillMirror(state);
  } else {
    lineState.automated = true;
    lineState.queued = 0;
  }
  const events: GameEvent[] = [];

  if (line === 'drill' && targetLayer === state.currentLayer) {
    advanceTutorial(state, 4, 5);
  }
  if (line === 'lift') advanceTutorial(state, 5, 6);
  if (line === 'truck' && !state.tutorialRewardClaimed && advanceTutorial(state, 6, 7)) {
    state.tutorialCompleted = true;
    state.tutorialRewardClaimed = true;
    state.goldenShiftSeconds = Math.max(state.goldenShiftSeconds, TUTORIAL_BOOST_SECONDS);
    events.push({ type: 'tutorial_completed', rewardSeconds: TUTORIAL_BOOST_SECONDS });
  }

  return {
    ok: true,
    message:
      line === 'drill'
        ? `第 ${targetLayer} 层监工已上岗。`
        : `${LINE_LABELS[line]}已由监工接管。`,
    events,
  };
}

export function buyLayerCrewUpgrade(
  state: GameState,
  layerIndex = state.currentLayer,
): ActionOutcome {
  ensureRuntimeState(state);
  const targetLayer = Math.floor(layerIndex);
  if (!Number.isFinite(targetLayer) || targetLayer < 1 || targetLayer > state.deepestLayer) {
    return { ok: false, message: '这一矿层还不能扩编。', events: [] };
  }
  const layer = ensureLayerState(state, targetLayer);
  if (layer.crewLevel >= 5) {
    return { ok: false, message: '本层矿工已经达到 5 人上限。', events: [] };
  }
  const cost = getLayerCrewUpgradeCost(state, targetLayer);
  if (state.money + EPSILON < cost) {
    return { ok: false, message: `本层扩编还差 ${formatMoney(cost - state.money)}。`, events: [] };
  }

  state.money -= cost;
  layer.crewLevel += 1;
  state.stats.upgrades += 1;
  state.daily.upgrades += 1;
  if (targetLayer === state.currentLayer) syncDrillMirror(state);

  return {
    ok: true,
    message: `第 ${targetLayer} 层扩编到 ${layer.crewLevel} 人。`,
    events: [],
  };
}

export function unlockNextLayer(state: GameState): ActionOutcome {
  ensureRuntimeState(state);
  if (state.deepestLayer >= MAX_LAYER) {
    return { ok: false, message: '已经到达当前版本的地心边界。', events: [] };
  }

  const next = state.deepestLayer + 1;
  const cost = getNextLayerCost(next);
  if (state.money + EPSILON < cost) {
    return { ok: false, message: `解锁矿层还差 ${formatMoney(cost - state.money)}。`, events: [] };
  }

  state.money -= cost;
  state.deepestLayer = next;
  state.currentLayer = next;
  ensureLayerState(state, next);
  syncDrillMirror(state);
  state.eventCountdown = Math.max(30, state.eventCountdown - 15);

  const events: GameEvent[] = [];
  if (next % 5 === 0) {
    state.richVeinSeconds = Math.max(state.richVeinSeconds, 20);
    events.push({ type: 'rich_vein_started', seconds: 20 });
  }

  return {
    ok: true,
    message: `已解锁 ${getLayerDefinition(next).name}。`,
    events,
  };
}

export function selectLayer(state: GameState, layerIndex: number): ActionOutcome {
  ensureRuntimeState(state);
  const target = Math.floor(layerIndex);
  if (!Number.isFinite(target) || target < 1) {
    return { ok: false, message: '矿层编号无效。', events: [] };
  }
  if (target > state.deepestLayer) {
    return {
      ok: false,
      message: `第 ${target} 层尚未解锁，先挖到那里。`,
      events: [],
    };
  }
  if (target === state.currentLayer) {
    return { ok: true, message: '已经在这一层。', events: [] };
  }

  state.currentLayer = target;
  ensureLayerState(state, target);
  syncDrillMirror(state);
  return {
    ok: true,
    message: `已切换到第 ${target} 层。`,
    events: [],
  };
}

export function hireManager(state: GameState, managerId: ManagerId): ActionOutcome {
  const manager = MANAGER_BY_ID[managerId];
  if (state.managers[managerId]) {
    return { ok: false, message: '这名工头已经在公司里。', events: [] };
  }
  if (state.deepestLayer < manager.unlockLayer) {
    return {
      ok: false,
      message: `深入第 ${manager.unlockLayer} 层后才能招募。`,
      events: [],
    };
  }
  if (state.money + EPSILON < manager.cost) {
    return { ok: false, message: `招募还差 ${formatMoney(manager.cost - state.money)}。`, events: [] };
  }

  state.money -= manager.cost;
  state.managers[managerId] = true;
  return { ok: true, message: `${manager.name}加入了公司。`, events: [] };
}

export function canClaimDailyReward(state: GameState): boolean {
  return (
    !state.daily.rewardClaimed &&
    state.daily.trips >= DAILY_GOALS.trips &&
    state.daily.upgrades >= DAILY_GOALS.upgrades &&
    state.daily.starts >= DAILY_GOALS.starts
  );
}

export function claimDailyReward(state: GameState): ActionOutcome {
  if (!canClaimDailyReward(state)) {
    return { ok: false, message: '今天的任务还没全部完成。', events: [] };
  }

  state.daily.rewardClaimed = true;
  state.goldenShiftSeconds = Math.max(
    state.goldenShiftSeconds,
    GOLDEN_SHIFT_SECONDS,
  );
  return {
    ok: true,
    message: '领取成功，公司进入 10 分钟黄金班次。',
    events: [],
  };
}

export function applyOnlineAdReward(state: GameState): ActionOutcome {
  if (state.adBoostSeconds >= AD_BOOST_RESERVE_SECONDS - EPSILON) {
    return { ok: false, message: '双倍收益储备已经接近上限。', events: [] };
  }

  state.adBoostSeconds = Math.min(
    AD_BOOST_RESERVE_SECONDS,
    state.adBoostSeconds + 15 * 60,
  );
  state.adCrewSeconds = Math.min(
    AD_CREW_RESERVE_SECONDS,
    state.adCrewSeconds + AD_CREW_SECONDS,
  );
  state.stats.adsWatched += 1;
  return {
    ok: true,
    message: '双倍收益和临时工班已各储备 15 分钟。',
    events: [],
  };
}

export function addOfflineAdBonus(state: GameState, baseEarnings: number): number {
  if (!Number.isFinite(baseEarnings) || baseEarnings <= 0) return 0;
  state.money = safeAdd(state.money, baseEarnings);
  state.lifetimeEarnings = safeAdd(state.lifetimeEarnings, baseEarnings);
  state.stats.adsWatched += 1;
  return baseEarnings;
}

export function getPrestigeAvailability(state: GameState): number {
  if (state.deepestLayer < getPrestigeLayerRequirement(state.prestigeCount)) {
    return 0;
  }
  return getPrestigeMarksForRun(state.deepestLayer);
}

export function performPrestige(state: GameState, now = Date.now()): ActionOutcome {
  const marks = getPrestigeMarksForRun(state.deepestLayer);
  const requiredLayer = getPrestigeLayerRequirement(state.prestigeCount);
  if (state.deepestLayer < requiredLayer || marks <= 0) {
    return {
      ok: false,
      message: `当前阶段至少挖到第 ${requiredLayer} 层才能二次创业。`,
      events: [],
    };
  }

  state.prestigeMarks += marks;
  state.prestigeCount += 1;
  state.money = 100 * marks;
  state.deepestLayer = 1;
  state.currentLayer = 1;
  state.underground = { units: 0, totalValue: 0 };
  state.surface = { units: 0, totalValue: 0 };
  state.layers = { 1: createLayerMiningState() };
  state.layerCargo = { 1: createLayerCargoState() };
  for (const line of LINE_IDS) {
    state.lines[line] = createLineState();
  }
  state.tutorialStep = 7;
  state.tutorialCompleted = true;
  state.adBoostSeconds = 0;
  state.adCrewSeconds = 0;
  state.goldenShiftSeconds = 0;
  state.richVeinSeconds = 0;
  state.eventCountdown = 180;
  state.lastSeenAt = now;

  return {
    ok: true,
    message: `二次创业完成，获得 ${marks} 枚永久纪念章。`,
    events: [],
  };
}

export function getMainBottleneck(state: GameState): LineId | null {
  return getBottleneckLine(state);
}

export const LINE_LABELS: Record<LineId, string> = {
  drill: '钻探',
  lift: '起吊',
  truck: '运输',
};
