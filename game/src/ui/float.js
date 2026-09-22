/* ============================================================
   src/ui/float.js · 资产变动飘字（07 §5 / 10 §1）
   在顶栏资源区下方浮出「+153🪙 / -8🪙 / +3💎」，1.1s 后自动移除；
   多次触发时纵向错开，避免叠在一起看不清。
   ============================================================ */
(function (FG) {
  'use strict';
  const ui = FG.ui = FG.ui || {};

  let layer = null;
  let slot = 0;

  function ensureLayer() {
    if (layer && layer.parentNode) return layer;
    layer = document.getElementById('float-layer');
    if (!layer) {
      layer = FG.utils.el('div', { id: 'float-layer', class: 'float-layer' });
      document.body.appendChild(layer);
    }
    return layer;
  }

  /**
   * @param {string} text 如 '+153🪙'
   * @param {'ok'|'warn'|'err'} [type]
   */
  function show(text, type) {
    const box = ensureLayer();
    const msg = FG.utils.safe(text, '');
    if (!msg || /undefined|NaN/.test(msg)) return;
    const node = FG.utils.el('div', { class: 'float-text' + (type ? ' ' + type : '') }, msg);
    node.style.top = (60 + (slot % 3) * 26) + 'px';
    slot++;
    box.appendChild(node);
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
      slot = Math.max(0, slot - 1);
    }, 1100);
  }

  ui.float = { show: show };
})(window.FG = window.FG || {});
