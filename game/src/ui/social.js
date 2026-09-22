/* ============================================================
   src/ui/social.js · 08 社交页签（🌐）
   职责：只渲染与派发，规则全在 systems.social
     - 顶部状态条：在线/离线 + 降级说明（离线也能钓鱼，不阻断核心玩法）
     - 注册引导卡（未注册）/ 昵称卡（已注册）
     - 🔍 查找钓友 · 🤝 钓友团（加成可见）· 🐟 鱼王挑战 · 💬 世界频道 · 🏆 排行榜
   ============================================================ */
(function (FG) {
  'use strict';
  const U = FG.utils;
  const ui = FG.ui = FG.ui || {};
  const SOC = () => FG.systems.social;

  const view = { dim: 'tier', results: [], fishId: '', opponentId: '', keyword: '', nameError: '' };

  function render() {
    const box = document.getElementById('social-panel');
    if (!box || !SOC()) return;
    const online = SOC().isOnline();
    const registered = SOC().isRegistered();

    box.innerHTML =
      statusBar(online) +
      (registered ? profileCard() : registerCard()) +
      findCard(registered) +
      friendCard(registered) +
      challengeCard(registered) +
      chatCard(registered) +
      rankCard();

    bind(registered);
  }

  /* ---------------- 状态条 ---------------- */
  function statusBar(online) {
    return '<div class="soc-status' + (online ? '' : ' offline') + '">' +
      '<span>' + (online ? '🟢 已连接（本地模拟云端）' : '🔴 离线模式') + '</span>' +
      '<span class="li-sub">' + (online
        ? '数据来自模拟云端；断网时自动降级为本地版'
        : '社交功能已降级为本地版，<b>钓鱼与所有核心玩法不受影响</b>') + '</span>' +
      '<button class="btn" id="soc-toggle-net">' + (online ? '🌐 模拟断网' : '🌐 恢复联网') + '</button>' +
      '</div>';
  }

  /* ---------------- 注册 ---------------- */
  function registerCard() {
    return '<div class="soc-card">' +
      '<div class="card-title"><span>📝 注册钓手昵称</span><span class="li-sub">2~8 字 · 唯一</span></div>' +
      '<div class="soc-row">' +
        '<input class="soc-input" id="soc-name" type="text" maxlength="8" placeholder="输入昵称（2~8 字）" />' +
        '<button class="btn btn-primary" id="soc-register">注册</button>' +
      '</div>' +
      '<div class="err-text" id="soc-name-err">' + U.safe(view.nameError, '') + '</div>' +
      '<div class="empty-tip">未注册时，查找钓友 / 鱼王挑战 / 世界频道都会显示注册引导</div>' +
      '</div>';
  }

  function profileCard() {
    const p = SOC().myProfile();
    return '<div class="soc-card">' +
      '<div class="card-title"><span>🧑 我的名片</span><span class="li-sub">08 §1</span></div>' +
      '<div class="list-item"><span>🎣</span>' +
        '<span class="li-main"><b>' + U.safe(p.displayName, '未命名') + '</b>' +
          '<div class="li-sub">短 ID ' + U.safe(p.id, '#------') + '　Lv.' + U.formatInt(FG.getState().level) + '</div></span>' +
        '<span class="li-sub">已注册</span></div>' +
      '</div>';
  }

  /* ---------------- 🔍 查找钓友 ---------------- */
  function findCard(registered) {
    if (!registered) return guideCard('🔍 查找钓友', '注册昵称后即可按昵称或 #ID 查找钓友');
    const rows = view.results.length ? view.results.map(function (p) {
      return '<div class="list-item"><span>🎣</span>' +
        '<span class="li-main">' + U.safe(p.name, p.id) +
          '<div class="li-sub">' + U.safe(p.id, '') + '　Lv.' + U.formatInt(p.level) +
          '　鱼 ' + U.formatInt(p.fish) + '　图鉴 ' + U.formatPercent(p.codex, 0) + '</div></span>' +
        (p.added ? '<button class="btn" disabled>已添加</button>'
          : '<button class="btn btn-primary soc-add" data-id="' + p.id + '">🤝 添加</button>') +
        '</div>';
    }).join('') : '<div class="empty-tip">输入昵称或 #ID 后点「查找」（留空列出全部钓手）</div>';

    return '<div class="soc-card">' +
      '<div class="card-title"><span>🔍 查找钓友</span><span class="li-sub">按昵称或 #ID</span></div>' +
      '<div class="soc-row">' +
        '<input class="soc-input" id="soc-search" type="text" placeholder="如：老钓翁 或 #A1B2C3" value="' + U.safe(view.keyword, '') + '" />' +
        '<button class="btn btn-primary" id="soc-search-btn">查找</button>' +
      '</div>' +
      rows + '</div>';
  }

  /* ---------------- 🤝 钓友团 ---------------- */
  function friendCard(registered) {
    const b = SOC().friendBonusState();
    if (!registered) return guideCard('🤝 钓友团', '注册后添加钓友，每人 +' + U.formatPercent(b.perFriend, 0) + ' 经验（上限 ' + U.formatPercent(b.capPercent, 0) + '）');
    const list = SOC().friendList();
    const rows = list.length ? list.map(function (f) {
      return '<div class="list-item"><span>🤝</span>' +
        '<span class="li-main">' + U.safe(f.name, f.id) +
          '<div class="li-sub">' + U.safe(f.id, '') + '　Lv.' + U.formatInt(f.level) + '</div></span>' +
        '<button class="btn soc-remove" data-id="' + f.id + '">移除</button>' +
        '</div>';
    }).join('') : '<div class="empty-tip">还没有钓友，去「🔍 查找钓友」加几位吧</div>';

    return '<div class="soc-card">' +
      '<div class="card-title"><span>🤝 钓友团</span>' +
        '<span class="li-sub">加成 <b class="ok-text">' + U.safe(b.text, '') + '</b></span></div>' +
      '<div class="soc-bar"><i style="width:' + Math.round(b.bonus / Math.max(0.0001, b.capPercent) * 100) + '%"></i></div>' +
      rows + '</div>';
  }

  /* ---------------- 🐟 鱼王挑战 ---------------- */
  function challengeCard(registered) {
    const cs = SOC().challengeState();
    if (!registered) return guideCard('🐟 鱼王挑战', '注册后可用背包里的鱼发起挑战，金币价值高者胜');
    const fishes = SOC().challengeFish();
    const pool = (FG.CONFIG.social.npcPool || []);
    const opp = view.opponentId || (pool[0] && pool[0].id) || '';

    const fishRows = fishes.length ? fishes.map(function (f) {
      return '<div class="list-item clickable soc-pick-fish' + (view.fishId === f.id ? ' active' : '') + '" data-fish="' + f.id + '">' +
        '<span>' + f.icon + '</span>' +
        '<span class="li-main">' + U.safe(f.name, f.id) +
          '<div class="li-sub">' + U.formatWeight(f.weight) + 'kg　金币价值 🪙' + U.formatInt(f.value) + '</div></span>' +
        '<span class="li-sub">' + (view.fishId === f.id ? '已选' : '选择') + '</span>' +
        '</div>';
    }).join('') : '<div class="empty-tip">背包里没有鱼，先去钓鱼吧</div>';

    const oppOpts = pool.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === opp ? ' selected' : '') + '>' +
        U.safe(p.name, p.id) + '（🪙' + U.formatInt(p.bestFishValue) + '）</option>';
    }).join('');

    const msgs = SOC().inbox();
    const inboxRows = msgs.length ? msgs.slice(0, 6).map(function (m) {
      return '<div class="list-item"><span>' + (m.type === 'sent' ? (m.win ? '🏆' : '🐟') : '📬') + '</span>' +
        '<span class="li-main">' + U.safe(m.text, '') +
          '<div class="li-sub">' + new Date(m.at).toLocaleString('zh-CN') + '</div></span></div>';
    }).join('') : '<div class="empty-tip">收件箱是空的，发起挑战或点「📬 查看挑战」</div>';

    return '<div class="soc-card">' +
      '<div class="card-title"><span>🐟 鱼王挑战</span>' +
        '<span class="li-sub">今日 ' + U.formatInt(cs.sent) + '/' + U.formatInt(cs.limit) +
        '　胜利 +' + U.formatInt((FG.CONFIG.economy || {}).challengeWinReward) + '🪙</span></div>' +
      fishRows +
      '<div class="soc-row">' +
        '<select class="soc-input" id="soc-opponent">' + oppOpts + '</select>' +
        '<button class="btn btn-primary" id="soc-challenge"' + (cs.usedUp || !view.fishId ? ' disabled' : '') + '>' +
          (cs.usedUp ? '今日挑战已用完（' + cs.limit + '/' + cs.limit + '）' : '⚔️ 发起挑战') + '</button>' +
      '</div>' +
      (cs.usedUp ? '<div class="err-text">今日挑战已用完（' + cs.limit + '/' + cs.limit + '），明日 0 点重置</div>' : '') +
      '<div class="card-title" style="margin-top:8px"><span>📬 挑战记录</span>' +
        '<span class="li-sub">收到 ' + U.formatInt(cs.received) + '</span></div>' +
      inboxRows +
      '<div class="soc-row"><button class="btn" id="soc-inbox">📬 查看挑战（刷新）</button></div>' +
      '</div>';
  }

  /* ---------------- 💬 世界频道 ---------------- */
  function chatCard(registered) {
    const online = SOC().isOnline();
    const cd = SOC().chatCooldown();
    if (!online) {
      return '<div class="soc-card"><div class="card-title"><span>💬 世界频道</span></div>' +
        '<div class="empty-tip">离线状态，联网后可查看世界频道（不影响钓鱼）</div></div>';
    }
    if (!registered) return guideCard('💬 世界频道', '注册昵称后即可在世界频道发言');
    const msgs = SOC().chatMessages().slice(-12);
    const rows = msgs.length ? msgs.map(function (m) {
      return '<div class="soc-chat' + (m.me ? ' me' : '') + '">' +
        '<b>' + U.safe(m.name, '匿名') + '</b>' + (m.id ? ' <span class="li-sub">' + U.safe(m.id, '') + '</span>' : '') +
        '<div>' + U.safe(m.text, '') + '</div></div>';
    }).join('') : '<div class="empty-tip">频道里还没有消息</div>';

    return '<div class="soc-card">' +
      '<div class="card-title"><span>💬 世界频道</span>' +
        '<span class="li-sub">间隔 ' + Math.round(((FG.CONFIG.social || {}).chatMinIntervalMs || 3000) / 1000) +
        's · 最多 ' + U.formatInt((FG.CONFIG.social || {}).chatMaxLength) + ' 字</span></div>' +
      '<div class="soc-chatbox">' + rows + '</div>' +
      '<div class="soc-row">' +
        '<input class="soc-input" id="soc-chat-input" type="text" maxlength="' + U.formatInt((FG.CONFIG.social || {}).chatMaxLength) + '" placeholder="说点什么…" />' +
        '<button class="btn btn-primary" id="soc-send"' + (cd.ready ? '' : ' disabled') + '>' +
          (cd.ready ? '发送' : '冷却 ' + U.formatInt(cd.left) + 's') + '</button>' +
        '<button class="btn" id="soc-refresh-chat">🔄 刷新</button>' +
      '</div></div>';
  }

  /* ---------------- 🏆 排行榜 ---------------- */
  function rankCard() {
    const dims = SOC().DIMS.map(function (d) {
      return '<button class="bag-tab clickable' + (view.dim === d.key ? ' active' : '') + '" data-dim="' + d.key + '">' +
        d.icon + ' ' + d.name + '</button>';
    }).join('');
    return '<div class="soc-card">' +
      '<div class="card-title"><span>🏆 排行榜</span><span class="li-sub">本人高亮 · 四个维度</span></div>' +
      '<div class="bag-tabs">' + dims + '</div>' +
      '<div id="soc-rank"><div class="empty-tip">加载中…</div></div>' +
      '</div>';
  }

  function renderRank() {
    const box = document.getElementById('soc-rank');
    if (!box) return;
    SOC().getRank(view.dim).then(function (r) {
      const rows = (r.rows || []).map(function (row) {
        return '<div class="list-item' + (row.me ? ' active' : '') + '">' +
          '<span>#' + U.formatInt(row.rank) + '</span>' +
          '<span class="li-main">' + U.safe(row.name, '匿名钓手') +
            '<div class="li-sub">' + U.safe(row.tier, '') + '　Lv.' + U.formatInt(row.level) + '</div></span>' +
          '<span class="li-main" style="text-align:right">' + U.safe(row.text, '0') + '</span>' +
          '</div>';
      }).join('');
      box.innerHTML = (rows || '<div class="empty-tip">暂无排行数据（联网后查看全服排行）</div>') +
        (r.offline ? '<div class="empty-tip">离线：当前为本地榜，联网后可查看全服排行</div>' : '');
    });
  }

  function guideCard(title, tip) {
    return '<div class="soc-card">' +
      '<div class="card-title"><span>' + title + '</span><span class="li-sub">需要注册</span></div>' +
      '<div class="empty-tip">' + tip + '</div></div>';
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind(registered) {
    const box = document.getElementById('social-panel');
    if (!box) return;
    const T = FG.CONFIG.ui.throttleMs;

    const netBtn = box.querySelector('#soc-toggle-net');
    if (netBtn) {
      U.onPointer(netBtn, U.throttleLead(function () {
        SOC().setSimulatedOffline(!SOC().isOnline() ? false : true);
        FG.render.renderAll(); render();
      }, T));
    }

    /* 注册 */
    const regBtn = box.querySelector('#soc-register');
    if (regBtn) {
      U.onPointer(regBtn, U.throttleLead(function () {
        const input = box.querySelector('#soc-name');
        const name = input ? input.value : '';
        const r = SOC().register(name);
        if (!r.ok) { view.nameError = r.error; render(); return; }   // 红字提示原因
        view.nameError = '';
        FG.render.renderAll(); render();
      }, T));
    }

    /* 查找 */
    const searchBtn = box.querySelector('#soc-search-btn');
    if (searchBtn) {
      U.onPointer(searchBtn, U.throttleLead(function () {
        const input = box.querySelector('#soc-search');
        view.keyword = input ? input.value : '';
        SOC().searchPlayers(view.keyword).then(function (r) {
          view.results = r.items || [];
          render();
        });
      }, T));
    }
    const adds = box.querySelectorAll('.soc-add');
    for (let i = 0; i < adds.length; i++) {
      U.onPointer(adds[i], U.throttleLead(function () {
        if (SOC().addFriend(adds[i].getAttribute('data-id'))) {
          SOC().searchPlayers(view.keyword).then(function (r) { view.results = r.items || []; FG.render.renderAll(); render(); });
        }
      }, T));
    }
    const rm = box.querySelectorAll('.soc-remove');
    for (let j = 0; j < rm.length; j++) {
      U.onPointer(rm[j], U.throttleLead(function () {
        if (SOC().removeFriend(rm[j].getAttribute('data-id'))) { FG.render.renderAll(); render(); }
      }, T));
    }

    /* 挑战 */
    const picks = box.querySelectorAll('.soc-pick-fish');
    for (let k = 0; k < picks.length; k++) {
      U.onPointer(picks[k], U.throttle(function () {
        view.fishId = picks[k].getAttribute('data-fish');
        render();
      }, 150));
    }
    const oppSel = box.querySelector('#soc-opponent');
    if (oppSel && oppSel.value) view.opponentId = oppSel.value;
    const chBtn = box.querySelector('#soc-challenge');
    if (chBtn && !chBtn.disabled) {
      U.onPointer(chBtn, U.throttleLead(function () {
        const sel = box.querySelector('#soc-opponent');
        const opp = sel ? sel.value : view.opponentId;
        if (!view.fishId) { FG.toast('先选一条出战的鱼', 'warn'); return; }
        SOC().sendChallenge(view.fishId, opp).then(function (r) {
          if (r && !r.ok && r.error) FG.toast(r.error, 'warn');
          FG.render.renderAll(); render();
        });
      }, T));
    }
    const inboxBtn = box.querySelector('#soc-inbox');
    if (inboxBtn) {
      U.onPointer(inboxBtn, U.throttleLead(function () {
        SOC().refreshInbox().then(function () { FG.render.renderAll(); render(); });
      }, T));
    }

    /* 频道 */
    const sendBtn = box.querySelector('#soc-send');
    if (sendBtn && !sendBtn.disabled) {
      U.onPointer(sendBtn, U.throttleLead(function () {
        const input = box.querySelector('#soc-chat-input');
        const r = SOC().sendChat(input ? input.value : '');
        if (r.ok && input) input.value = '';
        FG.render.renderAll(); render();
      }, T));
    }
    const refreshBtn = box.querySelector('#soc-refresh-chat');
    if (refreshBtn) {
      U.onPointer(refreshBtn, U.throttleLead(function () {
        SOC().refreshChat().then(function () { render(); });
      }, T));
    }

    /* 排行榜页签 */
    const dims = box.querySelectorAll('.bag-tabs .bag-tab');
    for (let d = 0; d < dims.length; d++) {
      U.onPointer(dims[d], U.throttle(function () {
        view.dim = dims[d].getAttribute('data-dim');
        render();
      }, 150));
    }
    renderRank();
  }

  ui.social = { render: render, setDim: function (d) { view.dim = d; } };
})(window.FG = window.FG || {});
