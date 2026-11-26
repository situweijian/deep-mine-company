import { describe, expect, it } from 'vitest';
import {
  COMPACT_VISIBLE_LAYERS,
  DESKTOP_VISIBLE_LAYERS,
  getResponsiveLayerCount,
  getVisibleLayerWindow,
} from '../src/core/layer-window';

describe('visible layer window', () => {
  it('uses eight desktop layers and five compact layers', () => {
    expect(getResponsiveLayerCount(1920)).toBe(DESKTOP_VISIBLE_LAYERS);
    expect(getResponsiveLayerCount(1366)).toBe(DESKTOP_VISIBLE_LAYERS);
    expect(getResponsiveLayerCount(844)).toBe(COMPACT_VISIBLE_LAYERS);
    expect(getResponsiveLayerCount(390)).toBe(COMPACT_VISIBLE_LAYERS);
  });

  it('keeps early locked layers visible as the next goal', () => {
    expect(getVisibleLayerWindow(1, 1, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('centers an old viewed layer without losing the visible route', () => {
    expect(getVisibleLayerWindow(5, 20, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(getVisibleLayerWindow(9, 20, 8)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('aligns the window to the deepest layers near the mine face', () => {
    expect(getVisibleLayerWindow(15, 15, 8)).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17,
    ]);
    expect(getVisibleLayerWindow(14, 15, 8)).toEqual([
      9, 10, 11, 12, 13, 14, 15, 16,
    ]);
  });
});
