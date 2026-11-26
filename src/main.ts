import Phaser from 'phaser';
import './styles.css';
import { SfxEngine } from './audio/SfxEngine';
import {
  DAILY_GOALS,
  LINE_LABELS,
  MAX_MANUAL_QUEUE,
  advanceGame,
  addOfflineAdBonus,
  applyOnlineAdReward,
  buyAutomation,
  buyLayerCrewUpgrade,
  buyLineUpgrade,
  buyRecommendedUpgrade,
  canClaimDailyReward,
  claimDailyReward,
  getPrestigeAvailability,
  hireManager,
  performPrestige,
  queueLine,
  queueLineToCapacity,
  selectLayer,
  unlockNextLayer,
} from './core/engine';
import {
  MAX_LAYER_CREW,
  getAutomationCost,
  getAllLinesAutomated,
  getAutomatedDrillLayerCount,
  getCompanyLevelRequirement,
  getCompanyProgress,
  getDrillCapacityAtLayer,
  getEstimatedRevenuePerSecond,
  getLayerCrewUpgradeCost,
  getLineCapacity,
  getLineTripDuration,
  getLineUpgradeCost,
  getNextLayerCost,
  getOfflineCapSeconds,
  getOutputMultiplier,
  getPrestigeLayerRequirement,
  getPrestigeRunMultiplier,
  getRecommendedUpgradeLine,
  getSaleMultiplier,
  getUnitSaleValue,
  isDrillLayerAutomated,
  isLineAutomated,
} from './core/economy';
import {
  formatCompact,
  formatDuration,
  formatMoney,
  formatRate,
} from './core/format';
import {
  getResponsiveLayerCount,
  getVisibleLayerWindow,
} from './core/layer-window';
import { getLayerDefinition } from './core/layers';
import { MANAGER_BY_ID, MANAGERS } from './core/managers';
import { calculateOfflineProgress } from './core/offline';
import { SaveRepository } from './core/save';
import type {
  ActionOutcome,
  AdPlacement,
  AdResult,
  GameEvent,
  GameState,
  LineId,
  ManagerId,
  OfflineReport,
  RewardedAdAdapter,
} from './core/types';
import { LINE_IDS } from './core/types';
import { MineScene } from './game/MineScene';
import { renderIcons } from './ui/icons';

type SfxName = Parameters<SfxEngine['play']>[0];
type ToastTone = 'normal' | 'error' | 'reward';
type SheetName = 'tasks' | 'crew' | 'layers' | 'more';
type SettingKey =
  | 'sound'
  | 'music'
  | 'vibration'
  | 'screenShake'
  | 'reduceFlash';
type VolumeKey = 'sfxVolume' | 'musicVolume';
type WorkspaceView = 'mine' | 'operations' | 'company';

interface ModalOptions {
  title: string;
  icon?: string;
  body: string;
  actions?: string;
  size?: 'normal' | 'wide' | 'narrow';
  dismissible?: boolean;
  onClose?: () => void;
}

interface LineUiRefs {
  root: HTMLElement;
  level: HTMLElement;
  capacity: HTMLElement;
  duration: HTMLElement;
  load: HTMLElement;
  source: HTMLElement;
  progress: HTMLElement;
  status: HTMLElement;
  queue: HTMLElement;
  queuePips: HTMLElement;
  queueAll: HTMLButtonElement;
  primary: HTMLButtonElement;
  primaryLabel: HTMLElement;
  queueCount: HTMLElement;
  upgrade: HTMLButtonElement;
  upgradeLabel: HTMLElement;
  automation: HTMLButtonElement;
  automationLabel: HTMLElement;
}

const LINE_META: Record<
  LineId,
  { icon: string; kicker: string; title: string; verb: string }
> = {
  drill: { icon: 'pickaxe', kicker: '01 / 钻探线', title: '钻机平台', verb: '开挖' },
  lift: {
    icon: 'arrow-up-from-line',
    kicker: '02 / 卷扬线',
    title: '井口起吊',
    verb: '起吊',
  },
  truck: { icon: 'truck', kicker: '03 / 运输线', title: '地面车队', verb: '发车' },
};

const TUTORIAL_STEPS = [
  {
    title: '先让钻机转起来',
    detail: '点“开挖”启动本层班组，最多可连续预排 5 次。',
    line: 'drill',
    action: 'queue',
    actionLabel: '立即开挖',
  },
  {
    title: '把矿石吊上地面',
    detail: '井下有货后点“起吊”，也可预排 5 次；吊机会按实际来料层接货。',
    line: 'lift',
    action: 'queue',
    actionLabel: '立即起吊',
  },
  {
    title: '送往总部结算',
    detail: '点一下“发车”。到账的钱可以升级设备，也能解锁更深矿层。',
    line: 'truck',
    action: 'queue',
    actionLabel: '立即发车',
  },
  {
    title: '升级一次钻机',
    detail: '多跑几趟，凑够费用后升级钻机。等级提高会同时加快速度、增加单次产量。',
    line: 'drill',
    action: 'upgrade',
    actionLabel: '升级钻机',
  },
  {
    title: '雇第一个本层监工',
    detail: '先为当前矿层雇监工。每个新矿层都要手动开局，再交给本层监工值守。',
    line: 'drill',
    action: 'automation',
    actionLabel: '雇本层监工',
  },
  {
    title: '给起吊线雇监工',
    detail: '吊机负责所有矿层。接驳监工接管后，各层堆好的矿石会按批次送上地面。',
    line: 'lift',
    action: 'automation',
    actionLabel: '雇接驳监工',
  },
  {
    title: '给车队雇监工',
    detail: '卡车同样服务所有矿层。本层监工与接驳监工齐备后，矿石会持续结算。',
    line: 'truck',
    action: 'automation',
    actionLabel: '雇车队监工',
  },
] as const;

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) throw new Error('缺少 #app 容器。');

appRoot.innerHTML = `
  <div class="game-app" id="game-app" data-view="mine" data-mine-section="production">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"><i data-lucide="pickaxe"></i></span>
        <div class="brand-copy">
          <p>深井资源集团</p>
          <h1>挖穿地心公司</h1>
        </div>
      </div>
      <div class="money-hud" aria-live="polite">
        <span>可用资金</span>
        <strong id="money-value">¥0</strong>
        <small id="income-value">手动生产</small>
      </div>
      <div class="header-status">
        <span class="status-chip" id="company-level-chip">公司 Lv.1</span>
        <span class="status-chip hidden" id="ad-boost-chip"></span>
        <span class="status-chip hidden" id="special-boost-chip"></span>
      </div>
      <div class="topbar-actions">
        <button class="icon-button" type="button" data-action="open-help" title="玩法帮助" aria-label="玩法帮助">
          <i data-lucide="help-circle"></i>
        </button>
        <button class="icon-button" type="button" data-action="open-settings" title="设置" aria-label="设置">
          <i data-lucide="settings"></i>
        </button>
      </div>
    </header>

    <nav class="workspace-nav" aria-label="主界面切换">
      <button class="workspace-tab is-active" type="button" data-view="mine">
        <i data-lucide="mountain"></i><span>矿场经营</span><small>矿井与生产线</small>
      </button>
      <button class="workspace-tab" type="button" data-view="company">
        <i data-lucide="landmark"></i><span>公司管理</span><small>任务、工头与创业</small>
      </button>
    </nav>

    <div class="tutorial-strip" data-workspace="mine">
      <div class="tutorial-banner" id="tutorial-banner">
        <span class="tutorial-step" id="tutorial-step">1/7</span>
        <div class="tutorial-copy">
          <span class="tutorial-kicker" id="tutorial-kicker">新手任务 · 第 1 步</span>
          <strong id="tutorial-title">先让钻机转起来</strong>
          <span class="tutorial-detail" id="tutorial-detail">点“开挖”启动本层班组，最多可连续预排 5 次。</span>
        </div>
        <button class="tutorial-primary" id="tutorial-primary" type="button" data-action="tutorial-primary">
          <span id="tutorial-primary-label">立即开挖</span>
          <i data-lucide="chevron-right"></i>
        </button>
        <button class="tutorial-skip" type="button" data-action="skip-tutorial">跳过</button>
        <span class="tutorial-progress" aria-hidden="true">
          <span id="tutorial-progress-fill"></span>
        </span>
      </div>
    </div>

    <main class="game-layout">
      <aside class="side-panel left-panel" aria-label="任务与矿层">
        <section class="panel-block" data-workspace="company">
          <div class="section-heading">
            <h2>今日任务</h2>
            <span id="daily-summary">0 / 3</span>
          </div>
          <div class="list-stack" id="daily-list">${dailyRowsTemplate()}</div>
          <button class="wide-button" id="daily-claim-button" type="button" data-action="claim-daily">
            <span class="wide-button-copy">
              <span>全部完成后可领取</span>
              <strong>10 分钟黄金班次</strong>
            </span>
            <i data-lucide="gift"></i>
          </button>
        </section>

        <section class="panel-block is-amber" data-workspace="mine">
          <div class="section-heading">
            <h2>当前矿层</h2>
            <span id="layer-rarity">普通</span>
          </div>
          <div class="summary-grid">
            <div class="summary-cell">
              <span>矿层单价</span>
              <strong id="layer-unit-value">¥3</strong>
            </div>
            <div class="summary-cell">
              <span>图鉴收藏</span>
              <strong id="museum-count">0 种</strong>
            </div>
          </div>
          <div class="layer-crew-panel">
            <div class="layer-crew-heading">
              <span>本层班组</span>
              <strong id="current-layer-crew">1 / 5 人</strong>
            </div>
            <p id="current-layer-crew-effect">再扩编：产量 +45%，钻速 +7%</p>
            <button class="wide-button" id="current-layer-crew-button" type="button" data-action="upgrade-layer" data-layer="1">
              <span class="wide-button-copy">
                <span>增加本层矿工</span>
                <strong id="current-layer-crew-label">扩编 ¥60</strong>
              </span>
              <i data-lucide="users"></i>
            </button>
          </div>
          <button class="text-button" type="button" data-action="open-museum">查看矿物图鉴</button>
        </section>

        <section class="panel-block is-blue" data-workspace="company">
          <div class="section-heading">
            <h2>公司档案</h2>
            <span id="deepest-layer-label">最深 1 层</span>
          </div>
          <div class="summary-grid">
            <div class="summary-cell">
              <span>累计运输</span>
              <strong id="stat-trips">0 次</strong>
            </div>
            <div class="summary-cell">
              <span>累计产值</span>
              <strong id="stat-units">¥0</strong>
            </div>
            <div class="summary-cell">
              <span>单次最高销售</span>
              <strong id="stat-best-sale">¥0</strong>
            </div>
            <div class="summary-cell">
              <span>离线上限</span>
              <strong id="offline-cap">12 小时</strong>
            </div>
          </div>
        </section>
      </aside>

      <section class="center-column" aria-label="矿井和生产操作">
        <div class="scene-frame" data-workspace="mine">
          <div class="scene-topline">
            <div class="layer-switcher">
              <button class="scene-nav-button" id="scene-layer-prev" type="button" data-action="change-layer" data-delta="-1" aria-label="聚焦上一层">
                <i data-lucide="chevron-left"></i>
              </button>
              <span class="layer-badge">
                <i data-lucide="map"></i>
                <span id="scene-layer-label">观察 01 褐煤 · 120m</span>
              </span>
              <button class="scene-nav-button" id="scene-layer-next" type="button" data-action="change-layer" data-delta="1" aria-label="聚焦下一层">
                <i data-lucide="chevron-right"></i>
              </button>
              <span class="scene-clock">
                <i data-lucide="clock-3"></i>
                <span id="scene-clock-label">营业 0 秒</span>
              </span>
              <button class="scene-frontier-button" id="scene-frontier-button" type="button" data-action="unlock-layer">
                <i data-lucide="layers-3"></i>
                <span id="scene-frontier-label">下一层 · 第 2 层</span>
                <strong id="scene-frontier-cost">¥130</strong>
              </button>
            </div>
          </div>
          <div class="scene-current-layer-copy" aria-hidden="true">
            <strong id="scene-current-layer-name">01 · 褐煤</strong>
            <span id="scene-current-layer-cargo">井下估值 ¥0</span>
          </div>
          <div class="scene-hq-copy" aria-hidden="true">总部结算站</div>
          <div class="scene-event-message" id="scene-event-message" aria-live="polite"></div>
          <div
            class="mine-layer-scrollbar"
            id="mine-layer-scrollbar"
            role="slider"
            tabindex="0"
            aria-label="拖动切换矿层"
            aria-orientation="vertical"
            aria-valuemin="1"
            aria-valuemax="1"
            aria-valuenow="1"
          >
            <i data-lucide="chevron-up" aria-hidden="true"></i>
            <div class="mine-layer-scrollbar-track">
              <span class="mine-layer-scrollbar-thumb" id="mine-layer-scrollbar-thumb"></span>
            </div>
            <i data-lucide="chevron-down" aria-hidden="true"></i>
          </div>
          <div class="mine-stage" id="mine-stage" aria-label="像素风地下矿井生产画面" title="滚轮上下切换观察矿层">
            <div class="scene-layer-hitareas" id="scene-layer-hitareas" aria-label="点击切换观察矿层"></div>
          </div>
          <div class="rich-vein-banner hidden" id="rich-vein-banner">超级矿脉 ×2.5 · 20 秒</div>
          <div class="scene-footer">
            <div class="scene-legend">
              <span class="scene-pill is-live">同步施工中</span>
              <span class="scene-pill" id="scene-underground">井下货值 ¥0</span>
              <span class="scene-pill" id="scene-surface">地面货值 ¥0</span>
            </div>
            <button class="scene-command-button hidden" id="scene-command-button" type="button" data-action="scene-command">
              <i data-lucide="sparkles"></i>
              <span id="scene-command-label">一键排班 ×5</span>
            </button>
            <div class="scene-tools">
              <button class="scene-action-button" type="button" data-action="open-crew" title="打开值班室" aria-label="打开值班室">
                <i data-lucide="users"></i>
              </button>
              <button class="scene-action-button" type="button" data-action="open-museum" title="打开矿物图鉴" aria-label="打开矿物图鉴">
                <i data-lucide="book-open"></i>
              </button>
              <button class="scene-action-button is-boost" type="button" data-action="ad-boost" title="模拟广告：双倍在线收益" aria-label="模拟广告双倍收益">
                <i data-lucide="zap"></i>
              </button>
              <span class="scene-pill" id="scene-multiplier">收益 ×1</span>
            </div>
          </div>
        </div>

        <section class="frontier-unlock-bar" data-workspace="mine" aria-label="下一矿层解锁进度">
          <div class="frontier-signal" aria-hidden="true">
            <i data-lucide="layers-3"></i>
          </div>
          <div class="frontier-copy">
            <span>下一矿层</span>
            <strong id="unlock-layer-label">第 2 层 · 赤铜</strong>
            <small id="unlock-layer-gap">下一层单价 +100%</small>
          </div>
          <div class="frontier-progress">
            <span id="unlock-meter-text">距离下一层还差 ¥130</span>
            <div class="unlock-meter" id="unlock-meter" aria-hidden="true">
              <span id="unlock-meter-fill"></span>
            </div>
          </div>
          <button class="frontier-unlock-button" id="unlock-layer-button" type="button" data-action="unlock-layer" aria-label="解锁下一矿层">
            <span>解锁新矿层</span>
            <strong id="unlock-layer-cost">¥130</strong>
          </button>
        </section>

        <nav class="mobile-section-tabs" data-workspace="mine" aria-label="矿场操作切换">
          <button class="is-active" type="button" data-action="mine-section" data-section="production">
            <i data-lucide="pickaxe"></i>
            <span>生产操作</span>
          </button>
          <button type="button" data-action="mine-section" data-section="layers">
            <i data-lucide="layers-3"></i>
            <span>矿层调度</span>
          </button>
        </nav>

        <div class="layer-rail-shell" data-workspace="mine">
          <div class="layer-rail-head">
            <strong>矿层调度台</strong>
            <span id="layer-rail-summary">各层独立施工 · 每层默认 1 人，最高 5 人</span>
          </div>
          <div class="layer-jump-row">
            <div class="layer-stepper">
              <button type="button" data-action="change-layer" data-delta="-1" aria-label="观察上一层">
                <i data-lucide="chevron-left"></i>
              </button>
              <label class="layer-select-wrap">
                <span>当前操作层</span>
                <select id="layer-jump-select" aria-label="选择要操作的矿层"></select>
              </label>
              <button type="button" data-action="change-layer" data-delta="1" aria-label="观察下一层">
                <i data-lucide="chevron-right"></i>
              </button>
            </div>
            <button class="layer-tool-button is-crew" id="layer-toolbar-crew" type="button" data-action="upgrade-layer">
              本层扩编
            </button>
            <button class="layer-tool-button is-supervisor" id="layer-toolbar-supervisor" type="button" data-action="automation-layer">
              本层监工
            </button>
          </div>
          <div class="layer-rail" id="layer-rail" aria-label="同步施工矿层"></div>
        </div>

        <div class="production-grid" data-workspace="mine">
          ${LINE_IDS.map(lineCardTemplate).join('')}
        </div>

        <div class="center-utility" data-workspace="mine">
          <button class="wide-button is-primary" id="recommended-upgrade-button" type="button" data-action="recommended-upgrade">
            <span class="wide-button-copy">
              <span>智能推荐升级</span>
              <strong id="recommended-upgrade-label">钻探设备 Lv.1</strong>
            </span>
            <strong id="recommended-upgrade-cost">¥12</strong>
          </button>
          <button class="wide-button" id="mobile-tasks-button" type="button" data-action="open-tasks">
            <span class="wide-button-copy">
              <span>任务与成长</span>
              <strong id="quick-task-label">今日 0 / 3</strong>
            </span>
            <i data-lucide="trending-up"></i>
          </button>
        </div>
      </section>

      <aside class="side-panel right-panel" aria-label="公司成长和工头">
        <section class="panel-block" data-workspace="company">
          <div class="section-heading">
            <h2>公司成长</h2>
            <i data-lucide="bar-chart-3"></i>
          </div>
          <div class="xp-row">
            <span data-company-level>公司 Lv.1</span>
            <strong data-company-xp>0 / 50</strong>
          </div>
          <div class="xp-track"><span class="xp-fill" data-company-xp-fill></span></div>
          <div class="summary-grid" style="margin-top:9px">
            <div class="summary-cell">
              <span>监工收益</span>
              <strong id="estimated-income">¥0/秒</strong>
            </div>
            <div class="summary-cell">
              <span>永久加成</span>
              <strong id="permanent-bonus">×1.00</strong>
            </div>
          </div>
        </section>

        <section class="panel-block is-amber" data-workspace="mine company">
          <div class="section-heading">
            <h3>值班室</h3>
            <button class="text-button" type="button" data-action="open-crew">全部工头</button>
          </div>
          <div class="list-stack" id="desktop-managers"></div>
        </section>

        <section class="panel-block is-blue" data-workspace="mine">
          <div class="section-heading">
            <h3>效率诊断</h3>
            <i data-lucide="trending-up"></i>
          </div>
          <div class="summary-grid">
            <div class="summary-cell">
              <span>当前瓶颈</span>
              <strong id="diagnostic-bottleneck">钻探</strong>
            </div>
            <div class="summary-cell">
              <span>建议升级</span>
              <strong id="diagnostic-upgrade">钻机 Lv.1</strong>
            </div>
          </div>
          <p class="diagnostic-hint" id="diagnostic-hint">升级最慢的生产线，整体收益会同步提高。</p>
        </section>

        <section class="panel-block is-red" data-workspace="mine">
          <div class="section-heading">
            <h3>收益加速</h3>
            <i data-lucide="zap"></i>
          </div>
          <div class="boost-card">
            <div class="boost-heading">
              <strong id="boost-state">尚未加速</strong>
              <span id="boost-timer">最多储备 30 分钟</span>
            </div>
            <p>监工值守会持续赚钱。模拟广告只把在线收益短暂提高到 2 倍，不看也能完整游玩。</p>
            <button class="wide-button is-primary" id="desktop-ad-button" type="button" data-action="ad-boost">
              <span class="wide-button-copy">
                <span>模拟激励广告</span>
                <strong>储备 15 分钟双倍收益</strong>
              </span>
              <i data-lucide="play"></i>
            </button>
          </div>
        </section>

        <section class="panel-block" data-workspace="company">
          <button class="wide-button" type="button" data-action="open-growth">
            <span class="wide-button-copy">
              <span>长期路线</span>
              <strong>公司等级 · 每日任务 · 二次创业</strong>
            </span>
            <i data-lucide="chevron-right"></i>
          </button>
        </section>
      </aside>
    </main>

    <nav class="mobile-nav" aria-label="手机功能导航">
      <button class="nav-button is-active" type="button" data-view="mine">
        <i data-lucide="mountain"></i><span>矿井</span>
      </button>
      <button class="nav-button" type="button" data-view="company">
        <i data-lucide="landmark"></i><span>公司</span>
      </button>
      <button class="nav-button" type="button" data-action="open-museum">
        <i data-lucide="book-open"></i><span>图鉴</span>
      </button>
      <button class="nav-button" type="button" data-sheet="more">
        <i data-lucide="briefcase-business"></i><span>更多</span>
      </button>
    </nav>

    <div class="toast-root" id="toast-root" aria-live="polite" aria-atomic="false"></div>
    <div class="modal-root hidden" id="modal-root"></div>
  </div>
`;

