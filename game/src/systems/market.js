/* ============================================================
   src/systems/market.js · 07 经济与市场
   职责：定价（生鱼 / 制品）、售卖、商店库存与购买、钻石兑换
   依赖：config.economy、state.bag / gold / diamond / codex
   约束：
     - 定价与库存数值全部来自 config.js（00 §4.1）
     - 扣减 + 增加成对完成，先校验充足性，失败回滚（10 §8）
     - 每次资产变动必须 toast（10 §1）+ 飘字（07 §5），由 UI 层节流 300ms（10 §4）
     - 已入图鉴的鱼不可出售（06 §1.2 / 07 §3.1）
   ============================================================ */
(function (FG) {
  'use strict';
  const S = FG.systems = FG.systems || {};
  const U = FG.utils;

  function cfg() { return (FG.CONFIG || {}).economy || {}; }
  function st() { return FG.getState(); }

  /** 技能效果读取（05 §4：效果只经 getSkillEffect，禁止硬编码） */
  function skillEffect(key) {
    const g = S.growth;
    return (g && g.getSkillEffect) ? Math.max(0, Number(g.getSkillEffect(key)) || 0) : 0;
  }

  /** 技能「精打细算」的售鱼价加成 */
  function priceMultiplier() { return 1 + skillEffect('fishPrice'); }

  /** 🆕 技能「精明商人」的制品售价加成（0% → 10%） */
  function productMultiplier() { return 1 + skillEffect('productPrice'); }

  /** 💎 英雄「陈海盗」的金币收益加成：所有金币收入统一乘这里 */
  function goldMultiplier() { return 1 + skillEffect('goldGain'); }

  /**
   * 生鱼**基础价**（不含任何加成）= fishBasePrice × 稀有度系数 × 重量(kg)
   * 工坊投料用它与 productPriceFactor 定基线，避免售价加成被重复计算
   */
  function getRawFishPrice(fishId, weight) {
    const f = (FG.CONFIG.fish || {})[fishId];
    if (!f) return 0;
    const c = cfg();
    const base = Number(c.fishBasePrice) || 0;
    const factor = Number((c.rarityPriceFactor || {})[f.rarity]) || 1;
    const w = Math.max(0, Number(weight) || 0);
    return Math.round(base * factor * w);
  }

  /** 生鱼售价 = 基础价 × 「精打细算」(售鱼价) × 「金币收益」 */
  function getFishPrice(fishId, weight) {
    const raw = getRawFishPrice(fishId, weight);
    return raw ? Math.round(raw * priceMultiplier() * goldMultiplier()) : 0;
  }

  /** 制品加成合计 = 售鱼价 × 精明商人 × 金币收益（投料展示与结算共用） */
  function productBonusMul() { return priceMultiplier() * productMultiplier() * goldMultiplier(); }

  /** 投料时的「预计制品单价」：实际产物结算口径 */
  function getProductUnitPrice(fishId, weight) {
    return Math.round(getRawFishPrice(fishId, weight) * (Number(cfg().productPriceFactor) || 1) * productBonusMul());
  }

  /** 制品售价：加工时存下的基线价（生鱼基础价 × productPriceFactor）再乘三项加成，技能/英雄实时生效 */
  function getProductPrice(productId) {
    const p = (st().bag.products || {})[productId];
    const unit = Number(p && p.unitPrice) || 0;
    if (unit) return Math.round(unit * productBonusMul());
    const f = (FG.CONFIG.fish || {})[productId];
    if (!f) return 0;
    const mid = (f.weightMin + f.weightMax) / 2;
    return getProductUnitPrice(productId, mid);
  }

  /** 飘字：+153 / -8（07 §5） */
  function float(text, type) {
    if (FG.ui && FG.ui.float && typeof FG.ui.float.show === 'function') FG.ui.float.show(text, type);
  }

  /** 可出售的鱼（已入图鉴的排除） */
  function sellableFish() {
    const s = st();
    const codex = (s.codex && s.codex.fish) || {};
    const out = [];
    Object.keys(s.bag.fish || {}).forEach(function (id) {
      const e = s.bag.fish[id];
      const f = (FG.CONFIG.fish || {})[id];
      if (!f || !e || !e.count) return;
      const weights = Array.isArray(e.weights) ? e.weights.slice() : [];
      const collected = !!codex[id];                       // 已珍藏 → 不可售
      const prices = weights.map(function (w) { return getFishPrice(id, w); });
      out.push({
        id: id, name: f.name, icon: f.icon, rarity: f.rarity,
        count: weights.length || e.count, weights: weights, prices: prices,
        unitPrice: prices.length ? Math.round(prices.reduce(function (a, b) { return a + b; }, 0) / prices.length) : 0,
        total: prices.reduce(function (a, b) { return a + b; }, 0),
        collected: collected
      });
    });
    return out.sort(function (a, b) { return b.total - a.total; });
  }

  /** 可出售的制品 */
  function sellableProducts() {
    const s = st();
    return Object.keys(s.bag.products || {}).map(function (id) {
      const p = s.bag.products[id];
      const f = (FG.CONFIG.fish || {})[id] || { name: id, icon: '🍣' };
      const unit = getProductPrice(id);
      return {
        id: id, name: f.name + ' 制品', icon: f.icon, rarity: f.rarity || 'uncommon',
        count: Number(p.count) || 0, unitPrice: unit, total: unit * (Number(p.count) || 0)
      };
    }).filter(function (p) { return p.count > 0; });
  }

  /**
   * 卖鱼：从 bag.fish 移除对应条数（按 weights 顺序），金币入账
   * @param {string} fishId
   * @param {number} count 默认 1
   */
  function sellFish(fishId, count) {
    const s = st();
    const f = (FG.CONFIG.fish || {})[fishId];
    if (!f) { console.warn('[market] 未知鱼种', fishId); return false; }
    const codex = (s.codex && s.codex.fish) || {};
    if (codex[fishId]) { FG.toast('「' + f.name + '」已珍藏，不可出售', 'warn'); return false; }
    const entry = s.bag.fish[fishId];
    const weights = entry && Array.isArray(entry.weights) ? entry.weights.slice() : [];
    if (!weights.length) { FG.toast('背包里没有「' + f.name + '」', 'warn'); return false; }

    const n = Math.min(weights.length, Math.max(1, Number(count) || 1));
    const snap = { entry: JSON.parse(JSON.stringify(entry)), gold: s.gold, earned: s.stats.totalGoldEarned };
    let total = 0;
    try {
      for (let i = 0; i < n; i++) total += getFishPrice(fishId, weights.shift());
      s.gold = (Number(s.gold) || 0) + total;
      s.stats.totalGoldEarned = (Number(s.stats.totalGoldEarned) || 0) + total;
      if (weights.length) s.bag.fish[fishId] = { count: weights.length, weights: weights };
      else delete s.bag.fish[fishId];
    } catch (e) {
      s.bag.fish[fishId] = snap.entry;
      s.gold = snap.gold; s.stats.totalGoldEarned = snap.earned;
      console.warn('[market] 出售失败，已回滚', e);
      FG.toast('出售失败，已回滚', 'err');
      return false;
    }
    FG.save.markDirty();
    FG.toast('💰 售出 ' + f.icon + f.name + ' ×' + n + ' 获得 ' + U.formatInt(total) + ' 金币', 'ok');
    float('+' + U.formatInt(total) + '🪙', 'ok');
    console.log('[market] sellFish', fishId, n, total);
    return { count: n, gold: total };
  }

  /** 卖制品 */
  function sellProduct(productId, count) {
    const s = st();
    const p = (s.bag.products || {})[productId];
    if (!p || !p.count) { FG.toast('没有该制品', 'warn'); return false; }
    const n = Math.min(p.count, Math.max(1, Number(count) || 1));
    const unit = getProductPrice(productId);
    const total = unit * n;
    const snap = { count: p.count, gold: s.gold, earned: s.stats.totalGoldEarned };
    try {
      s.gold = (Number(s.gold) || 0) + total;
      s.stats.totalGoldEarned = (Number(s.stats.totalGoldEarned) || 0) + total;
      const left = p.count - n;
      if (left > 0) s.bag.products[productId].count = left;
      else delete s.bag.products[productId];
    } catch (e) {
      s.bag.products[productId].count = snap.count;
      s.gold = snap.gold; s.stats.totalGoldEarned = snap.earned;
      console.warn('[market] 出售制品失败，已回滚', e);
      FG.toast('出售失败，已回滚', 'err');
      return false;
    }
    FG.save.markDirty();
    const f = (FG.CONFIG.fish || {})[productId] || { name: productId, icon: '🍣' };
    FG.toast('💰 售出 ' + f.icon + f.name + '制品 ×' + n + ' 获得 ' + U.formatInt(total) + ' 金币', 'ok');
    float('+' + U.formatInt(total) + '🪙', 'ok');
    console.log('[market] sellProduct', productId, n, total);
    return { count: n, gold: total };
  }

  /** 一键出售（type = 'fish' | 'products'）；需 UI 二次确认后调用 */
  function sellAll(type) {
    let n = 0, gold = 0;
    if (type === 'products') {
      sellableProducts().forEach(function (p) { const r = sellProduct(p.id, p.count); if (r) { n += r.count; gold += r.gold; } });
    } else {
      sellableFish().filter(function (f) { return !f.collected; })
        .forEach(function (f) { const r = sellFish(f.id, f.count); if (r) { n += r.count; gold += r.gold; } });
    }
    if (n) FG.toast('💰 一键出售完成：' + n + ' 件，共 +' + U.formatInt(gold) + '🪙', 'ok');
    else FG.toast('没有可出售的物品', 'warn');
    return { count: n, gold: gold };
  }

  /* ---------------- 商店库存与购买 ---------------- */

  /** 库存结构：state.market.stock { id: 剩余 } + restockAt（跨 restockIntervalMs 补满） */
  function ensureMarket() {
    const s = st();
    if (!s.market || typeof s.market !== 'object') s.market = {};
    if (!s.market.stock || typeof s.market.stock !== 'object') s.market.stock = {};
    if (typeof s.market.restockAt !== 'number') s.market.restockAt = 0;
    return s.market;
  }

  /** 补货：到点则全部补满（restockIntervalMs） */
  function refreshStock() {
    const s = st();
    const m = ensureMarket();
    const full = cfg().marketStock || {};
    const now = Date.now();
    /* 🆕 清掉配置里已下架 / 改名 / 写错的商品（如曾经的 red_bug），
       否则老存档会一直留着「买了也没用」的条目 */
    Object.keys(m.stock || {}).forEach(function (id) {
      if (!(id in full)) { delete m.stock[id]; FG.save.markDirty(); }
    });
    if (!m.restockAt || now >= m.restockAt) {
      Object.keys(full).forEach(function (id) { m.stock[id] = Number(full[id]) || 0; });
      m.restockAt = now + (Number(cfg().restockIntervalMs) || 86400000);
      FG.save.markDirty();
      console.log('[market] 商店补货', JSON.stringify(m.stock));
    }
    return m;
  }

  /** 库存列表（含单价 / 剩余 / 售罄 / 补货倒计时） */
  function getStock() {
    const m = refreshStock();
    const price = cfg().marketPrice || {};
    const left = Math.max(0, m.restockAt - Date.now());
    const hh = Math.floor(left / 3600000);
    const mm = Math.floor((left % 3600000) / 60000);
    const ss = Math.floor((left % 60000) / 1000);
    return {
      items: Object.keys(cfg().marketStock || {}).map(function (id) {
        const meta = (FG.CONFIG.materials || {})[id] || { name: id, icon: '📦' };
        const n = Number(m.stock[id]) || 0;
        return {
          id: id, name: meta.name, icon: meta.icon,
          price: Number(price[id]) || 0, left: n, max: Number((cfg().marketStock || {})[id]) || 0,
          sold: n <= 0
        };
      }),
      restockAt: m.restockAt,
      countdown: String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0')
    };
  }

  /**
   * 购买：扣金币 + 库存 -n + 进背包（材料 → bag.materials，装备/饵料 → bag.equipment；成对完成，失败回滚）
   * @returns {boolean}
   */
  function buy(itemId, count) {
    const stock = cfg().marketStock || {};
    if (!(itemId in stock)) { console.warn('[market] 非售卖物品', itemId); return false; }
    /* 🆕 商品 id 必须真实存在：否则会买到「背包里有、但哪里都用不了」的幽灵物品
       （例如曾经的 red_bug —— 材料表里其实叫 worm） */
    const isMat = !!(FG.CONFIG.materials || {})[itemId];
    const isEquip = !!(FG.CONFIG.items || {})[itemId];
    if (!isMat && !isEquip) {
      console.warn('[market] 商品 id 在配置里不存在', itemId);
      FG.toast('该商品暂时无法购买（配置异常）', 'warn');
      return false;
    }
    const s = st();
    const m = refreshStock();
    const n = Math.max(1, Number(count) || 1);
    const left = Number(m.stock[itemId]) || 0;
    const price = Number((cfg().marketPrice || {})[itemId]) || 0;

    if (left <= 0) {
      FG.toast('今日售罄，' + getStock().countdown + ' 后补货', 'warn');
      return false;
    }
    if (left < n) { FG.toast('库存只剩 ' + left + ' 个', 'warn'); return false; }
    const cost = price * n;
    if ((Number(s.gold) || 0) < cost) {
      FG.toast('金币不足：需要 🪙' + U.formatInt(cost) + '，当前 🪙' + U.formatInt(s.gold) +
        '（还差 🪙' + U.formatInt(cost - (Number(s.gold) || 0)) + '）', 'warn');
      return false;
    }

    const snap = { gold: s.gold, left: left };
    try {
      s.gold = (Number(s.gold) || 0) - cost;
      m.stock[itemId] = left - n;
      if (isEquip) {
        FG.bag.add('equipment', itemId, n);            // 装备 / 成品饵料
        if (S.codex && S.codex.recordEquipment) S.codex.recordEquipment(itemId);
      } else {
        FG.bag.add('materials', itemId, n);            // 材料
        /* 06 §1.2：材料首次获得自动收录图鉴 */
        if (S.codex && S.codex.recordMaterial) S.codex.recordMaterial(itemId);
      }
    } catch (e) {
      s.gold = snap.gold; m.stock[itemId] = snap.left;
      console.warn('[market] 购买失败，已回滚', e);
      FG.toast('购买失败，已回滚', 'err');
      return false;
    }
    FG.save.markDirty();
    const meta = (FG.CONFIG.materials || {})[itemId] || (FG.CONFIG.items || {})[itemId] || { name: itemId, icon: '📦' };
    FG.toast('🛒 购买 ' + meta.icon + meta.name + ' ×' + n + '，花费 ' + U.formatInt(cost) + ' 金币', 'ok');
    float('-' + U.formatInt(cost) + '🪙', 'warn');
    console.log('[market] buy', itemId, n, cost);
    return { count: n, gold: cost };
  }

  /** 钻石兑换金币（单向：diamondToGold） */
  function exchangeDiamondToGold(diamond) {
    const s = st();
    const n = Math.max(1, Math.floor(Number(diamond) || 0));
    if ((Number(s.diamond) || 0) < n) { FG.toast('钻石不足：需要 ' + n + '💎，当前 ' + U.formatInt(s.diamond) + '💎', 'warn'); return false; }
    const rate = Number(cfg().diamondToGold) || 100;
    const gold = n * rate;
    s.diamond = (Number(s.diamond) || 0) - n;
    s.gold = (Number(s.gold) || 0) + gold;
    FG.save.markDirty();
    FG.toast('💎 ' + n + ' 钻石 → +' + U.formatInt(gold) + ' 金币', 'ok');
    float('+' + U.formatInt(gold) + '🪙', 'ok');
    console.log('[market] exchange', n, gold);
    return { diamond: n, gold: gold };
  }

  S.market = {
    getFishPrice: getFishPrice,
    getRawFishPrice: getRawFishPrice,
    getProductUnitPrice: getProductUnitPrice,
    getProductPrice: getProductPrice,
    sellableFish: sellableFish,
    sellableProducts: sellableProducts,
    sellFish: sellFish,
    sellProduct: sellProduct,
    sellAll: sellAll,
    refreshStock: refreshStock,
    getStock: getStock,
    buy: buy,
    exchangeDiamondToGold: exchangeDiamondToGold
  };
})(window.FG = window.FG || {});
