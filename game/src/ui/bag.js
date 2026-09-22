/* ============================================================
   src/ui/bag.js · 🎒 背包面板（06 §4）
   四个页签：🐟 鱼类 / 🧱 材料 / 🎣 钓具 / 📦 制品，全部读 state.bag，只读不改。
   - 材料卡带来源标签：自然 / 加工 / 饵料（CONFIG.materialTag + 等级推导）
   - 钓具卡显示「已装备」标记（禁止在背包内装备，02 §5.1）
   - 只读面板，所以不需要节流；页签切换原地换内容，不关弹窗
   ============================================================ */
(function (FG) {
  'use strict';
  const U = FG.utils;
  const ui = FG.ui = FG.ui || {};

  const TABS = [
    { key: 'fish', icon: '🐟', name: '鱼类' },
    { key: 'materials', icon: '🧱', name: '材料' },
    { key: 'equipment', icon: '🎣', name: '钓具' },
    { key: 'products', icon: '📦', name: '制品' }
  ];
  const TAG_NAME = { natural: '自然', crafted: '加工', bait: '饵料' };
  const TAG_ORDER = { natural: 0, crafted: 1, bait: 2 };

  let active = 'materials';                 // 当前页签（纯 UI 状态，不入档）

  function levelOf(id) {
    const m = FG.systems.merge;
    const meta = m && m.materialMeta ? m.materialMeta(id) : null;
    return (meta && Number(meta.level)) || 1;
  }

  /** 材料标签：配置优先（饵料 > 自然），其余按等级推导（Lv.1 自然，Lv.2+ 加工） */
  function tagOf(id) {
    const t = FG.CONFIG.materialTag || {};
    if ((t.bait || []).indexOf(id) !== -1) return 'bait';
    if ((t.natural || []).indexOf(id) !== -1) return 'natural';
    return levelOf(id) <= 1 ? 'natural' : 'crafted';
  }

  /* ---------------- 卡片 ---------------- */

  function card(icon, name, count, tagKey, extra) {
    return '<div class="bag-card">' +
      (tagKey ? '<span class="bag-tag tag-' + tagKey + '">' + U.safe(TAG_NAME[tagKey], tagKey) + '</span>' : '') +
      (extra || '') +
      '<span class="bag-ico">' + U.safe(icon, '❔') + '</span>' +
      '<b class="bag-name">' + U.safe(name, '?') + '</b>' +
      '<span class="bag-num">×' + U.formatInt(count) + '</span>' +
    '</div>';
  }

  function materialsHtml() {
    const list = FG.bag.list('materials');
    if (!list.length) {
      return '<div class="empty-tip">背包里还没有材料<br>' +
        '去「材料二合」把材料合到 Lv.3 以上，再点 📦 一键收获</div>';
    }
    const dict = FG.CONFIG.materials || {};
    const rows = list.map(function (e) {
      const m = dict[e.id] || {};
      return { id: e.id, count: e.count, icon: m.icon, name: m.name, tag: tagOf(e.id) };
    }).sort(function (a, b) {
      const t = (TAG_ORDER[a.tag] || 0) - (TAG_ORDER[b.tag] || 0);
      if (t) return t;
      return String(a.id) < String(b.id) ? -1 : 1;
    });
    return rows.map(function (r) {
      return card(r.icon, r.name || r.id, r.count, r.tag);
    }).join('');
  }

  function fishHtml() {
    const list = FG.bag.list('fish');
    if (!list.length) return '<div class="empty-tip">还没有渔获——去「钓鱼」页抛竿吧</div>';
    const dict = FG.CONFIG.fish || {};
    const codex = (FG.getState().codex || {}).fish || {};
    return list.map(function (e) {
      const f = dict[e.id] || {};
      const known = !!codex[e.id];
      const star = FG.ENUM.RARITY_STAR[f.rarity] || 1;
      const extra = '<span class="bag-stars" title="' + U.safe(FG.ENUM.RARITY_NAME[f.rarity], f.rarity) + '">' +
        new Array(star + 1).join('★') + (known ? '' : '<span class="bag-lock">未收录</span>') + '</span>';
      return card(f.icon, f.name || e.id, e.count, null, extra);
    }).join('');
  }

  function equipmentHtml() {
    const list = FG.bag.list('equipment');
    if (!list.length) return '<div class="empty-tip">还没有钓具——去「合成」页按配方制作</div>';
    const dict = FG.CONFIG.items || {};
    const equipped = FG.getState().equipped || {};
    const rows = list.map(function (e) {
      const it = dict[e.id] || {};
      let own = null;
      FG.ENUM.SLOTS.forEach(function (slot) { if (equipped[slot] === e.id) own = slot; });
      return { id: e.id, count: e.count, icon: it.icon, name: it.name, type: it.type, own: own };
    });
    return rows.map(function (r) {
      const extra = r.own
        ? '<span class="bag-badge">已装备·' + U.safe(FG.ENUM.SLOT_NAME[r.own], r.own) + '</span>'
        : '<span class="bag-badge ghost">' + U.safe((FG.CONFIG.craft.categoryName || {})[r.type], r.type || '') + '</span>';
      return card(r.icon, r.name || r.id, r.count, null, extra);
    }).join('');
  }

  function productsHtml() {
    const list = FG.bag.list('products');
    if (!list.length) {
      return '<div class="empty-tip">暂无制品<br>工坊 Lv.' +
        U.safe((FG.CONFIG.workshop || {}).unlockLevel, 10) + ' 解锁后可加工（06）</div>';
    }
    return list.map(function (e) {
      return card('📦', e.id, e.count, null);
    }).join('');
  }

  function countText() {
    const list = FG.bag.list(active);
    const total = list.reduce(function (s, e) { return s + e.count; }, 0);
    return list.length + ' 种 · 合计 ' + U.formatInt(total) + ' 件';
  }

  function gridHtml() {
    if (active === 'fish') return fishHtml();
    if (active === 'equipment') return equipmentHtml();
    if (active === 'products') return productsHtml();
    return materialsHtml();
  }

  function bodyHtml() {
    const tabs = TABS.map(function (t) {
      return '<button class="bag-tab' + (t.key === active ? ' active' : '') + '" data-tab="' + t.key + '">' +
        t.icon + ' ' + t.name + '</button>';
    }).join('');
    const nonEmpty = FG.bag.list(active).length > 0;
    return '<div class="bag-tabs">' + tabs + '</div>' +
      '<div class="bag-meta">' + countText() + '</div>' +
      '<div class="bag-grid' + (nonEmpty ? '' : ' empty') + '">' + gridHtml() + '</div>';
  }

  /** 页签切换 / 余额刷新：只重绘 body，弹窗不关闭 */
  function refresh(layer) {
    const body = layer.querySelector('.modal-body');
    if (!body) return;
    body.innerHTML = bodyHtml();
    bind(layer);
  }

  function bind(layer) {
    const tabs = layer.querySelectorAll('.bag-tab');
    for (let i = 0; i < tabs.length; i++) {
      const btn = tabs[i];
      U.onPointer(btn, function () {
        const key = btn.getAttribute('data-tab');
        if (TABS.every(function (t) { return t.key !== key; })) return;
        active = key;
        refresh(layer);
      });
    }
  }

  /**
   * 打开背包面板
   * @param {string} [tab] 指定初始页签（fish/materials/equipment/products）
   */
  function open(tab) {
    if (tab && TABS.some(function (t) { return t.key === tab; })) active = tab;
    FG.modal.open({
      title: '🎒 背包',
      body: bodyHtml(),
      showCancel: false,
      wide: true
    });
    const layer = document.getElementById('modal-layer');
    if (layer) bind(layer);
    return true;
  }

  ui.bag = { open: open, tagOf: tagOf, bodyHtml: bodyHtml, TABS: TABS };
})(window.FG = window.FG || {});
