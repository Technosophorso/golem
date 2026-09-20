// [COMP:app-web/feed-tuning-chat] Real-layout regression for every Feed composer
// host. Run with PLAYWRIGHT_MODULE when Playwright is installed externally.
// Uses the production component, primitives, globals.css and SSE handler with
// an in-memory authenticated transport. No real account, API or model call.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { resolveCollabSingletonAliases } from '../../../scripts/collab-singletons.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const app = fileURLToPath(new URL('..', import.meta.url));
const cache = await mkdtemp(join(tmpdir(), 'brian-feed-composer-'));
const output = process.env.FEED_COMPOSER_OUTPUT || join(tmpdir(), 'feed-composer-browser');
await mkdir(output, { recursive: true });
const server = await createServer({ configFile: false, envFile: false, root: app, cacheDir: cache,
  plugins: [react(), tailwind()], css: { postcss: { plugins: [] } }, define: { 'process.env': '{}' },
  resolve: { dedupe: ['react', 'react-dom'], alias: [
    { find: '@/lib/auth-fetch', replacement: join(app, 'scripts/fixtures/feed-composer-network.ts') },
    { find: './auth-fetch', replacement: join(app, 'scripts/fixtures/feed-composer-network.ts') },
    { find: '@', replacement: join(app, 'src') },
    ...Object.entries(resolveCollabSingletonAliases(new URL('../package.json', import.meta.url))).map(([find, replacement]) => ({ find, replacement })),
  ] }, server: { port: 0, host: '127.0.0.1', hmr: false, fs: { allow: [resolve(app, '../../..'), cache] } } });
let browser;
const results = [];
try {
  await server.listen();
  const port = server.httpServer.address().port;
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    localStorage.setItem('feed-chat-model', 'standard');
    localStorage.setItem('feed-chat-model-pro-default-migrated', '1');
  });
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  page.setDefaultTimeout(30_000);
  async function measure(name, phone, streaming) {
    const row = await page.evaluate(() => {
      const dict = window.feedComposerFixture.dict;
      const textarea = document.querySelector('textarea');
      const composer = textarea.parentElement.parentElement;
      const rect = composer.getBoundingClientRect();
      const buttons = [...composer.querySelectorAll('button')].map(button => {
        const box = button.getBoundingClientRect();
        const inset = box.width && box.height && box.left >= rect.left && box.right <= rect.right + 0.5 && box.top >= rect.top && box.bottom <= rect.bottom + 0.5;
        const center = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return { label: button.getAttribute('aria-label') || button.title || button.textContent, width: box.width, height: box.height,
          right: box.right, inside: Boolean(inset), reachable: center === button || button.contains(center) };
      });
      return { composer: { width: rect.width, right: rect.right }, buttons, send: dict.feedPage.tuningChat.send, stop: dict.feedPage.tuningChat.stop,
        queue: dict.chat.queue.send, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    const failures = row.buttons.filter(button => !button.inside || !button.reachable).map(button => `clipped/unreachable ${button.label}`);
    if (row.overflow) failures.push('document overflow');
    if (phone) for (const label of [streaming ? row.queue : row.send, ...(streaming ? [row.stop] : [])]) {
      const action = row.buttons.find(button => button.label === label);
      if (!action || action.width < 44 || action.height < 44) failures.push(`touch target ${label}`);
    }
    results.push({ name, failures, ...row });
    await page.locator('[data-fixture-rail]').screenshot({ path: join(output, `${name}.png`) });
  }
  for (const locale of ['en', 'ja', 'zh', 'zh-cn']) for (const width of [320, 360, 390]) {
    const phone = width === 390;
    await page.setViewportSize({ width: phone ? 390 : 1440, height: 844 });
    for (const long of [false, true]) {
      const name = `${locale}-${phone ? 'phone' : 'rail'}-${width}${long ? '-long' : ''}`;
      await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/feed-composer-browser.html?locale=${locale}&width=${width}${long ? '&long=1' : ''}`);
      await page.locator('textarea').waitFor();
      const copy = await page.evaluate(() => window.feedComposerFixture.dict.feedPage.tuningChat);
      await page.locator('textarea').fill('Improve the fictional opening.');
      await page.locator(`button[title=${JSON.stringify(copy.send)}]`).waitFor({ state: 'visible' });
      await page.waitForFunction(label => !document.querySelector(`button[title="${label}"]`)?.disabled, copy.send);
      await measure(`${name}-idle`, phone, false);
      const picker = page.locator('[data-slot="select-trigger"]');
      assert.equal((await picker.innerText()).trim(), copy.modelStandard, 'Trigger must show the localized short model name');
      if (name === 'en-rail-320') await writeFile(join(output, 'model-accessibility.txt'), await picker.ariaSnapshot());
      await picker.click();
      await page.getByRole('option').nth(2).click();
      assert.equal((await picker.innerText()).trim(), copy.modelMax);
      await picker.click();
      await page.getByRole('option').nth(0).click();
      await page.locator('button[aria-pressed]').filter({ has: page.locator('svg path[d^="M12 3l2"]') }).click();
      await page.locator('textarea').press('Enter');
      await page.locator(`button[title=${JSON.stringify(copy.stop)}]`).waitFor();
      await page.waitForFunction(() => document.body.textContent.includes('9/10'));
      await page.locator('textarea').fill('Keep the example.');
      await measure(`${name}-streaming`, phone, true);
      const queue = await page.evaluate(() => window.feedComposerFixture.dict.chat.queue.send);
      await page.locator(`button[title=${JSON.stringify(queue)}]`).click();
      await page.waitForFunction(() => window.feedComposerFixture.requests.some(({ body }) => body.message === 'Keep the example.' && body.inputId));
      await page.locator(`button[title=${JSON.stringify(copy.stop)}]`).click();
      await page.locator(`button[title=${JSON.stringify(copy.stop)}]`).waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => window.feedComposerFixture.requests.some(({ url }) => url === '/api/chat/stop')), true);
    }
  }
  await writeFile(join(output, 'results.json'), JSON.stringify({ errors, results }, null, 2));
  assert.deepEqual(errors, [], 'Unexpected browser errors');
  const failed = results.filter(row => row.failures.length);
  console.log(JSON.stringify({ scenarios: results.length, failures: failed.map(({ name, failures }) => ({ name, failures })), output }, null, 2));
  assert.equal(failed.length, 0, 'Feed composer controls must remain inside their card, reachable and touch-sized');
} finally {
  await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true });
}
