import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const { chromium, firefox, webkit } = await import(process.env.WN_PLAYWRIGHT_MODULE ?? 'playwright');

const site = fileURLToPath(new URL('../site', import.meta.url));
const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wav': 'audio/wav', '.webp': 'image/webp' };
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/benchmark') {
    return response.writeHead(200, { 'content-type': 'text/html' })
      .end('<!doctype html><html lang="ko"><main id="benchmark"></main></html>');
  }
  const file = resolve(site, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(site + '/')) return response.writeHead(404).end();
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': contentTypes[extname(file)] ?? 'text/plain' }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = 'http://127.0.0.1:' + server.address().port;
const mode = process.argv[2] ?? 'all';

async function compatibility(browser) {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 320, height: 760 } });
  const page = await context.newPage();
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto(base + '/editor.html');
  const toggle = page.getByRole('button', { name: '빈 승강장 장면 메뉴' });
  await toggle.tap();
  const menu = page.getByRole('menu');
  await menu.waitFor();
  const menuSnapshot = await menu.ariaSnapshot();
  assert.match(menuSnapshot, /menu "빈 승강장 장면 메뉴"/);
  assert.match(menuSnapshot, /menuitem "장면 복사"/);
  assert.match(menuSnapshot, /menuitem "해당 장면 삭제"/);
  const size = await menu.boundingBox();
  const camera = page.viewportSize();
  assert.ok(size.x >= 0 && size.x + size.width <= camera.width);
  assert.ok(size.y >= 0 && size.y + size.height <= camera.height + 1);
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });
  assert.equal(await toggle.evaluate((button) => button === document.activeElement), true);

  const object = page.locator('[data-pick="platform-opening"]');
  const properties = page.getByRole('heading', { name: '객체 속성' });
  assert.equal(await properties.isVisible(), false);
  await object.press('Enter');
  await properties.waitFor();
  assert.equal(await properties.evaluate((heading) => heading === document.activeElement), true);
  assert.equal(await object.getAttribute('aria-expanded'), 'true');
  assert.match(await page.locator('.wne-inspector').ariaSnapshot(), /heading "객체 속성"/);
  await properties.press('Escape');
  await properties.waitFor({ state: 'hidden' });
  assert.equal(await object.evaluate((button) => button === document.activeElement), true);

  await page.setViewportSize({ width: 760, height: 200 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await toggle.scrollIntoViewIfNeeded();
  await toggle.press('Enter');
  await menu.waitFor();
  await page.keyboard.press('End');
  const lastItem = menu.getByRole('menuitem', { name: '해당 장면 삭제' });
  const lastBounds = await lastItem.boundingBox();
  const menuBounds = await menu.boundingBox();
  assert.equal(await lastItem.evaluate((item) => item === document.activeElement), true);
  assert.ok(lastBounds.y + lastBounds.height <= menuBounds.y + menuBounds.height + 1);
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });

  for (const viewport of [{ width: 760, height: 320 }, { width: 1280, height: 850 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  }
  await object.press('Enter');
  await properties.waitFor();
  assert.equal(await properties.evaluate((heading) => heading === document.activeElement), true);
  const fontSize = page.getByRole('textbox', { name: '글자 크기', exact: true });
  await fontSize.fill('20px');
  await fontSize.press('Tab');
  const position = page.getByRole('textbox', { name: '가로 위치', exact: true });
  assert.equal(await position.evaluate((input) => input === document.activeElement), true);
  await page.keyboard.press('Escape');
  await properties.waitFor({ state: 'hidden' });
  assert.match(await page.locator('.wne-document').ariaSnapshot(), /checkbox "객체 1 선택"/);
  assert.match(await page.locator('.wne-document').ariaSnapshot(), /checkbox "객체 2 선택"/);
  assert.deepEqual(failures, []);
  await context.close();

  const restricted = await browser.newContext({ viewport: { width: 320, height: 600 }, reducedMotion: 'reduce' });
  await restricted.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() {
      throw new DOMException('Storage denied by host', 'SecurityError');
    } });
    window.IntersectionObserver = undefined;
  });
  const limited = await restricted.newPage();
  await limited.goto(base + '/editor.html');
  await limited.locator('[data-object="platform-opening"]').waitFor();
  await limited.getByRole('button', { name: '임시 저장', exact: true }).click();
  await limited.getByRole('status').filter({ hasText: '임시 저장을 사용할 수 없습니다' }).waitFor();
  await limited.getByRole('button', { name: 'JSON 텍스트 보기' }).click();
  assert.equal(JSON.parse(await limited.getByLabel('복사할 작품 JSON').inputValue()).schemaVersion, 1);
  await limited.route('**/*.wav', (route) => route.abort());
  await limited.goto(base);
  await limited.locator('.wnv-media audio').waitFor();
  await limited.locator('.wnv-media audio').evaluate((audio) => {
    audio.volume = 0;
    audio.play().catch(() => {});
  });
  await limited.getByRole('status').filter({ hasText: '미디어를 재생할 수 없습니다' }).waitFor();
  await limited.getByRole('button', { name: '원문 보기' }).click();
  await limited.locator('.wnv-original:not([hidden])').waitFor();
  await restricted.close();
}

