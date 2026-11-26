import Phaser from 'phaser';
import { getLineCapacity, getOutputMultiplier } from '../core/economy';
import { formatMoney } from '../core/format';
import {
  DESKTOP_VISIBLE_LAYERS,
  getResponsiveLayerCount,
  getVisibleLayerWindow,
} from '../core/layer-window';
import { getLayerDefinition } from '../core/layers';
import type {
  GameEvent,
  GameState,
  LayerDefinition,
  LayerMiningState,
} from '../core/types';

const COLOR = {
  earth: 0x17120e,
  shaft: 0x0c0b09,
  shaftEdge: 0x705b40,
  cream: 0xf4e6c7,
  amber: 0xf1ad3d,
  amberDark: 0x8b5722,
  teal: 0x58ad91,
  wood: 0x7b5434,
  metal: 0x64706b,
  black: 0x090806,
};

const SHAFT_X = 132;
const SHAFT_WIDTH = 104;
const SHAFT_CENTER = SHAFT_X + SHAFT_WIDTH / 2;
const SURFACE_Y = 126;
const MINE_TOP = 184;
const MINE_BOTTOM = 516;
const LIFT_TOP_Y = SURFACE_Y + 22;
const PANEL_X = SHAFT_X + SHAFT_WIDTH + 10;
const PANEL_RIGHT = 950;
const PANEL_WIDTH = PANEL_RIGHT - PANEL_X;
const BAND_GAP = 4;
const HQ_X = 816;
const ROAD_Y = 92;

interface WorkerVisual {
  root: Phaser.GameObjects.Container;
  tool: Phaser.GameObjects.Container;
  arm: Phaser.GameObjects.Rectangle;
  rearArm: Phaser.GameObjects.Rectangle;
  carryOre: Phaser.GameObjects.Rectangle;
}

interface LayerVisual {
  definition: LayerDefinition;
  locked: boolean;
  y: number;
  height: number;
  root: Phaser.GameObjects.Container;
  miners: WorkerVisual[];
  orePile: Phaser.GameObjects.Container;
  oreBlocks: Phaser.GameObjects.Shape[];
  cargoText: Phaser.GameObjects.Text;
  statusText: Phaser.GameObjects.Text;
  progress: Phaser.GameObjects.Rectangle;
  lamp: Phaser.GameObjects.Rectangle;
  highlight: Phaser.GameObjects.Rectangle;
}

interface SceneDebugSnapshot {
  visibleLayers: number[];
  currentLayer: number;
  activeMiners: number;
  equipmentTiers: {
    drill: number;
    lift: number;
    truck: number;
  };
  lift: {
    active: boolean;
    sourceLayer: number;
    tripDuration: number;
    progress: number;
    cageY: number;
    dwellLayer: number;
    grabberVisible: boolean;
    pickupLayers: number[];
  };
  truck: {
    active: boolean;
    sourceLayer: number;
    loadRatio: number;
    tripDuration: number;
    progress: number;
    x: number;
    facing: number;
    phase: 'idle' | 'outbound' | 'turnaround' | 'return' | 'reset-turn';
  };
}

export class MineScene extends Phaser.Scene {
  private gameState: GameState | null = null;
  private ready = false;
  private renderedLayer = 0;
  private renderedDeepest = 0;
  private layerVisuals: LayerVisual[] = [];
  private cableGraphics!: Phaser.GameObjects.Graphics;
  private winchWheel!: Phaser.GameObjects.Container;
  private winchRing!: Phaser.GameObjects.Arc;
  private liftManualCrank!: Phaser.GameObjects.Container;
  private liftMotorAssembly!: Phaser.GameObjects.Container;
  private liftDualDrive!: Phaser.GameObjects.Container;
  private liftEnergyCore!: Phaser.GameObjects.Container;
  private liftManualWorker!: WorkerVisual;
  private liftCage!: Phaser.GameObjects.Container;
  private liftLamp!: Phaser.GameObjects.Rectangle;
  private liftStopLabel!: Phaser.GameObjects.Text;
  private liftGrabber!: Phaser.GameObjects.Container;
  private liftCollectorRing!: Phaser.GameObjects.Arc;
  private liftCollectorCore!: Phaser.GameObjects.Rectangle;
  private pickupBeamGraphics!: Phaser.GameObjects.Graphics;
  private layerWindowCount = DESKTOP_VISIBLE_LAYERS;
  private liftCrates: Phaser.GameObjects.Rectangle[] = [];
  private liftLevelPips: Phaser.GameObjects.Rectangle[] = [];
  private liftArmor: Phaser.GameObjects.Rectangle[] = [];
  private liftHydraulics: Phaser.GameObjects.Rectangle[] = [];
  private liftTechLights: Phaser.GameObjects.Rectangle[] = [];
  private truck!: Phaser.GameObjects.Container;
  private truckBody!: Phaser.GameObjects.Container;
  private manualCart!: Phaser.GameObjects.Container;
  private manualCartCrates: Phaser.GameObjects.Rectangle[] = [];
  private manualCartWheels: Phaser.GameObjects.Container[] = [];
  private cartPuller!: WorkerVisual;
  private truckAuxTrailer!: Phaser.GameObjects.Container;
  private truckEnergyCore!: Phaser.GameObjects.Container;
  private truckTrailer!: Phaser.GameObjects.Rectangle;
  private truckCab!: Phaser.GameObjects.Rectangle;
  private truckHeadlight!: Phaser.GameObjects.Rectangle;
  private truckTailLamp!: Phaser.GameObjects.Rectangle;
  private truckWheels: Phaser.GameObjects.Container[] = [];
  private truckCrates: Phaser.GameObjects.Rectangle[] = [];
  private truckLevelPips: Phaser.GameObjects.Rectangle[] = [];
  private truckArmor: Phaser.GameObjects.Rectangle[] = [];
  private truckRoofRack: Phaser.GameObjects.Rectangle[] = [];
  private truckTechLights: Phaser.GameObjects.Rectangle[] = [];
  private surfacePile!: Phaser.GameObjects.Container;
  private surfacePileBlocks: Phaser.GameObjects.Rectangle[] = [];
  private layerCaption!: Phaser.GameObjects.Text;
  private cargoCaption!: Phaser.GameObjects.Text;
  private scanLine!: Phaser.GameObjects.Rectangle;
  private lastTruckDust = 0;
  private lastFlashAt = 0;
  private lastLiftProgress = 0;
  private liftSmoothY = 0;
  private seenLiftPickups = new Set<number>();
  private lastLiftDwellLayer = 0;
  private activeDwellLayer = 0;
  private truckFacing = -1;
  private wasTruckTurnaround = false;
  private wasTruckResetTurn = false;
  private truckPhase:
    | 'idle'
    | 'outbound'
    | 'turnaround'
    | 'return'
    | 'reset-turn' = 'idle';
  private previousTruckX = 420;
  private truckSmoothX = 420;

  constructor() {
    super({ key: 'mine' });
  }

  private get compactRendering(): boolean {
    return this.scale.width < 1700;
  }

  private fitCamera(): void {
    const zoom = this.scale.width / 960;
    this.cameras.main.setZoom(zoom);
    this.cameras.main.setScroll(
      -(960 * (zoom - 1)) / 2,
      -(540 * (zoom - 1)) / 2,
    );
  }

