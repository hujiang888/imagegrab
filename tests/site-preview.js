'use strict';
/** 官网视觉预览与响应式检查（不依赖服务器，直接打开 docs/index.html）。 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });

function fileUrl(file) {
  return 'file:///' + path.resolve(file).replace(/\\/g, '/');
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, locale: 'zh-CN' });
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto(fileUrl(path.join(ROOT, 'docs', 'index.html')), { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  await page.screenshot({ path: path.join(OUT, 'site-hero.png') });
  await page.screenshot({ path: path.join(OUT, 'site-full.png'), fullPage: true });

  for (const [name, selector] of [
    ['about', '#about'],
    ['features', '#features'],
    ['preview', '#preview'],
    ['install', '#install'],
    ['faq', '#faq'],
    ['cta', '.section--cta'],
    ['footer', '.footer']
  ]) {
    const section = page.locator(selector);
    await section.scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    await section.screenshot({ path: path.join(OUT, `site-${name}.png`) });
  }

  const overflow = {};
  for (const width of [320, 360, 390, 480, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(250);
    overflow[width] = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      overflowing: Array.from(document.querySelectorAll('body *'))
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && (rect.right > window.innerWidth + 1 || rect.left < -1);
        })
        .slice(0, 5)
        .map((el) => el.className || el.tagName)
    }));
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fileUrl(path.join(ROOT, 'docs', 'index.html')), { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, 'site-mobile-full.png'), fullPage: true });
  await page.screenshot({ path: path.join(OUT, 'site-mobile-hero.png') });

  for (const [name, selector] of [
    ['about', '#about'],
    ['split', '.split'],
    ['features', '#features'],
    ['install', '#install'],
    ['download', '.download-card'],
    ['faq', '#faq'],
    ['cta', '.section--cta']
  ]) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -70));
    await page.waitForTimeout(750);
    await page.screenshot({ path: path.join(OUT, `site-mobile-${name}.png`) });
  }

  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto(fileUrl(path.join(ROOT, 'docs', 'index.html')), { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, 'site-320-hero.png') });

  // 移动端菜单
  await page.locator('#navToggle').click();
  await page.waitForTimeout(350);
  const menuOpen = await page.locator('#nav').evaluate((el) => el.classList.contains('is-open'));
  await page.screenshot({ path: path.join(OUT, 'site-mobile-menu.png') });
  await page.locator('#navToggle').click();

  // 截图放大
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(fileUrl(path.join(ROOT, 'docs', 'index.html')), { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.locator('.browser__shot').click();
  await page.waitForTimeout(350);
  const lightboxOpen = await page.locator('#lightbox').isVisible();
  await page.screenshot({ path: path.join(OUT, 'site-lightbox.png') });
  await page.locator('#lightboxClose').click();

  const activeLink = await page.locator('.nav__link.is-active').count();

  console.log(JSON.stringify({ overflow, menuOpen, lightboxOpen, activeLink, errors }, null, 2));
  await browser.close();
})();
