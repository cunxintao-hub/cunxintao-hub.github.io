/* ============================================================
   src/ui/toast.js · 轻提示（10 §1：任何资产变动都必须 toast）
   用法：FG.toast('💰 售出 黑鱼 获得 153 金币', 'ok')
   类型：'' 默认 / 'ok' / 'warn' / 'err'
   ============================================================ */
(function (FG) {
  'use strict';

  const DURATION = (FG.CONFIG && FG.CONFIG.ui && FG.CONFIG.ui.toastDuration) || 2200;
  const MAX_VISIBLE = 4;

  function toast(message, type) {
    const msg = message == null ? '' : String(message);
    if (msg === '' || msg.indexOf('undefined') !== -1 || msg.indexOf('NaN') !== -1) {
      console.warn('[toast] 文案异常已拦截', msg);       // 10 §7：禁止占位符残留
      return;
    }
    let layer = document.getElementById('toast-layer');
    if (!layer) {
      layer = FG.utils.el('div', { id: 'toast-layer', class: 'toast-layer' });
      document.body.appendChild(layer);
    }
    const node = FG.utils.el('div', { class: 'toast' + (type ? ' ' + type : '') }, msg);
    layer.appendChild(node);
    while (layer.children.length > MAX_VISIBLE) layer.removeChild(layer.firstChild);

    setTimeout(function () {
      node.style.transition = 'opacity .2s';
      node.style.opacity = '0';
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 220);
    }, DURATION);

    console.log('[toast]', type || 'info', msg);
  }

  FG.toast = toast;
})(window.FG = window.FG || {});
