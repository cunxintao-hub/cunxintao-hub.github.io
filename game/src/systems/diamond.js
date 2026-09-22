/* ============================================================
   src/systems/diamond.js · 💎 钻石系统（商店 + 英雄招募）
   职责：
     - 钻石来源说明 / 金币兑换（三档）
     - 材料捆绑包（钻石价 vs 金币原价，实时算「省 X%」）
     - 自动合成（等级门槛 + 钻石开通 → 挂机自动二合）
     - 英雄招募（等级门槛 + 钻石招募价 → 永久加成）
   依赖：CONFIG.diamond / CONFIG.economy / state.diamond·gold·bag·heroes
   约束：
     - 数值全部来自 config.js（00 §4.1）
     - 扣钻 + 发奖成对完成，失败回滚（10 §8）
     - 每次资产变动 toast（10 §1）+ 飘字（07 §5）；入口由 UI 层节流（10 §4）
   ============================================================ */
(function (FG) {
  'use strict';
  const S = FG.systems = FG.systems || {};
  const U = FG.utils;

  function cfg() { return FG.CONFIG.diamond || {}; }
  function eco() { return FG.CONFIG.economy || {}; }
  function st() { return FG.getState(); }

  function rate() { return Math.max(1, Number(eco().diamondToGold) || 100); }

  function diamond() { return Math.max(0, Number(st().diamond) || 0); }

  function float(text, type) {
    if (FG.ui && FG.ui.float && typeof FG.ui.float.show === 'function') FG.ui.float.show(text, type);
  }

  /* ================= 钻石来源 / 余额 ================= */

  function getSummary() {
    const s = st();
    return {
      diamond: diamond(),
      gold: Math.max(0, Number(s.gold) || 0),
      rate: rate(),
      sources: (cfg().sources || []).slice(),
      heroes: Object.keys(s.heroes || {}).length,
      heroTotal: (cfg().heroes || []).length
    };
  }

  /* ================= 金币兑换（三档） ================= */

  function goldPacks() {
    return (cfg().goldPacks || []).map(function (p) {
      const dia = Math.max(1, Number(p.diamond) || 1);
      const gold = Math.max(0, Number(p.gold) || dia * rate());
      return {
        diamond: dia, gold: gold,
        desc: U.safe(p.desc, ''),
        rate: Math.round(gold / dia),
        affordable: diamond() >= dia
      };
    });
  }

  /** 兑换：走 market.exchangeDiamondToGold（单向 1💎 = rate🪙） */
  function exchangeGold(tierIndex) {
    const packs = goldPacks();
    const i = Math.floor(Number(tierIndex));
    if (!(i >= 0 && i < packs.length)) { console.warn('[diamond] 非法兑换档位', tierIndex); FG.toast('兑换档位不存在', 'warn'); return false; }
    const p = packs[i];
    if (diamond() < p.diamond) {
      FG.toast('钻石不足：需要 ' + p.diamond + '💎，当前 ' + diamond() + '💎', 'warn');
      return false;
    }
    const r = S.market && S.market.exchangeDiamondToGold ? S.market.exchangeDiamondToGold(p.diamond) : false;
    if (r && FG.save.markDirty) FG.save.markDirty();
    return !!r;
  }

  /* ================= 材料捆绑包 ================= */

  function bundles() {
    return (cfg().bundles || []).map(function (b) {
      const price = Math.max(1, Number(b.price) || 1);
      const origin = Math.max(0, Number(b.originGold) || 0);
      const costGold = price * rate();                       // 钻石按汇率折成金币
      const save = origin > 0 ? Math.max(0, Math.min(0.95, 1 - costGold / origin)) : 0;
      const items = Object.keys(b.items || {}).map(function (id) {
        const m = (FG.CONFIG.materials || {})[id] || { name: id, icon: '📦' };
        return { id: id, name: m.name, icon: m.icon, count: Number(b.items[id]) || 0 };
      });
      return {
        id: b.id, name: U.safe(b.name, b.id), icon: U.safe(b.icon, '📦'),
        price: price, originGold: origin, count: items.length,
        items: items, savePercent: Math.round(save * 100),
        affordable: diamond() >= price
      };
    });
  }

  function bundleById(id) {
    return (cfg().bundles || []).filter(function (b) { return b.id === id; })[0] || null;
  }

  /** 购买材料捆绑包：扣钻石 → 材料入 bag.materials（事务 + 回滚） */
  function buyBundle(id) {
    const def = bundleById(id);
    if (!def) { console.warn('[diamond] 未知礼包', id); FG.toast('礼包不存在', 'warn'); return false; }
    const s = st();
    const price = Math.max(1, Number(def.price) || 1);
    if (diamond() < price) {
      FG.toast('钻石不足：需要 ' + price + '💎，当前 ' + diamond() + '💎', 'warn');
      return false;
    }
    const ids = Object.keys(def.items || {}).filter(function (k) { return !!FG.CONFIG.materials[k]; });
    if (!ids.length) { FG.toast('礼包配置异常', 'err'); return false; }

    const snapBag = JSON.parse(JSON.stringify(s.bag.materials || {}));
    const snapDiamond = s.diamond;
    try {
      s.diamond = diamond() - price;
      ids.forEach(function (k) {
        FG.bag.add('materials', k, Number(def.items[k]) || 0);
        if (S.codex && S.codex.recordMaterial) S.codex.recordMaterial(k);   // 06 §1.2 图鉴收录
      });
    } catch (e) {
      s.bag.materials = snapBag; s.diamond = snapDiamond;                   // 回滚
      console.warn('[diamond] 购买礼包失败，已回滚', e);
      FG.toast('购买失败，已回滚', 'err');
      return false;
    }
    FG.save.markDirty();
    float('-' + price + '💎', 'warn');
    FG.toast('🧰 已购买 ' + U.safe(def.name, id) + '（-' + price + '💎）', 'ok');
    console.log('[diamond] buyBundle', id, price, ids.length);
    return true;
  }

  /* ================= 自动合成 ================= */

  function autoConf() { const a = cfg().autoMerge || {}; return { unlockLevel: Number(a.unlockLevel) || 15, cost: Number(a.cost) || 50, intervalMs: Math.max(200, Number(a.intervalMs) || 2000) }; }

  function autoState() {
    const s = st();
    const c = autoConf();
    const unlocked = !!(s.autoMergeOpened);
    return {
      opened: unlocked,
      on: unlocked && !!s.autoMerge,
      unlockLevel: c.unlockLevel,
      cost: c.cost,
      level: Number(s.level) || 1,
      levelOk: (Number(s.level) || 1) >= c.unlockLevel,
      lackLevel: Math.max(0, c.unlockLevel - (Number(s.level) || 1)),
      affordable: diamond() >= c.cost,
      text: unlocked
        ? (s.autoMerge ? '已开通 · 运行中' : '已开通 · 已暂停')
        : ('达到 Lv.' + c.unlockLevel + ' 后可用钻石开通（当前 Lv.' + (Number(s.level) || 1) + '）')
    };
  }

  /** 用钻石开通自动合成（等级门槛 + 钻石价） */
  function openAutoMerge() {
    const s = st();
    const stt = autoState();
    if (stt.opened) { FG.toast('自动合成已开通', 'warn'); return false; }
    if (!stt.levelOk) {
      FG.toast('等级不足：需要 Lv.' + stt.unlockLevel + '（还差 ' + stt.lackLevel + ' 级）', 'warn');
      return false;
    }
    if (diamond() < stt.cost) {
      FG.toast('钻石不足：需要 ' + stt.cost + '💎，当前 ' + diamond() + '💎', 'warn');
      return false;
    }
    s.diamond = diamond() - stt.cost;
    s.autoMergeOpened = true;
    s.autoMerge = true;                                // 开通即开启，可在页面上随时暂停
    FG.save.markDirty();
    float('-' + stt.cost + '💎', 'warn');
    FG.toast('⚙️ 自动合成已开通（-' + stt.cost + '💎），每 ' + Math.round(autoConf().intervalMs / 1000) + 's 自动二合一次', 'ok');
    startAutoMerge();
    console.log('[diamond] openAutoMerge', stt.cost);
    return true;
  }

  /** 开/关自动合成（需先开通） */
  function toggleAutoMerge() {
    const s = st();
    if (!s.autoMergeOpened) { FG.toast('🔒 自动合成未开通（Lv.' + autoConf().unlockLevel + ' + ' + autoConf().cost + '💎）', 'warn'); return false; }
    s.autoMerge = !s.autoMerge;
    FG.save.markDirty();
    FG.toast(s.autoMerge ? '⚙️ 自动合成已开启' : '⚙️ 自动合成已暂停', 'ok');
    if (s.autoMerge) startAutoMerge(); else stopAutoMerge();
    return s.autoMerge;
  }

  const loop = { timer: 0 };

  /** 一次自动二合（供定时器与测试调用）：无对可合返回 false */
  function autoStep() {
    if (!st().autoMerge) return false;
    const M = S.merge;
    if (!M || !M.autoMergeStep) return false;
    const r = M.autoMergeStep();
    if (r && FG.ui && FG.ui.layout && FG.ui.layout.getActiveTab() === 'merge') {
      const dragging = FG.ui.mergeBoard && FG.ui.mergeBoard.isDragging && FG.ui.mergeBoard.isDragging();
      if (!dragging) FG.render.renderStage();
    }
    return !!r;
  }

  function startAutoMerge() {
    const s = st();
    if (!s.autoMergeOpened || !s.autoMerge || loop.timer) return false;
    loop.timer = setInterval(function () {
      const cur = st();
      if (!cur.autoMergeOpened || !cur.autoMerge) { stopAutoMerge(); return; }
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;   // 后台不空转
      autoStep();
    }, autoConf().intervalMs);
    console.log('[diamond] 自动合成循环已启动');
    return true;
  }

  function stopAutoMerge() {
    if (!loop.timer) return false;
    clearInterval(loop.timer);                       // 10 §9：离开时必须清理定时器
    loop.timer = 0;
    console.log('[diamond] 自动合成循环已停止');
    return true;
  }

  /** 启动时若存档里是「已开通 + 开启」状态，自动恢复循环 */
  function restoreAutoMerge() {
    const s = st();
    if (s.autoMergeOpened && s.autoMerge) startAutoMerge();
    return !!(s.autoMergeOpened && s.autoMerge);
  }

  /* ================= 英雄招募 ================= */

  function heroDefs() { return (cfg().heroes || []); }

  function heroesState() {
    const s = st();
    const level = Number(s.level) || 1;
    const owned = s.heroes || {};
    return heroDefs().map(function (h) {
      const got = !!owned[h.id];
      const levelOk = level >= (Number(h.unlockLevel) || 1);
      const cost = Math.max(1, Number(h.cost) || 1);
      return {
        id: h.id, name: U.safe(h.name, h.id), icon: U.safe(h.icon, '🧑'),
        rarity: h.rarity || 'common',
        rarityName: U.safe((FG.ENUM.RARITY_NAME || {})[h.rarity], h.rarity || ''),
        stars: '★'.repeat((FG.ENUM.RARITY_STAR || {})[h.rarity] || 1),
        desc: U.safe(h.desc, ''),
        unlockLevel: Number(h.unlockLevel) || 1,
        cost: cost, owned: got, levelOk: levelOk,
        canRecruit: !got && levelOk && diamond() >= cost,
        reason: got ? 'owned' : (!levelOk ? 'level' : (diamond() < cost ? 'poor' : 'ok'))
      };
    });
  }

  /** 招募英雄：扣钻石 + 记录 + 永久加成生效（事务） */
  function recruit(id) {
    const s = st();
    const def = heroDefs().filter(function (h) { return h.id === id; })[0];
    if (!def) { console.warn('[diamond] 未知英雄', id); FG.toast('英雄不存在', 'warn'); return false; }
    s.heroes = s.heroes || {};
    if (s.heroes[id]) { FG.toast('已经招募过「' + U.safe(def.name, id) + '」', 'warn'); return false; }
    const need = Number(def.unlockLevel) || 1;
    if ((Number(s.level) || 1) < need) {
      FG.toast('等级不足：需要 Lv.' + need + '（还差 ' + (need - (Number(s.level) || 1)) + ' 级）', 'warn');
      return false;
    }
    const cost = Math.max(1, Number(def.cost) || 1);
    if (diamond() < cost) { FG.toast('钻石不足：需要 ' + cost + '💎，当前 ' + diamond() + '💎', 'warn'); return false; }
    s.diamond = diamond() - cost;
    s.heroes[id] = true;
    FG.save.markDirty();
    float('-' + cost + '💎', 'warn');
    FG.toast('🦸 已招募 ' + U.safe(def.icon, '') + U.safe(def.name, id) + '（-' + cost + '💎）：' + U.safe(def.desc, ''), 'ok');
    console.log('[diamond] recruit', id, cost);
    return true;
  }

  /** 英雄加成合计（含「龙王使者」的全属性放大）：{ key: 数值 } */
  function heroBonus() {
    const s = st();
    const owned = s.heroes || {};
    let all = 0;
    const sum = {};
    heroDefs().forEach(function (h) {
      if (!owned[h.id]) return;
      Object.keys(h.effect || {}).forEach(function (k) {
        const v = Number(h.effect[k]) || 0;
        if (k === 'allAttr') { all += v; return; }
        sum[k] = (sum[k] || 0) + v;
      });
    });
    const mul = 1 + Math.max(0, all);
    Object.keys(sum).forEach(function (k) { sum[k] = sum[k] * mul; });
    return sum;
  }

  /** 单个效果查询（供 growth.getSkillEffect 汇总：技能 + 英雄） */
  function getEffect(key) {
    if (!key) return 0;
    if (key === 'allAttr') {
      let all = 0;
      const owned = st().heroes || {};
      heroDefs().forEach(function (h) { if (owned[h.id] && h.effect && h.effect.allAttr) all += Number(h.effect.allAttr) || 0; });
      return all;
    }
    return Math.max(0, Number(heroBonus()[key]) || 0);
  }

  S.diamond = {
    getSummary: getSummary,
    goldPacks: goldPacks,
    exchangeGold: exchangeGold,
    bundles: bundles,
    buyBundle: buyBundle,
    autoState: autoState,
    openAutoMerge: openAutoMerge,
    toggleAutoMerge: toggleAutoMerge,
    autoStep: autoStep,
    startAutoMerge: startAutoMerge,
    stopAutoMerge: stopAutoMerge,
    restoreAutoMerge: restoreAutoMerge,
    heroesState: heroesState,
    recruit: recruit,
    heroBonus: heroBonus,
    getEffect: getEffect
  };
})(window.FG = window.FG || {});
