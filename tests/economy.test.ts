import { describe, expect, it } from 'vitest';
import {
  MAX_LAYER_CREW,
  getAutomationCost,
  getDrillCapacityAtLayer,
  getLayerCrewUpgradeCost,
  getLineCapacity,
  getLineDuration,
  getLineTripDuration,
  getNextLayerCost,
  getPrestigeRunMultiplier,
  getPrestigeLayerRequirement,
} from '../src/core/economy';
import { createNewGame } from '../src/core/engine';
import { getLayerDefinition } from '../src/core/layers';

describe('progression economy', () => {
  it('keeps early layers fast but makes each unlock require meaningful output', () => {
    expect(getNextLayerCost(2)).toBeGreaterThanOrEqual(130);
    expect(getNextLayerCost(3)).toBeGreaterThan(getNextLayerCost(2));
    expect(getNextLayerCost(10)).toBeGreaterThan(getNextLayerCost(5) * 4);
    const earlyTrips = getNextLayerCost(2) / getLayerDefinition(2).baseValue;
    const midTrips = getNextLayerCost(10) / getLayerDefinition(10).baseValue;
    expect(midTrips).toBeGreaterThan(earlyTrips * 2.5);
  });

  it('gives deeper minerals a stronger sale price without hiding the depth slowdown', () => {
    const first = getLayerDefinition(1);
    const fourth = getLayerDefinition(4);
    const fifth = getLayerDefinition(5);
    const tenth = getLayerDefinition(10);

    expect(tenth.baseValue).toBeGreaterThan(first.baseValue * 20);
    expect(fifth.baseValue / fourth.baseValue).toBeCloseTo(2, 5);
    expect(tenth.baseMiningSeconds).toBeGreaterThan(first.baseMiningSeconds);
  });

  it('upgrades each layer from one to five miners with rising output and cost', () => {
    const state = createNewGame(1_700_000_000_000);
    const baseCapacity = getDrillCapacityAtLayer(state, 1);
    const firstCrewCost = getLayerCrewUpgradeCost(state, 1);
    const deepCrewCost = getLayerCrewUpgradeCost(state, 10);

    state.layers[1].crewLevel = MAX_LAYER_CREW;

    expect(getDrillCapacityAtLayer(state, 1)).toBeGreaterThan(baseCapacity * 2);
    expect(firstCrewCost).toBeGreaterThan(0);
    expect(deepCrewCost).toBeGreaterThan(firstCrewCost * 20);
    expect(getLayerCrewUpgradeCost(state, 1)).toBe(0);
  });

  it('prices each crew expansion from that layer value and its current staffing', () => {
    const state = createNewGame(1_700_000_000_000);
    state.layers[5] = {
      ...state.layers[1],
      crewLevel: 1,
    };
    const first = getLayerCrewUpgradeCost(state, 5);
    state.layers[5].crewLevel = 2;
    const second = getLayerCrewUpgradeCost(state, 5);

    expect(first).toBeGreaterThanOrEqual(
      Math.ceil(getLayerDefinition(5).baseValue * 10),
    );
    expect(second).toBeGreaterThan(first * 2);
  });

  it('adds a small permanent run bonus after repeated restarts', () => {
    const state = createNewGame(1_700_000_000_000);

    expect(getPrestigeRunMultiplier(state)).toBe(1);
    state.prestigeCount = 2;
    expect(getPrestigeRunMultiplier(state)).toBeGreaterThan(1);
  });

  it('raises the rebirth development gate after every restart', () => {
    expect(getPrestigeLayerRequirement(0)).toBe(20);
    expect(getPrestigeLayerRequirement(1)).toBe(30);
    expect(getPrestigeLayerRequirement(4)).toBe(60);
  });

  it('turns permanent automation into a long-term goal', () => {
    expect(getAutomationCost('lift')).toBeGreaterThan(300);
    expect(getAutomationCost('truck')).toBeGreaterThan(getAutomationCost('lift') * 2);
    expect(getAutomationCost('drill', 1)).toBeLessThan(getAutomationCost('lift'));
    expect(getAutomationCost('drill', 10)).toBeGreaterThan(
      getAutomationCost('drill', 5) * 3,
    );
  });

  it('makes cargo weight reduce speed proportionally', () => {
    const state = createNewGame(1_700_000_000_000);
    const capacity = getLineCapacity(state, 'lift');
    const light = getLineTripDuration(state, 'lift', capacity * 0.35, 1);
    const full = getLineTripDuration(state, 'lift', capacity, 1);

    expect(full).toBeGreaterThan(light);
    expect(full).toBeGreaterThan(getLineDuration(state, 'lift') * 1.3);
    expect(full).toBeLessThan(light * 1.3);
  });

  it('keeps transport animations readable at very high equipment levels', () => {
    const state = createNewGame(1_700_000_000_000);
    state.lines.drill.level = 50;
    state.lines.lift.level = 50;
    state.lines.truck.level = 50;

    expect(getLineDuration(state, 'drill')).toBeGreaterThanOrEqual(0.82);
    expect(getLineDuration(state, 'lift')).toBeGreaterThanOrEqual(1.6);
    expect(getLineDuration(state, 'truck')).toBeGreaterThanOrEqual(2.1);
  });

  it('adds time for every lift stop across unlocked layers', () => {
    const state = createNewGame(1_700_000_000_000);
    const threeStops = getLineTripDuration(state, 'lift', 1, 3, 3);
    const eightStops = getLineTripDuration(state, 'lift', 1, 8, 8);

    expect(eightStops).toBeGreaterThan(threeStops);
  });
});
