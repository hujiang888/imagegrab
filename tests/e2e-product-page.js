'use strict';
/**
 * 真实 manifest 验证：把本地模拟详情页伪装成 item.jd.com，
 * 确认扩展能在受支持的商品详情页自动注入「获取图片」按钮并打开画廊。
 *
 * 运行：node tests/e2e-product-page.js
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif'
};

function assert(condition, message) {
  if (!condition) throw new Error('断言失败：' + message);
}

function copyExtension(dir) {
  fs.mkdirSync(dir, { recursive: true });
  ['manifest.json', 'background.js', 'content.js', 'content.css', 'gallery.html', 'gallery.css', 'gallery.js'].forEach(
    (file) => fs.copyFileSync(path.join(ROOT, file), path.join(dir, file))
  );
  fs.cpSync(path.join(ROOT, 'lib'), path.join(dir, 'lib'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'icons'), path.join(dir, 'icons'), { recursive: true });
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'imagegrab-product-'));
  // 支持直接验证打包后的 ZIP 解压目录：IMAGEGRAB_EXT_DIR=...
  const packagedDir = process.env.IMAGEGRAB_EXT_DIR ? path.resolve(process.env.IMAGEGRAB_EXT_DIR) : '';
  const extDir = packagedDir || path.join(tmp, 'ext');
  const profileDir = path.join(tmp, 'profile');
  if (packagedDir) {
    assert(fs.existsSync(path.join(packagedDir, 'manifest.json')), '打包目录缺少 manifest.json');
  } else {
    copyExtension(extDir);
  }
  fs.mkdirSync(path.join(profileDir, 'Default'), { recursive: true });

  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    // 让 JD 风格的 /100012043978.html 指向同一份模拟详情页
    const mapped = /^\/\d+\.html$/.test(urlPath) ? 'mock.html' : urlPath === '/' ? 'mock.html' : urlPath;
    const file = path.join(FIXTURES, mapped);
    if (!file.startsWith(FIXTURES) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const pageUrl = `http://item.jd.com:${port}/100012043978.html`;

  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'msedge',
      headless: true,
      viewport: { width: 1440, height: 960 },
      locale: 'zh-CN',
      ignoreHTTPSErrors: true,
      args: [
        `--disable-extensions-except=${extDir}`,
        `--load-extension=${extDir}`,
        `--host-resolver-rules=MAP item.jd.com 127.0.0.1`,
        '--ignore-certificate-errors',
        '--no-proxy-server',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=HttpsUpgrades,HttpsFirstModeV2'
      ]
    });

    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
    console.log('[product] extension:', new URL(worker.url()).host);

    const page = context.pages()[0] || (await context.newPage());
    page.on('console', (msg) => console.log('[page:' + msg.type() + ']', msg.text()));
    page.on('pageerror', (error) => console.log('[page:error]', String(error)));
    worker.on('console', (msg) => console.log('[sw:' + msg.type() + ']', msg.text()));
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    console.log('[product] final url:', page.url());
    assert(page.url().includes('item.jd.com'), '页面应停留在 item.jd.com 模拟域名');

    // 真实 manifest 下 content script 自动注入，无需任何手动脚本
    await page.waitForSelector('#imagegrab-widget.ig-visible', { timeout: 15000 });
    const fabText = (await page.locator('#imagegrab-widget .ig-fab__text').textContent()).trim();
    assert(fabText === '获取图片', '悬浮按钮文案应为「获取图片」，实际：' + fabText);
    console.log('[product] FAB auto-injected:', fabText);

    const galleryPromise = context.waitForEvent('page', { timeout: 30000 });
    const fab = page.locator('#imagegrab-fab');
    const box = await fab.boundingBox();
    const hit = await page.evaluate((rect) => {
      const el = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return el
        ? { tag: el.tagName, id: el.id, cls: String(el.className), pointerEvents: getComputedStyle(el).pointerEvents }
        : null;
    }, box);
    console.log('[product] fab box:', box, 'hit:', hit);
    try {
      await fab.click({ timeout: 6000 });
      console.log('[product] physical click ok');
    } catch (error) {
      console.log('[product] physical click failed:', error.message);
      await page.evaluate(() => document.getElementById('imagegrab-fab').click());
      console.log('[product] programmatic click sent');
    }
    await page.waitForTimeout(2500);
    const toast = await page.locator('#imagegrab-widget .ig-toast').textContent().catch(() => '');
    console.log('[product] toast after click:', JSON.stringify(toast));
    console.log('[product] pages:', context.pages().map((item) => item.url()));
    const gallery = await galleryPromise;
    await gallery.waitForSelector('.card', { timeout: 15000 });
    const count = await gallery.locator('.card').count();
    assert(count === 11, `画廊应有 11 张图片，实际 ${count}`);
    const meta = (await gallery.locator('#metaText').textContent()).trim();
    assert(meta.includes('item.jd.com'), '画廊应显示来源域名，实际：' + meta);
    console.log('[product] gallery:', count, 'images,', meta);

    console.log('[product] ALL PRODUCT-PAGE TESTS PASSED');
  } catch (error) {
    console.error('[product] FAILED:', error && error.stack ? error.stack : error);
    process.exitCode = 1;
  } finally {
    if (context) await context.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