renderIcons(appRoot);

const repository = new SaveRepository(window.localStorage);
const loadedSave = repository.load();
let state: GameState = loadedSave.state;
let initialOfflineReport: OfflineReport | null = null;
let pendingOfflineReport: OfflineReport | null = null;
let offlineBonusClaimed = false;
let managerSignature = '';
let layerRailSignature = '';
let layerNavigatorDeepest = 0;
let sceneHitareaSignature = '';
let tutorialTarget: HTMLElement | null = null;
let sceneCommandMode: 'queue' | 'ad' = 'queue';
let sceneCommandLine: LineId = 'drill';
let lastHiddenAt = 0;
let saveAccumulator = 0;
let uiAccumulator = 0;
let lastFrameAt = performance.now();
let activeWorkspaceView: WorkspaceView = 'mine';
let activeMineSection: 'production' | 'layers' = 'production';
let activeLayerWindowCount = getResponsiveLayerCount(window.innerWidth);
const pendingMineralDiscoveries = new Set<number>();
let mineralDiscoveryTimer = 0;
const mineScene = new MineScene();
let adModalOpen = false;

if (!loadedSave.isNew) {
  const report = calculateOfflineProgress(state, Date.now());
  state = report.state;
  if (report.elapsedSeconds >= 30 && (report.baseEarnings > 0 || getAllLinesAutomated(state))) {
    initialOfflineReport = report;
    pendingOfflineReport = report;
  }
}

const sfx = new SfxEngine();
sfx.setEnabled(state.settings.sound);
sfx.setMusicEnabled(state.settings.music);
sfx.setVibrationEnabled(state.settings.vibration);

const compactRenderer =
  window.innerWidth < 940 ||
  window.matchMedia('(pointer: coarse)').matches;
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'mine-stage',
  width: compactRenderer ? 1280 : 1920,
  height: compactRenderer ? 720 : 1080,
  backgroundColor: '#171b18',
  pixelArt: false,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    antialias: true,
    pixelArt: false,
    roundPixels: false,
  },
  scene: [mineScene],
});

mineScene.setLayerWindowCount(activeLayerWindowCount);
mineScene.sync(state);

Object.assign(window, {
  game,
  mineCompany: {
    getState: () => state,
    getView: () => activeWorkspaceView,
    setView: (view: WorkspaceView) => applyWorkspaceView(view),
    getAudioState: () => sfx.getDebugState(),
    save: () => saveNow(true),
  },
});

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`缺少页面元素 #${id}`);
  return found as T;
};

const gameApp = element<HTMLElement>('game-app');

const lineRefs = Object.fromEntries(
  LINE_IDS.map((line) => {
    const root = element<HTMLElement>(`line-${line}-card`);
    return [
      line,
      {
        root,
        level: element<HTMLElement>(`line-${line}-level`),
        capacity: element<HTMLElement>(`line-${line}-capacity`),
        duration: element<HTMLElement>(`line-${line}-duration`),
        load: element<HTMLElement>(`line-${line}-load`),
        source: element<HTMLElement>(`line-${line}-source`),
        progress: element<HTMLElement>(`line-${line}-progress`),
        status: element<HTMLElement>(`line-${line}-status`),
        queue: element<HTMLElement>(`line-${line}-queue`),
        queuePips: element<HTMLElement>(`line-${line}-queue-pips`),
        queueAll: element<HTMLButtonElement>(`line-${line}-queue-all`),
        primary: element<HTMLButtonElement>(`line-${line}-primary`),
        primaryLabel: element<HTMLElement>(`line-${line}-primary-label`),
        queueCount: element<HTMLElement>(`line-${line}-queue-count`),
        upgrade: element<HTMLButtonElement>(`line-${line}-upgrade`),
        upgradeLabel: element<HTMLElement>(`line-${line}-upgrade-label`),
        automation: element<HTMLButtonElement>(`line-${line}-automation`),
        automationLabel: element<HTMLElement>(`line-${line}-automation-label`),
      },
    ];
  }),
) as Record<LineId, LineUiRefs>;

const modalRoot = element<HTMLDivElement>('modal-root');
const toastRoot = element<HTMLDivElement>('toast-root');
const moneyValue = element<HTMLElement>('money-value');
const incomeValue = element<HTMLElement>('income-value');
const companyLevelChip = element<HTMLElement>('company-level-chip');
const adBoostChip = element<HTMLElement>('ad-boost-chip');
const specialBoostChip = element<HTMLElement>('special-boost-chip');
const dailySummary = element<HTMLElement>('daily-summary');
const quickTaskLabel = element<HTMLElement>('quick-task-label');
const dailyClaimButton = element<HTMLButtonElement>('daily-claim-button');
const layerRarity = element<HTMLElement>('layer-rarity');
const layerUnitValue = element<HTMLElement>('layer-unit-value');
const museumCount = element<HTMLElement>('museum-count');
const currentLayerCrew = element<HTMLElement>('current-layer-crew');
const currentLayerCrewEffect = element<HTMLElement>('current-layer-crew-effect');
const currentLayerCrewButton = element<HTMLButtonElement>('current-layer-crew-button');
const currentLayerCrewLabel = element<HTMLElement>('current-layer-crew-label');
const layerRail = element<HTMLElement>('layer-rail');
const layerRailSummary = element<HTMLElement>('layer-rail-summary');
const layerJumpSelect = element<HTMLSelectElement>('layer-jump-select');
const layerToolbarCrew = element<HTMLButtonElement>('layer-toolbar-crew');
const layerToolbarSupervisor = element<HTMLButtonElement>(
  'layer-toolbar-supervisor',
);
const unlockLayerButton = element<HTMLButtonElement>('unlock-layer-button');
const unlockLayerLabel = element<HTMLElement>('unlock-layer-label');
const unlockLayerCost = element<HTMLElement>('unlock-layer-cost');
const unlockLayerGap = element<HTMLElement>('unlock-layer-gap');
const unlockMeter = element<HTMLElement>('unlock-meter');
const unlockMeterFill = element<HTMLElement>('unlock-meter-fill');
const unlockMeterText = element<HTMLElement>('unlock-meter-text');
const deepestLayerLabel = element<HTMLElement>('deepest-layer-label');
const statTrips = element<HTMLElement>('stat-trips');
const statUnits = element<HTMLElement>('stat-units');
const statBestSale = element<HTMLElement>('stat-best-sale');
const offlineCap = element<HTMLElement>('offline-cap');
const tutorialBanner = element<HTMLElement>('tutorial-banner');
const tutorialStep = element<HTMLElement>('tutorial-step');
const tutorialKicker = element<HTMLElement>('tutorial-kicker');
const tutorialTitle = element<HTMLElement>('tutorial-title');
const tutorialDetail = element<HTMLElement>('tutorial-detail');
const tutorialPrimary = element<HTMLButtonElement>('tutorial-primary');
const tutorialPrimaryLabel = element<HTMLElement>('tutorial-primary-label');
const tutorialProgressFill = element<HTMLElement>('tutorial-progress-fill');
const sceneLayerLabel = element<HTMLElement>('scene-layer-label');
const sceneLayerPrev = element<HTMLButtonElement>('scene-layer-prev');
const sceneLayerNext = element<HTMLButtonElement>('scene-layer-next');
const sceneClockLabel = element<HTMLElement>('scene-clock-label');
const sceneFrontierButton = element<HTMLButtonElement>('scene-frontier-button');
const sceneFrontierLabel = element<HTMLElement>('scene-frontier-label');
const sceneFrontierCost = element<HTMLElement>('scene-frontier-cost');
const sceneCurrentLayerName = element<HTMLElement>('scene-current-layer-name');
const sceneCurrentLayerCargo = element<HTMLElement>('scene-current-layer-cargo');
const sceneEventMessage = element<HTMLElement>('scene-event-message');
const sceneUnderground = element<HTMLElement>('scene-underground');
const sceneSurface = element<HTMLElement>('scene-surface');
const sceneMultiplier = element<HTMLElement>('scene-multiplier');
const sceneCommandButton = element<HTMLButtonElement>('scene-command-button');
const sceneCommandLabel = element<HTMLElement>('scene-command-label');
const sceneLayerHitareas = element<HTMLElement>('scene-layer-hitareas');
const mineStage = element<HTMLElement>('mine-stage');
const mineLayerScrollbar = element<HTMLElement>('mine-layer-scrollbar');
const mineLayerScrollbarThumb = element<HTMLElement>(
  'mine-layer-scrollbar-thumb',
);
const richVeinBanner = element<HTMLElement>('rich-vein-banner');
const recommendedUpgradeButton = element<HTMLButtonElement>('recommended-upgrade-button');
const recommendedUpgradeLabel = element<HTMLElement>('recommended-upgrade-label');
const recommendedUpgradeCost = element<HTMLElement>('recommended-upgrade-cost');
const estimatedIncome = element<HTMLElement>('estimated-income');
const permanentBonus = element<HTMLElement>('permanent-bonus');
const desktopManagers = element<HTMLElement>('desktop-managers');
const diagnosticBottleneck = element<HTMLElement>('diagnostic-bottleneck');
const diagnosticUpgrade = element<HTMLElement>('diagnostic-upgrade');
const diagnosticHint = element<HTMLElement>('diagnostic-hint');
const boostState = element<HTMLElement>('boost-state');
const boostTimer = element<HTMLElement>('boost-timer');
const desktopAdButton = element<HTMLButtonElement>('desktop-ad-button');
const mobileTasksButton = element<HTMLButtonElement>('mobile-tasks-button');

