import { describe, expect, it } from 'vitest';
import {
  advanceGame,
  applyOnlineAdReward,
  buyAutomation,
  buyLayerCrewUpgrade,
  buyLineUpgrade,
  createNewGame,
  getPrestigeAvailability,
  hireManager,
  performPrestige,
  queueLine,
  queueLineToCapacity,
  selectLayer,
  unlockNextLayer,
} from '../src/core/engine';
import {
  AD_BOOST_RESERVE_SECONDS,
  getEstimatedRevenuePerSecond,
  getPrestigeLayerRequirement,
  getLineCapacity,
  getLineDuration,
  getLineTripDuration,
  getLineUpgradeCost,
  getNextLayerCost,
  getSaleMultiplier,
} from '../src/core/economy';
import { getLayerDefinition } from '../src/core/layers';

describe('production pipeline', () => {
  it('moves one manual load through mining, lifting and sale', () => {
    const state = createNewGame(1_700_000_000_000);
    expect(queueLine(state, 'drill').ok).toBe(true);
    advanceGame(state, getLineDuration(state, 'drill') + 0.01);
    expect(state.underground.units).toBeCloseTo(getLineCapacity(state, 'drill'), 8);
    expect(state.layerCargo[1].underground.units).toBeCloseTo(
      getLineCapacity(state, 'drill'),
      8,
    );

    expect(queueLine(state, 'lift').ok).toBe(true);
    advanceGame(state, 0.01);
    advanceGame(state, state.lines.lift.tripDuration + 0.01);
    expect(state.surface.units).toBeGreaterThan(0);

    expect(queueLine(state, 'truck').ok).toBe(true);
    const before = state.money;
    advanceGame(state, 0.01);
    advanceGame(state, state.lines.truck.tripDuration + 0.01);
    expect(state.money).toBeGreaterThan(before);
    expect(state.stats.totalTrips).toBe(1);
  });

  it('keeps all automated lines producing without further clicks', () => {
    const state = createNewGame(1_700_000_000_000);
    state.lines.drill.automated = true;
    state.lines.lift.automated = true;
    state.lines.truck.automated = true;

    advanceGame(state, 60);

    expect(state.money).toBeGreaterThan(0);
    expect(state.stats.totalTrips).toBeGreaterThan(1);
    expect(getEstimatedRevenuePerSecond(state)).toBeGreaterThan(0);
  });

  it('keeps automated upper layers producing after a lower layer unlocks', () => {
    const state = createNewGame(1_700_000_000_000);
    state.money = 10_000;

    expect(buyAutomation(state, 'drill').ok).toBe(true);
    expect(unlockNextLayer(state).ok).toBe(true);
    expect(state.currentLayer).toBe(2);
    expect(state.layers[1].automated).toBe(true);
    expect(state.layers[2].automated).toBe(false);

    advanceGame(state, getLineDuration(state, 'drill', 1) * 2.2);

    expect(state.layers[1].progress).toBeGreaterThan(0);
    expect(state.layerCargo[1].underground.units).toBeGreaterThan(0);
    expect(state.layerCargo[2].underground.units).toBe(0);
  });

  it('gives every unlocked layer its own cargo pile and automation state', () => {
    const state = createNewGame(1_700_000_000_000);
    state.money = 10_000;

    expect(buyAutomation(state, 'drill').ok).toBe(true);
    expect(unlockNextLayer(state).ok).toBe(true);
    queueLine(state, 'drill');
    advanceGame(state, getLineDuration(state, 'drill', 2) + 0.01);
    expect(buyAutomation(state, 'drill').ok).toBe(true);

    advanceGame(state, getLineDuration(state, 'drill', 2) * 1.2);

    expect(state.layers[1].automated).toBe(true);
    expect(state.layers[2].automated).toBe(true);
    expect(state.layerCargo[1].underground.units).toBeGreaterThan(0);
    expect(state.layerCargo[2].underground.units).toBeGreaterThan(0);
    expect(state.underground.units).toBeCloseTo(
      state.layerCargo[1].underground.units + state.layerCargo[2].underground.units,
      8,
    );
  });

  it('does not let a manual line repeat without another click', () => {
    const state = createNewGame(1_700_000_000_000);
    queueLine(state, 'drill');
    advanceGame(state, getLineDuration(state, 'drill') * 6);

    expect(state.underground.units).toBeLessThan(1.5);
    expect(state.lines.drill.queued).toBe(0);
  });

  it('accepts at most five manual trips and rejects the sixth request', () => {
    const state = createNewGame(1_700_000_000_000);

    for (let trip = 0; trip < 5; trip += 1) {
      expect(queueLine(state, 'drill').ok).toBe(true);
    }
    const sixth = queueLine(state, 'drill');

    expect(sixth.ok).toBe(false);
    expect(sixth.message).toContain('5');
    expect(state.lines.drill.queued).toBe(5);
  });

  it('fills the visible five-trip queue with one action', () => {
    const state = createNewGame(1_700_000_000_000);

    expect(queueLineToCapacity(state, 'lift').ok).toBe(true);
    expect(queueLineToCapacity(state, 'truck').ok).toBe(true);
    expect(queueLineToCapacity(state, 'drill').ok).toBe(true);

    expect(state.lines.drill.queued).toBe(5);
    expect(state.lines.lift.queued).toBe(5);
    expect(state.lines.truck.queued).toBe(5);
  });

  it('reserves five pickup shifts before cargo arrives and waits without losing queues', () => {
    const state = createNewGame(1_700_000_000_000);

    for (let trip = 0; trip < 5; trip += 1) {
      expect(queueLine(state, 'lift').ok).toBe(true);
      expect(queueLine(state, 'truck').ok).toBe(true);
    }

    advanceGame(state, 12);

    expect(state.lines.lift.queued).toBe(5);
    expect(state.lines.truck.queued).toBe(5);
    expect(state.lines.lift.active).toBe(false);
    expect(state.lines.truck.active).toBe(false);
    expect(state.underground.units).toBe(0);
    expect(state.surface.units).toBe(0);
  });

  it('keeps cargo in the mine while an automated lift waits empty', () => {
    const state = createNewGame(1_700_000_000_000);
    state.lines.lift.automated = true;
    state.underground = { units: 2.5, totalValue: 10 };

    advanceGame(state, getLineDuration(state, 'lift') * 0.25);
    expect(state.lines.lift.active).toBe(true);
    expect(state.lines.lift.payload.units).toBeGreaterThan(0);

    const inFlight = state.lines.lift.payload.units;
    expect(inFlight).toBeGreaterThan(0);
    expect(state.surface.units).toBe(0);
    expect(state.underground.units + inFlight).toBeCloseTo(2.5, 8);
  });

  it('reports which layer supplied a completed lift', () => {
    const state = createNewGame(1_700_000_000_000);
    state.layerCargo[1].underground = { units: 1, totalValue: 4 };

    expect(queueLine(state, 'lift').ok).toBe(true);
    advanceGame(state, 0.01);
    const events = advanceGame(state, state.lines.lift.tripDuration + 0.01);
    const liftEvent = events.find((event) => event.type === 'lift_completed');

    expect(liftEvent).toMatchObject({
      type: 'lift_completed',
      units: 1,
      layer: 1,
    });
  });

  it('sends the lift to the deepest unlocked layer and collects upward until capacity', () => {
    const state = createNewGame(1_700_000_000_000);
    state.deepestLayer = 3;
    state.currentLayer = 3;
    state.layers[2] = { ...state.layers[1] };
    state.layers[3] = { ...state.layers[1] };
    state.layerCargo[1] = {
      underground: { units: 0.7, totalValue: 3.5 },
      surface: { units: 0, totalValue: 0 },
    };
    state.layerCargo[2] = {
      underground: { units: 0.7, totalValue: 5.2 },
      surface: { units: 0, totalValue: 0 },
    };
    state.layerCargo[3] = {
      underground: { units: 0.7, totalValue: 7.4 },
      surface: { units: 0, totalValue: 0 },
    };

    expect(queueLine(state, 'lift').ok).toBe(true);
    advanceGame(state, 0.01);

    expect(state.lines.lift.payloadLayer).toBe(3);
    expect(state.lines.lift.payloadLayers).toEqual([3, 2]);
    expect(state.lines.lift.payload.units).toBeCloseTo(
      getLineCapacity(state, 'lift'),
      8,
    );
    expect(state.layerCargo[1].underground.units).toBeCloseTo(0.7, 8);
  });

  it('still sends the lift to the deepest unlocked layer when cargo is only above', () => {
    const state = createNewGame(1_700_000_000_000);
    state.deepestLayer = 3;
    state.currentLayer = 3;
    state.layers[2] = { ...state.layers[1] };
    state.layers[3] = { ...state.layers[1] };
    state.layerCargo[2] = {
      underground: { units: 0, totalValue: 0 },
      surface: { units: 0, totalValue: 0 },
    };
    state.layerCargo[3] = {
      underground: { units: 0, totalValue: 0 },
      surface: { units: 0, totalValue: 0 },
    };
    state.layerCargo[2].underground = { units: 1, totalValue: 7.4 };

    expect(queueLine(state, 'lift').ok).toBe(true);
    advanceGame(state, 0.01);

    expect(state.lines.lift.payloadLayer).toBe(3);
    expect(state.lines.lift.payloadLayers).toEqual([2]);
    expect(state.lines.lift.payload.units).toBeCloseTo(1, 8);
  });

  it('locks payload, layer and trip duration when a trip starts', () => {
    const state = createNewGame(1_700_000_000_000);
    state.underground = { units: 3, totalValue: 12 };
    queueLine(state, 'lift');
    advanceGame(state, 0.01);

    const payload = state.lines.lift.payload.units;
    const lockedDuration = state.lines.lift.tripDuration;
    const lockedLayer = state.lines.lift.payloadLayer;
    state.lines.lift.level = 9;
    state.currentLayer = 8;

    expect(payload).toBeGreaterThan(0);
    expect(state.lines.lift.tripDuration).toBe(lockedDuration);
    expect(state.lines.lift.payloadLayer).toBe(lockedLayer);
  });

  it('makes a full load slower without making an equipment upgrade reduce throughput', () => {
    const state = createNewGame(1_700_000_000_000);
    const emptyDuration = getLineDuration(state, 'truck');
    const fullDuration = getLineTripDuration(
      state,
      'truck',
      getLineCapacity(state, 'truck'),
      state.currentLayer,
    );
    const throughputBefore = getLineCapacity(state, 'truck') / fullDuration;

    state.lines.truck.level += 1;
    const nextFullDuration = getLineTripDuration(
      state,
      'truck',
      getLineCapacity(state, 'truck'),
      state.currentLayer,
    );
    const throughputAfter = getLineCapacity(state, 'truck') / nextFullDuration;

    expect(fullDuration).toBeGreaterThan(emptyDuration);
    expect(throughputAfter).toBeGreaterThan(throughputBefore);
  });

  it('keeps an automated line waiting forever when no source cargo arrives', () => {
    const state = createNewGame(1_700_000_000_000);
    state.lines.truck.automated = true;

    advanceGame(state, 60);

    expect(state.lines.truck.active).toBe(false);
    expect(state.lines.truck.queued).toBe(0);
    expect(state.surface.units).toBe(0);
  });

  it('switches the selected layer without resetting the other layers', () => {
    const state = createNewGame(1_700_000_000_000);
    state.money = 10_000;
    expect(buyAutomation(state, 'drill').ok).toBe(true);
    expect(unlockNextLayer(state).ok).toBe(true);
    queueLine(state, 'drill');
    expect(selectLayer(state, 1).ok).toBe(true);

    const upperBefore = {
      progress: state.layers[1].progress,
      automated: state.layers[1].automated,
      underground: state.layerCargo[1].underground.units,
    };
    advanceGame(state, getLineDuration(state, 'drill') * 1.2);
    expect(selectLayer(state, 2).ok).toBe(true);

    expect(state.currentLayer).toBe(2);
    expect(state.layers[1].progress).toBeGreaterThan(upperBefore.progress);
    expect(state.layers[1].automated).toBe(upperBefore.automated);
    expect(state.layerCargo[1].underground.units).toBeGreaterThan(upperBefore.underground);
    expect(state.lines.drill.progress).toBe(state.layers[2].progress);
  });

  it('rejects selecting a locked layer', () => {
    const state = createNewGame(1_700_000_000_000);

    const outcome = selectLayer(state, 2);

    expect(outcome.ok).toBe(false);
    expect(state.currentLayer).toBe(1);
  });
});

