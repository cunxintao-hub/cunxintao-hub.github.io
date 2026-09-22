/* ============================================================
   src/ui/craftBoard.js · 04 配方合成界面（左栏分类页签 / 主舞台 2 列配方卡 / 右栏配方详情）
   职责：只渲染与派发，规则与事务都在 systems.craft（连点由 craft 的结果锁 + 这里的前置节流双保险）
   ============================================================ */
(function (FG) {
  'use strict';
  const U = FG.utils;
  const ui = FG.ui = FG.ui || {};
  const C = () => FG.systems.craft;

  const state = { category: 'rod', hover: null };
  const PERCENT = { stealth: 1, bonus: 1, accuracy: 1 };   // 按百分比展示的属性

  /* ---------------- 分类页签（左栏） ---------------- */

  function renderCategories() {
    const box = document.getElementById('craft-categories');
    if (!box) return;
    const stats = C().categoryStats();
    const cats = FG.CONFIG.craft.categories || [];
    const sig = cats.map(function (c) { return c + stats[c].total + stats[c].craftable; }).join('|') + state.category;
    if (box.getAttribute('data-sig') === sig) return;
    box.setAttribute('data-sig', sig);
    box.innerHTML = '';
    cats.forEach(function (c) {
      const st = stats[c] || { total: 0, craftable: 0 };
      const active = state.category === c;
      const node = U.el('div', { class: 'list-item clickable' + (active ? ' active' : ''), 'data-cat': c },
        '<span>' + (FG.CONFIG.craft.categoryIcon[c] || '📦') + '</span>' +
        '<span class="li-main">' + (FG.CONFIG.craft.categoryName[c] || c) +
          '<div class="li-sub">' + st.total + ' 个配方' + (st.craftable ? ' · 可合成 ' + st.craftable : '') + '</div>' +
        '</span>' +
        (st.craftable ? '<span class="badge-dot">' + st.craftable + '</span>' : ''));
      U.onPointer(node, U.throttleLead(function () {
        state.category = c;
        renderCategories();
        renderCards();
      }, 200));
      box.appendChild(node);
    });
  }

  /* ---------------- 配方卡片（主舞台 2 列） ---------------- */

  function renderCards() {
    const box = document.getElementById('craft-grid');
    if (!box) return;
    const list = C().listRecipes(state.category);
    if (!list.length) {
      box.innerHTML = '<div class="empty-tip">该分类暂无配方' +
        (state.category === 'net' ? '（渔网首版不做，后续版本开放）' : '') + '</div>';
      return;
    }
    box.innerHTML = '';
    list.forEach(function (r) { box.appendChild(buildCard(r)); });
  }

  function buildCard(r) {
    const card = U.el('div', {
      class: 'craft-item glow-' + r.rarity +
        (r.craftable ? ' craftable' : '') + (r.unlocked ? '' : ' locked'),
      'data-id': r.id
    });

    const cost = r.cost.map(function (c) {
      return '<span class="ci-cost-item' + (c.enough ? '' : ' lack') + '">' +
        c.icon + ' ' + c.name + ' ' + c.own + '/' + c.need + '</span>';
    }).join('');

    const statKeys = Object.keys(r.stats || {});
    const stats = statKeys.length ? statKeys.map(function (k) {
      return U.safe(FG.ENUM.STAT_ICON[k], '') +
        U.safe(FG.ENUM.statName ? FG.ENUM.statName(r.type, k) : FG.ENUM.STAT_NAME[k], k) + ':' +
        r.stats[k] + (PERCENT[k] ? '%' : '');
    }).join(' ｜ ') : '无属性';

    let foot;
    if (!r.unlocked) {
      foot = '<button class="btn" disabled>🔒 需要 Lv.' + r.unlockLevel + '</button>';
    } else if (!r.enough) {
      foot = '<button class="btn" disabled>材料不足</button>';
    } else {
      foot = '<button class="btn btn-primary craft-btn" data-craft="' + r.id + '">🔨 合成</button>';
    }

    card.innerHTML =
      '<div class="ci-head">' +
        '<span class="ci-icon">' + r.icon + '</span>' +
        '<span class="ci-title"><b>' + r.name + '</b>' +
          ' <span class="tag t-' + r.rarity + '">' + U.safe(FG.ENUM.RARITY_NAME[r.rarity], r.rarity) + '</span></span>' +
        '<span class="li-sub">已拥有: ' + U.formatInt(r.owned) + '</span>' +
      '</div>' +
      '<div class="ci-cost">' + cost + '</div>' +
      '<div class="ci-stats">' + stats + '</div>' +
      (r.unlocked ? '' : '<div class="ci-lock">🔒 需要 Lv.' + r.unlockLevel + '</div>') +
      '<div class="ci-foot">' + foot + '</div>';

    const btn = card.querySelector('.craft-btn');
    if (btn) {
      U.onPointer(btn, U.throttleLead(function () { doCraft(r.id); }, FG.CONFIG.ui.throttleMs));
    }
    card.addEventListener('pointerenter', function () { state.hover = r.id; renderDetail(); });
    return card;
  }

  function doCraft(id) {
    const before = FG.bag.getCount('equipment', id);
    const ok = C().craft(id);
    if (ok) {
      const after = FG.bag.getCount('equipment', id);
      console.log('[craftBoard] craft', id, before, '→', after);
    }
    renderAll();
  }

  /* ---------------- 右栏详情 ---------------- */

  function renderDetail() {
    const box = document.getElementById('craft-detail');
    if (!box) return;
    const id = state.hover;
    const list = C().listRecipes();
    const r = list.filter(function (x) { return x.id === id; })[0];
    if (!r) {
      box.innerHTML = '<div class="empty-tip">把鼠标移到配方卡上看详细属性与材料缺口</div>';
      return;
    }
    const statKeys = Object.keys(r.stats || {});
    box.innerHTML =
      '<div class="merge-detail-head">' +
        '<span class="md-icon">' + r.icon + '</span>' +
        '<span><b>' + r.name + '</b><div class="li-sub">' +
        U.safe(FG.ENUM.RARITY_NAME[r.rarity], r.rarity) + ' · ' +
        (FG.CONFIG.craft.categoryName[r.type] || r.type) + '</div></span>' +
      '</div>' +
      statKeys.map(function (k) {
        return '<div class="stat-row"><span>' + U.safe(FG.ENUM.statName ? FG.ENUM.statName(r.type, k) : FG.ENUM.STAT_NAME[k], k) +
          '</span><b>' + r.stats[k] + (PERCENT[k] ? '%' : '') + '</b></div>';
      }).join('') +
      '<div class="card-title" style="margin-top:10px"><span>材料</span></div>' +
      r.cost.map(function (c) {
        return '<div class="stat-row"><span>' + c.icon + ' ' + c.name + '</span><b class="' +
          (c.enough ? '' : 'err-text') + '">' + c.own + ' / ' + c.need + '</b></div>';
      }).join('') +
      '<div class="stat-row"><span>已拥有</span><b>' + U.formatInt(r.owned) + '</b></div>' +
      '<div class="stat-row"><span>解锁</span><b>' + (r.unlocked ? '已解锁' : '🔒 需要 Lv.' + r.unlockLevel) + '</b></div>' +
      (r.craftable ? '' : '<div class="li-sub" style="margin-top:6px">' +
        (r.unlocked ? '材料不足：' + C().missingText(r.missing) : '等级未达到，无法合成') + '</div>');
  }

  /* ---------------- 对外 ---------------- */

  function renderAll() {
    renderCategories();
    renderCards();
    renderDetail();
  }

  /** 切到指定分类（调试/直达用） */
  function setCategory(cat) {
    if ((FG.CONFIG.craft.categories || []).indexOf(cat) === -1) return false;
    state.category = cat;
    renderAll();
    return true;
  }

  ui.craftBoard = {
    render: renderAll,
    setCategory: setCategory,
    getCategory: function () { return state.category; },
    renderCategories: renderCategories,
    renderCards: renderCards,
    renderDetail: renderDetail,
    getCategory: function () { return state.category; },
    setCategory: function (c) { state.category = c; renderAll(); }
  };
})(window.FG = window.FG || {});