const mockAdAdapter: RewardedAdAdapter = {
  isAvailable: () => true,
  show: (placement) => presentMockAd(placement),
};

game.events.on(
  'scene-message',
  (payload: { text: string; color: string }) => {
    sceneEventMessage.textContent = payload.text;
    sceneEventMessage.style.color = payload.color;
    sceneEventMessage.classList.remove('is-visible');
    void sceneEventMessage.offsetWidth;
    sceneEventMessage.classList.add('is-visible');
  },
);

let lastLayerWheelAt = 0;
mineStage.addEventListener(
  'wheel',
  (event) => {
    if (
      activeWorkspaceView !== 'mine' ||
      event.ctrlKey ||
      event.metaKey ||
      Math.abs(event.deltaY) < 2 ||
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
    ) {
      return;
    }
    const targetLayer = Math.max(
      1,
      Math.min(
        state.deepestLayer,
        state.currentLayer + (event.deltaY > 0 ? 1 : -1),
      ),
    );
    if (targetLayer === state.currentLayer) return;
    event.preventDefault();
    const now = performance.now();
    if (now - lastLayerWheelAt < 140) return;
    lastLayerWheelAt = now;
    focusLayer(targetLayer);
  },
  { passive: false },
);

const mineLayerScrollbarTrack = mineLayerScrollbar.querySelector<HTMLElement>(
  '.mine-layer-scrollbar-track',
);
let draggingMineLayerScrollbar = false;

const applyMineLayerScrollbarPosition = (clientY: number): void => {
  if (!mineLayerScrollbarTrack || state.deepestLayer <= 1) return;
  const rect = mineLayerScrollbarTrack.getBoundingClientRect();
  const ratio = Phaser.Math.Clamp((clientY - rect.top) / rect.height, 0, 1);
  const targetLayer = Math.round(1 + ratio * (state.deepestLayer - 1));
  if (targetLayer !== state.currentLayer) focusLayer(targetLayer);
};

mineLayerScrollbar.addEventListener('pointerdown', (event) => {
  if (state.deepestLayer <= 1) return;
  event.preventDefault();
  draggingMineLayerScrollbar = true;
  mineLayerScrollbar.setPointerCapture(event.pointerId);
  applyMineLayerScrollbarPosition(event.clientY);
});

mineLayerScrollbar.addEventListener('pointermove', (event) => {
  if (!draggingMineLayerScrollbar) return;
  event.preventDefault();
  applyMineLayerScrollbarPosition(event.clientY);
});

const stopMineLayerScrollbarDrag = (event: PointerEvent): void => {
  if (!draggingMineLayerScrollbar) return;
  draggingMineLayerScrollbar = false;
  if (mineLayerScrollbar.hasPointerCapture(event.pointerId)) {
    mineLayerScrollbar.releasePointerCapture(event.pointerId);
  }
};

mineLayerScrollbar.addEventListener('pointerup', stopMineLayerScrollbarDrag);
mineLayerScrollbar.addEventListener(
  'pointercancel',
  stopMineLayerScrollbarDrag,
);

mineLayerScrollbar.addEventListener('keydown', (event) => {
  if (state.deepestLayer <= 1) return;
  let targetLayer = state.currentLayer;
  if (event.key === 'ArrowUp') targetLayer -= 1;
  else if (event.key === 'ArrowDown') targetLayer += 1;
  else if (event.key === 'Home') targetLayer = 1;
  else if (event.key === 'End') targetLayer = state.deepestLayer;
  else return;
  event.preventDefault();
  focusLayer(
    Math.max(1, Math.min(state.deepestLayer, targetLayer)),
  );
});

applySettings();
applyWorkspaceView('mine');
setMineSection(activeMineSection);
mineScene.setLayerWindowCount(activeLayerWindowCount);
updateUI();
scheduleInitialModals();
requestAnimationFrame(gameLoop);

window.addEventListener('resize', () => {
  const nextCount = getResponsiveLayerCount(window.innerWidth);
  if (nextCount === activeLayerWindowCount) return;
  activeLayerWindowCount = nextCount;
  mineScene.setLayerWindowCount(nextCount);
  sceneHitareaSignature = '';
  layerRailSignature = '';
  updateSceneLayerHitareas();
  updateLayerRail();
});

document.addEventListener(
  'pointerdown',
  () => sfx.unlock(),
  { once: true, capture: true },
);

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const viewButton = target.closest<HTMLElement>('button[data-view]');
  if (viewButton) {
    applyWorkspaceView(viewButton.dataset.view as WorkspaceView);
    return;
  }
  const sheetButton = target.closest<HTMLElement>('[data-sheet]');
  if (sheetButton) {
    openSheet(sheetButton.dataset.sheet as SheetName);
    return;
  }
  const actionButton = target.closest<HTMLElement>('[data-action]');
  if (!actionButton) return;
  handleAction(actionButton);
});

document.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const key = target.dataset.volume as VolumeKey | undefined;
  if (!key) return;
  const value = Math.min(1, Math.max(0, Number(target.value) / 100));
  state.settings[key] = value;
  if (key === 'sfxVolume') sfx.setSfxVolume(value);
  if (key === 'musicVolume') sfx.setMusicVolume(value);
  const output = document.querySelector<HTMLElement>(
    `[data-volume-output="${key}"]`,
  );
  if (output) output.textContent = `${Math.round(value * 100)}%`;
});

document.addEventListener('change', (event) => {
  const target = event.target;
  if (
    target instanceof HTMLSelectElement &&
    target.id === 'layer-jump-select'
  ) {
    focusLayer(Number(target.value));
    return;
  }
  if (target instanceof HTMLInputElement && target.dataset.volume) {
    saveNow(false);
  }
});

document.addEventListener('keydown', (event) => {
  if (!modalRoot.classList.contains('hidden')) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key === 'Tab') {
      trapModalFocus(event);
      return;
    }
  }

  const active = document.activeElement;
  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement
  ) {
    return;
  }
  if (!modalRoot.classList.contains('hidden')) return;

  if (event.code === 'Digit1') {
    event.preventDefault();
    activateLine('drill');
  } else if (event.code === 'Digit2') {
    event.preventDefault();
    activateLine('lift');
  } else if (event.code === 'Digit3') {
    event.preventDefault();
    activateLine('truck');
  } else if (event.code === 'Space') {
    event.preventDefault();
    handleRecommendedUpgrade();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    lastHiddenAt = Date.now();
    sfx.setMusicEnabled(false);
    saveNow(false);
    return;
  }

  lastFrameAt = performance.now();
  if (state.settings.music) sfx.setMusicEnabled(true);
  if (lastHiddenAt > 0) {
    absorbOfflineTime(Date.now());
    lastHiddenAt = 0;
  }
});

window.addEventListener('pagehide', () => saveNow(false));
window.addEventListener('beforeunload', () => saveNow(false));

if (loadedSave.warning) {
  window.setTimeout(() => toast(loadedSave.warning ?? '', 'error', 4200), 400);
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js');
  });
}

window.setTimeout(() => {
  const canvas = document.querySelector<HTMLCanvasElement>('#mine-stage canvas');
  canvas?.setAttribute('aria-label', '矿井剖面动画：矿工、卷扬机和运输车正在工作');
}, 300);

function lineCardTemplate(line: LineId): string {
  const meta = LINE_META[line];
  return `
    <article class="line-action" id="line-${line}-card" data-line="${line}">
      <div class="line-head">
        <div class="line-title">
          <span class="line-icon" aria-hidden="true"><i data-lucide="${meta.icon}"></i></span>
          <div>
            <span class="line-kicker">${meta.kicker}</span>
            <h3>${meta.title}</h3>
          </div>
        </div>
        <span class="level-tag" id="line-${line}-level">Lv.1</span>
      </div>
      <div class="line-metrics">
        <div class="metric">
          <span>${line === 'drill' ? '单次产量' : '载重上限'}</span>
          <strong id="line-${line}-capacity">1 吨</strong>
        </div>
        <div class="metric">
          <span>${line === 'drill' ? '单趟耗时' : '满载耗时'}</span>
          <strong id="line-${line}-duration">1.5 秒</strong>
        </div>
      </div>
      <div class="progress-track" aria-hidden="true">
        <span class="progress-fill" id="line-${line}-progress"></span>
      </div>
      <div class="line-load-row">
        <span id="line-${line}-load">本趟估值 ¥0</span>
        <strong id="line-${line}-source">等待来料</strong>
      </div>
      <div class="line-status">
        <strong id="line-${line}-status">等待开工</strong>
        <span id="line-${line}-queue">未排队</span>
      </div>
      <div class="line-queue-row">
        <span class="line-queue-pips" id="line-${line}-queue-pips" aria-label="预排班次"></span>
        <button class="line-queue-all" id="line-${line}-queue-all" type="button" data-action="queue-five" data-line="${line}">
          一键排满 5 班
        </button>
      </div>
      <div class="line-buttons">
        <button class="action-button" id="line-${line}-primary" type="button" data-action="queue" data-line="${line}" title="快捷键 ${line === 'drill' ? '1' : line === 'lift' ? '2' : '3'}">
          <i data-lucide="${meta.icon}"></i>
          <span id="line-${line}-primary-label">${meta.verb}</span>
          <span class="queue-count hidden" id="line-${line}-queue-count">0</span>
        </button>
        <button class="secondary-button" id="line-${line}-upgrade" type="button" data-action="upgrade" data-line="${line}">
          <span id="line-${line}-upgrade-label">升级 ¥12</span>
        </button>
      </div>
      <button class="automation-button" id="line-${line}-automation" type="button" data-action="automation" data-line="${line}">
        <span><i data-lucide="hard-hat"></i> ${line === 'drill' ? '本层监工' : '雇全局接驳监工'}</span>
        <strong id="line-${line}-automation-label">¥32</strong>
      </button>
    </article>
  `;
}

function dailyRowsTemplate(): string {
  return `
    ${taskRowTemplate('trips', '完成运输', `0 / ${DAILY_GOALS.trips}`)}
    ${taskRowTemplate('upgrades', '升级设备', `0 / ${DAILY_GOALS.upgrades}`)}
    ${taskRowTemplate('starts', '启动生产线', `0 / ${DAILY_GOALS.starts}`)}
  `;
}

function taskRowTemplate(key: string, title: string, value: string): string {
  return `
    <div class="task-row" data-task="${key}">
      <div class="task-copy">
        <strong>${title}</strong>
        <span>${key === 'trips' ? '每天累计' : key === 'upgrades' ? '任意设备都可以' : '钻探、起吊和发车'}</span>
      </div>
      <span class="task-value">${value}</span>
      <div class="mini-progress"><span></span></div>
    </div>
  `;
}

function managerIcon(icon: string): string {
  return icon === 'drill' ? 'pickaxe' : icon;
}

function managerRowTemplate(managerId: ManagerId, compact = false): string {
  const manager = MANAGER_BY_ID[managerId];
  const owned = state.managers[managerId];
  const locked = state.deepestLayer < manager.unlockLayer;
  const buttonClass = owned ? 'is-owned' : locked ? 'is-locked' : '';
  const label = owned
    ? '在岗'
    : locked
      ? `第 ${manager.unlockLayer} 层`
      : formatMoney(manager.cost);
  return `
    <div class="manager-row">
      <span class="manager-avatar" style="--manager-accent:${manager.accent}" aria-hidden="true">
        <i data-lucide="${managerIcon(manager.icon)}"></i>
      </span>
      <div class="manager-copy">
        <strong>${manager.name} <small>${manager.title}</small></strong>
        <p>${manager.description}${compact ? '' : ''}</p>
      </div>
      <button
        class="${buttonClass}"
        type="button"
        data-action="hire-manager"
        data-manager="${manager.id}"
        ${owned ? 'disabled' : ''}
      >${label}</button>
    </div>
  `;
}

