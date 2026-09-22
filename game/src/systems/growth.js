/* ============================================================
   src/systems/growth.js · 05 成长体系：等级 / 钓场 / 技能树
   依赖：CONFIG.level / CONFIG.locations / CONFIG.skills / CONFIG.craft
        state.level·exp·unlockedLocations·currentLocation·skills
   约束：
     - 数值全部来自 config.js，模块内禁止魔法数字（00 §4.1）
     - 切换/学习做白名单校验，非法值回退并 console.warn（10 §5）
     - 资产（金币）与次数等变更成对完成，失败回滚（10 §8）
     - 技能效果只对**外暴露 getSkillEffect(key)**，禁止把效果硬编码进判定逻辑
   ============================================================ */
(function (FG) {
  'use strict';
  const S = FG.systems = FG.systems || {};
  const U = FG.utils;

  const DEFAULT_LOCATION = 'river';        // 兜底钓场（Lv.1 起始点）

  function cfg() { return FG.CONFIG || {}; }
  function levelCfg() { return cfg().level || {}; }
  function skillCfg() { return cfg().skills || { lines: [] }; }
  function locations() { return cfg().locations || {}; }
  function level() { return Math.max(1, Number(FG.getState().level) || 1); }

  /* ================= 技能树 ================= */

  /** 扁平化的技能定义表 [{ id, line, index, def }] */
  function skillIndex() {
    const out = [];
    (skillCfg().lines || []).forEach(function (line) {
      (line.skills || []).forEach(function (sk, i) {
        out.push({ id: sk.id, line: line.key, index: i, def: sk, lineName: line.name });
      });
    });
    return out;
  }

  function skillDef(id) {
    const hit = skillIndex().filter(function (x) { return x.id === id; })[0];
    return hit || null;
  }

  /** 某技能的当前等级（0 = 未学习） */
  function skillLevel(id) {
    const s = FG.getState();
    const sk = (s.skills || {})[id];
    return Math.max(0, Math.min(skillCfg().maxLevel || 1, Number(sk) || 0));
  }

  /** 升下一级的成本：cost × costGrowth^当前等级 */
  function skillCost(id) {
    const hit = skillDef(id);
    if (!hit) return 0;
    const g = Number(skillCfg().costGrowth) || 1.6;
    return Math.round((Number(hit.def.cost) || 0) * Math.pow(g, skillLevel(id)));
  }

  /** 前序技能（同一条线内必须按顺序解锁） */
  function prevSkill(id) {
    const hit = skillDef(id);
    if (!hit || hit.index === 0) return null;
    const line = (skillCfg().lines || []).filter(function (l) { return l.key === hit.line; })[0];
    if (!line) return null;
    return (line.skills || [])[hit.index - 1] || null;
  }

  /**
   * 技能效果查询（唯一入口）：各模块只读这里，禁止硬编码
   * @param {'targetWidth'|'cursorSpeed'|'biteWindow'|'fishPrice'|'expGain'|'chargeMax'|'rareRate'|'fishWeight'} key
   * @returns {number} 已学技能该效果的合计值（等级累加）
   */
  function getSkillEffect(key) {
    let sum = 0;
    skillIndex().forEach(function (sk) {
      const lv = skillLevel(sk.id);
      if (lv > 0 && sk.def.effect && typeof sk.def.effect[key] === 'number') {
        sum += sk.def.effect[key] * lv;
      }
    });
    /* 💎 英雄加成（钻石系统）：与技能共用同一套 key，在这里统一汇总 → 各模块无需改动 */
    const d = S.diamond;
    if (d && typeof d.getEffect === 'function') sum += Math.max(0, Number(d.getEffect(key)) || 0);
    return sum;
  }

  /** 全量效果快照（调试/面板展示用） */
  function getSkillBonus() {
    return {
      friendExp: friendBonus(),          // 08 好友加成（不占技能槽，单独展示）
      targetWidth: getSkillEffect('targetWidth'),
      cursorSpeed: getSkillEffect('cursorSpeed'),
      biteWindow: getSkillEffect('biteWindow'),
      fishPrice: getSkillEffect('fishPrice'),
      expGain: getSkillEffect('expGain'),
      chargeMax: getSkillEffect('chargeMax'),
      rareRate: getSkillEffect('rareRate'),
      fishWeight: getSkillEffect('fishWeight'),
      /* 🆕 采集系 / 钓技系 / 经营系 */
      digCrit: getSkillEffect('digCrit'),
      rareMaterial: getSkillEffect('rareMaterial'),
      boardSlots: getSkillEffect('boardSlots'),
      castDistance: getSkillEffect('castDistance'),
      reelGain: getSkillEffect('reelGain'),
      productPrice: getSkillEffect('productPrice'),
      processSpeed: getSkillEffect('processSpeed'),
      processSlots: getSkillEffect('processSlots'),
      /* 💎 英雄专属效果 */
      codexDiamond: getSkillEffect('codexDiamond'),
      doubleMaterial: getSkillEffect('doubleMaterial'),
      goldGain: getSkillEffect('goldGain'),
      allAttr: getSkillEffect('allAttr')
    };
  }

  /**
   * 把技能加成叠加到 02 的派生数值上（01 读取派生值时调用）
   * 只做数值缩放，不碰状态机
   */
  function tuneDerived(d) {
    if (!d) return d;
    const b = getSkillBonus();
    const out = {
      /* 疯狂点击：收杆所需点击减少 10% = 每次点击增益 +10% */
      reelGainPerClick: d.reelGainPerClick * (1 + b.reelGain),
      /* 稳如泰山 + 铁腕遛鱼：绿区（命中区域）加宽 */
      targetWidth: d.targetWidth * (1 + b.targetWidth),
      cursorSpeed: d.cursorSpeed ? d.cursorSpeed : 0,
      /* 精准抛竿：抛投距离 +15% → 咬钩率提升（01 只读派生值） */
      biteRate: d.biteRate * (1 + b.castDistance),
      biteWindow: d.biteWindow + b.biteWindow,
      bonus: d.bonus
    };
    /* 指针速度：技能是负加成（更慢更好瞄），与配置里的 cursorSpeed 一起给 01 用 */
    out.cursorSpeed = Math.max(0.01, (d.cursorSpeed || cfg().fishing.cursorSpeed || 0.1) * (1 + b.cursorSpeed));
    return out;
  }

  /** 体力上限加成（03 的体力上限读取） */
  function chargeMaxBonus() { return Math.max(0, Math.round(getSkillEffect('chargeMax'))); }

  /** 单个技能的展示/可学状态 */
  function skillState(id) {
    const hit = skillDef(id);
    if (!hit) return null;
    const s = FG.getState();
    const lv = skillLevel(id);
    const max = skillCfg().maxLevel || 1;
    const maxed = lv >= max;
    const prev = prevSkill(id);
    const prevOk = !prev || skillLevel(prev.id) > 0;
    const cost = maxed ? 0 : skillCost(id);
    const gold = Number(s.gold) || 0;
    let reason = 'ok';
    if (maxed) reason = 'maxed';
    else if (!prevOk) reason = 'locked';
    else if (gold < cost) reason = 'poor';
    return {
      id: id, name: hit.def.name, desc: hit.def.desc, icon: hit.def.icon || '',
      line: hit.line, lineName: hit.lineName, index: hit.index,
      level: lv, maxLevel: max, cost: cost, maxed: maxed,
      prevName: prev ? prev.name : '', prevOk: prevOk,
      learnable: reason === 'ok',
      reason: reason,
      lack: reason === 'poor' ? (cost - gold) : 0,
      effectText: effectText(hit.def)
    };
  }

  /** 效果文案：按等级展示「+5%」/「+500ms」/「+1 个」 */
  function effectText(def) {
    const e = def.effect || {};
    const keys = Object.keys(e);
    if (!keys.length) return '';
    return keys.map(function (k) {
      const v = e[k];
      if (RAW_EFFECT[k] !== undefined) {
        /* 计数型效果：格位取整展示，工位按原值（整数配置） */
        const n = (k === 'boardSlots') ? Math.round(v) : v;
        return SKILL_EFFECT_NAME[k] + (n > 0 ? ' +' : ' ') + n + RAW_EFFECT[k];
      }
      const num = Math.round(v * 100);
      return SKILL_EFFECT_NAME[k] + (v > 0 ? ' +' : ' ') + num + '%';
    }).join('　');
  }
  /** 计数型效果（不按百分比展示）：key → 单位 */
  const RAW_EFFECT = { biteWindow: 'ms', chargeMax: '', boardSlots: ' 格', processSlots: ' 个' };
  const SKILL_EFFECT_NAME = {
    targetWidth: '绿区宽度', cursorSpeed: '指针速度', biteWindow: '咬钩窗口',
    fishPrice: '售鱼价', expGain: '经验', chargeMax: '体力上限',
    rareRate: '稀有鱼概率', fishWeight: '鱼重量',
    /* 🆕 采集系 / 钓技系 / 经营系 */
    digCrit: '挖掘暴击率', rareMaterial: '采集稀有材料', boardSlots: '合成台格位',
    castDistance: '抛投距离', reelGain: '收杆增益', productPrice: '制品售价',
    processSpeed: '加工时间', processSlots: '工位数量'
  };

  /**
   * 学习技能：校验前置 → 校验金币 → 扣款 + 升级（成对完成）
   * @returns {boolean}
   */
  function learnSkill(skillId) {
    const st = skillState(skillId);
    if (!st) { console.warn('[growth] 未知技能', skillId); FG.toast('技能不存在', 'warn'); return false; }
    if (st.maxed) { FG.toast('「' + st.name + '」已满级', 'warn'); return false; }
    if (!st.prevOk) { FG.toast('需先学习「' + st.prevName + '」', 'warn'); return false; }
    const s = FG.getState();
    if ((Number(s.gold) || 0) < st.cost) {
      FG.toast('金币不足：还差 🪙' + U.formatInt(st.lack), 'warn');
      return false;
    }
    s.gold = (Number(s.gold) || 0) - st.cost;
    s.skills = s.skills || {};
    s.skills[skillId] = st.level + 1;
    FG.save.markDirty();
    FG.toast('🌟 已学习「' + st.name + '」Lv.' + s.skills[skillId] + '（-🪙' + U.formatInt(st.cost) + '）', 'ok');
    console.log('[growth] learnSkill', skillId, '→', s.skills[skillId]);
    return true;
  }

  /* ================= 等级与经验 ================= */

  /** 升到下一级所需经验：expBase × expGrowth^(level-1) */
  function expToNext(lv) {
    const c = levelCfg();
    const l = Math.max(1, Number(lv == null ? level() : lv) || 1);
    return Math.round((Number(c.expBase) || 100) * Math.pow(Number(c.expGrowth) || 1.25, l - 1));
  }

  /** 经验进度 { level, exp, need, ratio } */
  function expProgress() {
    const s = FG.getState();
    const need = expToNext(level());
    const cur = Math.max(0, Number(s.exp) || 0);
    return { level: level(), exp: cur, need: need, ratio: Math.max(0, Math.min(1, cur / need)) };
  }

  /**
   * 还差多少经验才能到指定等级（用于「🔒 需要 Lv.N + 还差 X 经验」）
   */
  function expToLevel(target) {
    const s = FG.getState();
    const t = Math.max(1, Number(target) || 1);
    let lvl = level();
    let cur = Math.max(0, Number(s.exp) || 0);
    if (lvl >= t) return 0;
    let left = 0;
    while (lvl < t) {                       // 逐级累加剩余所需经验
      const need = expToNext(lvl);
      left += (need - cur);
      cur = 0;
      lvl++;
      if (lvl > 200) break;                 // 死循环兜底
    }
    return left;
  }

  /** 收集某个等级区间内新解锁的内容（钓场 / 配方 / 链），用于升级弹窗 */
  function collectUnlocks(fromLevel, toLevel) {
    const out = { locations: [], recipes: [], chains: [] };
    if (toLevel <= fromLevel) return out;

    Object.keys(locations()).forEach(function (id) {
      const l = Number(locations()[id].unlockLevel) || 1;
      if (l > fromLevel && l <= toLevel) {
        out.locations.push({ id: id, name: locations()[id].name || id, level: l, tab: 'fishing' });
      }
    });

    (cfg().craft && cfg().craft.recipes ? cfg().craft.recipes : []).forEach(function (r) {
      const l = Number(r.unlockLevel) || 0;
      if (l > fromLevel && l <= toLevel) {
        const it = (cfg().items || {})[r.id] || {};
        out.recipes.push({ id: r.id, name: it.name || r.id, level: l, tab: 'craft' });
      }
    });

    const chains = (cfg().merge && cfg().merge.chains) || {};
    Object.keys(chains).forEach(function (key) {
      const l = Number(chains[key].unlockLevel) || 0;
      if (l > fromLevel && l <= toLevel) {
        out.chains.push({ id: key, name: chains[key].name || key, level: l, tab: 'merge' });
      }
    });
    return out;
  }

  /** 处理升级（可能连升多级）；返回本次升级信息 */
  function checkLevelUp() {
    const s = FG.getState();
    const from = level();
    let guard = 0;
    while (guard++ < 200) {
      const need = expToNext(level());
      if ((Number(s.exp) || 0) < need) break;
      s.exp = (Number(s.exp) || 0) - need;
      s.level = level() + 1;
    }
    const to = level();
    if (to <= from) return { leveled: false, from: from, to: to, unlocks: collectUnlocks(from, to) };
    const added = syncLocations();
    const unlocks = collectUnlocks(from, to);
    unlocks.locations = unlocks.locations.filter(function (u) { return added.indexOf(u.id) !== -1 || true; });
    return { leveled: true, from: from, to: to, unlocks: unlocks, addedLocations: added };
  }

  /**
   * 加经验（唯一入口）：应用「勤学苦练」的经验加成后累计，并处理升级
   * @param {number} amount 原始经验
   * @param {string} [reason] 来源（fish/codex/craft/expo），仅用于日志
   * @returns {{gained:number, leveled:boolean, from:number, to:number, unlocks:Object}}
   */
  /** 08 好友经验加成（每人 +5%，上限 25%）：社交模块未接入时为 0 */
  function friendBonus() {
    const soc = S.social;
    return (soc && typeof soc.getFriendBonus === 'function') ? Math.max(0, Number(soc.getFriendBonus()) || 0) : 0;
  }

  function addExp(amount, reason) {
    const s = FG.getState();
    const raw = Math.max(0, Number(amount) || 0);
    const gained = Math.round(raw * (1 + getSkillEffect('expGain') + friendBonus()));
    s.exp = (Number(s.exp) || 0) + gained;
    const res = checkLevelUp();
    FG.save.markDirty();
    console.log('[growth] addExp', reason || '', raw, '→', gained, 'level', res.from, '→', res.to);

    if (res.leveled) {
      FG.toast('🎉 升级！Lv.' + res.to, 'ok');
      FG.animator && typeof FG.animator.celebrate === 'function' && FG.animator.celebrate();
      if (FG.ui && FG.ui.growth) FG.ui.growth.openLevelUpPanel(res);
    }
    return { gained: gained, leveled: res.leveled, from: res.from, to: res.to, unlocks: res.unlocks };
  }

  /** 经验来源（05 §2）：钓上鱼 / 首次收录 / 首次合成 / 完成博览会 */
  function awardFish(rarity) { return addExp(levelCfg().expPerFish ? levelCfg().expPerFish[rarity] || 0 : 0, 'fish'); }
  function awardCodex() { return addExp(levelCfg().expPerCodex || 0, 'codex'); }
  function awardCraft() { return addExp(levelCfg().expPerCraft || 0, 'craft'); }
  function awardExpo() { return addExp(levelCfg().expPerExpo || 0, 'expo'); }

  /* ================= 钓场 ================= */

  function meetsLevel(id) {
    const loc = locations()[id];
    if (!loc) return false;
    return level() >= (Number(loc.unlockLevel) || 1);
  }

  /**
   * 同步解锁列表：把等级达标的钓场写进 state.unlockedLocations（幂等）
   * 只增不减（活动解锁也走这张表）；同时剔除配置里不存在的脏 id（坏档防护，10 §5）
   */
  function syncLocations() {
    const s = FG.getState();
    const order = locationOrder();
    const have = {};
    (Array.isArray(s.unlockedLocations) ? s.unlockedLocations : []).forEach(function (id) { have[id] = 1; });
    const added = [];
    order.forEach(function (id) {
      if (!have[id] && meetsLevel(id)) { have[id] = 1; added.push(id); }
    });
    s.unlockedLocations = order.filter(function (id) { return have[id]; });
    if (!s.unlockedLocations.length) s.unlockedLocations = [DEFAULT_LOCATION];
    if (s.unlockedLocations.indexOf(s.currentLocation) === -1) s.currentLocation = s.unlockedLocations[0];
    if (added.length) FG.save.markDirty();
    return added;
  }

  function locationOrder() {
    const list = locations();
    return Object.keys(list).sort(function (a, b) {
      return (Number(list[a].unlockLevel) || 1) - (Number(list[b].unlockLevel) || 1);
    });
  }

  /** 7 个钓场的展示状态（含「还差多少经验」） */
  function locationsState() {
    const s = FG.getState();
    const list = locations();
    const unlocked = {};
    (Array.isArray(s.unlockedLocations) ? s.unlockedLocations : []).forEach(function (id) { unlocked[id] = 1; });
    return locationOrder().map(function (id) {
      const loc = list[id] || {};
      const needLevel = Number(loc.unlockLevel) || 1;
      return {
        id: id,
        name: loc.name || id,
        emoji: loc.emoji || '📍',
        desc: loc.desc || '',
        needLevel: needLevel,
        fishCount: (loc.fish || []).length,
        unlocked: !!unlocked[id],
        current: id === s.currentLocation,
        expLeft: unlocked[id] ? 0 : expToLevel(needLevel)
      };
    });
  }

  function unlockedCount() {
    const st = locationsState();
    return { unlocked: st.filter(function (x) { return x.unlocked; }).length, total: st.length };
  }

  function canEnter(id) {
    const s = FG.getState();
    return (Array.isArray(s.unlockedLocations) ? s.unlockedLocations : []).indexOf(id) !== -1;
  }

  /** 切换钓场：白名单 + 解锁校验（10 §5）；未解锁时提示还差多少经验 */
  function switchLocation(locationId) {
    const loc = locations()[locationId];
    if (!loc) {
      console.warn('[growth] 非法钓场 id，已忽略', locationId);
      FG.toast('该钓场不存在', 'warn');
      return false;
    }
    if (!canEnter(locationId)) {
      const need = Number(loc.unlockLevel) || 1;
      FG.toast('🔒 需要 Lv.' + need + ' 解锁「' + U.safe(loc.name, locationId) + '」（还差 ' +
        U.formatInt(expToLevel(need)) + ' 经验）', 'warn');
      return false;
    }
    const s = FG.getState();
    if (s.currentLocation === locationId) { FG.toast('已经在该钓场了'); return true; }
    s.currentLocation = locationId;
    FG.save.markDirty();
    FG.toast('📍 已切换钓场：' + U.safe(loc.name, locationId), 'ok');
    console.log('[growth] switchLocation →', locationId);
    return true;
  }

  function unlockLocation(locationId) {
    const loc = locations()[locationId];
    if (!loc) { console.warn('[growth] 未知钓场', locationId); return false; }
    if (meetsLevel(locationId)) {
      const added = syncLocations();
      return added.indexOf(locationId) !== -1 || canEnter(locationId);
    }
    const need = Number(loc.unlockLevel) || 1;
    FG.toast('还差一点：需要 Lv.' + need + '（还差 ' + U.formatInt(expToLevel(need)) + ' 经验）', 'warn');
    return false;
  }

  /** 钓场预览数据（未解锁也能看；鱼种未收录显示 ❓ ???） */
  function previewLocation(locationId) {
    const loc = locations()[locationId];
    if (!loc) return null;
    const s = FG.getState();
    const codex = (s.codex || {}).fish || {};
    const fishDict = cfg().fish || {};
    const needLevel = Number(loc.unlockLevel) || 1;
    return {
      id: locationId,
      name: loc.name || locationId,
      emoji: loc.emoji || '📍',
      desc: loc.desc || '',
      needLevel: needLevel,
      unlocked: canEnter(locationId),
      current: s.currentLocation === locationId,
      expLeft: canEnter(locationId) ? 0 : expToLevel(needLevel),
      fish: (loc.fish || []).map(function (id) {
        const f = fishDict[id] || {};
        const known = !!codex[id];
        return {
          id: id, known: known,
          name: known ? (f.name || id) : '???',
          icon: known ? (f.icon || '🐟') : '❓',
          rarity: f.rarity || 'common'
        };
      })
    };
  }

  S.growth = {
    /* 等级与经验 */
    addExp: addExp,
    awardFish: awardFish,
    awardCodex: awardCodex,
    awardCraft: awardCraft,
    awardExpo: awardExpo,
    expToNext: expToNext,
    expToLevel: expToLevel,
    expProgress: expProgress,
    checkLevelUp: checkLevelUp,
    collectUnlocks: collectUnlocks,
    /* 钓场 */
    locationsState: locationsState,
    locationOrder: locationOrder,
    meetsLevel: meetsLevel,
    canEnter: canEnter,
    syncLocations: syncLocations,
    unlockedCount: unlockedCount,
    unlockLocation: unlockLocation,
    switchLocation: switchLocation,
    previewLocation: previewLocation,
    DEFAULT_LOCATION: DEFAULT_LOCATION,
    /* 技能树 */
    skillIndex: skillIndex,
    skillDef: skillDef,
    skillLevel: skillLevel,
    skillCost: skillCost,
    skillState: skillState,
    learnSkill: learnSkill,
    getSkillEffect: getSkillEffect,
    getSkillBonus: getSkillBonus,
    tuneDerived: tuneDerived,
    chargeMaxBonus: chargeMaxBonus
  };
})(window.FG = window.FG || {});
