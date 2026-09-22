/* ============================================================
   src/ui/modal.js · 中央浮层弹窗（10 §3）
   规范：宽 480~640px 居中 + 半透明遮罩；遮罩可点击关闭；
   关闭后必须清理 display/pointer-events，避免吞掉后续点击。
   ============================================================ */
(function (FG) {
  'use strict';

  let current = null;   // { onClose }

  /**
   * @param {{title?:string, body?:string, onConfirm?:Function, confirmText?:string,
   *          cancelText?:string, showCancel?:boolean, onClose?:Function,
   *          light?:boolean, dismissible?:boolean}} options
   *   light = 浅色遮罩（鱼获结算用，让背景视频透出来）；
   *   dismissible:false = 禁止遮罩/✕/Esc 关闭，只能点面板里的按钮（鱼获结算防连点误关）
   */
  function openModal(options) {
    const opt = options || {};
    const layer = document.getElementById('modal-layer');
    if (!layer) { console.warn('[modal] 缺少 #modal-layer'); return; }

    closeModal(true);                                   // 同时只允许一个弹窗

    layer.innerHTML =
      '<div class="modal-backdrop' + (opt.light ? ' modal-light' : '') + '">' +
        '<div class="modal-panel' + (opt.wide ? ' modal-wide' : '') + '" role="dialog" aria-modal="true">' +
          '<div class="modal-head">' +
            '<div class="modal-title"></div>' +
            '<button class="modal-close" aria-label="关闭">✕</button>' +
          '</div>' +
          '<div class="modal-body"></div>' +
          '<div class="modal-foot"></div>' +
        '</div>' +
      '</div>';
    layer.style.display = '';

    const backdrop = layer.querySelector('.modal-backdrop');
    const titleEl = layer.querySelector('.modal-title');
    const bodyEl = layer.querySelector('.modal-body');
    const footEl = layer.querySelector('.modal-foot');
    const closeBtn = layer.querySelector('.modal-close');

    titleEl.textContent = FG.utils.safe(opt.title, '提示');
    if (opt.body != null) bodyEl.innerHTML = opt.body;

    if (opt.onConfirm) {
      const ok = FG.utils.el('button', { class: 'btn btn-primary' }, FG.utils.safe(opt.confirmText, '确定'));
      ok.style.minHeight = '40px'; ok.style.padding = '0 20px'; ok.style.fontSize = '14px';
      FG.utils.onPointer(ok, FG.utils.throttle(function () { opt.onConfirm(); closeModal(); }, 300));
      footEl.appendChild(ok);
    }
    if (opt.showCancel !== false) {
      const cancel = FG.utils.el('button', { class: 'btn' }, FG.utils.safe(opt.cancelText, '取消'));
      FG.utils.onPointer(cancel, function () { closeModal(); });
      footEl.appendChild(cancel);
    }

    /* 🆕 dismissible:false 的弹窗（如鱼获结算）不能用遮罩/✕/Esc 关闭，必须走面板里的按钮，
       否则收杆时的连点会正好点中遮罩把卡片「点没」，玩家还没选就把鱼处理掉了 */
    if (opt.dismissible === false) {
      closeBtn.style.display = 'none';
    } else {
      // 遮罩点击关闭（仅在点到遮罩本身时）
      FG.utils.onPointer(backdrop, function (e) { if (e.target === backdrop) closeModal(); });
      FG.utils.onPointer(closeBtn, function () { closeModal(); });
    }

    current = { onClose: opt.onClose, dismissible: opt.dismissible !== false };
    console.log('[modal] open', opt.title || '');
  }

  /** 关闭弹窗并彻底清理（10 §3：不得残留 backdrop 吞点击） */
  function closeModal(silent) {
    const layer = document.getElementById('modal-layer');
    if (layer) {
      layer.style.display = 'none';
      layer.style.pointerEvents = 'none';
      layer.innerHTML = '';
      layer.style.pointerEvents = '';
    }
    const cb = current && current.onClose;
    current = null;
    if (!silent && typeof cb === 'function') { try { cb(); } catch (e) { console.warn('[modal] onClose 异常', e); } }
    if (!silent) console.log('[modal] close');
  }

  function isOpen() { return !!current; }

  /** 当前弹窗是否允许「非按钮」关闭（遮罩 / ✕ / Esc） */
  function isDismissible() { return !current || current.dismissible !== false; }

  /** 二次确认（重置游戏、覆盖存档等有损操作统一走这里） */
  function confirmModal(title, body, onConfirm) {
    openModal({ title: title, body: body, onConfirm: onConfirm, confirmText: '确认', cancelText: '取消' });
  }

  FG.modal = { open: openModal, close: closeModal, isOpen: isOpen, isDismissible: isDismissible, confirm: confirmModal };
})(window.FG = window.FG || {});
