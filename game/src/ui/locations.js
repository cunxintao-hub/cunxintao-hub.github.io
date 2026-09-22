/* ============================================================
   src/ui/locations.js · 🗺️ 钓场列表（右栏，05 §3）
   职责：渲染 7 个钓场（已解锁可进入 / 未解锁灰显 + 🔒），点击行为分两类：
     - 已解锁 → growth.switchLocation 切换（切换失败有 toast）
     - 未解锁 → 打开预览浮层：看图标/名称/解锁等级/描述/鱼种（未收录显示 ❓ ???），
                明确告知「暂不能在此钓鱼」
   只读渲染，规则判定全部走 systems.growth
   ============================================================ */
(function (FG) {
  'use strict';
  const U = FG.utils;
  const ui = FG.ui = FG.ui || {};
  const G = () => FG.systems.growth;

  /** 右栏钓场列表（7 个全展示，制造探索动力） */
  function render() {
    const box = document.getElementById('location-list');
    if (!box) return;
    const list = G() && G().locationsState ? G().locationsState() : [];
    const sig = list.map(function (l) {
      return l.id + (l.current ? 'C' : (l.unlocked ? 'U' : 'L'));
    }).join('|');
    if (box.getAttribute('data-sig') === sig) return;      // 状态没变不重建，避免打断点击
    box.setAttribute('data-sig', sig);
    box.innerHTML = '';

    list.forEach(function (l) {
      const cls = 'loc-row clickable' +
        (l.current ? ' current' : '') +
        (l.unlocked ? '' : ' locked');
      const sc = (FG.CONFIG.locations[l.id] || {}).scene || {};
      const thumb = sc.image
        ? 'background-image:url(\'' + sc.image + '\')'
        : '';
      const node = U.el('div', { class: cls, 'data-loc': l.id },
        '<span class="loc-thumb" style="' + thumb + '">' + (sc.image ? '' : U.safe(l.emoji, '📍')) + '</span>' +
        '<div class="loc-main">' +
          '<div class="loc-name">' + U.safe(l.name, l.id) +
            '<span class="loc-lv">Lv.' + U.formatInt(l.needLevel) + '</span>' +
            (l.current ? '<span class="loc-chip">当前</span>' :
              (l.unlocked ? '<span class="loc-chip ok">✓</span>' : '<span class="loc-chip lock">🔒</span>')) +
          '</div>' +
          '<div class="loc-desc">' + U.safe(l.desc, '') + '</div>' +
        '</div>' +
        (l.unlocked
          ? '<span class="loc-arrow">›</span>'
          : '<button class="loc-preview-btn clickable" data-preview="' + l.id + '" title="查看该钓场场景">预览</button>'));

      U.onPointer(node, U.throttleLead(function (e) {
        /* 点「预览」按钮走场景视图，其余区域按原行为（未解锁 → 信息弹窗） */
        if (e && e.target && e.target.closest && e.target.closest('.loc-preview-btn')) return;
        if (l.unlocked) {
          if (G().switchLocation(l.id)) { FG.render.renderAll(); startTicker(); }
        } else {
          openPreview(l.id);
        }
      }, FG.CONFIG.ui.throttleMs));

      const pv = node.querySelector('.loc-preview-btn');
      if (pv) U.onPointer(pv, U.throttleLead(function () { openScenePreview(l.id); }, FG.CONFIG.ui.throttleMs));

      box.appendChild(node);
    });

    // 每 10s 刷一次，让解锁状态/等级变化能自动反映
    startTicker();
  }

  let ticker = 0;
  function startTicker() {
    if (ticker) return;
    ticker = setInterval(function () {
      const box = document.getElementById('location-list');
      if (!box) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const st = G().locationsState();
      const sig = st.map(function (l) { return l.id + (l.current ? 'C' : (l.unlocked ? 'U' : 'L')); }).join('|');
      if (box.getAttribute('data-sig') !== sig) render();
    }, 10000);
  }

  /**
   * 🎬 钓场场景视图（点「预览」打开）：把该钓场的写实插画按 16:9 完整呈现，
   * 并在画中浮漂位置标出 CSS 浮标与涟漪 —— 让玩家先看到"这地方长什么样"，产生探索动力。
   * 仍不可在此钓鱼（未解锁时明确提示所需等级）。
   */
  function openScenePreview(id) {
    const p = G().previewLocation(id);
    const loc = (FG.CONFIG.locations || {})[id];
    if (!p || !loc) { FG.toast('该钓场不存在', 'warn'); return false; }
    const sc = loc.scene || {};
    const img = sc.image || '';
    const bob = sc.bobberAt || { x: 0.5, y: 0.8 };
    const px = (bob.x * 100).toFixed(2) + '%';
    const py = (bob.y * 100).toFixed(2) + '%';

    const fish = p.fish.map(function (f) {
      return '<div class="list-item">' +
        '<span>' + U.safe(f.icon, '🐟') + '</span>' +
        '<span class="li-main">' + U.safe(f.name, '???') + '</span>' +
        '<span class="tag t-' + U.safe(f.rarity, 'common') + '">' +
          U.safe(FG.ENUM.RARITY_NAME[f.rarity], f.rarity) + '</span>' +
      '</div>';
    }).join('');

    FG.modal.open({
      title: '🎬 ' + p.emoji + ' ' + p.name + ' · 场景预览',
      wide: true,
      body:
        '<div class="lp-scene-wrap">' +
          '<div class="lp-scene" style="background-image:url(\'' + img + '\')">' +
            '<span class="lp-ripple" style="left:' + px + '; top:' + py + '"></span>' +
            '<span class="lp-bobber" style="left:' + px + '; top:' + py + '"></span>' +
            '<span class="lp-scene-chip">🎣 场景预览 · 不可作钓</span>' +
          '</div>' +
          '<div class="li-sub" style="text-align:center;margin-top:6px">「' + U.safe(p.desc, '') + '」</div>' +
        '</div>' +
        '<div class="stat-row"><span>解锁等级</span><b>Lv.' + U.formatInt(p.needLevel) + '</b></div>' +
        '<div class="stat-row"><span>鱼种</span><b>' + p.fish.length + ' 种</b></div>' +
        '<div class="stat-row"><span>状态</span><b class="' + (p.unlocked ? 'ok-text' : 'err-text') + '">' +
          (p.unlocked ? (p.current ? '当前钓场' : '已解锁') : '🔒 未解锁') + '</b></div>' +
        '<div class="card-title" style="margin-top:8px"><span>盛产鱼类</span><span class="li-sub">❓ 为尚未收录</span></div>' +
        '<div class="lp-fish">' + (fish || '<div class="empty-tip">暂无记录</div>') + '</div>' +
        (p.unlocked ? '' :
          '<div class="empty-tip">🔒 需要 Lv.' + U.formatInt(p.needLevel) + ' 解锁，暂不能在此钓鱼</div>') +
        '<div class="modal-foot-inline">' +
          '<button class="btn btn-primary" id="lp-go">' + (p.unlocked ? '📍 前往该钓场' : '📋 查看解锁条件') + '</button>' +
        '</div>',
      showCancel: false,
      onClose: function () { FG.render.renderAll(); }
    });

    const go = document.getElementById('lp-go');
    if (go) {
      U.onPointer(go, U.throttleLead(function () {
        if (p.unlocked) {
          if (G().switchLocation(id)) { FG.modal.close(true); FG.render.renderAll(); startTicker(); }
        } else {
          openPreview(id);                       // 未解锁 → 看解锁条件（信息弹窗）
        }
      }, FG.CONFIG.ui.throttleMs));
    }
    return true;
  }

  /** 未解锁钓场预览浮层（信息：解锁等级 + 鱼种，可预览不可钓鱼） */
  function openPreview(id) {
    const p = G().previewLocation(id);
    if (!p) { FG.toast('该钓场不存在', 'warn'); return; }

    const fish = p.fish.map(function (f) {
      return '<div class="list-item">' +
        '<span>' + U.safe(f.icon, '🐟') + '</span>' +
        '<span class="li-main">' + U.safe(f.name, '???') + '</span>' +
        '<span class="tag t-' + U.safe(f.rarity, 'common') + '">' +
          U.safe(FG.ENUM.RARITY_NAME[f.rarity], f.rarity) + '</span>' +
      '</div>';
    }).join('');

    FG.modal.open({
      title: p.emoji + ' ' + p.name,
      body:
        '<div class="loc-preview">' +
          '<div class="lp-desc">「' + U.safe(p.desc, '') + '」</div>' +
          '<div class="stat-row"><span>解锁等级</span><b>Lv.' + U.formatInt(p.needLevel) + '</b></div>' +
          '<div class="stat-row"><span>鱼种</span><b>' + p.fish.length + ' 种</b></div>' +
          '<div class="li-sub" style="margin:8px 0 4px">盛产鱼类（❓ 为尚未收录）</div>' +
          '<div class="lp-fish">' + (fish || '<div class="empty-tip">暂无记录</div>') + '</div>' +
          '<div class="empty-tip">🔒 需要 Lv.' + U.formatInt(p.needLevel) + ' 解锁，暂不能在此钓鱼</div>' +
          '<div class="modal-foot-inline">' +
            '<button class="btn btn-primary" id="lp-scene">🎬 查看场景</button>' +
          '</div>' +
        '</div>',
      showCancel: false
    });

    const scBtn = document.getElementById('lp-scene');
    if (scBtn) U.onPointer(scBtn, U.throttleLead(function () { openScenePreview(id); }, FG.CONFIG.ui.throttleMs));
    return true;
  }

  ui.locations = {
    render: render,
    openPreview: openPreview,
    openScenePreview: openScenePreview,
    startTicker: startTicker
  };
})(window.FG = window.FG || {});
