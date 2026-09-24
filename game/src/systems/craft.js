/* ============================================================
   src/systems/craft.js · 04 钓具配方合成
   职责：按配方把材料合成为装备；等级解锁展示；材料拥有/需求计算；首次合成写图鉴奖励
   依赖：CONFIG.craft.recipes / CONFIG.items、systems.merge（材料账本与事务快照）
   约束：
     - 扣减与产出在同一事务，任一步失败 → 回滚（10 §8 / 04 §6）
     - 结果锁：上一次未完成时不接受新请求（10 §4），禁止连点重复扣材料
     - 产出只进 bag.equipment，不自动装备（04 §7）
   边界：不做材料产出（03）、不做装备切换（02）、不做渔网配方（空态提示）
   ============================================================ */
(function (FG) {
  'use strict';
  const S = FG.systems = FG.systems || {};
  const U = FG.utils;

  let busy = false;                 // 结果锁

  function cfg() { return FG.CONFIG.craft || {}; }
  function recipes() { return cfg().recipes || []; }
  function itemDef(id) { return (FG.CONFIG.items || {})[id] || null; }
  function materialDef(id) { return (FG.CONFIG.materials || {})[id] || null; }

  function findRecipe(recipeId) {
    const list = recipes();
    for (let i = 0; i < list.length; i++) if (list[i].id === recipeId) return list[i];
    return null;
  }

  /** 等级解锁判定 */
  function isUnlocked(r) {
    if (!r) return false;
    if (cfg().lockByLevel === false) return true;
    return (FG.getState().level || 1) >= (r.unlockLevel || 0);
  }

  /** 材料明细：拥有 / 需求 / 是否充足（供 UI 显示红色缺项） */
  function costDetail(r) {
    const merge = FG.systems.merge;
    return Object.keys(r.cost || {}).map(function (id) {
      const need = r.cost[id];
      const own = merge ? merge.countOwned(id) : 0;
      const d = materialDef(id) || { name: id, icon: '❔' };
      return { id: id, name: d.name, icon: d.icon, own: own, need: need, enough: own >= need };
    });
  }

  /**
   * 配方列表（可按分类过滤）
   * @param {string} [category] rod/hook/bait/line/net/other
   */
  function listRecipes(category) {
    return recipes().filter(function (r) {
      if (!category) return true;
      const it = itemDef(r.id);
      return it && it.type === category;
    }).map(function (r) {
      const it = itemDef(r.id) || { name: r.id, icon: '❔', type: 'other', rarity: 'common', stats: {} };
      const cost = costDetail(r);
      const unlocked = isUnlocked(r);
      const enough = cost.every(function (c) { return c.enough; });
      return {
        id: r.id, name: it.name, icon: it.icon, type: it.type, rarity: it.rarity,
        stats: it.stats || {}, cost: cost,
        owned: FG.bag.getCount('equipment', r.id),
        unlockLevel: r.unlockLevel || 0, unlocked: unlocked,
        enough: enough,
        craftable: unlocked && enough && cfg().allowDuplicateCraft !== false,
        missing: cost.filter(function (c) { return !c.enough; })
      };
    });
  }

  /** 分类统计：每类配方数与可合成数（用于左栏页签角标） */
  function categoryStats() {
    const out = {};
    (cfg().categories || []).forEach(function (c) {
      const list = listRecipes(c);
      out[c] = { total: list.length, craftable: list.filter(function (r) { return r.craftable; }).length };
    });
    return out;
  }

  /** 能否合成：{ ok, reason, missing } */
  function canCraft(recipeId) {
    const r = findRecipe(recipeId);
    if (!r) return { ok: false, reason: 'no-recipe', missing: [] };
    if (!isUnlocked(r)) return { ok: false, reason: 'locked', needLevel: r.unlockLevel || 0, missing: [] };
    const merge = FG.systems.merge;
    const chk = merge ? merge.checkCost(r.cost) : { ok: false, missing: [] };
    if (!chk.ok) return { ok: false, reason: 'lack', missing: chk.missing };
    return { ok: true, reason: 'ok', missing: [] };
  }

  /**
   * 扣减材料（一次性事务）：任一项失败 → 全部回滚
   * @returns {boolean}
   */
  function consumeMaterials(costMap) {
    const merge = FG.systems.merge;
    if (!merge) return false;
    const snap = merge.snapshot();
    const ids = Object.keys(costMap || {});
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (!merge.deduct(id, costMap[id])) {
        merge.restore(snap);
        console.warn('[craft] 材料扣减失败，已回滚', id);
        return false;
      }
    }
    return true;
  }

  /** 缺什么（文案） */
  function missingText(missing) {
    if (!missing || !missing.length) return '';
    return missing.map(function (m) {
      const d = materialDef(m.id) || { name: m.id, icon: '' };
      return d.icon + d.name + ' ' + m.own + '/' + m.need;
    }).join('，');
  }

  /**
   * 合成：校验 → 事务扣减 → 产出 → 首次获得写图鉴奖励
   * @returns {boolean}
   */
  function craft(recipeId) {
    if (busy) { FG.toast('上一次合成还没结束，请稍候', 'warn'); return false; }   // 结果锁
    const r = findRecipe(recipeId);
    if (!r) { console.warn('[craft] 未知配方', recipeId); FG.toast('配方不存在', 'err'); return false; }

    const gate = canCraft(recipeId);
    if (!gate.ok) {
      if (gate.reason === 'locked') { FG.toast('🔒 需要 Lv.' + gate.needLevel + ' 才能合成', 'warn'); return false; }
      if (gate.reason === 'lack') { FG.toast('材料不足：' + missingText(gate.missing), 'warn'); return false; }
      FG.toast('暂时无法合成', 'warn');
      return false;
    }

    busy = true;
    const merge = FG.systems.merge;
    const snap = merge.snapshot();
    try {
      // 1) 扣材料
      if (!consumeMaterials(r.cost)) {
        merge.restore(snap);
        FG.toast('材料扣减失败，已回滚', 'err');
        return false;
      }
      // 2) 产出装备（失败则连材料一起回滚）
      /* 🆕 产出数量可配置（r.yield，默认 1）：饵料是消耗品，一次只出 1 个会「钓两次就没了」 */
      const outN = Math.max(1, Number(r.yield) || 1);
      const before = FG.bag.getCount('equipment', r.id);
      FG.bag.add('equipment', r.id, outN);
      const after = FG.bag.getCount('equipment', r.id);
      if (after !== before + outN) {
        merge.restore(snap);
        FG.bag.remove('equipment', r.id, outN);
        FG.toast('产出异常，已回滚', 'err');
        return false;
      }
      // 3) 首次获得 → 写图鉴奖励（06 负责领取 UI）
      const key = 'equipment_' + r.id;
      const st = FG.getState();
      st.codexRewards = st.codexRewards || {};
      if (!st.codexRewards[key]) {
        st.codexRewards[key] = { diamond: cfg().firstCraftDiamond || 3, claimed: false };
        FG.toast('📖 图鉴奖励可领取！', 'ok');
        console.log('[craft] 首次合成，写入图鉴奖励', key);
        /* 05 §2：首次合成给经验（统一走 growth.addExp，内含升级判定） */
        if (FG.systems.growth && FG.systems.growth.addExp) FG.systems.growth.awardCraft();
      }
      const it = itemDef(r.id) || { name: r.id, icon: '🔨' };
      /* 06 §1.2：钓具首次获得自动收录图鉴 */
      if (FG.systems.codex && FG.systems.codex.recordEquipment) FG.systems.codex.recordEquipment(r.id);
      /* 🆕 产出 >1 时明确报数量（饵料等消耗品） */
      const outCount = Math.max(1, Number(r.yield) || 1);
      FG.toast('🔨 合成成功！获得 ' + it.icon + ' ' + it.name + (outCount > 1 ? ' ×' + outCount : ''), 'ok');
      FG.save.markDirty();
      console.log('[craft] craft', r.id, 'owned →', after);
      FG.render.renderAll();
      return true;
    } catch (e) {
      merge.restore(snap);
      console.warn('[craft] 合成异常，已回滚', e);
      FG.toast('合成异常，已回滚', 'err');
      return false;
    } finally {
      setTimeout(function () { busy = false; }, FG.CONFIG.ui.throttleMs);   // 节流窗口后再解锁
    }
  }

  /** 解锁配方（等级达标即解锁；预留蓝图机制） */
  function unlockRecipe(recipeId) {
    const r = findRecipe(recipeId);
    if (!r) return false;
    if (isUnlocked(r)) return true;
    FG.toast('🔒 需要 Lv.' + (r.unlockLevel || 0) + ' 才能解锁该配方', 'warn');
    return false;
  }

  /** 是否有可合成的配方（用于导航角标/提示） */
  function hasCraftable() {
    return listRecipes().some(function (r) { return r.craftable; });
  }

  S.craft = {
    listRecipes: listRecipes,
    categoryStats: categoryStats,
    canCraft: canCraft,
    craft: craft,
    consumeMaterials: consumeMaterials,
    unlockRecipe: unlockRecipe,
    costDetail: costDetail,
    missingText: missingText,
    findRecipe: findRecipe,
    isUnlocked: isUnlocked,
    hasCraftable: hasCraftable,
    isBusy: function () { return busy; }
  };
})(window.FG = window.FG || {});