function updateUI(): void {
  const allAutomated = getAllLinesAutomated(state);
  const automatedLayers = getAutomatedDrillLayerCount(state);
  const automatedFreight = LINE_IDS.filter(
    (line) => line !== 'drill' && isLineAutomated(state, line, false),
  ).length;
  const networkFullyAutomated =
    automatedLayers >= state.deepestLayer && automatedFreight === 2;
  const stockedLayers = Object.keys(state.layers).filter(
    (key) =>
      Number(key) <= state.deepestLayer &&
      (state.layerCargo[Number(key)]?.underground.units ?? 0) > 0.01,
  ).length;
  const estimatedRevenue = getEstimatedRevenuePerSecond(state);
  const dailyCount = [
    state.daily.trips >= DAILY_GOALS.trips,
    state.daily.upgrades >= DAILY_GOALS.upgrades,
    state.daily.starts >= DAILY_GOALS.starts,
  ].filter(Boolean).length;
  const layer = getLayerDefinition(state.currentLayer);
  const saleMultiplier = getSaleMultiplier(state);
  const prestigeBonus =
    (1 + state.prestigeMarks * 0.1) * getPrestigeRunMultiplier(state);

  moneyValue.textContent = formatMoney(state.money);
  incomeValue.textContent = networkFullyAutomated
    ? `${formatRate(estimatedRevenue)} · 全矿监工值守`
    : `钻层 ${automatedLayers}/${state.deepestLayer} · 接驳 ${automatedFreight}/2`;
  companyLevelChip.textContent = `公司 Lv.${state.companyLevel}`;

  if (state.adBoostSeconds > 0) {
    adBoostChip.classList.remove('hidden');
    adBoostChip.classList.add('is-warm');
    setIconHtml(
      adBoostChip,
      iconText('zap', `双倍 ${formatTimer(state.adBoostSeconds)}`),
    );
  } else {
    adBoostChip.classList.add('hidden');
  }

  if (
    state.richVeinSeconds > 0 ||
    state.goldenShiftSeconds > 0 ||
    state.adCrewSeconds > 0
  ) {
    specialBoostChip.classList.remove('hidden');
    specialBoostChip.classList.add('is-cool');
    if (state.richVeinSeconds > 0) {
      setIconHtml(
        specialBoostChip,
        iconText(
          'sparkles',
          `矿脉 ×${state.managers['xing-yun'] ? '3.25' : '2.5'} ${formatTimer(state.richVeinSeconds)}`,
        ),
      );
    } else if (state.goldenShiftSeconds > 0) {
      setIconHtml(
        specialBoostChip,
        iconText(
          'gift',
          `黄金班次 ×1.5 ${formatTimer(state.goldenShiftSeconds)}`,
        ),
      );
    } else {
      setIconHtml(
        specialBoostChip,
        iconText(
          'hard-hat',
          `临时工班 ${formatTimer(state.adCrewSeconds)}`,
        ),
      );
    }
  } else {
    specialBoostChip.classList.add('hidden');
  }

  dailySummary.textContent = `${dailyCount} / 3`;
  quickTaskLabel.textContent = `今日 ${dailyCount} / 3`;
  updateDailyRows(document);

  layerRarity.textContent = layer.rarity;
  layerUnitValue.textContent = formatMoney(getUnitSaleValue(state));
  museumCount.textContent = `${state.museum.length} 种`;
  const currentCrew = state.layers[state.currentLayer]?.crewLevel ?? 1;
  const currentCrewCost = getLayerCrewUpgradeCost(state, state.currentLayer);
  currentLayerCrew.textContent = `${currentCrew} / ${MAX_LAYER_CREW} 人`;
  currentLayerCrewEffect.textContent =
    currentCrew >= MAX_LAYER_CREW
      ? '本层已达到 5 人满编'
      : '再扩编：产量 +45%，钻速 +7%';
  currentLayerCrewButton.dataset.layer = String(state.currentLayer);
  currentLayerCrewButton.disabled = currentCrew >= MAX_LAYER_CREW;
  currentLayerCrewLabel.textContent =
    currentCrew >= MAX_LAYER_CREW
      ? '5 人满编'
      : `扩编 ${formatMoney(currentCrewCost)}`;
  currentLayerCrewButton.classList.toggle(
    'is-short',
    currentCrew < MAX_LAYER_CREW && state.money < currentCrewCost,
  );
  currentLayerCrewButton.classList.toggle(
    'is-ready',
    currentCrew < MAX_LAYER_CREW && state.money >= currentCrewCost,
  );
  deepestLayerLabel.textContent = `最深 ${state.deepestLayer} 层`;
  statTrips.textContent = `${formatCompact(state.stats.totalTrips)} 次`;
  statUnits.textContent = formatMoney(state.lifetimeEarnings);
  statBestSale.textContent = formatMoney(state.stats.bestSale);
  offlineCap.textContent = formatOfflineCap(getOfflineCapSeconds(state));

  const nextLayer = Math.min(state.deepestLayer + 1, 10_000);
  const atBoundary = state.deepestLayer >= 10_000;
  const nextCost = atBoundary ? 0 : getNextLayerCost(nextLayer);
  const deepestLayerDefinition = getLayerDefinition(state.deepestLayer);
  unlockLayerLabel.textContent = atBoundary
    ? '已到当前地心边界'
    : `第 ${nextLayer} 层 · ${getLayerDefinition(nextLayer).name}`;
  unlockLayerCost.textContent = atBoundary ? 'MAX' : formatMoney(nextCost);
  const unlockProgress = atBoundary
    ? 1
    : Math.min(1, state.money / Math.max(1, nextCost));
  unlockMeterFill.style.width = `${unlockProgress * 100}%`;
  unlockMeter.classList.toggle('is-ready', atBoundary || state.money >= nextCost);
  unlockMeterText.textContent = atBoundary
    ? '当前版本已挖到地心边界'
    : state.money >= nextCost
      ? '资金已够，可以解锁'
      : `距离下一层还差 ${formatMoney(nextCost - state.money)}`;
  unlockLayerGap.textContent = atBoundary
    ? '已完成当前地心路线'
    : `下一层单价 +${Math.round((getLayerDefinition(nextLayer).baseValue / Math.max(0.001, deepestLayerDefinition.baseValue) - 1) * 100)}%`;
  unlockLayerButton.classList.toggle('is-short', !atBoundary && state.money < nextCost);
  unlockLayerButton.classList.toggle('is-ready', !atBoundary && state.money >= nextCost);
  unlockLayerButton.disabled = atBoundary;
  sceneFrontierButton.disabled = atBoundary;
  sceneFrontierButton.classList.toggle(
    'is-ready',
    !atBoundary && state.money >= nextCost,
  );
  sceneFrontierLabel.textContent = atBoundary
    ? '已到当前边界'
    : `解锁 ${String(nextLayer).padStart(2, '0')} · ${getLayerDefinition(nextLayer).name}`;
  sceneFrontierCost.textContent = atBoundary ? 'MAX' : formatMoney(nextCost);
  sceneFrontierButton.setAttribute(
    'aria-label',
    atBoundary
      ? '已到当前矿层边界'
      : `花费 ${formatMoney(nextCost)} 解锁第 ${nextLayer} 层`,
  );
  unlockLayerButton.setAttribute(
    'aria-label',
    atBoundary
      ? '已到当前矿层边界'
      : `花费 ${formatMoney(nextCost)} 解锁第 ${nextLayer} 层`,
  );

  sceneLayerLabel.textContent = `矿层 ${String(layer.index).padStart(2, '0')} · ${layer.name} · ${formatCompact(layer.depthMeters)}m`;
  sceneCurrentLayerName.textContent = `${String(layer.index).padStart(2, '0')} · ${layer.name}`;
  sceneCurrentLayerCargo.textContent = `井下估值 ${projectedMoney(state.underground.totalValue)}`;
  sceneLayerPrev.disabled = state.currentLayer <= 1;
  sceneLayerNext.disabled = state.currentLayer >= state.deepestLayer;
  sceneClockLabel.textContent = `营业 ${formatCompact(state.playSeconds)} 秒`;
  sceneUnderground.textContent = `井下货值 ${projectedMoney(state.underground.totalValue)}`;
  sceneSurface.textContent = `地面货值 ${projectedMoney(state.surface.totalValue)}`;
  sceneMultiplier.textContent = `收益 ×${formatMultiplier(saleMultiplier)}`;
  layerRailSummary.textContent = `${state.deepestLayer} 层已解锁 · ${automatedLayers} 层监工值守 · ${stockedLayers} 层有货`;
  updateSceneLayerHitareas();
  richVeinBanner.classList.toggle('hidden', state.richVeinSeconds <= 0);
  richVeinBanner.textContent = `超级矿脉 ×${state.managers['xing-yun'] ? '3.25' : '2.5'} · ${Math.ceil(state.richVeinSeconds)} 秒`;

  for (const line of LINE_IDS) updateLine(line);

  const recommendedLine = getRecommendedUpgradeLine(state);
  const recommendedCost = getLineUpgradeCost(
    recommendedLine,
    state.lines[recommendedLine].level,
  );
  recommendedUpgradeLabel.textContent = `${LINE_LABELS[recommendedLine]}设备 Lv.${state.lines[recommendedLine].level} → ${state.lines[recommendedLine].level + 1}`;
  recommendedUpgradeCost.textContent = formatMoney(recommendedCost);
  recommendedUpgradeButton.classList.toggle('is-short', state.money < recommendedCost);
  recommendedUpgradeButton.classList.toggle(
    'is-ready',
    state.money >= recommendedCost,
  );
  diagnosticBottleneck.textContent = LINE_LABELS[recommendedLine];
  diagnosticUpgrade.textContent = `${LINE_LABELS[recommendedLine]} Lv.${state.lines[recommendedLine].level}`;
  diagnosticHint.textContent =
    recommendedLine === 'drill'
      ? '钻探最慢：优先升级钻机，或扩编当前矿层班组。'
      : recommendedLine === 'lift'
        ? '起吊最慢：升级卷扬机可减少井口积压。'
        : '车队长途运输最慢：升级后能更快把地面矿石变成资金。';

  updateTextAll('[data-company-level]', `公司 Lv.${state.companyLevel}`);
  updateTextAll(
    '[data-company-xp]',
    `${formatCompact(state.companyXp)} / ${formatCompact(getCompanyLevelRequirement(state.companyLevel))}`,
  );
  updateWidthAll('[data-company-xp-fill]', getCompanyProgress(state) * 100);
  estimatedIncome.textContent = allAutomated ? formatRate(estimatedRevenue) : '待本层接驳齐';
  permanentBonus.textContent = `×${formatMultiplier(
    prestigeBonus * (1 + state.museum.length * 0.01),
  )}`;

  if (state.adBoostSeconds > 0) {
    boostState.textContent = '双倍收益运行中';
    boostTimer.textContent = `${formatTimer(state.adBoostSeconds)} · 可储备至 30 分钟`;
    desktopAdButton.disabled = state.adBoostSeconds >= 29 * 60;
  } else {
    boostState.textContent = '尚未加速';
    boostTimer.textContent = '最多储备 30 分钟';
    desktopAdButton.disabled = !state.tutorialCompleted && state.playSeconds < 120;
  }
  const adCopy = desktopAdButton.querySelector<HTMLElement>('.wide-button-copy strong');
  if (adCopy) {
    adCopy.textContent =
      !state.tutorialCompleted && state.playSeconds < 120
        ? '完成新手引导后开放'
        : state.adBoostSeconds >= 29 * 60
          ? '双倍收益储备已接近上限'
          : '储备 15 分钟双倍收益';
  }

  updateTutorial();
  updateSceneCommand();
  updateMineLayerScrollbar();
  updateLayerToolbar();
  updateLayerRail();
  updateManagers();

  mobileTasksButton.classList.toggle(
    'is-primary',
    canClaimDailyReward(state) && !state.daily.rewardClaimed,
  );
  dailyClaimButton.disabled = !canClaimDailyReward(state);
  dailyClaimButton.classList.toggle('is-primary', canClaimDailyReward(state));
}

function updateMineLayerScrollbar(): void {
  const maximum = Math.max(1, state.deepestLayer);
  const ratio =
    maximum <= 1 ? 0 : (state.currentLayer - 1) / (maximum - 1);
  mineLayerScrollbarThumb.style.top = `${ratio * 100}%`;
  mineLayerScrollbar.classList.toggle('is-disabled', maximum <= 1);
  mineLayerScrollbar.setAttribute('aria-valuemin', '1');
  mineLayerScrollbar.setAttribute('aria-valuemax', String(maximum));
  mineLayerScrollbar.setAttribute('aria-valuenow', String(state.currentLayer));
  mineLayerScrollbar.setAttribute(
    'aria-valuetext',
    `第 ${state.currentLayer} 层，共 ${maximum} 层`,
  );
}

function updateLine(line: LineId): void {
  const refs = lineRefs[line];
  const lineState = state.lines[line];
  const drillState = state.layers[state.currentLayer];
  const workingState = line === 'drill' ? drillState : lineState;
  const active = workingState.active;
  const queued = workingState.queued;
  const permanentAutomated =
    line === 'drill'
      ? isDrillLayerAutomated(state, state.currentLayer, false)
      : isLineAutomated(state, line, false);
  const temporaryCrew = state.adCrewSeconds > 0;
  const automated = permanentAutomated || temporaryCrew;
  const capacity =
    line === 'drill'
      ? getDrillCapacityAtLayer(state, state.currentLayer)
      : getLineCapacity(state, line);
  const sourceLayer = line === 'drill'
    ? state.currentLayer
    : workingState.payloadLayer || state.currentLayer;
  const sourceDefinition = getLayerDefinition(sourceLayer);
  const duration = active
    ? workingState.tripDuration || getLineTripDuration(state, line, capacity, sourceLayer)
    : getLineTripDuration(state, line, capacity, sourceLayer);
  const progress = active
    ? Math.min(1, workingState.progress / Math.max(0.001, workingState.tripDuration || duration))
    : 0;
  const upgradeCost = getLineUpgradeCost(line, lineState.level);
  const automationCost = getAutomationCost(line, state.currentLayer);
  const payloadUnits = workingState.payload.units;
  const payloadValue = workingState.payload.totalValue;
  const status = active
    ? automated
      ? temporaryCrew && !permanentAutomated
        ? '临时工班运行中'
        : '监工值守中'
      : '正在执行'
    : automated
      ? line === 'drill'
        ? temporaryCrew && !permanentAutomated
          ? '本层临时工班待命'
          : '本层监工值守'
        : temporaryCrew && !permanentAutomated
          ? '接驳临时工班待命'
          : '全局接驳待料'
      : queued > 0
        ? line === 'drill'
          ? '钻探班已排班'
          : '等待来料'
        : '等待开工';
  refs.level.textContent = `Lv.${lineState.level} · ${equipmentTierLabel(lineState.level, line)}`;
  refs.capacity.textContent = `${formatCompact(capacity)} 吨`;
  refs.duration.textContent = active
    ? `${formatCompact(duration)} 秒 · 已锁`
    : `${formatCompact(duration)} 秒`;
  refs.load.textContent =
    payloadUnits > 0.01
      ? `本趟估值 ${projectedMoney(payloadValue)} · 载重 ${formatCompact(payloadUnits)}/${formatCompact(capacity)} 吨`
      : `本趟估值 ¥0 · 载重 0/${formatCompact(capacity)} 吨`;
  refs.source.textContent = line === 'drill'
    ? `第 ${sourceDefinition.index} 层 · ${state.layers[state.currentLayer]?.crewLevel ?? 1} 人班 · 全矿同步`
    : active && workingState.payloadLayer > 0
      ? line === 'lift'
        ? `第 ${sourceDefinition.index} 层 → 地面`
        : `地面货物 → 总部`
      : line === 'lift'
        ? '等待井口来货'
        : '等待地面装车';
  refs.progress.style.width = `${progress * 100}%`;
  refs.status.textContent = status;
  refs.queue.textContent =
    queued > 0
      ? `排队 ${queued} / ${MAX_MANUAL_QUEUE} 趟`
      : automated
        ? '无需排队'
        : '未排队';
  refs.primary.disabled = automated || queued >= MAX_MANUAL_QUEUE;
  refs.primaryLabel.textContent = automated
    ? temporaryCrew && !permanentAutomated
      ? '临时工班'
      : '监工中'
    : queued >= MAX_MANUAL_QUEUE
      ? '队列已满'
      : LINE_META[line].verb;
  refs.queueCount.textContent = String(queued);
  refs.queueCount.classList.toggle('hidden', queued <= 0);
  if (refs.queuePips.dataset.signature !== String(queued)) {
    refs.queuePips.dataset.signature = String(queued);
    refs.queuePips.innerHTML = Array.from(
      { length: MAX_MANUAL_QUEUE },
      (_, index) =>
        `<i class="${index < queued ? 'is-filled' : ''}" aria-hidden="true"></i>`,
    ).join('');
  }
  refs.queuePips.setAttribute(
    'aria-label',
    `已预排 ${queued} 个班次，最多 ${MAX_MANUAL_QUEUE} 个`,
  );
  refs.queueAll.disabled = automated || queued >= MAX_MANUAL_QUEUE;
  refs.queueAll.parentElement?.classList.toggle('hidden', automated);
  refs.queueAll.textContent =
    automated
      ? '监工接管中'
      : queued >= MAX_MANUAL_QUEUE
        ? '5 班已排满'
        : `一键排满 ${MAX_MANUAL_QUEUE - queued} 班`;
  const currentTier = equipmentTierLevel(lineState.level);
  const nextTier = equipmentTierLevel(lineState.level + 1);
  const tierChange = nextTier > currentTier;
  refs.upgradeLabel.textContent = tierChange
    ? `换代 ${equipmentTierLabel(lineState.level + 1, line)} · ${formatMoney(upgradeCost)}`
    : `升级 ${formatMoney(upgradeCost)}`;
  refs.upgrade.title = tierChange
    ? `下一次升级会改变设备外观：${equipmentTierLabel(lineState.level + 1, line)}`
    : `提升 ${LINE_META[line].title} 的产能与速度`;
  refs.upgrade.classList.toggle('is-tier-up', tierChange);
  refs.upgrade.classList.toggle('is-short', state.money < upgradeCost);
  refs.upgrade.classList.toggle('is-ready', state.money >= upgradeCost);
  refs.automation.disabled = automated;
  refs.automation.classList.toggle(
    'is-ready',
    !automated && state.money >= automationCost,
  );
  refs.automation.classList.toggle('is-owned', permanentAutomated);
  refs.automationLabel.textContent = permanentAutomated
    ? '监工在岗'
    : temporaryCrew
      ? '临时工班中'
      : line === 'drill'
        ? `第 ${state.currentLayer} 层 ${formatMoney(automationCost)}`
        : `雇监工 ${formatMoney(automationCost)}`;
}

