/* ============================================================
   src/ui/market.js · 07 市场（🏪 页签）：售卖 / 购买 / 博览会
   职责：只渲染与派发，规则全在 systems.market 与 systems.codex
     - 售卖：鱼（已入图鉴的不出现）+ 制品，支持单卖与一键出售（二次确认）
     - 购买：商店库存（每日限量、售罄显示补货倒计时）
     - 博览会：今日任务进度 / 上交 / 领奖（06 §3）
   ============================================================ */
(function (FG) {
  'use strict';
  const U = FG.utils;
  const ui = FG.ui = FG.ui || {};
  const M = () => FG.systems.market;
  const C = () => FG.systems.codex;

  const state = { tab: 'sell' };
  let ticker = 0;

  function render() {
    const box = document.getElementById('market-panel');
    if (!box || !M()) return;

    const tabs = [
      { key: 'sell', name: '🏷️ 售卖' },
      { key: 'buy', name: '🛒 购买' },
      { key: 'expo', name: '🏆 博览会' }
    ].map(function (t) {
      return '<button class="bag-tab clickable' + (state.tab === t.key ? ' active' : '') + '" data-tab="' + t.key + '">' + t.name + '</button>';
    }).join('');

    let body = '';
    if (state.tab === 'sell') body = sellHtml();
    else if (state.tab === 'buy') body = buyHtml();
    else body = expoHtml();

    box.innerHTML = '<div class="bag-tabs">' + tabs + '</div>' + body;
    bind();
    startTicker();
  }

  /* ---------------- 🏷️ 售卖 ---------------- */

  function sellHtml() {
    const fishes = M().sellableFish();
    const sellable = fishes.filter(function (f) { return !f.collected; });
    const collected = fishes.filter(function (f) { return f.collected; });
    const products = M().sellableProducts();

    const fishRows = sellable.length ? sellable.map(function (f) {
      return '<div class="list-item">' +
        '<span>' + f.icon + '</span>' +
        '<span class="li-main">' + U.safe(f.name, f.id) +
          ' <span class="tag t-' + f.rarity + '">' + U.safe(FG.ENUM.RARITY_NAME[f.rarity], f.rarity) + '</span>' +
          '<div class="li-sub">×' + U.formatInt(f.count) + '　均价 🪙' + U.formatInt(f.unitPrice) +
          '　合计 🪙' + U.formatInt(f.total) + '</div></span>' +
        '<button class="btn btn-primary mk-sell" data-fish="' + f.id + '">出售 ×1</button>' +
        '</div>';
    }).join('') : '<div class="empty-tip">背包里没有鱼，去钓鱼吧！</div>';

    const prodRows = products.length ? products.map(function (p) {
      return '<div class="list-item">' +
        '<span>🍣</span>' +
        '<span class="li-main">' + U.safe(p.name, p.id) +
          '<div class="li-sub">×' + U.formatInt(p.count) + '　单价 🪙' + U.formatInt(p.unitPrice) + '</div></span>' +
        '<button class="btn btn-primary mk-sell-prod" data-product="' + p.id + '">出售 ×1</button>' +
        '</div>';
    }).join('') : '<div class="empty-tip">暂无制品（工坊 Lv.' + ((FG.CONFIG.workshop || {}).unlockLevel || 10) + ' 解锁后可加工）</div>';

    return '<div class="card-title"><span>🐟 可出售的鱼</span>' +
        '<span class="li-sub">售价 = 基础价 ' + ((FG.CONFIG.economy || {}).fishBasePrice || 0) +
        ' × 稀有度系数 × 重量</span></div>' +
      fishRows +
      (collected.length ? '<div class="empty-tip">另有 ' + collected.length +
        ' 种鱼已入图鉴（珍藏中，不可出售）</div>' : '') +
      '<div class="card-title" style="margin-top:8px"><span>🍣 制品</span></div>' + prodRows +
      '<div class="modal-foot-inline" style="margin-top:10px">' +
        '<button class="btn" id="mk-sell-all-fish">💰 一键出售全部鱼（' + sellable.length + ' 种）</button>' +
        '<button class="btn" id="mk-sell-all-prod">🍣 一键出售全部制品</button>' +
      '</div>';
  }

  /* ---------------- 🛒 购买 ---------------- */

  function buyHtml() {
    const stock = M().getStock();
    const gold = Number(FG.getState().gold) || 0;
    const rows = stock.items.map(function (it) {
      const poor = gold < it.price;
      const btn = it.sold
        ? '<button class="btn" disabled>今日售罄</button>'
        : '<button class="btn btn-primary mk-buy" data-item="' + it.id + '"' + (poor ? ' disabled' : '') + '>🪙' + U.formatInt(it.price) + ' 购买</button>';
      return '<div class="list-item">' +
        '<span>' + it.icon + '</span>' +
        '<span class="li-main">' + U.safe(it.name, it.id) +
          '<div class="li-sub">' + (it.sold
            ? '今日售罄 · ' + U.safe(stock.countdown, '--:--:--') + ' 后补货'
            : '剩余 ' + U.formatInt(it.left) + '/' + U.formatInt(it.max) + '　单价 🪙' + U.formatInt(it.price)) +
          (poor && !it.sold ? '　<span class="err-text">金币不足（还差 🪙' + U.formatInt(it.price - gold) + '）</span>' : '') +
          '</div></span>' +
        btn +
        '</div>';
    }).join('');

    return '<div class="buy-tip">商品每日限量，售罄后于次日补货；下次补货倒计时 <b>' + U.safe(stock.countdown, '--:--:--') + '</b>' +
        '<span class="buy-gold">当前金币 🪙<b>' + U.formatInt(gold) + '</b></span></div>' +
      rows +
      '<div class="card-title" style="margin-top:10px"><span>💎 钻石兑换</span>' +
        '<span class="li-sub">1💎 → ' + ((FG.CONFIG.economy || {}).diamondToGold || 100) + '🪙（单向）</span></div>' +
      '<div class="list-item">' +
        '<span>💎</span>' +
        '<span class="li-main">当前钻石 ' + U.formatInt(FG.getState().diamond) +
          '<div class="li-sub">钻石来自图鉴里程碑与博览会</div></span>' +
        '<button class="btn mk-exchange" data-n="1">兑换 1💎</button>' +
      '</div>';
  }

  /* ---------------- 🏆 博览会（4 个展区同屏卡片，参考稿样式） ---------------- */

  /** 奖励数字紧凑格式：300 / 1.2K / 3.0K（与参考稿「1.0K」一致） */
  function compact(n) {
    const v = Math.max(0, Number(n) || 0);
    return v >= 1000 ? (v / 1000).toFixed(1) + 'K' : U.formatInt(v);
  }

  function expoHtml() {
    const ex = C().getExpoState();
    if (!ex.stalls.length) return '<div class="empty-tip">今日博览会任务生成失败（配置缺失）</div>';
    return '<div class="buy-tip">今日展区已提交 <b>' + U.formatInt(ex.doneCount) + ' / ' + U.formatInt(ex.total) + '</b>' +
        '<span class="buy-gold">每个展区每天可提交一次，跨日 0 点重置；提交会消耗展出的鱼（📖 图鉴类要求不消耗）</span></div>' +
      '<div class="expo-grid">' + ex.stalls.map(stallHtml).join('') + '</div>';
  }

  function stallHtml(s) {
    const pills = s.reqs.map(function (r) {
      return '<div class="expo-pill' + (r.met ? ' ok' : '') + '">' +
        '<span class="expo-pill-ico">' + r.icon + '</span>' +
        '<span class="expo-pill-text">' + U.safe(r.text, '') + '</span>' +
        '<span class="expo-pill-extra">' + U.safe(r.extra, '') + '</span>' +
        '</div>';
    }).join('');

    let btn;
    if (s.submitted) btn = '<button class="btn expo-submit" disabled>✅ 今日已提交</button>';
    else if (s.claimable) btn = '<button class="btn btn-primary expo-submit mk-stall" data-stall="' + s.id + '">💠 提交展品</button>';
    else btn = '<button class="btn expo-submit" disabled>💠 提交展品</button>';

    return '<div class="expo-card' + (s.submitted ? ' done' : '') + (s.claimable ? ' ready' : '') + '">' +
      '<div class="expo-icon">' + U.safe(s.icon, '🏆') + '</div>' +
      '<div class="expo-name">' + U.safe(s.name, s.id) + '</div>' +
      '<div class="expo-sub">' + U.safe(s.subtitle, '') + '</div>' +
      '<div class="expo-reward">奖励: <b>🪙 ' + compact(s.reward.gold) + '</b> + <b>💎 ' + U.formatInt(s.reward.diamond) + '</b></div>' +
      '<div class="expo-reqs">' + pills + '</div>' +
      btn +
      '</div>';
  }

  /* ---------------- 事件 ---------------- */

  function bind() {
    const box = document.getElementById('market-panel');
    if (!box) return;

    const tabs = box.querySelectorAll('.bag-tabs .bag-tab');
    for (let i = 0; i < tabs.length; i++) {
      U.onPointer(tabs[i], U.throttle(function () {
        state.tab = tabs[i].getAttribute('data-tab');
        render();
      }, 200));
    }

    const sells = box.querySelectorAll('.mk-sell');
    for (let j = 0; j < sells.length; j++) {
      U.onPointer(sells[j], U.throttleLead(function () {
        if (M().sellFish(sells[j].getAttribute('data-fish'), 1)) { FG.render.renderAll(); render(); }
      }, FG.CONFIG.ui.throttleMs));
    }
    const psells = box.querySelectorAll('.mk-sell-prod');
    for (let k = 0; k < psells.length; k++) {
      U.onPointer(psells[k], U.throttleLead(function () {
        if (M().sellProduct(psells[k].getAttribute('data-product'), 1)) { FG.render.renderAll(); render(); }
      }, FG.CONFIG.ui.throttleMs));
    }
    const buys = box.querySelectorAll('.mk-buy');
    for (let b = 0; b < buys.length; b++) {
      if (buys[b].disabled) continue;
      U.onPointer(buys[b], U.throttleLead(function () {
        if (M().buy(buys[b].getAttribute('data-item'), 1)) { FG.render.renderAll(); render(); }
      }, FG.CONFIG.ui.throttleMs));
    }
    /* 博览会：提交展品（不再二次确认，因为已经消耗鱼，且每日每展区一次） */
    const stalls = box.querySelectorAll('.mk-stall');
    for (let s = 0; s < stalls.length; s++) {
      U.onPointer(stalls[s], U.throttleLead(function () {
        if (C().submitStall(stalls[s].getAttribute('data-stall'))) { FG.render.renderAll(); render(); }
      }, FG.CONFIG.ui.throttleMs));
    }
    const exg = box.querySelectorAll('.mk-exchange');
    for (let e = 0; e < exg.length; e++) {
      U.onPointer(exg[e], U.throttleLead(function () {
        if (M().exchangeDiamondToGold(Number(exg[e].getAttribute('data-n')) || 1)) { FG.render.renderAll(); render(); }
      }, FG.CONFIG.ui.throttleMs));
    }

    const allFish = box.querySelector('#mk-sell-all-fish');
    if (allFish) {
      U.onPointer(allFish, U.throttleLead(function () {
        const list = M().sellableFish().filter(function (f) { return !f.collected; });
        if (!list.length) { FG.toast('没有可出售的鱼', 'warn'); return; }
        const total = list.reduce(function (a, f) { return a + f.total; }, 0);
        const n = list.reduce(function (a, f) { return a + f.count; }, 0);
        FG.modal.confirm('💰 一键出售',
          '<div class="buy-tip">将出售 <b>' + U.formatInt(n) + '</b> 条鱼，预计获得 🪙<b>' + U.formatInt(total) + '</b>' +
          '<span class="buy-gold">已入图鉴的鱼不会出售</span></div>',
          function () { M().sellAll('fish'); FG.render.renderAll(); render(); });
      }, FG.CONFIG.ui.throttleMs));
    }
    const allProd = box.querySelector('#mk-sell-all-prod');
    if (allProd) {
      U.onPointer(allProd, U.throttleLead(function () {
        const list = M().sellableProducts();
        if (!list.length) { FG.toast('没有可出售的制品', 'warn'); return; }
        const total = list.reduce(function (a, p) { return a + p.total; }, 0);
        FG.modal.confirm('🍣 一键出售制品',
          '<div class="buy-tip">将出售全部制品，预计获得 🪙<b>' + U.formatInt(total) + '</b></div>',
          function () { M().sellAll('products'); FG.render.renderAll(); render(); });
      }, FG.CONFIG.ui.throttleMs));
    }
  }

  /** 补货倒计时：1s 刷新（离开页签停掉，10 §9） */
  function startTicker() {
    if (ticker) return;
    ticker = setInterval(function () {
      if (FG.ui.layout.getActiveTab() !== 'market') { stopTicker(); return; }
      if (state.tab !== 'buy') { stopTicker(); return; }
      const box = document.getElementById('market-panel');
      if (!box) { stopTicker(); return; }
      const cd = box.querySelector('.buy-tip b');
      if (cd) cd.textContent = M().getStock().countdown;
    }, 1000);
  }
  function stopTicker() {
    if (!ticker) return;
    clearInterval(ticker);
    ticker = 0;
  }

  ui.market = { render: render, stopTicker: stopTicker, setTab: function (t) { state.tab = t; } };
})(window.FG = window.FG || {});
