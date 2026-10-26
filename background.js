/**
 * 图提取 ImageGrab — background service worker
 * 职责：接收 content script 的扫描结果、保存并打开画廊、把图片转换成 PNG 后调用下载 API。
 */

const SCAN_PREFIX = 'scan:';
const MAX_SCANS = 5;
const DOWNLOAD_TIMEOUT = 30000;
const FETCH_TIMEOUT = 25000;
const MAX_CANVAS_SIDE = 6000;

const scanStore = chrome.storage.session || chrome.storage.local;

/* -------------------------------------------------------------------- */
/* 基础工具                                                              */
/* -------------------------------------------------------------------- */

function makeId() {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function pad3(number) {
  return String(number).padStart(3, '0');
}

function extensionFromUrl(url) {
  try {
    const match = new URL(url).pathname.match(/\.(jpe?g|png|webp|gif|bmp|avif)$/i);
    if (!match) return 'jpg';
    const ext = match[1].toLowerCase();
    return ext === 'jpeg' ? 'jpg' : ext;
  } catch (e) {
    return 'jpg';
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const chunks = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize)));
  }
  return btoa(chunks.join(''));
}

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  return 'data:' + (blob.type || 'image/png') + ';base64,' + arrayBufferToBase64(buffer);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 兼容不同 Chrome/Edge 版本的徽标 API（部分版本返回 Promise，部分只支持回调） */
function setBadge(tabId, text, color) {
  try {
    if (color) {
      chrome.action.setBadgeBackgroundColor({ color }, () => void chrome.runtime.lastError);
    }
    chrome.action.setBadgeText({ tabId, text }, () => void chrome.runtime.lastError);
  } catch (error) {
    // 某些受限页面（如 edge:// 页面）无法设置徽标，忽略即可
  }
}

/* -------------------------------------------------------------------- */
/* 扫描结果                                                              */
/* -------------------------------------------------------------------- */

async function saveScan(payload, sender) {
  const images = (Array.isArray(payload && payload.images) ? payload.images : [])
    .filter((item) => item && typeof item.url === 'string' && /^https?:\/\//i.test(item.url))
    .slice(0, 400)
    .map((item, index) => ({
      url: item.url,
      width: Number(item.width) || 0,
      height: Number(item.height) || 0,
      source: item.source || 'img',
      alt: item.alt || '',
      relevant: item.relevant !== false,
      category: item.category || (item.relevant === false ? 'other' : 'product'),
      reason: item.reason || '',
      order: index + 1
    }));

  if (!images.length) {
    return { ok: false, error: '没有可展示的图片' };
  }

  const productCount = images.filter((item) => item.relevant).length;

  const scan = {
    id: makeId(),
    images,
    stats: payload.stats || {},
    pageUrl: payload.pageUrl || (sender.tab && sender.tab.url) || '',
    pageTitle: (payload.pageTitle || (sender.tab && sender.tab.title) || '未命名页面').slice(0, 200),
    host: payload.host || (sender.tab && sender.tab.url ? new URL(sender.tab.url).hostname : ''),
    tabId: sender.tab ? sender.tab.id : null,
    scannedAt: Date.now()
  };

  await scanStore.set({ [SCAN_PREFIX + scan.id]: scan });
  pruneScans().catch(() => {});

  if (sender.tab && sender.tab.id != null) {
    const badgeCount = productCount || images.length;
    setBadge(sender.tab.id, badgeCount > 99 ? '99+' : String(badgeCount), '#4F7CFF');
  }

  await chrome.tabs.create({
    url: chrome.runtime.getURL('gallery.html?scan=' + scan.id),
    active: true
  });

  return { ok: true, id: scan.id, count: productCount, total: images.length };
}

async function pruneScans() {
  const all = await scanStore.get(null);
  const keys = Object.keys(all).filter((key) => key.startsWith(SCAN_PREFIX));
  if (keys.length <= MAX_SCANS) return;
  keys.sort((a, b) => ((all[a] && all[a].scannedAt) || 0) - ((all[b] && all[b].scannedAt) || 0));
  const remove = keys.slice(0, keys.length - MAX_SCANS);
  if (remove.length) await scanStore.remove(remove);
}

async function rescanPrevious(body) {
  const tabId = Number(body && body.tabId);
  if (!tabId) return { ok: false, error: '找不到原始页面' };
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'IG_FORCE_SCAN' });
    return response || { ok: true };
  } catch (error) {
    return { ok: false, error: '原始页面已关闭或已刷新，请回到商品页重新获取' };
  }
}

/* -------------------------------------------------------------------- */
/* 下载                                                                  */
/* -------------------------------------------------------------------- */

/** 带超时的图片请求；先匿名请求，失败后再带 Cookie 重试 */
async function fetchImage(url) {
  const attempts = [
    { credentials: 'omit', cache: 'force-cache' },
    { credentials: 'include', cache: 'force-cache' }
  ];
  let lastError = null;

  for (const options of attempts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('图片下载失败');
}

/** 将任意图片 Blob 通过 canvas 转成 PNG（最长边限制 6000，防止内存爆掉） */
async function convertBlobToPng(blob) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (error) {
    throw new Error('当前图片格式无法解码');
  }

  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (!longest) throw new Error('图片尺寸无效');
    const scale = Math.min(1, MAX_CANVAS_SIDE / longest);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建画布');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    // PNG 保留透明通道
    context.drawImage(bitmap, 0, 0, width, height);

    const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
    return await blobToDataUrl(pngBlob);
  } finally {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}

