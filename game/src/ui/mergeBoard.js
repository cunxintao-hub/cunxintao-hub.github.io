/* ============================================================
   src/ui/mergeBoard.js · 03 合成台界面（材料网格 / 体力操作区 / 物品详情）
   职责：只负责 DOM 与交互，规则判定全部走 systems.merge
   交互：
     - 拖拽：pointerdown 按住拖动 → 松开落格（统一 pointer 事件，10 §5）
     - 点选：点 A 再点 B（无拖拽环境下的降级交互，03 §2）
     - 位移超过阈值判定为拖拽，否则视为点击选中
   ============================================================ */
(function (FG) {
  'use strict';
  const U = FG.utils;
  const ui = FG.ui = FG.ui || {};
  const M = () => FG.systems.merge;

  const state = {
    selected: -1,        // 点选模式的第一个格子
    dragFrom: -1,        // 拖拽源格子
    dragMoved: false,
    dragStart: { x: 0, y: 0 },
    dragging: false,
    ticker: 0,
    hoverDetail: null
  };

  /* ---------------- 渲染 ---------------- */

  function render() {
    const box = document.getElementById('merge-grid');
    if (box) buildGrid(box);
    renderStats();
    renderActions();
    renderDetail();
  }

  function buildGrid(box) {
    const cfg = FG.CONFIG.merge;
    const s = FG.getState();
    const items = {};
    M().grid().forEach(function (it) { items[it.cell] = it; });
    const size = M().boardSize();                 // 36 + 「仓库扩容」技能加成
    if (box.children.length !== size) {
      box.innerHTML = '';
      for (let i = 0; i < size; i++) {
        box.appendChild(U.el('div', { class: 'merge-cell', 'data-cell': i }));
      }
    }
    box.style.gridTemplateColumns = 'repeat(' + cfg.gridCols + ', ' + cfg.cellSize + 'px)';
    for (let i = 0; i < size; i++) {
      const cell = box.children[i];
      const it = items[i];
      const occupied = !!it;
      cell.classList.toggle('occupied', occupied);
      cell.classList.toggle('selected', state.selected === i);
      cell.classList.toggle('empty', !occupied);
      if (occupied) {
        const m = M().materialMeta(it.id) || { name: it.id, icon: '❔', rarity: 'common', level: 1 };
        const canHarvest = M().isHarvestable(it);   // Lv.3+ 才可收
        cell.className = 'merge-cell occupied glow-' + m.rarity +
          (canHarvest ? ' harvestable' : '') + (state.selected === i ? ' selected' : '') +
          (state.dragMoved && state.dragFrom === i ? ' dragging' : '');   // 拖拽中：源格子保持「被提起」
        cell.innerHTML = '<span class="mc-icon">' + m.icon + '</span>' +
          '<span class="mc-name">' + U.safe(m.name, it.id) + '</span>' +
          '<span class="mc-lv">Lv.' + U.formatInt(it.level || m.level) + '</span>' +
          (canHarvest ? '<span class="mc-harvest" title="Lv.' + M().harvestMinLevel() + '+，可收获">📦</span>' : '');
      } else {
        cell.className = 'merge-cell empty' + (state.selected === i ? ' selected' : '');
        cell.innerHTML = '<span class="mc-empty-mark">+</span>';
      }
      cell.setAttribute('data-cell', i);
    }
    void s;
  }

  function renderStats() {
    const box = document.getElementById('merge-stats');
    if (!box) return;
    const s = FG.getState();
    const unlocked = M().unlockedChains().length;
    const totalChains = (FG.CONFIG.merge.chainOrder || []).length;
    const st = M().chargesState();
    const auto = FG.CONFIG.merge.autoSpawn || {};
    // 统计条格式对齐参考实现：空位: 36/36　链: 2/8　合成: 0 次
    box.innerHTML =
      stat('空位', M().emptyCount() + '/' + M().boardSize()) +
      stat('链', unlocked + '/' + totalChains) +
      stat('合成', U.formatInt(s.mergeCount || 0) + ' 次') +
      stat('体力', '⛏️' + st.dig + '/' + st.digMax + '　🌿' + st.gather + '/' + st.gatherMax + (st.countdown ? '（' + st.countdown + '）' : '')) +
      stat('自动生成', auto.enabled === false ? '已关闭' : '每 ' + ((auto.intervalMs || 10000) / 1000) + 's');
  }
  function stat(label, value) {
    return '<span class="merge-stat"><i>' + label + ':</i><b>' + U.safe(value, '-') + '</b></span>';
  }

  function renderActions() {
    const box = document.getElementById('merge-actions');
    if (!box) return;
    const st = M().chargesState();
    const empty = M().emptyCount();
    const full = empty <= 0;
    const per = FG.CONFIG.merge.producePerAction || 3;
    const rows = [
      { act: 'dig', icon: '⛏️', name: '挖掘', sub: '随机 ' + per + ' 个 · ' + st.dig + '/' + st.digMax, disabled: st.dig <= 0 || full },
      { act: 'gather', icon: '🌿', name: '采集', sub: '随机 ' + per + ' 个 · ' + st.gather + '/' + st.gatherMax, disabled: st.gather <= 0 || full },
      { act: 'harvest', icon: '📦', name: '一键收获',
        sub: '收 Lv.' + M().harvestMinLevel() + '+ 材料 · 可收 ' + M().harvestableCount() + ' 件',
        disabled: M().harvestableCount() <= 0,
        hint: M().harvestableCount() <= 0 ? '暂无可收' : '' },   // 禁用原因是"没得收"，不要显示体力倒计时
      { act: 'charges', icon: '🔋', name: '补充探索次数',
        sub: '金币快速补充 · 当前 ⛏️' + st.dig + '/' + st.digMax + ' 🌿' + st.gather + '/' + st.gatherMax },
      { act: 'chains', icon: '📋', name: '合成链', sub: '查看 ' + (FG.CONFIG.merge.chainOrder || []).length + ' 条链' },
      { act: 'buy', icon: '🛒', name: '购买材料', sub: '市场（07）' },
      { act: 'clear', icon: '🗑️', name: '清空合成台', sub: M().grid().length + ' 件' }
    ];
    if ((FG.CONFIG.debug || {}).showGrantButton) {
      rows.push({ act: 'grant', icon: '🧪', name: '补给材料', sub: '调试用', debug: true });
    }

    const sig = rows.map(function (r) { return r.act + (r.disabled ? '0' : '1') + r.sub; }).join('|');
    if (box.getAttribute('data-sig') === sig) return;      // 内容未变不重建，避免打断点击
    box.setAttribute('data-sig', sig);
    box.innerHTML = '';
    rows.forEach(function (r) {
      const node = U.el('div', { class: 'list-item clickable' + (r.debug ? ' debug-row' : '') },
        '<span>' + r.icon + '</span>' +
        '<span class="li-main">' + r.name + (r.debug ? ' <span class="tag">调试</span>' : '') +
          '<div class="li-sub">' + r.sub + '</div></span>' +
        (r.disabled ? '<span class="li-sub">' + U.safe(r.hint, '') + (r.hint ? '' : (st.countdown ? st.countdown : '不足')) + '</span>' : ''));
      if (r.disabled) node.classList.add('disabled');
      U.onPointer(node, U.throttleLead(function () { onAction(r.act); }, FG.CONFIG.ui.throttleMs));
      box.appendChild(node);
    });
  }

  function renderDetail() {
    const box = document.getElementById('merge-detail');
    if (!box) return;
    const cell = state.hoverDetail != null ? state.hoverDetail : state.selected;
    const it = cell >= 0 ? M().itemAt(cell) : null;
    if (!it) { box.innerHTML = '<div class="empty-tip">点击或拖拽格子查看材料详情</div>'; return; }
    const m = M().materialMeta(it.id);
    if (!m) { box.innerHTML = '<div class="empty-tip">未知材料</div>'; return; }
    const next = M().getNextLevelItem(it.id);
    const nextMeta = next ? M().materialMeta(next) : null;
    const gate = m.chain ? M().chainGate(m.chain) : { unlocked: true };
    box.innerHTML =
      '<div class="merge-detail-head">' +
        '<span class="md-icon">' + m.icon + '</span>' +
        '<span><b>' + m.name + '</b><div class="li-sub">' + m.chainName + ' · Lv.' + m.level +
        '　<span class="tag t-' + m.rarity + '">' + U.safe(FG.ENUM.RARITY_NAME[m.rarity], m.rarity) + '</span></div></span>' +
      '</div>' +
      '<div class="li-sub">格子 #' + it.cell + '</div>' +
      '<div class="stat-row"><span>下一级产物</span><b>' +
        (nextMeta ? nextMeta.icon + ' ' + nextMeta.name : '已达最高等级') + '</b></div>' +
      '<div class="stat-row"><span>链条状态</span><b>' +
        (gate.unlocked ? '已解锁' : '🔒 需 Lv.' + gate.needLevel + ' · 合成 ' + gate.needMerge + ' 次') + '</b></div>' +
      '<div class="li-sub">合成台内同种 ' + M().countInGrid(it.id) + ' 个 · 背包 ' + M().countInBag(it.id) + ' 个</div>';
  }

  /* ---------------- 操作 ---------------- */

  function onAction(act) {
    const st = M().chargesState();
    if (act === 'dig') { M().dig(1); afterAction(); return; }
    if (act === 'gather') { M().gather(1); afterAction(); return; }
    if (act === 'harvest') { M().harvestAll(); afterAction(); return; }
    if (act === 'charges') { FG.ui.explore.open(); return; }
    if (act === 'chains') { openChains(); return; }
    if (act === 'buy') {
      FG.ui.layout.switchTab('market');
      FG.toast('🏪 市场（07）将在第 5 轮开放，可先用🧪调试补给', 'warn');
      return;
    }
    if (act === 'clear') {
      const n = M().grid().length;
      if (!n) { FG.toast('合成台已经是空的'); return; }
      FG.modal.confirm('🗑️ 清空合成台', '<div>将丢弃 <b>' + n + ' 件</b>材料，不可恢复。确定清空？</div>', function () {
        M().clearGrid();
        state.selected = -1;
        afterAction();
      });
      return;
    }
    if (act === 'grant') { M().grantDebugMaterials(); afterAction(); return; }
    void st;
  }

  function afterAction() {
    FG.render.renderAll();
    startTicker();
  }

  /** 合成链说明面板 */
  function openChains() {
    const chains = FG.CONFIG.merge.chains;
    let body = '';
    (FG.CONFIG.merge.chainOrder || []).forEach(function (k) {
      const chain = chains[k];
      const gate = M().chainGate(k);
      const items = chain.items.map(function (id) {
        const m = M().materialMeta(id);
        return '<span class="tag t-' + m.rarity + '">' + m.icon + m.name + '</span>';
      }).join(' <span class="li-sub">→</span> ');
      body += '<div class="list-item">' +
        '<span>' + (gate.unlocked ? '✅' : '🔒') + '</span>' +
        '<span class="li-main"><b>' + chain.name + '</b>' +
          '<div class="li-sub">' + (gate.unlocked ? '已解锁' :
            '需 Lv.' + gate.needLevel + ' 且合成 ' + gate.needMerge + ' 次') + '</div>' +
          '<div class="chain-line">' + items + '</div>' +
        '</span></div>';
    });
    FG.modal.open({ title: '📋 合成链', body: body, showCancel: true, cancelText: '关闭' });
  }

  /* ---------------- 拖拽 + 点选 ---------------- */

  function bind() {
    const grid = document.getElementById('merge-grid');
    if (!grid || grid.getAttribute('data-bound')) return;
    grid.setAttribute('data-bound', '1');
    ensureDragLayer();                       // 跟随层挪到 body，避免被 #app 的 scale 干扰

    grid.addEventListener('pointerdown', function (e) {
      const cell = e.target.closest ? e.target.closest('.merge-cell') : null;
      if (!cell) return;
      e.preventDefault();
      const idx = parseInt(cell.getAttribute('data-cell'), 10);
      state.dragStart = { x: e.clientX, y: e.clientY };
      state.dragMoved = false;
      state.dragging = true;
      if (M().itemAt(idx)) {
        state.dragFrom = idx;
        try { grid.setPointerCapture && grid.setPointerCapture(e.pointerId); }
        catch (err) { /* 捕获失败也能拖：document 层有兜底监听 */ }
      } else {
        state.dragFrom = -1;                         // 空格子按下：仅用于点选落子
      }
      state.pendingCell = idx;
    });

    grid.addEventListener('pointermove', function (e) {
      if (!state.dragging) return;
      const dx = e.clientX - state.dragStart.x, dy = e.clientY - state.dragStart.y;
      if (!state.dragMoved && Math.abs(dx) + Math.abs(dy) < 8) return;
      if (state.dragFrom < 0) return;
      if (!state.dragMoved) {
        state.dragMoved = true;
        markDragging(state.dragFrom);          // 源格子「被提起」的视觉
      }
      showFollow(e.clientX, e.clientY);        // 跟随鼠标（视口坐标）
      highlight(e.clientX, e.clientY);
    });

    /* 兜底：指针捕获失效时（某些环境/鼠标移出窗口），用 document 层继续跟随与收尾 */
    document.addEventListener('pointermove', function (e) {
      if (!state.dragging || !state.dragMoved || state.dragFrom < 0) return;
      showFollow(e.clientX, e.clientY);
      highlight(e.clientX, e.clientY);
    });
    document.addEventListener('pointerup', function (e) {
      if (!state.dragging || !state.dragMoved) return;
      finishDrag(e.clientX, e.clientY);
    });

    grid.addEventListener('pointerup', function (e) {
      if (!state.dragging) return;
      finishDrag(e.clientX, e.clientY);
    });

    grid.addEventListener('pointercancel', function () {
      state.dragging = false; state.dragFrom = -1; state.dragMoved = false; hideFollow(); render();
    });

    // 悬停 → 右栏物品详情（不重建网格）
    grid.addEventListener('pointerover', function (e) {
      const cell = e.target.closest ? e.target.closest('.merge-cell') : null;
      if (!cell) return;
      const idx = parseInt(cell.getAttribute('data-cell'), 10);
      if (state.hoverDetail !== idx) { state.hoverDetail = idx; renderDetail(); }
    });

    // 键盘：Esc 取消选中
    document.addEventListener('keydown', function (e) {
      if (e.code === 'Escape' && state.selected >= 0) { clearSelection(); render(); }
    });
  }

  /** 统一的松手处理（网格内 pointerup 与 document 兜底共用） */
  function finishDrag(x, y) {
    state.dragging = false;
    hideFollow();
    const target = cellUnder(x, y);
    const from = state.dragFrom;
    const pending = state.pendingCell;
    state.dragFrom = -1;
    state.pendingCell = -1;

    if (state.dragMoved) {
      if (from >= 0 && target >= 0) resolve(from, target, 'drag');
    } else if (from >= 0) {
      selectOrMerge(from);                          // 点 A 再点 B
    } else if (pending >= 0) {
      clearSelection();
    }
    state.dragMoved = false;
    render();
  }

  function cellUnder(x, y) {
    let el = null;
    try { el = document.elementFromPoint(x, y); } catch (e) { el = null; }   // 某些环境不支持
    const cell = el && el.closest ? el.closest('.merge-cell') : null;
    return cell ? parseInt(cell.getAttribute('data-cell'), 10) : -1;
  }

  function highlight(x, y) {
    const grid = document.getElementById('merge-grid');
    if (!grid) return;
    const t = cellUnder(x, y);
    for (let i = 0; i < grid.children.length; i++) {
      grid.children[i].classList.toggle('drop-target', i === t);
    }
  }

  /** 点选模式：第一次选中，第二次尝试合并 */
  function selectOrMerge(cell) {
    if (state.selected < 0) {
      state.selected = cell;
      state.hoverDetail = cell;
      FG.toast('已选中，再点一个相同的材料即可合并', 'ok');
      return;
    }
    if (state.selected === cell) { clearSelection(); return; }
    const from = state.selected;
    clearSelection();
    resolve(from, cell, 'tap');
  }

  function clearSelection() {
    const grid = document.getElementById('merge-grid');
    if (grid) for (let i = 0; i < grid.children.length; i++) grid.children[i].classList.remove('drop-target', 'selected');
    state.selected = -1;
  }

  /** 统一落子处理：结果 → 文案与动画 */
  function resolve(from, to, via) {
    const res = M().applyDrop(from, to);
    const grid = document.getElementById('merge-grid');
    console.log('[mergeBoard] drop', from, '→', to, via, res.reason);
    if (res.ok) {
      if (res.merged) {
        const cell = grid && grid.children[to];
        if (cell) { cell.classList.add('pop'); setTimeout(function () { cell.classList.remove('pop'); }, 400); }
      }
      afterAction();
      return;
    }
    if (res.reason === 'not-match') {
      const cell = grid && grid.children[from];
      if (cell) { cell.classList.add('shake'); setTimeout(function () { cell.classList.remove('shake'); }, 400); }
      FG.toast('只能合并相同物品', 'warn');
      render();
      return;
    }
    if (res.reason === 'chain-locked') {
      const cell = grid && grid.children[from];
      if (cell) { cell.classList.add('shake'); setTimeout(function () { cell.classList.remove('shake'); }, 400); }
      FG.toast('🔒 该链需要 Lv.' + (res.needLevel || 0) + ' 且合成 ' + (res.needMerge || 0) + ' 次后解锁', 'warn');
      render();
      return;
    }
    if (res.reason === 'max-level') { FG.toast('已达最高等级', 'warn'); return; }
    render();
  }

  /* ---------------- 拖拽跟随层 ---------------- */

  /**
   * 跟随层挂到 body：#app 有 `transform: scale()`（窗口窄于 1536 时），
   * 会让内部 `position:fixed` 以 #app 为包含块、坐标被缩放 → 幽灵不跟手。
   * 挂到 body 后 left/top 用视口坐标即精确跟随，再按界面缩放补偿视觉大小。
   */
  function ensureDragLayer() {
    const layer = document.getElementById('merge-drag-layer');
    if (layer && layer.parentNode !== document.body) document.body.appendChild(layer);
    return layer;
  }

  /** 当前界面缩放（#app 的 scale），用于让跟随层与界面同比例 */
  function appScale() {
    const app = document.getElementById('app');
    if (!app || !app.offsetWidth) return 1;
    const r = app.getBoundingClientRect();
    return r.width / app.offsetWidth || 1;
  }

  function showFollow(x, y) {
    const layer = ensureDragLayer();
    if (!layer) return;
    const it = M().itemAt(state.dragFrom);
    if (!it) return;
    const m = M().materialMeta(it.id);
    const key = it.id + ':' + (it.level || 1);
    if (layer.getAttribute('data-item') !== key) {      // 只有物品变了才重建，移动时只更新坐标（不闪）
      layer.innerHTML = '<div class="merge-follow">' + m.icon + '<span>' + m.name + ' Lv.' + it.level + '</span></div>';
      layer.setAttribute('data-item', key);
    }
    layer.style.transform = 'scale(' + appScale().toFixed(3) + ')';
    layer.style.left = x + 'px';
    layer.style.top = y + 'px';
    layer.classList.add('show');
  }

  function hideFollow() {
    const layer = document.getElementById('merge-drag-layer');
    if (layer) {
      layer.classList.remove('show');
      layer.innerHTML = '';
      layer.removeAttribute('data-item');
    }
    clearDragging();
    const grid = document.getElementById('merge-grid');
    if (grid) for (let i = 0; i < grid.children.length; i++) grid.children[i].classList.remove('drop-target');
  }

  /** 源格子「被提起」：半透明 + 去掉内容占位感 */
  function markDragging(cell) {
    const grid = document.getElementById('merge-grid');
    if (!grid) return;
    for (let i = 0; i < grid.children.length; i++) {
      grid.children[i].classList.toggle('dragging', i === cell && !!M().itemAt(cell));
    }
  }
  function clearDragging() {
    const grid = document.getElementById('merge-grid');
    if (!grid) return;
    for (let i = 0; i < grid.children.length; i++) grid.children[i].classList.remove('dragging');
  }

  /* ---------------- 体力恢复倒计时 ---------------- */

  function startTicker() {
    const st = M().chargesState();
    const need = st.dig < st.digMax || st.gather < st.gatherMax;
    if (!need) { stopTicker(); return; }
    if (state.ticker) return;
    state.ticker = setInterval(function () {
      if (FG.ui.layout.getActiveTab() !== 'merge') { stopTicker(); return; }
      M().regenCharges();
      render();
    }, 1000);
  }
  function stopTicker() { if (state.ticker) { clearInterval(state.ticker); state.ticker = 0; } }

  /** 悬停格子 → 更新右栏详情（不重建网格） */
  function hover(cell) {
    state.hoverDetail = cell;
    renderDetail();
  }

  ui.mergeBoard = {
    render: render,
    bind: bind,
    hover: hover,
    startTicker: startTicker,
    stopTicker: stopTicker,
    openChains: openChains,
    selected: function () { return state.selected; },
    /** 是否正在拖拽（自动生成 tick 据此避免重建 DOM 打断拖拽） */
    isDragging: function () { return !!(state.dragging && state.dragMoved); }
  };
})(window.FG = window.FG || {});
