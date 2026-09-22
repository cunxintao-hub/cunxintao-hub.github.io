/* ============================================================
   src/systems/social.js · 08 社交系统（本地模拟云端版）
   职责：注册/短ID、查找与添加钓友、好友经验加成、鱼王挑战、世界频道、排行榜
   依赖：CONFIG.social / CONFIG.economy、state.socialProfile / friends / friendLevels /
        challengeToday / codex，以及 systems.market（鱼价）、systems.codex（完成度）
   硬约束（08 §9 / 本轮最重要的一条）：
     - **任何云端异常都必须降级为本地可用**：所有云端调用走 request()，
       离线/超时/异常 → 返回本地数据 + toast，绝不让社交阻断核心玩法
     - 数值全部来自 config.js（00 §4.1）；失败必须有文案（10 §1）；
       资产（金币/鱼）变动成对完成、失败回滚（10 §8）
   ============================================================ */
(function (FG) {
  'use strict';
  const S = FG.systems = FG.systems || {};
  const U = FG.utils;

  function cfg() { return (FG.CONFIG || {}).social || {}; }
  function st() { return FG.getState(); }
  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* ---------------- 本地「云端」状态（懒初始化，随存档持久化） ---------------- */
  function ensure() {
    const s = st();
    if (!s.social || typeof s.social !== 'object') s.social = {};
    const c = s.social;
    if (!Array.isArray(c.inbox)) c.inbox = [];
    if (!Array.isArray(c.chat)) c.chat = [];
    if (typeof c.lastChatAt !== 'number') c.lastChatAt = 0;
    if (typeof c.offlineSimulated !== 'boolean') c.offlineSimulated = false;
    if (typeof c.lastOfflineToast !== 'number') c.lastOfflineToast = 0;
    return c;
  }

  /** 在线判定：浏览器离线 或 玩家手动模拟断网 → 离线 */
  function isOnline() {
    const c = ensure();
    const nav = (typeof navigator === 'undefined') ? true : navigator.onLine !== false;
    return !!nav && !c.offlineSimulated;
  }

  /** 调试/自测用：模拟断网开关 */
  function setSimulatedOffline(flag) {
    ensure().offlineSimulated = !!flag;
    FG.save.markDirty();
    FG.toast(flag ? '🌐 已模拟断网（社交降级为本地版，钓鱼不受影响）' : '🌐 已恢复联网', 'ok');
    console.log('[social] simulatedOffline =', !!flag);
    return !!flag;
  }

  /** 降级提示（同一分钟只提示一次，避免刷屏） */
  function degrade(reason) {
    const c = ensure();
    const now = Date.now();
    if (now - c.lastOfflineToast > 60000) {
      c.lastOfflineToast = now;
      FG.toast('🌐 ' + reason + '，社交已切换本地模式（不影响钓鱼）', 'warn');
    }
    console.warn('[social] 云端降级：' + reason);
  }

  /**
   * 云端请求模拟（10 §2：网络请求 8s 超时）
   * 离线 / 超时 / 抛错 → 统一降级返回本地兜底数据，绝不向上抛异常阻断玩法
   * @param {string} label 日志标签
   * @param {Function} cloud 云端逻辑（返回数据）
   * @param {*} fallback 降级时的兜底数据
   * @returns {Promise<{data:*, offline:boolean, reason:string}>}
   */
  function request(label, cloud, fallback) {
    const c = ensure();
    const timeout = Number(cfg().requestTimeoutMs) || (FG.CONFIG.timeout && FG.CONFIG.timeout.request) || 8000;
    const delay = Number(cfg().requestDelayMs) || 0;
    return new Promise(function (resolve) {
      if (!isOnline()) { degrade('当前离线'); resolve({ data: fallback, offline: true, reason: 'offline' }); return; }
      let done = false;
      const finish = function (r) { if (done) return; done = true; clearTimeout(timer); resolve(r); };
      const timer = setTimeout(function () { degrade('网络超时'); finish({ data: fallback, offline: true, reason: 'timeout' }); }, timeout);
      try {
        setTimeout(function () {
          let data;
          try { data = cloud(); }
          catch (e) { console.warn('[social] 云端异常', label, e); degrade('云端异常'); finish({ data: fallback, offline: true, reason: 'error' }); return; }
          finish({ data: data, offline: false, reason: 'ok' });
        }, delay);
      } catch (e) {
        console.warn('[social] 请求构造失败', label, e);
        degrade('云端异常');
        finish({ data: fallback, offline: true, reason: 'error' });
      }
    });
  }

  /* ================= 1. 账号与注册 ================= */

  const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 去掉易混淆字符

  function makeId() {
    let out = '';
    for (let i = 0; i < 6; i++) out += ID_CHARS[U.randInt(0, ID_CHARS.length - 1)];
    return '#' + out;
  }

  /**
   * 昵称校验：长度 / 字符集 / 唯一性（与模拟云端玩家去重）
   * @returns {{ok:boolean, error:string}}
   */
  function validateName(name) {
    const c = cfg();
    const min = Number(c.nameMin) || 2;
    const max = Number(c.nameMax) || 8;
    const raw = (name == null ? '' : String(name)).trim();
    if (!raw) return { ok: false, error: '请输入昵称' };
    if (raw.length < min || raw.length > max) return { ok: false, error: '昵称需 ' + min + '~' + max + ' 个字（当前 ' + raw.length + '）' };
    const re = c.nameCharset instanceof RegExp ? c.nameCharset : /^[\u4e00-\u9fa5A-Za-z0-9_]+$/;
    if (!re.test(raw)) return { ok: false, error: '昵称只能包含中文、字母、数字或下划线' };
    const dup = (c.npcPool || []).some(function (p) { return p.name === raw; });
    if (dup) return { ok: false, error: '昵称已被占用，换一个试试' };
    return { ok: true, error: '' };
  }

  /** 注册：写入 socialProfile；失败返回原因（UI 在输入框下方红字显示） */
  function register(name) {
    const s = st();
    if (s.socialProfile && s.socialProfile.registered) { return { ok: false, error: '已经注册过了' }; }
    const v = validateName(name);
    if (!v.ok) return v;
    s.socialProfile = { displayName: String(name).trim(), id: makeId(), registered: true };
    FG.save.markDirty();
    FG.toast('🎉 注册成功：' + s.socialProfile.displayName + ' ' + s.socialProfile.id, 'ok');
    console.log('[social] register', s.socialProfile.id);
    return { ok: true, error: '', profile: s.socialProfile };
  }

  function isRegistered() { return !!(st().socialProfile && st().socialProfile.registered); }
  function myProfile() {
    const p = (st().socialProfile || {});
    return { displayName: U.safe(p.displayName, ''), id: U.safe(p.id, ''), registered: !!p.registered };
  }

  /* ================= 2. 钓友与加成 ================= */

  function npcById(id) {
    return (cfg().npcPool || []).filter(function (p) { return p.id === id; })[0] || null;
  }

  function friends() { return (st().friends || []).slice(); }

  function friendList() {
    return friends().map(function (id) {
      const p = npcById(id);
      return {
        id: id,
        name: p ? p.name : id,
        level: p ? (Number(p.level) || 1) : (Number((st().friendLevels || {})[id]) || 1),
        known: !!p
      };
    });
  }

  /** 好友经验加成：每人 +5%，上限 25%（=5 人） */
  function getFriendBonus() {
    const c = cfg();
    const per = Number(c.friendBonusPerFriend) || 0;
    const cap = Number(c.friendBonusCap) || 0;
    return Math.min(cap, Math.max(0, per * friends().length));
  }

  /** 好友数上限（由加成上限反推，避免魔法数字） */
  function friendCap() {
    const c = cfg();
    const per = Number(c.friendBonusPerFriend) || 0;
    const cap = Number(c.friendBonusCap) || 0;
    return per > 0 ? Math.round(cap / per) : 0;
  }

  /** 加成摘要（面板展示） */
  function friendBonusState() {
    const n = friends().length;
    return {
      count: n, cap: friendCap(),
      bonus: getFriendBonus(),
      perFriend: Number(cfg().friendBonusPerFriend) || 0,
      capPercent: Number(cfg().friendBonusCap) || 0,
      text: '经验 +' + U.formatPercent(getFriendBonus(), 0) + '（' + n + '/' + friendCap() + ' 位钓友）'
    };
  }

  /**
   * 查找钓友（按昵称或 #ID，走云端，离线降级为本地库）
   * @returns {Promise<{items:Array, offline:boolean}>}
   */
  function searchPlayers(keyword) {
    const key = String(keyword == null ? '' : keyword).trim().toLowerCase();
    const mine = (st().socialProfile || {}).id || '';
    const local = function () {
      return (cfg().npcPool || []).filter(function (p) {
        if (!key) return true;
        return p.name.toLowerCase().indexOf(key) !== -1 || p.id.toLowerCase().indexOf(key) !== -1;
      }).filter(function (p) { return p.id !== mine; });
    };
    return request('search:' + key, local, local()).then(function (r) {
      const items = (r.data || []).map(function (p) {
        return {
          id: p.id, name: p.name, level: Number(p.level) || 1,
          fish: Number(p.fish) || 0, codex: Number(p.codex) || 0,
          added: (st().friends || []).indexOf(p.id) !== -1
        };
      });
      return { items: items, offline: r.offline, reason: r.reason };
    });
  }

  /** 添加好友：写 friends / friendLevels / codex.friends（06 收录） */
  function addFriend(id) {
    const s = st();
    if (!npcById(id)) { FG.toast('查无此人', 'warn'); return false; }
    if ((s.friends || []).indexOf(id) !== -1) { FG.toast('已经是钓友了', 'warn'); return false; }
    if (friends().length >= friendCap()) {
      FG.toast('钓友团已满（' + friendCap() + '/' + friendCap() + '），先移除一位再加吧', 'warn');
      return false;
    }
    s.friends = s.friends || [];
    s.friends.push(id);
    s.friendLevels = s.friendLevels || {};
    s.friendLevels[id] = Number(npcById(id).level) || 1;
    /* 06 §1.2：钓友加入图鉴 */
    s.codex = s.codex || {};
    s.codex.friends = s.codex.friends || {};
    s.codex.friends[id] = { firstAt: Date.now(), count: 1 };
    FG.save.markDirty();
    FG.toast('🤝 已添加钓友 ' + npcById(id).name + '　好友加成 ' + U.formatPercent(getFriendBonus(), 0), 'ok');
    console.log('[social] addFriend', id, 'bonus=', getFriendBonus());
    return true;
  }

  function removeFriend(id) {
    const s = st();
    const i = (s.friends || []).indexOf(id);
    if (i === -1) { FG.toast('这位不在钓友团里', 'warn'); return false; }
    s.friends.splice(i, 1);
    FG.save.markDirty();
    FG.toast('已移除钓友 ' + U.safe((npcById(id) || {}).name, id) + '　加成 ' + U.formatPercent(getFriendBonus(), 0), 'ok');
    return true;
  }

  /* ================= 3. 鱼王挑战 ================= */

  function challengeState() {
    const s = st();
    const today = todayKey();
    if (!s.challengeToday || s.challengeToday.date !== today) {
      s.challengeToday = { date: today, sent: 0, received: 0 };     // 跨日重置
      FG.save.markDirty();
    }
    const limit = Number((FG.CONFIG.economy || {}).challengeDailyLimit) || 3;
    const sent = Number(s.challengeToday.sent) || 0;
    return {
      date: today, sent: sent, received: Number(s.challengeToday.received) || 0,
      limit: limit, left: Math.max(0, limit - sent), usedUp: sent >= limit
    };
  }

  /** 可出战的鱼（背包里的鱼，按金币价值从高到低） */
  function challengeFish() {
    const s = st();
    const M = S.market;
    return Object.keys(s.bag.fish || {}).map(function (id) {
      const e = s.bag.fish[id];
      const f = (FG.CONFIG.fish || {})[id] || { name: id, icon: '🐟' };
      const weights = (e && e.weights ? e.weights.slice() : []).sort(function (a, b) { return b - a; });
      const w = weights[0] || 0;
      return {
        id: id, name: f.name, icon: f.icon, rarity: f.rarity || 'common',
        weight: w, count: (e && e.weights ? e.weights.length : 0),
        value: M && M.getFishPrice ? M.getFishPrice(id, w) : 0
      };
    }).filter(function (f) { return f.count > 0; })
      .sort(function (a, b) { return b.value - a.value; });
  }

  /**
   * 发起鱼王挑战：用背包里的一条鱼比对对手鱼的金币价值，高者胜
   * @param {string} fishId
   * @param {string} opponentId
   * @returns {Promise<{ok:boolean, win:boolean, myValue:number, opValue:number, reward:number, offline:boolean, error:string}>}
   */
  function sendChallenge(fishId, opponentId) {
    const s = st();
    const cs = challengeState();
    const fail = function (msg) { return Promise.resolve({ ok: false, error: msg, win: false, myValue: 0, opValue: 0, reward: 0, offline: false }); };
    if (!isRegistered()) return fail('请先注册昵称');
    if (cs.usedUp) return fail('今日挑战已用完（' + cs.limit + '/' + cs.limit + '）');

    const mine = challengeFish().filter(function (f) { return f.id === fishId; })[0];
    if (!mine) return fail('背包里没有鱼，先去钓鱼吧');
    const op = npcById(opponentId);
    if (!op) return fail('没有找到对手');

    /* 💎 金币收益加成（英雄「陈海盗」）：挑战奖金同享 */
    const goldMul = 1 + ((S.growth && S.growth.getSkillEffect) ? Math.max(0, Number(S.growth.getSkillEffect('goldGain')) || 0) : 0);
    const reward = Math.round((Number((FG.CONFIG.economy || {}).challengeWinReward) || 0) * goldMul);
    const opValue = Number(op.bestFishValue) || 0;
    const win = mine.value > opValue;

    /* 同步占位：先扣次数再发请求，避免连点把额度冲超（10 §4） */
    s.challengeToday.sent = (Number(s.challengeToday.sent) || 0) + 1;
    FG.save.markDirty();

    return request('challenge:' + opponentId, function () {
      return { opValue: opValue, win: win };
    }, { opValue: opValue, win: win }).then(function (r) {
      const got = win ? reward : 0;
      if (win) {
        s.gold = (Number(s.gold) || 0) + got;
        s.stats = s.stats || {};
        s.stats.totalGoldEarned = (Number(s.stats.totalGoldEarned) || 0) + got;
        if (FG.ui.float) FG.ui.float.show('+' + U.formatInt(got) + '🪙', 'ok');
      }
      const c = ensure();
      c.inbox.unshift({
        type: 'sent', at: Date.now(), win: win,
        text: (win ? '🐟 你用 ' : '🐟 你派 ') + mine.icon + mine.name + '（🪙' + U.formatInt(mine.value) +
          '）挑战 ' + op.name + '（🪙' + U.formatInt(opValue) + '）→ ' + (win ? '胜利 +' + U.formatInt(got) + '🪙' : '惜败'),
        reward: got
      });
      if (c.inbox.length > 20) c.inbox.length = 20;
      FG.save.markDirty();
      FG.toast(win ? '🏆 挑战胜利！+' + U.formatInt(got) + '🪙' : '😢 挑战惜败：对手的鱼更值钱', win ? 'ok' : 'warn');
      console.log('[social] sendChallenge', fishId, opponentId, mine.value, 'vs', opValue, 'win=', win);
      return { ok: true, win: win, myValue: mine.value, opValue: opValue, reward: got, offline: r.offline, error: '' };
    });
  }

  /** 收件箱（📬 查看挑战） */
  function inbox() { return ensure().inbox.slice(); }

  /** 刷新收件箱：拉取他人发起的挑战（离线时只返回本地记录） */
  function refreshInbox() {
    const c = ensure();
    const per = Math.max(0, Number(cfg().inboxPerPull) || 0);
    return request('inbox', function () {
      const pool = (cfg().npcPool || []);
      const out = [];
      for (let i = 0; i < per; i++) {
        const p = pool[U.randInt(0, pool.length - 1)];
        if (!p) continue;
        out.push({
          type: 'received', at: Date.now(), win: false, reward: 0,
          text: '📬 ' + p.name + ' 向你发起鱼王挑战（他的鱼 🪙' + U.formatInt(p.bestFishValue) + '）'
        });
      }
      return out;
    }, []).then(function (r) {
      (r.data || []).forEach(function (m) {
        c.inbox.unshift(m);
        st().challengeToday.received = (Number(st().challengeToday.received) || 0) + 1;
      });
      if (c.inbox.length > 20) c.inbox.length = 20;
      FG.save.markDirty();
      if (!r.offline && (r.data || []).length) FG.toast('📬 收到 ' + (r.data || []).length + ' 条挑战', 'ok');
      return { items: c.inbox.slice(), offline: r.offline };
    });
  }

  /* ================= 4. 世界频道 ================= */

  function filterText(text) {
    let out = String(text == null ? '' : text);
    (cfg().bannedWords || []).forEach(function (w) {
      if (!w) return;
      out = out.split(w).join('*'.repeat(w.length));
    });
    return out;
  }

  function chatMessages() {
    const c = ensure();
    if (!c.chat.length) {
      (cfg().chatSeed || []).forEach(function (m, i) {
        c.chat.push({ name: m.name, id: '', text: filterText(m.text), at: Date.now() - (i + 1) * 60000, me: false });
      });
      FG.save.markDirty();
    }
    return c.chat.slice();
  }

  /** 发言：间隔 ≥3s + 长度限制 + 敏感词过滤 */
  function sendChat(text) {
    const s = st();
    const c = ensure();
    const raw = String(text == null ? '' : text).trim();
    const max = Number(cfg().chatMaxLength) || 60;
    if (!isRegistered()) { FG.toast('请先注册昵称再发言', 'warn'); return { ok: false, error: '请先注册昵称' }; }
    if (!raw) { FG.toast('说点什么吧', 'warn'); return { ok: false, error: '内容不能为空' }; }
    if (raw.length > max) { FG.toast('最多 ' + max + ' 个字（当前 ' + raw.length + '）', 'warn'); return { ok: false, error: '最多 ' + max + ' 个字' }; }
    const gap = Number(cfg().chatMinIntervalMs) || 3000;
    const left = gap - (Date.now() - c.lastChatAt);
    if (c.lastChatAt && left > 0) {
      FG.toast('发言间隔 ' + Math.ceil(gap / 1000) + ' 秒（还需 ' + Math.ceil(left / 1000) + 's）', 'warn');
      return { ok: false, error: '发言间隔 ' + Math.ceil(gap / 1000) + ' 秒' };
    }
    const safe = filterText(raw);
    c.lastChatAt = Date.now();
    c.chat.push({ name: U.safe((s.socialProfile || {}).displayName, '我'), id: U.safe((s.socialProfile || {}).id, ''), text: safe, at: Date.now(), me: true });
    if (c.chat.length > 50) c.chat.shift();
    FG.save.markDirty();
    console.log('[social] sendChat', safe);
    return { ok: true, text: safe, error: '' };
  }

  function chatCooldown() {
    const c = ensure();
    const gap = Number(cfg().chatMinIntervalMs) || 3000;
    const left = gap - (Date.now() - c.lastChatAt);
    return { ready: !c.lastChatAt || left <= 0, left: Math.max(0, Math.ceil(left / 1000)) };
  }

  /** 手动刷新（不做长连接轮询） */
  function refreshChat() {
    return request('chat', function () {
      const pool = (cfg().npcPool || []);
      const out = [];
      const p = pool[U.randInt(0, pool.length - 1)];
      if (p) out.push({ name: p.name, id: p.id, text: '频道里有人喊：' + p.name + ' 又上大货了', at: Date.now(), me: false });
      return out;
    }, []).then(function (r) {
      const c = ensure();
      (r.data || []).forEach(function (m) { c.chat.push(m); });
      if (c.chat.length > 50) c.chat.shift();
      FG.save.markDirty();
      return { items: c.chat.slice(), offline: r.offline };
    });
  }

  /* ================= 5. 排行榜（四维度） ================= */

  const DIMS = [
    { key: 'tier', name: '段位', icon: '🎖️' },
    { key: 'codex', name: '图鉴', icon: '📖' },
    { key: 'fish', name: '总鱼数', icon: '🐟' },
    { key: 'weight', name: '最重鱼', icon: '🐋' }
  ];

  function tierName(score) {
    const tiers = (FG.CONFIG.rank || {}).tiers || [];
    let name = tiers.length ? tiers[0].name : '新手';
    tiers.forEach(function (t) { if (score >= (Number(t.min) || 0)) name = t.name; });
    return name;
  }

  function selfRow() {
    const s = st();
    const comp = (S.codex && S.codex.getTotalCompletion) ? S.codex.getTotalCompletion() : { percent: 0, owned: 0, total: 0 };
    const fish = Number(s.stats && s.stats.totalFishCaught) || 0;
    const biggest = Number(s.stats && s.stats.biggestFish) || 0;
    const codexP = Number(comp.percent) || 0;
    return {
      id: U.safe((s.socialProfile || {}).id, ''),
      name: U.safe((s.socialProfile || {}).displayName, '我'),
      level: Number(s.level) || 1,
      fish: fish, codex: codexP, biggest: biggest,
      score: fish + Math.round(codexP * 50),
      me: true
    };
  }

  function valueOf(row, dim) {
    if (dim === 'tier') return Number(row.score) || 0;
    if (dim === 'codex') return Number(row.codex) || 0;
    if (dim === 'fish') return Number(row.fish) || 0;
    return Number(row.biggest) || 0;
  }

  function textOf(dim, v) {
    if (dim === 'codex') return U.formatPercent(v, 1);
    if (dim === 'weight') return U.formatWeight(v) + 'kg';
    if (dim === 'tier') return U.formatInt(v);
    return U.formatInt(v);
  }

  /**
   * 排行榜：云端数据 + 本人高亮；离线/无数据 → 本地榜 + 灰显提示
   * @returns {Promise<{dim:Object, rows:Array, offline:boolean, empty:boolean}>}
   */
  function getRank(dim) {
    const d = DIMS.filter(function (x) { return x.key === dim; })[0] || DIMS[0];
    const me = selfRow();
    const local = function () {
      return (cfg().npcPool || []).map(function (p) {
        return {
          id: p.id, name: U.safe(p.name, p.id),
          level: Number(p.level) || 1,
          fish: Number(p.fish) || 0,
          codex: Number(p.codex) || 0,
          biggest: Number(p.biggest) || 0,
          score: (Number(p.fish) || 0) + Math.round((Number(p.codex) || 0) * 50),
          me: false
        };
      });
    };
    return request('rank:' + d.key, local, []).then(function (r) {
      const rows = (r.data || []).concat([me]).map(function (row) {
        const v = valueOf(row, d.key);
        return {
          name: U.safe(row.name, '匿名钓手'),
          id: U.safe(row.id, ''),
          level: Number(row.level) || 1,
          tier: tierName(Number(row.score) || 0),
          value: v, text: textOf(d.key, v),
          me: !!row.me
        };
      }).sort(function (a, b) { return b.value - a.value; });
      rows.forEach(function (row, i) { row.rank = i + 1; });
      return { dim: d, rows: rows, offline: r.offline, empty: rows.length <= 1 && r.offline };
    });
  }

  S.social = {
    /* 状态与降级 */
    isOnline: isOnline,
    setSimulatedOffline: setSimulatedOffline,
    request: request,
    /* 账号 */
    register: register,
    validateName: validateName,
    isRegistered: isRegistered,
    myProfile: myProfile,
    /* 钓友 */
    searchPlayers: searchPlayers,
    friendList: friendList,
    addFriend: addFriend,
    removeFriend: removeFriend,
    getFriendBonus: getFriendBonus,
    friendBonusState: friendBonusState,
    friendCap: friendCap,
    /* 挑战 */
    challengeState: challengeState,
    challengeFish: challengeFish,
    sendChallenge: sendChallenge,
    inbox: inbox,
    refreshInbox: refreshInbox,
    /* 频道 */
    chatMessages: chatMessages,
    sendChat: sendChat,
    chatCooldown: chatCooldown,
    refreshChat: refreshChat,
    filterText: filterText,
    /* 排行榜 */
    DIMS: DIMS,
    getRank: getRank
  };
})(window.FG = window.FG || {});