/** 等待 chrome.downloads 的某次下载结束 */
function waitForDownload(downloadId) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = 0;

    const finish = (state) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(listener);
      resolve(state);
    };

    const listener = (delta) => {
      if (delta.id !== downloadId) return;
      if (delta.error && delta.error.current) finish('interrupted');
      const nextState = delta.state && delta.state.current;
      // 只有明确的终态才结束等待；in_progress 等中间状态不处理
      if (nextState === 'complete') finish('complete');
      else if (nextState === 'interrupted') finish('interrupted');
    };

    timer = setTimeout(() => finish('timeout'), DOWNLOAD_TIMEOUT);
    chrome.downloads.onChanged.addListener(listener);

    chrome.downloads.search({ id: downloadId }, (items) => {
      const item = items && items[0];
      if (!item) return;
      if (item.state === 'complete') finish('complete');
      if (item.state === 'interrupted') finish('interrupted');
    });
  });
}

async function getDownloadPath(downloadId) {
  try {
    const items = await chrome.downloads.search({ id: downloadId });
    return items && items[0] ? items[0].filename : '';
  } catch (e) {
    return '';
  }
}

/**
 * 下载单张图片为 PNG。
 * 优先在后台 fetch + canvas 转 PNG；源站限制时退回「原格式直链下载」，保证用户至少拿到图片。
 */
async function downloadOne(body) {
  const url = body && body.url;
  const order = Math.max(1, Number(body && body.index) || 1);
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: '图片地址无效' };
  }

  const pngName = '商品图_' + pad3(order) + '.png';
  let blob = null;

  try {
    const response = await fetchImage(url);
    blob = await response.blob();
  } catch (error) {
    blob = null;
  }

  if (blob && blob.type && blob.type.startsWith('image/') && blob.type !== 'image/svg+xml') {
    // 已经是 PNG：直接按原文件下载，无损且更快
    if (blob.type === 'image/png') {
      try {
        const downloadId = await chrome.downloads.download({
          url,
          filename: pngName,
          conflictAction: 'uniquify',
          saveAs: false
        });
        const result = await waitForDownload(downloadId);
        if (result === 'complete' || result === 'timeout') {
          return { ok: true, mode: 'png', filename: pngName, path: await getDownloadPath(downloadId) };
        }
      } catch (error) {
        // 继续尝试 data URL 方案
      }
    }

    try {
      const dataUrl = await convertBlobToPng(blob);
      const downloadId = await chrome.downloads.download({
        url: dataUrl,
        filename: pngName,
        conflictAction: 'uniquify',
        saveAs: false
      });
      const result = await waitForDownload(downloadId);
      if (result === 'complete' || result === 'timeout') {
        return { ok: true, mode: 'png', filename: pngName, path: await getDownloadPath(downloadId) };
      }
    } catch (error) {
      // 转 PNG 失败，走原格式兜底
    }
  }

  // 兜底：直接下载原图（保留真实扩展名，避免生成打不开的 .png）
  const fallbackName = '商品图_' + pad3(order) + '.' + extensionFromUrl(url);
  try {
    const downloadId = await chrome.downloads.download({
      url,
      filename: fallbackName,
      conflictAction: 'uniquify',
      saveAs: false
    });
    const result = await waitForDownload(downloadId);
    if (result === 'complete' || result === 'timeout') {
      return {
        ok: true,
        mode: 'original',
        filename: fallbackName,
        path: await getDownloadPath(downloadId),
        warning: '源站限制跨域读取，已按原格式下载'
      };
    }
    return { ok: false, error: '下载未完成' };
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : '下载失败' };
  }
}

/* -------------------------------------------------------------------- */
/* 工具栏图标点击：在任意页面强制提取                                     */
/* -------------------------------------------------------------------- */

function flashBadge(tabId, text) {
  setBadge(tabId, text, '#EF4444');
  setTimeout(() => setBadge(tabId, '', '#4F7CFF'), 3000);
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || tab.id == null) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'IG_FORCE_SCAN' });
    return;
  } catch (error) {
    // content script 尚未注入（非受支持站点），用 activeTab 权限现场注入
  }

  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/extract-core.js', 'content.js']
    });
    await sleep(80);
    await chrome.tabs.sendMessage(tab.id, { type: 'IG_FORCE_SCAN' });
  } catch (error) {
    await flashBadge(tab.id, '!');
  }
});

/* -------------------------------------------------------------------- */
/* 消息路由                                                              */
/* -------------------------------------------------------------------- */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return undefined;

  let task = null;
  switch (message.type) {
    case 'IG_SCAN_RESULT':
      task = saveScan(message.payload, sender);
      break;
    case 'IG_DOWNLOAD_ONE':
      task = downloadOne(message);
      break;
    case 'IG_RESCAN':
      task = rescanPrevious(message);
      break;
    case 'IG_PING':
      sendResponse({ ok: true });
      return undefined;
    default:
      return undefined;
  }

  task
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ ok: false, error: error && error.message ? error.message : String(error) }));

  return true;
});

/* 刷新 / 跳转时清掉该标签页上的数量徽标 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    setBadge(tabId, '');
  }
});
