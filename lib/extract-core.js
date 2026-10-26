/**
 * 图提取 ImageGrab — 图片提取核心
 * ------------------------------------------------------------------
 * 该文件不依赖任何 DOM 之外的能力，content script 与测试脚本都会加载它。
 * 通过 globalThis.IGExtract 暴露纯函数，便于在 Node / Playwright 中单独测试。
 */
(function (root) {
  'use strict';

  /** 单次最多提取多少张，避免超大页面把画廊撑爆 */
  const MAX_IMAGES = 300;
  /** 相关性过滤后仍保留的“其他图片”上限，供画廊“全部”模式查看 */
  const MAX_OTHER_IMAGES = 100;
  /** 扫描阶段最多保留多少条原始候选 */
  const MAX_RAW_ENTRIES = 600;
  /** 短边小于该值视为图标 / 占位图（需求：过滤 100x100 以下） */
  const MIN_LONG_SIDE = 100;

  /** 懒加载属性：淘宝 / 京东 / 拼多多及常见商城模板使用的各种写法 */
  const LAZY_ATTRS = [
    'data-src',
    'data-lazy-src',
    'data-original',
    'data-original-src',
    'data-lazy',
    'data-url',
    'data-img',
    'data-image',
    'data-ks-lazyload',
    'data-lazyload',
    'data-src-large',
    'data-large',
    'data-large_image',
    'data-zoom-image',
    'data-old-hires',
    'data-origin',
    'data-actualsrc',
    'data-echo',
    'data-bg'
  ];

  /** 文件名里的噪声关键词（只匹配路径片段，避免误伤商品名里的字母） */
  const NOISE_RE =
    /(?:^|[/_.-])(icon|icons|logo|logos|sprite|sprites|avatar|placeholder|placeholder-image|blank|spacer|pixel|transparent|loading-icon|banner|banners|coupon|coupons|qrcode|qr-code|recommend|recommendation|review|comment|advert|advertisement)(?:[/_.-]|$)/i;

  /** 页面里明显与商品无关的区域（推荐、评价、广告、店铺装修等） */
  const EXCLUDE_HINTS =
    /(recommend|recommendation|guess|you-?may|also-?like|similar|ranking|rank-?list|hot-?sale|top-?list|feed-?list|advert|advertisement|banner|coupon|promo|activity|marketing|comment|review|rating|evaluate|buyer|avatar|user-?photo|qrcode|qr-?code|shop-?header|store-?header|site-?header|page-?footer|site-?footer|sidebar|customer-?service|service-?promise|payment|logo-?wall|(?:^|[^a-z])ads?(?:[^a-z]|$)|(?:^|[^a-z])(logo|icon|icons|sprite)(?:[^a-z]|$)|brand-?story|brand-?banner|service-?box|service-?icon|guarantee|买家秀|评价|评论|推荐|广告|优惠券|二维码|头像)/i;

  /** 商品主图 / 缩略图区域的容器特征 */
  const GALLERY_HINTS =
    /(gallery|main-?pic|mainpic|main-?image|spec-?img|spec-?list|spec-?items|thumb|swiper|carousel|booth|pic-?list|image-?list|goods-?gallery|product-?gallery)/i;

  /** 商品详情、试穿、模特、实拍区域的容器特征 */
  const DETAIL_HINTS =
    /(detail|desc|description|item-?desc|goods-?detail|product-?detail|try-?on|tryon|model|lookbook|showcase|show-?case|real-?shot|scene|试穿)/i;

  const POSITIVE_ALT_RE = /(商品|主图|细节|实拍|试穿|模特|场景|搭配|展示|详情|lookbook|model|try-?on|detail)/i;
  const NEGATIVE_ALT_RE = /(图标|logo|二维码|头像|推荐|广告|优惠券?|客服|支付|店铺|品牌|活动|猜你喜欢|banner|qr|avatar|icon)/i;

  const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|avif)(?:[?#]|$)/i;

  /** 已确认支持 https 的图片 CDN，用于把 http:// 升级为 https:// 规避混合内容 */
  const HTTPS_HOSTS = [
    'alicdn.com',
    '360buyimg.com',
    'pddpic.com',
    'taobao.com',
    'tmall.com',
    'jd.com',
    'yangkeduo.com',
    'pinduoduo.com'
  ];

  /** 各平台商品详情页 URL 规则（host + path 同时匹配） */
  const PRODUCT_RULES = [
    { host: /^item\.taobao\.com$/i, path: /\/item\.htm/i },
    { host: /^(detail|chaoshi\.detail|world)\.taobao\.com$/i, path: /\/item/i },
    { host: /^(detail|chaoshi\.detail|world)\.tmall\.com$/i, path: /\/item/i },
    { host: /^detail\.tmall\.hk$/i, path: /\/item/i },
    { host: /^item\.jd\.com$/i, path: /\/\d+\.html/i },
    { host: /^item\.jd\.hk$/i, path: /\/\d+\.html/i },
    { host: /^item\.m\.jd\.com$/i, path: /\/(product|item)/i },
    { host: /^(mobile|m)\.yangkeduo\.com$/i, path: /\/(goods|goods1|goods2)/i },
    { host: /^(mobile|m)\.pinduoduo\.com$/i, path: /\/(goods|goods1|goods2)/i },
    { host: /^(www\.)?yangkeduo\.com$/i, path: /\/(goods|detail)/i },
    { host: /^(www\.)?pinduoduo\.com$/i, path: /\/(goods|detail)/i }
  ];

  /**
   * 判断是否属于受支持平台的商品详情页。
   * @param {string} hostname 例如 item.jd.com
   * @param {string} pathAndQuery 例如 /100012043978.html?id=1
   */
  function isProductPageUrl(hostname, pathAndQuery) {
    const host = String(hostname || '');
    const path = String(pathAndQuery || '');
    return PRODUCT_RULES.some((rule) => rule.host.test(host) && rule.path.test(path));
  }

  function baseProtocol(base) {
    try {
      return new URL(base).protocol;
    } catch (e) {
      return 'https:';
    }
  }

  function isKnownCdn(hostname) {
    const host = String(hostname || '').toLowerCase();
    return HTTPS_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  }

  /**
   * 把各种相对 / 协议相对 URL 规范化为绝对 URL。
   * 返回空字符串表示该 URL 不应参与下载。
   */
  function absoluteUrl(raw, base) {
    if (!raw || typeof raw !== 'string') return '';
    let value = raw.trim().replace(/^['"]+|['"]+$/g, '').replace(/&amp;/g, '&');
    if (!value) return '';
    if (/^(data|blob|javascript|about|chrome-extension):/i.test(value)) return '';

    try {
      const parsed = new URL(value, base || undefined);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
      // 避免 https 页面里的 http 图片被浏览器按混合内容拦截
      if (parsed.protocol === 'http:' && baseProtocol(base) === 'https:' && isKnownCdn(parsed.hostname)) {
        parsed.protocol = 'https:';
      }
      parsed.hash = '';
      return parsed.href;
    } catch (e) {
      return '';
    }
  }

  /** 解析 srcset，返回 [{url, score}]，score 用于挑选最大的一档 */
  function parseSrcset(value, base) {
    const list = [];
    if (!value || typeof value !== 'string') return list;
    value.split(',').forEach((part) => {
      const item = part.trim();
      if (!item) return;
      const bits = item.split(/\s+/);
      const url = absoluteUrl(bits[0], base);
      if (!url) return;
      let score = 1;
      const descriptor = bits[1] || '';
      const w = descriptor.match(/^(\d+)w$/i);
      const x = descriptor.match(/^([\d.]+)x$/i);
      if (w) score = Number(w[1]);
      else if (x) score = Number(x[1]) * 1000;
      list.push({ url, score });
    });
    return list;
  }

  /** 从一组 srcset 候选中取分辨率最高的一张 */
  function pickBestSrcset(value, base) {
    const list = parseSrcset(value, base);
    if (!list.length) return '';
    list.sort((a, b) => b.score - a.score);
    return list[0].url;
  }

  /** 过滤 SVG / 图标 / logo / 占位图等显然不是商品图的 URL */
  function isNoiseUrl(url) {
    let pathname = '';
    try {
      pathname = new URL(url).pathname;
    } catch (e) {
      pathname = url;
    }
    if (/\.(svg|ico)$/i.test(pathname)) return true;
    return NOISE_RE.test(pathname);
  }

  /** 尺寸过滤：拿到宽高时才判断，未知尺寸先保留，交给画廊加载后再确认 */
  function isTooSmall(width, height) {
    const w = Number(width) || 0;
    const h = Number(height) || 0;
    if (w === 1 || h === 1) return true;
    if (w > 0 && h > 0 && Math.max(w, h) < MIN_LONG_SIDE) return true;
    return false;
  }

  /** 解析 CSS background-image 中的全部 url(...) */
  function parseBackgroundUrls(value, base) {
    const urls = [];
    if (!value || value === 'none') return urls;
    const re = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
    let match;
    while ((match = re.exec(value))) {
      const url = absoluteUrl(match[2], base);
      if (url) urls.push(url);
    }
    return urls;
  }

  /** 取得 img 的真实尺寸：优先 naturalSize，其次 width/height 属性，最后布局尺寸 */
  function imageSize(img) {
    const naturalWidth = Number(img.naturalWidth) || 0;
    const naturalHeight = Number(img.naturalHeight) || 0;
    if (naturalWidth > 0 && naturalHeight > 0) {
      return [naturalWidth, naturalHeight];
    }
    const attrWidth = parseInt(img.getAttribute('width'), 10) || 0;
    const attrHeight = parseInt(img.getAttribute('height'), 10) || 0;
    if (attrWidth > 0 && attrHeight > 0) return [attrWidth, attrHeight];
    const rect = typeof img.getBoundingClientRect === 'function' ? img.getBoundingClientRect() : null;
    return [Math.round(rect ? rect.width : 0), Math.round(rect ? rect.height : 0)];
  }

  /** 从商品链接中解析商品 ID（淘宝/天猫、京东、拼多多） */
  function productIdFromUrlParts(hostname, pathname, search) {
    const host = String(hostname || '').toLowerCase();
    const path = String(pathname || '');
    let params = null;
    try {
      params = new URLSearchParams(search || '');
    } catch (e) {
      params = null;
    }
    const get = (name) => (params ? params.get(name) : '') || '';

    if (/(^|\.)(taobao|tmall)\.(com|hk)$/.test(host)) {
      return get('id') || get('itemId') || '';
    }
    if (/(^|\.)jd\.(com|hk)$/.test(host)) {
      const match = path.match(/(\d+)\.html/);
      return (match && match[1]) || get('wareId') || get('sku') || get('skuId') || '';
    }
    if (/(^|\.)(yangkeduo|pinduoduo)\.com$/.test(host)) {
      return get('goods_id') || get('goodsId') || '';
    }
    return '';
  }

  /** 当前图片是否包在“另一个商品”的链接里（常见于猜你喜欢） */
  function isForeignProductLink(href, ctx) {
    if (!href || !ctx || !ctx.productId) return false;
    try {
      const url = new URL(href, ctx.base || undefined);
      const id = productIdFromUrlParts(url.hostname, url.pathname, url.search);
      return Boolean(id && id !== ctx.productId);
    } catch (e) {
      return false;
    }
  }

  /** 收集图片祖先节点的 id / class / role / aria-label，用于判断所在区域 */
  function ancestorHintText(element) {
    if (!element || !element.ownerDocument) return '';
    const doc = element.ownerDocument;
    const hints = [];
    let node = element;
    let depth = 0;
    while (node && node.nodeType === 1 && node !== doc.body && depth < 8) {
      const id = node.id || '';
      const cls = typeof node.className === 'string' ? node.className : '';
      const role = (node.getAttribute && node.getAttribute('role')) || '';
      const label = (node.getAttribute && node.getAttribute('aria-label')) || '';
      if (id || cls || role || label) hints.push(`${id} ${cls} ${role} ${label}`);
      node = node.parentElement;
      depth += 1;
    }
    return hints.join(' ').toLowerCase();
  }

  /** 是否位于页面导航、页脚、侧栏等明显非商品区域 */
  function isPageChrome(element) {
    if (!element || !element.ownerDocument) return false;
    const doc = element.ownerDocument;
    let node = element;
    while (node && node.nodeType === 1 && node !== doc.body) {
      const tag = node.tagName;
      if (tag === 'HEADER' || tag === 'FOOTER' || tag === 'NAV' || tag === 'ASIDE') return true;
      node = node.parentElement;
    }
    return false;
  }

  /**
   * 判断一张图是否属于商品图 / 试穿图。
   * 规则优先级：元数据 > 页面框架 > 明确排除区域 > 其他商品链接 > 比例 > 主图/详情区域 > 兜底。
   */
  function classifyImage(meta, ctx) {
    const element = (meta && meta.element) || null;
    const source = (meta && meta.source) || 'img';
    const width = Number(meta && meta.width) || 0;
    const height = Number(meta && meta.height) || 0;
    const alt = String((meta && meta.alt) || '');

    const product = (reason) => ({ relevant: true, category: 'product', reason });
    const other = (reason) => ({ relevant: false, category: 'other', reason });

    if (source === 'meta') return product('页面商品主图元数据');
    if (source === 'json-ld') return product('商品结构化数据');
    if (!element) return other('无法判断图片来源');

    if (isPageChrome(element)) return other('页面导航 / 页脚');

    const hints = ancestorHintText(element);
    const inGallery = GALLERY_HINTS.test(hints);
    const inDetail = DETAIL_HINTS.test(hints);
    const hasSize = width > 0 && height > 0;
    const ratio = hasSize ? width / height : 0;

    if (EXCLUDE_HINTS.test(hints)) return other('推荐 / 评价 / 广告区域');
    if (alt && NEGATIVE_ALT_RE.test(alt)) return other('图标 / 广告文案');

    if (!inGallery && !inDetail) {
      const anchor = element.closest ? element.closest('a[href]') : null;
      if (anchor && isForeignProductLink(anchor.getAttribute('href'), ctx)) {
        return other('其他商品的推荐链接');
      }
    }

    if (hasSize && (ratio > 3.2 || ratio < 0.32)) {
      // 详情区的超长竖图通常是商品细节长图，保留；其余视为横幅 / 长条
      if (!(inDetail && height > width)) return other('横幅 / 长条图');
    }

    if (inGallery) {
      if (hasSize && ratio > 2.8) return other('横幅');
      return product('商品主图 / 缩略图');
    }
    if (inDetail) return product('商品详情 / 试穿图');
    if (alt && POSITIVE_ALT_RE.test(alt)) return product('商品描述图');
    if (source === 'background') return other('背景装饰图');
    if (hasSize && Math.max(width, height) >= 400 && ratio >= 0.45 && ratio <= 2.6) {
      return product('页面大图');
    }
    return other('尺寸或位置不确定');
  }

  function createCollector(base, ctx) {
    const entries = [];
    const seen = new Map();
    const stats = {
      total: 0,
      product: 0,
      other: 0,
      duplicates: 0,
      skippedSmall: 0,
      skippedNoise: 0,
      skippedInvalid: 0
    };

    /**
     * @param {string} raw 原始 URL
     * @param {{source?: string, width?: number, height?: number, alt?: string, element?: Element}} meta
     */
    function add(raw, meta) {
      const url = absoluteUrl(raw, base);
      if (!url) {
        stats.skippedInvalid += 1;
        return;
      }

      const width = Number(meta && meta.width) || 0;
      const height = Number(meta && meta.height) || 0;
      const alt = meta && meta.alt ? String(meta.alt).slice(0, 160) : '';
      const relevance = classifyImage({ ...meta, width, height, alt }, ctx);

      const existing = seen.get(url);
      if (existing) {
        stats.duplicates += 1;
        // 同一个 URL 可能先出现在推荐区、后出现在主图区，只要有一次被判定为商品图就保留
        if (relevance.relevant && !existing.relevant) {
          existing.relevant = true;
          existing.category = 'product';
          existing.reason = relevance.reason;
        }
        if (!existing.width && width) existing.width = width;
        if (!existing.height && height) existing.height = height;
        if (!existing.alt && alt) existing.alt = alt;
        return;
      }

      if (isNoiseUrl(url)) {
        stats.skippedNoise += 1;
        return;
      }
      if (isTooSmall(width, height)) {
        stats.skippedSmall += 1;
        return;
      }
      if (entries.length >= MAX_RAW_ENTRIES) return;

      const entry = {
        url,
        width,
        height,
        source: (meta && meta.source) || 'img',
        alt,
        relevant: relevance.relevant,
        category: relevance.category,
        reason: relevance.reason
      };
      seen.set(url, entry);
      entries.push(entry);
    }

    /** 商品图优先、其他图在后；各自限制数量，避免无关图挤掉商品图 */
    function finish() {
      const product = entries.filter((entry) => entry.relevant).slice(0, MAX_IMAGES);
      const other = entries.filter((entry) => !entry.relevant).slice(0, MAX_OTHER_IMAGES);
      stats.product = product.length;
      stats.other = other.length;
      stats.total = product.length + other.length;
      return product.concat(other);
    }

    return { entries, seen, stats, add, finish };
  }

  /** 扫描页面上的 img / picture / source */
  function collectImgTags(doc, base, collector) {
    const imgs = doc.querySelectorAll('img');
    imgs.forEach((img) => {
      const [width, height] = imageSize(img);
      const alt =
        img.getAttribute('alt') || img.getAttribute('data-alt') || img.getAttribute('title') || '';
      const meta = { width, height, alt, element: img };

      // currentSrc 是浏览器实际选中的地址，优先加入
      if (img.currentSrc) collector.add(img.currentSrc, { ...meta, source: 'currentSrc' });
      if (img.getAttribute('src')) collector.add(img.getAttribute('src'), { ...meta, source: 'src' });
      if (img.getAttribute('srcset')) {
        const best = pickBestSrcset(img.getAttribute('srcset'), base);
        if (best) collector.add(best, { ...meta, source: 'srcset' });
      }
      LAZY_ATTRS.forEach((attr) => {
        const value = img.getAttribute(attr);
        if (!value) return;
        if (attr === 'data-bg') {
          parseBackgroundUrls(value, base).forEach((url) => collector.add(url, { ...meta, source: 'background' }));
        } else if (/srcset/i.test(attr)) {
          const best = pickBestSrcset(value, base);
          if (best) collector.add(best, { ...meta, source: 'lazy-srcset' });
        } else {
          collector.add(value, { ...meta, source: 'lazy' });
        }
      });
    });

    // <picture><source srcset> 以及少数站点把 srcset 放在 picture 上
    doc.querySelectorAll('picture source[srcset], source[data-srcset]').forEach((source) => {
      const best = pickBestSrcset(source.getAttribute('srcset') || source.getAttribute('data-srcset'), base);
      if (best) collector.add(best, { source: 'picture', element: source });
    });
  }

  /** 扫描 background-image：内联样式 + 大尺寸容器的计算样式 */
  function collectBackgroundImages(doc, win, collector) {
    const inline = doc.querySelectorAll(
      '[style*="background"], [data-bg], [data-background], [data-background-image], [data-lazy-bg], [data-bg-src]'
    );
    inline.forEach((el) => {
      let rect = null;
      try {
        rect = el.getBoundingClientRect();
      } catch (e) {
        rect = null;
      }
      const meta = {
        source: 'background',
        element: el,
        width: Math.round(rect ? rect.width : 0),
        height: Math.round(rect ? rect.height : 0)
      };

      const style = el.getAttribute('style') || '';
      parseBackgroundUrls(style, doc.baseURI).forEach((url) => collector.add(url, meta));

      ['data-bg', 'data-background', 'data-background-image', 'data-lazy-bg', 'data-bg-src'].forEach((attr) => {
        const value = el.getAttribute(attr);
        if (!value) return;
        if (/url\(/i.test(value)) {
          parseBackgroundUrls(value, doc.baseURI).forEach((url) => collector.add(url, meta));
        } else {
          collector.add(value, meta);
        }
      });
    });

    if (!win || typeof win.getComputedStyle !== 'function') return;
    const candidates = doc.querySelectorAll('div, section, a, li, figure');
    let checked = 0;
    for (const el of candidates) {
      if (checked >= 800) break;
      let rect;
      try {
        rect = el.getBoundingClientRect();
      } catch (e) {
        continue;
      }
      if (rect.width < MIN_LONG_SIDE || rect.height < MIN_LONG_SIDE) continue;
      // 包含 img 的容器通常已经被 img 扫描覆盖
      if (el.querySelector && el.querySelector('img')) continue;
      let bg = '';
      try {
        bg = win.getComputedStyle(el).backgroundImage;
      } catch (e) {
        continue;
      }
      checked += 1;
      if (!bg || bg === 'none') continue;
      parseBackgroundUrls(bg, doc.baseURI).forEach((url) =>
        collector.add(url, {
          source: 'background',
          element: el,
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        })
      );
    }
  }

  /** 扫描 JSON-LD 里的商品图（淘宝/京东部分页面会输出） */
  function collectJsonLdImages(doc, base, collector) {
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    scripts.forEach((script) => {
      let data;
      try {
        data = JSON.parse(script.textContent || '');
      } catch (e) {
        return;
      }
      const visit = (node, depth) => {
        if (!node || depth > 6) return;
        if (typeof node === 'string') return;
        if (Array.isArray(node)) {
          node.forEach((item) => visit(item, depth + 1));
          return;
        }
        if (typeof node !== 'object') return;
        Object.keys(node).forEach((key) => {
          const value = node[key];
          if (/^(image|images|thumbnailUrl|contentUrl)$/i.test(key)) {
            const list = Array.isArray(value) ? value : [value];
            list.forEach((item) => {
              if (typeof item === 'string') collector.add(item, { source: 'json-ld' });
              else if (item && typeof item === 'object' && typeof item.url === 'string') {
                collector.add(item.url, { source: 'json-ld' });
              }
            });
          }
          if (value && typeof value === 'object') visit(value, depth + 1);
        });
      };
      visit(data, 0);
    });
  }

  /** 扫描 og:image / twitter:image / link[rel=image_src] */
  function collectMetaImages(doc, collector) {
    const selectors = [
      'meta[property="og:image"]',
      'meta[property="og:image:secure_url"]',
      'meta[name="twitter:image"]',
      'link[rel="image_src"]'
    ];
    selectors.forEach((selector) => {
      doc.querySelectorAll(selector).forEach((el) => {
        const value = el.getAttribute('content') || el.getAttribute('href');
        if (value) collector.add(value, { source: 'meta' });
      });
    });
  }

  /**
   * 提取入口。
   * @param {Document} doc
   * @param {Window} win
   * @returns {{images: Array, stats: object}}
   */
  function extractFromDocument(doc, win) {
    const base = (doc && doc.baseURI) || (win && win.location && win.location.href) || '';
    const context = { base, host: '', pathname: '', search: '', productId: '' };
    try {
      const pageUrl = new URL(base);
      context.host = pageUrl.hostname;
      context.pathname = pageUrl.pathname;
      context.search = pageUrl.search;
      context.productId = productIdFromUrlParts(pageUrl.hostname, pageUrl.pathname, pageUrl.search);
    } catch (e) {
      // 非 http(s) 页面不做商品 ID 比对
    }

    const collector = createCollector(base, context);

    const tasks = [
      () => collectImgTags(doc, base, collector),
      () => collectBackgroundImages(doc, win, collector),
      () => collectJsonLdImages(doc, base, collector),
      () => collectMetaImages(doc, collector)
    ];
    tasks.forEach((task) => {
      try {
        task();
      } catch (e) {
        // 单个来源失败不影响整体提取
        console.warn('[ImageGrab] 提取来源失败：', e);
      }
    });

    const images = collector.finish();
    return { images, stats: collector.stats };
  }

  root.IGExtract = {
    MAX_IMAGES,
    MAX_OTHER_IMAGES,
    MIN_LONG_SIDE,
    LAZY_ATTRS,
    PRODUCT_RULES,
    isProductPageUrl,
    productIdFromUrlParts,
    isForeignProductLink,
    classifyImage,
    absoluteUrl,
    parseSrcset,
    pickBestSrcset,
    isNoiseUrl,
    isTooSmall,
    parseBackgroundUrls,
    imageSize,
    extractFromDocument
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