describe('economy actions', () => {
  it('buys equipment upgrades and increases capacity or speed', () => {
    const state = createNewGame(1_700_000_000_000);
    const cost = getLineUpgradeCost('drill', 1);
    state.money = cost;
    const beforeDuration = getLineDuration(state, 'drill');

    expect(buyLineUpgrade(state, 'drill').ok).toBe(true);
    expect(state.money).toBe(0);
    expect(state.lines.drill.level).toBe(2);
    expect(getLineDuration(state, 'drill')).toBeLessThan(beforeDuration);
  });

  it('unlocks a richer layer with the same equipment', () => {
    const state = createNewGame(1_700_000_000_000);
    state.money = getNextLayerCost(2);
    const layerOneValue = getLayerDefinition(1).baseValue;
    const layerTwoValue = getLayerDefinition(2).baseValue;

    expect(unlockNextLayer(state).ok).toBe(true);
    expect(state.currentLayer).toBe(2);
    expect(layerTwoValue).toBeGreaterThan(layerOneValue);
  });

  it('buys a layer crew upgrade without changing other layers', () => {
    const state = createNewGame(1_700_000_000_000);
    state.money = 10_000;
    state.deepestLayer = 2;
    state.currentLayer = 2;
    state.layers[2] = {
      progress: 0,
      active: false,
      automated: false,
      crewLevel: 1,
      queued: 0,
      payload: { units: 0, totalValue: 0 },
      payloadLayer: 0,
      tripDuration: 0,
    };

    expect(buyLayerCrewUpgrade(state, 2).ok).toBe(true);
    expect(state.layers[2].crewLevel).toBe(2);
    expect(state.layers[1].crewLevel).toBe(1);
  });

  it('automates a line and prevents duplicate automation purchases', () => {
    const state = createNewGame(1_700_000_000_000);
    state.money = 10_000;
    expect(buyAutomation(state, 'drill').ok).toBe(true);
    expect(state.lines.drill.automated).toBe(true);
    expect(state.lines.drill.automationLayer).toBe(state.currentLayer);
    expect(buyAutomation(state, 'drill').ok).toBe(false);
  });

  it('requires each new layer to complete manual drilling before automation', () => {
    const state = createNewGame(1_700_000_000_000);
    state.money = 10_000;
    expect(buyAutomation(state, 'drill').ok).toBe(true);
    expect(state.lines.drill.automationLayer).toBe(1);

    expect(unlockNextLayer(state).ok).toBe(true);
    expect(state.currentLayer).toBe(2);
    expect(state.lines.drill.automated).toBe(false);
    expect(state.lines.drill.automationLayer).toBe(0);

    queueLine(state, 'drill');
    advanceGame(state, getLineDuration(state, 'drill') + 0.01);
    expect(state.lines.drill.queued).toBe(0);
    expect(buyAutomation(state, 'drill').ok).toBe(true);
    expect(state.lines.drill.automationLayer).toBe(2);
  });

  it('can hire a supervisor directly for an older layer', () => {
    const state = createNewGame(1_700_000_000_000);
    state.money = 10_000;
    state.deepestLayer = 2;
    state.currentLayer = 2;
    state.layers[2] = { ...state.layers[1] };

    expect(buyAutomation(state, 'drill', 1).ok).toBe(true);
    expect(state.layers[1].automated).toBe(true);
    expect(state.layers[2].automated).toBe(false);
    expect(state.lines.drill.automated).toBe(false);
  });

  it('does not grant the tutorial boost again when replaying the tutorial', () => {
    const state = createNewGame(1_700_000_000_000);
    state.money = 10_000;
    state.tutorialStep = 6;
    state.tutorialRewardClaimed = true;
    state.goldenShiftSeconds = 0;

    const outcome = buyAutomation(state, 'truck');

    expect(outcome.ok).toBe(true);
    expect(state.goldenShiftSeconds).toBe(0);
    expect(outcome.events).toHaveLength(0);
  });

  it('unlocks managers at their intended layer', () => {
    const state = createNewGame(1_700_000_000_000);
    state.money = 1_000_000;
    expect(hireManager(state, 'a-zuan').ok).toBe(false);
    state.deepestLayer = 3;
    state.currentLayer = 3;
    expect(hireManager(state, 'a-zuan').ok).toBe(true);
    expect(getSaleMultiplier(state)).toBeGreaterThanOrEqual(1);
  });

  it('blocks repeated rebirth farming until the next development gate', () => {
    const state = createNewGame(1_700_000_000_000);
    state.deepestLayer = 20;
    state.currentLayer = 20;
    state.prestigeCount = 1;

    expect(getPrestigeAvailability(state)).toBe(0);
    expect(performPrestige(state).ok).toBe(false);

    state.deepestLayer = getPrestigeLayerRequirement(1);
    expect(getPrestigeAvailability(state)).toBeGreaterThan(0);
    expect(performPrestige(state).ok).toBe(true);
  });
});

