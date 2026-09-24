/* ============================================================
   src/ui/layout.js · 桌面三栏骨架（00 §1.2 / 10 §6）
   结构：顶栏 + 左栏260（装备2×2宫格/钓场/材料）+ 主舞台自适应
        + 右栏300（装备槽/装备加成/盛产/最近收获）+ 底部导航
   职责：只负责骨架与事件分发，不写业务逻辑；数据填充交给 render.js
   ============================================================ */
(function (FG) {
  'use strict';
  const U = FG.utils;
  const ui = FG.ui = FG.ui || {};

  const SKELETON_HTML =
    '<header class="topbar">' +
      '<div class="brand">🎣 疯狂钓鱼佬</div>' +
      '<div class="spacer"></div>' +
      '<div class="stat clickable" id="stat-level" title="等级">Lv.1</div>' +
      '<div class="stat clickable" id="stat-gold" title="金币">🪙0</div>' +
      '<div class="stat clickable" id="stat-exp" title="经验">⭐0</div>' +
      '<div class="stat clickable" id="stat-diamond" title="钻石">💎0</div>' +
      /* 06：图鉴按钮，有未领取奖励时显示红点（#codex-dot） */
      '<button class="icon-btn" id="btn-codex" title="图鉴">📖<span class="dot" id="codex-dot" hidden></span></button>' +
      '<button class="icon-btn" id="btn-bag" title="背包">🎒</button>' +
      '<button class="icon-btn" id="btn-settings" title="设置">⚙️</button>' +
    '</header>' +

    '<div class="body">' +
      /* 左栏：只放 03/04 的操作区（钓鱼页整列隐藏，等级与钓场在右栏最上方） */
      '<aside class="col-left" id="col-left">' +
        /* 03 合成台操作区（左栏） */
        '<section class="card only-merge">' +
          '<div class="card-title"><span>🧰 合成台操作</span><span class="li-sub">03</span></div>' +
          '<div id="merge-actions"></div>' +
        '</section>' +
        /* 04 配方分类页签（左栏纵向排列） */
        '<section class="card only-craft">' +
          '<div class="card-title"><span>📂 配方分类</span><span class="li-sub">04</span></div>' +
          '<div id="craft-categories"></div>' +
        '</section>' +
      '</aside>' +

      '<main class="col-stage" id="col-stage">' +
      '<div class="stage-panel only-fishing" id="panel-fishing">' +
        '<section class="card">' +
          '<div class="stage-head">' +
            '<div>' +
              '<div class="stage-title" id="stage-title">🎣 疯狂钓鱼佬</div>' +
              '<div class="stage-desc" id="stage-desc">抛竿 → 等待 → 咬钩 → 张力 → 收杆 → 结算</div>' +
            '</div>' +
            '<span class="stage-chip" id="stage-sub">01 ｜ 核心循环</span>' +
          '</div>' +
          '<div class="stage-steps" id="stage-steps"></div>' +
        '</section>' +
        '<section class="stage-scene" id="stage-scene" data-phase="idle">' +
          /* 🆕 阶段背景视频（静音 + 内联播放，位于所有叠加层之下，仅作演出） */
          '<video id="scene-video" class="scene-video" muted playsinline preload="auto" aria-hidden="true"></video>' +
          '<div class="scene-vignette" aria-hidden="true"></div>' +
          '<div class="scene-fishshadow" aria-hidden="true"></div>' +
          '<div class="scene-ripples" id="scene-ripples"><i></i><i></i></div>' +
          '<div class="scene-actor" id="scene-actor"></div>' +
          '<div class="scene-bobber" id="scene-bobber"></div>' +
          '<div class="scene-hint" id="scene-hint">按空格或点击下方按钮执行主操作</div>' +
          '<div class="stage-overlay" id="fish-bite-hint">' +
            '<div class="bite-hint">❗ 有鱼咬钩了！<br><b>点击场景任意位置提竿</b></div>' +
          '</div>' +
          '<div class="stage-overlay" id="tension-system">' +
            '<div class="tension-box">' +
              '<div class="tension-head">' +
                '<span>⚡ 张力判定</span>' +
                '<span id="tension-rounds"></span>' +
                '<span id="tension-timer"></span>' +
              '</div>' +
              '<div class="tension-bar" id="tension-bar">' +
                '<div class="tension-target" id="tension-target"></div>' +
                '<div class="tension-cursor" id="tension-cursor"></div>' +
              '</div>' +
              '<div class="tension-foot" id="tension-result"></div>' +
            '</div>' +
          '</div>' +
          '<div class="stage-overlay" id="reel-system">' +
            '<div class="reel-box">' +
            '<div class="reel-head">🔥 疯狂收杆！</div>' +
            '<div class="reel-sub" id="reel-start"></div>' +
            '<div class="reel-bar"><div class="reel-fill" id="reel-fill"></div></div>' +
            '<div class="reel-foot"><span id="reel-progress">0%</span><span id="reel-slip"></span><span id="reel-timer"></span></div>' +
            '</div>' +
          '</div>' +
          '<div class="stage-actions">' +
            '<button class="btn btn-primary" id="btn-main">🎣 抛竿！</button>' +
            '<button class="btn btn-ghost" id="btn-abandon">放弃</button>' +
          '</div>' +
        '</section>' +
      '</div>' +

      /* 03 合成台（主舞台居中：6×6 网格） */
      '<div class="stage-panel only-merge" id="panel-merge">' +
        '<section class="card">' +
          '<div class="stage-head">' +
            '<div>' +
              '<div class="stage-title">🧩 材料二合</div>' +
              '<div class="stage-desc">拖拽两个同名同等级材料合并升级；也可点 A 再点 B</div>' +
            '</div>' +
            '<span class="stage-chip">03 ｜ 合成台</span>' +
          '</div>' +
          '<div id="merge-stats" class="merge-stats"></div>' +
        '</section>' +
        '<section class="card merge-stage">' +
          '<div class="merge-grid" id="merge-grid"></div>' +
          '<div class="merge-drag-layer" id="merge-drag-layer"></div>' +
        '</section>' +
        /* 底部快捷栏（对齐参考实现） */
        '<div class="quick-bar" id="merge-quickbar"></div>' +
      '</div>' +

      /* 04 配方合成（主舞台 2 列配方卡） */
      '<div class="stage-panel only-craft" id="panel-craft">' +
        '<section class="card">' +
          '<div class="stage-head">' +
            '<div>' +
              '<div class="stage-title">🔨 钓具合成</div>' +
              '<div class="stage-desc">按配方消耗材料产出钓具，产物直接进入装备背包</div>' +
            '</div>' +
            '<span class="stage-chip">04 ｜ 配方合成</span>' +
          '</div>' +
        '</section>' +
        '<section class="card craft-stage">' +
          '<div class="craft-grid" id="craft-grid"></div>' +
        '</section>' +
      '</div>' +

      /* 05 技能树（主舞台）：三条纵向分支 */
      '<div class="stage-panel only-skill" id="panel-skill">' +
        '<section class="card">' +
          '<div class="stage-head">' +
            '<div>' +
              '<div class="stage-title">🌟 技能树</div>' +
              '<div class="stage-desc">消耗金币学习，永久生效；同一条线内需按顺序解锁</div>' +
            '</div>' +
            '<span class="stage-chip">05 ｜ 成长</span>' +
          '</div>' +
        '</section>' +
        '<section class="card skill-stage">' +
          '<div id="skill-tree"></div>' +
        '</section>' +
      '</div>' +

      /* 06 工坊（主舞台）：工位 / 投料 / 制品 */
      '<div class="stage-panel only-workshop" id="panel-workshop">' +
        '<section class="card">' +
          '<div class="stage-head">' +
            '<div>' +
              '<div class="stage-title">🏭 工坊</div>' +
              '<div class="stage-desc">把鱼加工成 🍣 制品，售价 = 生鱼价 × ' +
                ((FG.CONFIG.economy || {}).productPriceFactor || 1) + '</div>' +
            '</div>' +
            '<span class="stage-chip">06 ｜ 收集与长线</span>' +
          '</div>' +
        '</section>' +
        '<section class="card ws-stage">' +
          '<div id="workshop-panel"></div>' +
        '</section>' +
      '</div>' +

      /* 07 市场（主舞台）：售卖 / 购买 / 博览会 */
      '<div class="stage-panel only-market" id="panel-market">' +
        '<section class="card">' +
          '<div class="stage-head">' +
            '<div>' +
              '<div class="stage-title">🏪 市场</div>' +
              '<div class="stage-desc">售卖鱼获与制品、购买材料、参加今日博览会</div>' +
            '</div>' +
            '<span class="stage-chip">07 ｜ 经济</span>' +
          '</div>' +
        '</section>' +
        '<section class="card mk-stage">' +
          '<div id="market-panel"></div>' +
        '</section>' +
      '</div>' +

      /* 08 社交（主舞台）：状态条 / 注册 / 查找 / 钓友团 / 挑战 / 频道 / 排行榜 */
      '<div class="stage-panel only-social" id="panel-social">' +
        '<section class="card">' +
          '<div class="stage-head">' +
            '<div>' +
              '<div class="stage-title">🌐 社交</div>' +
              '<div class="stage-desc">注册昵称 · 查找钓友 · 鱼王挑战 · 世界频道 · 排行榜（断网自动降级本地，不影响钓鱼）</div>' +
            '</div>' +
            '<span class="stage-chip">08 ｜ 社交</span>' +
          '</div>' +
        '</section>' +
        '<section class="card soc-stage">' +
          '<div id="social-panel"></div>' +
        '</section>' +
      '</div>' +

      /* 💎 钻石系统（主舞台）：余额 / 金币兑换 / 材料捆绑包 / 自动合成 / 英雄招募 */
      '<div class="stage-panel only-diamond" id="panel-diamond">' +
        '<section class="card">' +
          '<div class="stage-head">' +
            '<div>' +
              '<div class="stage-title">💎 钻石系统</div>' +
              '<div class="stage-desc">钻石兑换金币、购买材料礼包、开通自动合成、招募英雄获得永久加成</div>' +
            '</div>' +
            '<span class="stage-chip">💎 ｜ 商店</span>' +
          '</div>' +
        '</section>' +
        '<section class="card dm-stage">' +
          '<div id="diamond-panel"></div>' +
        '</section>' +
      '</div>' +
      '</main>' +

      '<aside class="col-right" id="col-right">' +
        /* 🆕 05 §2/§3：等级与钓场移到右栏最上方，且只在钓鱼页显示 */
        '<section class="card only-fishing">' +
          '<div class="card-title"><span>📈 等级</span><span class="li-sub">05</span></div>' +
          '<div id="growth-level"></div>' +
        '</section>' +
        '<section class="card only-fishing">' +
          '<div class="card-title"><span>🗺️ 钓场</span><span class="li-sub" id="location-count"></span></div>' +
          '<div id="location-list"></div>' +
        '</section>' +
        /* 技能页右栏：已学技能汇总 */
        '<section class="card only-skill">' +
          '<div class="card-title"><span>🌟 已学技能</span><span class="li-sub">05 §4</span></div>' +
          '<div id="skill-summary"></div>' +
        '</section>' +
        '<section class="card only-fishing">' +
          '<div class="card-title"><span>🛠️ 装备槽</span><span class="li-sub">02</span></div>' +
          '<div id="equip-slots"></div>' +
        '</section>' +
        '<section class="card only-fishing">' +
          '<div class="card-title"><span>📊 装备加成</span><span class="li-sub">02 §5.3</span></div>' +
          '<div id="equip-derived"></div>' +
        '</section>' +
        '<section class="card only-fishing">' +
          '<div class="card-title"><span>🐟 盛产鱼类</span><span class="li-sub" id="fish-preview-sub"></span></div>' +
          '<div id="fish-preview"></div>' +
        '</section>' +
        '<section class="card only-fishing">' +
          '<div class="card-title"><span>🧺 最近收获</span><span class="li-sub" id="recent-catch-sub"></span></div>' +
          '<div id="recent-catch"></div>' +
        '</section>' +
        /* 03 当前选中材料详情 */
        '<section class="card only-merge">' +
          '<div class="card-title"><span>🔍 物品详情</span><span class="li-sub">03</span></div>' +
          '<div id="merge-detail"></div>' +
        '</section>' +
        /* 04 悬停配方详情 */
        '<section class="card only-craft">' +
          '<div class="card-title"><span>📋 配方详情</span><span class="li-sub">04</span></div>' +
          '<div id="craft-detail"></div>' +
        '</section>' +
      '</aside>' +
    '</div>' +

    '<nav class="bottomnav" id="bottomnav"></nav>';

  const refs = {};
  /* 已实现页签：05 技能；06/07 工坊与市场；08 社交；钻石系统新增 💎 钻石 */
  const AVAILABLE_TABS = ['fishing', 'merge', 'craft', 'skill', 'workshop', 'market', 'social', 'diamond'];
  let activeTab = FG.ENUM.DEFAULT_TAB;
  let mounted = false;

  /** 挂载骨架（幂等） */
  function mount(root) {
    if (mounted) return refs;
    const app = root || document.getElementById('app');
    if (!app) { console.error('[layout] 缺少 #app 容器'); return refs; }

    app.innerHTML = SKELETON_HTML;
    refs.app = app;
    refs.topbar = app.querySelector('.topbar');
    refs.stageTitle = app.querySelector('#stage-title');
    refs.stageSub = app.querySelector('#stage-sub');
    refs.stageDesc = app.querySelector('#stage-desc');
    refs.sceneHint = app.querySelector('#scene-hint');
    refs.btnMain = app.querySelector('#btn-main');
    refs.overlay = app.querySelector('#stage-overlay');
    refs.bottomnav = app.querySelector('#bottomnav');

    buildNav(app.querySelector('#bottomnav'));
    bindTopbar(app);
    bindMainAction(app);
    bindScene(app);
    bindAbandon(app);
    app.setAttribute('data-tab', activeTab);
    if (FG.ui.mergeBoard) FG.ui.mergeBoard.bind();          // 合成台拖拽/点选绑定
    buildQuickBar(app);

    applyScale();
    window.addEventListener('resize', applyScale);

    mounted = true;
    console.log('[layout] 骨架挂载完成');
    return refs;
  }

  /** 底部导航：由 ENUM.TABS 生成，避免手写错漏 */
  function buildNav(nav) {
    if (!nav) return;
    nav.innerHTML = '';
    FG.ENUM.TABS.forEach(function (key) {
      const meta = FG.ENUM.TAB_META[key];
      const item = U.el('button', { class: 'nav-item clickable', 'data-tab': key },
        '<span class="nav-ico">' + meta.icon + '</span><span>' + meta.name + '</span>');
      U.onPointer(item, U.throttle(function () {
        if (AVAILABLE_TABS.indexOf(key) === -1) {       // 本轮可用：钓鱼 / 二合 / 合成
          FG.toast(meta.name + '将在后续轮次开放', 'warn');
          return;
        }
        switchTab(key);
      }, 200));
      nav.appendChild(item);
    });
  }

  /** 顶栏：图鉴 / 背包 / 设置（设置面板见 09 §6，实现在 ui/settings.js） */
  function bindTopbar(app) {
    const open = function (id, title, body) {
      U.onPointer(app.querySelector(id), function () {
        FG.modal.open({ title: title, body: body, showCancel: false });
      });
    };
    /* 06：图鉴面板（四类 + 完成度 + 里程碑奖励） */
    U.onPointer(app.querySelector('#btn-codex'), function () {
      if (FG.ui.codex) FG.ui.codex.open();
      else FG.modal.open({ title: '📖 图鉴', body: '<div class="empty-tip">图鉴模块未加载</div>', showCancel: false });
    });
    U.onPointer(app.querySelector('#btn-bag'), function () { openBagPanel(); });
    U.onPointer(app.querySelector('#btn-settings'), function () { FG.settings.open(); });
  }

  /** 背包：4 个页签（鱼类/材料/钓具/制品）只读查看（02 §5.1：禁止在背包内装备） */
  function openBagPanel(tab) {
    if (FG.ui.bag) { FG.ui.bag.open(tab); return; }
    FG.modal.open({ title: '🎒 背包', body: '<div class="empty-tip">背包模块未加载</div>', showCancel: false });
  }

  /** 合成台底部快捷栏：去钓鱼 / 合成钓具 / 背包 / 钓友（对齐参考实现） */
  function buildQuickBar(app) {
    const bar = app.querySelector('#merge-quickbar');
    if (!bar || bar.children.length) return;
    [
      { icon: '🎣', name: '去钓鱼', act: function () { switchTab('fishing'); } },
      { icon: '🔨', name: '合成钓具', act: function () { switchTab('craft'); } },
      { icon: '🎒', name: '背包', act: function () { openBagPanel(); } },   // 打开背包浮层（材料/鱼/钓具/制品）
      {
        icon: '🤝', name: '钓友', act: function () { switchTab('social'); }   // 08：直达社交页
      }
    ].forEach(function (it) {
      const btn = U.el('button', { class: 'btn clickable' }, it.icon + ' ' + it.name);
      U.onPointer(btn, U.throttleLead(it.act, 300));
      bar.appendChild(btn);
    });
  }

  /** 主操作按钮：空格与主按钮共用同一入口（10 §6） */
  function bindMainAction(app) {
    const btn = app.querySelector('#btn-main');
    if (!btn) return;
    // 抛竿会消耗饵料（资产操作）：前置节流 300ms，窗口内连点直接丢弃（10 §4）
    U.onPointer(btn, U.throttleLead(function () { triggerMainAction(); }, FG.CONFIG.ui.throttleMs));
  }

  function triggerMainAction() {
    if (getActiveTab() !== 'fishing') return;  // 主操作（抛竿/拉）只在钓鱼页生效，避免在二合页误抛竿
    const fn = FG.systems.fishing && FG.systems.fishing.onMainAction;
    if (typeof fn === 'function') fn();       // 走 01 的入口（内含饵料校验与阶段分派）
    FG.render.renderFishing();
  }

  /** 场景点击：咬钩阶段点任意位置提竿；收杆阶段等同拉（01 §5，统一 pointerdown） */
  function bindScene(app) {
    const scene = app.querySelector('#stage-scene');
    if (!scene) return;
    U.onPointer(scene, function (e) {
      if (e.target.closest && e.target.closest('button')) return;   // 按钮自己处理，不重复触发
      const phase = FG.systems.fishing.getPhase();
      if (phase === 'biting') FG.systems.fishing.onBiteHit();
      else if (phase === 'reel') FG.systems.fishing.reelClick();
      FG.render.renderFishing();
    });
  }

  /** 放弃按钮：进行中阶段随时可退出（玩家总有出口） */
  function bindAbandon(app) {
    const btn = app.querySelector('#btn-abandon');
    if (!btn) return;
    U.onPointer(btn, U.throttleLead(function () { FG.systems.fishing.abandonFishing('user'); }, 300));
  }

  /** 切换底部页签：白名单校验，非法回退默认页（10 §5） */
  function switchTab(key) {
    const next = U.pickValid(key, FG.ENUM.TABS, FG.ENUM.DEFAULT_TAB, 'switchTab');
    // 离开钓鱼页时结束进行中的垂钓，避免玩家在别的页签里被后台超时/状态串台（10 §9）
    if (activeTab === 'fishing' && next !== 'fishing' && FG.systems.fishing) {
      const ph = FG.systems.fishing.getPhase();
      if (ph !== 'idle' && ph !== 'caught') FG.systems.fishing.abandonFishing('switch-tab');
    }
    activeTab = next;
    const items = refs.bottomnav ? refs.bottomnav.querySelectorAll('.nav-item') : [];
    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', items[i].getAttribute('data-tab') === next);
    }
    if (refs.app) refs.app.setAttribute('data-tab', next);          // 三栏按页签切换面板（CSS 控制显隐）
    // 体力恢复倒计时只在合成台页签运行，离开即清理（10 §9）
    if (next === 'merge') { if (FG.ui.mergeBoard) FG.ui.mergeBoard.startTicker(); }
    else if (FG.ui.mergeBoard) FG.ui.mergeBoard.stopTicker();
    console.log('[layout] switchTab', next);
    /* 🆕 整页刷新（而不是只刷主舞台）：
       右栏（装备槽数量 / 装备加成 / 盛产 / 最近收获）、等级卡、钓场卡与顶栏数值都在 renderAll 链路里，
       只刷 renderStage 会让它们停留在上一次的值（例：合成饲料后回到钓鱼页，饵料数量不变）。 */
    FG.render.renderAll();
    return next;
  }

  function getActiveTab() { return activeTab; }

  /**
   * 等比缩放：窗口宽度 < 1024px 时整体缩小，禁止横向滚动条（10 §6）
   */
  function applyScale() {
    const app = refs.app;
    if (!app) return;
    const minW = FG.LAYOUT.minWidth;
    const scale = Math.min(1, window.innerWidth / minW);
    if (scale < 1) {
      app.style.transform = 'scale(' + scale + ')';
      app.style.height = (100 / scale) + 'vh';     // 缩放后仍铺满视口高度
    } else {
      app.style.transform = '';
      app.style.height = '100vh';
    }
  }

  ui.layout = {
    mount: mount,
    refs: refs,
    switchTab: switchTab,
    getActiveTab: getActiveTab,
    triggerMainAction: triggerMainAction,
    openBagPanel: openBagPanel,
    applyScale: applyScale
  };
})(window.FG = window.FG || {});
