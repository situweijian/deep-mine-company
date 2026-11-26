import { describe, expect, it } from 'vitest';
import { formatCompact, formatDuration } from '../src/core/format';

describe('formatting', () => {
  it('uses readable Chinese units for large currency', () => {
    expect(formatCompact(12_345)).toBe('1.23万');
    expect(formatCompact(150_000_000)).toBe('1.5亿');
  });

  it('formats short and long durations', () => {
    expect(formatDuration(42)).toBe('42 秒');
    expect(formatDuration(125)).toBe('2 分 5 秒');
  });
});
