/* ============================================================
   src/systems/fishing.js · 01 核心循环：钓鱼
   状态机：idle → waiting → biting → tension → reel → caught → idle
   依赖：CONFIG.fishing / CONFIG.fish / CONFIG.locations、systems.equip（加成与饵料校验）
   约束：
     - 数值全部来自 config，业务代码无魔法数字（00 §4.1）
     - 运行时数据只存在本模块 rt 对象，禁止把状态写进 DOM（00 §4.2）
     - 每个等待玩家的阶段都有超时 + 失败分支，绝不永久停留（01 §2 / 10 §2）
     - 高频动画用 requestAnimationFrame，切阶段必 clearTimeout / cancelAnimationFrame（10 §9）
   边界：不做装备切换（只调 equip.openEquipPanel）、不做合成/市场/图鉴系统
   ============================================================ */
(function (FG) {
  'use strict';
  const S = FG.systems = FG.systems || {};
  const U = FG.utils;

  /* ---------------- 运行时状态（不入档，01 §3） ---------------- */
  const rt = {
    phase: 'idle',      // idle | waiting | biting | tension | reel | caught
    timers: [],         // 全部 setTimeout id，切阶段统一清理
    raf: 0,             // rAF id
    waitEndsAt: 0,
    biteEndsAt: 0,
    tension: null,      // { rounds, need, hits, results, targetLeft, targetWidth, cursor, dir, endsAt, locked, lastResult }
    reel: null,         // { progress, gain, endsAt, clicks }
    caught: null,       // 待结算的鱼
    recent: []          // 最近 3 条（运行时，不入库）
  };

  function cfg() { return FG.CONFIG.fishing; }
  function getPhase() { return rt.phase; }
  function getRuntime() { return rt; }
  function setPhase(p) { rt.phase = p; console.log('[fishing] phase →', p); }

  function later(fn, ms) { const id = setTimeout(fn, ms); rt.timers.push(id); return id; }
  function clearTimers() {
    rt.timers.forEach(function (id) { clearTimeout(id); });
    rt.timers.length = 0;
    if (rt.raf) { cancelAnimationFrame(rt.raf); rt.raf = 0; }
  }

  /* ---------------- 阶段一 · 抛竿等待 ---------------- */

  /**
   * 抛竿：前置校验（鱼竿 / 饵料）→ 扣饵料 → 随机等待 waitMin~waitMax
   * 校验失败走 equip 的提示与装备面板，禁止静默失败（01 §5）
   */
  function castRod() {
    if (rt.phase !== 'idle') return false;
    const equip = FG.systems.equip;
    if (!equip) return false;

    if (!equip.getEquipped('rod')) {                    // 01 §5：未装备鱼竿
      FG.toast('未装备鱼竿', 'warn');
      equip.openEquipPanel('rod');
      return false;
    }
    /* 05 §3：未解锁的钓场只能预览，不能钓鱼（正常流程下 currentLocation 一定是已解锁的，这里兜底） */
    const growth = FG.systems.growth;
    const here = FG.getState().currentLocation;
    if (growth && growth.canEnter && !growth.canEnter(here)) {
      FG.toast('🔒 当前钓场尚未解锁，先在左栏切换钓场', 'warn');
      return false;
    }

    if (!equip.prepareCast()) return false;             // 未装备/耗尽饵料：内部已 toast + 开面板
    equip.consumeBait();

    const s = FG.getState();
    s.stats.fishingAttempts = (s.stats.fishingAttempts || 0) + 1;
    FG.save.markDirty();

    const wait = U.randInt(cfg().waitMin, cfg().waitMax);
    rt.waitEndsAt = Date.now() + wait;
    setPhase('waiting');
    later(onWaitEnd, wait);
    FG.toast('🎣 抛竿中...等待鱼儿上钩');
    FG.render.renderFishing();
    return true;
  }

  /**
   * 派生数值统一入口：02 的装备加成 + 05 的技能加成
   * 技能效果由 growth.getSkillEffect 读取，这里不做任何硬编码（05 §4）
   */
  function derived() {
    const d = FG.systems.equip.getDerived();
    const g = FG.systems.growth;
    return (g && g.tuneDerived) ? g.tuneDerived(d) : d;
  }

  /** 等待结束：按咬钩概率判定是否有鱼；无鱼 → 失败回 idle（01 §5） */
  function onWaitEnd() {
    if (rt.phase !== 'waiting') return;
    const rate = U.clamp(derived().biteRate, 0, 1);
    if (!U.chance(rate)) return fail('这片水域暂时没有鱼...', 'no-fish');

    const window_ = derived().biteWindow;   // 受鱼线韧性（02 §5.3）+ 眼疾手快（05）加成
    rt.biteEndsAt = Date.now() + window_;
    setPhase('biting');
    later(onBiteTimeout, window_);
    FG.toast('❗ 有鱼咬钩了！快点击！');
    FG.render.renderFishing();
  }

  /* ---------------- 阶段二 · 咬钩 ---------------- */

  /** 玩家提竿成功（点击场景 / 主按钮 / 空格） */
  function onBiteHit() {
    if (rt.phase !== 'biting') return false;
    clearTimers();
    return startTension();
  }

  /** 咬钩超时：不计消耗，可立即重抛（01 §5） */
  function onBiteTimeout() {
    if (rt.phase !== 'biting') return;
    fail('反应太慢，鱼跑了...', 'bite-timeout');
  }

  /* ---------------- 阶段三 · 张力判定 ---------------- */

  function startTension() {
    const c = cfg();
    const d = derived();
    const rounds = U.randInt(c.roundsMin, c.roundsMax);
    rt.tension = {
      rounds: rounds,
      need: Math.ceil(rounds * c.requiredHitsRatio),
      cursorSpeed: d.cursorSpeed,          // 受「慢条斯理」影响，rAF 里直接用，避免每帧重算
      hits: 0,
      results: [],
      targetLeft: 0, targetWidth: 0,
      cursor: 0, dir: 1,
      endsAt: Date.now() + c.tensionTimeout,
      locked: false, lastResult: null
    };
    setPhase('tension');
    nextTensionRound();
    later(onTensionTimeout, c.tensionTimeout);   // 兜底：后台标签页 rAF 被暂停时仍能超时
    startTensionLoop();
    FG.toast('⚡ 张力判定：把指针拉进绿区！');
    FG.render.renderFishing();
    return true;
  }

  /** 新一轮：绿区位置与宽度重新随机，宽度受鱼钩钩率（02 §5.3）+ 稳如泰山（05）加成 */
  function nextTensionRound() {
    const c = cfg();
    const d = derived();
    const t = rt.tension;
    const raw = U.randInt(Math.round(c.targetWidthMin * 1000), Math.round(c.targetWidthMax * 1000)) / 1000;
    t.targetWidth = U.clamp(raw * (1 + d.bonus.accuracy * FG.CONFIG.equip.accuracyToTargetWidth), 0.05, c.maxTargetWidthRatio);
    t.targetLeft = Math.random() * (1 - t.targetWidth);
    t.cursor = 0; t.dir = 1; t.locked = false; t.lastResult = null;
  }

  /** rAF 驱动指针往复移动；同时刷新倒计时（10 §9） */
  function startTensionLoop() {
    let last = (window.performance && performance.now) ? performance.now() : Date.now();
    const step = function (now) {
      if (rt.phase !== 'tension') { rt.raf = 0; return; }
      const t = rt.tension;
      const dt = Math.min(Math.max(now - last, 0), 100);      // 切后台回来时钳制，避免指针瞬移
      last = now;
      t.cursor += t.dir * (t.cursorSpeed || cfg().cursorSpeed) * dt;   // 单位 %/ms（已含技能加成）
      if (t.cursor >= 100) { t.cursor = 100; t.dir = -1; }
      if (t.cursor <= 0) { t.cursor = 0; t.dir = 1; }
      FG.render.renderFishing();
      rt.raf = requestAnimationFrame(step);
    };
    rt.raf = requestAnimationFrame(step);
  }

  /** 玩家点「🎯 拉！」：判定指针是否落在绿区 */
  function tensionPull() {
    if (rt.phase !== 'tension') return false;
    const t = rt.tension;
    if (t.locked) return false;                                // 反馈期内忽略连点，防状态错乱
    const hit = t.cursor >= t.targetLeft * 100 && t.cursor <= (t.targetLeft + t.targetWidth) * 100;
    t.locked = true;
    t.lastResult = hit;
    if (hit) t.hits++;
    t.results.push(hit);
    FG.toast(hit ? '✅ 命中！' : '❌ 未命中', hit ? 'ok' : 'warn');
    FG.render.renderFishing();

    later(function () {
      if (rt.phase !== 'tension') return;
      if (t.hits >= t.need) return startReel();
      if (t.results.length >= t.rounds) return fail('拉力失败，鱼挣脱了...', 'tension-miss', hitDetail());
      nextTensionRound();
      FG.render.renderFishing();
    }, cfg().hitFeedbackMs);
    return hit;
  }

  /** 10s 硬超时（01 §2 硬约束） */
  function onTensionTimeout() {
    if (rt.phase !== 'tension') return;
    fail('张力超时，鱼挣脱了...', 'tension-timeout', hitDetail());
  }

  function hitDetail() {
    const t = rt.tension;
    if (!t) return '';
    return '命中 ' + t.hits + '/' + t.rounds + '，需 ' + t.need;
  }

  /* ---------------- 阶段四 · 疯狂收杆 ---------------- */

  function startReel() {
    clearTimers();
    const c = cfg();
    const d = derived();
    rt.reel = { progress: 0, gain: d.reelGainPerClick, endsAt: Date.now() + c.reelDuration, clicks: 0 };
    setPhase('reel');
    later(onReelTimeout, c.reelDuration);                      // 兜底超时
    startReelLoop();
    FG.toast('🔥 疯狂收杆！');
    FG.render.renderFishing();
  }

  function startReelLoop() {
    const step = function () {
      if (rt.phase !== 'reel') { rt.raf = 0; return; }
      FG.render.renderFishing();
      rt.raf = requestAnimationFrame(step);
    };
    rt.raf = requestAnimationFrame(step);
  }

  /** 每次点击 +reelGainPerClick%，达 100% 即上岸 */
  function reelClick() {
    if (rt.phase !== 'reel') return false;
    const c = cfg();
    const r = rt.reel;
    r.progress = Math.min(c.reelTarget, r.progress + r.gain);
    r.clicks++;
    if (r.progress >= c.reelTarget) return landFish();
    FG.render.renderFishing();
    return true;
  }

  function onReelTimeout() {
    if (rt.phase !== 'reel') return;
    const pct = rt.reel ? rt.reel.progress.toFixed(1) : '0.0';
    fail('收杆失败', 'reel-timeout', '最终进度 ' + pct + '%');
  }

  /* ---------------- 阶段五 · 上鱼与结算 ---------------- */

  /** 掉落：先按钓场取鱼种，再按稀有度权重抽鱼，重量在区间内随机（01 §6） */
  function rollFish() {
    const s = FG.getState();
    const loc = FG.CONFIG.locations[s.currentLocation] || FG.CONFIG.locations.river;
    const pool = (loc.fish || []).filter(function (id) { return FG.CONFIG.fish[id]; });
    const weights = loc.rarityWeight || {};
    const rarities = Object.keys(weights).filter(function (r) {
      return pool.some(function (id) { return FG.CONFIG.fish[id].rarity === r; });
    });
    /* 05 §4：稀有鱼概率 / 鱼重量 / 售鱼价 三个技能加成，全部走 getSkillEffect */
    const g = FG.systems.growth;
    const eff = (g && g.getSkillEffect) ? g.getSkillEffect : function () { return 0; };
    const rareBonus = eff('rareRate');
    const weightMul = 1 + eff('fishWeight');
    const priceMul = 1 + eff('fishPrice');
    const HIGH = ['rare', 'epic', 'legendary'];
    const rarity = weightedRandom(rarities, function (r) {
      return weights[r] * (HIGH.indexOf(r) !== -1 ? (1 + rareBonus) : 1);
    }) || 'common';
    const candidates = pool.filter(function (id) { return FG.CONFIG.fish[id].rarity === rarity; });
    const id = candidates[U.randInt(0, candidates.length - 1)];
    const f = FG.CONFIG.fish[id];
    const weight = +((Math.random() * (f.weightMax - f.weightMin) + f.weightMin) * weightMul).toFixed(2);
    const price = Math.round(FG.CONFIG.economy.fishBasePrice * FG.CONFIG.economy.rarityPriceFactor[f.rarity] * weight * priceMul);
    return { id: id, name: f.name, icon: f.icon, rarity: rarity, weight: weight, desc: f.desc, price: price };
  }

  function weightedRandom(list, weightOf) {
    if (!list.length) return null;
    const total = list.reduce(function (sum, k) { return sum + (Number(weightOf(k)) || 0); }, 0);
    if (total <= 0) return list[0];
    let r = Math.random() * total;
    for (let i = 0; i < list.length; i++) {
      r -= Number(weightOf(list[i])) || 0;
      if (r <= 0) return list[i];
    }
    return list[list.length - 1];
  }

  /** 上岸：进入 caught，弹结算卡片（渲染由 render 负责） */
  function landFish() {
    clearTimers();
    rt.caught = rollFish();
    rt.reel = null;
    setPhase('caught');
    FG.toast('🎉 上鱼了！' + rt.caught.name + ' ' + U.formatWeight(rt.caught.weight) + 'kg', 'ok');
    FG.render.renderFishing();                 // 先切到「4.上了」视频
    /* 🆕 让「上了」演出先播 catchShowMs 再弹结算卡片：
       卡片是居中浮层，立刻弹出会正好盖住场景，玩家看不到上鱼视频 */
    later(function () {
      if (rt.phase !== 'caught' || !rt.caught) return;   // 期间被放弃/结算则不再弹
      FG.render.showCatchCard(rt.caught);
    }, Number(cfg().catchShowMs) || 1400);
    return true;
  }

  /**
   * 结算三选一（01 §5）
   * @param {'bag'|'codex'|'sell'} action
   */
  function settle(action) {
    if (rt.phase !== 'caught' || !rt.caught) return false;
    const f = rt.caught;
    const s = FG.getState();

    if (action === 'bag') {
      const cur = FG.bag.getCount('fish', f.id);
      const prev = (s.bag.fish[f.id] && s.bag.fish[f.id].weights) || [];
      s.bag.fish[f.id] = { count: cur + 1, weights: prev.concat([f.weight]) };
      FG.toast('🎒 ' + f.name + ' 已收入背包', 'ok');
    } else if (action === 'codex') {
      /* 06 §1.2：收录统一走 codex.recordFish（写图鉴 + 里程碑奖励 + 首次收录经验） */
      if (FG.systems.codex && FG.systems.codex.recordFish) {
        const r = FG.systems.codex.recordFish(f.id, f.weight);
        FG.toast(r && r.firstTime
          ? '📖 首次收录 ' + f.name + '（已珍藏，不可出售）'
          : '📖 已收录 ' + f.name + '（最大 ' + U.formatWeight(
            ((s.codex.fish || {})[f.id] || {}).maxWeight || f.weight) + 'kg）', 'ok');
      } else {
        const c = s.codex.fish[f.id] || { count: 0, best: 0, firstAt: 0 };
        c.count++; c.best = Math.max(c.best || 0, f.weight); c.firstAt = c.firstAt || Date.now();
        s.codex.fish[f.id] = c;
        FG.toast('📖 已收录 ' + f.name + '（不可出售）', 'ok');
      }
    } else if (action === 'sell') {
      /* 06 §1.2 / 07 §3.1：已入图鉴（珍藏）的鱼不可出售 */
      if (FG.systems.codex && FG.systems.codex.isFishCollected && FG.systems.codex.isFishCollected(f.id)) {
        FG.toast('「' + f.name + '」已珍藏，不可出售（可放入背包或加工）', 'warn');
        return false;
      }
      s.gold += f.price;
      s.stats.totalGoldEarned = (s.stats.totalGoldEarned || 0) + f.price;
      FG.toast('💰 售出 ' + f.name + ' 获得 ' + f.price + ' 金币', 'ok');
    } else {
      return false;
    }

    // 统一结算：经验 + 统计 + 存档 + 回 idle（01 §5）
    /* 05 §2：经验统一走 growth.addExp（内含升级判定与解锁清单），不再直接写 state.exp */
    if (FG.systems.growth && FG.systems.growth.addExp) {
      FG.systems.growth.addExp(FG.CONFIG.level.expPerFish[f.rarity] || 0, 'fish');
    } else {
      s.exp += (FG.CONFIG.level.expPerFish[f.rarity] || 0);
    }
    s.stats.totalFishCaught = (s.stats.totalFishCaught || 0) + 1;
    s.stats.biggestFish = Math.max(s.stats.biggestFish || 0, f.weight);

    rt.recent.unshift({ id: f.id, name: f.name, icon: f.icon, weight: f.weight, price: f.price, action: action });
    if (rt.recent.length > 3) rt.recent.length = 3;

    rt.caught = null;
    clearTimers();
    setPhase('idle');
    FG.save.markDirty();
    FG.render.renderAll();
    return true;
  }

  /* ---------------- 失败与放弃 ---------------- */

  /** 统一失败出口：清定时器 → 回 idle → 明确文案（01 §8） */
  function fail(text, code, detail) {
    clearTimers();
    rt.tension = null; rt.reel = null; rt.caught = null;
    setPhase('idle');
    FG.toast('😢 ' + text + (detail ? '（' + detail + '）' : ''), 'warn');
    console.log('[fishing] fail', code || '');
    /* 🆕 失败演出：短暂播放「断了」的背景视频，随后自动回到 idle 视频（不改任何状态） */
    if (FG.render && FG.render.flashSceneVideo) FG.render.flashSceneVideo('fail');
    FG.render.renderFishing();
    FG.render.renderAll();
    return false;
  }

  /** 放弃：任何进行中阶段都能安全回到 idle（玩家总有出口） */
  function abandonFishing(reason) {
    if (rt.phase === 'idle' || rt.phase === 'caught') return false;
    clearTimers();
    rt.tension = null; rt.reel = null;
    setPhase('idle');
    FG.toast('已放弃本次垂钓', 'warn');
    console.log('[fishing] abandon', reason || '');
    FG.render.renderFishing();
    FG.render.renderAll();
    return true;
  }

  /* ---------------- 主操作分派 ---------------- */

  /** 空格 / 主按钮 / 场景点击共用入口，按阶段分派 */
  function onMainAction() {
    switch (rt.phase) {
      case 'idle': return castRod();
      case 'biting': return onBiteHit();
      case 'tension': return tensionPull();
      case 'reel': return reelClick();
      default: return false;                                   // waiting / caught：忽略，不产生状态错乱
    }
  }

  S.fishing = {
    getPhase: getPhase,
    getRuntime: getRuntime,
    castRod: castRod,
    enterBite: onWaitEnd,          // 等待结束 → 咬钩（调试/测试可直接调用）
    onBiteHit: onBiteHit,
    startTension: startTension,
    nextTensionRound: nextTensionRound,
    tensionPull: tensionPull,
    startReel: startReel,
    reelClick: reelClick,
    rollFish: rollFish,
    landFish: landFish,
    settle: settle,
    abandonFishing: abandonFishing,
    onMainAction: onMainAction
  };
})(window.FG = window.FG || {});
