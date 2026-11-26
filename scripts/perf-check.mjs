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

const viewports = [
  { name: 'mobile-390x844', width: 390, height: 844 },
  { name: 'desktop-1920x1080', width: 1920, height: 1080 },
];
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
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => globalThis.game?.isRunning === true, null, {
        timeout: 15_000,
      });
      await page.evaluate(() => {
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
              ? { units: 8 + layer, totalValue: 40 + layer }
              : emptyCargo(),
            surface: activeLayer
              ? { units: 6 + layer, totalValue: 30 + layer }
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
      await page.waitForFunction(() => globalThis.game?.scene?.isActive('mine') === true, null, {
        timeout: 15_000,
      });
      await page.waitForTimeout(900);

      const frame = await page.evaluate(async () => {
        const samples = [];
        await new Promise((resolve) => {
          let previous = performance.now();
          let count = 0;
          const tick = (now) => {
            if (count > 0) samples.push(now - previous);
            previous = now;
            count += 1;
            if (count >= 181) {
              resolve();
              return;
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        samples.sort((a, b) => a - b);
        const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
        return {
          frames: samples.length,
          average: Number(average.toFixed(2)),
          p95: Number(samples[Math.floor(samples.length * 0.95)].toFixed(2)),
          p99: Number(samples[Math.floor(samples.length * 0.99)].toFixed(2)),
          max: Number(samples.at(-1).toFixed(2)),
          over30ms: samples.filter((value) => value > 30).length,
        };
      });

      results.push({
        viewport: viewport.name,
        ok: errors.length === 0 && frame.p95 <= 30,
        targetP95Ms: 30,
        frame,
        errors,
      });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
if (results.some((result) => !result.ok)) process.exitCode = 1;
