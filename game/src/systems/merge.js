/* ============================================================
   src/systems/merge.js · 03 材料与二合合成
   职责：36 格合成台（放置/移动/合并）、六条链的解锁、体力（挖掘/采集）与材料产出
   依赖：CONFIG.merge / CONFIG.materials / CONFIG.charges、state.mergeGrid / mergeCount / digCharges / gatherCharges
   约束：
     - 扣减与增加成对完成，失败回滚（10 §8）
     - 数值全部来自 config，无魔法数字
     - 网格已满 / 体力不足 / 链未解锁 → 明确提示，不静默失败
   边界：不做配方合成（craft.js）、不做市场出售（07）、不自动合成（autoMerge 仅预留）
   ============================================================ */
(function (FG) {
  'use strict';
  const S = FG.systems = FG.systems || {};
  const U = FG.utils;

  const KEY = 'mergeGrid';

  /* ---------------- 材料元数据 ---------------- */

  function defs() { return FG.CONFIG.materials || {}; }
  function isMaterial(id) { return !!defs()[id]; }

  /** 材料定义 + 所属链/等级/稀有度（链的位置即等级） */
  function materialMeta(id) {
    const d = defs()[id];
    if (!d) return null;
    const chains = FG.CONFIG.merge.chains || {};
    const chain = d.chain ? chains[d.chain] : null;
    const level = chain ? chain.items.indexOf(id) + 1 : 1;
    const rar = FG.CONFIG.merge.rarityByLevel || [];
    return {
      id: id, name: d.name, icon: d.icon,
      chain: d.chain || null,
      chainName: chain ? chain.name : '特殊材料',
      level: level,
      rarity: chain ? (rar[level - 1] || 'common') : (d.rarity || 'common'),
      maxLevel: chain ? Math.min(chain.items.length, FG.CONFIG.merge.maxLevel) : 1
    };
  }

  /** 链的解锁条件：玩家等级 + 合成次数；返回 {unlocked, needLevel, needMerge} */
  function chainGate(chainKey) {
    const chains = FG.CONFIG.merge.chains || {};
    const chain = chains[chainKey];
    const s = FG.getState();
    if (!chain) return { unlocked: false, needLevel: 0, needMerge: 0 };
    const order = FG.CONFIG.merge.chainOrder || [];
    const idx = order.indexOf(chainKey);
    const gateList = FG.CONFIG.merge.chainUnlockAtMergeCount || [];
    const progressive = FG.CONFIG.merge.progressiveUnlock === true;
    // progressiveUnlock = false（默认）时全部解锁：任何基础材料都能合成
    const needMerge = progressive
      ? ((idx >= 0 && gateList[idx] != null) ? gateList[idx]
        : (gateList.length ? gateList[gateList.length - 1] : 0))
      : 0;
    const needLevel = progressive ? (chain.unlockLevel || 0) : 0;
    const okLevel = (s.level || 1) >= needLevel;
    const okMerge = (s.mergeCount || 0) >= needMerge;
    return { unlocked: okLevel && okMerge, needLevel: needLevel, needMerge: needMerge };
  }

  /** 已解锁的链 */
  function unlockedChains() {
    return (FG.CONFIG.merge.chainOrder || []).filter(function (k) { return chainGate(k).unlocked; });
  }

  /** 下一级产物 id（无则 null） */
  function getNextLevelItem(id) {
    const m = materialMeta(id);
    if (!m || !m.chain) return null;
    const items = FG.CONFIG.merge.chains[m.chain].items;
    return m.level < items.length ? items[m.level] : null;
  }

  /* ---------------- 网格读写 ---------------- */

  function grid() {
    const s = FG.getState();
    if (!Array.isArray(s[KEY])) s[KEY] = [];
    return s[KEY];
  }
  /** 技能效果（05 §4）：社交/成长模块缺失时按 0 处理 */
  function skill(key) {
    const g = FG.systems.growth;
    return (g && g.getSkillEffect) ? Math.max(0, Number(g.getSkillEffect(key)) || 0) : 0;
  }

  /** 合成台格位数 = 基础 36 + 「仓库扩容」技能加成（每级 +3/7/10 格） */
  function boardSize() {
    const base = Math.max(1, Number(FG.CONFIG.merge.gridSize) || 36);
    return base + Math.round(skill('boardSlots'));
  }

  function cellIndex(cell) {
    const n = Number(cell);
    const size = boardSize();
    return (isFinite(n) && n >= 0 && n < size) ? Math.floor(n) : -1;
  }
  function itemAt(cell) {
    const i = cellIndex(cell);
    if (i < 0) return null;
    return grid().filter(function (it) { return it.cell === i; })[0] || null;
  }
  function firstEmptyCell() {
    const size = boardSize();
    const used = {};
    grid().forEach(function (it) { used[it.cell] = 1; });
    for (let i = 0; i < size; i++) if (!used[i]) return i;
    return -1;
  }

  /** 所有空位（供随机落点使用） */
  function emptyCells() {
    const size = boardSize();
    const used = {};
    grid().forEach(function (it) { used[it.cell] = 1; });
    const out = [];
    for (let i = 0; i < size; i++) if (!used[i]) out.push(i);
    return out;
  }

  /** 随机空位；没有空位返回 -1。randomPlacement 关闭时退化为第一个空位 */
  function pickCell() {
    const free = emptyCells();
    if (!free.length) return -1;
    if (FG.CONFIG.merge.randomPlacement === false) return free[0];
    return free[U.randInt(0, free.length - 1)];
  }
  function emptyCount() {
    return boardSize() - grid().length;
  }

  /** 放置材料到网格；网格满返回 false */
  function addToGrid(id, level) {
    const m = materialMeta(id);
    if (!m) { console.warn('[merge] 未知材料', id); return false; }
    const cell = pickCell();                     // 随机落点（可配置退回顺序填空）
    if (cell < 0) { FG.toast('合成台已满，请先合成或清空', 'warn'); return false; }
    grid().push({ id: id, level: level || m.level, cell: cell });
    grid().sort(function (a, b) { return a.cell - b.cell; });
    return true;
  }

  function placeItem(cell, id, level) {
    const i = cellIndex(cell);
    if (i < 0) { console.warn('[merge] 非法格子', cell); return false; }
    if (!isMaterial(id)) { FG.toast('未知材料', 'err'); return false; }
    const exist = itemAt(i);
    if (exist) { exist.id = id; exist.level = level || materialMeta(id).level; }
    else grid().push({ id: id, level: level || materialMeta(id).level, cell: i });
    FG.save.markDirty();
    return true;
  }

  /** 清空某格 */
  function clearCell(cell) {
    const i = cellIndex(cell);
    if (i < 0) return false;
    const s = FG.getState();
    const before = grid().length;
    s[KEY] = grid().filter(function (it) { return it.cell !== i; });
    FG.save.markDirty();
    return s[KEY].length < before;
  }

  /* ---------------- 合并判定 ---------------- */

  /** 两格能否合并：同 id 且同等级（03 §2） */
  function canMerge(a, b) {
    if (!a || !b) return false;
    return a.id === b.id && a.level === b.level;
  }

  /**
   * 拖拽/点选落子：from → to
   * @returns {{ok:boolean, merged:boolean, reason:string}}
   */
  function applyDrop(fromCell, toCell) {
    const from = itemAt(fromCell);
    const to = itemAt(toCell);
    if (!from) return { ok: false, merged: false, reason: 'empty-source' };
    if (fromCell === toCell) return { ok: false, merged: false, reason: 'same-cell' };

    if (!to) {                                   // 目标为空：移动
      from.cell = cellIndex(toCell);
      grid().sort(function (a, b) { return a.cell - b.cell; });
      FG.save.markDirty();
      return { ok: true, merged: false, reason: 'move' };
    }

    if (!canMerge(from, to)) {                   // 不同名/不同级：回弹 + 提示
      console.log('[merge] 拒绝合并', from.id, to.id);
      return { ok: false, merged: false, reason: 'not-match' };
    }

    const meta = materialMeta(from.id);
    const gate = meta.chain ? chainGate(meta.chain) : { unlocked: true };
    if (!gate.unlocked) {
      return { ok: false, merged: false, reason: 'chain-locked', needLevel: gate.needLevel, needMerge: gate.needMerge };
    }
    const nextId = getNextLevelItem(from.id);
    if (!nextId) return { ok: false, merged: false, reason: 'max-level' };

    // 事务：目标格升级，来源格清空（成对完成）
    const s = FG.getState();
    const prev = JSON.parse(JSON.stringify(s[KEY]));
    try {
      to.id = nextId;
      to.level = materialMeta(nextId).level;
      to.merged = true;                              // 标记「已合成」，只有这类材料才能被一键收获
      s[KEY] = grid().filter(function (it) { return it.cell !== cellIndex(fromCell); });
      s.mergeCount = (s.mergeCount || 0) + 1;
    } catch (e) {
      s[KEY] = prev;                             // 回滚
      console.warn('[merge] 合并失败已回滚', e);
      return { ok: false, merged: false, reason: 'error' };
    }
    FG.save.markDirty();
    const nm = materialMeta(nextId);
    FG.toast('✨ 合成了 ' + nm.icon + ' ' + nm.name + '！', 'ok');
    console.log('[merge] merge', from.id, '→', nextId, 'count', s.mergeCount);
    return { ok: true, merged: true, reason: 'merged', result: nm };
  }

  /** 兼容旧签名：直接合并某个格子（向第一个可合并的同 id 格） */
  function tryMerge(cell) {
    const from = itemAt(cell);
    if (!from) return false;
    const target = grid().filter(function (it) {
      return it.cell !== from.cell && canMerge(from, it);
    })[0];
    if (!target) { FG.toast('只能合并相同物品', 'warn'); return false; }
    return applyDrop(from.cell, target.cell).ok;
  }

  function unlockChain(chainKey) {
    const gate = chainGate(chainKey);
    if (gate.unlocked) return true;
    FG.toast('🔒 ' + (FG.CONFIG.merge.chains[chainKey].name || '该链') +
      ' 需要 Lv.' + gate.needLevel + ' 且合成 ' + gate.needMerge + ' 次', 'warn');
    return false;
  }

  /**
   * 自动合成一步：找一对「同名同等级且链已解锁」的材料合并（低等级优先）
   * 由 💎 钻石系统的自动合成循环按 autoMerge.intervalMs 调用
   * @returns {{from:number,to:number,result:Object}|null} 无可合并对返回 null
   */
  function autoMergeStep() {
    const items = grid().slice().sort(function (a, b) {
      return (a.level - b.level) || (a.cell - b.cell);
    });
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (a.id !== b.id || a.level !== b.level) continue;
        if (!canMerge(a, b)) continue;
        const meta = materialMeta(a.id);
        const gate = meta.chain ? chainGate(meta.chain) : { unlocked: true };
        if (!gate.unlocked) continue;
        const r = applyDrop(a.cell, b.cell);
        if (r && r.ok && r.merged) {
          return { from: a.cell, to: b.cell, result: r.result || null };
        }
      }
    }
    return null;
  }

  function toggleAutoMerge() {
    const s = FG.getState();
    const D = FG.systems.diamond;
    if (!s.autoMergeOpened) {
      /* 未开通：交给钻石系统给出口（等级门槛 + 钻石价） */
      if (D && D.toggleAutoMerge) return D.toggleAutoMerge();
      FG.toast('🔒 自动合成未开通', 'warn');
      return false;
    }
    s.autoMerge = !s.autoMerge;
    FG.save.markDirty();
    FG.toast(s.autoMerge ? '⚙️ 自动合成已开启' : '⚙️ 自动合成已暂停', 'ok');
    if (D && D.startAutoMerge) { if (s.autoMerge) D.startAutoMerge(); else D.stopAutoMerge(); }
    return s.autoMerge;
  }

  /* ---------------- 体力 ---------------- */

  /** 体力上限（含 05「体力充沛」加成；技能上限也走这张表） */
  function maxCharges(type) {
    const c = FG.CONFIG.charges;
    const bonus = (FG.systems.growth && FG.systems.growth.chargeMaxBonus)
      ? FG.systems.growth.chargeMaxBonus() : 0;
    return (type === 'gather' ? c.gatherMax : c.digMax) + bonus;
  }

  function regenCharges() {
    const s = FG.getState();
    const c = FG.CONFIG.charges;
    const now = Date.now();
    let last = Number(s.lastChargeRegen) || now;
    const digFull = s.digCharges >= maxCharges('dig');
    const gatherFull = s.gatherCharges >= maxCharges('gather');
    if (digFull && gatherFull) {                 // 满体力时重置计时，避免攒次数
      if (now - last > 1000) { s.lastChargeRegen = now; FG.save.markDirty(); }
      return 0;
    }
    const gained = Math.floor((now - last) / c.regenIntervalMs);
    if (gained <= 0) return 0;
    const add = gained * c.regenAmount;
    if (!digFull) s.digCharges = Math.min(maxCharges('dig'), s.digCharges + add);
    if (!gatherFull) s.gatherCharges = Math.min(maxCharges('gather'), s.gatherCharges + add);
    s.lastChargeRegen = last + gained * c.regenIntervalMs;
    FG.save.markDirty();
    console.log('[merge] 体力恢复', gained, '点');
    return gained;
  }

  /** 体力状态（含下一次恢复时间与 mm:ss 文案，供 UI 显示倒计时） */
  function chargesState() {
    regenCharges();
    const s = FG.getState();
    const c = FG.CONFIG.charges;
    const anyLow = s.digCharges < maxCharges('dig') || s.gatherCharges < maxCharges('gather');
    const nextAt = anyLow ? (Number(s.lastChargeRegen) || Date.now()) + c.regenIntervalMs : 0;
    let text = '';
    if (nextAt) {
      const left = Math.max(0, nextAt - Date.now());
      const m = Math.floor(left / 60000), sec = Math.floor((left % 60000) / 1000);
      text = String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    }
    return {
      dig: s.digCharges, gather: s.gatherCharges,
      digMax: maxCharges('dig'), gatherMax: maxCharges('gather'),
      nextRegenAt: nextAt, countdown: text
    };
  }

  /** 消耗 1 点体力；耗尽返回 false（不静默） */
  function consumeCharge(type) {
    const s = FG.getState();
    const c = FG.CONFIG.charges;
    const field = type === 'dig' ? 'digCharges' : 'gatherCharges';
    const max = maxCharges(type);
    if (!s[field] || s[field] <= 0) return false;      // 耗尽 → 拒绝（UI 已禁用并显示倒计时）
    s[field] -= 1;
    if (s[field] === max - 1) s.lastChargeRegen = s.lastChargeRegen || Date.now();
    FG.save.markDirty();
    return true;
  }

  /* ---------------- 补充探索次数（金币） ---------------- */

  const CHARGE_NAME = { dig: '挖掘', gather: '采集' };
  const chargeField = (type) => (type === 'dig' ? 'digCharges' : 'gatherCharges');
  /* 上限统一走 maxCharges（含 05 技能加成） */
  const chargeMax = (type) => maxCharges(type);

  /**
   * 用金币补充挖掘/采集次数（参考稿「补充探索次数」面板）
   * @param {'dig'|'gather'} type
   * @param {'plus'|'full'} mode  plus=+buyAmount 次（buyCost 金币）；full=补到上限（fullCost 金币）
   * @returns {boolean} 是否补充成功
   */
  function buyCharges(type, mode) {
    const cfg = (FG.CONFIG.charges || {}).buy || {};
    if (cfg.enabled === false) { FG.toast('补充功能未开放', 'warn'); return false; }
    if (type !== 'dig' && type !== 'gather') { console.warn('[merge] 非法次数类型', type); return false; }

    regenCharges();                                   // 先把自然恢复结算掉，避免白买
    const s = FG.getState();
    const field = chargeField(type);
    const max = chargeMax(type);
    const cur = Number(s[field]) || 0;
    const name = CHARGE_NAME[type];
    const amount = Math.max(1, Number(cfg.buyAmount) || 3);
    const buyCost = Math.max(0, Number(cfg.buyCost) || 0);
    const fullCost = Math.max(0, Number(cfg.fullCost) || 0);
    const room = max - cur;

    if (room <= 0) { FG.toast(name + '次数已满（' + cur + '/' + max + '），无需补充', 'warn'); return false; }

    let add, cost;
    if (mode === 'full') {
      add = room; cost = fullCost;
    } else {
      if (room < amount) {                            // 剩余不足一次「+N」：不按整价多收
        FG.toast(name + '只剩 ' + room + ' 次，请直接用「满充」', 'warn');
        return false;
      }
      add = amount; cost = buyCost;
    }

    const gold = Number(s.gold) || 0;
    if (gold < cost) {
      FG.toast('金币不足：需要 🪙' + cost + '，当前 🪙' + gold, 'warn');
      return false;
    }

    const prev = { gold: s.gold, cur: cur };          // 事务：金币与次数成对变更
    try {
      s.gold = gold - cost;
      s[field] = cur + add;
      if (s[field] > max) s[field] = max;
    } catch (e) {
      s.gold = prev.gold; s[field] = prev.cur;
      console.warn('[merge] 补充次数失败，已回滚', e);
      FG.toast('补充失败，已回滚', 'err');
      return false;
    }

    FG.save.markDirty();
    FG.toast('🔋 ' + name + ' +' + add + '（-' + cost + ' 金币）→ ' + s[field] + '/' + max, 'ok');
    console.log('[merge] buyCharges', type, mode, add, cost);
    return true;
  }

  /* ---------------- 材料产出 ---------------- */

  /** 该产出口的候选基础材料（挖掘=矿石/废料/黏土，采集=干草/树液/红虫） */
  function sourceList(kind) {
    const map = FG.CONFIG.merge.source || {};
    const list = map[kind];
    if (Array.isArray(list) && list.length) return list.filter(isMaterial);
    return kind === 'dig' ? ['ore', 'scrap', 'clay'] : ['hay', 'sap', 'worm'];
  }

  /** 按权重取一个等级（1..maxLevel，权重数组不足时按最后一档处理） */
  function weightedLevel(weights, maxLevel) {
    const w = [];
    let total = 0;
    for (let i = 0; i < maxLevel; i++) {
      const v = Number((weights || [])[i]);
      const val = isFinite(v) && v > 0 ? v : 0;
      w.push(val);
      total += val;
    }
    if (total <= 0) return 1;
    let r = Math.random() * total;
    for (let i = 0; i < w.length; i++) {
      r -= w[i];
      if (r <= 0) return i + 1;
    }
    return 1;
  }

  /** 随机抽一个待生成的材料：随机链 + 加权等级（基础材料为主，小概率高级材料） */
  function rollSpawn() {
    const order = FG.CONFIG.merge.chainOrder || [];
    const chains = FG.CONFIG.merge.chains || {};
    const pool = order.filter(function (k) { return chains[k] && chains[k].items.length; });
    if (!pool.length) return null;
    const key = pool[U.randInt(0, pool.length - 1)];
    const chain = chains[key];
    const weights = (FG.CONFIG.merge.autoSpawn || {}).levelWeights;
    const level = weightedLevel(weights, chain.items.length);
    return { id: chain.items[level - 1], level: level, chain: key };
  }

  /** 生成一个材料放入网格（可传入指定 pick）；网格满返回 null */
  function spawnOne(pick) {
    if (emptyCount() <= 0) return null;
    const item = pick || rollSpawn();
    if (!item) return null;
    if (!addToGrid(item.id, item.level)) return null;
    FG.save.markDirty();
    return item;
  }

  /** 同链的 Lv.2 材料 id（「自然亲和」把基础材料升一档用；无链则返回 null） */
  function upgradeId(id) {
    const m = materialMeta(id);
    if (!m || !m.chain) return null;
    const chain = (FG.CONFIG.merge.chains || {})[m.chain];
    if (!chain || !Array.isArray(chain.items) || chain.items.length < 2) return null;
    return chain.items[1];
  }

  /**
   * 产出材料（默认一次消耗 1 点体力，随机产出 producePerAction 个）
   * 技能（05 §4）：
   *   - 矿工之眼 digCrit：挖掘时按概率暴击 → 本次产出翻倍
   *   - 自然亲和 rareMaterial：采集时按概率把 1 个基础材料升为同链 Lv.2
   * @param {'dig'|'gather'} kind
   * @param {number} times 次数（每次扣 1 点体力）
   * @param {{free?:boolean, per?:number}} [opts] free=不扣体力（一键收获），per=覆盖单次产出数量
   * @returns {string[]} 实际产出的材料 id 列表
   */
  function produce(kind, times, opts) {
    const o = opts || {};
    const free = !!o.free;
    const cands = sourceList(kind);
    const per = Math.max(1, Number(o.per) || Number(FG.CONFIG.merge.producePerAction) || 3);
    const out = [];
    const actions = Math.max(1, Number(times) || 1);
    const critRate = kind === 'dig' ? skill('digCrit') : 0;        // 挖掘暴击率
    const rareRate = kind === 'gather' ? skill('rareMaterial') : 0; // 采集稀有材料概率
    const dblRate = skill('doubleMaterial');                       // 💎 英雄「吴炼师」材料翻倍
    let full = false, crits = 0, rares = 0, doubles = 0;

    for (let a = 0; a < actions; a++) {
      if (emptyCount() <= 0) { full = true; break; }
      if (!free && !consumeCharge(kind)) break;      // 免费模式（一键收获）不扣体力
      /* 挖掘暴击：本次产出 ×2（再跑一轮） */
      const crit = critRate > 0 && U.chance(critRate);
      const rounds = crit ? 2 : 1;
      if (crit) crits++;
      for (let r = 0; r < rounds; r++) {
        for (let i = 0; i < per; i++) {
          if (emptyCount() <= 0) { full = true; break; }
          let id = cands[U.randInt(0, cands.length - 1)];
          let lvl = 1;
          if (rareRate > 0 && U.chance(rareRate)) {  // 自然亲和：升级为稀有材料
            const up = upgradeId(id);
            if (up) { id = up; lvl = 2; rares++; }
          }
          if (addToGrid(id, lvl)) {
            out.push(id);
            /* 💎 材料翻倍：按概率再白给一个同样的材料 */
            if (dblRate > 0 && U.chance(dblRate) && emptyCount() > 0 && addToGrid(id, lvl)) {
              out.push(id); doubles++;
            }
          }
        }
      }
    }

    if (out.length) {
      const agg = {};
      out.forEach(function (id) { agg[id] = (agg[id] || 0) + 1; });
      const text = Object.keys(agg).map(function (id) {
        const m = materialMeta(id);
        return m.icon + m.name + '×' + agg[id];
      }).join('、');
      FG.toast((kind === 'dig' ? '⛏️ 挖到 ' : '🌿 采到 ') + text +
        (crits ? '（💥 矿工之眼暴击 ×2）' : '') +
        (rares ? '（✨ 自然亲和 ' + rares + ' 个稀有材料）' : '') +
        (doubles ? '（🎁 材料翻倍 ×' + doubles + '）' : ''), 'ok');
      console.log('[merge] produce', kind, JSON.stringify(agg), 'crit=' + crits, 'rare=' + rares, 'double=' + doubles);
      if (full) FG.toast('合成台已满，请先合成或清空', 'warn');
    } else {
      const st = chargesState();
      const cur = kind === 'dig' ? st.dig : st.gather;
      if (full) FG.toast('合成台已满，请先合成或清空', 'warn');
      else if (!free && cur <= 0) {
        FG.toast((kind === 'dig' ? '挖掘' : '采集') + '体力不足，恢复中 ' + st.countdown, 'warn');
      }
    }
    FG.save.markDirty();
    return out;
  }

  /* ---------------- 合成台自动随机生成 ---------------- */

  const auto = { timer: 0, fullWarned: false };

  function autoSpawnTick() {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;   // 后台不空转
    if (emptyCount() <= 0) {
      if (!auto.fullWarned) {
        auto.fullWarned = true;
        FG.toast('合成台已满，自动生成已暂停', 'warn');
      }
      return;
    }
    auto.fullWarned = false;
    const pick = spawnOne();
    if (!pick) return;
    // 只在合成台页刷新，且拖拽中不重建 DOM（避免打断拖拽）
    const tab = FG.ui && FG.ui.layout ? FG.ui.layout.getActiveTab() : '';
    const dragging = FG.ui && FG.ui.mergeBoard && FG.ui.mergeBoard.isDragging && FG.ui.mergeBoard.isDragging();
    if (tab === 'merge' && !dragging) FG.render.renderStage();
    console.log('[merge] auto spawn', pick.id, 'Lv.' + pick.level);
  }

  function startAutoSpawn() {
    const cfga = FG.CONFIG.merge.autoSpawn || {};
    if (cfga.enabled === false) return false;
    if (auto.timer) return true;
    const ms = Math.max(200, Number(cfga.intervalMs) || 2000);
    auto.timer = setInterval(autoSpawnTick, ms);
    console.log('[merge] 自动生成已启动：每 ' + ms + 'ms 一个材料');
    return true;
  }
  function stopAutoSpawn() { if (auto.timer) { clearInterval(auto.timer); auto.timer = 0; } }
  function isAutoSpawnRunning() { return !!auto.timer; }

  function dig(times) { return produce('dig', times); }
  function gather(times) { return produce('gather', times); }

  /** 可收获的最低等级（默认 Lv.2：Lv.1 原始 → Lv.2 一合，就能收） */
  function harvestMinLevel() {
    const cf = FG.CONFIG.merge.harvest || {};
    return Math.max(1, Number(cf.minLevel) || 2);
  }
  /** 单个格子是否可收（供 UI 画角标） */
  function isHarvestable(it) {
    if (!it) return false;
    return (Number(it.level) || materialMeta(it.id).level || 1) >= harvestMinLevel();
  }
  /** 可收获的材料：达到 harvest.minLevel 的高级材料 */
  function harvestableItems() { return grid().filter(isHarvestable); }
  /** 待收获数量（UI 用它决定按钮可用态与文案） */
  function harvestableCount() { return harvestableItems().length; }

  /**
   * 一键收获：把合成台上**达到 harvest.minLevel（默认 Lv.3）的高级材料**收进背包 `bag.materials`，
   * 低等级材料（Lv.1 原始、Lv.2 一次合成产物）留在台上继续合。
   * - 不产出新材料、不消耗体力
   * - 台面上没有够等级的材料时明确提示「暂无可收集的物品」（不静默失败）
   * - 背包材料由 04 配方合成等系统通过 `countOwned()`（合成台 + 背包）取用
   * - 事务：先入账再移除对应格子，任一步失败整体回滚（10 §8）
   * @returns {{count:number, byId:Object, free:boolean}}
   */
  function harvestAll() {
    const cf = FG.CONFIG.merge.harvest || {};
    const items = harvestableItems();
    if (!items.length) {
      const min = harvestMinLevel();
      const need = Math.max(0, min - 1);           // Lv.1 → Lv.min 需要二合几次
      FG.toast('暂无可收集的物品——需要 Lv.' + min + ' 以上的材料' +
        (need ? '（先二合 ' + need + ' 次）' : ''), 'warn');
      return { count: 0, byId: {}, free: cf.free !== false };
    }

    const snap = snapshot();                       // 网格 + 背包材料快照，失败可回滚
    const agg = {};
    items.forEach(function (it) { agg[it.id] = (agg[it.id] || 0) + 1; });

    try {
      Object.keys(agg).forEach(function (id) {
        FG.bag.add('materials', id, agg[id]);      // 先入背包
        /* 06 §1.2：材料首次获得自动收录图鉴 */
        if (FG.systems.codex && FG.systems.codex.recordMaterial) FG.systems.codex.recordMaterial(id);
      });
      const keep = new Set(items.map(function (it) { return it.cell; }));
      FG.getState()[KEY] = grid().filter(function (it) { return !keep.has(it.cell); });   // 再移除已收的格子
    } catch (e) {
      restore(snap);                               // 回滚：网格与背包恢复原样
      console.warn('[merge] 收获失败，已回滚', e);
      FG.toast('收获失败，已回滚', 'err');
      return { count: 0, byId: {}, free: cf.free !== false };
    }

    FG.save.markDirty();
    const total = items.length;
    const text = Object.keys(agg).slice(0, 4).map(function (id) {
      const m = materialMeta(id);
      return m.icon + m.name + '×' + agg[id];
    }).join('、') + (Object.keys(agg).length > 4 ? ' 等' : '');
    FG.toast('📦 收获 ' + total + ' 件材料 → 背包：' + text, 'ok');
    console.log('[merge] harvest', total, JSON.stringify(agg));
    return { count: total, byId: agg, free: cf.free !== false };
  }

  /** 清空合成台（调用方负责二次确认） */
  function clearGrid() {
    const s = FG.getState();
    const n = grid().length;
    s[KEY] = [];
    FG.save.markDirty();
    FG.toast('已清空合成台（' + n + ' 件材料）', 'warn');
    return n;
  }

  /* ---------------- 供 04 配方合成使用的材料账本 ---------------- */

  function countInGrid(id) {
    return grid().filter(function (it) { return it.id === id; }).length;
  }
  function countInBag(id) {
    return FG.bag.getCount('materials', id);
  }
  /** 拥有量 = 合成台 + 背包 */
  function countOwned(id) { return countInGrid(id) + countInBag(id); }

  /** 事务快照：网格 + 背包材料（失败回滚用） */
  function snapshot() {
    const s = FG.getState();
    return {
      grid: JSON.parse(JSON.stringify(s[KEY] || [])),
      materials: JSON.parse(JSON.stringify(s.bag.materials || {}))
    };
  }
  function restore(snap) {
    const s = FG.getState();
    if (!snap) return false;
    s[KEY] = snap.grid;
    s.bag.materials = snap.materials;
    FG.save.markDirty();
    return true;
  }

  /** 材料是否充足（不足项返回明细） */
  function checkCost(cost) {
    const missing = [];
    Object.keys(cost || {}).forEach(function (id) {
      const need = cost[id];
      const own = countOwned(id);
      if (own < need) missing.push({ id: id, need: need, own: own });
    });
    return { ok: missing.length === 0, missing: missing };
  }

  /** 扣减材料：先扣合成台，再扣背包；不足则整体失败（调用方先用 checkCost） */
  function deduct(id, n) {
    const need = Number(n) || 0;
    if (countOwned(id) < need) return false;
    let left = need;
    const s = FG.getState();
    const fromGrid = Math.min(left, countInGrid(id));
    if (fromGrid > 0) {
      let removed = 0;
      s[KEY] = grid().filter(function (it) {
        if (it.id === id && removed < fromGrid) { removed++; return false; }
        return true;
      });
      left -= removed;
    }
    if (left > 0) {
      if (!FG.bag.remove('materials', id, left)) {
        // 理论上不会发生（已校验），兜底回滚由调用方 restore 处理
        console.warn('[merge] 背包扣减失败', id, left);
        return false;
      }
    }
    FG.save.markDirty();
    return true;
  }

  /* ---------------- 调试：补给材料（07 市场接入前的验证入口） ---------------- */

  function grantDebugMaterials() {
    const cfg = FG.CONFIG.debug || {};
    const n = cfg.grantAmount || 6;
    const ids = Object.keys(defs());
    let total = 0;
    ids.forEach(function (id) {
      FG.bag.add('materials', id, n);
      total += n;
    });
    FG.save.markDirty();
    FG.toast('🧪 调试：已补给 ' + ids.length + ' 种材料 ×' + n, 'warn');
    console.log('[merge] debug grant', ids.length, 'x', n, '=', total);
    FG.render.renderAll();
    return total;
  }

  /* ---------------- 初始化 ---------------- */

  /** 初始化网格：清理非法项（格子越界/未知材料），保持 ≤ boardSize */
  function initGrid() {
    const s = FG.getState();
    const size = boardSize();
    const seen = {};
    const cleaned = [];
    (Array.isArray(s[KEY]) ? s[KEY] : []).forEach(function (it) {
      if (!it || !isMaterial(it.id)) return;
      const c = cellIndex(it.cell);
      if (c < 0 || seen[c]) return;
      seen[c] = 1;
      cleaned.push({
        id: it.id,
        level: Number(it.level) || materialMeta(it.id).level,
        cell: c,
        merged: !!it.merged                          // 「已合成」标记要随存档保留
      });
    });
    if (cleaned.length > size) cleaned.length = size;
    s[KEY] = cleaned.sort(function (a, b) { return a.cell - b.cell; });
    if (typeof s.mergeCount !== 'number') s.mergeCount = 0;
    if (typeof s.digCharges !== 'number') s.digCharges = FG.CONFIG.charges.digMax;
    if (typeof s.gatherCharges !== 'number') s.gatherCharges = FG.CONFIG.charges.gatherMax;
    if (typeof s.lastChargeRegen !== 'number') s.lastChargeRegen = Date.now();
    return s[KEY];
  }

  S.merge = {
    /* 元数据 */
    materialMeta: materialMeta, isMaterial: isMaterial,
    chainGate: chainGate, unlockedChains: unlockedChains, getNextLevelItem: getNextLevelItem,
    /* 网格 */
    grid: grid, itemAt: itemAt, firstEmptyCell: firstEmptyCell, emptyCount: emptyCount,
    boardSize: boardSize,
    emptyCells: emptyCells, pickCell: pickCell,
    addToGrid: addToGrid, placeItem: placeItem, clearCell: clearCell,
    canMerge: canMerge, applyDrop: applyDrop, tryMerge: tryMerge,
    unlockChain: unlockChain, toggleAutoMerge: toggleAutoMerge, clearGrid: clearGrid,
    autoMergeStep: autoMergeStep,
    /* 体力与产出 */
    regenCharges: regenCharges, chargesState: chargesState, consumeCharge: consumeCharge,
    buyCharges: buyCharges,
    produce: produce, dig: dig, gather: gather,
    harvestAll: harvestAll, harvestableItems: harvestableItems, harvestableCount: harvestableCount,
    isHarvestable: isHarvestable, harvestMinLevel: harvestMinLevel,
    sourceList: sourceList, rollSpawn: rollSpawn, spawnOne: spawnOne,
    startAutoSpawn: startAutoSpawn, stopAutoSpawn: stopAutoSpawn,
    autoSpawnTick: autoSpawnTick, isAutoSpawnRunning: isAutoSpawnRunning,
    /* 材料账本（供 04） */
    countInGrid: countInGrid, countInBag: countInBag, countOwned: countOwned,
    snapshot: snapshot, restore: restore, checkCost: checkCost, deduct: deduct,
    /* 其他 */
    grantDebugMaterials: grantDebugMaterials, initGrid: initGrid
  };
})(window.FG = window.FG || {});
