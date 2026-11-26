import { describe, expect, it } from 'vitest';
import { getOfflineCapSeconds } from '../src/core/economy';
import { createNewGame } from '../src/core/engine';
import { calculateOfflineProgress } from '../src/core/offline';

describe('offline progression', () => {
  it('produces earnings only after all production inputs can flow automatically', () => {
    const now = 1_700_000_000_000;
    const state = createNewGame(now);
    state.lastSeenAt = now - 60 * 60 * 1000;

    const report = calculateOfflineProgress(state, now);
    expect(report.baseEarnings).toBe(0);
  });

  it('simulates automated lines and caps the report duration', () => {
    const now = 1_700_000_000_000;
    const state = createNewGame(now);
    state.lines.drill.automated = true;
    state.lines.lift.automated = true;
    state.lines.truck.automated = true;
    state.lastSeenAt = now - 48 * 60 * 60 * 1000;

    const report = calculateOfflineProgress(state, now);
    expect(report.baseEarnings).toBeGreaterThan(0);
    expect(report.trips).toBeGreaterThan(0);
    expect(report.creditedSeconds).toBe(getOfflineCapSeconds(state));
    expect(report.capped).toBe(true);
  });

  it('does not apply online-only boosts to offline earnings', () => {
    const now = 1_700_000_000_000;
    const state = createNewGame(now);
    for (const line of ['drill', 'lift', 'truck'] as const) {
      state.lines[line].automated = true;
    }
    state.lastSeenAt = now - 60 * 60 * 1000;
    const baseline = calculateOfflineProgress(state, now);

    state.adBoostSeconds = 15 * 60;
    state.goldenShiftSeconds = 10 * 60;
    state.richVeinSeconds = 20;
    const boosted = calculateOfflineProgress(state, now);

    expect(boosted.baseEarnings).toBeCloseTo(baseline.baseEarnings, 8);
    expect(boosted.state.adBoostSeconds).toBe(15 * 60);
    expect(boosted.state.goldenShiftSeconds).toBe(10 * 60);
    expect(boosted.state.richVeinSeconds).toBe(20);
  });

  it('returns interrupted in-flight cargo to its source when going offline', () => {
    const now = 1_700_000_000_000;
    const state = createNewGame(now);
    state.lines.lift.active = true;
    state.lines.lift.progress = 0.5;
    state.lines.lift.payload = { units: 2, totalValue: 10 };
    state.lines.lift.payloadLayer = 2;
    state.lines.lift.tripDuration = 2;
    state.underground = { units: 1, totalValue: 5 };
    state.lastSeenAt = now - 60_000;

    const report = calculateOfflineProgress(state, now);

    expect(report.state.lines.lift.active).toBe(false);
    expect(report.state.lines.lift.payload.units).toBe(0);
    expect(report.state.underground.units).toBeCloseTo(3, 8);
    expect(report.state.underground.totalValue).toBeCloseTo(15, 8);
  });

  it('clears temporary ad crews and does not let them generate offline income', () => {
    const now = 1_700_000_000_000;
    const state = createNewGame(now);
    state.adCrewSeconds = 10 * 60;
    state.lastSeenAt = now - 60 * 60 * 1000;

    const report = calculateOfflineProgress(state, now);

    expect(report.baseEarnings).toBe(0);
    expect(report.state.lines.drill.automated).toBe(false);
    expect(report.state.adCrewSeconds).toBe(10 * 60);
  });
});
