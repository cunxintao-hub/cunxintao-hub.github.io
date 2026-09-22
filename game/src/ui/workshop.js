/* ============================================================
   src/ui/workshop.js · 06 工坊（把鱼加工为制品，售价 ×1.6）
   职责：只渲染与派发，规则全在 systems.codex（工坊部分）
     - 未解锁：说明解锁条件（Lv.10）
     - 已解锁：工位卡片 + 倒计时进度 + 收取、投料鱼列表、升级工位、制品出售
   ============================================================ */
(function (FG) {
  'use strict';
  const U = FG.utils;
  const ui = FG.ui = FG.ui || {};
  const C = () => FG.systems.codex;

  let ticker = 0;

  function render() {
    const box = document.getElementById('workshop-panel');
    if (!box || !C()) return;
    C().checkWorkshopUnlock();                 // 达标即解锁（幂等，内部会给 toast）
    const w = C().workshopState();
    const s = FG.getState();

    if (!w.unlocked) {
      box.innerHTML =
        '<div class="ws-lock">' +
          '<div class="ws-lock-title">🔒 工坊 Lv.' + w.unlockLevel + ' 解锁</div>' +
          '<div class="li-sub">把钓到的鱼加工成 🍣 制品，售价 = 生鱼价 × ' +
            ((FG.CONFIG.economy || {}).productPriceFactor || 1) + '</div>' +
          '<div class="li-sub">当前 Lv.' + U.formatInt(s.level) + '，还差 ' +
            Math.max(0, w.unlockLevel - (Number(s.level) || 1)) + ' 级</div>' +
        '</div>';
      stopTicker();
      return;
    }

    const fac = w.facilities.map(function (slot, i) { return slotHtml(slot, i, w); }).join('');
    const fishList = fishHtml();
    const prodList = productHtml();

    box.innerHTML =
      '<div class="ws-head">' +
        '<span>🏭 工坊 Lv.' + U.formatInt(w.level) + '　工位 ' + w.slots + ' 个　加工 ' + w.processSeconds + 's/条</span>' +
        '<button class="btn" id="ws-upgrade">⬆️ 升级工位 🪙' + U.formatInt(w.nextSlotCost) + '</button>' +
      '</div>' +
      '<div class="ws-slots">' + fac + '</div>' +
      '<div class="card-title" style="margin-top:8px"><span>🐟 选择鱼投料</span>' +
        '<span class="li-sub">投入 1 条鱼，产出 1 份制品</span></div>' +
      '<div class="ws-list">' + fishList + '</div>' +
      '<div class="card-title" style="margin-top:8px"><span>🍣 制品（可出售）</span></div>' +
      '<div class="ws-list">' + prodList + '</div>';

    bind();
    startTicker();
  }

  function slotHtml(slot, i, w) {
    if (!slot) {
      return '<div class="ws-slot empty"><div class="ws-slot-ico">➕</div>' +
        '<div class="li-sub">空工位</div></div>';
    }
    const f = (FG.CONFIG.fish || {})[slot.fishId] || { name: slot.fishId, icon: '🐟' };
    const now = Date.now();
    const done = now >= slot.endsAt;
    const pct = done ? 100 : Math.round((now - slot.startsAt) / Math.max(1, slot.endsAt - slot.startsAt) * 100);
    const left = Math.max(0, Math.ceil((slot.endsAt - now) / 1000));
    return '<div class="ws-slot' + (done ? ' done' : '') + '">' +
      '<div class="ws-slot-ico">' + f.icon + '</div>' +
      '<div class="ws-slot-main">' +
        '<div class="ws-slot-name">' + U.safe(f.name, slot.fishId) + '（' + U.formatWeight(slot.weight) + 'kg）</div>' +
        '<div class="ws-bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="li-sub">' + (done ? '已完成，可收取' : '剩余 ' + left + 's') +
          '　制品售价 🪙' + U.formatInt(slot.unitPrice) + '</div>' +
      '</div>' +
      '<button class="btn btn-primary ws-collect" data-slot="' + i + '"' + (done ? '' : ' disabled') + '>收取</button>' +
      '</div>';
  }

  function fishHtml() {
    const s = FG.getState();
    const ids = Object.keys(s.bag.fish || {}).filter(function (id) {
      const e = s.bag.fish[id];
      return e && (e.count || (e.weights && e.weights.length));
    });
    if (!ids.length) return '<div class="empty-tip">背包里没有鱼，去钓鱼吧！（入图鉴的鱼也能加工）</div>';
    return ids.map(function (id) {
      const f = (FG.CONFIG.fish || {})[id] || { name: id, icon: '🐟', rarity: 'common' };
      const e = s.bag.fish[id];
      const weights = (e.weights || []).slice().sort(function (a, b) { return b - a; });
      const w = weights[0] || 0;
      /* 用「预计制品单价」口径（含 精明商人 / 金币收益 等加成），与实际产物结算一致 */
      const unit = FG.systems.market ? FG.systems.market.getProductUnitPrice(id, w) : 0;
      return '<div class="list-item clickable ws-fish" data-fish="' + id + '">' +
        '<span>' + f.icon + '</span>' +
        '<span class="li-main">' + U.safe(f.name, id) +
          '<div class="li-sub">×' + U.formatInt((e.weights || []).length || e.count) +
          '　最重 ' + U.formatWeight(w) + 'kg　→ 制品 🪙' + U.formatInt(unit) + '</div></span>' +
        '<span class="li-sub">投料 ›</span>' +
        '</div>';
    }).join('');
  }

  function productHtml() {
    const s = FG.getState();
    const ids = Object.keys(s.bag.products || {});
    if (!ids.length) return '<div class="empty-tip">暂无制品（加工完成后在这里收取）</div>';
    return ids.map(function (id) {
      const p = s.bag.products[id];
      const f = (FG.CONFIG.fish || {})[id] || { name: id, icon: '🍣' };
      const unit = FG.systems.market ? FG.systems.market.getProductPrice(id) : 0;
      return '<div class="list-item">' +
        '<span>🍣</span>' +
        '<span class="li-main">' + U.safe(f.name, id) + ' 制品' +
          '<div class="li-sub">×' + U.formatInt(p.count) + '　单价 🪙' + U.formatInt(unit) + '</div></span>' +
        '<button class="btn btn-primary ws-sell" data-product="' + id + '">出售</button>' +
        '</div>';
    }).join('');
  }

  function bind() {
    const box = document.getElementById('workshop-panel');
    if (!box) return;

    const fishes = box.querySelectorAll('.ws-fish');
    for (let i = 0; i < fishes.length; i++) {
      U.onPointer(fishes[i], U.throttleLead(function () {
        if (C().startProcess(fishes[i].getAttribute('data-fish'))) { FG.render.renderAll(); render(); }
      }, FG.CONFIG.ui.throttleMs));
    }
    const collects = box.querySelectorAll('.ws-collect');
    for (let j = 0; j < collects.length; j++) {
      if (collects[j].disabled) continue;
      U.onPointer(collects[j], U.throttleLead(function () {
        if (C().collectProcess(Number(collects[j].getAttribute('data-slot')))) { FG.render.renderAll(); render(); }
      }, FG.CONFIG.ui.throttleMs));
    }
    const sells = box.querySelectorAll('.ws-sell');
    for (let k = 0; k < sells.length; k++) {
      U.onPointer(sells[k], U.throttleLead(function () {
        if (FG.systems.market.sellProduct(sells[k].getAttribute('data-product'), 1)) { FG.render.renderAll(); render(); }
      }, FG.CONFIG.ui.throttleMs));
    }
    const up = box.querySelector('#ws-upgrade');
    if (up) {
      U.onPointer(up, U.throttleLead(function () {
        if (C().upgradeWorkshopSlot()) { FG.render.renderAll(); render(); }
      }, FG.CONFIG.ui.throttleMs));
    }
  }

  /* 倒计时：1s 刷新一次（离开页签时停掉，10 §9） */
  function startTicker() {
    if (ticker) return;
    ticker = setInterval(function () {
      if (FG.ui.layout.getActiveTab() !== 'workshop') { stopTicker(); return; }
      const slots = C().workshopState().facilities.filter(Boolean);
      if (!slots.length) { stopTicker(); return; }
      render();
    }, 1000);
  }
  function stopTicker() {
    if (!ticker) return;
    clearInterval(ticker);
    ticker = 0;
  }

  ui.workshop = { render: render, stopTicker: stopTicker };
})(window.FG = window.FG || {});
