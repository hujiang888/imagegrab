/**
 * ImageGrab 端到端测试
 * - 用本机 Edge + Playwright 加载真实扩展
 * - 在本地模拟详情页上触发提取，验证过滤、去重、画廊渲染
 * - 勾选全部并真实下载，校验 PNG 文件签名与命名
 * - 顺带产出官网需要的截图
 *
 * 运行：node tests/e2e.js
 */
'use strict';

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');
const DOCS_ASSETS = path.join(ROOT, 'docs', 'assets');
const EXPECTED_COUNT = 11;
const EXPECTED_TOTAL = 19;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif'
};

function log(...args) {
  console.log('[e2e]', ...args);
}

function assert(condition, message) {
  if (!condition) throw new Error('断言失败：' + message);
}

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

/** 复制扩展源码到临时目录，并给测试版 manifest 加上 localhost 权限 */
function prepareExtension(dir) {
  fs.mkdirSync(dir, { recursive: true });
  ['manifest.json', 'background.js', 'content.js', 'content.css', 'gallery.html', 'gallery.css', 'gallery.js'].forEach(
    (file) => fs.copyFileSync(path.join(ROOT, file), path.join(dir, file))
  );
  fs.cpSync(path.join(ROOT, 'lib'), path.join(dir, 'lib'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'icons'), path.join(dir, 'icons'), { recursive: true });

  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions.push('http://127.0.0.1/*');
  manifest.content_scripts[0].matches.push('http://127.0.0.1/*');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

function startServer() {
  const server = http.createServer((req, res) => {
    try {
      const requested = decodeURIComponent((req.url || '/').split('?')[0]);
      const filePath = path.join(FIXTURES, requested === '/' ? 'mock.html' : requested);
      if (!filePath.startsWith(FIXTURES)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      res.writeHead(500).end(String(error));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function isPng(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(8);
  fs.readSync(fd, buffer, 0, 8, 0);
  fs.closeSync(fd);
  return buffer.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function pngSize(filePath) {
  const buffer = fs.readFileSync(filePath);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), bytes: buffer.length };
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imagegrab-e2e-'));
  const extDir = path.join(tmpRoot, 'ext');
  const profileDir = path.join(tmpRoot, 'profile');
  const downloadDir = path.join(tmpRoot, 'downloads');
  fs.mkdirSync(path.join(profileDir, 'Default'), { recursive: true });
  fs.mkdirSync(downloadDir, { recursive: true });
  fs.mkdirSync(DOCS_ASSETS, { recursive: true });
  prepareExtension(extDir);

  // 让 Chrome 把下载文件放进临时目录，测试结束随临时目录一起清理
  fs.writeFileSync(
    path.join(profileDir, 'Default', 'Preferences'),
    JSON.stringify({
      download: { default_directory: downloadDir, prompt_for_download: false, directory_upgrade: true },
      savefile: { default_directory: downloadDir },
      browser: { has_seen_welcome_page: true }
    })
  );

  const { server, port } = await startServer();
  const pageUrl = `http://127.0.0.1:${port}/mock.html`;
  log('mock page:', pageUrl);

  let context;
  let downloads = [];
  let createdFiles = [];

  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'msedge',
      headless: true,
      viewport: { width: 1440, height: 960 },
      locale: 'zh-CN',
      args: [
        `--disable-extensions-except=${extDir}`,
        `--load-extension=${extDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=Translate,MediaRouter'
      ]
    });

    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
    const extensionId = new URL(worker.url()).host;
    log('extension id:', extensionId);

    // Playwright 默认用 allowAndName 策略把下载文件重命名为 UUID，
    // 这里通过 CDP 改回 allow，验证扩展自定义的「商品图_001.png」文件名。
    const browser = context.browser();
    const setDownloadBehavior = async () => {
      if (!browser) return false;
      try {
        const cdp = await browser.newBrowserCDPSession();
        await cdp.send('Browser.setDownloadBehavior', {
          behavior: 'allow',
          downloadPath: downloadDir,
          eventsEnabled: true
        });
        await cdp.detach();
        return true;
      } catch (error) {
        log('CDP setDownloadBehavior failed:', error.message);
        return false;
      }
    };
    log('download behavior override:', await setDownloadBehavior());

    const page = context.pages()[0] || (await context.newPage());
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') pageErrors.push('console: ' + msg.text());
    });

    await page.goto(pageUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    const tabId = await worker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url === url);
      return tab ? tab.id : null;
    }, pageUrl);
    assert(tabId, '应能找到模拟详情页的 tabId');

    // 触发 content script 强制扫描（模拟点击悬浮按钮前的注入）
    const galleryPromise = context.waitForEvent('page', { timeout: 30000 });
    const scanResult = await worker.evaluate(
      (id) => chrome.tabs.sendMessage(id, { type: 'IG_FORCE_SCAN' }),
      tabId
    );
    log('scan result:', JSON.stringify(scanResult));
    assert(scanResult && scanResult.ok, '扫描应成功');
    assert(scanResult.count === EXPECTED_COUNT, `应提取 ${EXPECTED_COUNT} 张，实际 ${scanResult.count}`);

    const gallery = await galleryPromise;
    gallery.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        console.log('[gallery:' + msg.type() + ']', msg.text());
      }
    });
    gallery.on('pageerror', (error) => console.log('[gallery:pageerror]', String(error)));
    worker.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        console.log('[sw:' + msg.type() + ']', msg.text());
      }
    });
    await gallery.waitForLoadState('domcontentloaded');
    await gallery.waitForSelector('.card', { timeout: 15000 });
    await gallery.waitForTimeout(900);

    // 校验扫描记录中的过滤 / 去重结果
    const scanRecord = await worker.evaluate(async (id) => {
      const key = 'scan:' + id;
      const store = chrome.storage.session || chrome.storage.local;
      const all = await store.get(key);
      return all[key] || null;
    }, scanResult.scanId);
    assert(scanRecord, '扫描记录应已保存');
    const urls = scanRecord.images.map((image) => image.url);
    const productUrls = scanRecord.images.filter((image) => image.relevant !== false).map((image) => image.url);
    const otherUrls = scanRecord.images.filter((image) => image.relevant === false).map((image) => image.url);
    assert(urls.length === EXPECTED_TOTAL, `扫描记录应包含 ${EXPECTED_TOTAL} 张，实际 ${urls.length}`);
    assert(productUrls.length === EXPECTED_COUNT, `商品图应为 ${EXPECTED_COUNT} 张，实际 ${productUrls.length}`);
    assert(otherUrls.length === EXPECTED_TOTAL - EXPECTED_COUNT, `无关图应为 ${EXPECTED_TOTAL - EXPECTED_COUNT} 张，实际 ${otherUrls.length}`);
    assert(scanRecord.stats.product === EXPECTED_COUNT, '统计中的商品图数量应正确');
    assert(scanRecord.stats.other === EXPECTED_TOTAL - EXPECTED_COUNT, '统计中的无关图数量应正确');
    assert(productUrls.some((url) => /tryon\.png$/.test(url)), '应保留模特试穿图');
    assert(!productUrls.some((url) => /(bg\.jpg|rec=|review=)/.test(url)), '商品图不应包含横幅/推荐/评价图');
    assert(otherUrls.some((url) => /rec=1/.test(url)), '推荐商品图应被标记为无关');
    assert(otherUrls.some((url) => /review=1/.test(url)), '买家秀应被标记为无关');
    assert(otherUrls.some((url) => /banner=1/.test(url)), '广告横幅应被标记为无关');
    assert(!urls.some((url) => /(thumb\.jpg|icon\.png|pixel\.png|logo\.svg)$/.test(url)), '应过滤小图与图标');
    assert(new Set(urls).size === urls.length, '图片 URL 应去重');
    log('product urls:', productUrls.map((url) => url.split('/').pop()).join(', '));
    log('other urls:', otherUrls.map((url) => url.split('/').pop()).join(', '));

    const cardCount = await gallery.locator('.card').count();
    assert(cardCount === EXPECTED_COUNT, `画廊默认应展示 ${EXPECTED_COUNT} 张商品图，实际 ${cardCount}`);
    assert(
      (await gallery.locator('#metaText').textContent()).includes('11 张商品图'),
      '画廊标题应显示商品图数量'
    );
    assert(
      (await gallery.locator('#filterNote').textContent()).includes('8 张无关图片'),
      '过滤提示应显示被排除的无关图数量'
    );

    // 切换到“全部”应能看到被过滤的 8 张图
    await gallery.locator('[data-scope="all"]').click();
    await gallery.waitForTimeout(300);
    const allCardCount = await gallery.locator('.card').count();
    assert(allCardCount === EXPECTED_TOTAL, `“全部”模式应展示 ${EXPECTED_TOTAL} 张，实际 ${allCardCount}`);
    const allCardUrls = await gallery.locator('.card img').evaluateAll((imgs) => imgs.map((img) => img.src));
    assert(allCardUrls.some((url) => /rec=1/.test(url)), '“全部”模式应包含推荐图');
    assert(allCardUrls.some((url) => /review=1/.test(url)), '“全部”模式应包含买家秀');
    fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
    await gallery.screenshot({ path: path.join(__dirname, 'output', 'gallery-all.png') });
    await gallery.locator('[data-scope="product"]').click();
    await gallery.waitForTimeout(300);
    assert((await gallery.locator('.card').count()) === EXPECTED_COUNT, '切回商品图应恢复默认数量');

    // 预览大图的左右切换只应在当前“商品图”范围内
    await gallery.locator('.card__thumb').first().click();
    await gallery.waitForSelector('#lightbox:not([hidden])', { timeout: 5000 });
    const firstLightboxMeta = (await gallery.locator('#lightboxMeta').textContent()).trim();
    assert(firstLightboxMeta.includes('/ 11'), '预览序号应基于当前可见商品图，实际：' + firstLightboxMeta);
    for (let i = 0; i < EXPECTED_COUNT - 1; i += 1) {
      await gallery.keyboard.press('ArrowRight');
      await gallery.waitForTimeout(80);
    }
    const lastLightboxMeta = (await gallery.locator('#lightboxMeta').textContent()).trim();
    assert(lastLightboxMeta.startsWith('11 / 11'), '最后一张商品图预览序号应为 11 / 11，实际：' + lastLightboxMeta);
    assert(await gallery.locator('#lightboxNext').isDisabled(), '最后一张时“下一张”应禁用');
    await gallery.locator('#lightboxClose').click();

    // 截图用：把演示域名改成 item.jd.com，让官网素材更真实（不影响功能断言）
    await worker.evaluate(async (id) => {
      const key = 'scan:' + id;
      const store = chrome.storage.session || chrome.storage.local;
      const all = await store.get(key);
      if (!all[key]) return;
      all[key].host = 'item.jd.com';
      await store.set(all);
    }, scanResult.scanId);
    await gallery.reload();
    await gallery.waitForSelector('.card', { timeout: 15000 });
    await gallery.waitForFunction(
      () => document.querySelectorAll('.card img.is-loaded').length >= 8,
      null,
      { timeout: 15000 }
    );

    // 选中前 3 张，截一张官网用图
    const cards = gallery.locator('.card');
    for (let i = 0; i < 3; i += 1) {
      await cards.nth(i).locator('.card__check').click();
    }
    assert((await gallery.locator('#selectedCount').textContent()).trim() === '3', '已选数量应为 3');

    await gallery.setViewportSize({ width: 1600, height: 800 });
    await gallery.mouse.move(4, 4);
    await gallery.waitForTimeout(500);
    await gallery.screenshot({ path: path.join(DOCS_ASSETS, 'screenshot-gallery.png'), fullPage: false });
    log('screenshot: gallery');

    // 移动端截图
    await gallery.setViewportSize({ width: 390, height: 844 });
    await gallery.waitForTimeout(400);
    await gallery.screenshot({ path: path.join(DOCS_ASSETS, 'screenshot-gallery-mobile.png'), fullPage: false });
    await gallery.setViewportSize({ width: 1440, height: 960 });
    log('screenshot: gallery mobile');

    // 回到商品页截悬浮按钮（隐藏提示条，保持画面干净）
    await page.bringToFront();
    await page.evaluate(() => {
      const toast = document.querySelector('#imagegrab-widget .ig-toast');
      if (toast) toast.className = 'ig-toast';
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(DOCS_ASSETS, 'screenshot-fab.png'), fullPage: false });
    log('screenshot: fab');

    // 重新激活画廊，全选并下载
    await gallery.bringToFront();
    await gallery.locator('.toolbar .checkbox').click();
    await gallery.waitForTimeout(200);
    assert(
      (await gallery.locator('#selectedCount').textContent()).trim() === String(EXPECTED_COUNT),
      '全选后数量应等于总数'
    );

    await setDownloadBehavior();
    await gallery.waitForTimeout(150);
    await gallery.locator('#downloadBtn').click();
    await gallery.waitForFunction(
      () => {
        const title = document.getElementById('progressTitle');
        return title && /全部下载完成|下载完成（部分失败）|已取消下载/.test(title.textContent || '');
      },
      null,
      { timeout: 180000 }
    );
    log('download finished:', (await gallery.locator('#progressTitle').textContent()).trim());
    log('progress detail:', (await gallery.locator('#progressFile').textContent()).trim(), '/', (await gallery.locator('#progressStats').textContent()).trim());

    await gallery.waitForTimeout(1200);
    downloads = await worker.evaluate(() => chrome.downloads.search({}));
    log(
      'download states:',
      downloads.map((item) => `${path.basename(item.filename)}:${item.state}`).join(', ')
    );
    assert(downloads.length >= EXPECTED_COUNT, `下载记录应有 ${EXPECTED_COUNT} 条，实际 ${downloads.length}`);
    assert(
      downloads.every((item) => item.state === 'complete'),
      '所有下载都应完成：' + JSON.stringify(downloads.filter((item) => item.state !== 'complete'))
    );

    const names = downloads.map((item) => path.basename(item.filename)).sort();
    log('downloaded files:', names.join(', '));
    for (let i = 1; i <= EXPECTED_COUNT; i += 1) {
      const expected = `商品图_${String(i).padStart(3, '0')}.png`;
      assert(names.includes(expected), '缺少下载文件 ' + expected);
    }

    let pngCount = 0;
    const sizes = [];
    downloads.forEach((item) => {
      if (fs.existsSync(item.filename)) {
        createdFiles.push(item.filename);
        assert(isPng(item.filename), '文件不是有效 PNG：' + item.filename);
        pngCount += 1;
        const info = pngSize(item.filename);
        sizes.push({ name: path.basename(item.filename), ...info });
      }
    });
    assert(pngCount === EXPECTED_COUNT, `PNG 文件数量应为 ${EXPECTED_COUNT}，实际 ${pngCount}`);
    const bigFile = sizes.find((item) => item.name === '商品图_010.png');
    assert(bigFile && bigFile.width === 1800 && bigFile.height === 1800, '大图应转换为 1800x1800 PNG');
    log('png sizes:', sizes.map((item) => `${item.name}=${item.width}x${item.height}(${Math.round(item.bytes / 1024)}KB)`).join(', '));

    assert(pageErrors.length === 0, '页面不应有报错：' + pageErrors.join(' | '));

    // 重新扫描按钮
    const secondGalleryPromise = context.waitForEvent('page', { timeout: 30000 });
    await gallery.locator('#rescanBtn').click();
    const secondGallery = await secondGalleryPromise;
    await secondGallery.waitForSelector('.card', { timeout: 15000 });
    log('rescan opened new gallery:', await secondGallery.title());

    fs.writeFileSync(
      path.join(tmpRoot, 'result.json'),
      JSON.stringify({ ok: true, count: EXPECTED_COUNT, downloads: names, sizes }, null, 2)
    );
    log('ALL TESTS PASSED');
  } catch (error) {
    console.error('[e2e] FAILED:', error && error.stack ? error.stack : error);
    process.exitCode = 1;
  } finally {
    if (context) await context.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    // 只清理本次测试创建的下载文件
    createdFiles.forEach((file) => {
      try {
        if (path.resolve(file).startsWith(path.resolve(downloadDir))) fs.unlinkSync(file);
      } catch (e) {
        /* ignore */
      }
    });
    if (!process.env.IMAGEGRAB_KEEP_TEMP) rmrf(tmpRoot);
  }
}

main();