function updateTutorial(): void {
  if (skipAutomatedTutorialSteps()) saveNow(false);
  clearTutorialTarget();
  if (state.tutorialCompleted || state.tutorialStep >= TUTORIAL_STEPS.length) {
    tutorialBanner.classList.add('hidden');
    return;
  }

  const step = TUTORIAL_STEPS[state.tutorialStep];
  if (!step) return;
  tutorialBanner.classList.remove('hidden');
  tutorialStep.textContent = `${state.tutorialStep + 1}/7`;
  tutorialKicker.textContent = `新手任务 · 第 ${state.tutorialStep + 1} 步`;
  tutorialTitle.textContent = step.title;
  tutorialPrimaryLabel.textContent = step.actionLabel;
  tutorialPrimary.classList.remove('is-waiting');
  tutorialPrimary.disabled = false;
  tutorialProgressFill.style.width = `${((state.tutorialStep + 1) / TUTORIAL_STEPS.length) * 100}%`;

  let detail = step.detail;
  const stepCost =
    step.action === 'upgrade'
      ? getLineUpgradeCost('drill', state.lines.drill.level)
      : step.action === 'automation'
        ? getAutomationCost(step.line, state.currentLayer)
        : 0;
  if (stepCost > state.money) {
    const missing = stepCost - state.money;
    detail += ` 还差 ${formatMoney(missing)}。`;
    tutorialPrimaryLabel.textContent = `还差 ${formatMoney(missing)}`;
    tutorialPrimary.disabled = true;
    tutorialPrimary.classList.add('is-waiting');
  }
  tutorialDetail.textContent = detail;
  tutorialPrimary.setAttribute(
    'aria-label',
    tutorialPrimary.disabled
      ? `资金不足，还差 ${formatMoney(Math.max(0, stepCost - state.money))}`
      : step.actionLabel,
  );
  tutorialTarget = lineRefs[step.line].root;
  tutorialTarget.classList.add('is-tutorial-target');
}

function skipAutomatedTutorialSteps(): boolean {
  let changed = false;
  while (!state.tutorialCompleted && state.tutorialStep < TUTORIAL_STEPS.length) {
    const step = TUTORIAL_STEPS[state.tutorialStep];
    if (!step) break;
    const automated =
      step.line === 'drill'
        ? isDrillLayerAutomated(state, state.currentLayer, true)
        : isLineAutomated(state, step.line, true);
    const unavailable =
      (step.action === 'queue' || step.action === 'automation') && automated;
    if (!unavailable) break;
    state.tutorialStep += 1;
    changed = true;
  }
  if (!state.tutorialCompleted && state.tutorialStep >= TUTORIAL_STEPS.length) {
    state.tutorialCompleted = true;
    changed = true;
  }
  return changed;
}

function clearTutorialTarget(): void {
  tutorialTarget?.classList.remove('is-tutorial-target');
  tutorialTarget = null;
}

