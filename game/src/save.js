/* ============================================================
   src/save.js · 存档与云同步（依据文档 09）
   职责：本地持久化、版本迁移、云同步（可选）与冲突处理。
   边界（09 §8）：业务模块不得直接调 localStorage，一律走本模块的 save()/load()。
   ============================================================ */
(function (FG) {
  'use strict';

  const SAVE_KEY = 'fishing_game_save';
  const AUTO_SAVE_INTERVAL = 30000;                 // 09 §3：每 30 秒自动保存
  const CLOUD_MIN_INTERVAL = 10000;                 // 09 §5：云同步节流 10 秒

  let autoSaveTimer = null;
  let lastSyncAt = 0;
  let lastSyncOk = true;
  let pendingSave = false;                          // 待写入标记（资产变化时置位）

  /* ------------------------------------------------------------
     版本迁移（09 §4）：MIGRATIONS[v] 把 v-1 的结构升级到 v
     新增版本时：CURRENT_VERSION +1，并在这里补一个函数。
     禁止因为字段缺失导致白屏；迁移失败一律回退默认档。
     ------------------------------------------------------------ */
  const MIGRATIONS = {
    // 1: (s) => { /* v0 → v1：未来版本升级逻辑 */ return s; }
  };

  function migrate(saved) {
    try {
      let v = Number(saved && saved.version) || 0;
      const target = FG.CURRENT_VERSION;
      let guard = 0;
      while (v < target) {
        if (guard++ > 50) throw new Error('迁移死循环');
        v++;
        const fn = MIGRATIONS[v];
        if (typeof fn === 'function') saved = fn(saved);
        saved.version = v;
      }
      return saved;
    } catch (e) {
      console.warn('[save] 迁移失败，回退默认存档', e);
      if (FG.toast) FG.toast('存档版本不兼容，已新建进度', 'warn');
      return FG.createDefaultState();
    }
  }

  /* ---------------- 读 ---------------- */

  /**
   * 读取存档：解析失败 → 默认 state + toast「存档异常，已新建进度」（09 §3）
   * @returns {Object} 可直接使用的完整 state
   */
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { console.warn('[save] localStorage 不可用', e); }

    if (!raw) {
      const fresh = FG.createDefaultState();
      FG.replaceState(fresh);
      console.log('[save] 无存档，使用默认进度');
      return fresh;
    }

    try {
      const parsed = JSON.parse(raw);
      const migrated = migrate(parsed);
      const merged = FG.sanitize(FG.mergeDeep(FG.createDefaultState(), migrated));
      merged.version = FG.CURRENT_VERSION;
      FG.replaceState(merged);
      console.log('[save] 读档成功', merged);
      return merged;
    } catch (e) {
      console.warn('[save] 存档损坏', e);
      if (FG.toast) FG.toast('存档异常，已新建进度', 'err');
      const fresh = FG.createDefaultState();
      FG.replaceState(fresh);
      return fresh;
    }
  }

  /* ---------------- 写 ---------------- */

  /**
   * 写入本地存档。调用时机（09 §3）：
   * 每次资产变化 + 每 30 秒自动保存 + visibilitychange 隐藏 + beforeunload
   * @returns {boolean} 是否写入成功
   */
  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(FG.getState()));
      pendingSave = false;
      return true;
    } catch (e) {
      console.warn('[save] 写入失败', e);
      if (FG.toast) FG.toast('存储空间不足，请清理浏览器缓存', 'err');   // 09 §7
      return false;
    }
  }

  /** 资产变化后调用：立即存一次（内部节流，避免高频写盘） */
  const markDirty = FG.utils ? FG.utils.throttle(function () { save(); }, 300) : function () { save(); };

  /** 重置游戏（09 §6）：清空存档 → 回到新档（调用方负责二次确认） */
  function resetSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { console.warn('[save] 清除失败', e); }
    FG.resetState();
    save();
    console.log('[save] 已重置游戏');
    return FG.getState();
  }

  /* ---------------- 生命周期 ---------------- */

  /** 开启 30 秒自动保存（09 §3） */
  function startAutoSave() {
    stopAutoSave();
    autoSaveTimer = setInterval(function () { if (pendingSave) save(); }, AUTO_SAVE_INTERVAL);
  }
  function stopAutoSave() { if (autoSaveTimer) { clearInterval(autoSaveTimer); autoSaveTimer = null; } }

  /** 绑定 visibilitychange / beforeunload（09 §3） */
  function bindLifecycleHooks() {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') save();
    });
    window.addEventListener('beforeunload', function () { save(); });
  }

  /* ---------------- 云同步（可选，接入 CloudBase 后实现） ---------------- */

  /**
   * 冲突策略（09 §5）：比较 level → exp → stats.totalFishCaught，取更高者
   * @returns {number} >0 本地优，<0 云端优，0 相同
   */
  function compareForConflict(local, remote) {
    if (!remote) return 1;
    const a = local || {}, b = remote;
    if ((a.level || 0) !== (b.level || 0)) return (a.level || 0) - (b.level || 0);
    if ((a.exp || 0) !== (b.exp || 0)) return (a.exp || 0) - (b.exp || 0);
    return ((a.stats && a.stats.totalFishCaught) || 0) - ((b.stats && b.stats.totalFishCaught) || 0);
  }

  /** 上传到云端：失败静默降级，本地继续可玩（09 §5/§7） */
  function syncToCloud() {
    const now = Date.now();
    if (now - lastSyncAt < CLOUD_MIN_INTERVAL) return false;
    lastSyncAt = now;
    // TODO（接入 CloudBase 后实现）：上传 state → 失败则 lastSyncOk=false
    lastSyncOk = true;
    return true;
  }

  /** 从云端拉取：二次确认会覆盖本地（09 §6） */
  function pullFromCloud() {
    // TODO（接入 CloudBase 后实现）：拉远端 → compareForConflict → replaceState
    return null;
  }

  /** 设置页展示用：上次同步状态 */
  function getSyncStatus() { return { lastSyncAt: lastSyncAt, ok: lastSyncOk }; }

  FG.save = {
    SAVE_KEY: SAVE_KEY,
    MIGRATIONS: MIGRATIONS,
    migrate: migrate,
    load: load,
    save: save,
    markDirty: markDirty,
    resetSave: resetSave,
    startAutoSave: startAutoSave,
    stopAutoSave: stopAutoSave,
    bindLifecycleHooks: bindLifecycleHooks,
    compareForConflict: compareForConflict,
    syncToCloud: syncToCloud,
    pullFromCloud: pullFromCloud,
    getSyncStatus: getSyncStatus
  };
})(window.FG = window.FG || {});
