/* ============================================================
   src/utils.js · 通用工具（无业务、无状态）
   职责：数字格式化（10 §7）、节流（10 §4）、随机、DOM 小助手、时间
   ============================================================ */
(function (FG) {
  'use strict';

  /** 整数格式化：超 10000 显示「1.2万」（10 §7） */
  function formatInt(n) {
    n = Number(n);
    if (!isFinite(n)) return '0';
    n = Math.floor(n);
    if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    return String(n);
  }

  /** 重量格式化：固定 2 位小数（10 §7） */
  function formatWeight(n) {
    n = Number(n);
    if (!isFinite(n)) return '0.00';
    return n.toFixed(2);
  }

  /** 百分比格式化：0.75 → 75% */
  function formatPercent(n, digits) {
    n = Number(n);
    if (!isFinite(n)) return '0%';
    return (n * 100).toFixed(digits == null ? 0 : digits) + '%';
  }

  /** 区间随机整数 [min,max] */
  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  /** 概率判定：p=0.9 表示 90% 命中 */
  function chance(p) { return Math.random() < p; }

  /** 限幅 */
  function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }

  /**
   * 节流：10 §4 要求涉及资产的操作节流 ≥ 300ms
   * @param {Function} fn
   * @param {number} [wait] 默认取 CONFIG.ui.throttleMs
   */
  function throttle(fn, wait) {
    const w = wait == null ? (FG.CONFIG && FG.CONFIG.ui.throttleMs) || 300 : wait;
    let last = 0, timer = null;
    return function throttled() {
      const now = Date.now(), args = arguments, ctx = this;
      if (now - last >= w) { last = now; return fn.apply(ctx, args); }
      if (!timer) {
        timer = setTimeout(function () { timer = null; last = Date.now(); fn.apply(ctx, args); }, w - (now - last));
      }
    };
  }

  /**
   * 前置节流（资产类操作专用）：窗口期内**只执行第一次**，后续点击直接丢弃、不补尾调用。
   * 与 throttle 的区别：throttle 会在窗口末尾补一次尾调用，连点时会多执行一次扣减；
   * 涉及资产的操作（抛竿消耗饵料、装备、购买、重置）必须用本函数（10 §4）。
   */
  function throttleLead(fn, wait) {
    const w = wait == null ? (FG.CONFIG && FG.CONFIG.ui.throttleMs) || 300 : wait;
    let last = -Infinity;
    return function lead() {
      const now = Date.now();
      if (now - last < w) { console.warn('[utils] 节流窗口内，已忽略重复操作'); return; }
      last = now;
      return fn.apply(this, arguments);
    };
  }

  /**
   * 结果锁：上一次未返回时不接受新请求（10 §4）
   * 用法：const guarded = FG.utils.onceUntilDone(asyncFn);
   */
  function onceUntilDone(fn) {
    let running = false;
    return function () {
      if (running) { console.warn('[utils] 上一操作未结束，已忽略本次请求'); return false; }
      running = true;
      try {
        const r = fn.apply(this, arguments);
        Promise.resolve(r).catch(function () { }).then(function () { running = false; });
        return true;
      } catch (e) { running = false; throw e; }
    };
  }

  /** 白名单校验：非法值回退默认值并 console.warn（10 §5） */
  function pickValid(value, whitelist, fallback, tag) {
    if (whitelist.indexOf(value) !== -1) return value;
    console.warn('[utils] 非法入参，已回退默认值', tag || '', value, '→', fallback);
    return fallback;
  }

  /** 安全取数：undefined/null/NaN 一律给默认值（10 §5：禁止界面出现 undefined/NaN） */
  function safe(v, fallback) {
    if (v === null || v === undefined || v === '' || (typeof v === 'number' && !isFinite(v))) return fallback;
    return v;
  }

  /** 简易 DOM 构造：el('div',{class:'card'}, '文本') */
  function el(tag, attrs, html) {
    const node = document.createElement(tag);
    if (attrs) for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (html != null) node.innerHTML = html;
    return node;
  }

  /** 统一事件绑定：只绑 pointerdown，禁止 mousedown/touchstart 双绑（00 §5） */
  function onPointer(node, handler) {
    if (!node) return;
    node.addEventListener('pointerdown', function (e) { e.preventDefault(); handler(e); });
  }

  /** 今天零点时间戳（用于挑战次数/博览会刷新判定） */
  function startOfToday() {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
  }

  FG.utils = {
    formatInt: formatInt, formatWeight: formatWeight, formatPercent: formatPercent,
    randInt: randInt, chance: chance, clamp: clamp,
    throttle: throttle, throttleLead: throttleLead, onceUntilDone: onceUntilDone,
    pickValid: pickValid, safe: safe,
    el: el, onPointer: onPointer,
    startOfToday: startOfToday
  };
})(window.FG = window.FG || {});
