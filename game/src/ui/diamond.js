/* ============================================================
   src/ui/diamond.js · 💎 钻石系统页面（桌面横版）
   结构（对齐参考实现的交互逻辑，布局按横屏三栏重排）：
     ① 顶部：钻石余额 + 获取途径说明
     ② 💰 金币兑换：三档（1/10/100 钻 → 100/1K/10K 金）
     ③ 🧰 材料捆绑包：6 个礼包（省 X% 角标 + 钻石价 + 金币原价划掉）
     ④ ⚙️ 自动合成：Lv.15 + 钻石开通，开通后可开关挂机自动二合
     ⑤ 🦸 英雄招募：8 位英雄（等级门槛 → 花钻石招募 → 永久加成）
   规则全在 systems/diamond.js，本文件只渲染与派发。
   ============================================================ */
(function (FG) {
  'use strict';
  const U = FG.utils;
  const ui = FG.ui = FG.ui || {};
  const D = () => FG.systems.diamond;

  function render() {
    const box = document.getElementById('diamond-panel');
    if (!box || !D()) return;
    box.innerHTML = topCard() + goldCard() + bundleCard() + autoCard() + heroCard();
    bind();
  }

  /* ---------------- ① 余额 + 来源 ---------------- */
  function topCard() {
    const s = D().getSummary();
    return '<div class="dm-top">' +
      '<div class="dm-top-icon">💎</div>' +
      '<div class="dm-top-main">' +
        '<div class="dm-top-title">钻石商店</div>' +
        '<div class="dm-top-num">' + U.formatInt(s.diamond) + '</div>' +
      '</div>' +
      '<div class="dm-top-src">' + s.sources.map(function (x) { return '<span class="dm-src">' + x + '</span>'; }).join('') +
        '<div class="li-sub">获取钻石，用来兑换金币、买礼包、开通自动合成、招募英雄</div>' +
      '</div>' +
      '<div class="dm-top-side">已招募英雄 <b>' + U.formatInt(s.heroes) + '/' + U.formatInt(s.heroTotal) + '</b>' +
        '<div class="li-sub">1💎 = ' + U.formatInt(s.rate) + '🪙（单向）</div>' +
      '</div>' +
    '</div>';
  }

  /* ---------------- ② 金币兑换 ---------------- */
  function goldCard() {
    const packs = D().goldPacks();
    const rate = D().getSummary().rate;
    const rows = packs.map(function (p, i) {
      return '<div class="dm-row">' +
        '<div class="dm-row-main">' +
          '<div class="dm-row-title">' + p.diamond + '💎 → ' + U.formatInt(p.gold) + '🪙</div>' +
          '<div class="li-sub">' + U.safe(p.desc, '') + '</div>' +
        '</div>' +
        '<button class="btn' + (p.affordable ? ' btn-primary' : '') + ' dm-exchange" data-tier="' + i + '"' +
          (p.affordable ? '' : ' disabled') + '>兑换</button>' +
      '</div>';
    }).join('');
    return '<section class="dm-card">' +
      '<div class="dm-head"><span>💰 金币兑换</span>' +
        '<span class="li-sub">1💎 = ' + U.formatInt(rate) + '🪙</span></div>' +
      '<div class="dm-rows">' + rows + '</div>' +
    '</section>';
  }

  /* ---------------- ③ 材料捆绑包 ---------------- */
  function bundleCard() {
    const list = D().bundles();
    const cards = list.map(function (b) {
      const items = b.items.map(function (it) {
        return '<span class="dm-item"><i>' + it.icon + '</i>×' + U.formatInt(it.count) + '</span>';
      }).join('');
      return '<div class="dm-bundle">' +
        '<span class="dm-save">省' + U.formatInt(b.savePercent) + '%</span>' +
        '<div class="dm-bundle-ico">' + U.safe(b.icon, '📦') + '</div>' +
        '<div class="dm-bundle-name">' + U.safe(b.name, b.id) + '</div>' +
        '<div class="dm-bundle-items">' + items + '</div>' +
        '<div class="dm-price">' +
          '<span class="dm-gem">💎 ' + U.formatInt(b.price) + '</span>' +
          '<span class="dm-origin">🪙 ' + U.formatInt(b.originGold) + '</span>' +
        '</div>' +
        '<button class="btn dm-buy' + (b.affordable ? ' btn-primary' : '') + '" data-bundle="' + b.id + '"' +
          (b.affordable ? '' : ' disabled') + '>' +
          (b.affordable ? '购买' : '钻石不足') + '</button>' +
      '</div>';
    }).join('');
    return '<section class="dm-card">' +
      '<div class="dm-head"><span>🧰 材料捆绑包</span><span class="dm-tip">💎 更划算!</span></div>' +
      '<div class="dm-bundles">' + cards + '</div>' +
    '</section>';
  }

  /* ---------------- ④ 自动合成 ---------------- */
  function autoCard() {
    const a = D().autoState();
    let action;
    if (!a.opened) {
      action = '<button class="btn' + ((a.levelOk && a.affordable) ? ' btn-primary' : '') +
        ' dm-open-auto" id="dm-open-auto"' + ((a.levelOk && a.affordable) ? '' : ' disabled') + '>' +
        (a.levelOk ? ('💎' + U.formatInt(a.cost) + ' 开通') : ('🔒 需要 Lv.' + a.unlockLevel)) + '</button>';
    } else {
      action = '<button class="btn' + (a.on ? ' btn-primary' : '') + '" id="dm-toggle-auto">' +
        (a.on ? '⏸ 暂停自动合成' : '▶️ 开启自动合成') + '</button>';
    }
    return '<section class="dm-card">' +
      '<div class="dm-head"><span>⚙️ 自动合成</span>' +
        '<span class="li-sub">' + U.safe((a.opened ? (a.on ? '运行中' : '已暂停') : '未开通'), '') + '</span></div>' +
      '<div class="dm-row">' +
        '<div class="dm-row-ico">' + (a.opened ? '⚙️' : '🔒') + '</div>' +
        '<div class="dm-row-main">' +
          '<div class="dm-row-title">' + U.safe(a.text, '') + '</div>' +
          '<div class="li-sub">开通后自动把合成台上「同名同等级」的材料合并升级（每 ' +
            U.formatInt(Math.round((FG.CONFIG.diamond.autoMerge.intervalMs || 2000) / 1000)) + 's 一次，挂机用）</div>' +
        '</div>' +
        action +
      '</div>' +
    '</section>';
  }

  /* ---------------- ⑤ 英雄招募 ---------------- */
  function heroCard() {
    const list = D().heroesState();
    const bonus = D().heroBonus();
    const bonusText = Object.keys(bonus).filter(function (k) { return bonus[k]; }).map(function (k) {
      const name = (FG.render && FG.render.skillEffectName) ? FG.render.skillEffectName(k) : k;
      return '<span class="dm-bonus">' + U.safe(name, k) + ' +' + Math.round(bonus[k] * 100) + '%</span>';
    }).join('');

    const cards = list.map(function (h) {
      let foot;
      if (h.owned) foot = '<div class="dm-hero-foot owned">✅ 已招募</div>';
      else if (h.reason === 'level') foot = '<div class="dm-hero-foot lock">🔒 Lv.' + U.formatInt(h.unlockLevel) + '</div>';
      else foot = '<button class="btn dm-recruit' + (h.canRecruit ? ' btn-primary' : '') + '" data-hero="' + h.id + '"' +
        (h.canRecruit ? '' : ' disabled') + '>💎' + U.formatInt(h.cost) + ' 招募</button>';

      return '<div class="dm-hero' + (h.owned ? ' owned' : '') + ' glow-' + h.rarity + '">' +
        '<div class="dm-hero-ico">' + U.safe(h.icon, '🧑') + '</div>' +
        '<div class="dm-hero-name">' + U.safe(h.name, h.id) + '</div>' +
        '<div class="dm-hero-rar rar-' + h.rarity + '">' + U.safe(h.stars, '★') + ' ' + U.safe(h.rarity, '') + '</div>' +
        '<div class="dm-hero-desc">' + U.safe(h.desc, '') + '</div>' +
        (h.owned ? '' : '<div class="li-sub">需要 Lv.' + U.formatInt(h.unlockLevel) + '</div>') +
        foot +
      '</div>';
    }).join('');

    return '<section class="dm-card">' +
      '<div class="dm-head"><span>🦸 英雄招募</span><span class="dm-tip">招募英雄获得永久加成</span></div>' +
      (bonusText ? '<div class="dm-bonus-bar">当前加成：' + bonusText + '</div>' : '') +
      '<div class="dm-heroes">' + cards + '</div>' +
    '</section>';
  }

  /* ---------------- 事件 ---------------- */
  function bind() {
    const box = document.getElementById('diamond-panel');
    if (!box) return;
    const T = FG.CONFIG.ui.throttleMs;
    const refresh = function () { FG.render.renderAll(); render(); };

    const ex = box.querySelectorAll('.dm-exchange');
    for (let i = 0; i < ex.length; i++) {
      if (ex[i].disabled) continue;
      U.onPointer(ex[i], U.throttleLead(function () {
        if (D().exchangeGold(Number(ex[i].getAttribute('data-tier')))) refresh();
      }, T));
    }
    const buys = box.querySelectorAll('.dm-buy');
    for (let j = 0; j < buys.length; j++) {
      if (buys[j].disabled) continue;
      U.onPointer(buys[j], U.throttleLead(function () {
        if (D().buyBundle(buys[j].getAttribute('data-bundle'))) refresh();
      }, T));
    }
    const open = box.querySelector('#dm-open-auto');
    if (open && !open.disabled) {
      U.onPointer(open, U.throttleLead(function () { if (D().openAutoMerge()) refresh(); }, T));
    }
    const toggle = box.querySelector('#dm-toggle-auto');
    if (toggle) {
      U.onPointer(toggle, U.throttleLead(function () { D().toggleAutoMerge(); refresh(); }, T));
    }
    const rec = box.querySelectorAll('.dm-recruit');
    for (let k = 0; k < rec.length; k++) {
      if (rec[k].disabled) continue;
      U.onPointer(rec[k], U.throttleLead(function () {
        if (D().recruit(rec[k].getAttribute('data-hero'))) refresh();
      }, T));
    }
  }

  ui.diamond = { render: render };
})(window.FG = window.FG || {});
