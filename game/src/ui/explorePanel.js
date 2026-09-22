/* ============================================================
   src/ui/explorePanel.js · 【补充探索次数】面板（金币补充挖掘/采集次数）
   职责：只负责 DOM 与交互，扣费与次数变更全部走 systems.merge.buyCharges
   规则（10 §2/§4/§8）：
     - 等待玩家的地方不给死路：金币不足 / 次数已满 / 剩余不足，都有明确文案
     - 资产操作统一前节流 throttleLead（窗口内连点直接丢弃，不重复扣金币）
     - 金币与次数成对变更，失败回滚（在 systems 层完成）
   ============================================================ */
(function (FG) {
  'use strict';
  const U = FG.utils;
  const ui = FG.ui = FG.ui || {};
  const M = () => FG.systems.merge;

  /** 恢复间隔文案：600000ms → 「10 分钟」，60000ms → 「60 秒」 */
  function regenText() {
    const ms = Number((FG.CONFIG.charges || {}).regenIntervalMs) || 0;
    if (!ms) return '自动恢复';
    if (ms % 60000 === 0) return (ms / 60000) + ' 分钟';
    return Math.round(ms / 1000) + ' 秒';
  }

  function buyCfg() { return (FG.CONFIG.charges || {}).buy || {}; }

  /** 一行：图标 + 名称 + 当前 n/max + 两个购买按钮 */
  function rowHtml(type) {
    const cfg = buyCfg();
    const st = M().chargesState();
    const cur = type === 'dig' ? st.dig : st.gather;
    const max = type === 'dig' ? st.digMax : st.gatherMax;
    const gold = Number(FG.getState().gold) || 0;
    const amount = Math.max(1, Number(cfg.buyAmount) || 3);
    const room = max - cur;
    const full = room <= 0;
    const canPlus = !full && room >= amount && gold >= (cfg.buyCost || 0);
    const canFull = !full && gold >= (cfg.fullCost || 0);
    const ico = type === 'dig' ? '⛏️' : '🌿';
    const name = type === 'dig' ? '挖掘次数' : '采集次数';

    return '' +
      '<div class="buy-row" data-kind="' + type + '">' +
        '<span class="buy-ico">' + ico + '</span>' +
        '<div class="buy-main">' +
          '<b>' + name + '</b>' +
          '<div class="li-sub">当前：' + cur + '/' + max +
            (full ? '　<span class="ok-text">已满</span>' : '　<span class="buy-cd">' + U.safe(st.countdown, '--:--') + ' 后 +1</span>') +
          '</div>' +
        '</div>' +
        '<div class="buy-btns">' +
          '<button class="btn buy-btn" data-kind="' + type + '" data-mode="plus"' +
            (canPlus ? '' : ' disabled') + '>+' + amount + ' 🪙' + (cfg.buyCost || 0) + '</button>' +
          '<button class="btn btn-primary buy-btn" data-kind="' + type + '" data-mode="full"' +
            (canFull ? '' : ' disabled') + '>满充 🪙' + (cfg.fullCost || 0) + '</button>' +
        '</div>' +
      '</div>';
  }

  function bodyHtml() {
    const gold = Number(FG.getState().gold) || 0;
    return '' +
      '<div class="buy-tip">次数每 ' + regenText() + '自动恢复 1 次，也可以用金币快速补充。' +
        '<span class="buy-gold">当前金币 🪙 <b>' + U.formatInt(gold) + '</b></span></div>' +
      rowHtml('dig') +
      rowHtml('gather');
  }

  function bind(layer) {
    const btns = layer.querySelectorAll('.buy-btn');
    for (let i = 0; i < btns.length; i++) {
      const btn = btns[i];
      if (btn.disabled) { btn.classList.add('disabled'); continue; }
      U.onPointer(btn, U.throttleLead(function () {
        const kind = btn.getAttribute('data-kind');
        const mode = btn.getAttribute('data-mode');
        const ok = M().buyCharges(kind, mode);
        if (ok) {
          FG.render.renderAll();        // 顶栏金币 + 合成台体力同步
          open();                       // 面板原地刷新（次数/金币已变）
        }
      }, FG.CONFIG.ui.throttleMs));
    }
  }

  /** 打开面板；已打开时原地刷新内容 */
  function open() {
    FG.modal.open({
      title: '🔋 补充探索次数',
      body: bodyHtml(),
      showCancel: false,
      onClose: function () { FG.render.renderAll(); }
    });
    const layer = document.getElementById('modal-layer');
    if (layer) bind(layer);
    return true;
  }

  ui.explore = { open: open, regenText: regenText, bodyHtml: bodyHtml };
})(window.FG = window.FG || {});
