const CHINESE_UNITS = [
  { value: 1e16, suffix: '京' },
  { value: 1e12, suffix: '兆' },
  { value: 1e8, suffix: '亿' },
  { value: 1e4, suffix: '万' },
];

function trimDecimal(value: number): string {
  if (!Number.isFinite(value)) return '∞';
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1).replace(/\.0$/, '');
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatCompact(value: number, withSign = false): string {
  if (!Number.isFinite(value)) return '∞';
  const sign = value < 0 ? '-' : withSign ? '+' : '';
  const absolute = Math.abs(value);

  if (absolute >= 1e20) {
    return `${sign}${absolute.toExponential(2).replace('e+', 'e')}`;
  }

  for (const unit of CHINESE_UNITS) {
    if (absolute >= unit.value) {
      return `${sign}${trimDecimal(absolute / unit.value)}${unit.suffix}`;
    }
  }

  if (absolute >= 1000) {
    return `${sign}${Math.floor(absolute).toLocaleString('zh-CN')}`;
  }

  return `${sign}${trimDecimal(absolute)}`;
}

export function formatMoney(value: number): string {
  return `¥${formatCompact(value)}`;
}

export function formatRate(value: number): string {
  return `${formatMoney(value)}/秒`;
}

export function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  if (safeSeconds < 60) return `${safeSeconds} 秒`;
  const minutes = Math.floor(safeSeconds / 60);
  if (minutes < 60) return `${minutes} 分 ${safeSeconds % 60} 秒`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分`;
}

export function formatPercent(value: number): string {
  const percent = Math.round((value - 1) * 100);
  return `${percent >= 0 ? '+' : ''}${percent}%`;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
