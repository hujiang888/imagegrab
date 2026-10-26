'use strict';
/**
 * 图片提取核心的纯函数单测（不需要浏览器）。
 * 运行：node tests/unit-core.js
 */
require('../lib/extract-core.js');

const assert = require('assert');
const IG = globalThis.IGExtract;

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✓', name);
  } catch (error) {
    console.error('  ✗', name);
    throw error;
  }
}

console.log('isProductPageUrl');
[
  ['item.taobao.com', '/item.htm?id=123'],
  ['detail.tmall.com', '/item.htm?id=456'],
  ['chaoshi.detail.tmall.com', '/item.htm?id=1'],
  ['detail.tmall.hk', '/item/1.htm'],
  ['item.jd.com', '/100012043978.html'],
  ['item.jd.hk', '/100012043978.html'],
  ['item.m.jd.com', '/product/100012043978.html'],
  ['mobile.yangkeduo.com', '/goods.html?goods_id=123'],
  ['mobile.pinduoduo.com', '/goods1.html?goods_id=123'],
  ['www.pinduoduo.com', '/goods.html?goods_id=123'],
  ['www.yangkeduo.com', '/detail.html?goods_id=1']
].forEach(([host, path]) => {
  check(`${host}${path} 应识别为详情页`, () => {
    assert.strictEqual(IG.isProductPageUrl(host, path), true);
  });
});

[
  ['www.taobao.com', '/'],
  ['s.taobao.com', '/search?q=耳机'],
  ['search.jd.com', '/Search?keyword=耳机'],
  ['item.jd.com', '/'],
  ['mobile.yangkeduo.com', '/search.html'],
  ['mms.pinduoduo.com', '/goods/list'],
  ['example.com', '/item.htm?id=1']
].forEach(([host, path]) => {
  check(`${host}${path} 不应识别为详情页`, () => {
    assert.strictEqual(IG.isProductPageUrl(host, path), false);
  });
});

console.log('absoluteUrl');
check('协议相对路径补全', () => {
  assert.strictEqual(
    IG.absoluteUrl('//img.alicdn.com/a.jpg', 'https://item.jd.com/1.html'),
    'https://img.alicdn.com/a.jpg'
  );
});
check('相对路径补全并去掉 hash', () => {
  assert.strictEqual(
    IG.absoluteUrl('img/a.jpg?x=1#frag', 'https://item.jd.com/1.html'),
    'https://item.jd.com/img/a.jpg?x=1'
  );
});
check('已知 CDN 的 http 自动升级 https', () => {
  assert.strictEqual(
    IG.absoluteUrl('http://img14.360buyimg.com/a.jpg', 'https://item.jd.com/1.html'),
    'https://img14.360buyimg.com/a.jpg'
  );
});
check('data / blob / javascript 被忽略', () => {
  assert.strictEqual(IG.absoluteUrl('data:image/png;base64,AAAA', 'https://a.com'), '');
  assert.strictEqual(IG.absoluteUrl('blob:https://a.com/1', 'https://a.com'), '');
  assert.strictEqual(IG.absoluteUrl('javascript:alert(1)', 'https://a.com'), '');
});
check('HTML 实体 &amp; 会被解码', () => {
  assert.strictEqual(
    IG.absoluteUrl('https://img.alicdn.com/a.jpg?x=1&amp;y=2', 'https://a.com'),
    'https://img.alicdn.com/a.jpg?x=1&y=2'
  );
});

console.log('srcset / background / filter');
check('srcset 选取最大宽度', () => {
  assert.strictEqual(
    IG.pickBestSrcset('small.jpg 400w, large.jpg 1200w, mid.jpg 800w', 'https://a.com/p'),
    'https://a.com/large.jpg'
  );
});
check('srcset 支持 x 描述符', () => {
  const list = IG.parseSrcset('a.jpg 1x, b.jpg 3x, c.jpg 2x', 'https://a.com/p');
  assert.strictEqual(list.length, 3);
  assert.strictEqual(IG.pickBestSrcset('a.jpg 1x, b.jpg 3x, c.jpg 2x', 'https://a.com/p'), 'https://a.com/b.jpg');
});
check('background-image 解析', () => {
  assert.deepStrictEqual(IG.parseBackgroundUrls(`url("a.jpg"), url('b.png')`, 'https://a.com/p'), [
    'https://a.com/a.jpg',
    'https://a.com/b.png'
  ]);
});
check('图标 / logo / svg 被判定为噪声', () => {
  ['https://a.com/logo.png', 'https://a.com/sprite.png', 'https://a.com/icon/1.png', 'https://a.com/a.svg'].forEach(
    (url) => assert.strictEqual(IG.isNoiseUrl(url), true, url)
  );
  ['https://a.com/product_01.png', 'https://a.com/O1CN01abc.jpg'].forEach((url) =>
    assert.strictEqual(IG.isNoiseUrl(url), false, url)
  );
});
check('尺寸过滤', () => {
  assert.strictEqual(IG.isTooSmall(1, 1), true);
  assert.strictEqual(IG.isTooSmall(90, 90), true);
  assert.strictEqual(IG.isTooSmall(80, 400), false);
  assert.strictEqual(IG.isTooSmall(900, 900), false);
  assert.strictEqual(IG.isTooSmall(0, 0), false);
});
check('懒加载属性覆盖三大平台', () => {
  ['data-src', 'data-lazy-src', 'data-ks-lazyload', 'data-zoom-image', 'data-original'].forEach((attr) =>
    assert.ok(IG.LAZY_ATTRS.includes(attr), attr)
  );
});

console.log(`\n单元测试通过：${passed} 项`);
