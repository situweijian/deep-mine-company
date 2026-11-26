import { describe, expect, it } from 'vitest';
import {
  advanceGame,
  buyAutomation,
  buyLayerCrewUpgrade,
  buyLineUpgrade,
  createNewGame,
  unlockNextLayer,
} from '../src/core/engine';
import {
  getAutomationCost,
  getLayerCrewUpgradeCost,
  getLineUpgradeCost,
  getNextLayerCost,
  getRecommendedUpgradeLine,
} from '../src/core/economy';

function simulateAutomatedProgress(maxSeconds: number): Map<number, number> {
  const state = createNewGame(1_700_000_000_000);
  state.lines.lift.automated = true;
  state.lines.truck.automated = true;
  state.layers[1].automated = true;
  const reached = new Map<number, number>([[1, 0]]);
  const step = 0.5;

  for (let elapsed = step; elapsed <= maxSeconds; elapsed += step) {
    advanceGame(state, step, { visibleLayerCount: 8 });

    if (!state.layers[state.currentLayer]?.automated) {
      const cost = getAutomationCost('drill', state.currentLayer);
      if (state.money >= cost * 1.35) buyAutomation(state, 'drill');
    }

    const unlockCost = getNextLayerCost(state.deepestLayer + 1);
    if (state.money >= unlockCost) {
      const outcome = unlockNextLayer(state);
      if (outcome.ok) reached.set(state.deepestLayer, elapsed);
    } else {
      const crewCost = getLayerCrewUpgradeCost(state, state.currentLayer);
      if (
        crewCost > 0 &&
        state.money >= crewCost &&
        state.money >= unlockCost * 0.22
      ) {
        buyLayerCrewUpgrade(state, state.currentLayer);
      } else {
        const line = getRecommendedUpgradeLine(state);
        const upgradeCost = getLineUpgradeCost(line, state.lines[line].level);
        if (
          state.money >= upgradeCost &&
          state.money >= unlockCost * 0.14
        ) {
          buyLineUpgrade(state, line);
        }
      }
    }
  }

  return reached;
}

describe('long-run pacing', () => {
  it('keeps early momentum while deeper unlocks require several investment cycles', () => {
    const reached = simulateAutomatedProgress(3 * 60 * 60);

    expect(reached.get(5) ?? Infinity).toBeLessThan(20 * 60);
    expect(reached.get(10) ?? Infinity).toBeGreaterThan(10 * 60);
    expect(reached.get(10) ?? Infinity).toBeLessThan(90 * 60);
    expect(reached.get(15) ?? Infinity).toBeGreaterThan(
      (reached.get(10) ?? 0) * 1.2,
    );
    expect(reached.get(20) ?? Infinity).toBeGreaterThan(60 * 60);
    expect(reached.get(20) ?? Infinity).toBeLessThan(2.2 * 60 * 60);
  });
});
