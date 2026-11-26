import { access } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
const edgePath =
  process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

await access(edgePath);

const browser = await chromium.launch({
  executablePath: edgePath,
  headless: true,
});
let context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  locale: 'zh-CN',
});
let page = await context.newPage();
const errors = [];
const checkpoints = [];

function watchPage(target) {
  target.on('pageerror', (error) => {
    if (target === page) {
      errors.push({
        type: 'pageerror',
        message: error.message,
        stack: error.stack ?? null,
        url: target.url(),
        checkpoint: checkpoints.at(-1) ?? 'startup',
        at: new Date().toISOString(),
      });
    }
  });
  target.on('console', (message) => {
    if (target === page && message.type() === 'error') {
      errors.push({
        type: 'console',
        message: message.text(),
        stack: null,
        url: target.url(),
        checkpoint: checkpoints.at(-1) ?? 'startup',
        at: new Date().toISOString(),
      });
    }
  });
}

watchPage(page);

async function waitForState(predicate, label, arg = null, timeout = 10_000) {
  try {
    await page.waitForFunction(predicate, arg, { timeout });
  } catch (error) {
    const state = await page.evaluate(() => globalThis.mineCompany?.getState?.() ?? null);
    throw new Error(`${label}: ${error.message}\nstate=${JSON.stringify(state)}`);
  }
  checkpoints.push(label);
}

async function waitForButton(locator, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 6_000) {
    if (await locator.isEnabled()) {
      checkpoints.push(label);
      return;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`${label}: button stayed disabled`);
}

async function closeModalIfOpen() {
  const close = page.locator('#modal-root:not(.hidden) [data-modal-close]').first();
  if ((await close.count()) > 0) await close.click();
}

