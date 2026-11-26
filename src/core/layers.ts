import type { LayerDefinition, Rarity } from './types';

interface AuthoredLayer {
  name: string;
  color: string;
  accent: string;
  rarity: Rarity;
}

const AUTHORED_LAYERS: AuthoredLayer[] = [
  { name: '褐煤', color: '#6e5238', accent: '#c49562', rarity: '普通' },
  { name: '赤铜', color: '#8a4d32', accent: '#e58d5e', rarity: '普通' },
  { name: '青锡', color: '#526d69', accent: '#8ec7b7', rarity: '普通' },
  { name: '磁铁', color: '#555a61', accent: '#a9b6c6', rarity: '普通' },
  { name: '银脉', color: '#7d8587', accent: '#ecf0de', rarity: '稀有' },
  { name: '蓝铜', color: '#326c73', accent: '#64d4c5', rarity: '普通' },
  { name: '紫水晶', color: '#654474', accent: '#c693dc', rarity: '稀有' },
  { name: '赤金', color: '#9b632e', accent: '#ffc45d', rarity: '稀有' },
  { name: '翡翠', color: '#37684c', accent: '#73d792', rarity: '稀有' },
  { name: '铂金', color: '#788b91', accent: '#d8f1ee', rarity: '史诗' },
  { name: '深海盐晶', color: '#326a82', accent: '#82d9ef', rarity: '普通' },
  { name: '电石', color: '#58644f', accent: '#d2ef6e', rarity: '稀有' },
  { name: '黑曜', color: '#39333f', accent: '#ad90c8', rarity: '稀有' },
  { name: '星铁', color: '#435b70', accent: '#8dc7ed', rarity: '史诗' },
  { name: '秘银', color: '#526f74', accent: '#b8fff1', rarity: '史诗' },
  { name: '日曜石', color: '#9b5b2e', accent: '#ffd36b', rarity: '史诗' },
  { name: '赤焰晶', color: '#8f3f36', accent: '#ff8066', rarity: '史诗' },
  { name: '月长石', color: '#4f6180', accent: '#b5d1ff', rarity: '史诗' },
  { name: '苍穹玉', color: '#2d6670', accent: '#67e1d4', rarity: '传说' },
  { name: '琥珀金', color: '#96652d', accent: '#ffd66f', rarity: '传说' },
  { name: '星尘', color: '#4e5975', accent: '#d8ccff', rarity: '传说' },
  { name: '极光晶', color: '#2f6a63', accent: '#81ffd8', rarity: '传说' },
  { name: '虚空盐', color: '#493e5e', accent: '#c4a6ff', rarity: '传说' },
  { name: '龙息矿', color: '#7c3f35', accent: '#ff9b58', rarity: '传说' },
  { name: '银河砂', color: '#485779', accent: '#b4c9ff', rarity: '神话' },
  { name: '地核铁', color: '#704138', accent: '#ff9b6c', rarity: '神话' },
  { name: '熔心晶', color: '#8b392e', accent: '#ff7157', rarity: '神话' },
  { name: '时间砂', color: '#5f526d', accent: '#e4c4ff', rarity: '神话' },
  { name: '原初金', color: '#8f6729', accent: '#ffe17a', rarity: '神话' },
  { name: '地心棱镜', color: '#315f68', accent: '#8ffff1', rarity: '神话' },
];

const REGIONS = [
  '浅层褐带',
  '赤铜断层',
  '蓝晶暗河',
  '黄金穹顶',
  '星银裂谷',
  '地心棱镜',
];

const DEEP_PALETTE = [
  { color: '#4d5e55', accent: '#9ed3a9' },
  { color: '#644d5d', accent: '#dba8cb' },
  { color: '#4c596d', accent: '#9cc8ed' },
  { color: '#70523e', accent: '#e9b879' },
  { color: '#4d6467', accent: '#8ee3df' },
  { color: '#665b42', accent: '#e5d786' },
];

const DEEP_PREFIXES = [
  '余烬',
  '幽蓝',
  '星白',
  '沉金',
  '回声',
  '深红',
  '苍绿',
  '无光',
  '古核',
  '地脉',
];

const layerCache = new Map<number, LayerDefinition>();
const MAX_ECONOMY_VALUE = Number.MAX_SAFE_INTEGER;

function scaledAmount(base: number, growth: number, steps: number): number {
  const logValue = Math.log(base) + Math.max(0, steps) * Math.log(growth);
  if (logValue >= Math.log(MAX_ECONOMY_VALUE)) return MAX_ECONOMY_VALUE;
  return base * Math.exp(Math.max(0, steps) * Math.log(growth));
}

function rarityForLayer(index: number): Rarity {
  const offset = index % 20;
  if (offset <= 8) return '普通';
  if (offset <= 13) return '稀有';
  if (offset <= 17) return '史诗';
  if (offset <= 19) return '传说';
  return '神话';
}

export function getLayerDefinition(index: number): LayerDefinition {
  const safeIndex = Math.max(1, Math.floor(index));
  const cached = layerCache.get(safeIndex);
  if (cached) return cached;

  const authored = AUTHORED_LAYERS[safeIndex - 1];
  const deepPalette = DEEP_PALETTE[(safeIndex - 31) % DEEP_PALETTE.length] ?? DEEP_PALETTE[0];
  const deepPrefix = DEEP_PREFIXES[(safeIndex - 31) % DEEP_PREFIXES.length] ?? '无垠';
  const color = authored?.color ?? deepPalette.color;
  const accent = authored?.accent ?? deepPalette.accent;

  const definition: LayerDefinition = {
    index: safeIndex,
    name: authored?.name ?? `${deepPrefix}矿脉 ${safeIndex}`,
    region: REGIONS[Math.min(Math.floor((safeIndex - 1) / 5), REGIONS.length - 1)] ?? '无垠地心',
    depthMeters: 120 + (safeIndex - 1) * 180,
    color,
    accent,
    rarity: authored?.rarity ?? rarityForLayer(safeIndex),
    milestone: safeIndex % 5 === 0,
    mainEndpoint: safeIndex === 30,
    baseValue: scaledAmount(5, 2, safeIndex - 1),
    baseMiningSeconds: 1.45 * Math.pow(1.08, safeIndex - 1),
  };

  layerCache.set(safeIndex, definition);
  return definition;
}

export function getVisibleLayers(center: number, radius = 3): LayerDefinition[] {
  const first = Math.max(1, center - radius);
  const last = center + radius;
  return Array.from({ length: last - first + 1 }, (_, index) => getLayerDefinition(first + index));
}
