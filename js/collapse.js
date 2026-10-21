/* ============================================================
   collapse.js — 折叠/展开内容板块
   任何带 data-collapse 属性的 .section 都会被包上一层可折叠的
   body,并在 section-head 右上角注入折叠按钮;折叠状态按 section
   id 记忆在 localStorage,刷新后保持。
   零依赖,与 app.js / grid.js 互不干扰。
   ============================================================ */
(function () {
  'use strict';

  var KEY_PREFIX = 'eco-collapsed:';

  function directChild(sec, cls) {
    for (var i = 0; i < sec.children.length; i++) {
      if (sec.children[i].classList.contains(cls)) return sec.children[i];
    }
    return null;
  }

  /* move everything after .section-head into .section-body > .body-inner */
  function wrapBody(sec) {
    var head = sec.querySelector('.section-head');
    if (!head || directChild(sec, 'section-body')) return null;
    var body = document.createElement('div');
    body.className = 'section-body';
    var inner = document.createElement('div');
    inner.className = 'body-inner';
    while (head.nextSibling) inner.appendChild(head.nextSibling);
    body.appendChild(inner);
    sec.appendChild(body);
    return body;
  }

  function chevronSvg() {
    return '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">'
      + '<path d="M3.5 6L8 10.5L12.5 6" fill="none" stroke="currentColor" '
      + 'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function setCollapsed(sec, collapsed) {
    var btn = sec.querySelector('.collapse-btn');
    var body = directChild(sec, 'section-body');
    sec.classList.toggle('collapsed', collapsed);
    if (btn) {
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      btn.title = collapsed ? '展开本区' : '收起本区';
    }
    if (body) body.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
    try {
      var key = KEY_PREFIX + (sec.id || '');
      if (collapsed) localStorage.setItem(key, '1');
      else localStorage.removeItem(key);
    } catch (e) { /* storage disabled — state just is not remembered */ }
  }

  function init() {
    var secs = document.querySelectorAll('.section[data-collapse]');
    Array.prototype.forEach.call(secs, function (sec) {
      var head = sec.querySelector('.section-head');
      var body = wrapBody(sec);
      if (!head || !body) return;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'collapse-btn';
      btn.innerHTML = chevronSvg();
      btn.setAttribute('aria-expanded', 'true');
      btn.title = '收起本区';
      head.appendChild(btn);
      btn.addEventListener('click', function () {
        setCollapsed(sec, !sec.classList.contains('collapsed'));
      });

      try {
        if (localStorage.getItem(KEY_PREFIX + (sec.id || '')) === '1') {
          setCollapsed(sec, true);
        }
      } catch (e) { /* ignore */ }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