describe('ads', () => {
  it('reserves double output and a temporary crew shift without exceeding the cap', () => {
    const state = createNewGame(1_700_000_000_000);
    expect(applyOnlineAdReward(state).ok).toBe(true);
    expect(state.adBoostSeconds).toBe(15 * 60);
    expect(state.adCrewSeconds).toBeGreaterThan(0);
    expect(applyOnlineAdReward(state).ok).toBe(true);
    expect(state.adBoostSeconds).toBe(AD_BOOST_RESERVE_SECONDS);
    expect(applyOnlineAdReward(state).ok).toBe(false);
    expect(state.adBoostSeconds).toBe(AD_BOOST_RESERVE_SECONDS);
  });

  it('lets a temporary crew shift run the full pipeline without permanent automation', () => {
    const state = createNewGame(1_700_000_000_000);
    applyOnlineAdReward(state);

    advanceGame(state, 20);

    expect(state.lines.drill.automated).toBe(false);
    expect(state.lines.lift.automated).toBe(false);
    expect(state.lines.truck.automated).toBe(false);
    expect(state.stats.totalTrips).toBeGreaterThan(0);
    expect(state.money).toBeGreaterThan(0);
  });

  it('rejects duplicate manual queues while an ad crew is in control', () => {
    const state = createNewGame(1_700_000_000_000);
    applyOnlineAdReward(state);

    const outcome = queueLine(state, 'drill');

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('临时工班');
  });
});
