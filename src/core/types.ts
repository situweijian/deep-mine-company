export const LINE_IDS = ['drill', 'lift', 'truck'] as const;

export type LineId = (typeof LINE_IDS)[number];

export type ManagerId =
  | 'a-zuan'
  | 'gang-suo'
  | 'a-lu'
  | 'suan-pan'
  | 'yan-xin'
  | 'ye-ban'
  | 'cang-ku'
  | 'xing-yun'
  | 'dong-shi';

export type Rarity = '普通' | '稀有' | '史诗' | '传说' | '神话';

export interface LayerDefinition {
  index: number;
  name: string;
  region: string;
  depthMeters: number;
  color: string;
  accent: string;
  rarity: Rarity;
  milestone: boolean;
  mainEndpoint: boolean;
  baseValue: number;
  baseMiningSeconds: number;
}

export interface CargoInventory {
  units: number;
  totalValue: number;
}

export interface CargoPart extends CargoInventory {
  layer: number;
}

export interface ProductionLineState {
  level: number;
  progress: number;
  active: boolean;
  automated: boolean;
  queued: number;
  payload: CargoInventory;
  payloadLayer: number;
  payloadLayers: number[];
  payloadParts: CargoPart[];
  tripDuration: number;
  automationLayer: number;
}

export interface LayerMiningState {
  progress: number;
  active: boolean;
  automated: boolean;
  crewLevel: number;
  queued: number;
  payload: CargoInventory;
  payloadLayer: number;
  tripDuration: number;
}

export interface LayerCargoState {
  underground: CargoInventory;
  surface: CargoInventory;
}

export interface DailyTaskState {
  date: string;
  trips: number;
  upgrades: number;
  starts: number;
  rewardClaimed: boolean;
}

export interface GameSettings {
  sound: boolean;
  music: boolean;
  sfxVolume: number;
  musicVolume: number;
  vibration: boolean;
  screenShake: boolean;
  reduceFlash: boolean;
}

export interface GameStats {
  totalTrips: number;
  totalUnits: number;
  manualActions: number;
  lineStarts: number;
  upgrades: number;
  adsWatched: number;
  bestSale: number;
  longestOfflineSeconds: number;
}

export interface GameState {
  version: number;
  money: number;
  lifetimeEarnings: number;
  companyXp: number;
  companyLevel: number;
  deepestLayer: number;
  currentLayer: number;
  lines: Record<LineId, ProductionLineState>;
  layers: Record<number, LayerMiningState>;
  layerCargo: Record<number, LayerCargoState>;
  underground: CargoInventory;
  surface: CargoInventory;
  managers: Record<ManagerId, boolean>;
  museum: number[];
  tutorialStep: number;
  tutorialCompleted: boolean;
  tutorialRewardClaimed: boolean;
  adBoostSeconds: number;
  adCrewSeconds: number;
  goldenShiftSeconds: number;
  richVeinSeconds: number;
  eventCountdown: number;
  daily: DailyTaskState;
  settings: GameSettings;
  stats: GameStats;
  prestigeMarks: number;
  prestigeCount: number;
  playSeconds: number;
  lastSeenAt: number;
  lastSavedAt: number;
  seed: number;
}

export type GameEvent =
  | {
      type: 'line_started';
      line: LineId;
      units: number;
      layer: number;
      layers?: number[];
      tripDuration: number;
    }
  | {
      type: 'mine_completed';
      line: 'drill';
      units: number;
      value: number;
      layer: number;
      layers?: number[];
      firstSample: boolean;
    }
  | {
      type: 'lift_completed';
      line: 'lift';
      units: number;
      value: number;
      layer: number;
      layers?: number[];
    }
  | {
      type: 'sale_completed';
      line: 'truck';
      units: number;
      baseValue: number;
      revenue: number;
      layer: number;
      layers?: number[];
      multiplier: number;
    }
  | {
      type: 'company_level_up';
      level: number;
    }
  | {
      type: 'rich_vein_started';
      seconds: number;
    }
  | {
      type: 'rich_vein_ended';
    }
  | {
      type: 'boost_ended';
      boost: 'ad' | 'ad-crew' | 'golden';
    }
  | {
      type: 'tutorial_completed';
      rewardSeconds: number;
    };

export interface ActionOutcome {
  ok: boolean;
  message: string;
  events: GameEvent[];
}

export interface OfflineReport {
  state: GameState;
  elapsedSeconds: number;
  creditedSeconds: number;
  capSeconds: number;
  capped: boolean;
  baseEarnings: number;
  trips: number;
  units: number;
  bottleneck: LineId | null;
  eligibleForAdBonus: boolean;
  fromLayer: number;
  toLayer: number;
}

export type AdPlacement = 'online_boost' | 'offline_bonus';

export type AdResult = 'completed' | 'skipped' | 'unavailable';

export interface RewardedAdAdapter {
  isAvailable(placement: AdPlacement): boolean;
  show(placement: AdPlacement): Promise<AdResult>;
}
