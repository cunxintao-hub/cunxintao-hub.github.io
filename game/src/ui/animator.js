/* ============================================================
   src/ui/animator.js · 人物骨骼/补间动画播放器（Lottie）
   数据：assets/actor/actor-data.js（由 tools/build-actor-anim.js 生成，内嵌 base64 图层）
   运行时：vendor/lottie.min.js
   职责：把「阶段 → 动作名」的映射（CONFIG.actor.actions）翻译成 Lottie 的 segment 播放；
        不参与任何玩法判定，纯表现层（10 §9：动画不得阻塞状态机）
   降级：lottie 或动画数据缺失 / 初始化异常 → 返回 false，场景保持静态，玩法照常
   ============================================================ */
(function (FG) {
  'use strict';

  const state = {
    instance: null,
    ready: false,
    current: '',        // 当前动作名
    pending: '',        // DOMLoaded 之前的待播动作
    pendingLoop: false,
    afterTimer: 0
  };

  function cfg() { return (FG.CONFIG && FG.CONFIG.actor) || {}; }

  /** 运行环境是否具备播放条件（同步判断，用于决定底图用干净版还是原图） */
  function available() {
    return !!(window.lottie && window.FG_ACTOR_DATA && window.FG_ACTOR_DATA.markers);
  }

  /**
   * 挂载到容器（幂等）
   * @param {HTMLElement} container 场景内的动画容器 #scene-actor
   */
  function init(container) {
    if (state.instance || !container) return state.ready;
    if (cfg().enabled === false) { console.log('[animator] 配置关闭，跳过'); return false; }
    if (!available()) {
      console.warn('[animator] lottie 或 actor-data.js 缺失，人物动画降级为静态场景');
      return false;
    }
    try {
      state.instance = window.lottie.loadAnimation({
        container: container,
        renderer: 'svg',
        loop: false,
        autoplay: false,
        animationData: window.FG_ACTOR_DATA,
        rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: true }
      });
      state.instance.addEventListener('DOMLoaded', function () {
        state.ready = true;
        container.classList.add('ready');
        console.log('[animator] 动画就绪，动作：' + markerNames().join('/'));
        if (state.pending) {
          const p = state.pending, loop = state.pendingLoop;
          state.pending = '';
          play(p, loop);
        }
      });
      state.instance.addEventListener('complete', function () {
        const act = currentAction();
        if (act && act.after && act.after.name) { clearAfterTimer(); play(act.after.name, !!act.after.loop); }
      });
      state.instance.addEventListener('data_failed', function () {
        console.warn('[animator] 动画数据加载失败，降级为静态');
        state.ready = false;
      });
      return true;
    } catch (e) {
      console.warn('[animator] 初始化异常，降级为静态', e);
      state.instance = null;
      return false;
    }
  }

  function markerNames() {
    return (window.FG_ACTOR_DATA.markers || []).map(function (m) { return m.cm; });
  }

  function findMarker(name) {
    const list = window.FG_ACTOR_DATA.markers || [];
    for (let i = 0; i < list.length; i++) if (list[i].cm === name) return list[i];
    return null;
  }

  /** 当前阶段对应的动作配置 */
  function currentAction() {
    const map = cfg().actions || {};
    const phase = FG.systems.fishing ? FG.systems.fishing.getPhase() : 'idle';
    return map[phase] || null;
  }

  /** 某动作播完后该接什么（CONFIG.actor.actions 里配的 after） */
  function afterOf(name) {
    const map = cfg().actions || {};
    const keys = Object.keys(map);
    for (let i = 0; i < keys.length; i++) {
      const a = map[keys[i]];
      if (a && a.name === name && a.after && a.after.name) return a.after;
    }
    return null;
  }

  function clearAfterTimer() {
    if (state.afterTimer) { clearTimeout(state.afterTimer); state.afterTimer = 0; }
  }

  /**
   * 播放动作（同名循环动作不会重播，避免每帧打断）
   * @param {string} name 动作名（actor-data 里的 marker）
   * @param {boolean} loop 是否循环
   */
  function play(name, loop) {
    if (!name) return false;
    const mk = findMarker(name);
    if (!mk) { console.warn('[animator] 未知动作', name); return false; }
    if (!state.ready) { state.pending = name; state.pendingLoop = !!loop; return false; }
    if (state.current === name && loop) return true;

    state.current = name;
    clearAfterTimer();
    try {
      state.instance.loop = !!loop;
      state.instance.playSegments([mk.tm, mk.tm + mk.dr], true);
    } catch (e) { console.warn('[animator] 播放失败', name, e); return false; }

    /* 一次性动作播完 → 接后续动作（如 抛竿 → 等待循环）。
       同时用定时器兜底：Lottie 的 complete 事件在后台标签页/无头环境可能不触发（10 §2 不允许卡住） */
    const after = loop ? null : afterOf(name);
    if (after) {
      const ms = Math.round((mk.dr / (window.FG_ACTOR_DATA.fr || 30)) * 1000) + 60;
      state.afterTimer = setTimeout(function () {
        state.afterTimer = 0;
        const still = currentAction();
        if (still && still.name === name && after.name) play(after.name, !!after.loop);
      }, ms);
    }
    console.log('[animator] play', name, loop ? '(loop)' : '');
    return true;
  }

  /** 回到静止姿态（idle） */
  function stop() {
    state.current = '';
    state.pending = '';
    clearAfterTimer();
    if (!state.ready) return;
    try { state.instance.goToAndStop(0, true); } catch (e) { /* 忽略 */ }
  }

  /**
   * 按当前钓鱼阶段驱动动画（render 每帧调用，内部做同名去重）
   */
  function sync() {
    if (!state.ready && !state.pending && !available()) return false;
    const act = currentAction();
    if (!act || !act.name) { stop(); return true; }
    return play(act.name, !!act.loop);
  }

  FG.animator = {
    available: available,
    init: init,
    play: play,
    stop: stop,
    sync: sync,
    isReady: function () { return state.ready; },
    getCurrent: function () { return state.current; }
  };
})(window.FG = window.FG || {});
