import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium, firefox } = await import(process.env.WN_PLAYWRIGHT_MODULE ?? 'playwright');
const repo = fileURLToPath(new URL('../', import.meta.url));
const original = JSON.parse(await readFile(new URL('../site/stories/first-train.json', import.meta.url), 'utf8'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webp': 'image/webp', '.wav': 'audio/wav' };

async function serve(handler) {
  const server = createServer((req, res) => handler(req, res).catch((error) => {
    res.writeHead(500).end(error.message);
  }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { server, origin: 'http://127.0.0.1:' + server.address().port };
}

function host() {
  let work = original;
  let rejectLoad = false;
  let rejectSave = false;
  let posts = 0;
  let gets = 0;
  return {
    counts: () => ({ posts, gets }),
    failLoad: (value) => { rejectLoad = value; },
    failSave: (value) => { rejectSave = value; },
    current: () => work,
    async route(req, res) {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/work') {
        const headers = {
          'access-control-allow-origin': req.headers.origin ?? '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type', vary: 'Origin',
          'content-type': 'application/json',
        };
        if (req.method === 'OPTIONS') return res.writeHead(204, headers).end();
        if (req.method === 'GET') {
          gets++;
          return res.writeHead(200, headers).end(rejectLoad ? '{' : JSON.stringify(work));
        }
        let payload = '';
        for await (const chunk of req) payload += chunk;
        posts++;
        if (rejectSave) return res.writeHead(409, headers).end('{}');
        work = JSON.parse(payload);
        return res.writeHead(204, headers).end();
      }
      const path = url.pathname === '/' ? '/site/index.html' : url.pathname;
      const file = resolve(repo, '.' + path);
      if (!file.startsWith(repo + 'site/') && !file.startsWith(repo + 'tests/')) return res.writeHead(404).end();
      try {
        return res.writeHead(200, { 'content-type': types[extname(file)] ?? 'text/plain' }).end(await readFile(file));
      } catch {
        return res.writeHead(404).end();
      }
    },
  };
}

async function selectText(page, selector, from, to) {
  await page.locator(selector).evaluate((element, [start, end]) => {
    element.focus();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let position = 0;
    let didStart = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const next = position + node.length;
      if (!didStart && start <= next) {
        range.setStart(node, start - position);
        didStart = true;
      }
      if (end <= next) {
        range.setEnd(node, end - position);
        break;
      }
      position = next;
    }
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, [from, to]);
}

for (const browserType of [chromium, firefox]) {
  if (process.argv[2] && process.argv[2] !== browserType.name()) continue;
  const api = host();
  const pageHost = host();
  const frontend = await serve(pageHost.route);
  const backend = await serve(api.route);
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1260, height: 850 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(frontend.origin + '/tests/viewer.browser.html');
    await page.locator('#result[data-status]').waitFor();
    assert.equal(await page.locator('#result').textContent(), 'Passed');
    await page.goto(frontend.origin + '/site/index.html');
    await page.locator('.wnv-scene').waitFor();
    await page.getByRole('link', { name: '작품 편집기 열기' }).click();
    await page.locator('[data-object="platform-opening"]').waitFor();

    // UI messages belong to the instance, including state changes and editor previews.
    await page.evaluate(async () => {
      const { mountEditor } = await import('/site/editor/editor.js');
      const { mountViewer } = await import('/site/viewer/viewer.js');
      const options = { locale: 'fr-CA', messages: {
        viewer: { play: 'Lire', pause: 'En pause' }, editor: { undo: 'Annuler' },
      } };
      const work = { schemaVersion: 1, lang: 'ko', title: '원고',
        groups: [{ id: 'one', title: '실행 취소', objects: [] }] };
      const holder = document.createElement('div');
      document.body.append(holder);
      const editorHost = holder.appendChild(document.createElement('div'));
      const viewerHost = holder.appendChild(document.createElement('div'));
      const editor = mountEditor(editorHost, { ...options, source: work });
      const viewer = mountViewer(viewerHost, work, options);
      await Promise.all([editor.ready, viewer.ready]);
      window.removeLanguageTest = () => { editor.destroy(); viewer.destroy(); holder.remove(); };
    });
    const translated = page.getByRole('button', { name: 'Annuler', exact: true });
    assert.equal(await translated.getAttribute('title'), 'Annuler');
    assert.equal(await translated.locator('svg[aria-hidden="true"]').count(), 1);
    assert.equal(await page.locator('[data-scene="one"]').textContent(), '실행 취소');
    await page.getByRole('button', { name: 'Lire', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'En pause' }).getAttribute('title'), 'En pause');
    await page.getByRole('button', { name: 'En pause' }).click();
    await page.getByRole('button', { name: 'Open preview' }).click();
    await page.getByRole('button', { name: 'Close preview' }).waitFor();
    await page.locator('.wne-preview-host').getByRole('button', { name: 'Lire' }).waitFor();
    await page.evaluate(() => window.removeLanguageTest());

    // Mount the modules into an ordinary host page and use its cross-origin API.
    await page.evaluate(async (apiOrigin) => {
      const { mountEditor } = await import('/site/editor/editor.js');
      const { mountViewer } = await import('/site/viewer/viewer.js');
      const editors = document.createElement('div');
      const viewer = document.createElement('div');
      viewer.id = 'host-viewer';
      document.body.replaceChildren(editors, viewer);
      window.editor = mountEditor(editors, {
        getUrl: apiOrigin + '/work', postUrl: apiOrigin + '/work',
        assetBaseUrl: location.origin + '/site/stories/', draftKey: 'test-work', draftIntervalMs: 50,
      });
      if (!(await editor.ready)) throw new Error('Initial GET failed');
      window.mountHostViewer = (url) => mountViewer(viewer, { getUrl: url }, {
        assetBaseUrl: location.origin + '/site/stories/',
      }).ready;
    }, backend.origin);

    const button = (name) => page.getByRole('button', { name, exact: true });
    const title = page.getByLabel('작품 제목', { exact: true });
    const paragraph = '[data-object="platform-opening"]';
    const properties = page.getByRole('heading', { name: '객체 속성' });
    const context = page.getByRole('menu', { name: '열린 문 장면 메뉴', exact: true });
    const menuButton = button('열린 문 장면 메뉴');
    const initial = await page.evaluate(() => editor.exportWork());
    assert.equal(await properties.isVisible(), false);
    await page.locator('[data-pick="platform-opening"]').click();
    await properties.waitFor();
    await button('속성 닫기').click();
    assert.equal(await properties.isVisible(), false);

    await button('열린 문').click({ button: 'right' });
    await context.getByRole('menuitem', { name: '장면 복사' }).click();
    await button('장면 붙여넣기').click();
    const scenesWithCopy = await page.evaluate(() => editor.exportWork().groups);
    assert.equal(scenesWithCopy[1].title, '열린 문 (복사본)');
    assert.notEqual(scenesWithCopy[1].id, initial.groups[1].id);
    assert.deepEqual(scenesWithCopy[1].objects.map(({ id, ...item }) => item),
      initial.groups[1].objects.map(({ id, ...item }) => item));
    assert.ok(scenesWithCopy[1].objects.every(({ id }) => !initial.groups[1].objects.some((item) => item.id === id)));
    await button('실행 취소').click();
    assert.deepEqual(await page.evaluate(() => editor.exportWork()), initial);

    const objectChecks = page.getByRole('checkbox', { name: /^객체 \d+ 선택$/ });
    await objectChecks.nth(0).check();
    await objectChecks.nth(1).check();
    assert.equal(await properties.isVisible(), false);
    await button('객체 복사').click();
    await button('열린 문').click();
    await button('객체 붙여넣기').click();
    assert.equal(await properties.isVisible(), false);
    const copied = await page.evaluate(() => editor.exportWork().groups.find(({ id }) => id === 'door').objects.slice(-2));
    assert.deepEqual(copied.map(({ id, ...item }) => item), initial.groups[0].objects.slice(0, 2).map(({ id, ...item }) => item));
    assert.ok(copied.every(({ id }) => !initial.groups[0].objects.some((item) => item.id === id)));
    await page.locator('[data-object="' + copied[1].id + '"]').fill('복사본만 수정');
    assert.deepEqual(await page.evaluate(() => editor.exportWork().groups[0]), initial.groups[0]);
    await button('실행 취소').click();
    await button('실행 취소').click();
    assert.deepEqual(await page.evaluate(() => editor.exportWork()), initial);
    await button('빈 승강장').click();
    await selectText(page, paragraph, 4, 7);
    await button('연출 객체 만들기').click();
    const featuredWork = await page.evaluate(() => editor.exportWork());
    const featured = featuredWork.groups[0].objects.find((item) => item.featured);
    assert.ok(featured.blockId);
    await button('빈 승강장').press('Control+c');
    await button('빈 승강장').press('Control+v');
    const duplicate = await page.evaluate(() => editor.exportWork().groups[1]);
    const duplicateFeatured = duplicate.objects.find((item) => item.featured);
    assert.notEqual(duplicateFeatured.blockId, featured.blockId);
    assert.equal(duplicate.objects.filter((item) => item.blockId === duplicateFeatured.blockId).length, 3);
    await page.locator('[data-pick="' + duplicateFeatured.id + '"]').click();
    await button('연출 해제').click();
    const merged = await page.evaluate(() => editor.exportWork());
    assert.equal(merged.groups[1].objects.filter((item) => item.blockId === duplicateFeatured.blockId).length, 1);
    assert.deepEqual(merged.groups[0], featuredWork.groups[0]);
    await button('실행 취소').click();
    await button('실행 취소').click();
    await button('실행 취소').click();
    assert.deepEqual(await page.evaluate(() => editor.exportWork()), initial);
    await button('빈 승강장').click();
    await button('열린 문').press('Control+c');
    await button('빈 승강장').press('Control+v');
    assert.equal(await page.evaluate(() => editor.exportWork().groups[1].title), '열린 문 (복사본)');
    await button('실행 취소').click();
    await button('열린 문').click({ button: 'right' });
    await context.waitFor();
    await page.keyboard.press('Escape');
    await context.waitFor({ state: 'hidden' });
    assert.equal(await menuButton.evaluate((node) => node === document.activeElement), true);
    await button('열린 문').press('Shift+F10');
    await context.waitFor();
    await page.keyboard.press('Escape');
    await context.waitFor({ state: 'hidden' });
    await menuButton.press('Enter');
    await context.waitFor();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    assert.deepEqual(await page.evaluate(() => editor.exportWork().groups.map(({ id }) => id)), ['platform']);
    await button('실행 취소').click();
    assert.deepEqual(await page.evaluate(() => editor.exportWork()), initial);
    await button('해당 장면 삭제').click();
    assert.equal(await button('열린 문').getAttribute('aria-current'), 'true');
    await button('실행 취소').click();
    assert.deepEqual(await page.evaluate(() => editor.exportWork()), initial);
    await button('미리보기 열기').click();
    await page.locator('.wne-preview audio[src]').waitFor();
    assert.match(await page.locator('.wne-preview audio').getAttribute('src'), /platform-chime\.wav$/);
    await button('미리보기 닫기').click();
    await title.fill('편집된 작품');
    await title.press('Tab');
    await selectText(page, paragraph, 0, 3);
    await button('굵게').click();
    assert.equal(await page.locator(paragraph + ' strong').first().textContent(), '새벽의');
    await button('연출 객체 만들기').click();
    assert.equal(await page.locator(paragraph).textContent(), '새벽의');
    assert.equal(await page.evaluate(() => editor.exportWork().groups[0].objects.find((item) => item.id === 'platform-opening').featured), true);
    await button('연출 해제').click();
    assert.match(await page.locator(paragraph).textContent(), /^새벽의 승강장은/);
    await button('실행 취소').click();
    assert.equal(await page.locator(paragraph).textContent(), '새벽의');
    await button('다시 실행').click();
    assert.match(await page.locator(paragraph).textContent(), /^새벽의 승강장은/);
    await page.locator('[data-pick="platform-opening"]').click();
    await page.getByLabel('본문 유형').selectOption('ordered');
    assert.equal(await page.locator('ol' + paragraph + ' li').count(), 1);
    await page.getByLabel('본문 유형').selectOption('heading');
    assert.equal(await page.locator('h3' + paragraph).count(), 1);
    await selectText(page, paragraph, 4, 7);
    await button('링크 삽입').click();
    await page.getByLabel('링크 주소').fill('/site/index.html');
    await button('링크 적용').click();
    assert.equal(await page.locator(paragraph + ' a').count(), 1);

    await button('장면 추가').click();
    await button('문단 추가').click();
    const editable = page.locator('.wne-document [contenteditable]');
    await editable.fill('새 장면 본문');
    await editable.evaluate((element) => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      element.textContent += ' 한글';
      element.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    });
    assert.doesNotMatch(await page.evaluate(() => JSON.stringify(editor.exportWork())), /새 장면 본문 한글/);
    await editable.evaluate((element) => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
    assert.match(await page.evaluate(() => JSON.stringify(editor.exportWork())), /새 장면 본문 한글/);
    await editable.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      const paste = new DataTransfer();
      paste.setData('text/html', '<strong>붙여넣기</strong><script>window.badPaste = true</script>');
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: paste });
      element.dispatchEvent(event);
    });
    assert.equal(await editable.locator('strong').textContent(), '붙여넣기');
    assert.equal(await page.evaluate(() => window.badPaste), undefined);
    await page.getByLabel('이동할 장면').selectOption('door');
    await button('선택한 객체 이동').click();
    assert.match(await page.evaluate(() => JSON.stringify(editor.exportWork().groups.find(({ id }) => id === 'door'))), /새 장면 본문/);

    await button('미리보기 열기').click();
    await page.locator('.wne-preview .wnv-scene').waitFor();
    await page.getByLabel('너비 (px)', { exact: true }).fill('320');
    await page.getByLabel('너비 (px)', { exact: true }).press('Tab');
    assert.ok(await page.locator('.wne-preview-host').evaluate((element) => element.clientWidth <= 320));
    await button('미리보기 닫기').click();
    await page.setViewportSize({ width: 320, height: 800 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.setViewportSize({ width: 1260, height: 850 });

    const snapshot = await page.evaluate(() => editor.exportWork());
    api.failLoad(true);
    await button('호스트에서 불러오기').click();
    await page.getByRole('status').filter({ hasText: '불러오기 실패' }).waitFor();
    assert.deepEqual(await page.evaluate(() => editor.exportWork()), snapshot);
    api.failLoad(false);
    api.failSave(true);
    await button('서버에 저장').click();
    await page.getByRole('status').filter({ hasText: '저장 실패' }).waitFor();
    assert.deepEqual(await page.evaluate(() => editor.exportWork()), snapshot);
    api.failSave(false);
    const beforeDraft = api.counts();
    await button('임시 저장').click();
    await page.getByLabel('주기적 임시 저장').check();
    await page.waitForTimeout(130);
    assert.deepEqual(api.counts(), beforeDraft);
    await page.getByLabel('주기적 임시 저장').uncheck();

    await button('서버에 저장').click();
    await page.getByRole('status').filter({ hasText: '서버에 저장했습니다' }).waitFor();
    assert.equal(api.current().title, '편집된 작품');
    await page.evaluate((url) => mountHostViewer(url), backend.origin + '/work');
    await page.locator('#host-viewer .wnv-scene').waitFor();
    assert.equal(await page.locator('#host-viewer .wnv').getAttribute('aria-label'), '편집된 작품');

    const downloading = page.waitForEvent('download');
    await button('JSON 사본 내보내기').click();
    const download = await downloading;
    const buffer = await readFile(await download.path());
    const exported = JSON.parse(buffer.toString());
    assert.equal(exported.title, '편집된 작품');
    await page.locator('input[type=file]').setInputFiles({
      name: 'roundtrip.json', mimeType: 'application/json', buffer,
    });
    await page.getByRole('status').filter({ hasText: '파일을 열었습니다' }).waitFor();
    assert.deepEqual(JSON.parse(JSON.stringify(await page.evaluate(() => editor.exportWork())), null), exported);
    await button('임시본 복구').click();
    await page.getByRole('status').filter({ hasText: '임시 저장본을 복구했습니다' }).waitFor();

    // Same-origin URL mode and a host-provided transport use the same model.
    const other = await page.evaluate(async () => {
      const { mountEditor } = await import('/site/editor/editor.js');
      const addHost = () => document.body.appendChild(document.createElement('div'));
      const settings = { assetBaseUrl: '/site/stories/' };
      const same = mountEditor(addHost(), { ...settings, getUrl: '/work', postUrl: '/work' });
      const sameResult = await same.ready && await same.save();
      same.destroy();
      let posted;
      const hooks = mountEditor(addHost(), {
        ...settings, load: async () => fetch('/work').then((response) => response.json()),
        save: (work) => { posted = work; return { ok: true }; },
      });
      const hookResult = await hooks.ready && await hooks.save();
      hooks.destroy();
      return { sameResult, hookResult, version: posted.schemaVersion };
    });
    assert.deepEqual(other, { sameResult: true, hookResult: true, version: 1 });
    await page.evaluate(async () => {
      const { mountEditor } = await import('/site/editor/editor.js');
      const node = document.body.appendChild(document.createElement('div'));
      node.id = 'single-scene-example';
      const work = editor.exportWork();
      work.groups = [work.groups[0]];
      window.singleEditor = mountEditor(node, { source: work });
      await singleEditor.ready;
    });
    const single = page.locator('#single-scene-example');
    await single.getByRole('button', { name: '해당 장면 삭제' }).click();
    const remaining = await page.evaluate(() => singleEditor.exportWork().groups);
    assert.equal(remaining.length, 1);
    assert.deepEqual(remaining[0].objects, []);
    await single.getByRole('button', { name: '실행 취소' }).click();
    assert.equal(await page.evaluate(() => singleEditor.exportWork().groups[0].id), 'platform');
    await page.evaluate(() => singleEditor.destroy());
    assert.deepEqual(errors, []);
    console.log(browserType.name() + ': editor workflow, preview, draft, export/import, and host roundtrip passed');
  } finally {
    await browser.close();
    frontend.server.close();
    backend.server.close();
  }
}
