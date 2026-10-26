/**
 * 图提取 ImageGrab — 画廊页逻辑
 * 读取 background 保存的扫描结果，负责展示、筛选、勾选、预览与批量下载。
 */
(function () {
  'use strict';

  const store = chrome.storage.session || chrome.storage.local;
  const params = new URLSearchParams(location.search);

  const els = {
    metaText: document.getElementById('metaText'),
    toolbar: document.getElementById('toolbar'),
    filterNote: document.getElementById('filterNote'),
    grid: document.getElementById('grid'),
    empty: document.getElementById('empty'),
    actionbar: document.getElementById('actionbar'),
    selectedCount: document.getElementById('selectedCount'),
    selectAll: document.getElementById('selectAll'),
    selectVisibleBtn: document.getElementById('selectVisibleBtn'),
    invertBtn: document.getElementById('invertBtn'),
    clearBtn: document.getElementById('clearBtn'),
    scopeButtons: Array.from(document.querySelectorAll('.segmented__btn[data-scope]')),
    sizeFilter: document.getElementById('sizeFilter'),
    sortOrder: document.getElementById('sortOrder'),
    downloadBtn: document.getElementById('downloadBtn'),
    rescanBtn: document.getElementById('rescanBtn'),
    helpBtn: document.getElementById('helpBtn'),
    emptyHelpBtn: document.getElementById('emptyHelpBtn'),
    helpModal: document.getElementById('helpModal'),
    helpClose: document.getElementById('helpClose'),
    progress: document.getElementById('progress'),
    progressTitle: document.getElementById('progressTitle'),
    progressCount: document.getElementById('progressCount'),
    progressBar: document.getElementById('progressBar'),
    progressFill: document.getElementById('progressFill'),
    progressFile: document.getElementById('progressFile'),
    progressStats: document.getElementById('progressStats'),
    cancelBtn: document.getElementById('cancelBtn'),
    openFolderBtn: document.getElementById('openFolderBtn'),
    closeProgressBtn: document.getElementById('closeProgressBtn'),
    lightbox: document.getElementById('lightbox'),
    lightboxImg: document.getElementById('lightboxImg'),
    lightboxMeta: document.getElementById('lightboxMeta'),
    lightboxOpen: document.getElementById('lightboxOpen'),
    lightboxClose: document.getElementById('lightboxClose'),
    lightboxPrev: document.getElementById('lightboxPrev'),
    lightboxNext: document.getElementById('lightboxNext'),
    lightboxDownload: document.getElementById('lightboxDownload'),
    toasts: document.getElementById('toasts')
  };

  const state = {
    scan: null,
    selected: new Set(),
    scope: 'product',
    filter: 0,
    sort: 'page',
    visible: [],
    lightboxIndex: -1,
    downloading: false,
    cancelled: false,
    lastFocus: null
  };

  /* ------------------------------------------------------------------ */
  /* 工具                                                                */
  /* ------------------------------------------------------------------ */

  function escapeAttr(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function pad3(value) {
    return String(value).padStart(3, '0');
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function formatTime(timestamp) {
    const date = new Date(timestamp || Date.now());
    return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function formatOf(url) {
    try {
      const match = new URL(url).pathname.match(/\.(jpe?g|png|webp|gif|bmp|avif)$/i);
      if (!match) return 'IMG';
      return match[1].toUpperCase().replace('JPEG', 'JPG');
    } catch (error) {
      return 'IMG';
    }
  }

  /** 兼容旧版本扫描记录：没有 relevant 字段时视为商品图 */
  function isProductImage(image) {
    return Boolean(image) && image.relevant !== false;
  }

  function countProductImages(images) {
    return (Array.isArray(images) ? images : []).filter(isProductImage).length;
  }

  function toast(message, type, duration) {
    const el = document.createElement('div');
    el.className = 'toast' + (type && type !== 'info' ? ' toast--' + type : '');
    el.textContent = message;
    els.toasts.appendChild(el);
    setTimeout(() => {
      el.classList.add('toast--leaving');
      setTimeout(() => el.remove(), 220);
    }, duration || 3000);
  }

  /* ------------------------------------------------------------------ */
  /* 读取扫描数据                                                        */
  /* ------------------------------------------------------------------ */

  async function loadScan() {
    let all;
    try {
      all = await store.get(null);
    } catch (error) {
      return null;
    }
    if (!all) return null;

    const wanted = params.get('scan');
    if (wanted && all['scan:' + wanted]) return all['scan:' + wanted];

    const scans = Object.keys(all)
      .filter((key) => key.indexOf('scan:') === 0)
      .map((key) => all[key])
      .filter((item) => item && Array.isArray(item.images) && item.images.length)
      .sort((a, b) => (b.scannedAt || 0) - (a.scannedAt || 0));

    return scans[0] || null;
  }

  function renderMeta() {
    const scan = state.scan;
    const host = String(scan.host || '').replace(/^www\./i, '');
    const productCount = countProductImages(scan.images);
    const otherCount = scan.images.length - productCount;
    els.metaText.innerHTML =
      `<span class="meta-strong">${escapeAttr(host)}</span>` +
      `<span class="meta-sep">·</span>${productCount} 张商品图` +
      `<span class="meta-sep">·</span>${escapeAttr(formatTime(scan.scannedAt))}`;

    const stats = scan.stats || {};
    const skipped = (stats.skippedSmall || 0) + (stats.skippedNoise || 0);
    const notes = [];
    if (otherCount > 0) {
      notes.push(
        state.scope === 'all' ? `包含 ${otherCount} 张可能无关的图片` : `已过滤 ${otherCount} 张无关图片`
      );
    }
    if (skipped > 0) notes.push(`${skipped} 张图标 / 小图已排除`);
    if (notes.length) {
      els.filterNote.hidden = false;
      els.filterNote.textContent = notes.join(' · ');
    } else {
      els.filterNote.hidden = true;
    }
  }

  /* ------------------------------------------------------------------ */
  /* 渲染                                                                */
  /* ------------------------------------------------------------------ */

  function getVisibleItems() {
    let items = state.scan.images.map((image, index) => ({ image, index }));
    if (state.scope === 'product') {
      items = items.filter(({ image }) => isProductImage(image));
    }
    const filtered = state.filter
      ? items.filter(({ image }) => {
          const w = Number(image.width) || 0;
          const h = Number(image.height) || 0;
          if (!w || !h) return true; // 尺寸未知时先展示，加载后再判断
          return Math.max(w, h) >= state.filter;
        })
      : items;

    if (state.sort === 'large' || state.sort === 'small') {
      const direction = state.sort === 'large' ? -1 : 1;
      filtered.sort((a, b) => {
        const areaA = (Number(a.image.width) || 0) * (Number(a.image.height) || 0);
        const areaB = (Number(b.image.width) || 0) * (Number(b.image.height) || 0);
        if (areaA === areaB) return a.index - b.index;
        return (areaA - areaB) * direction;
      });
    }
    return filtered;
  }

  function createCard(image, index) {
    const card = document.createElement('article');
    const productImage = isProductImage(image);
    card.className = 'card' + (state.selected.has(index) ? ' is-selected' : '') + (productImage ? '' : ' is-other');
    card.dataset.index = String(index);

    const hasSize = Number(image.width) > 0 && Number(image.height) > 0;
    const dimsText = hasSize ? `${image.width} × ${image.height}` : '加载中…';
    const alt = image.alt || '商品图片 ' + (index + 1);
    const flag = productImage
      ? ''
      : `<span class="card__flag" title="${escapeAttr(image.reason || '未识别为商品图')}">无关</span>`;

    card.innerHTML = `
      <label class="card__check" title="选择这张图片">
        <input type="checkbox" ${state.selected.has(index) ? 'checked' : ''} aria-label="选择第 ${index + 1} 张图片" />
        <span class="card__checkbox"></span>
      </label>
      ${flag}
      <button class="card__thumb" type="button" aria-label="预览第 ${index + 1} 张图片">
        <img src="${escapeAttr(image.url)}" alt="${escapeAttr(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
        <span class="card__zoom">预览</span>
      </button>
      <div class="card__meta">
        <span class="card__dims" data-dims>${dimsText}</span>
        <span class="card__format">${formatOf(image.url)}</span>
      </div>`;

    const input = card.querySelector('input');
    input.addEventListener('change', () => {
      setSelected(index, input.checked);
    });

    const thumb = card.querySelector('.card__thumb');
    const img = card.querySelector('img');

    thumb.addEventListener('click', () => openLightbox(index));

    img.addEventListener('load', () => {
      img.classList.add('is-loaded');
      const width = img.naturalWidth || 0;
      const height = img.naturalHeight || 0;
      if (width && height) {
        image.width = width;
        image.height = height;
        card.querySelector('[data-dims]').textContent = `${width} × ${height}`;
        if (state.filter && Math.max(width, height) < state.filter) {
          card.hidden = true;
          if (state.selected.has(index)) setSelected(index, false);
          updateActionbar();
        }
      }
    });

    img.addEventListener('error', () => {
      thumb.classList.add('is-broken');
      img.style.visibility = 'hidden';
    });

    return card;
  }

  function renderGrid() {
    state.visible = getVisibleItems();
    els.grid.innerHTML = '';
    const fragment = document.createDocumentFragment();
    state.visible.forEach(({ image, index }) => fragment.appendChild(createCard(image, index)));
    els.grid.appendChild(fragment);
    updateActionbar();
  }

  function updateScopeButtons() {
    els.scopeButtons.forEach((button) => {
      const active = button.dataset.scope === state.scope;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function setScope(scope) {
    if (scope !== 'product' && scope !== 'all') return;
    if (scope === state.scope) return;

    state.scope = scope;
    // 切回“商品图”时，取消已选中的无关图片，避免误下载
    if (scope === 'product' && state.scan) {
      state.scan.images.forEach((image, index) => {
        if (!isProductImage(image)) state.selected.delete(index);
      });
    }
    updateScopeButtons();
    renderMeta();
    renderGrid();
  }

  /* ------------------------------------------------------------------ */
  /* 选择                                                                */
  /* ------------------------------------------------------------------ */

  function setSelected(index, checked) {
    if (checked) state.selected.add(index);
    else state.selected.delete(index);

    const card = els.grid.querySelector(`.card[data-index="${index}"]`);
    if (card) {
      card.classList.toggle('is-selected', checked);
      const input = card.querySelector('input');
      if (input) input.checked = checked;
    }
    updateActionbar();
  }

  function getSelectableIndices() {
    return Array.from(els.grid.querySelectorAll('.card:not([hidden])')).map((card) =>
      Number(card.dataset.index)
    );
  }

  function applySelection(indices, checked) {
    indices.forEach((index) => {
      if (checked) state.selected.add(index);
      else state.selected.delete(index);
    });
    indices.forEach((index) => {
      const card = els.grid.querySelector(`.card[data-index="${index}"]`);
      if (!card) return;
      card.classList.toggle('is-selected', checked);
      const input = card.querySelector('input');
      if (input) input.checked = checked;
    });
    updateActionbar();
  }

  function updateActionbar() {
    els.selectedCount.textContent = String(state.selected.size);
    els.downloadBtn.disabled = state.selected.size === 0 || state.downloading;
    els.clearBtn.disabled = state.selected.size === 0;
    els.invertBtn.disabled = getSelectableIndices().length === 0;

    const selectable = getSelectableIndices();
    const selectedVisible = selectable.filter((index) => state.selected.has(index));
    els.selectAll.checked = selectable.length > 0 && selectedVisible.length === selectable.length;
    els.selectAll.indeterminate =
      selectedVisible.length > 0 && selectedVisible.length < selectable.length;
  }

  /** 下载顺序：先按当前展示顺序，再补上被筛选隐藏的已选项 */
  function getDownloadIndices() {
    const order = new Map();
    state.visible.forEach((item, position) => order.set(item.index, position));
    return Array.from(state.selected).sort((a, b) => {
      const posA = order.has(a) ? order.get(a) : Number.MAX_SAFE_INTEGER;
      const posB = order.has(b) ? order.get(b) : Number.MAX_SAFE_INTEGER;
      if (posA === posB) return a - b;
      return posA - posB;
    });
  }

  /* ------------------------------------------------------------------ */
  /* 下载                                                                */
  /* ------------------------------------------------------------------ */

  function setProgress(done, total, title, file, ok, fail) {
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    els.progressFill.style.width = percent + '%';
    els.progressBar.setAttribute('aria-valuenow', String(percent));
    els.progressCount.textContent = `${done} / ${total}`;
    els.progressTitle.textContent = title;
    els.progressFile.textContent = file || '';
    els.progressStats.textContent = `成功 ${ok} · 失败 ${fail}`;
  }

  async function startDownload(indices) {
    if (state.downloading || !indices.length || !state.scan) return;

    state.downloading = true;
    state.cancelled = false;
    els.actionbar.hidden = true;
    els.progress.hidden = false;
    els.openFolderBtn.hidden = true;
    els.closeProgressBtn.hidden = true;
    els.cancelBtn.hidden = false;
    els.cancelBtn.disabled = false;
    els.cancelBtn.textContent = '取消';
    setProgress(0, indices.length, '准备下载…', '', 0, 0);

    let ok = 0;
    let fail = 0;
    let original = 0;

    for (let i = 0; i < indices.length; i += 1) {
      if (state.cancelled) break;

      const image = state.scan.images[indices[i]];
      if (!image) {
        fail += 1;
        continue;
      }

      const fileName = `商品图_${pad3(i + 1)}.png`;
      setProgress(i, indices.length, `正在转换第 ${i + 1} 张为 PNG…`, fileName, ok, fail);

      let result = null;
      try {
        result = await chrome.runtime.sendMessage({
          type: 'IG_DOWNLOAD_ONE',
          url: image.url,
          index: i + 1,
          pageUrl: state.scan.pageUrl
        });
      } catch (error) {
        result = { ok: false, error: error && error.message ? error.message : '扩展连接失败' };
      }

      if (result && result.ok) {
        ok += 1;
        if (result.mode === 'original') original += 1;
      } else {
        fail += 1;
        console.warn('[ImageGrab] 下载失败：', image.url, result && result.error);
      }

      setProgress(i + 1, indices.length, '正在下载…', fileName, ok, fail);
    }

    state.downloading = false;

    const cancelled = state.cancelled;
    const finished = ok + fail;
    els.progressTitle.textContent = cancelled
      ? '已取消下载'
      : fail === 0
      ? '全部下载完成'
      : '下载完成（部分失败）';
    els.progressCount.textContent = `${finished} / ${indices.length}`;
    els.progressFile.textContent =
      original > 0 ? `其中 ${original} 张源站限制，已按原格式保存` : '文件已保存到浏览器默认下载目录';
    els.progressStats.textContent = `成功 ${ok} · 失败 ${fail}`;
    els.progressFill.style.width =
      indices.length > 0 ? Math.round((finished / indices.length) * 100) + '%' : '0%';
    els.cancelBtn.hidden = true;
    els.closeProgressBtn.hidden = false;
    els.openFolderBtn.hidden = ok === 0;

    if (cancelled) {
      toast(`已取消，成功下载 ${ok} 张`, 'info');
    } else if (ok === 0) {
      toast('下载失败，请检查网络或图片权限后重试', 'error');
    } else if (fail > 0) {
      toast(`成功 ${ok} 张，失败 ${fail} 张`, 'error', 4000);
    } else {
      toast(`已下载 ${ok} 张 PNG 图片`, 'success');
    }
  }

  /* ------------------------------------------------------------------ */
  /* 预览                                                                */
  /* ------------------------------------------------------------------ */

  function updateLightbox() {
    const image = state.scan.images[state.lightboxIndex];
    if (!image) return;
    els.lightboxImg.src = image.url;
    els.lightboxImg.alt = image.alt || '商品图片';
    els.lightboxOpen.href = image.url;
    els.lightboxMeta.textContent = `${state.lightboxIndex + 1} / ${state.scan.images.length} · ${
      image.width ? image.width + ' × ' + image.height : '尺寸未知'
    } · ${formatOf(image.url)}`;
    els.lightboxPrev.disabled = state.lightboxIndex <= 0;
    els.lightboxNext.disabled = state.lightboxIndex >= state.scan.images.length - 1;
  }

  function openLightbox(index) {
    if (!state.scan || !state.scan.images[index]) return;
    state.lightboxIndex = index;
    state.lastFocus = document.activeElement;
    updateLightbox();
    els.lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
    els.lightboxClose.focus();
  }

  function closeLightbox() {
    if (els.lightbox.hidden) return;
    els.lightbox.hidden = true;
    els.lightboxImg.removeAttribute('src');
    document.body.style.overflow = '';
    state.lightboxIndex = -1;
    if (state.lastFocus && typeof state.lastFocus.focus === 'function') state.lastFocus.focus();
  }

  function stepLightbox(delta) {
    if (els.lightbox.hidden || !state.scan) return;
    const next = state.lightboxIndex + delta;
    if (next < 0 || next >= state.scan.images.length) return;
    state.lightboxIndex = next;
    updateLightbox();
  }

  /* ------------------------------------------------------------------ */
  /* 说明弹窗                                                            */
  /* ------------------------------------------------------------------ */

  function openHelp() {
    els.helpModal.hidden = false;
    document.body.style.overflow = 'hidden';
    els.helpClose.focus();
  }

  function closeHelp() {
    els.helpModal.hidden = true;
    if (els.lightbox.hidden) document.body.style.overflow = '';
  }

  /* ------------------------------------------------------------------ */
  /* 事件绑定                                                            */
  /* ------------------------------------------------------------------ */

  function bindEvents() {
    els.scopeButtons.forEach((button) => {
      button.addEventListener('click', () => setScope(button.dataset.scope));
    });

    els.selectAll.addEventListener('change', () => {
      applySelection(getSelectableIndices(), els.selectAll.checked);
    });

    els.selectVisibleBtn.addEventListener('click', () => {
      applySelection(getSelectableIndices(), true);
    });

    els.invertBtn.addEventListener('click', () => {
      const indices = getSelectableIndices();
      indices.forEach((index) => {
        if (state.selected.has(index)) state.selected.delete(index);
        else state.selected.add(index);
      });
      indices.forEach((index) => {
        const card = els.grid.querySelector(`.card[data-index="${index}"]`);
        if (!card) return;
        const checked = state.selected.has(index);
        card.classList.toggle('is-selected', checked);
        const input = card.querySelector('input');
        if (input) input.checked = checked;
      });
      updateActionbar();
    });

    els.clearBtn.addEventListener('click', () => {
      applySelection(Array.from(state.selected), false);
    });

    els.downloadBtn.addEventListener('click', () => {
      startDownload(getDownloadIndices());
    });

    els.sizeFilter.addEventListener('change', () => {
      state.filter = Number(els.sizeFilter.value) || 0;
      renderGrid();
    });

    els.sortOrder.addEventListener('change', () => {
      state.sort = els.sortOrder.value;
      renderGrid();
    });

    els.rescanBtn.addEventListener('click', async () => {
      if (!state.scan) return;
      const label = els.rescanBtn.querySelector('span');
      els.rescanBtn.disabled = true;
      if (label) label.textContent = '扫描中…';
      try {
        const result = await chrome.runtime.sendMessage({
          type: 'IG_RESCAN',
          tabId: state.scan.tabId
        });
        if (result && result.ok) {
          toast('已在原页面重新提取，稍后将打开新画廊', 'success');
        } else {
          toast((result && result.error) || '重新获取失败', 'error', 4000);
        }
      } catch (error) {
        toast('无法连接扩展后台，请刷新页面重试', 'error');
      } finally {
        setTimeout(() => {
          els.rescanBtn.disabled = false;
          if (label) label.textContent = '重新获取';
        }, 1200);
      }
    });

    els.helpBtn.addEventListener('click', openHelp);
    els.emptyHelpBtn.addEventListener('click', openHelp);
    els.helpClose.addEventListener('click', closeHelp);
    els.helpModal.querySelector('[data-close="help"]').addEventListener('click', closeHelp);

    els.cancelBtn.addEventListener('click', () => {
      if (!state.downloading) return;
      state.cancelled = true;
      els.cancelBtn.disabled = true;
      els.cancelBtn.textContent = '正在停止…';
      els.progressTitle.textContent = '正在停止下载…';
    });

    els.closeProgressBtn.addEventListener('click', () => {
      els.progress.hidden = true;
      els.actionbar.hidden = false;
      updateActionbar();
    });

    els.openFolderBtn.addEventListener('click', () => {
      try {
        chrome.downloads.showDefaultFolder();
      } catch (error) {
        toast('无法打开下载文件夹，请手动打开系统下载目录', 'error');
      }
    });

    els.lightboxClose.addEventListener('click', closeLightbox);
    els.lightboxPrev.addEventListener('click', () => stepLightbox(-1));
    els.lightboxNext.addEventListener('click', () => stepLightbox(1));
    els.lightbox.addEventListener('click', (event) => {
      if (event.target === els.lightbox) closeLightbox();
    });
    els.lightboxDownload.addEventListener('click', () => {
      const index = state.lightboxIndex;
      closeLightbox();
      if (index >= 0) startDownload([index]);
    });

    document.addEventListener('keydown', (event) => {
      const tag = event.target && event.target.tagName;
      const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

      if (event.key === 'Escape') {
        if (!els.lightbox.hidden) closeLightbox();
        else if (!els.helpModal.hidden) closeHelp();
        return;
      }

      if (!els.lightbox.hidden) {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          stepLightbox(-1);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          stepLightbox(1);
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && !typing && String(event.key).toLowerCase() === 'a') {
        if (!state.scan) return;
        event.preventDefault();
        applySelection(getSelectableIndices(), true);
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* 启动                                                                */
  /* ------------------------------------------------------------------ */

  async function init() {
    bindEvents();
    const scan = await loadScan();

    if (!scan) {
      els.empty.hidden = false;
      els.toolbar.hidden = true;
      els.actionbar.hidden = true;
      return;
    }

    state.scan = scan;
    document.title = `${scan.pageTitle || '商品详情页'} · 图提取`;

    // 一页里没有任何可识别的商品图时，退化为“全部”，避免用户看到空画廊
    if (countProductImages(scan.images) === 0 && scan.images.length > 0) {
      state.scope = 'all';
      updateScopeButtons();
      toast('没有识别到明确的商品图，已显示全部图片', 'info', 4500);
    }

    renderMeta();
    renderGrid();
    els.toolbar.hidden = false;
    els.actionbar.hidden = false;
    els.empty.hidden = true;
  }

  init().catch((error) => {
    console.error('[ImageGrab] 画廊初始化失败：', error);
    els.empty.hidden = false;
    els.toolbar.hidden = true;
    els.actionbar.hidden = true;
    toast('读取图片数据失败，请重新提取', 'error', 5000);
  });
})();
