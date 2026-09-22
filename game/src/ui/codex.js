/* ============================================================
   src/ui/codex.js · 06 图鉴面板 + 排行榜
   职责：只渲染与派发，规则全在 systems.codex
     - 四类页签：🐟 鱼类 / 🧩 材料 / 🎣 钓具 / 🤝 钓友
     - 未收录灰显「❓ ???」；顶部「已收集 X/Y」+ 完成度百分比
     - 里程碑奖励列表：可领取显示「领取 +N💎」，已领取灰态「已领取」
     - 排行榜入口（本地数据 + 离线灰显提示）
   ============================================================ */
(function (FG) {
  'use strict';
  const U = FG.utils;
  const ui = FG.ui = FG.ui || {};
  const C = () => FG.systems.codex;

  const state = { type: 'fish', rankDim: 'tier' };

  /* ---------------- 图鉴面板 ---------------- */

  function open(type) {
    state.type = (type && C().TYPES.some(function (t) { return t.key === type; })) ? type : 'fish';
    renderPanel();
  }

  function renderPanel() {
    const codex = C();
    const comp = codex.getCompletion(state.type);
    const total = codex.getTotalCompletion();

    const tabs = codex.TYPES.map(function (t) {
      const c = codex.getCompletion(t.key);
      return '<button class="bag-tab clickable' + (state.type === t.key ? ' active' : '') + '" data-type="' + t.key + '">' +
        t.icon + ' ' + t.name + '<div class="li-sub">' + c.owned + '/' + c.total + '</div></button>';
    }).join('');

    const head =
      '<div class="codex-head">' +
        '<div>已收集：<b>' + U.formatInt(comp.owned) + ' / ' + U.formatInt(comp.total) + '</b>' +
          '　完成度 <b>' + U.formatPercent(comp.percent, 1) + '</b></div>' +
        '<div class="li-sub">总完成度 ' + U.formatPercent(total.percent, 1) + '（' + total.owned + '/' + total.total + '）</div>' +
        '<div class="codex-bar"><i style="width:' + Math.round(comp.percent * 100) + '%"></i></div>' +
        (state.type === 'friends' ? '<div class="empty-tip">钓友图鉴随社交系统（08）开放</div>' : '') +
      '</div>';

    const grid = '<div class="bag-grid' + (entries(state.type).length ? '' : ' empty') + '">' + cards(state.type) + '</div>';
    const rewards = rewardHtml();

    const body =
      '<div class="bag-tabs">' + tabs + '</div>' +
      head + grid + rewards +
      '<div class="modal-foot-inline">' +
        '<button class="btn" id="codex-claim-all">🎁 一键领取全部奖励</button>' +
        '<button class="btn" id="codex-rank">🏆 排行榜</button>' +
      '</div>';

    FG.modal.open({ title: '📖 图鉴', wide: true, body: body, showCancel: false });

    const box = document.getElementById('modal-layer');
    const tabBtns = box.querySelectorAll('.bag-tabs .bag-tab');
    for (let i = 0; i < tabBtns.length; i++) {
      U.onPointer(tabBtns[i], U.throttle(function () {
        state.type = tabBtns[i].getAttribute('data-type');
        renderPanel();
      }, 200));
    }
    const claimBtns = box.querySelectorAll('.codex-claim');
    for (let j = 0; j < claimBtns.length; j++) {
      U.onPointer(claimBtns[j], U.throttleLead(function () {
        if (C().claimReward(claimBtns[j].getAttribute('data-key'))) {
          FG.render.renderAll();
          renderPanel();
        }
      }, FG.CONFIG.ui.throttleMs));
    }
    U.onPointer(box.querySelector('#codex-claim-all'), U.throttleLead(function () {
      const r = C().claimAllRewards();
      if (r.count) { FG.render.renderAll(); renderPanel(); }
    }, FG.CONFIG.ui.throttleMs));
    U.onPointer(box.querySelector('#codex-rank'), U.throttle(function () { openRank(); }, 200));
  }

  /** 该分类的条目列表（含是否已收录） */
  function entries(type) {
    const s = FG.getState();
    const c = (s.codex || {})[type] || {};
    const dict = type === 'fish' ? (FG.CONFIG.fish || {})
      : type === 'materials' ? (FG.CONFIG.materials || {})
        : type === 'equipment' ? (FG.CONFIG.items || {}) : {};
    return Object.keys(dict).map(function (id) {
      const meta = dict[id] || {};
      const got = c[id] || null;
      return {
        id: id, known: !!got,
        name: meta.name || id, icon: meta.icon || '❔',
        rarity: meta.rarity || 'common',
        desc: meta.desc || '',
        maxWeight: got ? (Number(got.maxWeight) || 0) : 0,
        count: got ? (Number(got.count) || 0) : 0,
        firstAt: got ? (Number(got.firstAt) || 0) : 0
      };
    });
  }

  function cards(type) {
    const list = entries(type);
    if (!list.length) return '<div class="empty-tip">该类目暂无条目</div>';
    /* 已收录排前面，未收录（❓ ???）排后面灰显 */
    list.sort(function (a, b) { return (b.known ? 1 : 0) - (a.known ? 1 : 0); });
    return list.map(function (e) {
      if (!e.known) {
        return '<div class="bag-card codex-unknown">' +
          '<span class="bag-ico">❓</span>' +
          '<span class="bag-name">???</span>' +
          '</div>';
      }
      const stars = '★'.repeat((FG.ENUM.RARITY_STAR || {})[e.rarity] || 1);
      const when = e.firstAt ? new Date(e.firstAt).toLocaleDateString('zh-CN') : '';
      return '<div class="bag-card codex-card glow-' + e.rarity + '">' +
        '<span class="bag-ico">' + e.icon + '</span>' +
        '<span class="bag-name">' + U.safe(e.name, e.id) + '</span>' +
        '<span class="bag-stars">' + stars + '</span>' +
        (e.maxWeight ? '<span class="bag-num">最大 ' + U.formatWeight(e.maxWeight) + 'kg</span>' : '') +
        (when ? '<span class="bag-num">' + when + ' 收录</span>' : '') +
        '</div>';
    }).join('');
  }

  function rewardHtml() {
    const s = FG.getState();
    const rw = s.codexRewards || {};
    const keys = Object.keys(rw);
    if (!keys.length) return '<div class="card-title" style="margin-top:10px"><span>🎁 图鉴奖励</span></div>' +
      '<div class="empty-tip">还没有达成里程碑，继续收集吧</div>';
    const rows = keys.map(function (k) {
      const r = rw[k];
      const label = U.safe(r.label, k);
      const btn = r.claimed
        ? '<button class="btn" disabled>已领取</button>'
        : '<button class="btn btn-primary codex-claim" data-key="' + k + '">领取 +' + U.formatInt(r.diamond) + '💎</button>';
      return '<div class="list-item">' +
        '<span>' + (r.claimed ? '✅' : '🎁') + '</span>' +
        '<span class="li-main">' + label + '<div class="li-sub">' + U.formatInt(r.diamond) + ' 钻石</div></span>' +
        btn +
        '</div>';
    }).join('');
    return '<div class="card-title" style="margin-top:10px"><span>🎁 图鉴奖励</span>' +
      '<span class="li-sub">未领取 ' + C().unclaimedCount() + ' 项</span></div>' + rows;
  }

  /* ---------------- 排行榜（本地数据，06 §4） ---------------- */

  function openRank() {
    renderRank();
  }

  function renderRank() {
    const codex = C();
    const dims = codex.RANK_DIMS.map(function (d) {
      return '<button class="bag-tab clickable' + (state.rankDim === d.key ? ' active' : '') + '" data-dim="' + d.key + '">' +
        d.icon + ' ' + d.name + '</button>';
    }).join('');

    const body =
      '<div class="bag-tabs">' + dims + '</div>' +
      '<div id="rank-rows"><div class="empty-tip">加载中…</div></div>';

    FG.modal.open({ title: '🏆 排行榜', wide: true, body: body, showCancel: false });
    const box = document.getElementById('modal-layer');
    const btns = box.querySelectorAll('.bag-tabs .bag-tab');
    for (let i = 0; i < btns.length; i++) {
      U.onPointer(btns[i], U.throttle(function () {
        state.rankDim = btns[i].getAttribute('data-dim');
        renderRank();
      }, 200));
    }

    /* 08 已接入 → 用社交榜（云端 + 本人高亮）；否则退回 06 的本地榜 */
    const SOC = FG.systems.social;
    const target = box.querySelector('#rank-rows');
    if (SOC && SOC.getRank) {
      SOC.getRank(state.rankDim).then(function (r) {
        if (!target) return;
        const rows = (r.rows || []).map(function (x) {
          return '<div class="list-item' + (x.me ? ' active' : '') + '">' +
            '<span>#' + U.formatInt(x.rank) + '</span>' +
            '<span class="li-main">' + U.safe(x.name, '匿名钓手') +
              '<div class="li-sub">' + U.safe(x.tier, '') + '　Lv.' + U.formatInt(x.level) + '</div></span>' +
            '<span class="li-main" style="text-align:right">' + U.safe(x.text, '0') + '</span>' +
            '</div>';
        }).join('');
        target.innerHTML = (rows || '<div class="empty-tip">暂无排行数据</div>') +
          (r.offline ? '<div class="empty-tip">离线：当前为本地榜，联网后可查看全服排行</div>' : '');
      });
      return;
    }

    const data = codex.getRankData(state.rankDim);
    target.innerHTML =
      '<div class="codex-head"><div>本地排行（本人数据）</div>' +
        '<div class="li-sub">段位：' + U.safe(data.tierName, '新手') + '　综合分 ' + U.formatInt(data.score) + '</div></div>' +
      data.rows.map(function (r) {
        return '<div class="list-item active"><span>#' + r.rank + '</span>' +
          '<span class="li-main">' + U.safe(r.name, '我') +
            '<div class="li-sub">' + U.safe(data.tierName, '') + '</div></span>' +
          '<span class="li-main" style="text-align:right">' + U.safe(r.text, '0') + U.safe(r.unit, '') + '</span></div>';
      }).join('') +
      '<div class="empty-tip">联网后查看全服排行（社交系统 08 接入）</div>';
  }

  ui.codex = { open: open, openRank: openRank };
})(window.FG = window.FG || {});
