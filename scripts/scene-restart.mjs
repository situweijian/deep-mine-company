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
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  locale: 'zh-CN',
});
const page = await context.newPage();
const errors = [];

page.on('pageerror', (error) => {
  errors.push({
    message: error.message,
    stack: error.stack ?? null,
  });
});

try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => globalThis.game?.isRunning === true, null, {
    timeout: 15_000,
  });
  await page.waitForFunction(() => globalThis.game?.scene?.isActive('mine') === true, null, {
    timeout: 15_000,
  });

  const before = await page.evaluate(() => ({
    active: globalThis.game.scene.isActive('mine'),
    children: globalThis.game.scene.getScene('mine').children?.length ?? 0,
  }));

  await page.evaluate(() => {
    globalThis.game.scene.getScene('mine').scene.restart();
  });
  await page.waitForTimeout(500);

  const after = await page.evaluate(() => ({
    active: globalThis.game.scene.isActive('mine'),
    children: globalThis.game.scene.getScene('mine').children?.length ?? 0,
    canvas: Boolean(document.querySelector('#mine-stage canvas')),
  }));

  const result = {
    ok: errors.length === 0 && after.active && after.canvas && after.children > 0,
    before,
    after,
    errors,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
