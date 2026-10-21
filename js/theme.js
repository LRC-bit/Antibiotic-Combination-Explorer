/* 亮/暗主题切换(38 轮)。
   这个文件必须放在 <head> 里且不加 defer:阻塞执行,在首帧绘制前就把
   html[data-theme] 定好,否则页面会先按系统主题闪一帧再跳(FOUC 暗纹)。
   选择存 localStorage 的 'ace-theme',只接受 'dark'/'light' 两个值;
   没有有效记录时删掉 data-theme,交回 prefers-color-scheme 媒体查询
   (style.css 里两块系统暗色规则都带 html:not([data-theme]) 门控)。
   grid.js 在 head 之后才跑(defer),所以这里调 __bgGrid.recolor 前必须
   判存在;首帧的取色由 grid.js 自己的 readColors 完成,不受影响。 */
(function () {
  var KEY = 'ace-theme';

  function stored() {
    try {
      var v = window.localStorage.getItem(KEY);
      return (v === 'dark' || v === 'light') ? v : null;
    } catch (e) {
      return null;   /* 隐私模式等读不了 localStorage:静默跟随系统 */
    }
  }

  function apply(v) {
    if (v) document.documentElement.dataset.theme = v;
    else document.documentElement.removeAttribute('data-theme');
    var g = window.__bgGrid;
    if (g && typeof g.recolor === 'function') g.recolor();
  }

  /* 首帧前定调(同步,无副作用依赖 DOM) */
  var v0 = stored();
  if (v0) document.documentElement.dataset.theme = v0;

  function bind() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var cur = document.documentElement.dataset.theme;
      if (cur !== 'dark' && cur !== 'light') {
        cur = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      var next = cur === 'dark' ? 'light' : 'dark';
      try { window.localStorage.setItem(KEY, next); } catch (e) {}
      apply(next);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