let result;
try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await waitForState(() => globalThis.game?.isRunning === true, 'game running');
  await waitForState(
    () => globalThis.mineCompany?.getState?.().stats.totalTrips === 0,
    'fresh save',
  );
  await page.evaluate(() => globalThis.mineCompany.setView('operations'));

  await page.locator('[data-action="queue"][data-line="drill"]').click();
  await waitForState(
    () => globalThis.mineCompany.getState().underground.units > 0,
    'manual drill completed',
  );
  await page.locator('[data-action="queue"][data-line="lift"]').click();
  await waitForState(
    () => globalThis.mineCompany.getState().surface.units > 0,
    'manual lift completed',
  );
  await page.locator('[data-action="queue"][data-line="truck"]').click();
  await waitForState(
    () => globalThis.mineCompany.getState().stats.totalTrips >= 1,
    'manual sale completed',
  );

  await page.evaluate(() => {
    const state = globalThis.mineCompany.getState();
    state.money = 10_000;
    globalThis.mineCompany.save();
  });
  await page.locator('[data-action="upgrade"][data-line="drill"]').click();
  await waitForState(
    () => globalThis.mineCompany.getState().lines.drill.level === 2,
    'drill upgrade purchased',
  );

  for (const line of ['drill', 'lift', 'truck']) {
    const automationButton =
      line === 'drill'
        ? page.locator('#layer-toolbar-supervisor')
        : page.locator(`[data-action="automation"][data-line="${line}"]`);
    await automationButton.click();
    await waitForState(
      (targetLine) =>
        globalThis.mineCompany.getState().lines[targetLine].automated === true,
      `${line} automation purchased`,
      line,
    );
  }
  await waitForState(
    () => {
      const state = globalThis.mineCompany.getState();
      return state.tutorialCompleted && state.goldenShiftSeconds > 0;
    },
    'tutorial completed with reward',
  );
  await page.waitForTimeout(600);
  await closeModalIfOpen();

  const tripsBeforeIdle = await page.evaluate(
    () => globalThis.mineCompany.getState().stats.totalTrips,
  );
  await waitForState(
    (before) => globalThis.mineCompany.getState().stats.totalTrips > before,
    'automated income continues',
    tripsBeforeIdle,
    15_000,
  );

  await page.evaluate(() => globalThis.mineCompany.setView('mine'));
  for (const expectedLayer of [2, 3]) {
    await page.locator('#unlock-layer-button').click();
    await waitForState(
      (layer) => globalThis.mineCompany.getState().deepestLayer === layer,
      `layer ${expectedLayer} unlocked`,
      expectedLayer,
    );
  }

  await page.evaluate(() => globalThis.mineCompany.setView('operations'));
  await page.locator('.scene-action-button[data-action="open-crew"]').click();
  await page.locator('#modal-root:not(.hidden)').waitFor({ state: 'visible' });
  await page
    .locator('#modal-root:not(.hidden) [data-action="hire-manager"][data-manager="a-zuan"]')
    .click();
  await waitForState(
    () => globalThis.mineCompany.getState().managers['a-zuan'] === true,
    'manager hired',
  );

  await page.locator('.scene-action-button[data-action="ad-boost"]').click();
  await waitForState(
    () => document.querySelector('#mock-ad-countdown') !== null,
    'online ad opened',
  );
  const onlineAdClaim = page.locator('#mock-ad-claim');
  await waitForButton(onlineAdClaim, 'online ad finished');
  await onlineAdClaim.click();
  await waitForState(
    () => globalThis.mineCompany.getState().adBoostSeconds > 14 * 60,
    'online ad reward applied',
  );

  const offlineSave = await page.evaluate(() => {
    const state = globalThis.mineCompany.getState();
    state.lastSeenAt = Date.now() - 60 * 60 * 1000;
    return JSON.stringify(state);
  });
  const moneyBeforeOffline = JSON.parse(offlineSave).money;
  const previousContext = context;
  context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    locale: 'zh-CN',
  });
  await context.addInitScript((save) => {
    localStorage.setItem('mine-company-save-v1', save);
    localStorage.removeItem('mine-company-save-backup-v1');
  }, offlineSave);
  page = await context.newPage();
  watchPage(page);
  await page.goto(url, { waitUntil: 'networkidle' });
  await previousContext.close();
  await waitForState(
    () => document.querySelector('#modal-root:not(.hidden) .modal-card') !== null,
    'offline report shown',
  );
  const moneyAfterBase = await page.evaluate(() => globalThis.mineCompany.getState().money);
  if (!(moneyAfterBase > moneyBeforeOffline)) {
    throw new Error('offline base earnings were not credited');
  }
  checkpoints.push('offline base earnings credited');

  await page.locator('[data-action="offline-ad"]').click();
  await waitForState(
    () => document.querySelector('#mock-ad-countdown') !== null,
    'offline ad opened',
  );
  const offlineAdClaim = page.locator('#mock-ad-claim');
  await waitForButton(offlineAdClaim, 'offline ad finished');
  await offlineAdClaim.click();
  await waitForState(
    () => globalThis.mineCompany.getState().stats.adsWatched === 2,
    'offline ad bonus applied',
  );
  const moneyAfterOfflineAd = await page.evaluate(
    () => globalThis.mineCompany.getState().money,
  );
  if (!(moneyAfterOfflineAd > moneyAfterBase)) {
    throw new Error('offline ad bonus did not increase money');
  }
  checkpoints.push('offline ad bonus credited');

  await page.evaluate(() => {
    const state = globalThis.mineCompany.getState();
    state.deepestLayer = 20;
    state.currentLayer = 20;
    globalThis.mineCompany.save();
  });
  await page.evaluate(() => globalThis.mineCompany.setView('company'));
  await page.locator('[data-action="open-growth"]').first().click();
  await page.locator('[data-action="open-prestige"]').click();
  await page.locator('[data-action="perform-prestige"]').click();
  await waitForState(
    () => {
      const state = globalThis.mineCompany.getState();
      return state.prestigeCount === 1 && state.deepestLayer === 1 && state.prestigeMarks >= 1;
    },
    'prestige completed',
  );

  await page.locator('[data-action="open-settings"]').first().click();
  await page.locator('[data-action="confirm-reset"]').click();
  await page.locator('[data-action="hard-reset-save"]').click();
  await waitForState(
    () => {
      const state = globalThis.mineCompany.getState();
      return state.money === 0 && state.deepestLayer === 1 && state.tutorialStep === 0;
    },
    'save reset completed',
  );

  result = {
    ok: errors.length === 0,
    checkpoints,
    errors,
  };
} catch (error) {
  result = {
    ok: false,
    checkpoints,
    errors: [...errors, error instanceof Error ? error.stack ?? error.message : String(error)],
  };
} finally {
  await context.close();
  await browser.close();
}

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
