/* ============================================================
   src/systems/equip.js · 02 装备系统（第 2 轮）
   职责：5 个装备槽的穿脱、唯一装备入口面板、饵料消耗与耗尽提示、
        向 01 暴露只读属性查询 getEquipStat(type) / getDerived()
   依赖：CONFIG.equip / CONFIG.items / CONFIG.starterPack、state.equipped / bag.equipment
   约束：
     - 属性加成禁止硬编码，01 必须走 getEquipStat / getDerived（02 §2、§5.3）
     - 扣减先校验充足性，不足不扣、不出现负数（10 §8）
     - 涉及资产的操作节流 ≥300ms（10 §4）
   边界：不做合成（04）、不做购买（07）、不修改钓鱼状态机、渔网槽位仅预留
   ============================================================ */
(function (FG) {
  'use strict';
  const S = FG.systems = FG.systems || {};
  const U = FG.utils;

  /* ---------------- 只读查询 ---------------- */

  function itemTable() { return (FG.CONFIG && FG.CONFIG.items) || {}; }
  function item(id) { return itemTable()[id] || null; }

  /** 槽位当前装备 id（非法槽位回退 null，10 §5） */
  function getEquipped(slot) {
    const key = U.pickValid(slot, FG.ENUM.SLOTS, null, 'equip.getEquipped');
    if (!key) return null;
    const eq = FG.getState().equipped || {};
    return eq[key] || null;
  }

  /**
   * 统一属性查询（02 §2：禁止硬编码）
   * @param {'power'|'accuracy'|'attract'|'tough'|'capacity'|'range'} type
   * @returns {number} 全部已装备物品该属性的合计值
   */
  function getEquipStat(type) {
    const eq = FG.getState().equipped || {};
    let sum = 0;
    FG.ENUM.SLOTS.forEach(function (slot) {
      const it = eq[slot] ? item(eq[slot]) : null;
      if (it && it.stats && typeof it.stats[type] === 'number') sum += it.stats[type];
    });
    return sum;
  }

  /** 全属性快照 { power, accuracy, attract, tough, capacity, range } */
  function getEquipBonus() {
    const out = {};
    FG.ENUM.STATS.forEach(function (t) { out[t] = getEquipStat(t); });
    return out;
  }

  /**
   * 派生玩法数值（02 §5.3）：01 在结算时调用，禁止在 01 里重算
   * @returns {{reelGainPerClick:number,targetWidth:number,biteRate:number,biteWindow:number,bonus:Object}}
   */
  function getDerived() {
    const C = FG.CONFIG, F = C.fishing, E = C.equip;
    const b = getEquipBonus();
    const baseTargetWidth = (F.targetWidthMin + F.targetWidthMax) / 2;   // 绿区基准宽度
    /* 🆕 吸引超过「必咬钩」阈值的部分：原本完全浪费，现在转为缩短等待 */
    const attractNeed = Math.max(0, (1 - F.biteBaseRate) / (E.attractToBiteRate || 1));
    const overflow = Math.max(0, b.attract - attractNeed);
    const waitCut = Math.min(
      Number(E.rangeToWaitReduceCap) || 0.35,
      b.range * (Number(E.rangeToWaitReduce) || 0) + overflow * (Number(E.attractOverflowToWait) || 0)
    );
    return {
      reelGainPerClick: F.reelGainPerClick * (1 + b.power * E.powerToReelGain),
      targetWidth: baseTargetWidth * (1 + b.accuracy * E.accuracyToTargetWidth),
      biteRate: F.biteBaseRate + b.attract * E.attractToBiteRate + b.stealth * (E.stealthToBiteRate || 0),
      biteWindow: F.biteWindow + b.tough * E.toughToBiteWindow,
      /* 🆕 以下三项让 luck / range / bonus（渔网）真正进入玩法 */
      /* 运气 + 饵料吸引 → 稀有（大）鱼概率：吸引力越大越能钓到大鱼 */
      rareBonus: b.luck * (Number(E.luckToRareRate) || 0) + b.attract * (Number(E.attractToRareRate) || 0),
      waitScale: Math.max(0.4, 1 - waitCut),                             // 范围 + 溢出吸引 → 等待缩短
      priceMul: 1 + b.bonus * (Number(E.bonusToFishPrice) || 0),         // 渔网 → 售价加成
      bonus: b
    };
  }

  /** 背包中该槽位可用物品 [{ id, count, item }] */
  function listEquipment(slot) {
    const key = U.pickValid(slot, FG.ENUM.SLOTS, null, 'equip.listEquipment');
    if (!key) return [];
    return FG.bag.list('equipment').map(function (e) {
      return { id: e.id, count: e.count, item: item(e.id) };
    }).filter(function (e) { return e.item && e.item.type === key && e.count > 0; });
  }

  /* ---------------- 穿 / 脱 ---------------- */

  /**
   * 装备：白名单校验槽位与物品类型；渔网槽位（lockedSlots）明确提示未开放
   * 说明：装备/卸下不改变背包数量（背包即持有数），只有抛竿消耗饵料才扣减（02 §3）
   */
  function equipItem(slot, itemId) {
    const key = U.pickValid(slot, FG.ENUM.SLOTS, null, 'equip.equipItem');
    if (!key) return false;
    if ((FG.CONFIG.equip.lockedSlots || []).indexOf(key) !== -1) {
      FG.toast('🥅 渔网槽位尚未开放（结构已预留）', 'warn');
      return false;
    }
    const it = item(itemId);
    if (!it) { console.warn('[equip] 物品不存在', itemId); FG.toast('物品不存在', 'err'); return false; }
    if (it.type !== key) {
      console.warn('[equip] 物品类型与槽位不符', itemId, it.type, key);
      FG.toast('该物品不能装在此槽位', 'warn');
      return false;
    }
    if (FG.bag.getCount('equipment', itemId) <= 0) { FG.toast('持有数量不足', 'warn'); return false; }

    const s = FG.getState();
    if (s.equipped[key] === itemId) { FG.toast('已装备 ' + it.icon + it.name); return false; }

    s.equipped = s.equipped || {};
    s.equipped[key] = itemId;
    FG.save.markDirty();
    if (FG.settings) FG.settings.playCue('click');
    FG.toast('已装备 ' + it.icon + it.name, 'ok');
    console.log('[equip] equip', key, itemId);
    FG.render.renderAll();
    return true;
  }

  /** 卸下：槽位置空，物品仍在背包（数量不变） */
  function unequipItem(slot) {
    const key = U.pickValid(slot, FG.ENUM.SLOTS, null, 'equip.unequipItem');
    if (!key) return false;
    const s = FG.getState();
    const cur = (s.equipped || {})[key];
    if (!cur) { FG.toast(FG.ENUM.SLOT_NAME[key] + '槽位为空'); return false; }
    s.equipped[key] = null;
    FG.save.markDirty();
    FG.toast('已卸下' + FG.ENUM.SLOT_NAME[key], 'ok');
    console.log('[equip] unequip', key);
    FG.render.renderAll();
    return true;
  }

  /* ---------------- 饵料（消耗品） ---------------- */

  /** 当前饵料状态 { id, count, item }，未装备则 id=null */
  function getBaitState() {
    const id = getEquipped('bait');
    if (!id) return { id: null, count: 0, item: null };
    return { id: id, count: FG.bag.getCount('equipment', id), item: item(id) };
  }

  /** 低库存判定（02 §5.2：剩余 ≤ lowStockThreshold） */
  function checkLowStock() {
    const b = getBaitState();
    if (!b.id) return true;
    return b.count <= FG.CONFIG.equip.lowStockThreshold;
  }

  /**
   * 抛竿前校验（01 在 castRod 开头调用）
   * 未装备/数量为 0 → toast「未装备饵料，无法钓鱼」+ 直达装备面板，禁止静默失败
   */
  function prepareCast() {
    const b = getBaitState();
    if (!b.id || b.count <= 0) {
      FG.toast('🎣 未装备饵料，无法钓鱼', 'warn');
      openEquipPanel('bait');
      return false;
    }
    return true;
  }

  /**
   * 成功抛竿后消耗饵料（02 §5.2）
   * 归零 → 自动卸下 + toast + 购买入口；剩余 ≤ 阈值 → 「饵料即将耗尽」
   */
  function consumeBait() {
    const b = getBaitState();
    const need = FG.CONFIG.equip.baitConsumePerCast;
    if (!b.id || b.count < need) { return prepareCast(); }

    if (!FG.bag.remove('equipment', b.id, need)) {      // 扣减前已校验，理论不会失败
      console.warn('[equip] 饵料扣减失败，已中止', b.id);
      return false;
    }
    const left = FG.bag.getCount('equipment', b.id);
    FG.save.markDirty();
    console.log('[equip] 消耗饵料', b.id, '剩余', left);

    if (left <= 0) {
      FG.getState().equipped.bait = null;                 // 自动卸下
      FG.toast('饵料已用完，请装备或购买', 'warn');
      showBaitEmptyPanel(b.item ? b.item.name : '饵料');
    } else if (left <= FG.CONFIG.equip.lowStockThreshold) {
      FG.toast('⚠️ 饵料即将耗尽', 'warn');
    }
    FG.render.renderAll();
    return true;
  }

  /** 饵料归零后的「换一种 / 去合成 / 去购买」出口（都有明确去处，不静默） */
  function showBaitEmptyPanel(baitName) {
    /* 还有别的饵料可换 → 直接开装备面板，比空提示有用 */
    const others = listEquipment('bait');
    FG.modal.open({
      title: '🪱 饵料已用完',
      body: '<div>' + U.safe(baitName, '饵料') + '已用尽，已自动卸下。</div>' +
            '<div class="empty-tip">' +
              (others.length ? '背包里还有 ' + others.length + ' 种饵料可换（点「换一种饵料」）' : '背包里没有其它饵料了') +
              '；也可以去 🔨 合成（一次产出 ' + baitYieldText() + ' 个）或 🏪 市场买红虫 / 玉米</div>',
      showCancel: true,
      cancelText: '关闭',
      onConfirm: function () {
        if (others.length) { openEquipPanel('bait'); return; }
        FG.ui.layout.switchTab('market');
        if (FG.ui.market && FG.ui.market.setTab) { FG.ui.market.setTab('buy'); FG.ui.market.render(); }
        FG.toast('🏪 市场 → 购买材料（红虫 / 玉米可合成饵料）', 'ok');
      },
      confirmText: others.length ? '换一种饵料' : '去市场购买'
    });
  }

  /** 饵料配方的产出数量文案（04 未接入时退回「1」） */
  function baitYieldText() {
    const rs = (FG.CONFIG.craft || {}).recipes || [];
    const bait = rs.filter(function (r) { return (FG.CONFIG.items[r.id] || {}).type === 'bait' && r.yield; });
    if (!bait.length) return '1';
    return bait.map(function (r) { return r.yield; }).sort()[0];
  }

  /* ---------------- 装备面板（唯一入口，02 §5.1） ---------------- */

  /**
   * 打开「选择{类型}」中央浮层（480px）
   * @param {string} slot rod/hook/bait/line/net
   */
  function openEquipPanel(slot) {
    const key = U.pickValid(slot, FG.ENUM.SLOTS, 'bait', 'equip.openEquipPanel');
    const s = FG.getState();
    const name = FG.ENUM.SLOT_NAME[key];
    const cur = (s.equipped || {})[key];
    const list = listEquipment(key);

    let body = '';
    if (!list.length) {
      body = '<div class="empty-tip">暂无可用' + name + '，去合成或购买</div>' +
             '<div class="modal-foot-inline">' +
               '<button class="btn" data-act="craft">🔨 去合成</button>' +
               '<button class="btn" data-act="market">🏪 去购买</button>' +
             '</div>';
    } else {
      list.forEach(function (e) {
        const it = e.item;
        const isCur = e.id === cur;
        const stats = Object.keys(it.stats || {}).map(function (k) {
          return U.safe(FG.ENUM.STAT_ICON[k], '') +
            U.safe(FG.ENUM.statName ? FG.ENUM.statName(it.type, k) : FG.ENUM.STAT_NAME[k], k) + ':' +
            it.stats[k] + (('stealth bonus accuracy'.indexOf(k) !== -1) ? '%' : '');
        }).join('　');
        body += '<div class="list-item clickable eq-row' + (isCur ? ' active' : '') + '" data-id="' + e.id + '">' +
                  '<span class="eq-icon">' + it.icon + '</span>' +
                  '<span class="li-main"><b>' + it.name + '</b>' +
                    ' <span class="tag t-' + it.rarity + '">' + U.safe(FG.ENUM.RARITY_NAME[it.rarity], it.rarity) + '</span>' +
                    '<div class="li-sub">' + stats + '</div>' +
                  '</span>' +
                  '<span class="li-sub">×' + U.formatInt(e.count) + '</span>' +
                '</div>';
      });
      body += '<div class="empty-tip">点击即装备' +
        (key === 'bait' ? '；饵料是消耗品，每次抛竿消耗 ' + (FG.CONFIG.equip.baitConsumePerCast || 1) + ' 个' : '') +
        '</div>';
    }
    if (cur) {
      body += '<div class="modal-foot-inline"><button class="btn" data-act="unequip">卸下当前' + name + '</button></div>';
    }

    FG.modal.open({ title: '选择' + name, body: body, showCancel: true, cancelText: '关闭' });
    bindPanelEvents(key);
    console.log('[equip] openEquipPanel', key, '可选', list.length);
  }

  /** 面板内事件：统一 pointerdown + 节流（10 §4/§6） */
  function bindPanelEvents(key) {
    const layer = document.getElementById('modal-layer');
    if (!layer) return;
    const rows = layer.querySelectorAll('.eq-row');
    for (let i = 0; i < rows.length; i++) {
      (function (row) {
        U.onPointer(row, U.throttleLead(function () {
          equipItem(key, row.getAttribute('data-id'));
          FG.modal.close();
        }, FG.CONFIG.ui.throttleMs));
      })(rows[i]);
    }
    const acts = layer.querySelectorAll('[data-act]');
    for (let j = 0; j < acts.length; j++) {
      (function (btn) {
        U.onPointer(btn, U.throttle(function () {
          const act = btn.getAttribute('data-act');
          FG.modal.close();
          if (act === 'unequip') { unequipItem(key); return; }
          FG.ui.layout.switchTab(act === 'craft' ? 'craft' : 'market');
          FG.toast(act === 'craft' ? '🔨 合成（04）将在第 3 轮开放' : '🏪 市场（07）将在第 5 轮开放', 'warn');
        }, FG.CONFIG.ui.throttleMs));
      })(acts[j]);
    }
  }

  /* ---------------- 新手礼包（02 §6） ---------------- */

  /** 未发放则补发；已发放直接跳过。幂等，可安全多次调用 */
  function ensureStarterPack() {
    const s = FG.getState();
    if (s.starterPackGranted) return false;

    (FG.CONFIG.starterPack || []).forEach(function (gift) {
      if (!item(gift.id)) { console.warn('[equip] 礼包物品缺失', gift.id); return; }
      FG.bag.add('equipment', gift.id, gift.count);
      if (gift.autoEquip) {
        const type = item(gift.id).type;
        if (!(FG.CONFIG.equip.lockedSlots || []).includes(type)) s.equipped[type] = gift.id;
      }
    });
    s.starterPackGranted = true;
    FG.save.markDirty();
    FG.toast('🎁 获得豪华新手礼包！', 'ok');
    FG.toast('初级套装已自动装备', 'ok');
    console.log('[equip] 新手礼包已发放');
    return true;
  }

  S.equip = {
    getEquipped: getEquipped,
    getEquipStat: getEquipStat,
    getEquipBonus: getEquipBonus,
    getDerived: getDerived,
    listEquipment: listEquipment,
    equipItem: equipItem,
    unequipItem: unequipItem,
    openEquipPanel: openEquipPanel,
    getBaitState: getBaitState,
    checkLowStock: checkLowStock,
    prepareCast: prepareCast,
    consumeBait: consumeBait,
    ensureStarterPack: ensureStarterPack
  };
})(window.FG = window.FG || {});
