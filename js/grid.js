/* ============================================================
   grid.js — 全页可交互点阵背景(纯 Canvas,零依赖)
   - 指针靠近:点点亮(强调色 + 放大)并轻微推开
   - 点击:扩散一圈涟漪,环经过的点被推亮
   - 滚动:极慢视差,背景比内容“远”一点
   - 主题:颜色读 CSS 变量,跟随系统深浅色
   - prefers-reduced-motion:只绘一帧静态点阵,不起动画
   ============================================================ */
(function () {
  'use strict';

  var canvas = document.getElementById('bg-grid');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var CFG = {
    spacing: 58,       /* 常规点距(CSS px)——用户反馈偏密,由 46 放大 */
    spacingWide: 72,   /* 宽屏点距 */
    wideBreak: 1800,   /* 宽屏断点 */
    radius: 190,       /* 指针影响半径 */
    push: 11,          /* 最大推开距离 */
    litScale: 1.9,     /* 点亮后的放大倍数 */
    margin: 140,       /* 点阵外扩(容纳视差与推开) */
    parallax: 0.02,    /* 滚动视差系数 */
    parallaxMax: 60,   /* 视差最大位移 */
    ease: 0.16,        /* 位移缓动系数 */
    rippleBand: 46,    /* 涟漪环宽 */
    ripplePush: 14,    /* 涟漪推开强度 */
    drag: 0.65,        /* 指针速度拖拽系数:点被"带"向移动方向 */
    vMax: 42,          /* 指针速度上限(px/帧),防止暴走 */
    vDecay: 0.90,      /* 速度衰减(停止移动后逐渐归零) */
    breath: 1.3,       /* 静止呼吸幅度(CSS px) */
    breathSpeed: 0.0011, /* 呼吸角速度 */
    dotAlpha: 0.45,    /* 静止点不透明度 —— 初值即浅色主题值;39 轮起真实取值来自
                          主题令牌 --grid-dot-alpha(浅 0.45 / 深 0.34):暗色主题
                          "背景再暗一点,点也可以暗一点",浅色保持 37 轮定值不动。
                          readColors 每次(初始化/切主题/系统偏好变化)读令牌覆写
                          此值;drawFrame 与 drawStatic 必须同源取 CFG.dotAlpha。
                          沿革:28 轮 0.62 → 37 轮 0.45(双主题同值)→ 39 轮深色 0.34 */
    linkDist: 96,      /* 强点亮两两连线的距离上限 */
    linkMin: 0.30,     /* 进入连线的最低点亮程度 */
    linkAlpha: 0.26    /* 连线基础不透明度 */
  };

  var mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var mqDark = window.matchMedia('(prefers-color-scheme: dark)');
  var reduceMotion = mqMotion.matches;

  var colors = { dim: '#8496ab', lit: '#2563eb' };
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    colors.dim = cs.getPropertyValue('--text-3').trim() || colors.dim;
    colors.lit = cs.getPropertyValue('--accent').trim() || colors.lit;
    /* 39 轮:静止点不透明度改读主题令牌 --grid-dot-alpha(浅 0.45 / 深 0.34)——
       暗色主题点阵再暗一档而不动浅色;令牌缺失或非法时保持 CFG 初值 */
    var a = parseFloat(cs.getPropertyValue('--grid-dot-alpha'));
    if (isFinite(a) && a > 0 && a <= 1) CFG.dotAlpha = a;
  }
  readColors();
  if (mqDark.addEventListener) {
    mqDark.addEventListener('change', function () {
      readColors();
      if (reduceMotion) drawStatic();
    });
  }

  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0, dots = [];
  var pointer = { x: -1e4, y: -1e4, active: false, vx: 0, vy: 0, t: 0 };
  var ripples = [];
  var scrollY = window.scrollY || 0;

  /* 负值:页面下滑时点阵比内容“慢”,形成远景视差 */
  function parallaxOffset() {
    var p = scrollY * CFG.parallax;
    return p > CFG.parallaxMax ? -CFG.parallaxMax : -p;
  }

  function build() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var sp = W > CFG.wideBreak ? CFG.spacingWide : CFG.spacing;
    var cols = Math.ceil((W + CFG.margin * 2) / sp);
    var rows = Math.ceil((H + CFG.margin * 2) / sp);
    var next = [];
    for (var i = 0; i <= cols; i++) {
      for (var j = 0; j <= rows; j++) {
        next.push({
          bx: i * sp - CFG.margin, by: j * sp - CFG.margin,
          dx: 0, dy: 0, tx: 0, ty: 0, t: 0,
          ph: Math.random() * 6.2832   /* 呼吸相位,让背景不完全静止 */
        });
      }
    }
    dots = next;
  }

  /* 目标位移与点亮程度:指针斥力 + 涟漪环 */
  function stepDot(d, py) {
    var tx = 0, ty = 0, t = 0;
    var x = d.bx, y = d.by + py;
    if (pointer.active) {
      var dx = x - pointer.x, dy = y - pointer.y;
      var d2 = dx * dx + dy * dy;
      if (d2 < CFG.radius * CFG.radius) {
        var dist = Math.sqrt(d2) || 1e-4;
        var f = 1 - dist / CFG.radius;
        var push = CFG.push * f * f;
        tx += (dx / dist) * push;
        ty += (dy / dist) * push;
        /* 速度拖拽:指针划过时把附近的点往移动方向带一点,
           停下后速度衰减,点慢慢回到自己的格子 */
        var drag = f * f * CFG.drag;
        tx += pointer.vx * drag;
        ty += pointer.vy * drag;
        t = f;
      }
    }
    for (var r = 0; r < ripples.length; r++) {
      var rp = ripples[r];
      var rdx = x - rp.x, rdy = y - rp.y;
      var rd = Math.sqrt(rdx * rdx + rdy * rdy) || 1e-4;
      var delta = Math.abs(rd - rp.r);
      if (delta < CFG.rippleBand) {
        var rf = (1 - delta / CFG.rippleBand) * rp.power;
        tx += (rdx / rd) * rf * CFG.ripplePush;
        ty += (rdy / rd) * rf * CFG.ripplePush;
        if (rf * 0.9 > t) t = rf * 0.9;
      }
    }
    d.tx = tx;
    d.ty = ty;
    d.t = t;
  }

  function drawFrame(now) {
    var py = parallaxOffset();
    /* 指针速度衰减:停下不动时拖拽效果慢慢消失 */
    pointer.vx *= CFG.vDecay;
    pointer.vy *= CFG.vDecay;
    if (Math.abs(pointer.vx) < 0.02) pointer.vx = 0;
    if (Math.abs(pointer.vy) < 0.02) pointer.vy = 0;
    ctx.clearRect(0, 0, W, H);
    var rBase = DPR > 1 ? 2.6 : 2.4;

    /* 普通点同色同透明度,合并进一次填充 */
    ctx.globalAlpha = CFG.dotAlpha;
    ctx.fillStyle = colors.dim;
    ctx.beginPath();
    var lit = [], conn = [];
    for (var i = 0; i < dots.length; i++) {
      var d = dots[i];
      stepDot(d, py);
      d.dx += (d.tx - d.dx) * CFG.ease;
      d.dy += (d.ty - d.dy) * CFG.ease;
      /* 呼吸:极慢的正弦漂移,与斥力位移叠加,互不干扰 */
      var br = Math.sin(now * CFG.breathSpeed + d.ph) * CFG.breath;
      var x = d.bx + d.dx, y = d.by + py + d.dy + br;
      if (d.t > 0.06) {
        lit.push({ x: x, y: y, t: d.t });
        if (d.t >= CFG.linkMin) conn.push({ x: x, y: y, t: d.t });
      } else {
        ctx.moveTo(x + rBase, y);   /* 避免子路径间连线 */
        ctx.arc(x, y, rBase, 0, 6.2832);
      }
    }
    ctx.fill();

    /* 点亮的点:强调色 + 放大 + 不透明度随接近程度回升 */
    for (var k = 0; k < lit.length; k++) {
      var p = lit[k];
      ctx.globalAlpha = Math.min(0.35 + p.t * 0.6, 1);
      ctx.fillStyle = colors.lit;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rBase * (1 + p.t * (CFG.litScale - 1)), 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* 强点之间连细线:指针周围浮现一张动态网络,
       强度越高的点线越实,离开后随回位一起消散 */
    if (conn.length > 1) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = colors.lit;
      for (var a1 = 0; a1 < conn.length; a1++) {
        for (var b1 = a1 + 1; b1 < conn.length; b1++) {
          var ex = conn[a1].x - conn[b1].x, ey = conn[a1].y - conn[b1].y;
          var ed = Math.sqrt(ex * ex + ey * ey);
          if (ed >= CFG.linkDist) continue;
          var la = (1 - ed / CFG.linkDist) * CFG.linkAlpha *
                   Math.min(conn[a1].t, conn[b1].t);
          if (la < 0.02) continue;
          ctx.globalAlpha = la;
          ctx.beginPath();
          ctx.moveTo(conn[a1].x, conn[a1].y);
          ctx.lineTo(conn[b1].x, conn[b1].y);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    /* 涟漪环本身:一圈极淡的线,让"点击激发"看得见 */
    for (var r2 = 0; r2 < ripples.length; r2++) {
      var rp2 = ripples[r2];
      ctx.globalAlpha = rp2.power * 0.16;
      ctx.strokeStyle = colors.lit;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(rp2.x, rp2.y, rp2.r, 0, 6.2832);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    /* 推进涟漪生命周期 */
    for (var r = ripples.length - 1; r >= 0; r--) {
      var rp = ripples[r];
      rp.r += 7;
      rp.power *= 0.94;
      if (rp.power < 0.02 || rp.r > Math.max(W, H) * 1.2) ripples.splice(r, 1);
    }
  }

  function drawStatic() {
    var py = parallaxOffset();
    var rBase = DPR > 1 ? 2.6 : 2.4;   /* 与 drawFrame 保持一致 */
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = CFG.dotAlpha;    /* 与 drawFrame 同源,静态/动画不能有色差 */
    ctx.fillStyle = colors.dim;
    ctx.beginPath();
    for (var i = 0; i < dots.length; i++) {
      var d = dots[i];
      ctx.moveTo(d.bx + rBase, d.by + py);
      ctx.arc(d.bx, d.by + py, rBase, 0, 6.2832);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  var running = false;
  function loop(now) {
    if (!running) return;
    if (!document.hidden) drawFrame(now || performance.now());
    requestAnimationFrame(loop);
  }
  function start() {
    if (running || reduceMotion) return;
    running = true;
    requestAnimationFrame(loop);
  }
  function stop() { running = false; }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop();
    else start();
  });

  window.addEventListener('pointermove', function (e) {
    var now = performance.now();
    var dt = now - pointer.t;
    if (dt > 0 && pointer.active) {
      var vx = (e.clientX - pointer.x) / dt * 16;
      var vy = (e.clientY - pointer.y) / dt * 16;
      /* 指数平滑,避免单次抖动把点甩出去 */
      pointer.vx = pointer.vx * 0.6 + Math.max(-CFG.vMax, Math.min(CFG.vMax, vx)) * 0.4;
      pointer.vy = pointer.vy * 0.6 + Math.max(-CFG.vMax, Math.min(CFG.vMax, vy)) * 0.4;
    }
    pointer.t = now;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = true;
  }, { passive: true });

  window.addEventListener('pointerdown', function (e) {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = true;
    if (!reduceMotion) ripples.push({ x: e.clientX, y: e.clientY, r: 0, power: 1 });
  }, { passive: true });

  /* 触摸抬起 / 指针取消 / 鼠标离开文档 / 窗口失焦:点阵回位 */
  window.addEventListener('pointerup', function (e) {
    if (e.pointerType === 'touch') pointer.active = false;
  }, { passive: true });
  window.addEventListener('pointercancel', function () { pointer.active = false; }, { passive: true });
  document.addEventListener('mouseleave', function () { pointer.active = false; });
  window.addEventListener('blur', function () { pointer.active = false; });

  window.addEventListener('scroll', function () {
    scrollY = window.scrollY || 0;
  }, { passive: true });

  var resizeRaf = 0;
  window.addEventListener('resize', function () {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(function () {
      resizeRaf = 0;
      build();
      if (reduceMotion) drawStatic();
    });
  });

  build();
  if (reduceMotion) drawStatic();
  else start();

  /* 回归测试读取内部状态的调试句柄。
     38 轮:colors 暴露给 smoke 断言切主题后点阵取色跟着变;recolor 供
     theme.js 在切换后调用(与 mqDark 监听器同一动作:重新读计算样式,
     reduceMotion 下重画静态帧)。 */
  window.__bgGrid = {
    get dots() { return dots; },
    pointer: pointer,
    ripples: ripples,
    config: CFG,
    colors: colors,
    recolor: function () {
      readColors();
      if (reduceMotion) drawStatic();
    }
  };
})();
