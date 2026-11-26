import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
const edgePath =
  process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outputDir = path.resolve('artifacts', 'smoke');

const viewports = [
  { name: 'mobile-360x640', width: 360, height: 640 },
  { name: 'mobile-390x844', width: 390, height: 844 },
  { name: 'desktop-1280x720', width: 1280, height: 720 },
  { name: 'desktop-1366x768', width: 1366, height: 768 },
  { name: 'desktop-1920x1080', width: 1920, height: 1080 },
];

await access(edgePath);
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: edgePath,
  headless: true,
});

const results = [];

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      locale: 'zh-CN',
    });
    const page = await context.newPage();
    const errors = [];

    page.on('pageerror', (error) => {
      errors.push(`pageerror: ${error.message}`);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });

    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => globalThis.game?.isRunning === true, null, {
        timeout: 15_000,
      });
      await page.waitForFunction(
        () => globalThis.game?.scene?.isActive('mine') === true,
        null,
        { timeout: 15_000 },
      );
      await page.waitForTimeout(700);

      const layout = await page.evaluate(async () => {
        const visible = (element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width > 0 &&
            rect.height > 0
          );
        };
        const rectOf = (selector) => {
          const element = [...document.querySelectorAll(selector)].find(visible);
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          };
        };
        const intersects = (a, b) =>
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;

        const requiredSelectors = [
          '.topbar',
          '.brand',
          '.money-hud',
          '.tutorial-banner',
          '.scene-frame',
          '#mine-stage canvas',
          '.layer-rail-shell',
          '.layer-card',
          '.scene-layer-hitareas button',
          '.frontier-unlock-bar',
          '#unlock-layer-button',
          '[data-action="upgrade-layer"]',
        ];
        const missing = requiredSelectors.filter((selector) => !rectOf(selector));
        const outsideViewport = requiredSelectors
          .filter((selector) => selector !== '#mine-stage canvas')
          .map((selector) => [selector, rectOf(selector)])
          .filter(([, rect]) => rect && (rect.left < -1 || rect.right > innerWidth + 1))
          .map(([selector]) => selector);

        const topbarSelectors = ['.brand', '.money-hud', '#company-level-chip', '.topbar-actions'];
        const topbarParts = topbarSelectors
          .map((selector) => [selector, rectOf(selector)])
          .filter(([, rect]) => rect);
        const topbarOverlaps = [];
        for (let index = 0; index < topbarParts.length; index += 1) {
          for (let other = index + 1; other < topbarParts.length; other += 1) {
            if (intersects(topbarParts[index][1], topbarParts[other][1])) {
              topbarOverlaps.push(`${topbarParts[index][0]} <> ${topbarParts[other][0]}`);
            }
          }
        }

        const lineCards = [...document.querySelectorAll('.line-action')].filter(visible);
        const clippedLineCards = lineCards
          .filter(
            (card) => card.scrollWidth > card.clientWidth + 2 || card.scrollHeight > card.clientHeight + 2,
          )
          .map((card) => card.dataset.line ?? 'unknown');
        const layerStepperButtons = [
          ...document.querySelectorAll('.layer-stepper button'),
        ];
        const layerStepperIcons = layerStepperButtons.filter(
          (button) => button.querySelector('svg'),
        ).length;
        const frontierSignalIcon = Boolean(
          document.querySelector('.frontier-signal svg'),
        );

        const sceneTextIssues = [];
        const sceneCargoLabels = [
          ...document.querySelectorAll('.scene-layer-cargo'),
        ].map((element) => element.textContent?.trim() ?? '');
        const sceneCargoUsesMoney = sceneCargoLabels.every(
          (label) =>
            label === '等待勘探' ||
            (label.includes('¥') && !label.includes('吨')),
        );
        for (const layerButton of document.querySelectorAll(
          '.scene-layer-hitareas button',
        )) {
          const layer = layerButton.dataset.layer ?? 'unknown';
          const buttonRect = layerButton.getBoundingClientRect();
          const textParts = [
            ...layerButton.querySelectorAll(
              '.scene-layer-title, .scene-layer-status, .scene-layer-cargo',
            ),
          ].filter(visible);
          for (const part of textParts) {
            const rect = part.getBoundingClientRect();
            if (
              rect.left < buttonRect.left - 1 ||
              rect.right > buttonRect.right + 1 ||
              rect.top < buttonRect.top - 1 ||
              rect.bottom > buttonRect.bottom + 1
            ) {
              sceneTextIssues.push(`layer ${layer} text outside row`);
            }
          }
          const title = layerButton.querySelector('.scene-layer-title');
          const status = layerButton.querySelector('.scene-layer-status');
          const cargo = layerButton.querySelector('.scene-layer-cargo');
          if (
            title &&
            status &&
            intersects(
              title.getBoundingClientRect(),
              status.getBoundingClientRect(),
            )
          ) {
            sceneTextIssues.push(`layer ${layer} title overlaps status`);
          }
          if (
            status &&
            cargo &&
            intersects(
              status.getBoundingClientRect(),
              cargo.getBoundingClientRect(),
            )
          ) {
            sceneTextIssues.push(`layer ${layer} status overlaps cargo`);
          }
        }

        const canvas = document.querySelector('#mine-stage canvas');
        const productionGrid = document.querySelector('.production-grid');
        const productionColumns = productionGrid
          ? getComputedStyle(productionGrid).gridTemplateColumns.split(' ').filter(Boolean).length
          : 0;
        const actionButton = document.querySelector(
          '[data-action="queue"][data-line="drill"]',
        );
        const automationButton = document.querySelector(
          '#layer-toolbar-supervisor',
        );
        const lineTitle = document.querySelector('.line-title h3');
        const brandTitle = document.querySelector('.brand-copy h1');
        const productionRect = productionGrid?.getBoundingClientRect();
        const railRect = document.querySelector('.layer-rail-shell')?.getBoundingClientRect();

        return {
          horizontalOverflow:
            document.documentElement.scrollWidth > innerWidth + 1 ||
            document.body.scrollWidth > innerWidth + 1,
          scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
          innerWidth,
          renderer: globalThis.game.renderer.type === 2 ? 'webgl' : 'canvas',
          activeScenes: globalThis.game.scene.getScenes(true).map((scene) => scene.sys.settings.key),
          desktopUnlockShortcut: rectOf('#scene-frontier-button'),
          frontierButton: rectOf('#unlock-layer-button'),
          canvas: {
            width: canvas.width,
            height: canvas.height,
          },
          missing,
          outsideViewport,
          topbarOverlaps,
          lineCards: lineCards.length,
          clippedLineCards,
          layerStepperIcons,
          frontierSignalIcon,
          sceneCargoUsesMoney,
          sceneTextIssues,
          mobileLayout: {
            productionColumns,
            actionButtonHeight: actionButton?.getBoundingClientRect().height ?? 0,
            automationButtonHeight:
              automationButton?.getBoundingClientRect().height ?? 0,
            lineTitleFontSize: lineTitle
              ? Number.parseFloat(getComputedStyle(lineTitle).fontSize)
              : 0,
            brandTitleOverflow: brandTitle
              ? brandTitle.scrollWidth > brandTitle.clientWidth + 1
              : false,
            productionBeforeLayerRail:
              productionRect && railRect ? productionRect.top < railRect.top : false,
          },
        };
      });

      const mineScreenshotPath = path.join(outputDir, `${viewport.name}.png`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: mineScreenshotPath });

      await page.waitForTimeout(150);

      const operationsLayout = await page.evaluate(() => {
        const visible = (element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && rect.width > 0 && rect.height > 0;
        };
        const lineCards = [...document.querySelectorAll('.line-action')].filter(visible);
        const productionGrid = document.querySelector('.production-grid');
        const actionButton = document.querySelector(
          '[data-action="queue"][data-line="drill"]',
        );
        const automationButton = document.querySelector(
          '#layer-toolbar-supervisor',
        );
        const lineTitle = document.querySelector('.line-title h3');
        return {
          horizontalOverflow:
            document.documentElement.scrollWidth > innerWidth + 1 ||
            document.body.scrollWidth > innerWidth + 1,
          lineCards: lineCards.length,
          clippedLineCards: lineCards
            .filter(
              (card) =>
                card.scrollWidth > card.clientWidth + 2 ||
                card.scrollHeight > card.clientHeight + 2,
            )
            .map((card) => card.dataset.line ?? 'unknown'),
          cardMetrics: lineCards.map((card) => ({
            line: card.dataset.line,
            clientHeight: card.clientHeight,
            scrollHeight: card.scrollHeight,
            rectHeight: card.getBoundingClientRect().height,
          })),
          productionColumns: productionGrid
            ? getComputedStyle(productionGrid).gridTemplateColumns
                .split(' ')
                .filter(Boolean).length
            : 0,
          actionButtonHeight: actionButton?.getBoundingClientRect().height ?? 0,
          automationButtonHeight:
            automationButton?.getBoundingClientRect().height ?? 0,
          lineTitleFontSize: lineTitle
            ? Number.parseFloat(getComputedStyle(lineTitle).fontSize)
            : 0,
          layerRailHidden:
            getComputedStyle(document.querySelector('.layer-rail-shell')).display ===
            'none',
          productionBeforeLayerRail:
            productionGrid.getBoundingClientRect().top <
            document.querySelector('.layer-rail-shell').getBoundingClientRect().top,
          sceneVisible: visible(document.querySelector('.scene-frame')),
        };
      });

      const canvasScreenshot = await page.locator('#mine-stage canvas').screenshot();
      const canvasPixels = await page.evaluate(async (pngBase64) => {
        const image = new Image();
        image.src = `data:image/png;base64,${pngBase64}`;
        await image.decode();
        const capture = document.createElement('canvas');
        capture.width = 160;
        capture.height = 90;
        const captureContext = capture.getContext('2d', { willReadFrequently: true });
        captureContext.drawImage(image, 0, 0, capture.width, capture.height);
        const pixels = captureContext.getImageData(0, 0, capture.width, capture.height).data;
        const colors = new Set();
        let alphaPixels = 0;
        for (let index = 0; index < pixels.length; index += 4 * 13) {
          const red = pixels[index];
          const green = pixels[index + 1];
          const blue = pixels[index + 2];
          const alpha = pixels[index + 3];
          if (alpha > 0) alphaPixels += 1;
          colors.add(`${red >> 4},${green >> 4},${blue >> 4},${alpha >> 6}`);
        }
        return {
          sampledColors: colors.size,
          alphaPixels,
          nonBlank: colors.size >= 8 && alphaPixels > 100,
        };
      }, canvasScreenshot.toString('base64'));
      layout.canvas = { ...layout.canvas, ...canvasPixels };

      for (const line of ['lift', 'truck', 'drill']) {
        const button = page.locator(
          `[data-action="queue-five"][data-line="${line}"]`,
        );
        await button.click();
        await page.waitForFunction(
          (targetLine) =>
            globalThis.mineCompany?.getState?.().lines?.[targetLine]?.queued === 5,
          line,
          { timeout: 5_000 },
        );
      }
      const queueState = await page.evaluate(() => {
        const state = globalThis.mineCompany.getState();
        return {
          drill: state.lines.drill.queued,
          lift: state.lines.lift.queued,
          truck: state.lines.truck.queued,
        };
      });
      const lockedLayerButton = page
        .locator('.scene-layer-hitareas button.is-locked')
        .first();
      if ((await lockedLayerButton.count()) > 0) {
        await lockedLayerButton.click({ force: true });
        await page.locator('.toast').first().waitFor({ state: 'visible' });
      }
      const toastMetrics = await page.locator('.toast').first().evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
        };
      });
      const sceneDebug = await page.evaluate(() =>
        globalThis.game?.scene?.getScene('mine')?.getDebugSnapshot?.() ?? null,
      );
      const audioState = await page.evaluate(() =>
        globalThis.mineCompany.getAudioState(),
      );

      await page.locator('[data-action="open-help"]').first().click();
      await page.locator('.modal-card').waitFor({ state: 'visible' });
      const modal = await page.locator('.modal-card').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          insideViewport:
            rect.left >= -1 &&
            rect.right <= innerWidth + 1 &&
            rect.top >= -1 &&
            rect.bottom <= innerHeight + 1,
          horizontalOverflow: element.scrollWidth > element.clientWidth + 2,
        };
      });
      await page.locator('[data-modal-close]').first().click();

      await page.locator('[data-action="open-settings"]').first().click();
      await page.locator('.modal-card').waitFor({ state: 'visible' });
      await page.evaluate(() => {
        const input = document.querySelector(
          '[data-volume="musicVolume"]',
        );
        if (!(input instanceof HTMLInputElement)) return;
        input.value = '30';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForTimeout(80);
      const volumeState = await page.evaluate(() => ({
        setting: globalThis.mineCompany.getState().settings.musicVolume,
        audio: globalThis.mineCompany.getAudioState(),
      }));
      await page.locator('[data-modal-close]').first().click();

      const screenshotPath = mineScreenshotPath;
      let bottomClearance = null;
      if (viewport.width <= 940) {
        await page.evaluate(() => {
          window.scrollTo(0, document.documentElement.scrollHeight);
        });
        await page.waitForTimeout(120);
        bottomClearance = await page.evaluate(() => {
          const nav = document.querySelector('.mobile-nav')?.getBoundingClientRect();
          const visiblePanels = [
            ...document.querySelectorAll('[data-workspace]:not([hidden])'),
          ].filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          const lastActionBottom = Math.max(
            0,
            ...visiblePanels.map((element) => element.getBoundingClientRect().bottom),
          );
          return {
            navTop: nav?.top ?? 0,
            lastActionBottom,
            clear: Boolean(nav && lastActionBottom <= nav.top + 2),
          };
        });
        await page.evaluate(() => window.scrollTo(0, 0));
      }

      await page
        .locator(
          '.workspace-tab[data-view="company"]:visible, .nav-button[data-view="company"]:visible',
        )
        .click();
      await page.waitForFunction(
        () => globalThis.mineCompany?.getView?.() === 'company',
        null,
        { timeout: 3_000 },
      );
      const companyLayout = await page.evaluate(() => {
        const visible = (selector) => {
          const element = document.querySelector(selector);
          if (!element) return false;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && rect.width > 0 && rect.height > 0;
        };
        return {
          dailyVisible: visible('#daily-list'),
          growthVisible: visible('#estimated-income'),
          mineHidden:
            getComputedStyle(document.querySelector('.scene-frame')).display ===
            'none',
          productionHidden:
            getComputedStyle(document.querySelector('.production-grid')).display ===
            'none',
        };
      });
      const companyScreenshotPath = path.join(
        outputDir,
        `company-${viewport.name}.png`,
      );
      await page.screenshot({ path: companyScreenshotPath });

      const failures = [];
      if (errors.length > 0) failures.push(...errors);
      if (layout.horizontalOverflow) failures.push('page has horizontal overflow');
      if (layout.missing.length > 0) failures.push(`missing: ${layout.missing.join(', ')}`);
      if (layout.outsideViewport.length > 0) {
        failures.push(`outside viewport: ${layout.outsideViewport.join(', ')}`);
      }
      if (layout.topbarOverlaps.length > 0) {
        failures.push(`topbar overlap: ${layout.topbarOverlaps.join(', ')}`);
      }
      if (viewport.width > 940 && !layout.desktopUnlockShortcut) {
        failures.push('desktop unlock shortcut is not visible');
      }
      if (viewport.width <= 640 && (layout.frontierButton?.height ?? 0) < 44) {
        failures.push('mobile frontier unlock button is below the 44px touch target');
      }
      if (operationsLayout.lineCards !== 3) {
        failures.push(`expected 3 line cards, got ${operationsLayout.lineCards}`);
      }
      if (operationsLayout.clippedLineCards.length > 0) {
        failures.push(
          `clipped line cards: ${operationsLayout.clippedLineCards.join(', ')}`,
        );
      }
      if (layout.layerStepperIcons !== 2 || !layout.frontierSignalIcon) {
        failures.push('layer navigation or frontier icons failed to render');
      }
      if (layout.sceneTextIssues.length > 0) {
        failures.push(`scene text layout: ${layout.sceneTextIssues.join(', ')}`);
      }
      if (!layout.sceneCargoUsesMoney) {
        failures.push('scene cargo values are not shown directly as money');
      }
      if (
        viewport.width <= 640 &&
        (operationsLayout.productionColumns !== 1 ||
          !operationsLayout.productionBeforeLayerRail)
      ) {
        failures.push('mobile operations view is not a focused single column');
      }
      if (
        viewport.width <= 640 &&
        (operationsLayout.actionButtonHeight < 44 ||
          operationsLayout.automationButtonHeight < 44)
      ) {
        failures.push('mobile production buttons are below the 44px touch target');
      }
      if (viewport.width <= 640 && operationsLayout.lineTitleFontSize < 14) {
        failures.push('mobile production title text is too small');
      }
      if (viewport.width <= 640 && layout.mobileLayout.brandTitleOverflow) {
        failures.push('mobile brand title is truncated');
      }
      if (bottomClearance && !bottomClearance.clear) {
        failures.push('mobile navigation covers the final action area');
      }
      if (
        !companyLayout.dailyVisible ||
        !companyLayout.growthVisible ||
        !companyLayout.mineHidden ||
        !companyLayout.productionHidden
      ) {
        failures.push('company view does not isolate management content');
      }
      if (
        !sceneDebug ||
        sceneDebug.visibleLayers.length !== (viewport.width < 940 ? 5 : 8) ||
        sceneDebug.activeMiners < 1
      ) {
        failures.push('mine scene did not render the responsive layer bands with an active miner');
      }
      if (queueState.lift !== 5 || queueState.truck !== 5 || queueState.drill !== 5) {
        failures.push('five-trip queue reservation failed');
      }
      if (!audioState.musicEnabled || !audioState.musicScheduled) {
        failures.push('background music did not start after the first user action');
      }
      if (
        Math.abs(volumeState.setting - 0.3) > 0.001 ||
        Math.abs(volumeState.audio.musicVolume - 0.3) > 0.001
      ) {
        failures.push('music volume slider did not update the audio engine');
      }
      if (!layout.canvas.nonBlank) failures.push('Phaser canvas appears blank');
      if (
        toastMetrics.height < 46 ||
        toastMetrics.fontSize < (viewport.width <= 640 ? 12 : 13)
      ) {
        failures.push('toast prompt is still too small to notice');
      }
      if (!modal.insideViewport) failures.push('help modal is outside viewport');
      if (modal.horizontalOverflow) failures.push('help modal has horizontal overflow');

      results.push({
        viewport: viewport.name,
        ok: failures.length === 0,
        renderer: layout.renderer,
        activeScenes: layout.activeScenes,
        canvas: layout.canvas,
        mobileLayout: layout.mobileLayout,
        operationsLayout,
        queueState,
        toastMetrics,
        sceneDebug,
        audioState,
        volumeState,
        bottomClearance,
        companyLayout,
        scrollWidth: layout.scrollWidth,
        screenshot: screenshotPath,
        companyScreenshot: companyScreenshotPath,
        failures,
      });
    } finally {
      await context.close();
    }
  }

  const replayContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
  });
  const replayPage = await replayContext.newPage();
  const replayErrors = [];
  replayPage.on('pageerror', (error) => {
    replayErrors.push(`pageerror: ${error.message}`);
  });
  replayPage.on('console', (message) => {
    if (message.type() === 'error') replayErrors.push(`console: ${message.text()}`);
  });

  try {
    await replayPage.goto(url, { waitUntil: 'networkidle' });
    await replayPage.waitForFunction(() => globalThis.game?.isRunning === true, null, {
      timeout: 15_000,
    });
    await replayPage.evaluate(() => {
      const state = globalThis.mineCompany.getState();
      for (const line of ['drill', 'lift', 'truck']) {
        state.lines[line].automated = true;
        state.lines[line].active = true;
      }
      state.layers[state.currentLayer].automated = true;
      state.lines.drill.automationLayer = state.currentLayer;
      state.money = 100_000;
      state.goldenShiftSeconds = 0;
      state.tutorialCompleted = true;
      state.tutorialStep = 7;
      state.tutorialRewardClaimed = true;
      globalThis.mineCompany.save();
      location.reload();
    });
    await replayPage.waitForFunction(() => globalThis.game?.isRunning === true, null, {
      timeout: 15_000,
    });
    await replayPage.locator('[data-action="open-help"]').first().click();
    await replayPage.locator('[data-action="restart-tutorial"]').click();
    await replayPage.waitForTimeout(350);

    const replayState = await replayPage.evaluate(() => {
      const state = globalThis.mineCompany.getState();
      return {
        step: state.tutorialStep,
        completed: state.tutorialCompleted,
        rewardClaimed: state.tutorialRewardClaimed,
        bannerHidden: document.querySelector('#tutorial-banner').classList.contains('hidden'),
        title: document.querySelector('#tutorial-title').textContent,
      };
    });
    const failures = [...replayErrors];
    if (replayState.step !== 3) failures.push(`expected replay to resume at step 3, got ${replayState.step}`);
    if (replayState.completed) failures.push('replay ended before the available upgrade step');
    if (replayState.bannerHidden) failures.push('replay banner is hidden');
    if (!replayState.title?.includes('升级')) failures.push('replay did not show the drill upgrade step');

    await replayPage.evaluate(() => globalThis.mineCompany.setView('operations'));
    await replayPage.locator('[data-action="upgrade"][data-line="drill"]').click();
    await replayPage.waitForFunction(
      () => globalThis.mineCompany?.getState?.().tutorialCompleted === true,
      null,
      { timeout: 5_000 },
    );
    const replayCompleted = await replayPage.evaluate(() => {
      const state = globalThis.mineCompany.getState();
      return {
        step: state.tutorialStep,
        completed: state.tutorialCompleted,
        rewardClaimed: state.tutorialRewardClaimed,
        goldenShiftSeconds: state.goldenShiftSeconds,
        bannerHidden: document.querySelector('#tutorial-banner').classList.contains('hidden'),
      };
    });
    if (!replayCompleted.bannerHidden) failures.push('replay banner did not close after upgrade');
    if (replayCompleted.step !== 7) {
      failures.push(`expected replay to finish at step 7, got ${replayCompleted.step}`);
    }
    if (!replayCompleted.rewardClaimed) failures.push('replay cleared the prior reward claimed flag');
    if (replayCompleted.goldenShiftSeconds !== 0) {
      failures.push('replay granted a duplicate tutorial boost');
    }

    results.push({
      viewport: 'flow-tutorial-replay-automated',
      ok: failures.length === 0,
      tutorial: replayState,
      completedTutorial: replayCompleted,
      failures,
    });
  } finally {
    await replayContext.close();
  }

  const multiContext = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
  });
  const multiPage = await multiContext.newPage();
  const multiErrors = [];
  multiPage.on('pageerror', (error) => {
    multiErrors.push(`pageerror: ${error.message}`);
  });
  multiPage.on('console', (message) => {
    if (message.type() === 'error') multiErrors.push(`console: ${message.text()}`);
  });

  try {
    await multiPage.goto(url, { waitUntil: 'networkidle' });
    await multiPage.waitForFunction(() => globalThis.game?.isRunning === true, null, {
      timeout: 15_000,
    });
    await multiPage.evaluate(() => {
      const state = globalThis.mineCompany.getState();
      const emptyCargo = () => ({ units: 0, totalValue: 0 });
      for (let layer = 1; layer <= 8; layer += 1) {
        const activeLayer = layer >= 3 && layer <= 7;
        state.layers[layer] = {
          progress: 0,
          active: false,
          automated: activeLayer,
          crewLevel: Math.min(5, Math.max(1, layer - 2)),
          queued: 0,
          payload: emptyCargo(),
          payloadLayer: 0,
          tripDuration: 0,
        };
        state.layerCargo[layer] = {
          underground: activeLayer
            ? { units: 3 + layer * 0.7, totalValue: 20 + layer }
            : emptyCargo(),
          surface: activeLayer
            ? { units: 2 + layer * 0.35, totalValue: 12 + layer }
            : emptyCargo(),
        };
      }
      state.deepestLayer = 8;
      state.currentLayer = 5;
      state.money = 100_000;
      state.lines.drill.level = 3;
      state.lines.lift.level = 5;
      state.lines.truck.level = 7;
      state.lines.lift.automated = true;
      state.lines.truck.automated = true;
      state.tutorialCompleted = true;
      state.tutorialStep = 7;
      state.tutorialRewardClaimed = true;
      globalThis.mineCompany.save();
      location.reload();
    });
    await multiPage.waitForFunction(() => globalThis.game?.scene?.isActive('mine') === true, null, {
      timeout: 15_000,
    });
    await multiPage.locator('#layer-jump-select').selectOption('1');
    await multiPage.waitForFunction(
      () => globalThis.mineCompany.getState().currentLayer === 1,
      null,
      { timeout: 3_000 },
    );
    const oldLayerStayedActive = await multiPage.evaluate(
      () => globalThis.mineCompany.getState().layers[5].active,
    );
    await multiPage.locator('#layer-jump-select').selectOption('8');
    await multiPage.waitForFunction(
      () => globalThis.mineCompany.getState().currentLayer === 8,
      null,
      { timeout: 3_000 },
    );
    await multiPage.locator('#layer-jump-select').selectOption('6');
    await multiPage.waitForFunction(
      () => globalThis.mineCompany.getState().currentLayer === 6,
      null,
      { timeout: 3_000 },
    );
    await multiPage.locator('#layer-toolbar-crew').click();
    await multiPage.waitForFunction(
      () => globalThis.mineCompany.getState().layers[6].crewLevel === 5,
      null,
      { timeout: 3_000 },
    );
    const middleLayerCrewUpgraded = await multiPage.evaluate(() => ({
      layer: globalThis.mineCompany.getState().currentLayer,
      crew: globalThis.mineCompany.getState().layers[6].crewLevel,
    }));
    await multiPage
      .locator('.layer-card [data-action="focus-layer"][data-layer="5"]')
      .click();
    await multiPage.waitForFunction(
      () => globalThis.mineCompany.getState().currentLayer === 5,
      null,
      { timeout: 3_000 },
    );
    await multiPage.evaluate(() => window.scrollTo(0, 0));
    await multiPage.locator('.scene-layer-hitareas button[data-layer="4"]').click();
    await multiPage.waitForFunction(
      () => globalThis.mineCompany.getState().currentLayer === 4,
      null,
      { timeout: 3_000 },
    );
    await multiPage.locator('.scene-layer-hitareas button[data-layer="5"]').click();
    await multiPage.waitForFunction(
      () => globalThis.mineCompany.getState().currentLayer === 5,
      null,
      { timeout: 3_000 },
    );
    const sceneBox = await multiPage.locator('.mine-stage').boundingBox();
    if (!sceneBox) throw new Error('mine stage is not available for wheel test');
    await multiPage.mouse.move(
      sceneBox.x + sceneBox.width * 0.62,
      sceneBox.y + sceneBox.height * 0.5,
    );
    await multiPage.mouse.wheel(0, 520);
    await multiPage.waitForFunction(
      () => globalThis.mineCompany.getState().currentLayer === 6,
      null,
      { timeout: 3_000 },
    );
    await multiPage.waitForTimeout(180);
    await multiPage.mouse.wheel(0, -520);
    await multiPage.waitForFunction(
      () => globalThis.mineCompany.getState().currentLayer === 5,
      null,
      { timeout: 3_000 },
    );
    const wheelLayerNavigation = await multiPage.evaluate(
      () => globalThis.mineCompany.getState().currentLayer,
    );
    await multiPage.evaluate(() => window.scrollTo(0, 140));
    await multiPage.waitForTimeout(120);
    const scrollbarBox = await multiPage
      .locator('.mine-layer-scrollbar-track')
      .boundingBox();
    if (!scrollbarBox) throw new Error('mine layer scrollbar is unavailable');
    await multiPage.mouse.move(
      scrollbarBox.x + scrollbarBox.width / 2,
      scrollbarBox.y + scrollbarBox.height * 0.86,
    );
    await multiPage.mouse.down();
    await multiPage.waitForFunction(
      () => globalThis.mineCompany.getState().currentLayer >= 7,
      null,
      { timeout: 3_000 },
    );
    await multiPage.mouse.up();
    await multiPage.evaluate(() => window.scrollTo(0, 0));
    const scrollbarLayerNavigation = await multiPage.evaluate(
      () => globalThis.mineCompany.getState().currentLayer,
    );
    await multiPage.locator('#layer-jump-select').selectOption('5');
    await multiPage.waitForFunction(
      () => globalThis.mineCompany.getState().currentLayer === 5,
      null,
      { timeout: 3_000 },
    );
    await multiPage.waitForFunction(
      () => {
        const scene = globalThis.game?.scene?.getScene('mine');
        const snapshot = scene?.getDebugSnapshot?.();
        return (
          snapshot?.lift?.active === true &&
          snapshot.lift.dwellLayer > 0 &&
          snapshot.lift.grabberVisible === true
        );
      },
      null,
      { timeout: 10_000 },
    );

    const multiDebug = await multiPage.evaluate(() =>
      globalThis.game.scene.getScene('mine').getDebugSnapshot(),
    );
    await multiPage.waitForTimeout(260);
    const multiDebugAfter = await multiPage.evaluate(() =>
      globalThis.game.scene.getScene('mine').getDebugSnapshot(),
    );
    const multiDesktopPath = path.join(outputDir, 'multi-layer-desktop.png');
    await multiPage.evaluate(() => window.scrollTo(0, 0));
    await multiPage.waitForTimeout(100);
    await multiPage.screenshot({ path: multiDesktopPath });
    await multiPage.waitForFunction(
      () => {
        const snapshot = globalThis.game
          .scene.getScene('mine')
          .getDebugSnapshot();
        return (
          snapshot.truck.phase === 'return' &&
          snapshot.truck.facing > 0.9
        );
      },
      null,
      { timeout: 5_000 },
    );
    const truckReturnDebug = await multiPage.evaluate(() =>
      globalThis.game.scene.getScene('mine').getDebugSnapshot(),
    );
    const truckReturnPath = path.join(outputDir, 'truck-return.png');
    await multiPage.locator('.scene-frame').screenshot({
      path: truckReturnPath,
    });
    const multiDwellPath = path.join(outputDir, 'multi-layer-dwell.png');
    await multiPage.locator('.scene-frame').screenshot({ path: multiDwellPath });
    const layerToolbarPath = path.join(outputDir, 'layer-toolbar.png');
    await multiPage.locator('.layer-rail-shell').screenshot({
      path: layerToolbarPath,
    });
    const multiFullPath = path.join(outputDir, 'multi-layer-full.png');
    await multiPage.screenshot({ path: multiFullPath, fullPage: true });
    await multiPage.evaluate(() => {
      const state = globalThis.mineCompany.getState();
      state.lines.drill.level = 2;
      state.lines.lift.level = 2;
      state.lines.truck.level = 2;
    });
    await multiPage.evaluate(() => window.scrollTo(0, 0));
    await multiPage.waitForTimeout(500);
    const tierTwoDebug = await multiPage.evaluate(() =>
      globalThis.game.scene.getScene('mine').getDebugSnapshot(),
    );
    const tierTwoPath = path.join(outputDir, 'equipment-tier-2.png');
    await multiPage.screenshot({ path: tierTwoPath });
    await multiPage.evaluate(() => {
      const state = globalThis.mineCompany.getState();
      state.lines.drill.level = 8;
      state.lines.lift.level = 8;
      state.lines.truck.level = 8;
    });
    await multiPage.evaluate(() => window.scrollTo(0, 0));
    await multiPage.waitForTimeout(1_500);
    const tierFiveDebug = await multiPage.evaluate(() =>
      globalThis.game.scene.getScene('mine').getDebugSnapshot(),
    );
    const tierFivePath = path.join(outputDir, 'equipment-tier-5.png');
    await multiPage.screenshot({ path: tierFivePath });
    await multiPage.evaluate(() => {
      const state = globalThis.mineCompany.getState();
      state.lines.drill.level = 10;
      state.lines.lift.level = 10;
      state.lines.truck.level = 10;
    });
    await multiPage.waitForTimeout(700);
    const tierSixDebug = await multiPage.evaluate(() =>
      globalThis.game.scene.getScene('mine').getDebugSnapshot(),
    );
    const tierSixPath = path.join(outputDir, 'equipment-tier-6.png');
    await multiPage.screenshot({ path: tierSixPath });

    await multiPage.setViewportSize({ width: 390, height: 844 });
    await multiPage.waitForTimeout(250);
    await multiPage.evaluate(() => window.scrollTo(0, 0));
    const multiMobilePath = path.join(outputDir, 'multi-layer-mobile.png');
    await multiPage.screenshot({ path: multiMobilePath });

    const failures = [...multiErrors];
    if (
      multiDebug.visibleLayers.join(',') !== '1,2,3,4,5,6,7,8' ||
      multiDebug.activeMiners < 3
    ) {
      failures.push('multi-layer scene did not show synchronized mining');
    }
    if (!multiDebug.lift.active || multiDebug.lift.sourceLayer !== 8) {
      failures.push('lift animation did not descend to the deepest unlocked layer');
    }
    if (!multiDebug.truck.active || multiDebug.truck.loadRatio <= 0) {
      failures.push('truck did not show an active weighted trip');
    }
    if (
      truckReturnDebug.truck.phase !== 'return' ||
      truckReturnDebug.truck.facing <= 0.9
    ) {
      failures.push('truck did not turn around before driving back');
    }
    if (multiDebug.lift.dwellLayer <= 0 || !multiDebug.lift.grabberVisible) {
      failures.push('lift did not show a visible per-layer grab action');
    }
    if (
      multiDebug.equipmentTiers.drill !== 2 ||
      multiDebug.equipmentTiers.lift !== 3 ||
      multiDebug.equipmentTiers.truck !== 4
    ) {
      failures.push('equipment visual tiers did not follow upgrade levels');
    }
    if (
      tierTwoDebug.equipmentTiers.drill !== 2 ||
      tierTwoDebug.equipmentTiers.lift !== 2 ||
      tierTwoDebug.equipmentTiers.truck !== 2
    ) {
      failures.push('first equipment upgrade did not change every visual tier');
    }
    if (
      tierFiveDebug.equipmentTiers.drill !== 5 ||
      tierFiveDebug.equipmentTiers.lift !== 5 ||
      tierFiveDebug.equipmentTiers.truck !== 5
    ) {
      failures.push('equipment did not reach the fifth visual stage');
    }
    if (
      tierSixDebug.equipmentTiers.drill !== 6 ||
      tierSixDebug.equipmentTiers.lift !== 6 ||
      tierSixDebug.equipmentTiers.truck !== 6
    ) {
      failures.push('equipment did not reach the sixth visual stage');
    }
    if (
      Math.abs(multiDebugAfter.lift.progress - multiDebug.lift.progress) < 0.005 &&
      Math.abs(multiDebugAfter.truck.progress - multiDebug.truck.progress) < 0.005
    ) {
      failures.push('transport animations did not advance over time');
    }
    if (!oldLayerStayedActive) {
      failures.push('switching the viewed layer stopped another mine layer');
    }
    if (
      middleLayerCrewUpgraded.layer !== 6 ||
      middleLayerCrewUpgraded.crew !== 5
    ) {
      failures.push('middle-layer toolbar crew upgrade did not apply');
    }
    if (wheelLayerNavigation !== 5) {
      failures.push('mouse wheel did not switch mine layers in both directions');
    }
    if (scrollbarLayerNavigation < 7) {
      failures.push('mine layer scrollbar drag did not switch to the expected layer');
    }

    results.push({
      viewport: 'flow-multi-layer-desktop-mobile',
      ok: failures.length === 0,
      debug: multiDebug,
      debugAfter: multiDebugAfter,
      middleLayerCrewUpgraded,
      wheelLayerNavigation,
      scrollbarLayerNavigation,
      tierTwoDebug,
      tierFiveDebug,
      tierSixDebug,
      truckReturnDebug,
      screenshots: [
        multiDesktopPath,
        truckReturnPath,
        multiDwellPath,
        tierTwoPath,
        tierFivePath,
        tierSixPath,
        layerToolbarPath,
        multiMobilePath,
        multiFullPath,
      ],
      failures,
    });
  } finally {
    await multiContext.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
if (results.some((result) => !result.ok)) process.exitCode = 1;
