import type { ManagerId } from './types';

export interface ManagerDefinition {
  id: ManagerId;
  name: string;
  title: string;
  description: string;
  unlockLayer: number;
  cost: number;
  icon: string;
  accent: string;
}

export const MANAGERS: ManagerDefinition[] = [
  {
    id: 'a-zuan',
    name: '阿钻',
    title: '钻探班长',
    description: '所有钻探速度提高 22%。',
    unlockLayer: 3,
    cost: 260,
    icon: 'drill',
    accent: '#f4b942',
  },
  {
    id: 'gang-suo',
    name: '钢索',
    title: '井口主管',
    description: '卷扬机起吊速度提高 22%。',
    unlockLayer: 5,
    cost: 850,
    icon: 'cable-car',
    accent: '#70d6c4',
  },
  {
    id: 'a-lu',
    name: '阿路',
    title: '车队调度',
    description: '矿石运输速度提高 22%。',
    unlockLayer: 7,
    cost: 2400,
    icon: 'truck',
    accent: '#74b9ff',
  },
  {
    id: 'suan-pan',
    name: '算盘',
    title: '销售总监',
    description: '总部矿石售价提高 15%。',
    unlockLayer: 9,
    cost: 6800,
    icon: 'calculator',
    accent: '#ffcf5c',
  },
  {
    id: 'yan-xin',
    name: '岩心',
    title: '地质顾问',
    description: '深层钻探减速效果降低 18%。',
    unlockLayer: 12,
    cost: 24000,
    icon: 'mountain',
    accent: '#d59ff2',
  },
  {
    id: 'ye-ban',
    name: '夜班',
    title: '守夜人',
    description: '离线效率提高 15%，离线上限增加 4 小时。',
    unlockLayer: 15,
    cost: 88000,
    icon: 'moon-star',
    accent: '#a8b7ff',
  },
  {
    id: 'cang-ku',
    name: '仓库长',
    title: '仓储经理',
    description: '三条生产线的容量都提高 20%。',
    unlockLayer: 18,
    cost: 310000,
    icon: 'container',
    accent: '#e5a56f',
  },
  {
    id: 'xing-yun',
    name: '幸运帽',
    title: '富矿猎人',
    description: '超级矿脉的收益倍率进一步提高。',
    unlockLayer: 22,
    cost: 1400000,
    icon: 'sparkles',
    accent: '#ffdf6e',
  },
  {
    id: 'dong-shi',
    name: '董事长',
    title: '公司掌舵人',
    description: '三条生产线速度提高 12%，售价提高 5%。',
    unlockLayer: 26,
    cost: 6800000,
    icon: 'briefcase-business',
    accent: '#f0917c',
  },
];

export const MANAGER_BY_ID = Object.fromEntries(
  MANAGERS.map((manager) => [manager.id, manager]),
) as Record<ManagerId, ManagerDefinition>;
