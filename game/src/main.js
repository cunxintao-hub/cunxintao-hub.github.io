/* ============================================================
   src/main.js · 启动引导
   流程：读档(含迁移) → 挂载骨架 → 绑定全局交互 → 首次渲染 → 开启自动保存
   规则（10 §10）：捕获 window.onerror，异常时 toast + 回到安全状态
   ============================================================ */
(function (FG) {
  'use strict';

  let booted = false;              // 防止 DOMContentLoaded 被触发两次导致重复读档

  function boot() {
    if (booted) { console.warn('[main] 已启动过，忽略重复 boot'); return; }
    booted = true;
    // 1. 读档（解析失败内部已回退默认档并 toast）
    FG.save.load();

    // 1.5 新手礼包：未发放则补发并自动装备（02 §6，幂等）
    FG.systems.equip.ensureStarterPack();
    // 1.6 合成台数据体检（清理越界/未知项，补默认体力字段）
    FG.systems.merge.initGrid();
    // 1.7 钓场解锁同步：把等级达标的钓场写进 unlockedLocations（05 §3，幂等）
    FG.systems.growth.syncLocations();
    FG.save.markDirty();

    // 2. 挂载三栏骨架
    FG.ui.layout.mount(document.getElementById('app'));

    // 3. 全局交互：空格=主操作 / Esc=关闭面板 / Enter=确认（10 §6）
    bindGlobalEvents();

    // 4. 首次渲染
    FG.ui.layout.switchTab(FG.ENUM.DEFAULT_TAB);
    FG.render.renderAll();

    // 5. 存档生命周期 + 合成台自动随机生成（03）
    FG.save.startAutoSave();
    FG.save.bindLifecycleHooks();
    FG.systems.merge.startAutoSpawn();
    // 5.1 💎 钻石系统：若存档里「已开通 + 已开启」自动合成，恢复挂机循环
    if (FG.systems.diamond) FG.systems.diamond.restoreAutoMerge();

    // 6. 调试入口（10 §10 可观测性）：#dev=tension / #dev=reel / #dev=catch 直达对应阶段
    applyDevHash();

    console.log('[main] 启动完成，当前存档：', FG.getState());
    FG.toast('🎣 欢迎来到疯狂钓鱼佬');
  }

  function applyDevHash() {
    const m = /dev=(\w+)/.exec(window.location.hash || '');
    if (!m) return;
    const F = FG.systems.fishing;
    console.log('[main] dev hook →', m[1]);
    try {
      if (m[1] === 'tension') F.startTension();
      else if (m[1] === 'reel') { F.startTension(); F.startReel(); }
      else if (m[1] === 'catch') F.landFish();
      else if (m[1] === 'bite') { F.castRod(); F.enterBite(); }
      else if (m[1] === 'merge') { FG.ui.layout.switchTab('merge'); }
      else if (m[1] === 'craft') { FG.ui.layout.switchTab('craft'); }
      else if ((FG.CONFIG.craft.categories || []).indexOf(m[1]) !== -1) {
        /* #dev=rod|hook|line|net|bait|other：直达配方分类（顺便拉到 Lv.15 看全部解锁效果） */
        FG.getState().level = Math.max(15, FG.getState().level || 1);
        FG.ui.layout.switchTab('craft');
        if (FG.ui.craftBoard) FG.ui.craftBoard.setCategory(m[1]);
      }
      else if (m[1] === 'materials') { FG.systems.merge.grantDebugMaterials(); }
      else if (m[1] === 'charges') { FG.ui.layout.switchTab('merge'); FG.ui.explore.open(); }
      else if (m[1] === 'bag') { FG.systems.merge.grantDebugMaterials(); FG.ui.bag.open('materials'); }
      else if (FG.CONFIG.locations && FG.CONFIG.locations[m[1]]) {
        FG.getState().currentLocation = m[1];              // 直达某钓场看场景（调试用，忽略等级）
        FG.render.renderAll();
      }
      else if (m[1] === 'scene') {                         // 钓场场景预览浮层（看未解锁钓场长什么样）
        FG.ui.locations.openScenePreview('mystic');
      }
      else if (m[1] === 'skill') { FG.ui.layout.switchTab('skill'); }
      else if (m[1] === 'exp') { FG.systems.growth.addExp(1000, 'debug'); FG.render.renderAll(); }
      else if (m[1] === 'gold') { FG.getState().gold += 5000; FG.render.renderAll(); }
      /* 06 / 07 调试入口 */
      else if (m[1] === 'codex') { FG.ui.codex.open('fish'); }
      else if (m[1] === 'rank') { FG.ui.codex.openRank(); }
      else if (m[1] === 'workshop') { FG.getState().level = Math.max(10, FG.getState().level || 1); FG.ui.layout.switchTab('workshop'); }
      else if (m[1] === 'market') { FG.ui.layout.switchTab('market'); }
      else if (m[1] === 'expo') {
        FG.ui.layout.switchTab('market');
        if (FG.ui.market) { FG.ui.market.setTab('expo'); FG.ui.market.render(); }
      }
      /* 💎 钻石系统调试入口 */
      else if (m[1] === 'diamond') { FG.ui.layout.switchTab('diamond'); }
      else if (m[1] === 'gem') {                            // 给 200 钻 + 直接看钻石页
        FG.getState().diamond = (Number(FG.getState().diamond) || 0) + 200;
        FG.getState().level = Math.max(20, FG.getState().level || 1);
        FG.save.markDirty(); FG.render.renderAll(); FG.ui.layout.switchTab('diamond');
      }
      /* 08 调试入口 */
      else if (m[1] === 'social') { FG.ui.layout.switchTab('social'); }
      else if (m[1] === 'offline') { FG.systems.social.setSimulatedOffline(true); FG.ui.layout.switchTab('social'); }
      else if (m[1] === 'fish') {                          // 塞几条鱼进背包（售卖/加工/上交用）
        const ids = Object.keys(FG.CONFIG.fish || {});
        ids.forEach(function (id) {
          const f = FG.CONFIG.fish[id];
          const s = FG.getState();
          const cur = s.bag.fish[id] || { count: 0, weights: [] };
          cur.count += 2;
          cur.weights = (cur.weights || []).concat([f.weightMin, f.weightMax]);
          s.bag.fish[id] = cur;
        });
        FG.save.markDirty(); FG.render.renderAll();
        FG.toast('🧪 已塞入每种鱼 ×2（调试）', 'ok');
      }
    } catch (e) { console.warn('[main] dev hook 失败', e); }
  }

  function bindGlobalEvents() {
    window.addEventListener('keydown', function (e) {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;   // 不与输入框冲突（10 §6）
      if (e.code === 'Space') {
        e.preventDefault();
        if (!FG.modal.isOpen()) FG.ui.layout.triggerMainAction();
      } else if (e.code === 'Escape') {
        /* 鱼获结算这类不可关闭弹窗，Esc 也不能关（必须点按钮选择处理方式） */
        if (FG.modal.isOpen() && FG.modal.isDismissible()) FG.modal.close();
      } else if (e.code === 'Enter') {
        const ok = document.querySelector('#modal-layer .btn-primary');
        if (ok) ok.click();
      }
    });

    // 全局兜底：任何未捕获异常都提示并回到安全态，禁止白屏（10 §10）
    window.addEventListener('error', function (e) {
      console.error('[main] 未捕获异常', e && e.message);
      FG.toast('出现异常，已恢复到安全状态', 'err');
      try { FG.systems.fishing.abandonFishing('error'); } catch (err) { }
      try { FG.render.renderAll(); } catch (err) { }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.FG = window.FG || {});
