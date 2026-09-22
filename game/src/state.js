/* ============================================================
   src/state.js · 唯一数据源 state 的定义（依据文档 09 §2）
   规则（00 §4.2）：state 是唯一数据源；render 只读不写；
   禁止把状态存在 DOM 上；业务模块不得直接读写 localStorage（统一走 save.js）。
   ============================================================ */
(function (FG) {
  'use strict';

  /** 存档结构版本：任何结构变更 +1，并同步在 save.js 的 MIGRATIONS 中补迁移函数 */
  const CURRENT_VERSION = 1;

  /** 默认存档（09 §2 原样落地；函数式创建，避免多档共享同一对象引用） */
  function createDefaultState() {
    return {
      version: CURRENT_VERSION,
      gold: 100, exp: 0, level: 1, diamond: 0,

      /* 背包：03 材料 / 01 鱼 / 04 装备 / 06 加工品，均为 { itemId: count } */
      bag: { materials: {}, fish: {}, equipment: {}, products: {} },

      /* 已装备（02）；值为物品 id，null 表示空槽 */
      equipped: { rod: 'bamboo_rod', hook: 'bone_hook', bait: 'corn_bait', line: 'fiber_line', net: null },

      /* 钓场解锁与当前所在（05） */
      unlockedLocations: ['river'], currentLocation: 'river',

      /* 图鉴与图鉴奖励（06） */
      codex: { fish: {}, materials: {}, equipment: {}, friends: {} },
      codexRewards: {},

      /* 工坊（06） */
      workshop: { unlocked: false, level: 0, facilities: [] },

      /* 二合网格（03） */
      mergeGrid: [], mergeCount: 0,

      /* 技能树（05） */
      skills: {},

      /* 统计（01） */
      stats: {
        totalFishCaught: 0, totalGoldEarned: 0, biggestFish: 0,
        fishingAttempts: 0, totalDiamondEarned: 0
      },

      /* 挖掘 / 采集次数与回复时间戳（03） */
      digCharges: 8, gatherCharges: 8, lastChargeRegen: Date.now(),

      /* 社交（08） */
      friends: [], friendLevels: {},
      socialProfile: { displayName: '', id: '', registered: false },
      challengeToday: { date: '', sent: 0, received: 0 },

      /* 博览会（06） */
      expo: {}, expoSubmitted: {}, expoLastRefresh: '',

      /* 二合自动整理开关 */
      autoMerge: false,

      /* 💎 钻石系统：已招募英雄（id → true）+ 自动合成是否已用钻石开通 */
      heroes: {},
      autoMergeOpened: false,

      /* 09 §6 设置面板持久化项 */
      settings: { sound: true },

      /* 09 §6「重置教程」清除的引导记录 */
      tutorial: { seen: {} },

      /* 02 §6 新手礼包发放标记（false 时启动即补发） */
      starterPackGranted: false
    };
  }

  /**
   * 深合并：以 defaults 为骨架，用 loaded 的同类型字段补全
   * - 只认「类型一致」的值，杜绝坏档污染结构（09 §3）
   * - 数组以 loaded 为准（若类型正确），对象递归
   */
  function mergeDeep(defaults, loaded) {
    if (loaded === null || loaded === undefined) return clone(defaults);
    if (typeof defaults !== 'object' || typeof loaded !== 'object') return loaded;
    if (Array.isArray(defaults) !== Array.isArray(loaded)) return clone(defaults);

    if (Array.isArray(defaults)) return loaded.slice();

    const out = {};
    const keys = Object.keys(defaults).concat(Object.keys(loaded).filter(function (k) {
      return !(k in defaults);
    }));
    keys.forEach(function (k) {
      const d = defaults[k];
      if (!(k in loaded) || loaded[k] === undefined) { out[k] = clone(d); return; }
      if (d === undefined) { out[k] = clone(loaded[k]); return; }          // 默认表里没有的新字段：直接采用
      if (!compatible(d, loaded[k])) { out[k] = clone(d); return; }        // 类型不符 → 默认值
      if (d !== null && typeof d === 'object' && loaded[k] !== null && typeof loaded[k] === 'object') {
        out[k] = mergeDeep(d, loaded[k]);                                   // 对象/数组递归
      } else {
        out[k] = loaded[k];
      }
    });
    return out;
  }

  /**
   * 类型兼容判定
   * 注意：null 是合法业务值（空装备槽、饵料耗尽后卸下），必须被保留；
   *      真正的脏数据（如 level:'x'）才回退默认值。
   */
  function compatible(d, v) {
    if (v === null) return true;
    if (d === null) return typeof v === 'object';
    if (Array.isArray(d) !== Array.isArray(v)) return false;
    if (typeof d === 'object') return typeof v === 'object';
    return typeof v === typeof d;
  }

  /**
   * 读档后体检：把关键字段强制收敛为可用类型，杜绝 NaN/undefined 上屏（10 §5/§7）
   */
  function sanitize(s) {
    if (!s || typeof s !== 'object') return createDefaultState();
    const d = createDefaultState();

    ['gold', 'exp', 'diamond'].forEach(function (k) {
      const n = Number(s[k]);
      s[k] = (isFinite(n) && n >= 0) ? n : d[k];
    });
    /* 等级至少 1（05 §2） */
    const lv = Number(s.level);
    s.level = (isFinite(lv) && lv >= 1) ? Math.floor(lv) : 1;

    /* 技能树（05 §4）：只保留配置里存在的技能，等级夹在 0~maxLevel */
    const maxLv = (FG.CONFIG.skills || {}).maxLevel || 1;
    const known = {};
    ((FG.CONFIG.skills || {}).lines || []).forEach(function (line) {
      (line.skills || []).forEach(function (sk) { known[sk.id] = 1; });
    });
    const sk = {};
    if (s.skills && typeof s.skills === 'object' && !Array.isArray(s.skills)) {
      Object.keys(s.skills).forEach(function (id) {
        if (!known[id]) return;
        const n = Number(s.skills[id]);
        if (isFinite(n) && n > 0) sk[id] = Math.min(maxLv, Math.floor(n));
      });
    }
    s.skills = sk;

    /* 💎 钻石系统：只保留配置里存在的英雄 id（坏档防护，10 §5） */
    const heroIds = {};
    (((FG.CONFIG.diamond || {}).heroes) || []).forEach(function (h) { heroIds[h.id] = 1; });
    const heroes = {};
    if (s.heroes && typeof s.heroes === 'object' && !Array.isArray(s.heroes)) {
      Object.keys(s.heroes).forEach(function (id) { if (heroIds[id]) heroes[id] = true; });
    }
    s.heroes = heroes;
    s.autoMergeOpened = !!s.autoMergeOpened;

    s.stats = (s.stats && typeof s.stats === 'object') ? s.stats : {};
    Object.keys(d.stats).forEach(function (k) {
      const n = Number(s.stats[k]);
      s.stats[k] = (isFinite(n) && n >= 0) ? n : 0;
    });

    s.equipped = (s.equipped && typeof s.equipped === 'object') ? s.equipped : {};
    FG.ENUM.SLOTS.forEach(function (slot) {
      const v = s.equipped[slot];
      if (v !== null && typeof v !== 'string') s.equipped[slot] = null;    // 空槽允许 null
    });

    s.bag = (s.bag && typeof s.bag === 'object') ? s.bag : {};
    FG.ENUM.BAG_TYPES.forEach(function (t) {
      if (!s.bag[t] || typeof s.bag[t] !== 'object' || Array.isArray(s.bag[t])) s.bag[t] = {};
    });

    /* 钓场（05 §3）：丢掉不存在的 id，并保证 currentLocation 落在已解锁列表里 */
    const locs = FG.CONFIG.locations || {};
    if (Array.isArray(s.unlockedLocations)) {
      s.unlockedLocations = s.unlockedLocations.filter(function (id) { return !!locs[id]; });
    }
    if (!Array.isArray(s.unlockedLocations) || !s.unlockedLocations.length) s.unlockedLocations = d.unlockedLocations.slice();
    if (typeof s.currentLocation !== 'string' || !locs[s.currentLocation]) s.currentLocation = s.unlockedLocations[0];
    if (s.unlockedLocations.indexOf(s.currentLocation) === -1) s.currentLocation = s.unlockedLocations[0];
    if (typeof s.version !== 'number') s.version = CURRENT_VERSION;
    return s;
  }

  function clone(v) { return v === null || typeof v !== 'object' ? v : JSON.parse(JSON.stringify(v)); }

  /* ---------------- 运行时实例 ---------------- */

  /** 当前存档实例（main.js 启动时由 save.load() 填充） */
  FG.state = createDefaultState();

  /** 取 state（只读语义：渲染层使用，请勿直接改写深层结构） */
  function getState() { return FG.state; }

  /** 整体替换 state（换档 / 读档 / 重置时使用），同步刷新 window.__state */
  function replaceState(next) {
    FG.state = next && typeof next === 'object' ? next : createDefaultState();
    try { window.__state = FG.state; } catch (e) { /* 忽略：不影响可玩 */ }
    return FG.state;
  }

  /** 重置为默认存档 */
  function resetState() { return replaceState(createDefaultState()); }

  /* ------------------------------------------------------------
     背包读写助手：bag[type] = { itemId: { count: n } }
     规则（10 §8）：扣减前先校验充足性，不足返回 false 且不改动数据；
     兼容历史存法 itemId: number。
     ------------------------------------------------------------ */
  const bag = {
    /** 白名单校验背包分类，非法回退 'equipment' 并 warn */
    type: function (t) {
      if (FG.ENUM.BAG_TYPES.indexOf(t) !== -1) return t;
      console.warn('[bag] 非法背包分类，已回退 equipment', t);
      return 'equipment';
    },
    /** 读取数量：缺省/异常一律 0（10 §5） */
    getCount: function (t, id) {
      const box = (FG.getState().bag || {})[bag.type(t)] || {};
      const e = box[id];
      const n = (e && typeof e === 'object') ? e.count : e;
      return (typeof n === 'number' && isFinite(n) && n > 0) ? n : 0;
    },
    /** 增加：返回新增后的数量（保留 level 等附加字段，材料需要 level） */
    add: function (t, id, n) {
      const key = bag.type(t);
      const s = FG.getState();
      s.bag = s.bag || {};
      s.bag[key] = s.bag[key] || {};
      const cur = bag.getCount(key, id);
      const prev = (s.bag[key][id] && typeof s.bag[key][id] === 'object') ? s.bag[key][id] : {};
      s.bag[key][id] = Object.assign({}, prev, { count: cur + (Number(n) || 0) });
      return s.bag[key][id].count;
    },
    /** 扣减：不足返回 false（不出现负数） */
    remove: function (t, id, n) {
      const key = bag.type(t);
      const cur = bag.getCount(key, id);
      const num = Number(n) || 0;
      if (cur < num) return false;
      const box = (FG.getState().bag || {})[key];
      if (!box) return false;
      const left = cur - num;
      if (left <= 0) delete box[id]; else box[id] = { count: left };
      return true;
    },
    /** 列表：[{ id, count }]，按 id 排序保证渲染稳定 */
    list: function (t) {
      const box = (FG.getState().bag || {})[bag.type(t)] || {};
      return Object.keys(box).sort().map(function (id) {
        return { id: id, count: bag.getCount(bag.type(t), id) };
      }).filter(function (e) { return e.count > 0; });
    },
    total: function (t) {
      return bag.list(t).reduce(function (sum, e) { return sum + e.count; }, 0);
    }
  };

  FG.CURRENT_VERSION = CURRENT_VERSION;
  FG.sanitize = sanitize;
  FG.bag = bag;
  FG.createDefaultState = createDefaultState;
  FG.mergeDeep = mergeDeep;
  FG.getState = getState;
  FG.replaceState = replaceState;
  FG.resetState = resetState;

  try { window.__state = FG.state; } catch (e) { }
})(window.FG = window.FG || {});