function setMineSection(section: 'production' | 'layers'): void {
  activeMineSection = section;
  gameApp.dataset.mineSection = section;
  document
    .querySelectorAll<HTMLButtonElement>('[data-action="mine-section"]')
    .forEach((button) => {
      const active = button.dataset.section === section;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
}

function updateSceneCommand(): void {
  if (!state.tutorialCompleted) {
    sceneCommandButton.classList.add('hidden');
    return;
  }
  sceneCommandButton.classList.remove('hidden');
  const candidates: LineId[] = ['drill', 'lift', 'truck'];
  const line = candidates.find((candidate) =>
    candidate === 'drill'
      ? !isDrillLayerAutomated(state, state.currentLayer, false)
      : !isLineAutomated(state, candidate, false),
  );
  if (line) {
    sceneCommandMode = 'queue';
    sceneCommandLine = line;
    sceneCommandLabel.textContent = `一键${LINE_META[line].verb} ×5`;
    sceneCommandButton.disabled = false;
    sceneCommandButton.classList.remove('is-boost');
    return;
  }
  sceneCommandMode = 'ad';
  sceneCommandLabel.textContent =
    state.adBoostSeconds >= 29 * 60 ? '收益已满档' : '双倍收益';
  sceneCommandButton.disabled = state.adBoostSeconds >= 29 * 60;
  sceneCommandButton.classList.add('is-boost');
}

function updateDailyRows(root: ParentNode): void {
  const values: Record<'trips' | 'upgrades' | 'starts', { current: number; target: number }> = {
    trips: { current: state.daily.trips, target: DAILY_GOALS.trips },
    upgrades: { current: state.daily.upgrades, target: DAILY_GOALS.upgrades },
    starts: { current: state.daily.starts, target: DAILY_GOALS.starts },
  };
  for (const [key, progress] of Object.entries(values) as [
    keyof typeof values,
    { current: number; target: number },
  ][]) {
    const ratio = Math.min(1, progress.current / progress.target);
    root.querySelectorAll<HTMLElement>(`[data-task="${key}"]`).forEach((row) => {
      row.classList.toggle('is-done', ratio >= 1);
      const value = row.querySelector<HTMLElement>('.task-value');
      const fill = row.querySelector<HTMLElement>('.mini-progress > span');
      if (value) {
        value.textContent = `${Math.min(progress.current, progress.target)} / ${progress.target}`;
        value.classList.toggle('is-done', ratio >= 1);
      }
      if (fill) fill.style.width = `${ratio * 100}%`;
    });
  }
  root.querySelectorAll<HTMLButtonElement>('[data-action="claim-daily"]').forEach((button) => {
    button.disabled = !canClaimDailyReward(state);
  });
}

function getLayerActivity(index: number): {
  label: string;
  detail: string;
  tone: string;
  progress: number;
} {
  const mining = state.layers[index];
  const cargo = state.layerCargo[index];
  const temporaryCrew = state.adCrewSeconds > 0;
  const automated = Boolean(mining?.automated || temporaryCrew);
  const active = Boolean(mining?.active);
  const queued = mining?.queued ?? 0;
  const underground = cargo?.underground.units ?? 0;
  const surface = cargo?.surface.units ?? 0;
  const undergroundValue = cargo?.underground.totalValue ?? 0;
  const surfaceValue = cargo?.surface.totalValue ?? 0;
  const crewLevel = mining?.crewLevel ?? 1;
  const crewText = `${crewLevel}/${MAX_LAYER_CREW} 人`;
  const cargoText = `井口 ${projectedMoney(undergroundValue)} · 地面 ${projectedMoney(surfaceValue)}`;
  const progress = active
    ? Math.min(1, (mining?.progress ?? 0) / Math.max(0.001, mining?.tripDuration ?? 1))
    : 0;

  if (active) {
    return {
      label: automated ? '监工钻探中' : '人工钻探中',
      detail: `${crewText} · ${cargoText}`,
      tone: 'is-running',
      progress,
    };
  }
  if (queued > 0) {
    return {
      label: `已排班 ${queued} 趟`,
      detail: `${crewText} · ${cargoText}`,
      tone: 'is-queued',
      progress,
    };
  }
  if (automated) {
    return {
      label: temporaryCrew ? '临时工班待命' : '监工值守',
      detail: `${crewText} · ${cargoText}`,
      tone: 'is-auto',
      progress,
    };
  }
  if (underground > 0.01 || surface > 0.01) {
    return {
      label: '货物等待接驳',
      detail: `${crewText} · ${cargoText}`,
      tone: 'is-stocked',
      progress,
    };
  }
  return {
    label: '班组待命',
    detail: `${crewText} · 点“本层开挖”独立开工`,
    tone: 'is-idle',
    progress,
  };
}

function layerSignatureFor(indices: number[]): string {
  return indices
    .map((index) => {
      const activity = getLayerActivity(index);
      const mining = state.layers[index];
      return [
        index,
        activity.label,
        activity.tone,
        mining?.automated ? 1 : 0,
        mining?.crewLevel ?? 1,
        mining?.queued ?? 0,
      ].join(':');
    })
    .join('|');
}

function updateSceneLayerHitareas(): void {
  const indices = getVisibleLayerWindow(
    state.currentLayer,
    state.deepestLayer,
    activeLayerWindowCount,
  );
  const first = indices[0] ?? 1;
  const last = indices.at(-1) ?? first;
  const count = indices.length;
  const signature = `${first}:${last}:${state.deepestLayer}:${state.currentLayer}`;
  if (signature !== sceneHitareaSignature) {
    sceneHitareaSignature = signature;
    const gap = 4;
  const bandHeight = (516 - 184 - gap * Math.max(0, count - 1)) / count;
    sceneLayerHitareas.innerHTML = indices
      .map((index, offset) => {
        const layer = getLayerDefinition(index);
      const y = 184 + offset * (bandHeight + gap);
        const locked = index > state.deepestLayer;
        return `
          <button
            type="button"
            data-action="focus-layer"
            data-layer="${index}"
            class="${index === state.currentLayer ? 'is-current' : ''}${locked ? ' is-locked' : ''}"
            style="top:${(y / 540) * 100}%;height:${(bandHeight / 540) * 100}%"
          >
            <span class="scene-layer-title" data-scene-title="${index}">${String(index).padStart(2, '0')} ${layer.name}</span>
            <span class="scene-layer-status" data-scene-status="${index}"></span>
            <span class="scene-layer-cargo" data-scene-cargo="${index}"></span>
            <span class="scene-layer-progress" aria-hidden="true">
              <span data-scene-progress="${index}"></span>
            </span>
          </button>
        `;
      })
      .join('');
  }

  for (const index of indices) {
    const button = sceneLayerHitareas.querySelector<HTMLButtonElement>(
      `button[data-layer="${index}"]`,
    );
    if (!button) continue;
    const layer = getLayerDefinition(index);
    const mining = state.layers[index];
    const cargoValue = state.layerCargo[index]?.underground.totalValue ?? 0;
    const payloadValue = mining?.payload.totalValue ?? 0;
    const crewLevel = mining?.crewLevel ?? 1;
    const queued = mining?.queued ?? 0;
    const active = Boolean(mining?.active);
    const automated = Boolean(mining?.automated || state.adCrewSeconds > 0);
    const activity = getLayerActivity(index);
    const locked = index > state.deepestLayer;
    button.classList.toggle('is-current', index === state.currentLayer);
    button.classList.toggle('is-locked', locked);
    button.classList.toggle('is-running', activity.tone === 'is-running');
    button.classList.toggle('is-queued', activity.tone === 'is-queued');
    button.classList.toggle('is-auto', activity.tone === 'is-auto');
    button.classList.toggle('is-stocked', activity.tone === 'is-stocked');
    button.setAttribute(
      'aria-label',
      locked
        ? `第 ${index} 层尚未解锁`
        : `观察第 ${index} 层 ${layer.name}，${activity.label}`,
    );
    const title = button.querySelector<HTMLElement>(`[data-scene-title="${index}"]`);
    const status = button.querySelector<HTMLElement>(`[data-scene-status="${index}"]`);
    const cargoText = button.querySelector<HTMLElement>(`[data-scene-cargo="${index}"]`);
    const progress = button.querySelector<HTMLElement>(`[data-scene-progress="${index}"]`);
    const statusLabel = locked
      ? '未解锁'
      : active
        ? automated
          ? `监工 · ${crewLevel}人`
          : `${crewLevel}人钻探`
        : queued > 0
          ? `排班 · ${queued}趟`
          : automated
            ? `监工 · ${crewLevel}人`
            : `${crewLevel}人待命`;
    if (title) title.textContent = `${String(index).padStart(2, '0')} ${layer.name}`;
    if (status) status.textContent = statusLabel;
    if (cargoText) {
      cargoText.textContent = locked
        ? '等待勘探'
        : `井口 ${projectedMoney(cargoValue)}${payloadValue > 0.01 ? ` · 本趟 ${projectedMoney(payloadValue)}` : ''}`;
    }
    if (progress) {
      progress.style.width = `${activity.progress * 100}%`;
    }
  }
}

function updateLayerToolbar(): void {
  if (layerNavigatorDeepest !== state.deepestLayer) {
    layerNavigatorDeepest = state.deepestLayer;
    layerJumpSelect.innerHTML = Array.from(
      { length: state.deepestLayer },
      (_, offset) => {
        const index = offset + 1;
        const layer = getLayerDefinition(index);
        return `<option value="${index}">${String(index).padStart(2, '0')} ${layer.name} · ${formatMoney(layer.baseValue)}</option>`;
      },
    ).join('');
  }
  layerJumpSelect.value = String(state.currentLayer);
  const layerIndex = state.currentLayer;
  const mining = state.layers[layerIndex];
  const automated = Boolean(mining?.automated || state.adCrewSeconds > 0);
  const crewLevel = mining?.crewLevel ?? 1;
  const crewCost = getLayerCrewUpgradeCost(state, layerIndex);
  const supervisorCost = getAutomationCost('drill', layerIndex);

  layerToolbarCrew.dataset.layer = String(layerIndex);
  layerToolbarCrew.disabled = crewLevel >= MAX_LAYER_CREW;
  layerToolbarCrew.textContent =
    crewLevel >= MAX_LAYER_CREW
      ? '本层已满编'
      : `本层扩编 ${formatMoney(crewCost)}`;
  layerToolbarCrew.classList.toggle(
    'is-short',
    crewLevel < MAX_LAYER_CREW && state.money < crewCost,
  );
  layerToolbarCrew.classList.toggle(
    'is-ready',
    crewLevel < MAX_LAYER_CREW && state.money >= crewCost,
  );

  layerToolbarSupervisor.dataset.layer = String(layerIndex);
  layerToolbarSupervisor.disabled = automated;
  layerToolbarSupervisor.textContent = mining?.automated
    ? '本层监工在岗'
    : state.adCrewSeconds > 0
      ? '临时工班代管中'
      : `雇本层监工 ${formatMoney(supervisorCost)}`;
  layerToolbarSupervisor.classList.toggle(
    'is-short',
    !automated && state.money < supervisorCost,
  );
  layerToolbarSupervisor.classList.toggle(
    'is-ready',
    !automated && state.money >= supervisorCost,
  );
}

function updateLayerRail(): void {
  const indices = getVisibleLayerWindow(
    state.currentLayer,
    state.deepestLayer,
    activeLayerWindowCount,
  );
  const nextSignature = `${state.currentLayer}:${state.deepestLayer}:${layerSignatureFor(indices)}`;
  let rebuilt = false;
  if (nextSignature !== layerRailSignature) {
    rebuilt = true;
    layerRailSignature = nextSignature;
    layerRail.innerHTML = indices
      .map((index) => {
        const layer = getLayerDefinition(index);
        const activity = getLayerActivity(index);
        const mining = state.layers[index];
        const current = index === state.currentLayer;
        const crewLevel = mining?.crewLevel ?? 1;
        return `
          <article class="layer-card ${current ? 'is-current' : ''} ${activity.tone}">
            <button
              class="layer-card-focus"
              type="button"
              data-action="focus-layer"
              data-layer="${index}"
              aria-label="聚焦第 ${index} 层 ${layer.name}"
            >
              <span class="layer-card-swatch" style="--layer-color:${layer.color}"></span>
              <span class="layer-card-copy">
                <strong>${index.toString().padStart(2, '0')} ${layer.name}</strong>
                <span>${activity.label} · ${crewLevel}/${MAX_LAYER_CREW} 人</span>
              </span>
              <span class="layer-card-price">${formatMoney(layer.baseValue)}</span>
            </button>
            <div
              class="layer-card-progress"
              role="progressbar"
              aria-label="${layer.name}钻探进度"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow="${Math.round(activity.progress * 100)}"
            >
              <span data-layer-progress="${index}"></span>
            </div>
            <div class="layer-card-foot">
              <span data-layer-detail="${index}">${activity.detail}</span>
            </div>
          </article>
        `;
      })
      .join('');
  }

  if (rebuilt) {
    window.requestAnimationFrame(() => {
      const currentCard = layerRail.querySelector<HTMLElement>('.layer-card.is-current');
      if (!currentCard) return;
      const target = currentCard.offsetTop - 8;
      layerRail.scrollTo({
        left: Math.max(0, currentCard.offsetLeft - 8),
        top: Math.max(0, target),
        behavior: 'auto',
      });
    });
  }

  for (const index of indices) {
    const detail = layerRail.querySelector<HTMLElement>(
      `[data-layer-detail="${index}"]`,
    );
    if (detail) detail.textContent = getLayerActivity(index).detail;
    const fill = layerRail.querySelector<HTMLElement>(
      `[data-layer-progress="${index}"]`,
    );
    if (!fill) continue;
    const mining = state.layers[index];
    const ratio = mining?.active
      ? Math.min(1, mining.progress / Math.max(0.001, mining.tripDuration))
      : 0;
    fill.style.width = `${ratio * 100}%`;
  }
}

function updateManagers(): void {
  const nextSignature = `${state.deepestLayer}:${Object.values(state.managers)
    .map((owned) => (owned ? 1 : 0))
    .join('')}`;
  if (nextSignature === managerSignature) return;
  managerSignature = nextSignature;
  const candidates = MANAGERS.filter((manager) => !state.managers[manager.id]).slice(0, 3);
  desktopManagers.innerHTML =
    candidates.length > 0
      ? candidates.map((manager) => managerRowTemplate(manager.id, true)).join('')
      : '<div class="empty-state">九名工头已经全部到岗。公司现在只需要看数字上涨。</div>';
  renderIcons(desktopManagers);
}

function updateTextAll(selector: string, value: string): void {
  document.querySelectorAll<HTMLElement>(selector).forEach((node) => {
    node.textContent = value;
  });
}

function updateWidthAll(selector: string, percent: number): void {
  document.querySelectorAll<HTMLElement>(selector).forEach((node) => {
    node.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  });
}

function activateLine(line: LineId): void {
  const outcome = queueLine(state, line);
  applyOutcome(outcome, 'queue');
  if (outcome.ok) {
    sfx.vibrate(10);
  }
}

function applyOutcome(outcome: ActionOutcome, successSound: SfxName): boolean {
  if (!outcome.ok) {
    toast(outcome.message, 'error');
    sfx.play('error');
    return false;
  }
  if (outcome.events.length > 0) handleGameEvents(outcome.events);
  sfx.play(successSound);
  saveNow(false);
  updateUI();
  return true;
}

function handleRecommendedUpgrade(): void {
  applyOutcome(buyRecommendedUpgrade(state), 'upgrade');
}

function runTutorialPrimary(): void {
  if (state.tutorialCompleted) return;
  const step = TUTORIAL_STEPS[state.tutorialStep];
  if (!step) return;
  if (step.action === 'queue') {
    activateLine(step.line);
    return;
  }
  if (step.action === 'upgrade') {
    const previousTier = equipmentTierLevel(state.lines.drill.level);
    if (applyOutcome(buyLineUpgrade(state, 'drill'), 'upgrade')) {
      const nextTier = equipmentTierLevel(state.lines.drill.level);
      mineScene.equipmentUpgraded('drill', state.lines.drill.level);
      if (nextTier > previousTier) sfx.play('tier_up');
      sfx.vibrate(16);
    }
    return;
  }
  if (
    applyOutcome(
      buyAutomation(state, step.line, state.currentLayer),
      'reward',
    )
  ) {
    sfx.vibrate([12, 40, 18]);
    if (getAllLinesAutomated(state)) {
      window.setTimeout(showAutomationUnlocked, 450);
    }
  }
}

function runSceneCommand(): void {
  if (sceneCommandMode === 'ad') {
    void handleOnlineAd();
    return;
  }
  if (applyOutcome(queueLineToCapacity(state, sceneCommandLine), 'queue')) {
    sfx.vibrate(12);
  }
}

function handleAction(button: HTMLElement): void {
  const action = button.dataset.action;
  if (!action) return;
  sfx.unlock();

  if (action === 'tutorial-primary') {
    runTutorialPrimary();
    return;
  }

  if (action === 'scene-command') {
    runSceneCommand();
    return;
  }

  if (action === 'mine-section') {
    const section = button.dataset.section;
    if (section === 'production' || section === 'layers') {
      setMineSection(section);
    }
    return;
  }

  if (
    action === 'queue' ||
    action === 'queue-five' ||
    action === 'upgrade' ||
    action === 'automation'
  ) {
    const line = parseLineId(button.dataset.line);
    if (!line) return;
    if (action === 'queue') {
      activateLine(line);
    } else if (action === 'queue-five') {
      if (applyOutcome(queueLineToCapacity(state, line), 'queue')) {
        sfx.vibrate(12);
      }
    } else if (action === 'upgrade') {
      const previousTier = equipmentTierLevel(state.lines[line].level);
      const ok = applyOutcome(buyLineUpgrade(state, line), 'upgrade');
      if (ok) {
        const nextTier = equipmentTierLevel(state.lines[line].level);
        mineScene.equipmentUpgraded(line, state.lines[line].level);
        if (nextTier > previousTier) sfx.play('tier_up');
        sfx.vibrate(16);
      }
    } else {
      const ok = applyOutcome(buyAutomation(state, line), 'reward');
      if (ok) {
        sfx.vibrate([12, 40, 18]);
        if (getAllLinesAutomated(state)) {
          window.setTimeout(showAutomationUnlocked, 450);
        }
      }
    }
    return;
  }

  if (action === 'unlock-layer') {
    const previousLayer = state.currentLayer;
    const ok = applyOutcome(unlockNextLayer(state), 'unlock');
    if (ok && state.currentLayer !== previousLayer) {
      layerRailSignature = '';
      mineScene?.layerUnlocked(state.currentLayer);
      animateSceneLayerChange(previousLayer, state.currentLayer);
      sfx.vibrate([20, 50, 30]);
    }
    return;
  }

  if (action === 'change-layer' || action === 'focus-layer') {
    const requested =
      action === 'change-layer'
        ? state.currentLayer + Number(button.dataset.delta || 0)
        : Number(button.dataset.layer);
    focusLayer(requested);
    return;
  }

  if (action === 'focus-deepest') {
    focusLayer(state.deepestLayer);
    return;
  }

  if (action === 'queue-layer') {
    const targetLayer = Number(button.dataset.layer);
    const focus = selectLayer(state, targetLayer);
    if (!focus.ok) {
      applyOutcome(focus, 'click');
      return;
    }
    layerRailSignature = '';
    const ok = applyOutcome(queueLine(state, 'drill', targetLayer), 'click');
    if (ok) {
      mineScene?.sync(state);
      sfx.vibrate(10);
    }
    return;
  }

  if (action === 'upgrade-layer') {
    const targetLayer = Number(button.dataset.layer);
    const ok = applyOutcome(
      buyLayerCrewUpgrade(state, targetLayer),
      'upgrade',
    );
    if (ok) {
      layerRailSignature = '';
      mineScene?.sync(state);
      sfx.vibrate(14);
      toast(
        `第 ${targetLayer} 层扩容到 ${state.layers[targetLayer]?.crewLevel ?? 1} 人。`,
        'reward',
      );
    }
    return;
  }

  if (action === 'automation-layer') {
    const targetLayer = Number(button.dataset.layer);
    const ok = applyOutcome(
      buyAutomation(state, 'drill', targetLayer),
      'reward',
    );
    if (ok) {
      layerRailSignature = '';
      mineScene.sync(state);
      sfx.vibrate([12, 35, 16]);
      if (targetLayer === state.currentLayer && getAllLinesAutomated(state)) {
        window.setTimeout(showAutomationUnlocked, 450);
      }
    }
    return;
  }

  if (action === 'recommended-upgrade') {
    handleRecommendedUpgrade();
    return;
  }

  if (action === 'hire-manager') {
    const manager = MANAGERS.find((entry) => entry.id === button.dataset.manager);
    if (!manager) return;
    applyOutcome(hireManager(state, manager.id), 'reward');
    clearModal(false);
    return;
  }

  if (action === 'claim-daily') {
    if (applyOutcome(claimDailyReward(state), 'reward')) {
      closeModal();
      toast('黄金班次启动：10 分钟内收益 ×1.5。', 'reward', 3200);
    }
    return;
  }

  if (action === 'ad-boost') {
    void handleOnlineAd();
    return;
  }

  if (action === 'offline-ad') {
    void handleOfflineAd();
    return;
  }

  if (action === 'skip-tutorial') {
    state.tutorialCompleted = true;
    state.tutorialStep = 7;
    saveNow(false);
    updateUI();
    toast('已收起新手提示，可随时在帮助里重新打开。', 'normal', 3000);
    return;
  }

  if (action === 'restart-tutorial') {
    state.tutorialCompleted = false;
    state.tutorialStep = 0;
    saveNow(false);
    closeModal();
    updateUI();
    toast('新手提示已重新开启。', 'normal');
    return;
  }

  if (action === 'open-help') {
    openHelpModal();
  } else if (action === 'open-settings') {
    openSettingsModal();
  } else if (action === 'open-museum') {
    openMuseumModal();
  } else if (action === 'open-crew') {
    openCrewModal();
  } else if (action === 'open-tasks') {
    openTasksModal();
  } else if (action === 'open-growth') {
    openGrowthModal();
  } else if (action === 'open-prestige') {
    openPrestigeModal();
  } else if (action === 'perform-prestige') {
    const outcome = performPrestige(state);
    if (applyOutcome(outcome, 'reward')) {
      pendingOfflineReport = null;
      offlineBonusClaimed = false;
      managerSignature = '';
      layerRailSignature = '';
      mineScene?.sync(state);
      mineScene?.scene.restart();
      closeModal();
      toast(outcome.message, 'reward', 3600);
      sfx.vibrate([18, 45, 24]);
    }
  } else if (action === 'toggle-setting') {
    toggleSetting(button);
  } else if (action === 'confirm-reset') {
    resetSave();
  } else if (action === 'hard-reset-save') {
    hardResetSave();
  }
}

function parseLineId(value: string | undefined): LineId | null {
  return value === 'drill' || value === 'lift' || value === 'truck' ? value : null;
}

function focusLayer(index: number): void {
  const previousLayer = state.currentLayer;
  layerRailSignature = '';
  const ok = applyOutcome(selectLayer(state, index), 'click');
  if (!ok) return;
  closeModal(false);
  mineScene.sync(state);
  updateUI();
  animateSceneLayerChange(previousLayer, state.currentLayer);
}

let lastSceneLayerAnimationAt = 0;

function animateSceneLayerChange(previousLayer: number, nextLayer: number): void {
  if (previousLayer === nextLayer) return;
  if (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    state.settings.reduceFlash
  ) {
    return;
  }
  const now = performance.now();
  if (now - lastSceneLayerAnimationAt < 80) return;
  lastSceneLayerAnimationAt = now;
  const travel = nextLayer > previousLayer ? 7 : -7;
  mineStage.getAnimations().forEach((animation) => animation.cancel());
  mineStage.animate(
    [
      {
        opacity: 0.78,
        transform: `translate3d(0, ${travel}px, 0)`,
      },
      {
        opacity: 1,
        transform: 'translate3d(0, 0, 0)',
      },
    ],
    {
      duration: compactRenderer ? 190 : 230,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    },
  );
}

function handleGameEvents(events: GameEvent[]): void {
  if (events.length === 0) return;
  mineScene?.handleGameEvents(events);
  const playedSounds = new Set<SfxName>();
  const startedLines = new Set<LineId>();
  const firstSamples: number[] = [];
  let highestCompanyLevel = 0;
  let mineCompleted = false;
  let liftCompleted = false;
  let saleCompleted = false;
  const playOnce = (name: SfxName): void => {
    if (playedSounds.has(name)) return;
    playedSounds.add(name);
    sfx.play(name);
  };

  for (const event of events) {
    if (event.type === 'line_started') {
      startedLines.add(event.line);
    } else if (event.type === 'mine_completed') {
      mineCompleted = true;
      if (event.firstSample) {
        firstSamples.push(event.layer);
      }
    } else if (event.type === 'lift_completed') {
      liftCompleted = true;
    } else if (event.type === 'sale_completed') {
      saleCompleted = true;
    } else if (event.type === 'rich_vein_started') {
      playOnce('reward');
      toast('超级矿脉出现：短时间收益大幅提高。', 'reward', 3200);
    } else if (event.type === 'company_level_up') {
      playOnce('reward');
      highestCompanyLevel = Math.max(highestCompanyLevel, event.level);
    } else if (event.type === 'tutorial_completed') {
      playOnce('reward');
      toast('当前矿层全流程接通，吊机和卡车会继续服务其他矿层。', 'reward', 4200);
    } else if (event.type === 'boost_ended') {
      if (event.boost === 'ad') toast('双倍收益已结束，可以再次储备。', 'normal');
    }
  }

  if (saleCompleted) {
    playOnce('sale');
  } else if (liftCompleted) {
    playOnce('lift');
  } else if (mineCompleted) {
    playOnce('mine');
  } else if (startedLines.has('truck')) {
    playOnce('truck_start');
  } else if (startedLines.has('lift')) {
    playOnce('lift_start');
  } else if (startedLines.has('drill')) {
    playOnce('mine_start');
  }

  if (firstSamples.length > 0) queueMineralDiscoveries(firstSamples);
  if (highestCompanyLevel > 0) {
    toast(
      `公司升到 Lv.${highestCompanyLevel}，所有销售获得额外加成。`,
      'reward',
      3000,
    );
  }
}

function gameLoop(now: number): void {
  if (document.hidden) {
    lastFrameAt = now;
    requestAnimationFrame(gameLoop);
    return;
  }

  const deltaSeconds = Math.min(0.12, Math.max(0, (now - lastFrameAt) / 1000));
  lastFrameAt = now;
  const events = advanceFrame(deltaSeconds);
  handleGameEvents(events);

  saveAccumulator += deltaSeconds;
  uiAccumulator += deltaSeconds;
  if (saveAccumulator >= 5) {
    saveNow(false);
    saveAccumulator = 0;
  }
  if (uiAccumulator >= 0.1) {
    mineScene?.sync(state);
    updateUI();
    uiAccumulator = 0;
  }

  requestAnimationFrame(gameLoop);
}

function advanceFrame(deltaSeconds: number): GameEvent[] {
  const safeDelta = Math.max(0, Math.min(0.12, deltaSeconds));
  if (safeDelta <= 0) return [];
  return advanceGame(state, safeDelta, {
    visibleLayerCount: activeLayerWindowCount,
  });
}

function saveNow(showError: boolean): void {
  const result = repository.save(state);
  saveAccumulator = 0;
  if (!result.ok && showError) {
    toast(`存档失败：${result.error ?? '浏览器拒绝写入'}`, 'error', 5000);
  }
}

function absorbOfflineTime(now: number): void {
  const report = calculateOfflineProgress(state, now);
  state = report.state;
  saveNow(false);
  mineScene?.sync(state);
  updateUI();

  if (report.elapsedSeconds < 10) return;
  if (report.baseEarnings <= 0) {
    if (report.elapsedSeconds >= 300) {
      toast('后台期间没有新增收益，三条生产线需要先安排监工。', 'normal', 3600);
    }
    return;
  }

  if (!modalRoot.classList.contains('hidden')) {
    toast(`后台收益已到账 ${formatMoney(report.baseEarnings)}。`, 'reward', 3200);
  } else {
    showOfflineReport(report);
  }
}

function scheduleInitialModals(): void {
  if (!initialOfflineReport) return;
  window.setTimeout(() => {
    if (pendingOfflineReport) showOfflineReport(pendingOfflineReport);
  }, 550);
}

function showOfflineReport(report: OfflineReport): void {
  pendingOfflineReport = report;
  offlineBonusClaimed = false;
  const bottleneck = report.bottleneck ? LINE_LABELS[report.bottleneck] : '无';
  const bonus = report.eligibleForAdBonus ? report.baseEarnings : 0;
  openModal({
    title: '离线收益报告',
    icon: 'moon-star',
    size: 'narrow',
    body: `
      <p class="modal-lead">公司在你离开时继续运转。基础收益已经直接到账，不会因为跳过广告而丢失。</p>
      <div class="modal-hero-number">${formatMoney(report.baseEarnings)}</div>
      <div class="modal-grid">
        <div class="modal-stat"><span>离线时长</span><strong>${formatDuration(report.elapsedSeconds)}</strong></div>
        <div class="modal-stat"><span>计入时长</span><strong>${formatDuration(report.creditedSeconds)}</strong></div>
        <div class="modal-stat"><span>完成运输</span><strong>${formatCompact(report.trips)} 次</strong></div>
        <div class="modal-stat"><span>当前瓶颈</span><strong>${bottleneck}</strong></div>
      </div>
      ${report.capped ? `<p class="modal-lead" style="margin-top:12px">本次收益已达到 ${formatDuration(report.capSeconds)} 上限。夜班工头和永久纪念章可以继续提高上限。</p>` : ''}
      ${bonus > 0 ? `<p class="modal-lead" style="margin-top:12px">可选：观看一次模拟广告，再领取同等金额的额外收益，不会扣掉基础收益。</p>` : ''}
    `,
    actions: `
      <button class="modal-action" type="button" data-modal-close>正常领取</button>
      ${
        bonus > 0
          ? `<button class="modal-action is-primary" type="button" data-action="offline-ad">广告再加 ${formatMoney(bonus)}</button>`
          : ''
      }
    `,
  });
}

async function handleOnlineAd(): Promise<void> {
  if (adModalOpen) return;
  if (!mockAdAdapter.isAvailable('online_boost')) {
    toast('当前没有可用的广告，请稍后再试。', 'error');
    return;
  }
  if (state.adBoostSeconds >= 29 * 60) {
    toast('双倍收益储备已经接近上限。', 'normal');
    return;
  }
  const result = await mockAdAdapter.show('online_boost');
  if (result !== 'completed') {
    if (result === 'unavailable') toast('广告暂时不可用。', 'error');
    return;
  }
  applyOutcome(applyOnlineAdReward(state), 'reward');
  toast('双倍收益已储备 15 分钟，按在线时间消耗。', 'reward', 3200);
}

async function handleOfflineAd(): Promise<void> {
  const report = pendingOfflineReport;
  if (!report || offlineBonusClaimed || !report.eligibleForAdBonus || adModalOpen) return;
  const result = await mockAdAdapter.show('offline_bonus');
  if (result !== 'completed') return;
  const bonus = addOfflineAdBonus(state, report.baseEarnings);
  offlineBonusClaimed = true;
  saveNow(false);
  updateUI();
  closeModal();
  toast(`离线追加收益 ${formatMoney(bonus)} 已到账。`, 'reward', 3600);
}

function presentMockAd(placement: AdPlacement): Promise<AdResult> {
  if (adModalOpen) return Promise.resolve('unavailable');
  adModalOpen = true;
  let settled = false;
  let remaining = 3;
  let interval = 0;

  return new Promise((resolve) => {
    const finish = (result: AdResult): void => {
      if (settled) return;
      settled = true;
      adModalOpen = false;
      window.clearInterval(interval);
      closeModal(false);
      resolve(result);
    };

    openModal({
      title: '模拟激励广告',
      icon: 'play',
      size: 'narrow',
      body: `
        <div class="ad-stage">
          <div>
            <strong id="mock-ad-countdown">播放中 · 3</strong>
            <p>${placement === 'online_boost' ? '完成后储备 15 分钟在线双倍收益。' : '完成后追加一次与本次离线基础收益相同的奖励。'}</p>
          </div>
        </div>
        <p class="ad-note">这是首版演示适配层，不联网、不收集数据，也不会发起真实广告请求。</p>
      `,
      actions: `
        <button class="modal-action" id="mock-ad-skip" type="button">跳过</button>
        <button class="modal-action is-primary" id="mock-ad-claim" type="button" disabled>请看完</button>
      `,
      onClose: () => finish('skipped'),
    });

    const countdown = document.getElementById('mock-ad-countdown');
    const claim = document.getElementById('mock-ad-claim') as HTMLButtonElement | null;
    const skip = document.getElementById('mock-ad-skip');
    claim?.addEventListener('click', () => finish('completed'));
    skip?.addEventListener('click', () => finish('skipped'));
    interval = window.setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        if (countdown) countdown.textContent = `播放中 · ${remaining}`;
        return;
      }
      window.clearInterval(interval);
      if (countdown) countdown.textContent = '播放完成';
      if (claim) {
        claim.disabled = false;
        claim.textContent = placement === 'online_boost' ? '领取 15 分钟双倍' : '领取追加收益';
        claim.focus();
      }
    }, 1000);
  });
}

