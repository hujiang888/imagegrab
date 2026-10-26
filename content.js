/**
 * 图提取 ImageGrab — content script
 * 注入右下角悬浮按钮，提取当前详情页图片并把结果交给 background。
 */
(function () {
  'use strict';

  if (window.__IMAGEGRAB_CONTENT_LOADED__) return;
  window.__IMAGEGRAB_CONTENT_LOADED__ = true;

  const state = {
    widget: null,
    fab: null,
    toastEl: null,
    countEl: null,
    loading: false,
    forced: false,
    hidden: false,
    lastUrl: location.href
  };

  /* ------------------------------------------------------------------ */
  /* 页面类型识别：只在商品详情页自动显示按钮                              */
  /* ------------------------------------------------------------------ */

  /** 一些商城会把详情页放在 show.taobao / item.pinduoduo 等域名，用通用特征兜底 */
  function hasProductSignals() {
    const ogType = document.querySelector('meta[property="og:type"]');
    if (ogType && /product/i.test(ogType.getAttribute('content') || '')) return true;
    if (document.querySelector('[itemtype*="schema.org/Product"]')) return true;
    const ld = document.querySelectorAll('script[type="application/ld+json"]');
    for (const node of ld) {
      if (/"@type"\s*:\s*"Product"/i.test(node.textContent || '')) return true;
    }
    return false;
  }

  function isProductPage() {
    const host = location.hostname;
    const path = location.pathname + location.search;
    if (IGExtract.isProductPageUrl(host, path)) return true;
    // 兜底：只在受支持站点上检查商品结构化数据
    const supported = /(^|\.)(taobao|tmall|jd|pinduoduo|yangkeduo)\.com$/i.test(host);
    return supported && hasProductSignals();
  }

  /* ------------------------------------------------------------------ */
  /* UI                                                                  */
  /* ------------------------------------------------------------------ */

  const ICON_IMAGE = `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" stroke-width="1.8"/>
      <circle cx="8.6" cy="9.4" r="1.6" fill="currentColor"/>
      <path d="M4.5 17.2l4.4-4.4 3.2 3.2 2.3-2.3 4.6 4.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

  const ICON_DOWNLOAD = `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path d="M12 4v10m0 0l-4-4m4 4l4-4M5 19h14" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

  function createWidget() {
    if (state.widget) return state.widget;

    const wrap = document.createElement('div');
    wrap.id = 'imagegrab-widget';
    wrap.innerHTML = `
      <div class="ig-toast" role="status" aria-live="polite"></div>
      <button class="ig-fab" id="imagegrab-fab" type="button" title="提取当前页面的商品图片">
        <span class="ig-fab__icon">${ICON_IMAGE}</span>
        <span class="ig-fab__spinner" aria-hidden="true"></span>
        <span class="ig-fab__text">获取图片</span>
        <span class="ig-fab__count" hidden></span>
      </button>
      <button class="ig-close" type="button" title="本次隐藏（点击扩展图标可再次唤起）" aria-label="隐藏获取图片按钮">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
        </svg>
      </button>`;

    document.documentElement.appendChild(wrap);

    state.widget = wrap;
    state.fab = wrap.querySelector('.ig-fab');
    state.toastEl = wrap.querySelector('.ig-toast');
    state.countEl = wrap.querySelector('.ig-fab__count');

    state.fab.addEventListener('click', () => {
      runScan();
    });
    wrap.querySelector('.ig-close').addEventListener('click', (event) => {
      event.stopPropagation();
      state.hidden = true;
      wrap.classList.add('ig-hidden');
      showToast('已隐藏，点击浏览器工具栏的「图提取」图标可再次显示');
    });

    return wrap;
  }

  function ensureWidget(force) {
    if (force) state.forced = true;
    const widget = createWidget();
    if (state.hidden) {
      state.hidden = false;
      widget.classList.remove('ig-hidden');
    }
    widget.classList.add('ig-visible');
    return widget;
  }

  function setLoading(loading) {
    state.loading = loading;
    if (!state.fab) return;
    state.fab.disabled = loading;
    state.fab.classList.toggle('is-loading', loading);
    state.fab.querySelector('.ig-fab__text').textContent = loading ? '提取中…' : '获取图片';
  }

  function setCount(count) {
    if (!state.countEl) return;
    if (count > 0) {
      state.countEl.hidden = false;
      state.countEl.textContent = count > 99 ? '99+' : String(count);
    } else {
      state.countEl.hidden = true;
    }
  }

  let toastTimer = 0;
  function showToast(message, type) {
    if (!state.toastEl) return;
    clearTimeout(toastTimer);
    state.toastEl.textContent = message;
    state.toastEl.className = 'ig-toast is-visible' + (type ? ' ig-toast--' + type : '');
    toastTimer = setTimeout(() => {
      state.toastEl.className = 'ig-toast';
    }, 3200);
  }

  /* ------------------------------------------------------------------ */
  /* 扫描与消息                                                          */
  /* ------------------------------------------------------------------ */

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  async function runScan() {
    if (state.loading) return { ok: false, error: '正在提取中，请稍候' };

    setLoading(true);
    showToast('正在扫描页面图片…');
    // 让按钮的 loading 状态先渲染出来
    await nextFrame();

    let result;
    try {
      result = IGExtract.extractFromDocument(document, window);
    } catch (error) {
      setLoading(false);
      showToast('提取失败：' + (error && error.message ? error.message : '未知错误'), 'error');
      return { ok: false, error: String(error) };
    }

    const count = result.images.length;
    if (!count) {
      setLoading(false);
      showToast('没有找到可下载的商品图，试试滚动页面加载更多图片', 'error');
      return { ok: false, error: 'empty' };
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'IG_SCAN_RESULT',
        payload: {
          images: result.images,
          stats: result.stats,
          pageUrl: location.href,
          pageTitle: document.title,
          host: location.hostname
        }
      });
      if (!response || !response.ok) {
        throw new Error((response && response.error) || '后台没有响应');
      }
      setCount(count);
      showToast(`已提取 ${count} 张图片，正在打开画廊…`, 'success');
      return { ok: true, count, scanId: response.id };
    } catch (error) {
      showToast('无法打开图片画廊，请刷新页面后重试', 'error');
      return { ok: false, error: String(error) };
    } finally {
      setLoading(false);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return undefined;

    if (message.type === 'IG_FORCE_SCAN') {
      ensureWidget(true);
      runScan().then((result) => sendResponse(result));
      return true;
    }

    if (message.type === 'IG_PING') {
      sendResponse({ ok: true, productPage: isProductPage() });
      return true;
    }

    return undefined;
  });

  /* ------------------------------------------------------------------ */
  /* 启动 & 单页应用路由监听                                             */
  /* ------------------------------------------------------------------ */

  function boot() {
    if (isProductPage()) {
      ensureWidget(false);
    } else if (state.widget && !state.forced) {
      state.widget.classList.remove('ig-visible');
    }
  }

  boot();

  // 电商站点大量使用前端路由，URL 变化后补一次判断
  setInterval(() => {
    if (location.href === state.lastUrl) return;
    state.lastUrl = location.href;
    state.forced = false;
    state.hidden = false;
    if (state.widget) state.widget.classList.remove('ig-hidden');
    boot();
  }, 1500);
})();