  create(): void {
    this.layerVisuals = [];
    this.liftCrates = [];
    this.liftLevelPips = [];
    this.liftArmor = [];
    this.liftHydraulics = [];
    this.liftTechLights = [];
    this.manualCartCrates = [];
    this.manualCartWheels = [];
    this.truckWheels = [];
    this.truckCrates = [];
    this.truckLevelPips = [];
    this.truckArmor = [];
    this.truckRoofRack = [];
    this.truckTechLights = [];
    this.surfacePileBlocks = [];
    this.lastTruckDust = 0;
    this.lastFlashAt = 0;
    this.lastLiftProgress = 0;
    this.liftSmoothY = 0;
    this.seenLiftPickups = new Set<number>();
    this.lastLiftDwellLayer = 0;
    this.activeDwellLayer = 0;
    this.truckFacing = -1;
    this.wasTruckTurnaround = false;
    this.wasTruckResetTurn = false;
    this.truckPhase = 'idle';
    this.previousTruckX = 420;
    this.truckSmoothX = 420;
    this.cameras.main.setBackgroundColor(COLOR.earth);
    this.fitCamera();

    this.drawBackdrop();
    this.drawMineTexture();
    this.drawLayerBands();
    this.drawShaft();
    this.drawSurface();
    this.createHeadquarters();
    this.createLift();
    this.createTruck();
    this.createSurfacePile();
    this.createSceneLabels();
    this.createAmbientDetails();
    this.sharpenTextObjects();

    this.ready = true;
    if (this.gameState) this.sync(this.gameState);
    this.scale.on('resize', this.handleScaleResize, this);
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.handleScaleResize, this);
    });
  }

  update(time: number, delta: number): void {
    if (!this.ready || !this.gameState) return;
    const state = this.gameState;

    this.updateLayerAnimations(time);
    this.updateLift(time, delta);
    this.updateTruck(time, delta);
    this.updateSurfaceCargo(time);

    this.scanLine.y = MINE_TOP + ((time / 34) % (MINE_BOTTOM - MINE_TOP));
    if (this.layerCaption.visible) {
      this.layerCaption.setText(
        `${String(state.currentLayer).padStart(2, '0')} · ${getLayerDefinition(state.currentLayer).name}`,
      );
    }
    if (this.cargoCaption.visible) {
      this.cargoCaption.setText(
        `井下估值 ${formatMoney(state.underground.totalValue * getOutputMultiplier(state))}`,
      );
    }
  }

  sync(state: GameState): void {
    this.gameState = state;
    if (!this.ready) return;
    if (
      this.renderedLayer !== state.currentLayer ||
      this.renderedDeepest !== state.deepestLayer
    ) {
      this.renderedLayer = state.currentLayer;
      this.renderedDeepest = state.deepestLayer;
      this.drawLayerBands();
    }
  }

  setLayerWindowCount(count: number): void {
    const nextCount = Math.max(1, Math.floor(count));
    if (nextCount === this.layerWindowCount) return;
    this.layerWindowCount = nextCount;
    if (this.ready) this.drawLayerBands();
  }

  getLayerWindowCount(): number {
    return this.layerWindowCount;
  }

  handleGameEvents(events: GameEvent[]): void {
    if (!this.ready) return;
    const reduceFlash = this.gameState?.settings.reduceFlash ?? false;
    const screenShake = this.gameState?.settings.screenShake ?? true;
    let mineBursts = 0;
    let saleBursts = 0;

    for (const event of events) {
      if (event.type === 'mine_completed') {
        if (mineBursts >= 3) continue;
        mineBursts += 1;
        const point = this.layerPoint(event.layer);
        const layer = getLayerDefinition(event.layer);
        this.burst(point.x + 34, point.y - 20, layer.accent, 7, 52);
        this.floatText(
          point.x + 38,
          point.y - 38,
          `+${formatMoney(event.value * getOutputMultiplier(this.gameState!))}`,
          '#ffe7b0',
        );
        if (event.firstSample) {
          this.showEventText(`发现 ${layer.name}`, layer.accent);
        }
      } else if (event.type === 'line_started') {
        if (event.line === 'drill') {
          const point = this.layerPoint(event.layer);
          this.burst(point.x + 18, point.y - 14, '#c9ab79', 4, 28);
        } else if (event.line === 'lift') {
          this.burst(SHAFT_CENTER, SURFACE_Y + 25, '#e7d6b1', 4, 30);
        } else {
          this.truckDust(3);
        }
      } else if (event.type === 'lift_completed') {
        this.burst(SHAFT_CENTER, SURFACE_Y + 28, '#f2d298', 8, 48);
        this.animateSurfaceTransfer(
          SHAFT_CENTER,
          SURFACE_Y - 15,
          this.surfacePile.x,
          this.surfacePile.y - 5,
          0xf2d298,
          8,
        );
        this.floatText(
          this.surfacePile.x,
          SURFACE_Y - 30,
          `第 ${event.layer} 层到地面 · +${formatMoney(event.value * getOutputMultiplier(this.gameState!))}`,
          '#e8d7b4',
          15,
        );
        if (screenShake) this.cameras.main.shake(42, 0.00055);
      } else if (event.type === 'sale_completed') {
        if (saleBursts >= 2) continue;
        saleBursts += 1;
        this.burst(HQ_X - 18, 76, '#ffd265', 15, 86);
        this.floatText(HQ_X - 6, 54, `+${formatMoney(event.revenue)}`, '#ffd56f', 23);
        if (screenShake) this.cameras.main.shake(80, 0.0016);
        if (!reduceFlash && this.time.now - this.lastFlashAt >= 360) {
          this.lastFlashAt = this.time.now;
          this.cameras.main.flash(65, 246, 197, 83, false);
        }
      } else if (event.type === 'rich_vein_started') {
        this.showEventText('超级矿脉启动 ×2.5', '#ffd76b');
        this.burst(660, 278, '#ffd76b', 18, 128);
        if (!reduceFlash && this.time.now - this.lastFlashAt >= 360) {
          this.lastFlashAt = this.time.now;
          this.cameras.main.flash(160, 255, 202, 75, false);
        }
      } else if (event.type === 'company_level_up') {
        this.showEventText(`公司升级 Lv.${event.level}`, '#7ce2c7');
        this.burst(HQ_X, 42, '#7ce2c7', 12, 76);
      } else if (event.type === 'tutorial_completed') {
        this.showEventText('当前矿层全流程接通', '#f4cf71');
      }
    }
  }

  layerUnlocked(index: number): void {
    if (!this.ready || !this.gameState) return;
    const layer = getLayerDefinition(index);
    this.renderedLayer = index;
    this.renderedDeepest = this.gameState.deepestLayer;
    this.drawLayerBands();
    const point = this.layerPoint(index);
    this.showEventText(`解锁：${layer.name}`, '#f4cf71');
    this.burst(point.x + 32, point.y, layer.accent, 18, 104);
  }

  equipmentUpgraded(line: 'drill' | 'lift' | 'truck', level: number): void {
    if (!this.ready) return;
    const tier = this.equipmentTier(level);
    if (line === 'lift') {
      this.showEventText(`卷扬强化 Lv.${level} · 外观阶段 ${tier}`, '#8fe0c8');
      this.burst(SHAFT_CENTER, this.liftCage.y, '#8fe0c8', 12, 64);
    } else if (line === 'truck') {
      this.showEventText(`车队强化 Lv.${level} · 外观阶段 ${tier}`, '#8ccdd6');
      this.burst(this.truck.x + 20, this.truck.y, '#8ccdd6', 12, 64);
    } else {
      this.showEventText(`钻机强化 Lv.${level}`, '#ffd06b');
      this.burst(PANEL_X + 120, this.layerCenter(this.gameState?.currentLayer ?? 1), '#ffd06b', 10, 54);
    }
  }

  getDebugSnapshot(): SceneDebugSnapshot {
    const state = this.gameState;
    const lift = state?.lines.lift;
    const truck = state?.lines.truck;
    const truckCapacity = state ? getLineCapacity(state, 'truck') : 1;
    return {
      visibleLayers: this.layerVisuals.map((layer) => layer.definition.index),
      currentLayer: state?.currentLayer ?? 1,
      activeMiners: this.layerVisuals.filter(
        (layer) => state?.layers[layer.definition.index]?.active,
      ).length,
      equipmentTiers: {
        drill: this.equipmentTier(state?.lines.drill.level ?? 1),
        lift: this.equipmentTier(state?.lines.lift.level ?? 1),
        truck: this.equipmentTier(state?.lines.truck.level ?? 1),
      },
      lift: {
        active: lift?.active ?? false,
        sourceLayer: lift?.payloadLayer || state?.currentLayer || 1,
        tripDuration: lift?.tripDuration ?? 0,
        progress: this.lockedProgress(lift),
        cageY: this.liftCage?.y ?? 0,
        dwellLayer: this.activeDwellLayer,
        grabberVisible: this.liftGrabber?.visible ?? false,
        pickupLayers: [...(lift?.payloadLayers ?? [])],
      },
      truck: {
        active: truck?.active ?? false,
        sourceLayer: truck?.payloadLayer || state?.currentLayer || 1,
        loadRatio: Math.min(1, (truck?.payload.units ?? 0) / Math.max(0.001, truckCapacity)),
        tripDuration: truck?.tripDuration ?? 0,
        progress: this.lockedProgress(truck),
        x: this.truck?.x ?? 0,
        facing: this.truckFacing,
        phase: this.truckPhase,
      },
    };
  }

  private lockedProgress(
    line: { active: boolean; progress: number; tripDuration: number } | undefined,
  ): number {
    if (!line?.active) return 0;
    return Phaser.Math.Clamp(
      line.progress / Math.max(0.001, line.tripDuration),
      0,
      1,
    );
  }

  private shortNumber(value: number): string {
    if (value >= 1e8) return `${(value / 1e8).toFixed(1)}亿`;
    if (value >= 1e4) return `${(value / 1e4).toFixed(1)}万`;
    if (value >= 100) return Math.floor(value).toString();
    return value.toFixed(1).replace(/\.0$/, '');
  }

  private visibleDefinitions(): LayerDefinition[] {
    if (!this.gameState) return [getLayerDefinition(1)];
    return getVisibleLayerWindow(
      this.gameState.currentLayer,
      this.gameState.deepestLayer,
      this.layerWindowCount,
    ).map(getLayerDefinition);
  }

  private handleScaleResize(): void {
    this.fitCamera();
    const count = getResponsiveLayerCount(this.scale.displaySize.width);
    if (count !== this.layerWindowCount) {
      this.layerWindowCount = count;
      if (this.ready) this.drawLayerBands();
    } else if (this.ready) {
      this.drawLayerBands();
    }
  }

  private drawBackdrop(): void {
    const graphics = this.add.graphics();
    graphics.setDepth(0);
    graphics.fillStyle(0x17130f, 1);
    graphics.fillRect(0, 0, 960, 540);
    graphics.fillStyle(0x202c28, 1);
    graphics.fillRect(0, 0, 960, SURFACE_Y);
    graphics.fillStyle(0x38514b, 0.16);
    graphics.fillRect(0, 58, 960, 67);
    graphics.fillStyle(0xb8d8cb, 0.17);
    for (let star = 0; star < 24; star += 1) {
      const x = 18 + ((star * 97) % 918);
      const y = 14 + ((star * 41) % 62);
      graphics.fillRect(x, y, star % 5 === 0 ? 2 : 1, star % 5 === 0 ? 2 : 1);
    }
    graphics.fillStyle(0x18211e, 1);
    graphics.fillTriangle(0, 92, 115, 31, 245, 92);
    graphics.fillTriangle(170, 92, 330, 42, 490, 92);
    graphics.fillTriangle(600, 92, 760, 36, 930, 92);
    graphics.lineStyle(1, 0x668077, 0.18);
    graphics.lineBetween(0, 88, 960, 88);
    graphics.fillStyle(0x101714, 0.92);
    graphics.fillRect(52, 58, 34, 34);
    graphics.fillRect(76, 43, 6, 50);
    graphics.fillRect(121, 66, 46, 26);
    graphics.fillRect(138, 49, 5, 44);
    graphics.fillStyle(0xd59a45, 0.62);
    graphics.fillRect(62, 67, 5, 4);
    graphics.fillRect(74, 67, 5, 4);
    graphics.fillRect(132, 73, 5, 4);
    graphics.fillRect(145, 73, 5, 4);
    graphics.fillStyle(0xe8d49e, 0.28);
    graphics.fillRect(22, 18, 2, 2);
    graphics.fillRect(151, 18, 2, 2);
    graphics.fillRect(206, 29, 2, 2);
    graphics.fillStyle(0x28312b, 1);
    graphics.fillRect(0, 91, 960, 35);
    graphics.fillStyle(0x775d3e, 1);
    graphics.fillRect(0, SURFACE_Y, 960, 9);
    graphics.fillStyle(0x302419, 1);
    graphics.fillRect(0, SURFACE_Y + 8, 960, 406);
    graphics.fillStyle(0x0e0c09, 1);
    graphics.fillRect(0, SURFACE_Y, 960, 8);
  }

  private drawMineTexture(): void {
    const graphics = this.add.graphics();
    graphics.setDepth(1);
    graphics.fillStyle(0x5d442c, 0.18);
    for (let x = 8; x < PANEL_X - 8; x += 26) {
      const y = 154 + ((x * 17) % 330);
      graphics.fillRect(x, y, 14, 4);
      graphics.fillRect(x + 5, y - 4, 7, 3);
    }
    graphics.lineStyle(1, 0xa17a47, 0.09);
    for (let y = MINE_TOP; y < MINE_BOTTOM; y += 23) {
      graphics.lineBetween(8, y, PANEL_X - 9, y + 13);
      graphics.lineBetween(12, y + 8, PANEL_X - 16, y - 5);
    }
    graphics.fillStyle(0x8f6a42, 0.13);
    for (let y = 170; y < MINE_BOTTOM; y += 41) {
      graphics.fillRect(26, y, 34 + (y % 19), 5);
      graphics.fillRect(68, y + 15, 17, 4);
    }
    graphics.lineStyle(2, 0x100c09, 0.18);
    for (let y = 176; y < MINE_BOTTOM; y += 53) {
      const startX = 18 + (y % 67);
      graphics.lineBetween(startX, y, startX + 28, y + 13);
      graphics.lineBetween(startX + 28, y + 13, startX + 41, y + 8);
    }
    graphics.fillStyle(0xe3c084, 0.15);
    for (let y = 188; y < MINE_BOTTOM; y += 47) {
      graphics.fillRect(26 + (y % 71), y, 3 + (y % 3), 2);
    }
  }

  private drawLayerBands(): void {
    for (const visual of this.layerVisuals) visual.root.destroy();
    this.layerVisuals = [];
    if (!this.gameState) return;

    const definitions = this.visibleDefinitions();
    const totalGap = BAND_GAP * Math.max(0, definitions.length - 1);
    const bandHeight = (MINE_BOTTOM - MINE_TOP - totalGap) / definitions.length;
    const compact = bandHeight < 56;

    definitions.forEach((definition, position) => {
      const y = MINE_TOP + position * (bandHeight + BAND_GAP);
      const selected = definition.index === this.gameState?.currentLayer;
      const locked = definition.index > (this.gameState?.deepestLayer ?? 1);
      const root = this.add.container(0, y).setDepth(3);
      const color = Phaser.Display.Color.HexStringToColor(definition.color).color;
      const accent = Phaser.Display.Color.HexStringToColor(definition.accent).color;
      const graphics = this.add.graphics();

      graphics.fillStyle(0x0b0907, 0.52);
      graphics.fillRect(PANEL_X - 3, 2, PANEL_WIDTH + 3, bandHeight);
      graphics.fillStyle(color, locked ? 0.24 : selected ? 0.96 : 0.78);
      graphics.fillRect(PANEL_X, 0, PANEL_WIDTH, bandHeight);
      graphics.fillStyle(0x100d0a, selected ? 0.48 : 0.58);
      graphics.fillRect(PANEL_X, bandHeight - 22, PANEL_WIDTH, 22);
      graphics.fillStyle(accent, locked ? 0.05 : selected ? 0.24 : 0.12);
      graphics.fillRect(PANEL_X, 0, PANEL_WIDTH, 3);
      graphics.fillStyle(0xffffff, locked ? 0.018 : selected ? 0.07 : 0.035);
      graphics.fillRect(PANEL_X + 6, 4, PANEL_WIDTH - 12, 1);
      graphics.fillStyle(0x000000, 0.26);
      graphics.fillRect(PANEL_X + 4, bandHeight - 2, PANEL_WIDTH - 8, 2);
      graphics.lineStyle(
        1,
        selected ? COLOR.amber : accent,
        locked ? 0.04 : selected ? 0.46 : 0.14,
      );
      graphics.strokeRect(PANEL_X + 2, 2, PANEL_WIDTH - 4, bandHeight - 4);
      if (selected) {
        graphics.fillStyle(COLOR.amber, 0.9);
        graphics.fillRect(PANEL_X, 4, 4, bandHeight - 8);
      }
      graphics.lineStyle(1, 0x140f0b, 0.32);
      for (let row = 13; row < bandHeight - 20; row += 15) {
        graphics.lineBetween(PANEL_X + 8, row, PANEL_RIGHT - 8, row + 5);
      }
      graphics.fillStyle(accent, locked ? 0.04 : 0.1);
      for (let fleck = 0; fleck < 7; fleck += 1) {
        const fleckX = PANEL_X + 22 + ((definition.index * 47 + fleck * 83) % (PANEL_WIDTH - 44));
        const fleckY = 14 + ((definition.index * 29 + fleck * 37) % Math.max(12, bandHeight - 31));
        graphics.fillRect(fleckX, fleckY, 2 + (fleck % 2), 2);
      }
      graphics.fillStyle(0x1a120c, 0.5);
      graphics.fillRect(PANEL_X + 5, 5, 4, bandHeight - 10);
      graphics.fillRect(PANEL_RIGHT - 9, 5, 4, bandHeight - 10);
      graphics.fillStyle(accent, locked ? 0.08 : 0.2);
      for (let bolt = 12; bolt < bandHeight - 8; bolt += 22) {
        graphics.fillRect(PANEL_X + 5, bolt, 4, 4);
        graphics.fillRect(PANEL_RIGHT - 9, bolt, 4, 4);
      }

      const tunnel = this.add.graphics();
      tunnel.fillStyle(0x120e0b, 0.9);
      tunnel.fillRect(PANEL_X + 16, bandHeight - 43, PANEL_WIDTH - 32, 27);
      tunnel.lineStyle(3, 0x5f432a, 0.9);
      tunnel.lineBetween(PANEL_X + 11, bandHeight - 47, PANEL_X + 11, bandHeight - 15);
      tunnel.lineBetween(PANEL_RIGHT - 11, bandHeight - 47, PANEL_RIGHT - 11, bandHeight - 15);
      tunnel.lineBetween(PANEL_X + 11, bandHeight - 47, PANEL_RIGHT - 11, bandHeight - 47);
      tunnel.lineStyle(1, 0x8d6a43, 0.48);
      for (let tie = PANEL_X + 32; tie < PANEL_RIGHT - 28; tie += 24) {
        tunnel.lineBetween(tie, bandHeight - 17, tie + 9, bandHeight - 41);
      }

      const indexLabel = this.add.text(
        PANEL_X + 14,
        compact ? 3 : 8,
        locked
          ? `${String(definition.index).padStart(2, '0')} 未勘探`
          : `${String(definition.index).padStart(2, '0')} ${definition.name}`,
        {
          fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
          fontSize: compact ? '16px' : '21px',
          fontStyle: 'bold',
          color: locked ? '#82725d' : selected ? '#fff0c9' : '#eadab9',
          stroke: '#17100a',
          strokeThickness: compact ? 3 : 4,
        },
      );
      indexLabel.setVisible(false);

      const lamp = this.add.rectangle(PANEL_RIGHT - 30, 18, 10, 10, 0x4f5148);
      const lampGlow = this.add.circle(
        PANEL_RIGHT - 30,
        compact ? 13 : 18,
        compact ? 9 : 12,
        locked ? 0x69645b : accent,
        locked ? 0.025 : 0.08,
      );
      const statusText = this.add
        .text(PANEL_RIGHT - 45, compact ? 3 : 8, locked ? '未解锁' : '1人待命', {
          fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
          fontSize: compact ? '13px' : '16px',
          fontStyle: 'bold',
          color: locked ? '#82725d' : '#d8c5a5',
        })
        .setOrigin(1, 0);
      statusText.setVisible(false);
      lamp.setY(compact ? 13 : 18);

      const minerY = bandHeight - (compact ? 11 : 38);
      const miners = Array.from({ length: 5 }, (_, workerIndex) =>
        this.createWorker(
          PANEL_X + (compact ? 106 : 94) + workerIndex * (compact ? 16 : 23),
          minerY,
          workerIndex === 0 ? accent : 0xd0a76c,
          workerIndex,
        ),
      );
      miners.forEach((worker, workerIndex) => {
        worker.root.setScale(compact ? 0.56 : 0.82);
        worker.root.setVisible(!locked && workerIndex === 0);
      });

      const oreCluster = this.createOreCluster(
        PANEL_X + (compact ? 39 : 44),
        bandHeight - (compact ? 15 : 24),
        definition,
        accent,
      );
      const orePile = oreCluster.container;
      const oreBlocks = oreCluster.shapes;

      const cargoText = this.add.text(
        PANEL_X + (compact ? 205 : 226),
        bandHeight - (compact ? 25 : 34),
        locked ? '等待勘探' : '井口 0',
        {
          fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
          fontSize: compact ? '13px' : '14px',
          color: '#f1dfbd',
        },
      );
      cargoText.setVisible(false);

      const progressBack = this.add.rectangle(
        PANEL_X + (compact ? 205 : 226),
        bandHeight - (compact ? 6 : 9),
        PANEL_WIDTH - (compact ? 220 : 240),
        6,
        0x120e0a,
        0.9,
      );
      progressBack.setOrigin(0, 0.5);
      progressBack.setVisible(!locked);
      const progress = this.add.rectangle(
        PANEL_X + (compact ? 205 : 226),
        bandHeight - (compact ? 6 : 9),
        PANEL_WIDTH - (compact ? 220 : 240),
        6,
        accent,
        1,
      );
      progress.setOrigin(0, 0.5);
      progress.setScale(0, 1);
      progress.setVisible(!locked);

      const highlight = this.add.rectangle(
        PANEL_X,
        0,
        PANEL_WIDTH,
        bandHeight,
        0x000000,
        0.001,
      );
      highlight.setOrigin(0, 0);
      highlight.setStrokeStyle(3, selected ? COLOR.amber : accent, selected ? 1 : 0.08);

      root.add([
        graphics,
        tunnel,
        indexLabel,
        lampGlow,
        lamp,
        statusText,
        orePile,
        cargoText,
        ...miners.map((worker) => worker.root),
        progressBack,
        progress,
        highlight,
      ]);
      this.layerVisuals.push({
        definition,
        locked,
        y,
        height: bandHeight,
        root,
        miners,
        orePile,
        oreBlocks,
        cargoText,
        statusText,
        progress,
        lamp,
        highlight,
      });
    });
    this.sharpenTextObjects();
  }

  private createWorker(
    x: number,
    y: number,
    accent: number,
    variant: number,
  ): WorkerVisual {
    const root = this.add.container(x, y);
    const shadow = this.add.ellipse(0, 21, 23, 6, COLOR.black, 0.34);
    const outline = this.add.rectangle(0, 6, 19, 23, 0x17110d, 1);
    const leftLeg = this.add.rectangle(-5, 17, 5, 8, 0x292019);
    const rightLeg = this.add.rectangle(5, 17, 5, 8, 0x292019);
    const leftBoot = this.add.rectangle(-6, 21, 8, 3, 0x0e0c0a);
    const rightBoot = this.add.rectangle(6, 21, 8, 3, 0x0e0c0a);
    const body = this.add.rectangle(0, 7, 15, 18, accent, 1);
    const shoulder = this.add.rectangle(0, 1, 18, 5, accent, 1);
    const belt = this.add.rectangle(0, 13, 15, 3, COLOR.amberDark);
    const vestStripe = this.add.rectangle(0, 5, 11, 2, 0xffe0a0, 0.9);
    const backpack = this.add.rectangle(-9, 8, 5, 12, 0x4e3825, 1);
    const neck = this.add.rectangle(0, -4, 5, 4, 0xa9704b);
    const head = this.add.rectangle(0, -8, 11, 9, 0xc89366);
    const eye = this.add.rectangle(3, -8, 2, 1, 0x302018);
    const helmet = this.add.rectangle(
      0,
      -13,
      15,
      5,
      variant % 3 === 0 ? COLOR.amber : variant % 3 === 1 ? 0xe8c48c : 0xd9844e,
    );
    const helmetBrim = this.add.rectangle(1, -12, 17, 2, 0x4b351f);
    const lamp = this.add.rectangle(6, -13, 3, 3, 0xfff0a6);
    const arm = this.add.rectangle(9, 6, 4, 13, 0xc89366);
    const rearArm = this.add.rectangle(-9, 6, 4, 12, 0xb98059);
    const carryOre = this.add
      .rectangle(11, 1, 7, 6, accent, 1)
      .setVisible(false);
    carryOre.setStrokeStyle(1, 0x352313, 0.7);
    const tool = this.add.container(14, 13);
    const handle = this.add.rectangle(
      0,
      0,
      3,
      18,
      variant % 2 === 0 ? COLOR.wood : 0xb68b5b,
    );
    const toolHead = this.add.rectangle(
      0,
      -9,
      variant % 2 === 0 ? 8 : 6,
      3,
      variant % 2 === 0 ? 0xc4d1cc : 0xb4b2a8,
    );
    tool.add([handle, toolHead]);
    root.add([
      shadow,
      outline,
      leftLeg,
      rightLeg,
      leftBoot,
      rightBoot,
      backpack,
      body,
      shoulder,
      belt,
      vestStripe,
      neck,
      head,
      eye,
      helmet,
      helmetBrim,
      lamp,
      rearArm,
      arm,
      carryOre,
      tool,
    ]);
    root.setScale(0.82);
    return { root, tool, arm, rearArm, carryOre };
  }

  private createOreCluster(
    x: number,
    y: number,
    definition: LayerDefinition,
    accent: number,
  ): {
    container: Phaser.GameObjects.Container;
    shapes: Phaser.GameObjects.Shape[];
  } {
    const container = this.add.container(x, y);
    const shapes: Phaser.GameObjects.Shape[] = [];
    const addShape = <T extends Phaser.GameObjects.Shape>(shape: T): T => {
      shape.setStrokeStyle(1, 0x23170d, 0.45);
      shapes.push(shape);
      container.add(shape);
      return shape;
    };
    const addTriangle = (
      centerX: number,
      centerY: number,
      width: number,
      height: number,
      rotation = 0,
    ): void => {
      const triangle = addShape(
        this.add.triangle(
          centerX,
          centerY,
          0,
          -height / 2,
          width / 2,
          height / 2,
          -width / 2,
          height / 2,
          accent,
          0.92,
        ),
      );
      triangle.setRotation(rotation);
    };
    const family = (definition.index - 1) % 6;

    if (family === 0) {
      addShape(this.add.rectangle(-10, 5, 15, 9, accent, 0.92).setRotation(-0.12));
      addShape(this.add.rectangle(2, 3, 17, 13, accent, 0.9).setRotation(0.08));
      addShape(this.add.rectangle(13, 7, 12, 8, accent, 0.88).setRotation(0.18));
      addShape(this.add.rectangle(0, -7, 11, 8, accent, 0.86).setRotation(-0.05));
    } else if (family === 1) {
      addTriangle(-10, 1, 14, 20, -0.18);
      addTriangle(2, -2, 17, 25, 0.08);
      addTriangle(13, 3, 12, 18, 0.24);
    } else if (family === 2) {
      addShape(this.add.rectangle(-10, 2, 5, 19, accent, 0.92).setRotation(-0.2));
      addShape(this.add.rectangle(0, 0, 5, 23, accent, 0.94).setRotation(0.08));
      addShape(this.add.rectangle(10, 3, 5, 18, accent, 0.9).setRotation(0.22));
      addShape(this.add.rectangle(17, 8, 4, 11, accent, 0.84).setRotation(0.3));
    } else if (family === 3) {
      const addDiamond = (centerX: number, centerY: number, size: number): void => {
        addTriangle(centerX, centerY - size * 0.2, size, size * 0.62);
        const bottom = addShape(
          this.add.triangle(
            centerX,
            centerY + size * 0.2,
            0,
            size * 0.34,
            size / 2,
            -size * 0.32,
            -size / 2,
            -size * 0.32,
            accent,
            0.9,
          ),
        );
        bottom.setRotation(Math.PI);
      };
      addDiamond(-8, 2, 13);
      addDiamond(5, -2, 17);
      addDiamond(15, 5, 10);
    } else if (family === 4) {
      addTriangle(-11, 3, 11, 17, -0.18);
      addTriangle(0, -2, 14, 25, 0);
      addTriangle(11, 1, 13, 22, 0.16);
      addTriangle(18, 7, 8, 13, 0.3);
    } else {
      addShape(this.add.rectangle(-12, 6, 17, 7, accent, 0.88).setRotation(-0.16));
      addTriangle(-2, -1, 15, 23, 0.05);
      addTriangle(11, 0, 12, 20, 0.2);
      addShape(this.add.rectangle(2, 8, 24, 4, accent, 0.7).setRotation(0.03));
    }
    return { container, shapes };
  }

  private drawShaft(): void {
    const graphics = this.add.graphics();
    graphics.setDepth(5);
    graphics.fillStyle(0x090806, 0.95);
    graphics.fillRect(SHAFT_X, SURFACE_Y, SHAFT_WIDTH, MINE_BOTTOM - SURFACE_Y);
    graphics.lineStyle(4, COLOR.shaftEdge, 0.86);
    graphics.strokeRect(
      SHAFT_X + 2,
      SURFACE_Y + 2,
      SHAFT_WIDTH - 4,
      MINE_BOTTOM - SURFACE_Y - 4,
    );
    graphics.lineStyle(2, 0x4c3b2b, 0.8);
    for (let y = SURFACE_Y + 22; y < MINE_BOTTOM; y += 24) {
      graphics.lineBetween(SHAFT_X + 12, y, SHAFT_X + SHAFT_WIDTH - 12, y);
    }
    graphics.lineStyle(3, 0x745538, 1);
    graphics.lineBetween(SHAFT_X + 18, SURFACE_Y, SHAFT_X + 18, MINE_BOTTOM);
    graphics.lineBetween(
      SHAFT_X + SHAFT_WIDTH - 18,
      SURFACE_Y,
      SHAFT_X + SHAFT_WIDTH - 18,
      MINE_BOTTOM,
    );
    graphics.lineStyle(2, 0x574029, 0.8);
    for (let y = SURFACE_Y + 8; y < MINE_BOTTOM; y += 26) {
      graphics.lineBetween(SHAFT_X + 18, y, SHAFT_X + SHAFT_WIDTH - 18, y + 18);
    }
    graphics.fillStyle(COLOR.amber, 0.22);
    graphics.fillRect(SHAFT_X + 8, SURFACE_Y, 4, MINE_BOTTOM - SURFACE_Y);
  }

  private drawSurface(): void {
    const graphics = this.add.graphics();
    graphics.setDepth(6);
    graphics.fillStyle(0x11100d, 1);
    graphics.fillRect(0, 100, 960, 24);
    graphics.fillStyle(0x4d3b2a, 1);
    graphics.fillRect(0, SURFACE_Y - 4, 960, 8);
    graphics.fillStyle(0xbf9561, 0.38);
    graphics.fillRect(0, SURFACE_Y - 4, 960, 2);

    graphics.fillStyle(COLOR.metal, 1);
    graphics.fillRect(SHAFT_X + 17, 43, 6, 80);
    graphics.fillRect(SHAFT_X + SHAFT_WIDTH - 23, 43, 6, 80);
    graphics.fillRect(SHAFT_X + 11, 38, SHAFT_WIDTH - 14, 8);
    graphics.fillStyle(COLOR.cream, 0.82);
    graphics.fillRect(SHAFT_X + 20, 48, SHAFT_WIDTH - 32, 4);
    graphics.fillStyle(COLOR.amber, 1);
    graphics.fillRect(SHAFT_CENTER - 7, 58, 13, 10);
    graphics.fillStyle(COLOR.black, 1);
    graphics.fillRect(SHAFT_CENTER - 3, 61, 3, 3);

    const roadStart = PANEL_X + 32;
    const roadEnd = HQ_X - 34;
    graphics.fillStyle(0x201d18, 1);
    graphics.fillRect(roadStart, 99, roadEnd - roadStart, 25);
    graphics.fillStyle(0xb28b58, 1);
    for (let x = roadStart + 20; x < roadEnd - 20; x += 58) {
      graphics.fillRect(x, 114, 32, 2);
    }

  }

  private createHeadquarters(): void {
    const graphics = this.add.graphics();
    graphics.setDepth(7);
    graphics.fillStyle(COLOR.black, 0.38);
    graphics.fillRect(HQ_X - 66, 22, 126, 90);
    graphics.fillStyle(0x8f6848, 1);
    graphics.fillRect(HQ_X - 60, 34, 116, 70);
    graphics.fillStyle(0xd5b47b, 1);
    graphics.fillRect(HQ_X - 54, 30, 104, 8);
    graphics.fillStyle(0x25312d, 1);
    graphics.fillRect(HQ_X - 50, 47, 94, 17);
    graphics.fillStyle(COLOR.amber, 0.95);
    graphics.fillRect(HQ_X - 48, 50, 17, 9);
    graphics.fillStyle(0x1a211e, 1);
    for (let index = 0; index < 4; index += 1) {
      graphics.fillRect(HQ_X - 45 + index * 23, 72, 16, 12);
      graphics.fillStyle(0x85b6a4, 0.8);
      graphics.fillRect(HQ_X - 42 + index * 23, 74, 10, 5);
      graphics.fillStyle(0x1a211e, 1);
    }
    graphics.fillStyle(COLOR.wood, 1);
    graphics.fillRect(HQ_X - 7, 88, 18, 17);

  }

  private createLift(): void {
    this.winchWheel = this.add.container(SHAFT_CENTER, 54).setDepth(9);
    const outer = this.add.circle(0, 0, 12, 0x29302c, 1);
    outer.setStrokeStyle(3, COLOR.amber, 1);
    this.winchRing = outer;
    this.winchWheel.add([
      outer,
      this.add.rectangle(0, 0, 21, 3, COLOR.cream),
      this.add.rectangle(0, 0, 3, 21, COLOR.cream),
    ]);

    this.liftManualCrank = this.add
      .container(SHAFT_X - 22, SURFACE_Y - 16)
      .setDepth(10);
    const crankHub = this.add.circle(0, 0, 5, 0x8a704c, 1);
    crankHub.setStrokeStyle(1, 0xe1c58f, 0.9);
    const crankArm = this.add.rectangle(9, 0, 19, 3, 0xcab07d, 1);
    const crankGrip = this.add.rectangle(18, 0, 4, 10, COLOR.wood, 1);
    this.liftManualCrank.add([crankHub, crankArm, crankGrip]);

    this.liftManualWorker = this.createWorker(
      SHAFT_X - 42,
      SURFACE_Y - 11,
      0xd5a35d,
      2,
    );
    this.liftManualWorker.root.setScale(0.72).setDepth(11);
    this.liftManualWorker.tool.setVisible(false);

    this.liftMotorAssembly = this.add
      .container(SHAFT_CENTER + 26, 54)
      .setDepth(10);
    const motorShadow = this.add.rectangle(3, 4, 29, 19, 0x080706, 0.35);
    const motorHousing = this.add.rectangle(0, 0, 24, 20, 0x59645f, 1);
    motorHousing.setStrokeStyle(2, 0xc8b27e, 0.9);
    const motorTop = this.add.rectangle(0, -11, 17, 4, COLOR.amber, 1);
    const motorLamp = this.add.rectangle(8, -4, 4, 4, 0x79debd, 1);
    const motorVentA = this.add.rectangle(-5, 5, 12, 2, 0x26302c, 0.8);
    const motorVentB = this.add.rectangle(-5, 9, 9, 2, 0x26302c, 0.8);
    this.liftMotorAssembly.add([
      motorShadow,
      motorHousing,
      motorTop,
      motorLamp,
      motorVentA,
      motorVentB,
    ]);
    this.liftDualDrive = this.add
      .container(SHAFT_CENTER, 54)
      .setDepth(10)
      .setVisible(false);
    const dualRail = this.add.rectangle(0, 17, 58, 3, 0xc8b27e, 1);
    const leftDrive = this.add.circle(-24, 0, 9, 0x3c6560, 1);
    leftDrive.setStrokeStyle(2, 0x80f0da, 0.9);
    const rightDrive = this.add.circle(24, 0, 9, 0x3c6560, 1);
    rightDrive.setStrokeStyle(2, 0x80f0da, 0.9);
    this.liftDualDrive.add([
      dualRail,
      leftDrive,
      rightDrive,
      this.add.rectangle(0, 0, 31, 3, 0xffd06a, 0.9),
    ]);

    this.liftCage = this.add.container(SHAFT_CENTER, MINE_BOTTOM - 46).setDepth(12);
    const cage = this.add.graphics();
    cage.fillStyle(0x17130f, 1);
    cage.fillRect(-31, -21, 62, 43);
    cage.fillStyle(0x56615d, 1);
    cage.fillRect(-28, -18, 56, 36);
    cage.fillStyle(0x15110d, 1);
    cage.fillRect(-22, -13, 44, 27);
    cage.lineStyle(2, COLOR.cream, 0.95);
    cage.strokeRect(-27, -17, 54, 34);
    cage.lineStyle(2, 0x9a805c, 0.9);
    cage.lineBetween(-15, -15, -15, 14);
    cage.lineBetween(0, -15, 0, 14);
    cage.lineBetween(15, -15, 15, 14);
    cage.lineBetween(-22, -5, 22, -5);
    cage.lineBetween(-22, 7, 22, 7);
    cage.fillStyle(COLOR.amber, 0.9);
    cage.fillRect(-27, 15, 54, 3);
    const leftRail = this.add.rectangle(-30, 0, 5, 42, 0x7f8a83);
    const rightRail = this.add.rectangle(30, 0, 5, 42, 0x7f8a83);
    const topRail = this.add.rectangle(0, -21, 63, 5, COLOR.metal);
    const bottomRail = this.add.rectangle(0, 21, 63, 5, COLOR.metal);
    const hook = this.add.rectangle(0, -28, 5, 13, COLOR.cream);
    this.liftLamp = this.add.rectangle(0, -16, 7, 4, 0x5a4b36);
    this.liftCrates = [
      this.add.rectangle(-10, 5, 16, 11, COLOR.amberDark),
      this.add.rectangle(8, 6, 18, 10, 0x9d7245),
    ];
    this.liftLevelPips = Array.from({ length: 8 }, (_, index) =>
      this.add
        .rectangle(-14 + index * 4, -21, 2, 2, 0x8f6a3c, 0.45)
        .setVisible(false),
    );
    this.liftGrabber = this.add.container(2, 10);
    const collectorGlow = this.add.circle(42, 9, 13, 0xf2c460, 0.08);
    const grabberBoom = this.add.rectangle(20, 0, 40, 3, 0xc9ad78, 1);
    const grabberBoomGlow = this.add.rectangle(20, -2, 37, 1, 0xffe0a0, 0.8);
    const collectorFrame = this.add.rectangle(42, 9, 8, 18, 0x74827d, 1);
    collectorFrame.setStrokeStyle(2, 0xd9c7a1, 0.9);
    this.liftCollectorRing = this.add.circle(42, 9, 7, 0x263b36, 1);
    this.liftCollectorRing.setStrokeStyle(2, 0xffd36d, 1);
    this.liftCollectorCore = this.add.rectangle(42, 9, 4, 4, 0xffefba, 1);
    this.liftGrabber.add([
      collectorGlow,
      grabberBoom,
      grabberBoomGlow,
      collectorFrame,
      this.liftCollectorRing,
      this.liftCollectorCore,
    ]);
    this.liftGrabber.setVisible(false);
    this.pickupBeamGraphics = this.add.graphics().setDepth(11);
    this.liftArmor = [
      this.add.rectangle(-35, 0, 6, 31, 0x7c8b85, 1),
      this.add.rectangle(35, 0, 6, 31, 0x7c8b85, 1),
    ];
    this.liftHydraulics = [
      this.add.rectangle(-21, 1, 3, 23, COLOR.amber, 0.9),
      this.add.rectangle(21, 1, 3, 23, COLOR.amber, 0.9),
    ];
    this.liftTechLights = [
      this.add.rectangle(-25, -12, 4, 3, 0x6fe2ce, 1),
      this.add.rectangle(25, -12, 4, 3, 0x6fe2ce, 1),
    ];
    this.liftArmor.forEach((part) => part.setVisible(false));
    this.liftHydraulics.forEach((part) => part.setVisible(false));
    this.liftTechLights.forEach((part) => part.setVisible(false));
    this.liftEnergyCore = this.add.container(0, -2).setVisible(false);
    const coreGlow = this.add.circle(
      0,
      0,
      10,
      0x61e6cf,
      0.16,
    );
    const coreRing = this.add.circle(0, 0, 7, 0x285a52, 1);
    coreRing.setStrokeStyle(2, 0xa6fff0, 1);
    const coreCenter = this.add.rectangle(0, 0, 5, 12, 0xe9fff9, 1);
    this.liftEnergyCore.add([coreGlow, coreRing, coreCenter]);
    this.liftCage.add([
      cage,
      leftRail,
      rightRail,
      topRail,
      ...this.liftLevelPips,
      bottomRail,
      hook,
      this.liftLamp,
      ...this.liftCrates,
      this.liftGrabber,
      ...this.liftArmor,
      ...this.liftHydraulics,
      ...this.liftTechLights,
      this.liftEnergyCore,
    ]);

    this.cableGraphics = this.add.graphics().setDepth(8);
  }

  private createTruck(): void {
    this.truck = this.add.container(420, ROAD_Y).setDepth(14);
    this.manualCart = this.add.container(0, 0);
    const cartShadow = this.add.rectangle(4, 15, 67, 8, COLOR.black, 0.3);
    const cartOutline = this.add.rectangle(-10, -2, 39, 25, 0x513722, 1);
    const cartBed = this.add.rectangle(-10, -2, 34, 20, 0x9c7042, 1);
    const cartRim = this.add.rectangle(-10, -12, 36, 4, COLOR.amberDark, 1);
    const cartFront = this.add.rectangle(8, -2, 4, 20, 0x6f4d2d, 1);
    const pullHandle = this.add.rectangle(34, -2, 46, 3, 0xc8ad78, 1);
    pullHandle.setRotation(-0.15);
    this.manualCartWheels = [-21, 2].map((x) => {
      const wheel = this.add.container(x, 13);
      const tire = this.add.circle(0, 0, 8, COLOR.black, 1);
      tire.setStrokeStyle(2, 0x9d896e, 1);
      wheel.add([
        tire,
        this.add.rectangle(0, 0, 11, 2, COLOR.metal),
        this.add.rectangle(0, 0, 2, 11, COLOR.metal),
      ]);
      return wheel;
    });
    this.manualCartCrates = [
      this.add.rectangle(-20, -14, 12, 9, 0xb9844c),
      this.add.rectangle(-7, -16, 14, 11, 0x6da899),
      this.add.rectangle(3, -13, 9, 7, 0xd6aa58),
    ];
    this.cartPuller = this.createWorker(
      52,
      6,
      0xd5a35d,
      3,
    );
    this.cartPuller.root.setScale(0.72);
    this.cartPuller.tool.setVisible(false);
    this.manualCart.add([
      cartShadow,
      cartOutline,
      cartBed,
      cartRim,
      cartFront,
      pullHandle,
      ...this.manualCartCrates,
      ...this.manualCartWheels,
      this.cartPuller.root,
    ]);

    this.truckAuxTrailer = this.add.container(-53, 1).setVisible(false);
    const auxShadow = this.add.rectangle(0, 15, 39, 7, COLOR.black, 0.28);
    const auxOutline = this.add.rectangle(0, 0, 37, 24, 0x4f3825, 1);
    const auxBody = this.add.rectangle(0, 0, 32, 19, 0xb9833f, 1);
    const auxRim = this.add.rectangle(0, -10, 34, 3, 0xffd06a, 0.9);
    const auxWheelA = this.add.circle(-10, 13, 6, COLOR.black, 1);
    const auxWheelB = this.add.circle(10, 13, 6, COLOR.black, 1);
    auxWheelA.setStrokeStyle(2, 0x9d896e, 1);
    auxWheelB.setStrokeStyle(2, 0x9d896e, 1);
    this.truckAuxTrailer.add([
      auxShadow,
      auxOutline,
      auxBody,
      auxRim,
      auxWheelA,
      auxWheelB,
    ]);

    const shadow = this.add.rectangle(3, 15, 78, 8, COLOR.black, 0.32);
    this.truckBody = this.add.container(0, 0);
    const chassis = this.add.rectangle(-5, 9, 72, 5, 0x211a14, 1);
    const trailerOutline = this.add.rectangle(-13, -2, 52, 29, 0x5d4028, 1);
    this.truckTrailer = this.add.rectangle(-13, -2, 48, 25, COLOR.amber, 1);
    const trailerEdge = this.add.rectangle(-13, -14, 43, 5, COLOR.amberDark);
    const bed = this.add.rectangle(-13, -2, 38, 5, 0x5f452c, 1);
    const cargoSideA = this.add.rectangle(-23, 0, 5, 19, 0xc68d4d, 0.38);
    const cargoSideB = this.add.rectangle(4, 0, 4, 19, 0x73a79b, 0.38);
    const cabOutline = this.add.rectangle(27, 1, 30, 27, 0x20332f, 1);
    this.truckCab = this.add.rectangle(27, 1, 26, 23, 0x3d7169, 1);
    const windshield = this.add.rectangle(32, -4, 11, 9, 0xa3d2ca, 1);
    const cabRoof = this.add.rectangle(27, -12, 24, 4, 0x264d47, 1);
    const grille = this.add.rectangle(38, 5, 5, 9, 0x1d2b28, 1);
    const fuelTank = this.add.rectangle(4, 8, 12, 5, 0x766c5e, 1);
    const bumper = this.add.rectangle(31, 13, 32, 4, COLOR.cream);
    this.truckHeadlight = this.add.rectangle(42, 2, 4, 4, 0xffe6a0, 0.25);
    this.truckTailLamp = this.add.rectangle(-38, 8, 4, 4, 0xd85d43, 0.3);
    this.truckCrates = [
      this.add.rectangle(-24, -13, 12, 9, 0xc68d4d),
      this.add.rectangle(-11, -14, 13, 11, 0x73a79b),
      this.add.rectangle(2, -12, 10, 8, 0xe0b65c),
    ];
    this.truckLevelPips = Array.from({ length: 8 }, (_, index) =>
      this.add
        .rectangle(-34 + index * 5, 8, 3, 2, 0x8f6a3c, 0.4)
        .setVisible(false),
    );
    this.truckArmor = [
      this.add.rectangle(-37, -2, 5, 22, 0x9a805c, 1),
      this.add.rectangle(9, -2, 4, 21, 0x9a805c, 1),
    ];
    this.truckRoofRack = [
      this.add.rectangle(27, -17, 21, 3, 0xbfa16f, 1),
      this.add.rectangle(20, -14, 3, 7, 0xbfa16f, 1),
      this.add.rectangle(34, -14, 3, 7, 0xbfa16f, 1),
    ];
    this.truckTechLights = [
      this.add.rectangle(15, -13, 4, 3, 0x7ce4d3, 1),
      this.add.rectangle(39, -8, 3, 3, 0x7ce4d3, 1),
    ];
    this.truckArmor.forEach((part) => part.setVisible(false));
    this.truckRoofRack.forEach((part) => part.setVisible(false));
    this.truckTechLights.forEach((part) => part.setVisible(false));
    this.truckEnergyCore = this.add.container(27, -3).setVisible(false);
    const truckCoreGlow = this.add.circle(0, 0, 8, 0x67ead3, 0.18);
    const truckCoreRing = this.add.circle(0, 0, 5, 0x24534d, 1);
    truckCoreRing.setStrokeStyle(2, 0xb5fff4, 1);
    const truckCoreBeam = this.add.rectangle(0, 0, 3, 9, 0xeafff9, 1);
    this.truckEnergyCore.add([
      truckCoreGlow,
      truckCoreRing,
      truckCoreBeam,
    ]);
    this.truckBody.add([
      shadow,
      chassis,
      trailerOutline,
      this.truckTrailer,
      trailerEdge,
      bed,
      cargoSideA,
      cargoSideB,
      ...this.truckCrates,
      ...this.truckLevelPips,
      cabOutline,
      this.truckCab,
      windshield,
      cabRoof,
      grille,
      fuelTank,
      this.truckTailLamp,
      this.truckHeadlight,
      bumper,
      ...this.truckArmor,
      ...this.truckRoofRack,
      ...this.truckTechLights,
      this.truckEnergyCore,
    ]);

    const createWheel = (x: number): Phaser.GameObjects.Container => {
      const wheel = this.add.container(x, 13);
      const tire = this.add.circle(0, 0, 7, COLOR.black, 1);
      tire.setStrokeStyle(2, 0x98846a, 1);
      wheel.add([
        tire,
        this.add.rectangle(0, 0, 10, 2, COLOR.metal),
        this.add.rectangle(0, 0, 2, 10, COLOR.metal),
      ]);
      return wheel;
    };
    this.truckWheels = [createWheel(-28), createWheel(10), createWheel(26)];
    this.truck.add([
      this.truckAuxTrailer,
      this.manualCart,
      this.truckBody,
      ...this.truckWheels,
    ]);
  }

  private createSurfacePile(): void {
    this.surfacePile = this.add.container(
      PANEL_X + 112,
      SURFACE_Y - 4,
    ).setDepth(11);
    const blocks = [
      [-15, 0, 17, 9],
      [0, -4, 18, 13],
      [15, 0, 14, 9],
      [1, -13, 13, 8],
    ];
    for (const [x, y, width, height] of blocks) {
      const block = this.add.rectangle(x, y, width, height, 0xb3834e, 0.9);
      block.setStrokeStyle(1, 0x24170c, 0.45);
      this.surfacePileBlocks.push(block);
      this.surfacePile.add(block);
    }
  }

  private createSceneLabels(): void {
    this.layerCaption = this.add
      .text(18, 161, '', {
        fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
        fontSize: '19px',
        fontStyle: 'bold',
        color: '#ffe4ad',
        stroke: '#120d09',
        strokeThickness: 4,
      })
      .setDepth(15)
      .setVisible(false);
    this.cargoCaption = this.add
      .text(18, 190, '', {
        fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
        fontSize: '15px',
        color: '#cbb796',
        stroke: '#120d09',
        strokeThickness: 3,
      })
      .setDepth(15)
      .setVisible(false);
    this.liftStopLabel = this.add
      .text(SHAFT_CENTER, 0, '', {
        fontFamily: '"Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#ffe1a0',
        backgroundColor: '#17110b',
        padding: { x: 5, y: 3 },
        align: 'center',
      })
      .setOrigin(0.5, 1)
      .setDepth(24)
      .setAlpha(0);
  }

  private createAmbientDetails(): void {
    const fine = this.add.graphics().setDepth(4);
    fine.lineStyle(1, 0xd1b478, 0.12);
    for (let y = MINE_TOP; y < MINE_BOTTOM; y += 22) {
      fine.lineBetween(8, y, 24 + (y % 18), y);
    }

    const dustCount = this.compactRendering ? 7 : 14;
    for (let index = 0; index < dustCount; index += 1) {
      const dust = this.add
        .rectangle(
          PANEL_X + 28 + ((index * 73) % (PANEL_WIDTH - 56)),
          MINE_TOP + 24 + ((index * 47) % (MINE_BOTTOM - MINE_TOP - 48)),
          1 + (index % 3),
          1 + ((index + 1) % 2),
          index % 3 === 0 ? COLOR.amber : 0xd8c29b,
          0.1 + (index % 4) * 0.035,
        )
        .setDepth(2);
      this.tweens.add({
        targets: dust,
        y: dust.y - 18 - (index % 5) * 4,
        x: dust.x + (index % 2 === 0 ? 6 : -6),
        alpha: { from: dust.alpha, to: 0.015 },
        duration: 2600 + index * 180,
        delay: index * 120,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
    }

    this.scanLine = this.add
      .rectangle(480, MINE_TOP, 900, 2, 0xf0c06d, 0.08)
      .setDepth(16);
    this.tweens.add({
      targets: this.scanLine,
      alpha: { from: 0.025, to: 0.11 },
      duration: 1400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });
  }

  private updateLayerAnimations(time: number): void {
    const state = this.gameState;
    if (!state) return;
    for (const visual of this.layerVisuals) {
      if (visual.locked) {
        if (visual.statusText.visible) {
          visual.statusText.setText('未解锁');
          visual.statusText.setColor('#82725d');
        }
        if (visual.cargoText.visible) visual.cargoText.setText('等待勘探');
        visual.progress.setScale(0, 1);
        visual.lamp.setFillStyle(0x4f4b43, 1);
        visual.orePile.setAlpha(0.12);
        visual.root.setAlpha(0.66);
        visual.miners.forEach((worker) => worker.root.setVisible(false));
        continue;
      }
      const compact = visual.height < 56;
      const mining = state.layers[visual.definition.index];
      const active = Boolean(mining?.active);
      const automated = Boolean(mining?.automated || state.adCrewSeconds > 0);
      const crewLevel = Math.min(5, Math.max(1, mining?.crewLevel ?? 1));
      visual.miners.forEach((worker, index) =>
        worker.root.setVisible(index < Math.min(crewLevel, compact ? 3 : 5)),
      );
      const queued = mining?.queued ?? 0;
      const cargo = mining?.payload.units ?? 0;
      const progress = this.layerProgress(mining);
      const selected = visual.definition.index === state.currentLayer;
      const accent = Phaser.Display.Color.HexStringToColor(visual.definition.accent).color;

      visual.root.setAlpha(selected ? 1 : 0.9);
      visual.progress.setScale(progress, 1);
      visual.progress.setFillStyle(
        active ? COLOR.amber : automated ? COLOR.teal : accent,
        1,
      );
      if (visual.statusText.visible) {
        visual.statusText.setText(
          active
            ? automated
              ? `监工 · ${crewLevel}人`
              : `${crewLevel}人钻探中`
            : queued > 0
              ? `${crewLevel}人 · 排班 ${queued}`
              : automated
                ? state.adCrewSeconds > 0 && !mining?.automated
                  ? `临时工班 · ${crewLevel}人`
                  : `监工 · ${crewLevel}人`
                : `${crewLevel}人待命`,
        );
        visual.statusText.setColor(
          active ? '#ffd06b' : automated ? '#8fe0c8' : '#d8c5a5',
        );
      }
      visual.lamp.setFillStyle(
        active ? COLOR.amber : automated ? COLOR.teal : 0x4f5148,
        1,
      );

      const layerCargo = state.layerCargo[visual.definition.index]?.underground.units ?? 0;
      if (visual.cargoText.visible) {
        visual.cargoText.setText(
          `井口 ${this.shortNumber(layerCargo)}吨${cargo > 0 ? ` · 本趟 ${this.shortNumber(cargo)}` : ''}`,
        );
      }
      const pileScale = Phaser.Math.Clamp(
        0.24 + Math.log10(layerCargo + 1) * 0.22 + progress * 0.16,
        0.24,
        1.14,
      );
      visual.orePile.setScale(pileScale * (compact ? 0.66 : 1));
      for (let index = 0; index < visual.oreBlocks.length; index += 1) {
        visual.oreBlocks[index].setFillStyle(accent, active ? 0.95 : 0.7);
        visual.oreBlocks[index].setAlpha(layerCargo > 0.01 || active ? 1 : 0.34);
      }

      visual.miners.forEach((worker, index) => {
        const visible = index < crewLevel && (!compact || index < 3);
        if (!visible) {
          worker.root.setVisible(false);
          return;
        }
        const working = active && visible;
        const direction = index % 2 === 0 ? 1 : -1;
        const wasVisible = worker.root.visible;
        const workerScale = compact ? 0.56 : 0.82;
        const depositX = PANEL_X + (compact ? 68 : 78);
        const miningFaceX = PANEL_X + (compact ? 168 : 202);
        const carrying = working && index === 0 && progress >= 0.72;
        const walkingRight = working && index === 0 && progress < 0.72;
        const facingScale = walkingRight || (!carrying && index === 0)
          ? workerScale
          : -workerScale;
        worker.root.setVisible(true);
        worker.root.setScale(facingScale, workerScale);
        if (visible && !wasVisible) {
          this.tweens.add({
            targets: worker.root,
            scaleX: { from: facingScale * 0.45, to: facingScale },
            scaleY: { from: workerScale * 0.45, to: workerScale },
            duration: 240,
            ease: 'Back.Out',
          });
        }
        worker.root.setAlpha(working ? 1 : visible ? 0.55 : 0);
        let workerX =
          PANEL_X +
          (compact ? 165 : 184) +
          Math.max(0, index - 1) * (compact ? 16 : 23);
        if (index === 0) {
          if (!working) {
            workerX = depositX;
          } else if (progress < 0.72) {
            workerX = Phaser.Math.Linear(
              depositX,
              miningFaceX,
              Phaser.Math.Easing.Sine.InOut(progress / 0.72),
            );
          } else {
            workerX = Phaser.Math.Linear(
              miningFaceX,
              depositX,
              Phaser.Math.Easing.Sine.InOut((progress - 0.72) / 0.28),
            );
          }
        }
        worker.root.y = Math.round(
          visual.height -
            (compact ? 11 : 38) +
            (working ? Math.sin(time / (54 + index * 7) + index) * 1.5 : 0),
        );
        worker.root.x = Math.round(workerX);
        worker.tool.setVisible(working && !carrying);
        worker.carryOre.setVisible(carrying);
        worker.tool.rotation = working && !carrying
          ? Math.round(
              (0.28 +
                Math.sin(time / (38 + index * 4) + index) * 0.58 * direction) *
                12,
            ) / 12
          : 0.28;
        worker.arm.rotation = carrying
          ? 0.38
          : working
            ? Math.sin(time / 70 + index) * 0.12
            : 0;
        worker.rearArm.rotation = working
          ? -Math.sin(time / 70 + index) * 0.09
          : 0;
      });

      visual.highlight.setStrokeStyle(
        selected ? 3 : 1,
        selected ? COLOR.amber : accent,
        selected ? 1 : 0.08,
      );
    }
  }

  private layerProgress(mining: LayerMiningState | undefined): number {
    if (!mining?.active) return 0;
    return Phaser.Math.Clamp(
      mining.progress / Math.max(0.001, mining.tripDuration),
      0,
      1,
    );
  }

  private smoothFactor(perFrameFactor: number, delta: number): number {
    const frameDelta = Phaser.Math.Clamp(delta, 8, 50);
    return 1 - Math.pow(1 - perFrameFactor, frameDelta / (1000 / 60));
  }

  private updateLift(time: number, delta: number): void {
    const state = this.gameState;
    if (!state) return;
    const lift = state.lines.lift;
    const routeLayers = this.layerVisuals
      .map((visual) => visual.definition.index)
      .filter((index) => index <= state.deepestLayer)
      .sort((a, b) => b - a);
    const sourceLayer = routeLayers[0] ?? state.currentLayer;
    const sourceY = this.layerCenter(sourceLayer);
    const topY = LIFT_TOP_Y;
    const progress = this.lockedProgress(lift);
    const tier = this.equipmentTier(lift.level);
    const levelBuild = 1 + Math.min(8, Math.max(0, lift.level - 1)) * 0.012;
    this.pickupBeamGraphics.clear();
    if (!lift.active || progress + 0.5 < this.lastLiftProgress) {
      this.seenLiftPickups.clear();
    }

    let cageY = topY;
    let loaded = false;
    let dwelling = false;
    this.activeDwellLayer = 0;
    if (lift.active) {
      if (progress < 0.25) {
        const descent = Phaser.Math.Easing.Cubic.InOut(progress / 0.25);
        cageY = topY + (sourceY - topY) * descent;
        this.liftStopLabel.setAlpha(0);
        this.lastLiftDwellLayer = 0;
      } else {
        const routePoints = [sourceY];
        routeLayers.slice(1).forEach((layer) => {
          routePoints.push(this.layerCenter(layer));
        });
        routePoints.push(topY);
        const ascentProgress = Phaser.Math.Clamp(
          (progress - 0.25) / 0.68,
          0,
          0.9999,
        );
        const pointIndex = Math.floor(ascentProgress * routePoints.length);
        const segmentProgress =
          ascentProgress * routePoints.length - pointIndex;
        const startY =
          pointIndex === 0 ? sourceY : routePoints[pointIndex - 1];
        const endY = routePoints[pointIndex] ?? topY;
        const travel = Phaser.Math.Easing.Cubic.InOut(
          Math.min(1, segmentProgress / 0.36),
        );
        cageY = startY + (endY - startY) * travel;
        dwelling = segmentProgress >= 0.36 && pointIndex < routePoints.length - 1;
        if (dwelling) {
          const dwellLayer = routeLayers[pointIndex] ?? sourceLayer;
          const hasCargo = lift.payloadLayers.includes(dwellLayer);
          const dwellProgress = Phaser.Math.Clamp(
            (segmentProgress - 0.36) / 0.64,
            0,
            1,
          );
          this.activeDwellLayer = dwellLayer;
          cageY += Math.sin(time / 62) * 1.3;
          const stopCopy = hasCargo
            ? `第 ${dwellLayer} 层 · 抓取`
            : `第 ${dwellLayer} 层 · 空仓`;
          if (this.liftStopLabel.text !== stopCopy) {
            this.liftStopLabel
              .setText(stopCopy)
              .setColor(hasCargo ? '#ffe1a0' : '#b7b2a7');
          }
          this.liftStopLabel
            .setPosition(SHAFT_CENTER, cageY - 38)
            .setAlpha(1);
          if (this.lastLiftDwellLayer !== dwellLayer) {
            this.lastLiftDwellLayer = dwellLayer;
            this.animateOrePickup(
              dwellLayer,
              !lift.payloadLayers.some((layer) =>
                routeLayers.includes(layer),
              ) &&
                dwellLayer === routeLayers[0] &&
                lift.payload.units > 0,
            );
            this.burst(
              SHAFT_CENTER,
              cageY - 12,
              this.seenLiftPickups.has(dwellLayer) ? '#f4d29a' : '#8d8b80',
              2,
              18,
            );
          }
          const reach = Phaser.Math.Easing.Sine.InOut(
            Phaser.Math.Clamp(dwellProgress / 0.42, 0, 1),
          );
          const retract = Phaser.Math.Easing.Sine.InOut(
            Phaser.Math.Clamp((dwellProgress - 0.78) / 0.22, 0, 1),
          );
          const extension = reach * (1 - retract);
          const grip = Phaser.Math.Clamp(
            (dwellProgress - 0.38) / 0.26,
            0,
            1,
          );
          this.liftGrabber.x = 2 + extension * 5;
          this.liftGrabber.y =
            10 + Math.sin(dwellProgress * Math.PI) * 2;
          this.liftCollectorRing.setScale(1 + grip * 0.28);
          this.liftCollectorCore.setAlpha(0.45 + grip * 0.55);
          const targetY = this.layerCenter(dwellLayer) - 8;
          const pulseAlpha = 0.18 + grip * 0.24;
          this.pickupBeamGraphics.lineStyle(2, 0xf4ce7a, pulseAlpha);
          this.pickupBeamGraphics.lineBetween(
            SHAFT_X + SHAFT_WIDTH - 3,
            cageY + 5,
            PANEL_X + 10,
            targetY,
          );
          for (let pulse = 0; pulse < 3; pulse += 1) {
            const ratio = (dwellProgress + pulse / 3) % 1;
            this.pickupBeamGraphics.fillStyle(0xffe0a0, 0.55);
            this.pickupBeamGraphics.fillCircle(
              Phaser.Math.Linear(SHAFT_X + SHAFT_WIDTH - 3, PANEL_X + 10, ratio),
              Phaser.Math.Linear(cageY + 5, targetY, ratio),
              2,
            );
          }
        } else {
          this.lastLiftDwellLayer = 0;
          this.liftStopLabel.setAlpha(0);
        }
      }

      const pickupLayers = [...(lift.payloadLayers ?? [sourceLayer])].sort(
        (a, b) => b - a,
      );
      for (const layer of pickupLayers) {
        if (this.seenLiftPickups.has(layer)) continue;
        if (cageY <= this.layerCenter(layer) + 3) {
          this.seenLiftPickups.add(layer);
          const point = this.layerPoint(layer);
          this.burst(point.x + 8, point.y - 12, '#f4d29a', 3, 24);
        }
      }
      loaded = this.seenLiftPickups.size > 0;
      if (lift.payload.units > 0 && progress >= 0.3) loaded = true;
      this.liftGrabber.setVisible(dwelling);
    } else {
      this.liftStopLabel.setAlpha(0);
      this.lastLiftDwellLayer = 0;
      this.liftGrabber.setVisible(false);
    }
    if (this.liftSmoothY === 0) this.liftSmoothY = cageY;
    this.liftSmoothY = Phaser.Math.Linear(
      this.liftSmoothY,
      cageY,
      this.smoothFactor(
        lift.active ? (dwelling ? 0.5 : 0.36) : 0.16,
        delta,
      ),
    );
    this.liftCage.x =
      SHAFT_CENTER + (lift.active ? Math.sin(time / 115) * 0.9 : 0);
    this.liftCage.y = this.liftSmoothY;
    this.liftCage.setAlpha(1);
    const cageScale =
      ([0.84, 0.92, 1, 1.07, 1.13, 1.2][tier - 1] ?? 1) * levelBuild;
    this.liftCage.setScale(cageScale);
    this.liftManualCrank.setVisible(tier === 1);
    this.liftManualWorker.root.setVisible(tier === 1);
    this.liftMotorAssembly.setVisible(tier >= 2);
    this.liftDualDrive.setVisible(tier >= 5);
    this.liftEnergyCore.setVisible(tier >= 6);
    if (tier >= 6) this.liftEnergyCore.rotation = time / 520;
    this.liftArmor.forEach((part) => part.setVisible(tier >= 2));
    this.liftHydraulics.forEach((part) => part.setVisible(tier >= 3));
    this.liftTechLights.forEach((part) => part.setVisible(tier >= 4));
    this.liftLevelPips.forEach((pip, index) => {
      const visible = index < Math.min(8, lift.level);
      pip.setVisible(visible);
      pip.setFillStyle(tier >= 5 ? 0x7ce4d3 : COLOR.amber, 1);
    });
    this.winchRing.setStrokeStyle(
      3,
      tier >= 5 ? 0x7ce4d3 : tier >= 3 ? 0xf3c35e : COLOR.amber,
      1,
    );
    if (lift.active) {
      const winchSpeed = [180, 105, 68, 42, 34, 28][tier - 1] ?? 90;
      this.winchWheel.rotation = time / winchSpeed;
      this.liftManualCrank.rotation = time / (winchSpeed * 0.82);
    }
    this.liftManualWorker.arm.rotation =
      tier === 1
        ? (lift.active ? Math.sin(time / 82) * 0.52 : -0.18)
        : 0;
    this.liftManualWorker.rearArm.rotation =
      tier === 1
        ? (lift.active ? -Math.sin(time / 82) * 0.34 : 0.12)
        : 0;
    this.liftManualWorker.root.y =
      SURFACE_Y -
      11 +
      (tier === 1 && lift.active ? Math.sin(time / 110) * 1.2 : 0);
    this.liftLamp.setFillStyle(loaded ? 0x76d8a5 : lift.active ? COLOR.amber : 0x5a4b36, 1);

    this.liftCrates.forEach((crate, index) => {
      const crateLoaded =
        loaded && index < Math.max(1, this.seenLiftPickups.size);
      crate.setAlpha(crateLoaded ? 1 : 0.18);
      crate.y = crateLoaded ? 6 + index : 15;
    });

    this.cableGraphics.clear();
    this.cableGraphics.lineStyle(2, 0xd9c7a1, 0.72);
    this.cableGraphics.lineBetween(
      SHAFT_CENTER - 9,
      64,
      this.liftCage.x - 20,
      this.liftCage.y - 21,
    );
    this.cableGraphics.lineBetween(
      SHAFT_CENTER + 9,
      64,
      this.liftCage.x + 20,
      this.liftCage.y - 21,
    );
    this.lastLiftProgress = progress;
  }

  private updateTruck(time: number, delta: number): void {
    const state = this.gameState;
    if (!state) return;
    const truck = state.lines.truck;
    const progress = this.lockedProgress(truck);
    const tier = this.equipmentTier(truck.level);
    const levelBuild = 1 + Math.min(8, Math.max(0, truck.level - 1)) * 0.01;
    const capacity = Math.max(0.001, getLineCapacity(state, 'truck'));
    const loadRatio = truck.active
      ? Phaser.Math.Clamp(truck.payload.units / capacity, 0, 1)
      : 0;
    const startX = 720;
    const destinationX = 316;
    const route = startX - destinationX;
    let targetX = startX;
    let loadFactor = 0;
    let turnTilt = 0;
    this.truckFacing = -1;
    if (!truck.active) {
      this.truckPhase = 'idle';
    } else if (progress < 0.46) {
      this.truckPhase = 'outbound';
      const outbound = Phaser.Math.Easing.Sine.InOut(progress / 0.46);
      targetX = startX - route * outbound;
    } else if (progress < 0.54) {
      this.truckPhase = 'turnaround';
      const turnProgress = (progress - 0.46) / 0.08;
      targetX = destinationX;
      this.truckFacing = -Math.cos(turnProgress * Math.PI);
      turnTilt = Math.sin(turnProgress * Math.PI) * 0.12;
      loadFactor = Phaser.Math.Clamp(turnProgress / 0.78, 0, 1);
    } else if (progress < 0.92) {
      this.truckPhase = 'return';
      const returning = Phaser.Math.Easing.Sine.InOut(
        (progress - 0.54) / 0.38,
      );
      targetX = destinationX + route * returning;
      this.truckFacing = 1;
      loadFactor = 1;
    } else {
      this.truckPhase = 'reset-turn';
      const turnProgress = (progress - 0.92) / 0.08;
      targetX = startX;
      this.truckFacing = Math.cos(turnProgress * Math.PI);
      turnTilt = Math.sin(turnProgress * Math.PI) * 0.08;
      loadFactor = 1 - Phaser.Math.Clamp(turnProgress, 0, 1);
    }
    this.truckSmoothX = Phaser.Math.Linear(
      this.truckSmoothX,
      targetX,
      this.smoothFactor(truck.active ? 0.34 : 0.18, delta),
    );
    this.truck.x = this.truckSmoothX;
    const deltaX = this.truck.x - this.previousTruckX;
    const visibleLoad = loadRatio * loadFactor;
    if (this.truckPhase === 'turnaround' && !this.wasTruckTurnaround) {
      this.animateSurfaceTransfer(
        this.surfacePile.x,
        this.surfacePile.y - 4,
        this.truck.x,
        this.truck.y - 8,
        0xf1c46e,
        7,
      );
    }
    if (this.truckPhase === 'reset-turn' && !this.wasTruckResetTurn) {
      this.animateSurfaceTransfer(
        this.truck.x,
        this.truck.y - 8,
        HQ_X - 18,
        78,
        0xffd265,
        7,
      );
    }
    this.wasTruckTurnaround = this.truckPhase === 'turnaround';
    this.wasTruckResetTurn = this.truckPhase === 'reset-turn';
    this.truck.y =
      ROAD_Y +
      visibleLoad * 3 +
      Math.abs(turnTilt) * 16 +
      (truck.active ? Math.sin(time / 40) * 0.55 : 0);
    this.truckBody.y = visibleLoad * 2;
    this.manualCart.y = visibleLoad * 2;
    this.manualCart.setVisible(tier === 1);
    this.truckBody.setVisible(tier >= 2);
    this.truckAuxTrailer.setVisible(tier >= 5);
    this.truckEnergyCore.setVisible(tier >= 6);
    if (tier >= 6) this.truckEnergyCore.rotation = -time / 540;
    this.truckWheels.forEach((wheel) => wheel.setVisible(tier >= 2));
    const truckScale =
      ([1, 0.82, 0.96, 1.06, 1.12, 1.18][tier - 1] ?? 1) * levelBuild;
    this.truck.setScale(truckScale * this.truckFacing, truckScale);
    this.truckTrailer.setFillStyle(
      tier >= 6
        ? 0x7ce4d3
        : tier >= 5
          ? 0xe0b555
          : tier >= 4
            ? 0xd0a94f
            : tier >= 3
              ? 0xdf9b39
              : COLOR.amber,
      1,
    );
    this.truckCab.setFillStyle(
      tier >= 6
        ? 0x235b60
        : tier >= 4
          ? 0x326b73
          : tier >= 3
            ? 0x397f72
            : 0x3d7169,
      1,
    );
    this.truckArmor.forEach((part) => part.setVisible(tier >= 2));
    this.truckRoofRack.forEach((part) => part.setVisible(tier >= 3));
    this.truckTechLights.forEach((part, index) =>
      part.setVisible(tier >= 4 && (truck.active || Math.floor(time / 450 + index) % 2 === 0)),
    );
    this.truckLevelPips.forEach((pip, index) => {
      const visible = tier >= 2 && index < Math.min(8, truck.level);
      pip.setVisible(visible);
      pip.setFillStyle(tier >= 5 ? 0x7ce4d3 : COLOR.amber, 1);
    });
    this.truckBody.rotation =
      Phaser.Math.Clamp(deltaX * 0.006, -0.035, 0.035) + turnTilt;
    this.manualCart.rotation =
      Phaser.Math.Clamp(deltaX * 0.003, -0.018, 0.018) + turnTilt * 0.62;
    this.cartPuller.root.y =
      6 +
      (truck.active ? Math.sin(time / 48) * 1.5 : 0);
    this.cartPuller.arm.rotation =
      truck.active ? 0.38 + Math.sin(time / 52) * 0.16 : 0.3;
    this.cartPuller.rearArm.rotation =
      truck.active ? -0.25 - Math.sin(time / 52) * 0.12 : -0.18;
    this.truckHeadlight.setAlpha(
      this.truckPhase === 'outbound' || this.truckPhase === 'return'
        ? 1
        : 0.2,
    );
    this.truckTailLamp.setAlpha(
      this.truckPhase === 'idle' ? 0.25 : 0.9,
    );
    this.truckCrates.forEach((crate, index) => {
      crate.setAlpha(visibleLoad > (index + 0.15) / 3 ? 1 : 0.12);
      crate.y = -12 - Math.max(0, visibleLoad - 0.35) * 4;
    });
    this.manualCartCrates.forEach((crate, index) => {
      crate.setAlpha(visibleLoad > (index + 0.15) / 3 ? 1 : 0.12);
    });
    this.manualCartWheels.forEach((wheel, index) => {
      wheel.rotation += deltaX / (8 + index * 0.25);
    });
    this.truckWheels.forEach((wheel, index) => {
      wheel.rotation += deltaX / (7 + index * 0.2);
    });
    if (
      truck.active &&
      Math.abs(deltaX) > 0.05 &&
      time - this.lastTruckDust > 190
    ) {
      this.lastTruckDust = time;
      this.truckDust(1);
    }
    this.previousTruckX = this.truck.x;
  }

  private updateSurfaceCargo(time: number): void {
    const state = this.gameState;
    if (!state) return;
    const scale = Phaser.Math.Clamp(
      0.3 + Math.log10(state.surface.units + 1) * 0.26,
      0.3,
      1.18,
    );
    this.surfacePile.setScale(scale);
    this.surfacePile.setAlpha(state.surface.units > 0.01 ? 1 : 0.26);
    this.surfacePile.y = SURFACE_Y - 4 + Math.sin(time / 450) * 0.4;
  }

  private layerCenter(index: number): number {
    const visual = this.layerVisuals.find((entry) => entry.definition.index === index);
    if (visual) return visual.y + visual.height - 30;
    return Phaser.Math.Clamp(
      MINE_TOP + (index - (this.gameState?.currentLayer ?? index)) * 68,
      MINE_TOP + 30,
      MINE_BOTTOM - 30,
    );
  }

  private equipmentTier(level: number): number {
    if (level >= 10) return 6;
    if (level >= 8) return 5;
    if (level >= 6) return 4;
    if (level >= 4) return 3;
    if (level >= 2) return 2;
    return 1;
  }

  private layerPoint(index: number): { x: number; y: number } {
    const y = this.layerCenter(index);
    return { x: PANEL_X + 108, y };
  }

  private animateOrePickup(layerIndex: number, forceCargo = false): void {
    const state = this.gameState;
    if (!state) return;
    const part = state.lines.lift.payloadParts.find(
      (entry) => entry.layer === layerIndex,
    );
    const point = this.layerPoint(layerIndex);
    const layer = getLayerDefinition(layerIndex);
    const cargoValue =
      part?.totalValue ??
      (forceCargo ? state.lines.lift.payload.totalValue : 0);
    const hasCargo = Boolean(part) || forceCargo;
    const color = hasCargo
      ? Phaser.Display.Color.HexStringToColor(layer.accent).color
      : 0x8f8d82;
    const count = hasCargo
      ? this.compactRendering
        ? 3
        : 4
      : this.compactRendering
        ? 1
        : 2;
    for (let index = 0; index < count; index += 1) {
      const ore = this.add.rectangle(
        point.x + index * 5,
        point.y - 8 - index * 2,
        4 + (index % 2) * 2,
        4,
        color,
        1,
      );
      ore.setDepth(26);
      this.tweens.add({
        targets: ore,
        x: this.liftCage.x + (index - 1) * 4,
        y: this.liftCage.y - 4,
        alpha: 0.2,
        duration: 280 + index * 45,
        ease: 'Cubic.In',
        onComplete: () => ore.destroy(),
      });
    }
    if (hasCargo) {
      this.floatText(
        point.x + 34,
        point.y - 28,
        `+${formatMoney(cargoValue * getOutputMultiplier(state))}`,
        '#ffe0a0',
        16,
      );
    }
  }

  private truckDust(count: number): void {
    if (!this.ready) return;
    const startX = this.truck.x - 39;
    const startY = this.truck.y + 15;
    const visibleCount = this.compactRendering
      ? Math.max(1, Math.ceil(count * 0.55))
      : count;
    for (let index = 0; index < visibleCount; index += 1) {
      const dust = this.add.rectangle(
        startX + index * 7,
        startY,
        5 + index,
        4 + (index % 2),
        0xb59a74,
        0.34,
      );
      dust.setDepth(13);
      this.tweens.add({
        targets: dust,
        x: dust.x - 22 - index * 5,
        y: dust.y - 4 - index * 2,
        alpha: 0,
        scaleX: 1.8,
        scaleY: 1.6,
        duration: 420 + index * 80,
        ease: 'Cubic.Out',
        onComplete: () => dust.destroy(),
      });
    }
  }

  private animateSurfaceTransfer(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    color: number,
    count: number,
  ): void {
    const visibleCount = this.compactRendering
      ? Math.max(3, Math.ceil(count * 0.55))
      : count;
    for (let index = 0; index < visibleCount; index += 1) {
      const ore = this.add.rectangle(
        startX + (index % 3) * 4,
        startY - Math.floor(index / 3) * 3,
        4 + (index % 2) * 2,
        4,
        color,
        0.95,
      );
      ore.setDepth(22);
      this.tweens.add({
        targets: ore,
        x: endX + (index % 3) * 5 - 5,
        y: endY - Math.floor(index / 3) * 3,
        alpha: 0.15,
        duration: 330 + index * 35,
        delay: index * 28,
        ease: 'Sine.InOut',
        onComplete: () => ore.destroy(),
      });
    }
  }

  private burst(
    x: number,
    y: number,
    color: string,
    count: number,
    distance: number,
  ): void {
    const numericColor = Phaser.Display.Color.HexStringToColor(color).color;
    const visibleCount = this.compactRendering
      ? Math.max(1, Math.round(count * 0.48))
      : count;
    for (let index = 0; index < visibleCount; index += 1) {
      const size = 2 + (index % 4);
      const particle = this.add.rectangle(x, y, size, size, numericColor, 1);
      particle.setDepth(24);
      const angle =
        (Math.PI * 2 * index) / visibleCount + (index % 3) * 0.2;
      const radius = distance * (0.42 + (index % 5) * 0.11);
      this.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * radius,
        y: y + Math.sin(angle) * radius - 14,
        alpha: 0,
        angle: 120 + index * 18,
        duration: 330 + (index % 4) * 70,
        ease: 'Cubic.Out',
        onComplete: () => particle.destroy(),
      });
    }
  }

  private floatText(
    x: number,
    y: number,
    text: string,
    color: string,
    size = 18,
  ): void {
    const label = this.add.text(x, y, text, {
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      fontSize: `${size}px`,
      fontStyle: 'bold',
      color,
      stroke: '#120c08',
      strokeThickness: 5,
    });
    label
      .setOrigin(0.5)
      .setDepth(31)
      .setResolution(this.compactRendering ? 2 : 4);
    this.tweens.add({
      targets: label,
      y: y - 40,
      alpha: 0,
      duration: 880,
      ease: 'Cubic.Out',
      onComplete: () => label.destroy(),
    });
  }

  private sharpenTextObjects(): void {
    const resolution = this.compactRendering ? 2 : 4;
    for (const child of this.children.list) {
      if (child instanceof Phaser.GameObjects.Text) {
        child.setResolution(resolution);
      }
    }
  }

  private showEventText(text: string, color: string): void {
    this.game.events.emit('scene-message', { text, color });
  }
}
