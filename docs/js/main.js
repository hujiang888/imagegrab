/**
 * 图提取 ImageGrab — 官网交互
 * 纯原生 JS：导航吸顶、移动端菜单、滚动高亮、进入视口动画、截图放大。
 */
(function () {
  'use strict';

  const header = document.querySelector('.site-header');
  const nav = document.getElementById('nav');
  const navToggle = document.getElementById('navToggle');
  const navLinks = Array.from(nav.querySelectorAll('.nav__link'));
  const anchorLinks = Array.from(nav.querySelectorAll('a[href^="#"]'));
  const sections = Array.from(document.querySelectorAll('main section[id]'));
  const revealEls = Array.from(document.querySelectorAll('.reveal'));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------- 年份 ---------------------------- */

  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ------------------------ 导航吸顶阴影 ------------------------ */

  function updateHeader() {
    if (!header) return;
    header.classList.toggle('is-scrolled', window.scrollY > 8);
  }

  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });

  /* --------------------------- 移动端菜单 --------------------------- */

  function setMenu(open) {
    if (!nav || !navToggle) return;
    nav.classList.toggle('is-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
    document.body.classList.toggle('menu-open', open);
  }

  if (navToggle) {
    navToggle.addEventListener('click', () => {
      setMenu(!nav.classList.contains('is-open'));
    });
  }

  anchorLinks.forEach((link) => {
    link.addEventListener('click', () => {
      setMenu(false);
      if (link.classList.contains('nav__link')) {
        navLinks.forEach((item) => item.classList.remove('is-active'));
        link.classList.add('is-active');
      }
    });
  });

  document.addEventListener('click', (event) => {
    if (!nav || !nav.classList.contains('is-open')) return;
    if (nav.contains(event.target) || (navToggle && navToggle.contains(event.target))) return;
    setMenu(false);
  });

  const desktopQuery = window.matchMedia('(min-width: 921px)');
  const onDesktop = (event) => {
    if (event.matches) setMenu(false);
  };
  if (typeof desktopQuery.addEventListener === 'function') {
    desktopQuery.addEventListener('change', onDesktop);
  } else if (typeof desktopQuery.addListener === 'function') {
    desktopQuery.addListener(onDesktop);
  }

  /* --------------------------- 滚动高亮 --------------------------- */

  if ('IntersectionObserver' in window && sections.length) {
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const target = '#' + entry.target.id;
          navLinks.forEach((link) => {
            link.classList.toggle('is-active', link.getAttribute('href') === target);
          });
        });
      },
      { rootMargin: '-42% 0px -50% 0px', threshold: 0 }
    );

    sections.forEach((section) => spy.observe(section));
  }

  /* --------------------------- 进入视口动画 -------------------------- */

  if (!reduceMotion && 'IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -36px 0px' }
    );

    revealEls.forEach((el) => revealObserver.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('is-visible'));
  }

  /* --------------------------- 截图放大 --------------------------- */

  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxClose = document.getElementById('lightboxClose');
  let lastFocus = null;

  function openLightbox(source, alt) {
    if (!lightbox || !lightboxImg || !source) return;
    lastFocus = document.activeElement;
    lightboxImg.src = source;
    lightboxImg.alt = alt || '界面截图大图';
    lightbox.hidden = false;
    document.body.classList.add('no-scroll');
    if (lightboxClose) lightboxClose.focus();
  }

  function closeLightbox() {
    if (!lightbox || lightbox.hidden) return;
    lightbox.hidden = true;
    lightboxImg.removeAttribute('src');
    document.body.classList.remove('no-scroll');
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    lastFocus = null;
  }

  document.querySelectorAll('[data-zoom]').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      const img = trigger.querySelector('img');
      openLightbox(trigger.getAttribute('data-zoom'), img ? img.alt : '');
    });
  });

  if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);

  if (lightbox) {
    lightbox.addEventListener('click', (event) => {
      if (event.target === lightbox) closeLightbox();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    setMenu(false);
    closeLightbox();
  });
})();
