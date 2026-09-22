/* ============================================================
   src/ui/growth.js · 05 成长体系界面
   职责：只渲染与派发，规则全在 systems.growth
     - 左栏：等级卡片（Lv.N + 经验进度条 + 还差多少升级）
     - 主舞台：技能树（三条纵向分支，节点含 名称/效果/成本/等级，状态四态）
     - 升级弹窗：本次解锁清单（钓场/配方/链），可点击直达对应页签
   ============================================================ */
(function (FG) {
  'use strict';
  const U = FG.utils;
  const ui = FG.ui = FG.ui || {};
  const G = () => FG.systems.growth;

  /* ---------------- 左栏 · 等级卡片 ---------------- */

  function renderLevel() {
    const box = document.getElementById('growth-level');
    if (!box || !G()) return;
    const p = G().expProgress();
    const left = Math.max(0, p.need - p.exp);
    const pct = Math.round(p.ratio * 100);
    const sig = p.level + '|' + p.exp + '|' + p.need;
    if (box.getAttribute('data-sig') === sig) return;
    box.setAttribute('data-sig', sig);

    box.innerHTML =
      '<div class="lv-head">' +
        '<span class="lv-badge">Lv.' + U.formatInt(p.level) + '</span>' +
        '<span class="lv-exp">⭐ ' + U.formatInt(p.exp) + ' / ' + U.formatInt(p.need) + '</span>' +
      '</div>' +
      '<div class="exp-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="lv-tip">还差 <b>' + U.formatInt(left) + '</b> 经验升级到 Lv.' + U.formatInt(p.level + 1) + '</div>';
  }

  /* ---------------- 主舞台 · 技能树 ---------------- */

  function renderSkillTree() {
    const box = document.getElementById('skill-tree');
    if (!box || !G()) return;
    const cfg = FG.CONFIG.skills || { lines: [] };
    const lines = cfg.lines || [];
    if (!lines.length) {
      box.innerHTML = '<div class="empty-tip">技能树未配置</div>';
      return;
    }
    const gold = Number(FG.getState().gold) || 0;
    box.innerHTML =
      '<div class="skill-head">' +
        '<span>消耗金币学习，永久生效（不可重置）</span>' +
        '<span class="li-sub">当前金币 🪙 <b>' + U.formatInt(gold) + '</b></span>' +
      '</div>' +
      '<div class="skill-lines">' +
        lines.map(lineHtml).join('') +
      '</div>';

    // 绑定「学习」按钮
    const btns = box.querySelectorAll('.skill-learn');
    for (let i = 0; i < btns.length; i++) {
      const btn = btns[i];
      if (btn.disabled) continue;
      U.onPointer(btn, U.throttleLead(function () {
        const id = btn.getAttribute('data-skill');
        if (G().learnSkill(id)) { FG.render.renderAll(); }
      }, FG.CONFIG.ui.throttleMs));
    }
  }

  function lineHtml(line) {
    const skills = (line.skills || []).map(function (sk) { return nodeHtml(sk); }).join('');
    return '<div class="skill-line">' +
      '<div class="skill-line-head">' + U.safe(line.icon, '🌟') + ' ' + U.safe(line.name, line.key) + '</div>' +
      '<div class="skill-nodes">' + skills + '</div>' +
    '</div>';
  }

  function nodeHtml(def) {
    const st = G().skillState(def.id);
    if (!st) return '';
    const cls = 'skill-node' +
      (st.level > 0 ? ' learned' : '') +
      (st.maxed ? ' maxed' : '') +
      (st.reason === 'locked' ? ' locked' : '') +
      (st.reason === 'poor' ? ' poor' : '');

    let foot;
    if (st.maxed) {
      foot = '<div class="sn-foot sn-max">已满级 Lv.' + st.maxLevel + '</div>';
    } else if (st.reason === 'locked') {
      foot = '<div class="sn-foot sn-lock">需先学习「' + U.safe(st.prevName, '前一技能') + '」</div>';
    } else if (st.reason === 'poor') {
      foot = '<button class="btn sn-btn" disabled>金币不足（还差 🪙' + U.formatInt(st.lack) + '）</button>';
    } else {
      foot = '<button class="btn btn-primary sn-btn skill-learn" data-skill="' + st.id + '">' +
        '🪙' + U.formatInt(st.cost) + ' 学习</button>';
    }

    return '<div class="' + cls + '">' +
      '<div class="sn-head">' +
        '<span class="sn-name">' + U.safe(st.name, st.id) + '</span>' +
        '<span class="sn-lv">Lv.' + st.level + '/' + st.maxLevel + '</span>' +
      '</div>' +
      '<div class="sn-effect">' + U.safe(def.desc, '') + '</div>' +
      '<div class="sn-detail">' + U.safe(st.effectText, '') + '　（每级）</div>' +
      foot +
    '</div>';
  }

  /* ---------------- 升级弹窗：解锁清单 ---------------- */

  /** @param {{leveled:boolean, from:number, to:number, unlocks:Object}} res */
  function openLevelUpPanel(res) {
    if (!res || !res.leveled) return false;
    const u = res.unlocks || { locations: [], recipes: [], chains: [] };
    const total = u.locations.length + u.recipes.length + u.chains.length;

    const group = function (title, icon, list) {
      if (!list.length) return '';
      return '<div class="card-title" style="margin-top:8px"><span>' + icon + ' ' + title + '</span></div>' +
        list.map(function (it) {
          return '<div class="list-item clickable unlock-item" data-tab="' + it.tab + '">' +
            '<span>🎉</span>' +
            '<span class="li-main">' + U.safe(it.name, it.id) +
              '<div class="li-sub">Lv.' + U.formatInt(it.level) + ' 解锁 · 点击前往</div></span>' +
            '<span class="li-sub">›</span>' +
          '</div>';
        }).join('');
    };

    const body =
      '<div class="levelup">' +
        '<div class="lu-title">🎉 恭喜升到 Lv.' + U.formatInt(res.to) + '！</div>' +
        (total ? '' : '<div class="empty-tip">本次没有新的解锁，继续攒经验解锁更多内容吧</div>') +
        group('钓场', '🗺️', u.locations) +
        group('配方', '🔨', u.recipes) +
        group('合成链', '🧩', u.chains) +
      '</div>';

    FG.modal.open({
      title: '🎉 升级！Lv.' + U.formatInt(res.to),
      body: body,
      showCancel: false,
      onClose: function () { FG.render.renderAll(); }
    });

    const items = document.querySelectorAll('#modal-layer .unlock-item');
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      U.onPointer(it, U.throttleLead(function () {
        const tab = it.getAttribute('data-tab');
        FG.modal.close(true);
        FG.ui.layout.switchTab(tab);
        FG.render.renderAll();
      }, FG.CONFIG.ui.throttleMs));
    }
    return true;
  }

  ui.growth = {
    renderLevel: renderLevel,
    renderSkillTree: renderSkillTree,
    openLevelUpPanel: openLevelUpPanel
  };
})(window.FG = window.FG || {});
