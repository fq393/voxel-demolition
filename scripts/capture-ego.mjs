import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { analyzePng } from './canvas-metrics.mjs';

// Use the existing Ego page and its documented API. Never launch a second browser.
export async function capture(page, { out, mode, runId }) {
  await mkdir(out, { recursive: true });
  const applied = await page.evaluate(async () => {
    const result = await window.__THREE_GAME_TEST_HOOKS__.setState('active-play');
    const diagnostics = window.__THREE_GAME_DIAGNOSTICS__;
    window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { state: result.state, diagnostics, rect: { x:r.x,y:r.y,width:r.width,height:r.height }, errors: window.qaErrors };
  });
  if (applied.state !== 'active-play') throw new Error('The game did not acknowledge active play');
  if (!applied.errors) throw new Error('Browser error collection was not enabled');
  const screenshotPath = path.join(out, `${mode}-active-play.png`);
  await page.screenshot({ path: screenshotPath, clip: applied.rect });
  const result = analyzePng(await readFile(screenshotPath));
  result.rect = applied.rect;
  result.diagnostics = applied.diagnostics;
  const report = {
    method: 'Ego browser native GPU screenshot, QA skill pixel metrics',
    url: await page.url(), mode, state:applied.state, requestedState:'active-play',
    appliedState:applied.state, runId, screenshotPath, result,
    consoleErrors:applied.errors?.console ?? [], pageErrors:applied.errors?.page ?? [],
  };
  await writeFile(path.join(out, `${mode}-active-play.json`), JSON.stringify(report,null,2));
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(false));
  if (!result.ok || report.consoleErrors.length || report.pageErrors.length) throw new Error(JSON.stringify(report));
  return { mode, metrics:result.metrics, diagnostics:applied.diagnostics };
}
