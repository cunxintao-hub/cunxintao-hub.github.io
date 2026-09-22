/* ============================================================
   src/ui/settings.js · 设置面板（09 §6）
   项：🔊音效开关（持久化） / 💾保存进度 / 📂读取进度（二次确认） /
      🗑️重置游戏（二次确认） / 📖重置教程（二次确认）
   反馈（09 §7）：云同步失败静默降级，设置页显示状态；有损操作必须二次确认
   ============================================================ */
(function (FG) {
  'use strict';
  const U = FG.utils;

  /* ---------------- 音效开关 ---------------- */

  function getSound() {
    const s = FG.getState();
    if (!s.settings || typeof s.settings.sound !== 'boolean') {
      s.settings = s.settings || {};
      s.settings.sound = !!(FG.CONFIG.settings && FG.CONFIG.settings.soundDefault);
    }
    return s.settings.sound;
  }

  function setSound(on) {
    const s = FG.getState();
    s.settings = s.settings || {};
    s.settings.sound = !!on;
    FG.save.markDirty();
    FG.toast(on ? '🔊 音效已开启' : '🔇 音效已关闭', 'ok');
    if (on) playCue('click');
    return s.settings.sound;
  }

  function toggleSound() { return setSound(!getSound()); }

  /** 音效播放：无外部音频资源，用 WebAudio 合成极简提示音；关闭开关或不支持时静默 */
  function playCue(type) {
    try {
      if (!getSound()) return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = playCue._ctx || (playCue._ctx = new Ctx());
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      const freq = type === 'success' ? 880 : (type === 'warn' ? 440 : 660);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.15);
    } catch (e) { /* 音频不可用不影响可玩（09 §7 静默降级） */ }
  }

  /* ---------------- 设置面板 ---------------- */

  function open() {
    const syncText = syncStatusText();
    const sound = getSound();
    FG.modal.open({
      title: '⚙️ 设置',
      body:
        '<div class="list-item clickable" id="set-sound">' +
          '<span>' + (sound ? '🔊' : '🔇') + ' 音效</span>' +
          '<span class="li-main"></span>' +
          '<span class="li-sub">' + (sound ? '已开启' : '已关闭') + '</span>' +
        '</div>' +
        '<div class="list-item clickable" id="set-save">💾 保存进度' +
          '<span class="li-main"></span><span class="li-sub">立即写本地</span></div>' +
        '<div class="list-item clickable" id="set-load">📂 读取进度' +
          '<span class="li-main"></span><span class="li-sub">' + syncText + '</span></div>' +
        '<div class="list-item clickable" id="set-tutorial">📖 重置教程' +
          '<span class="li-main"></span><span class="li-sub">清除引导记录</span></div>' +
        '<div class="list-item clickable" id="set-reset" style="color:#C62828">🗑️ 重置游戏' +
          '<span class="li-main"></span><span class="li-sub">清空存档</span></div>',
      showCancel: true,
      cancelText: '关闭'
    });
    bind();
  }

  function syncStatusText() {
    const st = FG.save.getSyncStatus();
    if (!(FG.CONFIG.settings || {}).cloudEnabled) return '云端未接入（本地存档）';
    if (!st.lastSyncAt) return '尚未同步';
    return st.ok ? '上次同步成功' : '上次同步失败（本地可继续玩）';
  }

  function bind() {
    const byId = function (id) { return document.getElementById(id); };
    const tap = function (id, fn) {
      const node = byId(id);
      if (node) U.onPointer(node, U.throttleLead(fn, FG.CONFIG.ui.throttleMs));
    };

    tap('set-sound', function () { toggleSound(); open(); });          // 重开面板刷新开关文案

    tap('set-save', function () {
      const ok = FG.save.save();
      FG.toast(ok ? '进度已保存' : '保存失败，请检查浏览器存储', ok ? 'ok' : 'err');
    });

    tap('set-load', function () {
      FG.modal.confirm('📂 读取进度', '<div>将用云端存档覆盖本地进度，确定继续？</div>', function () {
        const remote = FG.save.pullFromCloud();
        if (!remote) { FG.toast('暂无云端存档，已保留本地进度', 'warn'); return; }
        FG.replaceState(remote);
        FG.render.renderAll();
        FG.toast('已读取云端存档', 'ok');
      });
    });

    tap('set-tutorial', function () {
      FG.modal.confirm('📖 重置教程', '<div>将清除新手引导记录，确定重置？</div>', function () {
        const s = FG.getState();
        s.tutorial = { seen: {} };
        FG.save.markDirty();
        FG.toast('新手引导已重置', 'ok');
      });
    });

    tap('set-reset', function () {
      FG.modal.confirm('🗑️ 重置游戏', '<div><b>将清空全部进度且不可恢复</b>，确定重置？</div>', function () {
        FG.save.resetSave();                       // 清 localStorage + 回默认档
        FG.systems.equip.ensureStarterPack();      // 重置后补发新手礼包（02 §6）
        FG.render.renderAll();
        FG.toast('游戏已重置', 'ok');
      });
    });
  }

  FG.settings = {
    open: open,
    getSound: getSound,
    setSound: setSound,
    toggleSound: toggleSound,
    playCue: playCue
  };
})(window.FG = window.FG || {});
