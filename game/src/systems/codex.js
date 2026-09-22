/* ============================================================
   src/systems/codex.js · 06 收集与长线：图鉴 / 工坊 / 博览会 / 排行榜
   依赖：config.codex / config.workshop / config.expo / config.rank / config.economy
        state.codex / codexRewards / workshop / expo / expoSubmitted / expoLastRefresh / bag
   约束：
     - 数值全部来自 config.js，模块内禁止魔法数字（00 §4.1）
     - 资产（金币/钻石/鱼/制品）变动成对完成，失败回滚（10 §8）
     - 任何失败都要有文案，禁止静默失败（10 §1）
     - 关键节点 console.log（10 §10）
   ============================================================ */
(function (FG) {
  'use strict';
  const S = FG.systems = FG.systems || {};
  const U = FG.utils;

  function cfg() { return FG.CONFIG || {}; }
  function st() { return FG.getState(); }
  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* ================= 图鉴 ================= */

  const TYPES = [
    { key: 'fish', name: '鱼类', icon: '🐟' },
    { key: 'materials', name: '材料', icon: '🧩' },
    { key: 'equipment', name: '钓具', icon: '🎣' },
    { key: 'friends', name: '钓友', icon: '🤝' }
  ];

  /** 图鉴分类白名单（10 §5） */
  function typeOf(k) {
    return TYPES.filter(function (t) { return t.key === k; })[0] ||
      (console.warn('[codex] 非法图鉴分类，已回退 fish', k), TYPES[0]);
  }

  /** 该分类的图鉴总数（钓友来自 08，未接入时为 0） */
  function totalOf(type) {
    if (type === 'fish') return Object.keys(cfg().fish || {}).length;
    if (type === 'materials') return Object.keys(cfg().materials || {}).length;
    if (type === 'equipment') return Object.keys(cfg().items || {}).length;
    return 0;                                   // friends：08 未实现
  }

  function ownedOf(type) {
    const c = (st().codex || {})[type] || {};
    return Object.keys(c).filter(function (id) { return !!c[id]; }).length;
  }

  /** 完成度 { owned, total, percent } */
  function getCompletion(type) {
    const t = typeOf(type).key;
    const total = totalOf(t);
    const owned = ownedOf(t);
    return { type: t, owned: owned, total: total, percent: total ? owned / total : 0 };
  }

  /** 总完成度（四类合并，用于里程碑与段位） */
  function getTotalCompletion() {
    let owned = 0, total = 0;
    TYPES.forEach(function (t) {
      const c = getCompletion(t.key);
      owned += c.owned; total += c.total;
    });
    return { owned: owned, total: total, percent: total ? owned / total : 0 };
  }

  /** 某物种是否已收录（已收录 → 不可出售，07 §3.1） */
  function isCollected(type, id) {
    const c = (st().codex || {})[type] || {};
    return !!c[id];
  }
  function isFishCollected(fishId) { return isCollected('fish', fishId); }

  /** 写入一条奖励（幂等：已存在则不覆盖） */
  function addReward(key, diamond, label) {
    const s = st();
    s.codexRewards = s.codexRewards || {};
    if (s.codexRewards[key]) return false;
    s.codexRewards[key] = { diamond: Math.max(0, Number(diamond) || 0), claimed: false, label: label || '' };
    console.log('[codex] 生成图鉴奖励', key, s.codexRewards[key]);
    return true;
  }

  /**
   * 收录一条鱼（06 §1.2）：首次收录写入 codexRewards + 给经验，之后只更新最大重量/次数
   * @returns {{firstTime:boolean, entry:Object}}
   */
  function recordFish(fishId, weight) {
    const f = (cfg().fish || {})[fishId];
    if (!f) { console.warn('[codex] 未知鱼种', fishId); return { firstTime: false, entry: null }; }
    const s = st();
    s.codex = s.codex || { fish: {}, materials: {}, equipment: {}, friends: {} };
    s.codex.fish = s.codex.fish || {};
    const w = Math.max(0, Number(weight) || 0);
    const cur = s.codex.fish[fishId];
    const firstTime = !cur;
    const entry = {
      firstAt: cur ? cur.firstAt : Date.now(),
      maxWeight: Math.max(Number(cur && cur.maxWeight) || 0, w),
      count: (Number(cur && cur.count) || 0) + 1
    };
    s.codex.fish[fishId] = entry;

    if (firstTime) {
      addReward('fish_first_' + fishId, (cfg().codex || {}).firstDiamond, '首次收录 ' + f.name);
      if (S.growth && S.growth.awardCodex) S.growth.awardCodex();       // 05 §2：首次收录 +30 经验
    }
    checkMilestones();
    FG.save.markDirty();
    console.log('[codex] recordFish', fishId, w, 'firstTime=' + firstTime);
    return { firstTime: firstTime, entry: entry };
  }

  /** 收录材料 / 钓具（首次获得即自动收录，04/03 调用） */
  function recordMaterial(materialId) { return recordSimple('materials', materialId, '材料'); }
  function recordEquipment(equipmentId) { return recordSimple('equipment', equipmentId, '钓具'); }

  function recordSimple(type, id, labelName) {
    if (!id) return false;
    const s = st();
    s.codex = s.codex || { fish: {}, materials: {}, equipment: {}, friends: {} };
    s.codex[type] = s.codex[type] || {};
    if (s.codex[type][id]) return false;
    s.codex[type][id] = { firstAt: Date.now(), count: 1 };
    const meta = (type === 'materials' ? (cfg().materials || {}) : (cfg().items || {}))[id];
    addReward(type + '_first_' + id, (cfg().codex || {}).firstDiamond,
      '首次获得 ' + ((meta && meta.name) || id));
    checkMilestones();
    FG.save.markDirty();
    console.log('[codex] record' + labelName, id);
    return true;
  }

  /** 检查并生成里程碑奖励（数量 / 完成度） */
  function checkMilestones() {
    const c = cfg().codex || {};
    const diamond = Number(c.diamondPerMilestone) || 0;
    (c.fishMilestones || []).forEach(function (n) {
      TYPES.forEach(function (t) {
        const comp = getCompletion(t.key);
        if (comp.total > 0 && comp.owned >= n) {
          addReward(t.key + '_count_' + n, diamond, t.name + '图鉴 ' + n + ' 种');
        }
      });
    });
    (c.percentMilestones || []).forEach(function (p) {
      const comp = getTotalCompletion();
      if (comp.total > 0 && comp.percent + 1e-9 >= p) {
        addReward('percent_' + Math.round(p * 100), diamond, '总完成度 ' + U.formatPercent(p, 0));
      }
    });
  }

  /** 里程碑进度（含奖励领取状态），供图鉴面板展示 */
  function getMilestoneProgress(type) {
    const c = cfg().codex || {};
    const t = typeOf(type);
    const comp = getCompletion(t.key);
    const out = [];
    (c.fishMilestones || []).forEach(function (n) {
      if (comp.total <= 0) return;
      const key = t.key + '_count_' + n;
      const rw = (st().codexRewards || {})[key];
      out.push({
        key: key, label: t.name + '图鉴 ' + n + ' 种', need: n, owned: comp.owned,
        reached: comp.owned >= n, reward: rw || null
      });
    });
    (c.percentMilestones || []).forEach(function (p) {
      const key = 'percent_' + Math.round(p * 100);
      const rw = (st().codexRewards || {})[key];
      out.push({
        key: key, label: '总完成度 ' + U.formatPercent(p, 0), need: p,
        owned: getTotalCompletion().percent, isPercent: true,
        reached: getTotalCompletion().percent + 1e-9 >= p, reward: rw || null
      });
    });
    return out;
  }

  /** 未领取奖励数量（图鉴红点） */
  function unclaimedCount() {
    const rw = st().codexRewards || {};
    return Object.keys(rw).filter(function (k) { return rw[k] && !rw[k].claimed; }).length;
  }

  /** 领取奖励：钻石到账 + 已领取标记（10 §4：由 UI 节流） */
  function claimReward(rewardKey) {
    const s = st();
    const rw = (s.codexRewards || {})[rewardKey];
    if (!rw) { FG.toast('奖励不存在', 'warn'); return false; }
    if (rw.claimed) { FG.toast('该奖励已领取', 'warn'); return false; }
    /* 💎 英雄「孙先生」图鉴奖励 +25% */
    const mul = 1 + Math.max(0, skillEffect('codexDiamond'));
    const diamond = Math.round(Math.max(0, Number(rw.diamond) || 0) * mul);
    s.diamond = (Number(s.diamond) || 0) + diamond;
    s.stats = s.stats || {};
    s.stats.totalDiamondEarned = (Number(s.stats.totalDiamondEarned) || 0) + diamond;
    rw.claimed = true;
    FG.save.markDirty();
    FG.toast('📖 图鉴奖励已领取 +' + diamond + '💎', 'ok');
    console.log('[codex] claimReward', rewardKey, diamond);
    return true;
  }

  /** 一键领取全部（图鉴面板按钮） */
  function claimAllRewards() {
    const s = st();
    const keys = Object.keys(s.codexRewards || {}).filter(function (k) { return !s.codexRewards[k].claimed; });
    let n = 0, diamond = 0;
    keys.forEach(function (k) { if (claimReward(k)) { n++; diamond += s.codexRewards[k].diamond || 0; } });
    if (n) FG.toast('📖 已领取 ' + n + ' 项奖励，共 +' + diamond + '💎', 'ok');
    else FG.toast('暂无可领取的奖励', 'warn');
    return { count: n, diamond: diamond };
  }

  /* ================= 工坊 ================= */

  /** 工坊是否解锁（达到 Lv.10）；达标时自动置 unlocked（幂等） */
  function checkWorkshopUnlock() {
    const s = st();
    const cf = cfg().workshop || {};
    if (s.workshop && s.workshop.unlocked) return true;
    if ((Number(s.level) || 1) >= (Number(cf.unlockLevel) || 10)) {
      s.workshop = s.workshop || { unlocked: false, level: 0, facilities: [] };
      s.workshop.unlocked = true;
      FG.save.markDirty();
      FG.toast('🏭 工坊已解锁！可以把鱼加工成制品了', 'ok');
      console.log('[codex] workshop unlocked');
      return true;
    }
    return false;
  }

  /** 技能效果（05 §4） */
  function skillEffect(key) {
    const g = S.growth;
    return (g && g.getSkillEffect) ? Math.max(0, Number(g.getSkillEffect(key)) || 0) : 0;
  }

  function workshopState() {
    const s = st();
    const cf = cfg().workshop || {};
    const w = s.workshop || {};
    /* 技能：批量生产（工位 +N）/ 高效加工（加工时间 -%） */
    const slots = (Number(cf.baseSlots) || 1) + (Number(w.level) || 0) + Math.round(skillEffect('processSlots'));
    const fac = Array.isArray(w.facilities) ? w.facilities.slice() : [];
    while (fac.length < slots) fac.push(null);           // 补足空工位
    const speed = Math.min(0.9, skillEffect('processSpeed'));
    return {
      unlocked: !!w.unlocked,
      level: Number(w.level) || 0,
      slots: slots,
      nextSlotCost: Math.round((Number(cf.slotCost) || 0) * Math.pow(Number(cf.slotCostGrowth) || 1.8, Number(w.level) || 0)),
      processSeconds: Math.max(1, Math.round((Number(cf.processSeconds) || 60) * (1 - speed))),
      unlockLevel: Number(cf.unlockLevel) || 10,
      facilities: fac
    };
  }

  /**
   * 投料加工：消耗 1 条鱼 → 工位开始倒计时
   * @returns {boolean}
   */
  function startProcess(fishId) {
    const s = st();
    if (!workshopState().unlocked) { FG.toast('🔒 工坊 Lv.' + (cfg().workshop.unlockLevel || 10) + ' 解锁后才能加工', 'warn'); return false; }
    const f = (cfg().fish || {})[fishId];
    const bagFish = s.bag.fish[fishId];
    if (!f || !bagFish || !bagFish.count) { FG.toast('背包里没有这条鱼', 'warn'); return false; }

    const w = workshopState();
    const idx = w.facilities.indexOf(null);
    if (idx < 0) { FG.toast('工位已满，先收取或等加工完成', 'warn'); return false; }

    const weights = Array.isArray(bagFish.weights) ? bagFish.weights.slice() : [];
    const weight = weights.length ? weights.shift() : 0;             // 取最重/最前的一条
    const snap = { fish: JSON.parse(JSON.stringify(bagFish)) };
    try {
      /* 制品基线价 = 生鱼基础价 × productPriceFactor（不含任何加成，加成在 market.getProductPrice 实时计算） */
      const raw = (S.market && S.market.getRawFishPrice) ? S.market.getRawFishPrice(fishId, weight) : 0;
      const unitPrice = Math.round(raw * (Number((cfg().economy || {}).productPriceFactor) || 1));
      s.workshop = s.workshop || { unlocked: true, level: 0, facilities: [] };
      if (!Array.isArray(s.workshop.facilities)) s.workshop.facilities = [];
      while (s.workshop.facilities.length < w.slots) s.workshop.facilities.push(null);
      s.workshop.facilities[idx] = {
        fishId: fishId, weight: weight, unitPrice: unitPrice,
        startsAt: Date.now(), endsAt: Date.now() + w.processSeconds * 1000
      };
      /* 扣鱼：数量 -1，移除对应重量 */
      if (weights.length) s.bag.fish[fishId] = { count: weights.length, weights: weights };
      else delete s.bag.fish[fishId];
    } catch (e) {
      s.bag.fish[fishId] = snap.fish;                                 // 回滚
      console.warn('[codex] 投料失败，已回滚', e);
      FG.toast('投料失败，已回滚', 'err');
      return false;
    }
    FG.save.markDirty();
    FG.toast('🏭 已投料：' + f.icon + f.name + '（' + U.formatWeight(weight) + 'kg）→ ' + w.processSeconds + 's 后产出制品', 'ok');
    console.log('[codex] startProcess', fishId, weight);
    return true;
  }

  /** 收取制品：工位完成 → 制品入 bag.products */
  function collectProcess(slotIndex) {
    const s = st();
    const w = workshopState();
    const slot = w.facilities[slotIndex];
    if (!slot) { FG.toast('该工位是空的', 'warn'); return false; }
    if (Date.now() < slot.endsAt) { FG.toast('还在加工中（剩余 ' + leftText(slot.endsAt) + '）', 'warn'); return false; }
    const f = (cfg().fish || {})[slot.fishId] || { name: slot.fishId, icon: '🍣' };
    s.bag.products = s.bag.products || {};
    const cur = s.bag.products[slot.fishId] || { count: 0, unitPrice: slot.unitPrice };
    cur.count += 1;
    cur.unitPrice = Math.max(Number(cur.unitPrice) || 0, slot.unitPrice);
    s.bag.products[slot.fishId] = cur;
    s.workshop.facilities[slotIndex] = null;

    /* 💎 工坊产出是钻石来源之一：按概率掉钻（workshop.diamondChance / diamondAmount） */
    const wcf = cfg().workshop || {};
    const chance = Math.max(0, Math.min(1, Number(wcf.diamondChance) || 0));
    const amount = Math.max(0, Math.round(Number(wcf.diamondAmount) || 0));
    let gotDiamond = 0;
    if (chance > 0 && amount > 0 && U.chance(chance)) {
      s.diamond = (Number(s.diamond) || 0) + amount;
      s.stats.totalDiamondEarned = (Number(s.stats.totalDiamondEarned) || 0) + amount;
      gotDiamond = amount;
      if (FG.ui.float) FG.ui.float.show('+' + amount + '💎', 'ok');
    }

    FG.save.markDirty();
    const price = (S.market && S.market.getProductPrice) ? S.market.getProductPrice(slot.fishId) : slot.unitPrice;
    FG.toast('🍣 收取制品：' + f.icon + f.name + '（售价 🪙' + U.formatInt(price) + '）' +
      (gotDiamond ? '　+' + gotDiamond + '💎' : ''), 'ok');
    console.log('[codex] collectProcess', slotIndex, slot.fishId, 'diamond=' + gotDiamond);
    return true;
  }

  /** 升级工位：消耗金币（slotCost × growth^level） */
  function upgradeWorkshopSlot() {
    const s = st();
    const w = workshopState();
    if (!w.unlocked) { FG.toast('🔒 工坊未解锁', 'warn'); return false; }
    const cost = w.nextSlotCost;
    if ((Number(s.gold) || 0) < cost) { FG.toast('金币不足：需要 🪙' + U.formatInt(cost) + '，当前 🪙' + U.formatInt(s.gold), 'warn'); return false; }
    s.gold = (Number(s.gold) || 0) - cost;
    s.workshop.level = (Number(s.workshop.level) || 0) + 1;
    FG.save.markDirty();
    FG.toast('🏭 工坊升级到 Lv.' + s.workshop.level + '（工位 ' + w.slots + ' → ' + (w.slots + 1) + '，-🪙' + U.formatInt(cost) + '）', 'ok');
    console.log('[codex] upgradeWorkshopSlot', s.workshop.level, cost);
    return true;
  }

  function leftText(endsAt) {
    const ms = Math.max(0, endsAt - Date.now());
    return Math.ceil(ms / 1000) + 's';
  }

  /* ================= 博览会（4 个展区，同屏卡片，06 §3） ================= */

  function stalls() { return (cfg().expo || {}).stalls || []; }

  /** 展区定义（白名单校验，非法 id 返回 null） */
  function stallById(id) {
    return stalls().filter(function (x) { return x.id === id; })[0] || null;
  }

  function rarityName(r) { return (FG.ENUM.RARITY_NAME || {})[r] || U.safe(r, ''); }

  /** 跨日刷新：每天 0 点重置各展区的提交记录（每个展区每日可提交一次） */
  function refreshExpo() {
    const s = st();
    const today = todayKey();
    if (s.expoLastRefresh !== today) {
      s.expoSubmitted = {};
      s.expoLastRefresh = today;
      s.expo = { date: today };
      FG.save.markDirty();
      console.log('[codex] refreshExpo 新的一天，展区提交记录已重置', today);
    }
    if (!s.expoSubmitted || typeof s.expoSubmitted !== 'object' || Array.isArray(s.expoSubmitted)) s.expoSubmitted = {};
    return { date: today, submitted: s.expoSubmitted };
  }

  /** 背包某鱼种满足重量门槛的条目 [{ w, i }] */
  function bagHits(fishId, minWeight) {
    const e = (st().bag.fish || {})[fishId];
    if (!e) return [];
    const ws = Array.isArray(e.weights) ? e.weights : [];
    const need = Number(minWeight) || 0;
    return ws.map(function (w, i) { return { w: Number(w) || 0, i: i }; })
      .filter(function (x) { return x.w + 1e-9 >= need; });
  }

  /** 背包里所有鱼的重量列表（用于「大物」要求） */
  function allBagFish() {
    const out = [];
    Object.keys(st().bag.fish || {}).forEach(function (id) {
      const e = st().bag.fish[id];
      const ws = Array.isArray(e.weights) ? e.weights : [];
      ws.forEach(function (w) { out.push({ id: id, w: Number(w) || 0 }); });
    });
    return out;
  }

  /** 图鉴里某稀有度已收录的鱼种数 */
  function codexCountOfRarity(rarity) {
    const c = (st().codex || {}).fish || {};
    return Object.keys(c).filter(function (id) {
      const f = (cfg().fish || {})[id];
      return f && f.rarity === rarity;
    }).length;
  }

  /**
   * 单条要求的进度 { met, icon, text, extra }
   * extra 只在**未满足**时给缺口信息（满足时留空，卡片保持参考稿的干净观感）
   */
  function reqState(req) {
    const t = (req || {}).type;
    const fishDict = cfg().fish || {};

    if (t === 'discover') {
      const need = Math.max(1, Number(req.count) || 1);
      const have = codexCountOfRarity(req.rarity);
      const met = have >= need;
      return { met: met, icon: '📖', text: '发现 ' + need + ' 种' + rarityName(req.rarity) + '鱼',
        extra: met ? '' : have + ' / ' + need };
    }
    if (t === 'weight') {
      const f = fishDict[req.fishId] || { name: U.safe(req.fishId, '?'), icon: '🐟' };
      const hits = bagHits(req.fishId, req.minWeight);
      return { met: hits.length > 0, icon: f.icon,
        text: U.safe(f.name, req.fishId) + ' ≥ ' + U.formatWeight(req.minWeight) + 'kg',
        extra: hits.length ? '' : '暂无' };
    }
    if (t === 'bigFish') {
      const need = Math.max(1, Number(req.count) || 1);
      const have = allBagFish().filter(function (x) { return x.w + 1e-9 >= (Number(req.minWeight) || 0); }).length;
      const met = have >= need;
      return { met: met, icon: '🐋',
        text: U.formatWeight(req.minWeight) + 'kg 以上大物 ×' + need,
        extra: met ? '' : have + ' / ' + need };
    }
    /* species：指定鱼 ×N */
    const f2 = fishDict[req.fishId] || { name: U.safe(req.fishId, '?'), icon: '🐟' };
    const e = (st().bag.fish || {})[req.fishId];
    const have = e ? (Array.isArray(e.weights) ? e.weights.length : (Number(e.count) || 0)) : 0;
    const need = Math.max(1, Number(req.count) || 1);
    const met2 = have >= need;
    return { met: met2, icon: f2.icon, text: U.safe(f2.name, req.fishId) + ' ×' + need,
      extra: met2 ? '' : have + ' / ' + need };
  }

  /** 扣除一条满足重量门槛的鱼（取最小的合格者，尽量给玩家留大鱼） */
  function takeFish(fishId, minWeight) {
    const s = st();
    const e = s.bag.fish[fishId];
    if (!e) return false;
    const ws = Array.isArray(e.weights) ? e.weights.slice() : [];
    const need = Number(minWeight) || 0;
    let idx = -1;
    for (let i = 0; i < ws.length; i++) {
      if ((Number(ws[i]) || 0) + 1e-9 >= need && (idx < 0 || ws[i] < ws[idx])) idx = i;
    }
    if (idx < 0) return false;
    ws.splice(idx, 1);
    if (ws.length) s.bag.fish[fishId] = { count: ws.length, weights: ws };
    else delete s.bag.fish[fishId];
    return true;
  }

  /** 扣除 N 条大物（跨鱼种，同样优先扣小的合格鱼） */
  function takeBigFish(minWeight, count) {
    let got = 0;
    const need = Math.max(1, Number(count) || 1);
    for (let k = 0; k < need; k++) {
      let pickId = null, pickW = Infinity;
      allBagFish().forEach(function (x) {
        if (x.w + 1e-9 >= (Number(minWeight) || 0) && x.w < pickW) { pickW = x.w; pickId = x.id; }
      });
      if (!pickId) break;
      if (takeFish(pickId, pickW)) got++;
    }
    return got;
  }

  /** 四个展区的展示状态（含每条要求进度与可提交性） */
  function getExpoState() {
    const info = refreshExpo();
    const list = stalls().map(function (stall) {
      const reqs = (stall.reqs || []).map(function (r) {
        const rs = reqState(r);
        return { type: r.type, icon: rs.icon, text: rs.text, extra: rs.extra, met: rs.met };
      });
      const met = reqs.length > 0 && reqs.every(function (r) { return r.met; });
      const submitted = !!info.submitted[stall.id];
      const reward = stall.reward || {};
      return {
        id: stall.id, icon: U.safe(stall.icon, '🏆'), name: U.safe(stall.name, stall.id),
        subtitle: U.safe(stall.subtitle, ''),
        reward: { gold: Math.max(0, Number(reward.gold) || 0), diamond: Math.max(0, Number(reward.diamond) || 0) },
        reqs: reqs, met: met, submitted: submitted, claimable: met && !submitted
      };
    });
    return {
      date: info.date, stalls: list,
      doneCount: list.filter(function (x) { return x.submitted; }).length,
      total: list.length
    };
  }

  /**
   * 提交展品：校验全部要求 → 消耗对应鱼 → 发奖励（金币 + 钻石 + 经验）
   * 事务：先把背包鱼快照，任一步失败整体回滚（10 §8）
   * @param {string} stallId
   */
  function submitStall(stallId) {
    const stall = stallById(stallId);
    if (!stall) { console.warn('[codex] 未知展区', stallId); FG.toast('展区不存在', 'warn'); return false; }

    const state = getExpoState();
    const cur = state.stalls.filter(function (x) { return x.id === stallId; })[0];
    if (!cur) return false;
    if (cur.submitted) { FG.toast('「' + cur.name + '」今日已提交，明日再来', 'warn'); return false; }
    if (!cur.met) {
      const lack = cur.reqs.filter(function (r) { return !r.met; })
        .map(function (r) { return r.text + '（' + r.extra + '）'; }).join('、');
      FG.toast('展品不足：还差 ' + lack, 'warn');
      return false;
    }

    const s = st();
    const snap = JSON.parse(JSON.stringify(s.bag.fish || {}));      // 事务快照
    /* 💎 金币收益加成（英雄「陈海盗」）：博览会奖金同享 */
    const gold = Math.round(cur.reward.gold * (1 + Math.max(0, skillEffect('goldGain'))));
    const diamond = cur.reward.diamond;
    try {
      (stall.reqs || []).forEach(function (r) {
        if (r.type === 'discover') return;                          // 图鉴类要求不消耗鱼
        if (r.type === 'weight') takeFish(r.fishId, r.minWeight);
        else if (r.type === 'species') {
          const n = Math.max(1, Number(r.count) || 1);
          for (let i = 0; i < n; i++) takeFish(r.fishId, 0);
        } else if (r.type === 'bigFish') takeBigFish(r.minWeight, r.count);
      });
      /* 奖励与提交标记成对完成 */
      s.gold = (Number(s.gold) || 0) + gold;
      s.diamond = (Number(s.diamond) || 0) + diamond;
      s.stats = s.stats || {};
      s.stats.totalGoldEarned = (Number(s.stats.totalGoldEarned) || 0) + gold;
      s.stats.totalDiamondEarned = (Number(s.stats.totalDiamondEarned) || 0) + diamond;
      s.expoSubmitted[stallId] = state.date;
    } catch (e) {
      s.bag.fish = snap;                                            // 回滚
      console.warn('[codex] 提交展品失败，已回滚', e);
      FG.toast('提交失败，已回滚', 'err');
      return false;
    }
    FG.save.markDirty();
    if (S.growth && S.growth.awardExpo) S.growth.awardExpo();       // 05 §2：完成博览会 +100 经验
    if (FG.ui.float) FG.ui.float.show('+' + U.formatInt(gold) + '🪙', 'ok');
    FG.toast('🏆 ' + cur.name + ' 已提交：+' + U.formatInt(gold) + '🪙 +' + U.formatInt(diamond) + '💎', 'ok');
    console.log('[codex] submitStall', stallId, gold, diamond);
    return true;
  }

  /* ================= 排行榜（本地） ================= */

  const RANK_DIMS = [
    { key: 'tier', name: '段位', icon: '🎖️' },
    { key: 'codex', name: '图鉴', icon: '📖' },
    { key: 'fish', name: '总鱼数', icon: '🐟' },
    { key: 'weight', name: '最重鱼', icon: '🐋' }
  ];

  function getRankData(dim) {
    const d = RANK_DIMS.filter(function (x) { return x.key === dim; })[0] || RANK_DIMS[0];
    const s = st();
    const comp = getTotalCompletion();
    const score = (Number(s.stats && s.stats.totalFishCaught) || 0) + Math.round(comp.percent * 50);
    const tiers = (cfg().rank || {}).tiers || [];
    let tierName = tiers.length ? tiers[0].name : '新手';
    tiers.forEach(function (t) { if (score >= t.min) tierName = t.name; });

    let value, unit = '';
    if (d.key === 'tier') { value = score; unit = ' 分'; }
    else if (d.key === 'codex') { value = comp.percent; unit = ''; }
    else if (d.key === 'fish') { value = Number(s.stats && s.stats.totalFishCaught) || 0; unit = ' 条'; }
    else { value = Number(s.stats && s.stats.biggestFish) || 0; unit = 'kg'; }

    const name = (((s.socialProfile || {}).displayName) || '我');
    return {
      dim: d, tierName: tierName, score: score,
      rows: [{
        rank: 1, name: name, value: value, unit: unit, me: true,
        text: d.key === 'codex' ? U.formatPercent(value, 1) :
          (d.key === 'weight' ? U.formatWeight(value) : U.formatInt(value))
      }],
      offline: true
    };
  }

  S.codex = {
    TYPES: TYPES, RANK_DIMS: RANK_DIMS,
    recordFish: recordFish,
    recordMaterial: recordMaterial,
    recordEquipment: recordEquipment,
    isCollected: isCollected,
    isFishCollected: isFishCollected,
    getCompletion: getCompletion,
    getTotalCompletion: getTotalCompletion,
    getMilestoneProgress: getMilestoneProgress,
    unclaimedCount: unclaimedCount,
    claimReward: claimReward,
    claimAllRewards: claimAllRewards,
    /* 工坊 */
    checkWorkshopUnlock: checkWorkshopUnlock,
    workshopState: workshopState,
    startProcess: startProcess,
    collectProcess: collectProcess,
    upgradeWorkshopSlot: upgradeWorkshopSlot,
    /* 博览会（4 个展区） */
    refreshExpo: refreshExpo,
    getExpoState: getExpoState,
    submitStall: submitStall,
    stallList: stalls,
    /* 排行榜 */
    getRankData: getRankData
  };
})(window.FG = window.FG || {});