function showAutomationUnlocked(): void {
  if (modalRoot.classList.contains('hidden') === false) return;
  openModal({
    title: '当前矿层全流程启动',
    icon: 'sparkles',
    size: 'narrow',
    body: `
      <p class="modal-lead">当前矿层的钻探、全局起吊和全局运输已经接通。在线会持续运转，关闭页面后也会结算离线收益。</p>
      <div class="modal-grid">
        <div class="modal-stat"><span>离线上限</span><strong>${formatOfflineCap(getOfflineCapSeconds(state))}</strong></div>
        <div class="modal-stat"><span>当前监工收益</span><strong>${formatRate(getEstimatedRevenuePerSecond(state))}</strong></div>
      </div>
      <p class="modal-lead" style="margin-top:12px">新矿层仍需先手动开挖，再雇本层监工；吊机和卡车继续服务所有矿层。</p>
    `,
    actions: '<button class="modal-action is-primary" type="button" data-modal-close>继续经营</button>',
  });
}

function openHelpModal(): void {
  openModal({
    title: '玩法帮助',
    icon: 'help-circle',
    body: `
      <ul class="help-list">
        <li><span class="help-index">1</span><span><strong>各矿层同步施工。</strong> 切层只改变观察和操作目标，不会让上层停工。矿工始终在对应矿层钻探。</span></li>
        <li><span class="help-index">2</span><span><strong>先手动完成三线。</strong> 每条线最多预排 5 次，也可一键排满；没有货时班次会等待，吊机或卡车来后依次接上。</span></li>
        <li><span class="help-index">3</span><span><strong>升层后旧层继续挖。</strong> 每层默认 1 名矿工，可单独扩编到 5 人；人数越多，单趟产量和钻速越高。</span></li>
        <li><span class="help-index">4</span><span><strong>载重越高越慢。</strong> 吊机满载最多减速 35%，卡车最多减速 45%；吊机每次下到最底层，再逐层停靠检查，有货才装载。</span></li>
        <li><span class="help-index">5</span><span><strong>监工分两种。</strong> 每层钻探要单独雇本层监工，矿层越深雇佣费越高；吊机与卡车要雇全局接驳监工，一次接管后服务所有矿层。</span></li>
        <li><span class="help-index">6</span><span><strong>广告只加速。</strong> 在线双倍收益最多储备 30 分钟；离线基础收益不看广告也会到账。</span></li>
        <li><span class="help-index">7</span><span><strong>设备外观阶段。</strong> Lv.2、4、6、8、10 会依次进入新外观阶段，机器轮廓、载具部件和灯光都会变化。</span></li>
        <li><span class="help-index">8</span><span><strong>快捷键。</strong> 1、2、3 分别启动三线，空格购买推荐升级，Esc 关闭弹窗。</span></li>
      </ul>
    `,
    actions: `
      <button class="modal-action" type="button" data-action="restart-tutorial">重播新手提示</button>
      <button class="modal-action is-primary" type="button" data-modal-close>知道了</button>
    `,
  });
}

function openSettingsModal(): void {
  openModal({
    title: '设置',
    icon: 'settings',
    size: 'narrow',
    body: `
      ${settingRow('sound', '音效', '按钮、机器和结算提示音', state.settings.sound)}
      ${volumeRow('sfxVolume', '音效音量', '单独调整机器、按钮和结算音量', state.settings.sfxVolume)}
      ${settingRow('music', '环境音乐', '低频工业氛围音乐，完全由程序合成', state.settings.music)}
      ${volumeRow('musicVolume', '音乐音量', '4 套工业循环自动轮换，可单独调节音量', state.settings.musicVolume)}
      ${settingRow('vibration', '震动', '手机设备上的短促触感反馈', state.settings.vibration)}
      ${settingRow('screenShake', '镜头震动', '销售和重大事件时的轻微震屏', state.settings.screenShake)}
      ${settingRow('reduceFlash', '减少闪烁', '关闭高亮的闪光效果', state.settings.reduceFlash)}
      <div class="danger-zone">
        <strong>重开公司</strong>
        <p>会清空当前 localStorage 主存档和备份。只有确认不再需要现有进度时再使用。</p>
        <button class="modal-action is-danger" type="button" data-action="confirm-reset">清空存档并重开</button>
      </div>
    `,
    actions: '<button class="modal-action is-primary" type="button" data-modal-close>关闭</button>',
  });
}

function settingRow(key: SettingKey, title: string, description: string, value: boolean): string {
  return `
    <div class="setting-row">
      <div class="setting-copy">
        <strong>${title}</strong>
        <span>${description}</span>
      </div>
      <button
        class="toggle"
        type="button"
        role="switch"
        aria-label="${title}"
        aria-pressed="${value}"
        data-action="toggle-setting"
        data-setting="${key}"
      ></button>
    </div>
  `;
}

function volumeRow(
  key: VolumeKey,
  title: string,
  description: string,
  value: number,
): string {
  const percent = Math.round(value * 100);
  return `
    <div class="setting-row is-volume">
      <div class="setting-copy">
        <strong>${title}</strong>
        <span>${description}</span>
      </div>
      <label class="volume-control">
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value="${percent}"
          data-volume="${key}"
          aria-label="${title}"
        />
        <output data-volume-output="${key}">${percent}%</output>
      </label>
    </div>
  `;
}

function toggleSetting(button: HTMLElement): void {
  const key = button.dataset.setting as SettingKey | undefined;
  if (!key || !(key in state.settings)) return;
  state.settings[key] = !state.settings[key];
  button.setAttribute('aria-pressed', String(state.settings[key]));
  applySettings();
  saveNow(false);
  sfx.play('click');
}

function applySettings(): void {
  sfx.setEnabled(state.settings.sound);
  sfx.setMusicEnabled(state.settings.music);
  sfx.setSfxVolume(state.settings.sfxVolume);
  sfx.setMusicVolume(state.settings.musicVolume);
  sfx.setVibrationEnabled(state.settings.vibration);
  document.body.classList.toggle('reduce-motion', !state.settings.screenShake);
}

function openMuseumModal(): void {
  const indices = new Set<number>();
  for (let index = 1; index <= 30; index += 1) indices.add(index);
  if (state.deepestLayer > 27) {
    for (
      let index = Math.max(31, state.deepestLayer - 2);
      index <= Math.min(10_000, state.deepestLayer + 3);
      index += 1
    ) {
      indices.add(index);
    }
  }
  const items = [...indices].sort((a, b) => a - b);
  const collected = new Set(state.museum);

  openModal({
    title: '矿物图鉴',
    icon: 'gem',
    size: 'wide',
    body: `
      <p class="modal-lead">首次挖到一种矿物就会收入图鉴，每种永久提高 1% 销售收益。当前收藏 ${state.museum.length} 种，图鉴加成 +${state.museum.length}%。</p>
      <div class="museum-grid">
        ${items
          .map((index) => {
            const layer = getLayerDefinition(index);
            const unlocked = collected.has(index);
            return `
              <div class="museum-item ${unlocked ? '' : 'is-locked'}">
                <span class="museum-gem" style="--gem-color:${layer.accent}"><i data-lucide="${unlocked ? 'gem' : 'lock-keyhole'}"></i></span>
                <span class="museum-copy">
                  <strong>${unlocked ? layer.name : '未发现'}</strong>
                  <span>${index.toString().padStart(2, '0')} 层 · ${layer.rarity}</span>
                </span>
              </div>
            `;
          })
          .join('')}
      </div>
    `,
    actions: '<button class="modal-action is-primary" type="button" data-modal-close>关闭</button>',
  });
}

function openCrewModal(): void {
  const owned = MANAGERS.filter((manager) => state.managers[manager.id]).length;
  openModal({
    title: '工头值班室',
    icon: 'users',
    size: 'wide',
    body: `
      <p class="modal-lead">永久工头会改变整家公司的效率。当前在岗 ${owned} / ${MANAGERS.length} 名，招募不消耗矿层进度。</p>
      <div>
        ${MANAGERS.map((manager) => managerRowTemplate(manager.id)).join('')}
      </div>
    `,
    actions: '<button class="modal-action is-primary" type="button" data-modal-close>关闭</button>',
  });
}

