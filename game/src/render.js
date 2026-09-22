/* ============================================================
   src/render.js · 渲染入口（00 §4.2：render(state) 只读不写）
   职责：把 state 映射到骨架 DOM；所有模块只通过本文件更新界面，
        禁止跨模块直接操作 DOM（本文件除外）。
   提示：填入文案前统一走 utils.safe/format，禁止 undefined/NaN 上屏（10 §7）
   ============================================================ */
(function (FG) {
  'use strict';
  const U = FG.utils;

  /** 全量渲染（初始化与读档后调用；高频刷新请按区渲染） */
  function renderAll() {
    const s = FG.getState();
    const tab = FG.ui.layout.getActiveTab();
    renderTopBar(s);
    renderNav(s);
    renderBagTitle();                    // 顶栏 🎒 的 title（任何页签都刷新）
    if (tab === 'merge' || tab === 'craft' || tab === 'skill' || tab === 'workshop' ||
        tab === 'market' || tab === 'social' || tab === 'diamond') {
      renderStage(s);                    // 内部分派到合成台 / 配方 / 技能树 / 工坊 / 市场 / 社交 / 钻石
      return;
    }
    /* 钓鱼页：等级 + 钓场 + 装备槽 + 加成 + 盛产/最近收获 都在右栏，等级与钓场排最上面 */
    renderFishingSidebar(s);
    applyScene(s);
    renderEquipGrid(s);
    renderStage(s);
    renderRight(s);
  }

  /** 顶栏：等级 / 金币 / 经验 / 钻石 + 图鉴红点（06） */
  function renderTopBar(s) {
    set('stat-level', 'Lv.' + U.formatInt(s.level));
    set('stat-gold', '🪙' + U.formatInt(s.gold));
    set('stat-exp', '⭐' + U.formatInt(s.exp));
    set('stat-diamond', '💎' + U.formatInt(s.diamond));

    /* 06 §1.3：有未领取的图鉴奖励时，图鉴按钮显示红点 */
    const dot = document.getElementById('codex-dot');
    if (dot) {
      const n = (FG.systems.codex && FG.systems.codex.unclaimedCount) ? FG.systems.codex.unclaimedCount() : 0;
      dot.hidden = n <= 0;
      dot.textContent = n > 9 ? '9+' : String(n);
    }
  }

  /* ---------------- 装备 2×2 宫格（02 §7） ----------------
     注：左栏「装备选择」卡已按需求移除（钓鱼页左栏整列隐藏），
     装备入口统一为右栏「装备槽」→ 同一个 openEquipPanel；
     这里保留渲染函数，若以后左栏再挂这张卡，把 #equip-grid 加回骨架即可复用。
     ------------------------------------------------------------ */

  function renderEquipGrid(s) {
    const grid = document.getElementById('equip-grid');
    const extra = document.getElementById('equip-extra');
    if (!grid) return;

    grid.innerHTML = '';
    ['rod', 'hook', 'bait', 'line'].forEach(function (slot) {
      grid.appendChild(buildEquipCell(slot, s));
    });

    if (extra) {
      extra.innerHTML = '';
      extra.appendChild(buildEquipCell('net', s));   // 02 §9：渔网仅预留结构
    }
  }

  function buildEquipCell(slot, s) {
    const id = (s.equipped || {})[slot];
    const it = id ? (FG.CONFIG.items || {})[id] : null;
    const locked = (FG.CONFIG.equip.lockedSlots || []).indexOf(slot) !== -1;
    const count = id ? FG.bag.getCount('equipment', id) : 0;

    const cell = U.el('div', {
      class: 'equip-cell clickable' + (locked ? ' locked' : '') + (it ? ' glow-' + it.rarity : ''),
      'data-slot': slot,
      title: '点击更换' + U.safe(FG.ENUM.SLOT_NAME[slot], '')
    });

    let head = '<div class="eq-slot">' + U.safe(FG.ENUM.SLOT_ICON[slot], '▪️') + ' ' + U.safe(FG.ENUM.SLOT_NAME[slot], slot) + '</div>';
    let name, sub;

    if (locked) {
      name = '<span class="slot-empty">未开放</span>';
      sub = '结构预留';
    } else if (!it) {
      name = '<span class="slot-empty">未装备</span>';
      sub = '点击装备';
    } else {
      name = U.safe(it.icon, '') + ' ' + U.safe(it.name, id);
      sub = statText(it);
      if (it.consumable) {
        sub = '剩余 ×' + U.formatInt(count);
        if (count <= FG.CONFIG.equip.lowStockThreshold) sub += ' ⚠️';
      }
    }
    cell.innerHTML = head + '<div class="eq-name">' + name + '</div><div class="eq-extra">' + sub + '</div>';

    U.onPointer(cell, U.throttle(function () {
      if (locked) { FG.toast('🥅 渔网槽位尚未开放（结构已预留）', 'warn'); return; }
      FG.systems.equip.openEquipPanel(slot);
    }, FG.CONFIG.ui.throttleMs));
    return cell;
  }

  const PERCENT_STATS = ['stealth', 'bonus', 'accuracy'];   // 按百分比展示的属性

  /** 属性文案：名称按装备类型取（鱼钩「强度」/ 鱼线「拉力」），百分比属性补 % */
  function statText(it) {
    const stats = it && it.stats ? it.stats : {};
    const keys = Object.keys(stats);
    if (!keys.length) return '—';
    return keys.map(function (k) {
      return U.safe(FG.ENUM.STAT_ICON[k], '') +
        U.safe(FG.ENUM.statName ? FG.ENUM.statName(it.type, k) : FG.ENUM.STAT_NAME[k], k) + ' ' +
        stats[k] + (PERCENT_STATS.indexOf(k) !== -1 ? '%' : '');
    }).join('　');
  }

  /* ---------------- 钓鱼页右栏最上方：等级 + 钓场（其余页签不显示） ---------------- */

  function renderFishingSidebar(s) {
    if (FG.ui.growth) FG.ui.growth.renderLevel();
    if (FG.ui.locations) {
      FG.systems.growth.syncLocations();            // 等级达标的先同步解锁（幂等）
      FG.ui.locations.render();
      const c = FG.systems.growth.unlockedCount();
      set('location-count', c.unlocked + '/' + c.total + ' 已解锁');
    }
    void s;
  }

  /** 顶栏 🎒 的数量提示（任何页签都刷） */
  function renderBagTitle() {
    const bagBtn = document.getElementById('btn-bag');
    if (!bagBtn) return;
    const n = FG.bag.list('materials').length + FG.bag.list('fish').length + FG.bag.list('equipment').length;
    bagBtn.title = '背包（' + n + ' 种物品）';
  }

  /* ---------------- 主舞台 ---------------- */

  function renderStage(s) {
    const key = FG.ui.layout.getActiveTab();
    const meta = FG.ENUM.TAB_META[key];
    /* 🆕 非钓鱼页：暂停并隐藏背景视频（避免后台播放） */
    if (key !== 'fishing') pauseSceneVideo();
    // 03 / 04：主舞台按页签分派给对应面板（只渲染当前页签，避免无谓刷新）
    if (key === 'merge') { if (FG.ui.mergeBoard) FG.ui.mergeBoard.render(); return; }
    if (key === 'craft') { if (FG.ui.craftBoard) FG.ui.craftBoard.render(); return; }
    if (key === 'skill') {                                   // 05 §4 技能树
      if (FG.ui.growth) FG.ui.growth.renderSkillTree();
      renderSkillSummary();
      return;
    }
    if (key === 'workshop') {                                // 06 §2 工坊
      if (FG.ui.workshop) FG.ui.workshop.render();
      return;
    }
    if (key === 'market') {                                  // 07 §3 市场（售卖/购买/博览会）
      if (FG.ui.market) FG.ui.market.render();
      return;
    }
    if (key === 'social') {                                  // 08 社交（注册/钓友/挑战/频道/排行榜）
      if (FG.ui.social) FG.ui.social.render();
      return;
    }
    if (key === 'diamond') {                                 // 💎 钻石商店 + 英雄招募
      if (FG.ui.diamond) FG.ui.diamond.render();
      return;
    }
    const fishing = key === 'fishing';
    set('stage-title', fishing ? '🎣 疯狂钓鱼佬' : meta.icon + ' ' + meta.name);
    set('stage-sub', fishing ? '01 ｜ 核心循环 · 钓鱼' : '待实现');
    set('stage-desc', fishing
      ? '抛竿 → 等待 → 咬钩 → 张力 → 收杆 → 结算（每步都有反馈与超时出口）'
      : '《' + meta.name + '》将在后续轮次开放');
    renderFishing();
  }

  /** 顶部流程编号条 ①~⑥：高亮当前阶段、标记已完成（参考图"按操作流程安排反馈"） */
  function renderSteps(phase) {
    const box = document.getElementById('stage-steps');
    if (!box) return;
    const steps = FG.ENUM.FISH_STEPS || [];
    if (box.children.length !== steps.length) {
      box.innerHTML = '';
      steps.forEach(function (s) {
        box.appendChild(U.el('div', { class: 'step' },
          '<span class="step-no">' + s.no + '</span>' +
          '<span class="step-ico">' + s.icon + '</span>' +
          '<span class="step-label">' + s.name + '</span>'));
      });
    }
    let activeIdx = -1;
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].phases.indexOf(phase) !== -1) { activeIdx = i; break; }
    }
    const nodes = box.children;
    for (let j = 0; j < nodes.length; j++) {
      nodes[j].classList.toggle('active', j === activeIdx);
      nodes[j].classList.toggle('done', activeIdx > j);
    }
  }

  /* ---------------- 右栏：已学技能汇总（05 §4） ---------------- */

  const SKILL_LABEL = {
    targetWidth: ['绿区宽度', (v) => '+' + Math.round(v * 100) + '%'],
    cursorSpeed: ['指针速度', (v) => (v * 100).toFixed(0) + '%'],
    biteWindow: ['咬钩窗口', (v) => '+' + Math.round(v) + 'ms'],
    fishPrice: ['售鱼价', (v) => '+' + Math.round(v * 100) + '%'],
    expGain: ['经验', (v) => '+' + Math.round(v * 100) + '%'],
    chargeMax: ['体力上限', (v) => '+' + Math.round(v)],
    rareRate: ['稀有鱼概率', (v) => '+' + (v * 100).toFixed(0) + '%'],
    fishWeight: ['鱼重量', (v) => '+' + Math.round(v * 100) + '%'],
    /* 🆕 采集系 / 钓技系 / 经营系 */
    digCrit: ['挖掘暴击率', (v) => '+' + Math.round(v * 100) + '%'],
    rareMaterial: ['采集稀有材料', (v) => '+' + Math.round(v * 100) + '%'],
    boardSlots: ['合成台格位', (v) => '+' + Math.round(v) + ' 格'],
    castDistance: ['抛投距离', (v) => '+' + Math.round(v * 100) + '%'],
    reelGain: ['收杆增益', (v) => '+' + Math.round(v * 100) + '%'],
    productPrice: ['制品售价', (v) => '+' + Math.round(v * 100) + '%'],
    processSpeed: ['加工时间', (v) => '-' + Math.round(v * 100) + '%'],
    processSlots: ['工位数量', (v) => '+' + Math.round(v) + ' 个'],
    /* 💎 英雄专属效果 */
    codexDiamond: ['图鉴奖励', (v) => '+' + Math.round(v * 100) + '%'],
    doubleMaterial: ['材料翻倍', (v) => '+' + Math.round(v * 100) + '%'],
    goldGain: ['金币收益', (v) => '+' + Math.round(v * 100) + '%'],
    allAttr: ['全属性', (v) => '+' + Math.round(v * 100) + '%']
  };

  /** 效果 key → 中文名（供钻石页「当前加成」等复用，找不到就回落 key） */
  function skillEffectName(key) {
    const hit = SKILL_LABEL[key];
    return hit ? hit[0] : String(key == null ? '' : key);
  }

  function renderSkillSummary() {
    const box = document.getElementById('skill-summary');
    if (!box || !FG.systems.growth) return;
    const g = FG.systems.growth;
    const learned = g.skillIndex().filter(function (sk) { return g.skillLevel(sk.id) > 0; });
    if (!learned.length) {
      box.innerHTML = '<div class="empty-tip">还没有学习任何技能</div>';
      return;
    }
    const b = g.getSkillBonus();
    box.innerHTML = learned.map(function (sk) {
      return '<div class="list-item">' +
        '<span>🌟</span>' +
        '<span class="li-main">' + U.safe(sk.def.name, sk.id) +
          '<div class="li-sub">Lv.' + g.skillLevel(sk.id) + ' · ' + U.safe(sk.lineName, '') + '</div></span>' +
        '<span class="li-sub">' + U.safe(sk.def.desc, '') + '</span>' +
      '</div>';
    }).join('') +
      Object.keys(SKILL_LABEL).filter(function (k) { return b[k]; }).map(function (k) {
        return '<div class="stat-row"><span>' + SKILL_LABEL[k][0] + '</span><b>' + SKILL_LABEL[k][1](b[k]) + '</b></div>';
      }).join('');
  }

  /* ---------------- 右栏：装备槽 + 装备加成 ---------------- */

  function renderRight(s) {
    /* 右栏（钓鱼页）：等级/钓场（已在 renderFishingSidebar 刷新）+ 装备槽 + 加成 + 盛产 + 最近收获 */
    renderSkillSummary();
    const slots = document.getElementById('equip-slots');
    if (slots) {
      slots.innerHTML = '';
      FG.ENUM.SLOTS.forEach(function (slotKey) {
        const id = (s.equipped || {})[slotKey];
        const it = id ? (FG.CONFIG.items || {})[id] : null;
        const count = id ? FG.bag.getCount('equipment', id) : 0;
        const right = it
          ? (it.consumable ? '<span class="li-sub">×' + U.formatInt(count) + '</span>' : '<span class="li-sub">' + statText(it) + '</span>')
          : '<span class="slot-empty">未装备</span>';
        const node = U.el('div', { class: 'slot clickable' },
          '<span>' + U.safe(FG.ENUM.SLOT_ICON[slotKey], '▪️') + '</span>' +
          '<span class="slot-name">' + U.safe(FG.ENUM.SLOT_NAME[slotKey], slotKey) + '</span>' + right);
        U.onPointer(node, U.throttle(function () {
          FG.systems.equip.openEquipPanel(slotKey);
        }, FG.CONFIG.ui.throttleMs));
        slots.appendChild(node);
      });
    }

    const box = document.getElementById('equip-derived');
    if (box) {
      const d = FG.systems.equip.getDerived();
      const base = bareDerived();
      box.innerHTML = '';
      [
        { label: '收杆增益', value: d.reelGainPerClick.toFixed(2) + '% /次', base: base.reelGainPerClick.toFixed(2) + '%' },
        { label: '绿区宽度', value: U.formatPercent(d.targetWidth, 1), base: U.formatPercent(base.targetWidth, 1) },
        { label: '咬钩概率', value: U.formatPercent(U.clamp(d.biteRate, 0, 1), 1), base: U.formatPercent(U.clamp(base.biteRate, 0, 1), 1) },
        { label: '咬钩窗口', value: Math.round(d.biteWindow) + 'ms', base: Math.round(base.biteWindow) + 'ms' }
      ].forEach(function (row) {
        box.appendChild(U.el('div', { class: 'stat-row' },
          '<span>' + row.label + '</span><b>' + row.value + '</b><span class="li-sub">裸装 ' + row.base + '</span>'));
      });
    }

    renderFishPreview(s);
    renderRecentCatch();
  }

  /** 右栏 · 盛产鱼类：本钓场鱼种预览，未收录显示 ❓ ???（01 §7） */
  function renderFishPreview(s) {
    const box = document.getElementById('fish-preview');
    if (!box) return;
    const loc = FG.CONFIG.locations[s.currentLocation] || FG.CONFIG.locations.river;
    const ids = loc.fish || [];
    box.innerHTML = '';
    ids.forEach(function (id) {
      const f = FG.CONFIG.fish[id];
      if (!f) return;
      const known = !!(s.codex && s.codex.fish && s.codex.fish[id]);
      box.appendChild(U.el('div', { class: 'list-item' },
        '<span>' + (known ? f.icon : '❓') + '</span>' +
        '<span class="li-main">' + (known ? f.name : '???') + '</span>' +
        '<span class="tag t-' + f.rarity + '">' + U.safe(FG.ENUM.RARITY_NAME[f.rarity], f.rarity) + '</span>'));
    });
    set('fish-preview-sub', ids.length + ' 种');
  }

  /** 右栏 · 最近收获：最近 3 条（运行时数据，不入档） */
  function renderRecentCatch() {
    const box = document.getElementById('recent-catch');
    if (!box) return;
    const list = FG.systems.fishing.getRuntime().recent || [];
    box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<div class="empty-tip">暂无收获</div>'; return; }
    list.forEach(function (r) {
      const act = { bag: '🎒 入包', codex: '📖 图鉴', sell: '🪙 售出' }[r.action] || '🎒 入包';
      box.appendChild(U.el('div', { class: 'list-item' },
        '<span>' + U.safe(r.icon, '🐟') + '</span>' +
        '<span class="li-main">' + U.safe(r.name, '?') + '　' + U.formatWeight(r.weight) + 'kg</span>' +
        '<span class="li-sub">' + act + '</span>'));
    });
  }

  /* ---------------- 场景 ---------------- */

  const sceneImg = { src: '', w: 0, h: 0 };
  let boundResize = false;

  /**
   * 应用当前钓场的场景图（数据来自 CONFIG.locations[x].scene）
   * 图片缺失/加载失败时保留 CSS 渐变兜底，不会白屏
   */
  function applyScene(s) {
    const scene = document.getElementById('stage-scene');
    if (!scene) return;
    const loc = (FG.CONFIG.locations || {})[s.currentLocation] || {};
    const sc = loc.scene || {};
    /* 有动画层时用"抹掉竿线漂"的干净底图，避免与原图里的竿/漂重影；动画不可用则用原图 */
    const useActor = !!(sc.imageClean && FG.animator && FG.animator.available());
    const img = useActor ? sc.imageClean : sc.image;
    const hasPhoto = !!img;
    scene.classList.toggle('has-photo', hasPhoto);
    scene.classList.toggle('has-actor', useActor);
    scene.style.backgroundImage = hasPhoto
      ? 'url("' + img + '"), linear-gradient(180deg,#CDE9F8 0%,#9CCB8E 40%,#A9D8E6 42%,#4E9FBC 100%)'
      : '';

    if (useActor) FG.animator.init(document.getElementById('scene-actor'));
    if (hasPhoto) ensureSceneImage(img);
    if (!boundResize) {
      boundResize = true;
      window.addEventListener('resize', function () { positionSceneProps(); });
    }
    positionSceneProps();
    /* 🆕 背景视频按当前阶段切换（失败时 applySceneVideo 已保证不覆盖背景图逻辑） */
    applySceneVideo(FG.systems.fishing ? FG.systems.fishing.getPhase() : 'idle');
  }

  /* ---------------- 🆕 阶段背景视频（只做演出，不改交互与状态机） ---------------- */

  const vstate = { key: '', timer: 0, flashTimer: 0, bound: false };

  /** 阶段 → 视频 key */
  function phaseVideoKey(phase) {
    if (phase === 'waiting') return 'cast';          // 抛竿动作（播完自动接 wait）
    if (phase === 'biting') return 'wait';
    if (phase === 'tension' || phase === 'reel') return 'reel';
    if (phase === 'caught') return 'success';
    return 'idle';
  }

  function sceneVideoEl() { return document.getElementById('scene-video'); }
  function videoConf() { return (FG.CONFIG.fishing || {}).videos || {}; }
  function fishingConf() { return FG.CONFIG.fishing || {}; }

  function clampRate(r) {
    const range = fishingConf().videoRateRange || [0.35, 1.6];
    return Math.max(range[0], Math.min(range[1], r));
  }

  /** 把视频时长拉伸到阶段时长：rate = 视频时长 ÷ 目标秒数（0 = 原速循环） */
  function stretchVideo(v, seconds) {
    const target = Number(seconds) || 0;
    const apply = function () {
      if (!target || !v.duration || !isFinite(v.duration)) { v.playbackRate = 1; return; }
      v.playbackRate = clampRate(v.duration / target);
    };
    if (v.readyState >= 1) apply();
    else v.addEventListener('loadedmetadata', apply, { once: true });
  }

  function bindSceneVideo() {
    const v = sceneVideoEl();
    if (!v || vstate.bound) return;
    vstate.bound = true;
    v.muted = true;                                   // 静音：浏览器才允许自动播放
    v.playsInline = true;
    v.addEventListener('error', function () {         // 视频缺失/不支持 → 回退场景图，不报错中断
      console.warn('[render] 背景视频加载失败，已回退场景图/渐变', v.currentSrc || '');
      const scene = document.getElementById('stage-scene');
      if (scene) scene.classList.remove('video-on');
      vstate.key = '';
    });
    v.addEventListener('ended', function () {         // once 型（抛竿）播完 → 接「等待」
      const entry = videoConf()[vstate.key];
      if (entry && entry.once) {
        clearTimeout(vstate.timer); vstate.timer = 0;
        const ph = FG.systems.fishing ? FG.systems.fishing.getPhase() : 'idle';
        vstate.key = '';
        applySceneVideo(ph, ph === 'waiting' ? 'wait' : null);
      }
    });
  }

  /**
   * 按阶段切换背景视频
   * @param {string} phase idle/waiting/biting/tension/reel/caught
   * @param {string} [forceKey] 强制播放某个视频（抛竿转等待 / 失败演出）
   */
  function applySceneVideo(phase, forceKey) {
    const scene = document.getElementById('stage-scene');
    const v = sceneVideoEl();
    if (!scene || !v) return;
    bindSceneVideo();

    /* 失败/结果演出期间：普通阶段刷新不打断演出（演出结束会自动回到阶段视频） */
    if (!forceKey && Date.now() < (vstate.flashUntil || 0)) return;

    const key = forceKey || phaseVideoKey(phase);
    const entry = videoConf()[key];
    if (!entry || !entry.src) {                       // 没配视频 → 回退场景图/渐变
      scene.classList.remove('video-on');
      vstate.key = '';
      try { v.pause(); } catch (e) { }
      return;
    }

    if (vstate.key !== key) {
      clearTimeout(vstate.timer); vstate.timer = 0;
      vstate.key = key;
      v.loop = !entry.once;
      if (v.getAttribute('src') !== entry.src) v.src = entry.src;
      else { try { v.currentTime = 0; } catch (e) { } }
      try {
        const p = v.play();                           // 自动播放被拦时静默失败，场景图继续兜底
        if (p && typeof p.catch === 'function') p.catch(function () { });
      } catch (e) { }
    }
    scene.classList.add('video-on');
    stretchVideo(v, entry.seconds);

    /* 抛竿视频兜底：最长 castVideoMaxMs，超时必定切「等待」（10 §2 阶段出口） */
    if (key === 'cast' && !vstate.timer) {
      const max = Number(fishingConf().castVideoMaxMs) || 2600;
      vstate.timer = setTimeout(function () {
        vstate.timer = 0;
        const ph = FG.systems.fishing ? FG.systems.fishing.getPhase() : 'idle';
        vstate.key = '';
        applySceneVideo(ph, ph === 'waiting' ? 'wait' : null);
      }, max);
    }
  }

  /** 失败演出：短暂播放一段视频后回到当前阶段视频（不改任何游戏状态） */
  function flashSceneVideo(key) {
    const entry = videoConf()[key];
    if (!entry || !entry.src) return;
    const ms = Number(fishingConf().resultVideoMs) || 2800;
    clearTimeout(vstate.flashTimer);
    vstate.flashUntil = Date.now() + ms;
    vstate.key = '';
    applySceneVideo('idle', key);
    vstate.flashTimer = setTimeout(function () {
      vstate.flashUntil = 0;
      const ph = FG.systems.fishing ? FG.systems.fishing.getPhase() : 'idle';
      vstate.key = '';
      applySceneVideo(ph);
    }, ms);
  }

  /** 离开钓鱼页：暂停并隐藏视频，同时取消未播完的结果演出（不占后台资源，10 §9） */
  function pauseSceneVideo() {
    const v = sceneVideoEl();
    const scene = document.getElementById('stage-scene');
    if (v) { try { v.pause(); } catch (e) { } }
    if (scene) scene.classList.remove('video-on');
    clearTimeout(vstate.timer); vstate.timer = 0;
    clearTimeout(vstate.flashTimer); vstate.flashTimer = 0;
    vstate.flashUntil = 0;
    vstate.key = '';
  }

  /** 预读图片真实尺寸，加载完成后重算落点 */
  function ensureSceneImage(src) {
    if (!src || sceneImg.src === src) return;
    sceneImg.src = src;
    const im = new Image();
    im.onload = function () {
      sceneImg.w = im.naturalWidth;
      sceneImg.h = im.naturalHeight;
      positionSceneProps();
    };
    im.onerror = function () { console.warn('[render] 场景图加载失败，已使用 CSS 渐变兜底', src); };
    im.src = src;
  }

  /**
   * 浮标/涟漪落点：把「图片内百分比」换算成场景像素
   * 依据 background-size:cover + background-position:center bottom 的裁剪规则还原
   */
  function positionSceneProps() {
    const scene = document.getElementById('stage-scene');
    const bob = document.getElementById('scene-bobber');
    const rip = document.getElementById('scene-ripples');
    if (!scene || !bob || !rip) return;
    const st = FG.getState();
    const loc = (FG.CONFIG.locations || {})[st.currentLocation] || {};
    const sc = loc.scene || {};
    if (!sc.image || !sc.bobberAt) return;

    const boxW = scene.clientWidth, boxH = scene.clientHeight;
    if (!boxW || !boxH) return;
    const imgW = sceneImg.w || sc.imageWidth || boxW;
    const imgH = sceneImg.h || sc.imageHeight || boxH;
    const scale = Math.max(boxW / imgW, boxH / imgH);          // cover
    const offX = Math.max(0, (imgW * scale - boxW) / 2);       // 水平居中裁剪
    const offY = Math.max(0, imgH * scale - boxH);             // 垂直贴底

    const px = sc.bobberAt.x * imgW * scale - offX;
    const py = sc.bobberAt.y * imgH * scale - offY;

    bob.style.left = (px - 8) + 'px';                          // 浮标宽 16px，居中对准
    bob.style.bottom = (boxH - py - 11) + 'px';                // 浮标高 22px
    rip.style.left = px + 'px';                                // 涟漪 120px 宽，CSS 已 -60px 居中
    rip.style.bottom = (boxH - py - 13) + 'px';

    /* 动画容器：尺寸/偏移与 background-size:cover 完全一致，
       这样 Lottie 的 1376×768 合成空间就与底图像素一一对应 */
    const actor = document.getElementById('scene-actor');
    if (actor) {
      actor.style.width = (imgW * scale) + 'px';
      actor.style.height = (imgH * scale) + 'px';
      actor.style.left = (-offX) + 'px';
      actor.style.top = (-offY) + 'px';
    }
  }

  /* ---------------- 主舞台 · 钓鱼四阶段（只读 runtime，不写状态） ---------------- */

  const MAIN_LABEL = {
    idle: '🎣 抛竿！', waiting: '🎣 抛竿中...', biting: '🎣 提竿！',
    tension: '🎯 拉！', reel: '🎣 拉！拉！拉！', caught: '结算中...'
  };

  function renderFishing() {
    const rt = FG.systems.fishing.getRuntime();
    const phase = U.pickValid(rt.phase, FG.ENUM.FISH_PHASES, 'idle', 'renderFishing');
    const scene = document.getElementById('stage-scene');
    if (scene) scene.setAttribute('data-phase', phase);
    applySceneVideo(phase);                 // 🆕 背景视频随阶段切换（纯演出）
    renderSteps(phase);
    if (FG.animator) FG.animator.sync();        // 阶段 → 人物动作（内部按同名去重，不阻塞）

    const btn = document.getElementById('btn-main');
    if (btn) {
      btn.textContent = MAIN_LABEL[phase];
      btn.disabled = (phase === 'waiting' || phase === 'caught');
    }
    const abandon = document.getElementById('btn-abandon');
    if (abandon) abandon.style.display = (phase === 'waiting' || phase === 'tension' || phase === 'reel') ? '' : 'none';

    toggle('fish-bite-hint', phase === 'biting');
    toggle('tension-system', phase === 'tension');
    toggle('reel-system', phase === 'reel');

    // 覆盖层已承载主文案时，隐藏底部提示胶囊，避免重复提示
    const hintPill = document.getElementById('scene-hint');
    if (hintPill) hintPill.style.display = (phase === 'biting' || phase === 'tension' || phase === 'reel') ? 'none' : '';

    if (phase === 'idle') {
      const bait = FG.systems.equip.getBaitState();
      set('scene-hint', bait.id
        ? '当前饵料：' + U.safe(bait.item && bait.item.name, bait.id) + ' ×' + U.formatInt(bait.count)
        : '⚠️ 未装备饵料，抛竿将引导你去装备');
      set('tension-result', '');
    } else if (phase === 'waiting') {
      set('scene-hint', '🎣 抛竿中...等待鱼儿上钩');
    } else if (phase === 'biting') {
      set('scene-hint', '❗ 有鱼咬钩了！快点击！');
      const hint = document.querySelector('#fish-bite-hint .bite-hint');
      if (hint) {
        hint.innerHTML = '❗ 有鱼咬钩了！<br><b>点击场景任意位置提竿</b>' +
          '<div class="li-sub">剩余 ' + remainSec(rt.biteEndsAt) + 's</div>';
      }
    } else if (phase === 'tension') {
      set('scene-hint', '⚡ 把指针拉进绿区！');
      renderTension(rt.tension);
    } else if (phase === 'reel') {
      set('scene-hint', '🔥 疯狂收杆！');
      renderReel(rt.reel);
    } else if (phase === 'caught') {
      set('scene-hint', '🎉 上鱼了！请选择处理方式');
    }
  }

  function renderTension(t) {
    if (!t) return;
    const target = document.getElementById('tension-target');
    const cursor = document.getElementById('tension-cursor');
    const bar = document.getElementById('tension-bar');
    if (target) {
      target.style.left = (U.clamp(t.targetLeft, 0, 1) * 100).toFixed(2) + '%';
      target.style.width = (U.clamp(t.targetWidth, 0, 1) * 100).toFixed(2) + '%';
    }
    if (cursor) cursor.style.left = U.clamp(t.cursor, 0, 100).toFixed(2) + '%';
    if (bar) {
      // 判定条尽量 ≥520px，但不超过容器宽度（避免 1024px 窗口下被裁切）
      const boxW = bar.parentNode ? bar.parentNode.clientWidth : 0;
      bar.style.minWidth = Math.min(FG.CONFIG.fishing.minTensionBarWidth, boxW || FG.CONFIG.fishing.minTensionBarWidth) + 'px';
    }

    set('tension-rounds', '第 ' + Math.min(t.results.length + 1, t.rounds) + '/' + t.rounds + ' 轮 · 需命中 ' + t.need);
    set('tension-timer', '剩余 ' + remainSec(t.endsAt) + 's');
    const res = document.getElementById('tension-result');
    if (res) {
      res.innerHTML = t.lastResult === null ? '' :
        '<span class="' + (t.lastResult ? 'ok-text' : 'err-text') + '">' +
        (t.lastResult ? '✅ 命中！' : '❌ 未命中') + '</span>　已命中 ' + t.hits + '/' + t.rounds;
    }
  }

  function renderReel(r) {
    if (!r) return;
    const fill = document.getElementById('reel-fill');
    if (fill) fill.style.width = U.clamp(r.progress, 0, 100) + '%';
    set('reel-progress', r.progress.toFixed(1) + '%');
    set('reel-timer', '剩余 ' + remainSec(r.endsAt) + 's');
  }

  /** 鱼获结算卡片：三选一（01 §5）。关闭兜底 = 收入背包，避免停在 caught 阶段 */
  function showCatchCard(f) {
    if (!f) return;
    const star = FG.ENUM.RARITY_STAR[f.rarity] || 1;
    const stars = new Array(star + 1).join('★') + new Array(6 - star).join('☆');
    FG.modal.open({
      title: '🎣 鱼获结算',
      body:
        '<div class="catch-card">' +
          '<div class="catch-ribbon">恭喜获得</div>' +
          '<div class="catch-icon">' + U.safe(f.icon, '🐟') + '</div>' +
          '<div class="catch-name">' + U.safe(f.name, '?') +
            '　<span class="tag t-' + f.rarity + '">' + U.safe(FG.ENUM.RARITY_NAME[f.rarity], f.rarity) + '</span></div>' +
          '<div class="catch-stars t-' + f.rarity + '">' + stars + '</div>' +
          '<div class="catch-weight">⚖️ ' + U.formatWeight(f.weight) + ' kg</div>' +
          '<div class="catch-desc">「' + U.safe(f.desc, '') + '」</div>' +
          '<div class="catch-price">🪙 +' + U.formatInt(f.price) + '</div>' +
        '</div>' +
        '<div class="modal-foot-inline">' +
          '<button class="btn" id="catch-bag">🎒 收入背包</button>' +
          '<button class="btn" id="catch-codex">📖 放入图鉴</button>' +
          '<button class="btn btn-sell" id="catch-sell">🪙 立即售卖</button>' +
        '</div>',
      showCancel: false,
      light: true,                    // 🆕 浅色遮罩：让背后的「上了」视频透出来
      /* 🆕 不可关闭：只能在三个按钮里选一个才继续（否则收杆连点会点到遮罩把卡片点没） */
      dismissible: false,
      onClose: function () {
        if (FG.systems.fishing.getPhase() === 'caught') FG.systems.fishing.settle('bag');   // 防卡死兜底
      }
    });
    bindCatchButtons();
  }

  function bindCatchButtons() {
    /* 🆕 防误选：卡片刚出现的一小段时间内忽略点击（收杆是连点操作，尾巴容易误选到按钮） */
    const guardUntil = Date.now() + (Number((FG.CONFIG.fishing || {}).catchClickGuardMs) || 250);
    ['bag', 'codex', 'sell'].forEach(function (act) {
      const node = document.getElementById('catch-' + act);
      if (!node) return;
      U.onPointer(node, U.throttleLead(function () {
        if (Date.now() < guardUntil) return;      // 静默忽略，不改状态、不关卡片
        FG.systems.fishing.settle(act);
        FG.modal.close(true);
      }, FG.CONFIG.ui.throttleMs));
    });
  }

  /* ---------------- 裸装基准 ---------------- */

  /** 裸装基准值：用于让加成差异可观测（02 验收：换鱼线 → 咬钩窗口变长） */
  function bareDerived() {
    const C = FG.CONFIG, F = C.fishing;
    return {
      reelGainPerClick: F.reelGainPerClick,
      targetWidth: (F.targetWidthMin + F.targetWidthMax) / 2,
      biteRate: F.biteBaseRate,
      biteWindow: F.biteWindow
    };
  }

  /** 底部导航：仅同步高亮态 */
  function renderNav(s) {
    const nav = document.getElementById('bottomnav');
    if (!nav) return;
    const active = FG.ui.layout.getActiveTab();
    const items = nav.querySelectorAll('.nav-item');
    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', items[i].getAttribute('data-tab') === active);
    }
  }

  /* ---------------- 内部小助手 ---------------- */
  function set(id, text) {
    const node = document.getElementById(id);
    if (node) node.textContent = U.safe(text, '');
  }
  function setEmpty(id, tip) {
    const node = document.getElementById(id);
    if (node && !node.children.length) node.innerHTML = '<div class="empty-tip">' + tip + '</div>';
  }
  function toggle(id, show) {
    const node = document.getElementById(id);
    if (node) node.classList.toggle('show', !!show);
  }
  /** 剩余秒数（1 位小数），不会为负 */
  function remainSec(ts) {
    return Math.max(0, (Number(ts) || 0) - Date.now()) / 1000;
  }

  FG.render = {
    renderAll: renderAll,
    renderTopBar: renderTopBar,
    skillEffectName: skillEffectName,
    renderEquipGrid: renderEquipGrid,
    renderFishingSidebar: renderFishingSidebar,   // 钓鱼页右栏最上方：等级 + 钓场
    renderBagTitle: renderBagTitle,
    /* 🆕 阶段背景视频 */
    applySceneVideo: applySceneVideo,
    flashSceneVideo: flashSceneVideo,
    pauseSceneVideo: pauseSceneVideo,
    renderStage: renderStage,
    renderRight: renderRight,
    renderNav: renderNav,
    renderFishPreview: renderFishPreview,
    renderRecentCatch: renderRecentCatch,
    renderFishing: renderFishing,
    showCatchCard: showCatchCard
  };
})(window.FG = window.FG || {});