async function performanceCheck(browser) {
  const benchmark = await browser.newPage({ viewport: { width: 760, height: 760 } });
  const cdp = await benchmark.context().newCDPSession(benchmark);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const requests = new Set();
  benchmark.on('response', (response) => {
    if (response.url().startsWith(base)) requests.add(new URL(response.url()).pathname);
  });
  await benchmark.goto(base + '/benchmark');
  await benchmark.evaluate(async () => {
    const { mountViewer } = await import('/viewer/viewer.js');
    const groups = Array.from({ length: 100 }, (_, index) => ({
      id: 'group-' + index, scrollVh: 72,
      objects: Array.from({ length: 8 }, (_, object) => ({
        id: 'object-' + index + '-' + object,
        type: 'text',
        content: ['읽기 성능 검증 문단. ', {tag: 'strong', children: [' 장면 ' + index]}],
        enter: 'fade', showFrom: object / 12,
      })),
    }));
    const instance = mountViewer(document.querySelector('#benchmark'), { schemaVersion: 1, groups });
    await instance.ready;
  });
  await benchmark.locator('.wnv-scene[data-group-id="group-0"]').waitFor();
  const measurement = await benchmark.evaluate(async () => {
    if (!PerformanceObserver.supportedEntryTypes.includes('longtask')) throw Error('Long task API unavailable');
    const reader = document.querySelector('.wnv-host').shadowRoot.querySelector('.wnv-viewport');
    const heights = reader.scrollHeight - reader.clientHeight;
    const readings = [];
    const observer = new PerformanceObserver((list) => readings.push(...list.getEntries().map(({ duration }) => duration)));
    observer.observe({ entryTypes: ['longtask'] });
    for (let index = 1; index <= 160; index++) {
      await new Promise(requestAnimationFrame);
      reader.scrollTop = heights * index / 160;
    }
    await new Promise(requestAnimationFrame);
    readings.push(...observer.takeRecords().map(({ duration }) => duration));
    observer.disconnect();
    return { count: readings.filter((time) => time > 50).length, longest: Math.max(0, ...readings), end: reader.scrollTop };
  });
  const assets = [...requests].filter((path) => /\.(js|css)$/.test(path));
  let gzipBytes = 0;
  for (const path of assets) gzipBytes += gzipSync(await readFile(site + path)).length;
  assert.ok(gzipBytes <= 35 * 1024);
  assert.ok(!assets.some((path) => /editor|youtube|effect-pack/.test(path)));
  assert.ok(measurement.end > 0);
  console.log('R2', JSON.stringify({ cpu: 4, samples: 100, objectsPerGroup: 8, frames: 160, gzipBytes,
    over50ms: measurement.count, longestMs: measurement.longest, assets }));
  await benchmark.close();
}

try {
  for (const engine of [chromium, firefox, webkit]) {
    if (mode !== 'all' && mode !== engine.name()) continue;
    let browser;
    try {
      browser = await engine.launch();
    } catch (error) {
      if (engine === webkit) {
        console.log('WebKit unavailable:', String(error.message).split('\n').slice(0, 16).join('\n'));
        continue;
      }
      throw error;
    }
    try {
      await compatibility(browser);
      console.log('R1', engine.name(), browser.version(), 'touch, responsive, zoom, storage denial and media fallback passed');
      if (engine === chromium) await performanceCheck(browser);
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}