function openTasksModal(): void {
  const canClaim = canClaimDailyReward(state);
  openModal({
    title: '今日任务',
    icon: 'gift',
    body: `
      <p class="modal-lead">每天完成轻量目标，三项全部完成后领取一次 10 分钟黄金班次。每日任务会在本地日期切换时重置。</p>
      <div class="list-stack">${dailyRowsTemplate()}</div>
      <div class="modal-grid" style="margin-top:12px">
        <div class="modal-stat"><span>当前公司等级</span><strong>Lv.${state.companyLevel}</strong></div>
        <div class="modal-stat"><span>监工收益</span><strong>${getAllLinesAutomated(state) ? formatRate(getEstimatedRevenuePerSecond(state)) : '待本层监工接管'}</strong></div>
      </div>
    `,
    actions: `
      <button class="modal-action" type="button" data-modal-close>稍后</button>
      <button class="modal-action is-primary" type="button" data-action="claim-daily" ${canClaim ? '' : 'disabled'}>领取黄金班次</button>
    `,
  });
  updateDailyRows(modalRoot);
}

function openGrowthModal(): void {
  const marks = getPrestigeAvailability(state);
  const requiredLayer = getPrestigeLayerRequirement(state.prestigeCount);
  openModal({
    title: '长期路线',
    icon: 'trending-up',
    body: `
      <p class="modal-lead">公司等级、图鉴和工头提供长期加成；二次创业会重置经营进度，换取永久纪念章。第 ${state.prestigeCount + 1} 次创业门槛为第 ${requiredLayer} 层。</p>
      <div class="xp-row">
        <span>公司 Lv.${state.companyLevel}</span>
        <strong>${formatCompact(state.companyXp)} / ${formatCompact(getCompanyLevelRequirement(state.companyLevel))}</strong>
      </div>
      <div class="xp-track"><span class="xp-fill" data-company-xp-fill style="width:${getCompanyProgress(state) * 100}%"></span></div>
      <div class="modal-grid" style="margin-top:12px">
        <div class="modal-stat"><span>图鉴永久加成</span><strong>+${state.museum.length}%</strong></div>
        <div class="modal-stat"><span>纪念章永久加成</span><strong>+${state.prestigeMarks * 10}%</strong></div>
        <div class="modal-stat"><span>创业常驻倍率</span><strong>×${formatMultiplier(getPrestigeRunMultiplier(state))}</strong></div>
        <div class="modal-stat"><span>已完成创业</span><strong>${state.prestigeCount} 次</strong></div>
        <div class="modal-stat"><span>本次可获得</span><strong>${marks} 枚纪念章</strong></div>
        <div class="modal-stat"><span>当前开发进度</span><strong>第 ${state.deepestLayer} / ${requiredLayer} 层</strong></div>
      </div>
    `,
    actions: `
      <button class="modal-action" type="button" data-modal-close>关闭</button>
      <button class="modal-action ${marks > 0 ? 'is-primary' : ''}" type="button" data-action="open-prestige" ${marks > 0 ? '' : 'disabled'}>${marks > 0 ? '二次创业' : `需第 ${requiredLayer} 层`}</button>
    `,
  });
}

function openPrestigeModal(): void {
  const marks = getPrestigeAvailability(state);
  const runMultiplier = getPrestigeRunMultiplier(state);
  const requiredLayer = getPrestigeLayerRequirement(state.prestigeCount);
  if (marks <= 0) {
    toast(`下一次创业至少需要挖到第 ${requiredLayer} 层。`, 'error');
    return;
  }
  openModal({
    title: '二次创业确认',
    icon: 'star',
    size: 'narrow',
    body: `
      <p class="modal-lead">本次会重置资金、矿层、三线设备与库存，保留工头、图鉴、公司等级和永久纪念章。</p>
      <div class="modal-hero-number">+${marks} 纪念章</div>
      <p class="modal-lead">纪念章提供永久销售加成；每次创业额外增加 3% 常驻经营倍率，最高叠加到 ×1.30。当前为 ×${formatMultiplier(runMultiplier)}。</p>
    `,
    actions: `
      <button class="modal-action" type="button" data-modal-close>先不重置</button>
      <button class="modal-action is-danger" type="button" data-action="perform-prestige">确认二次创业</button>
    `,
  });
}

function openLayersModal(): void {
  const layer = getLayerDefinition(state.currentLayer);
  const next = getLayerDefinition(Math.min(10_000, state.deepestLayer + 1));
  const indices = getVisibleLayerWindow(
    state.currentLayer,
    state.deepestLayer,
    20,
  );
  openModal({
    title: '矿层调度',
    icon: 'mountain',
    size: 'wide',
    body: `
      <div class="modal-hero-number">第 ${layer.index} 层 · ${layer.name}</div>
      <p class="modal-lead">${layer.region}，深度 ${formatCompact(layer.depthMeters)} 米。所有已解锁矿层会同时施工，选择矿层只改变观察与操作目标，不会让其他班组停工。</p>
      <div class="modal-layer-grid">
        ${indices
          .map((index) => {
            const item = getLayerDefinition(index);
            const activity = getLayerActivity(index);
            return `
              <button
                class="modal-layer-card ${index === state.currentLayer ? 'is-current' : ''} ${activity.tone}"
                type="button"
                data-action="focus-layer"
                data-layer="${index}"
              >
                <span class="layer-swatch" style="--layer-color:${item.color}"></span>
                <span>
                  <strong>${index.toString().padStart(2, '0')} ${item.name}</strong>
                  <small>${activity.label} · ${state.layers[index]?.crewLevel ?? 1}/${MAX_LAYER_CREW} 人</small>
                </span>
                <b>${formatMoney(item.baseValue)}</b>
              </button>
            `;
          })
          .join('')}
      </div>
      <div class="modal-grid">
        <div class="modal-stat"><span>当前观察层单价</span><strong>${formatMoney(getUnitSaleValue(state))}</strong></div>
        <div class="modal-stat"><span>待解锁</span><strong>${state.deepestLayer >= 10_000 ? '已到边界' : next.name}</strong></div>
        <div class="modal-stat"><span>最深纪录</span><strong>第 ${state.deepestLayer} 层</strong></div>
        <div class="modal-stat"><span>井下待接驳货值</span><strong>${projectedMoney(state.underground.totalValue)}</strong></div>
      </div>
    `,
    actions: `
      <button class="modal-action" type="button" data-action="focus-layer" data-layer="1">回到首层</button>
      <button class="modal-action" type="button" data-action="focus-deepest">前往最深层</button>
      <button class="modal-action" type="button" data-action="open-museum">矿物图鉴</button>
      <button class="modal-action is-primary" type="button" data-modal-close>关闭</button>
    `,
  });
}

function openMoreModal(): void {
  openModal({
    title: '更多功能',
    icon: 'briefcase-business',
    body: `
      <p class="modal-lead">当前版本不包含内购。广告全部是模拟适配层，不看广告也能完整推进并获得离线收益。</p>
      <div class="modal-grid">
        <button class="modal-action" type="button" data-action="open-help">玩法帮助</button>
        <button class="modal-action" type="button" data-action="open-settings">设置</button>
        <button class="modal-action" type="button" data-action="open-museum">矿物图鉴</button>
        <button class="modal-action" type="button" data-action="open-growth">长期成长</button>
      </div>
    `,
    actions: `
      <button class="modal-action is-primary" type="button" data-action="ad-boost">模拟广告加速</button>
      <button class="modal-action" type="button" data-modal-close>关闭</button>
    `,
  });
}

function applyWorkspaceView(view: WorkspaceView): void {
  if (view !== 'mine' && view !== 'operations' && view !== 'company') return;
  if (view === 'operations') view = 'mine';
  activeWorkspaceView = view;
  gameApp.dataset.view = view;
  document.querySelectorAll<HTMLElement>('[data-workspace]').forEach((node) => {
    const views = (node.dataset.workspace ?? '').split(/\s+/);
    node.hidden = !views.includes(view);
  });
  document
    .querySelectorAll<HTMLElement>('.workspace-tab, .nav-button[data-view]')
    .forEach((button) => {
      const active =
        button.dataset.view === view ||
        (button.classList.contains('nav-button') && button.dataset.view === view);
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
  document
    .querySelectorAll<HTMLElement>('.nav-button[data-sheet]')
    .forEach((button) => button.classList.remove('is-active'));
  if (window.scrollY > 0) window.scrollTo(0, 0);
}

function openSheet(sheet: SheetName): void {
  document.querySelectorAll<HTMLElement>('.nav-button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.sheet === sheet);
  });
  if (sheet === 'tasks') {
    openTasksModal();
  } else if (sheet === 'crew') {
    openCrewModal();
  } else if (sheet === 'layers') {
    openLayersModal();
  } else {
    openMoreModal();
  }
}

function resetSave(): void {
  openModal({
    title: '最后确认',
    icon: 'rotate-ccw',
    size: 'narrow',
    body: `
      <p class="modal-lead">这会删除当前游戏的主存档和自动备份，无法撤销。浏览器里的项目文件不会被删除，只清空这家公司的进度。</p>
    `,
    actions: `
      <button class="modal-action" type="button" data-modal-close>取消</button>
      <button class="modal-action is-danger" type="button" data-action="hard-reset-save">确认删除存档</button>
    `,
  });
}

function hardResetSave(): void {
  repository.clear();
  state = createFreshState();
  managerSignature = '';
  layerRailSignature = '';
  pendingOfflineReport = null;
  offlineBonusClaimed = false;
  saveNow(false);
  mineScene?.sync(state);
  mineScene?.scene.restart();
  closeModal();
  updateUI();
  toast('新公司已成立。先点一下“开挖”开始。', 'normal', 3200);
}

function createFreshState(): GameState {
  const reset = repository.load().state;
  reset.lastSeenAt = Date.now();
  return reset;
}

function openModal(options: ModalOptions): HTMLElement {
  clearModal(false);
  const sizeClass =
    options.size === 'wide' ? 'is-wide' : options.size === 'narrow' ? 'is-narrow' : '';
  modalRoot.innerHTML = `
    <section class="modal-card ${sizeClass}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <header class="modal-head">
        <div class="modal-title">
          <i data-lucide="${options.icon ?? 'sparkles'}"></i>
          <h2 id="modal-title">${options.title}</h2>
        </div>
        <button class="icon-button" type="button" data-modal-close aria-label="关闭">
          <i data-lucide="x"></i>
        </button>
      </header>
      <div class="modal-body">
        ${options.body}
        ${options.actions ? `<div class="modal-actions">${options.actions}</div>` : ''}
      </div>
    </section>
  `;
  modalRoot.dataset.dismissible = String(options.dismissible ?? true);
  modalRoot.dataset.onClose = '';
  modalRoot.classList.remove('hidden');
  renderIcons(modalRoot);
  modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  modalOnClose = options.onClose ?? null;

  modalRoot.querySelectorAll<HTMLElement>('[data-modal-close]').forEach((button) => {
    button.addEventListener('click', () => closeModal());
  });
  modalRoot.onclick = (event) => {
    if (event.target !== modalRoot || modalRoot.dataset.dismissible === 'false') return;
    closeModal();
  };
  window.requestAnimationFrame(() => {
    const first =
      modalRoot.querySelector<HTMLElement>(
        '.modal-action.is-primary:not(:disabled), button:not(:disabled), [tabindex="0"]',
      ) ?? modalRoot.querySelector<HTMLElement>('.modal-card');
    first?.focus();
  });
  return modalRoot.firstElementChild as HTMLElement;
}

let modalReturnFocus: HTMLElement | null = null;
let modalOnClose: (() => void) | null = null;

function closeModal(restoreFocus = true): void {
  clearModal(restoreFocus);
}

function clearModal(restoreFocus = true): void {
  const callback = modalOnClose;
  modalOnClose = null;
  callback?.();
  modalRoot.classList.add('hidden');
  modalRoot.innerHTML = '';
  modalRoot.onclick = null;
  document.querySelectorAll<HTMLElement>('.nav-button').forEach((button) => {
    button.classList.remove('is-active');
  });
  if (restoreFocus) modalReturnFocus?.focus();
  modalReturnFocus = null;
}

function trapModalFocus(event: KeyboardEvent): void {
  const focusable = [
    ...modalRoot.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((node) => !node.classList.contains('hidden'));
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function toast(message: string, tone: ToastTone = 'normal', duration = 2600): void {
  if (!message) return;
  const node = document.createElement('div');
  node.className = `toast${tone === 'error' ? ' is-error' : tone === 'reward' ? ' is-reward' : ''}`;
  node.textContent = message;
  toastRoot.append(node);
  while (toastRoot.childElementCount > 3) toastRoot.firstElementChild?.remove();
  window.setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    window.setTimeout(() => node.remove(), 180);
  }, duration);
}

function queueMineralDiscoveries(layers: number[]): void {
  for (const layer of layers) pendingMineralDiscoveries.add(layer);
  window.clearTimeout(mineralDiscoveryTimer);
  mineralDiscoveryTimer = window.setTimeout(() => {
    const discovered = [...pendingMineralDiscoveries].sort((a, b) => a - b);
    pendingMineralDiscoveries.clear();
    if (discovered.length === 0) return;
    if (discovered.length === 1) {
      toast(`新矿物入库：${getLayerDefinition(discovered[0]).name}`, 'reward');
      return;
    }
    const names = discovered
      .slice(0, 4)
      .map((layer) => getLayerDefinition(layer).name)
      .join('、');
    toast(
      `同时发现 ${discovered.length} 种新矿物：${names}${discovered.length > 4 ? '等' : ''}`,
      'reward',
      3200,
    );
  }, 900);
}

function iconText(icon: string, text: string): string {
  return `<i data-lucide="${icon}"></i><span>${text}</span>`;
}

function setIconHtml(elementToUpdate: HTMLElement, html: string): void {
  if (elementToUpdate.dataset.iconHtml === html) return;
  elementToUpdate.dataset.iconHtml = html;
  elementToUpdate.innerHTML = html;
  renderIcons(elementToUpdate);
}

function formatTimer(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

function formatMultiplier(value: number): string {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1).replace(/\.0$/, '');
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function projectedMoney(baseValue: number): string {
  return formatMoney(baseValue * getOutputMultiplier(state));
}

function formatOfflineCap(seconds: number): string {
  return `${Math.round(seconds / 3600)} 小时`;
}

function equipmentTierLabel(level: number, line: LineId): string {
  const tier =
    level >= 10
      ? 6
      : level >= 8
        ? 5
        : level >= 6
          ? 4
          : level >= 4
            ? 3
            : level >= 2
              ? 2
              : 1;
  const labels: Record<LineId, readonly string[]> = {
    drill: [
      'I型手摇钻',
      'II型机架钻',
      'III型液压钻',
      'IV型智能钻',
      'V型合金钻',
      'VI型地心钻',
    ],
    lift: [
      'I型人力绞盘',
      'II型机动卷扬',
      'III型液压吊机',
      'IV型电磁吊机',
      'V型双擎重吊',
      'VI型地心升降机',
    ],
    truck: [
      'I型人力矿车',
      'II型机动小卡',
      'III型中型货车',
      'IV型重载电车',
      'V型双节运输车',
      'VI型地心运输车',
    ],
  };
  return labels[line][tier - 1] ?? `T${tier}`;
}

function equipmentTierLevel(level: number): number {
  if (level >= 10) return 6;
  if (level >= 8) return 5;
  if (level >= 6) return 4;
  if (level >= 4) return 3;
  if (level >= 2) return 2;
  return 1;
}
