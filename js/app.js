/* ============================================================
   app.js — Combination Explorer
   Read -> Lookup -> Display.  No scientific computation.
   ============================================================ */

/* ------------------------------------------------------------
   Searchable drug picker
   ------------------------------------------------------------ */
class DrugPicker {
  constructor(root, onChange) {
    this.root = root;
    this.input = root.querySelector('input');
    this.dropdown = root.querySelector('.dropdown');
    this.value = null;
    this.hl = -1;
    this.items = [];
    this.onChange = onChange || (() => {});

    /* Re-opening after a selection shows the full list again (current choice
       marked), instead of only the selected drug itself. */
    this.input.addEventListener('focus', () => {
      this.input.select();
      this.open(true);
    });
    this.input.addEventListener('input', () => {
      this.value = null;
      this.resolve();          // accept an exactly typed drug name without clicking
      this.open();
      this.onChange();
    });
    this.input.addEventListener('blur', () => { this.resolve(); this.onChange(); });
    this.input.addEventListener('keydown', e => this.key(e));
    document.addEventListener('click', e => {
      if (!this.root.contains(e.target)) this.close();
    });
    /* fixed 定位的下拉框不随页面滚动移动,打开期间持续跟随输入框 */
    this._sync = () => { if (this.dropdown.classList.contains('open')) this.place(); };
    window.addEventListener('scroll', this._sync, { passive: true });
    window.addEventListener('resize', this._sync);
  }

  /* 选择区保持英文(第 42 轮,用户「药物选择保持英文,药物库中英文支持」):
     只按英文 id / 英文名 / 同义词匹配 —— 中文名与 display_name 不参与,
     与 40 轮补中文名之前的口径一致。药物库(#lib-search)仍是中英双语。 */
  matches(q) {
    q = q.trim().toLowerCase();
    if (!q) return Store.drugs;
    return Store.drugs.filter(d => {
      const hay = [d.drug_id, d.drug_name, d.synonyms]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  /* True when the input text is exactly the current selection (not a query) */
  textIsSelection() {
    if (!this.value) return false;
    const t = this.input.value.trim().toUpperCase();
    if (!t) return false;
    const hit = Store.drugById.get(t) ||
      Store.drugs.find(d => (d.drug_name || '').toUpperCase() === t);
    return !!hit && hit.drug_id === this.value;
  }

  open(browse) {
    const q = (browse && this.textIsSelection()) ? '' : this.input.value;
    this.items = this.matches(q).slice(0, 60);
    this.hl = -1;
    if (!this.items.length) {
      this.dropdown.innerHTML = '<div class="dropdown-empty">没有匹配的药物</div>';
    } else {
      this.dropdown.innerHTML = this.items.map((d, i) => {
        /* 第 42 轮:选择区纯英文 —— 主标即 drug_id(组合键),不带中文副标 */
        const sel = this.value === d.drug_id;
        return `<div class="dropdown-item${sel ? ' selected' : ''}" data-i="${i}"${sel ? ' title="当前选择"' : ''}>
          <span>${escapeHtml(d.drug_id)}</span></div>`;
      }).join('');
      this.dropdown.querySelectorAll('.dropdown-item').forEach(el => {
        el.addEventListener('mousedown', e => {
          e.preventDefault();
          this.select(this.items[+el.dataset.i].drug_id);
        });
      });
    }
    this.dropdown.classList.add('open');
    this.place();
  }

  /* 下拉框是 position:fixed(传送门式),不会被折叠板块的 overflow:hidden
     裁剪;这里按输入框的视口坐标摆放,下方空间不足时自动翻到上方。 */
  place() {
    const dd = this.dropdown;
    const r = this.input.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const gap = 6, margin = 12;
    const below = vh - r.bottom - gap - margin;
    const above = r.top - gap - margin;
    const useBelow = below >= 150 || below >= above;
    const h = Math.max(80, Math.min(300, useBelow ? below : above, vh - 2 * margin));
    let top = useBelow ? r.bottom + gap : r.top - gap - h;
    /* 输入框自身不在视口内时,也把面板钳制在视口里 */
    top = Math.max(margin, Math.min(top, vh - h - margin));
    dd.style.top = Math.round(top) + 'px';
    dd.style.left = Math.round(r.left) + 'px';
    dd.style.width = Math.round(r.width) + 'px';
    dd.style.maxHeight = Math.round(h) + 'px';
  }

  close() { this.dropdown.classList.remove('open'); }

  key(e) {
    if (!this.dropdown.classList.contains('open')) { if (e.key === 'ArrowDown') this.open(); return; }
    const els = this.dropdown.querySelectorAll('.dropdown-item');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.hl = e.key === 'ArrowDown'
        ? Math.min(this.hl + 1, els.length - 1)
        : Math.max(this.hl - 1, 0);
      els.forEach((el, i) => el.classList.toggle('hl', i === this.hl));
      if (els[this.hl]) els[this.hl].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      /* 重新打开的完整列表上直接回车:保留当前选择,而不是误选列表第一个 */
      if (this.hl < 0 && this.value && this.textIsSelection()) {
        this.close();
        return;
      }
      const pick = this.items[this.hl >= 0 ? this.hl : 0];
      if (pick) this.select(pick.drug_id);
    } else if (e.key === 'Escape') {
      this.close();
    }
  }

  select(id) {
    this.value = id;
    this.input.value = id;
    this.close();
    this.onChange();
  }

  /* Accept a fully typed drug name (case-insensitive) without requiring a
     click on the dropdown. Partial text still needs a dropdown pick.
     English-only since round 42 (the picker stays English; the drug library
     below is the place for bilingual lookup). */
  resolve() {
    if (this.value) return this.value;
    const t = this.input.value.trim().toUpperCase();
    if (!t) return null;
    const hit = Store.drugById.get(t) ||
      Store.drugs.find(d => (d.drug_name || '').toUpperCase() === t);
    if (hit) this.value = hit.drug_id;
    return this.value;
  }

  clear() { this.value = null; this.input.value = ''; }
}

/* ------------------------------------------------------------
   Boot
   ------------------------------------------------------------ */
let pickerA, pickerB;
const bigLoadState = { started: false, done: false, failed: false };

document.addEventListener('DOMContentLoaded', async () => {
  const statusEl = document.getElementById('boot-status');
  try {
    await Store.init();
  } catch (err) {
    statusEl.innerHTML = `<div class="empty-box">数据加载失败。<br>
      <span style="font-size:13px">${escapeHtml(err.message)}<br>
      请通过 HTTP 访问本页面(见「方法说明」页)—— 浏览器禁止 file:// 下的数据读取。</span></div>`;
    return;
  }
  statusEl.style.display = 'none';
  document.getElementById('explorer').style.display = '';

  pickerA = new DrugPicker(document.getElementById('picker-a'), updateExploreButton);
  pickerB = new DrugPicker(document.getElementById('picker-b'), updateExploreButton);
  document.getElementById('explore-btn').addEventListener('click', explore);
  document.getElementById('reset-btn').addEventListener('click', resetSelection);
  initRxTabs();
  initLibrary();   /* the drug library now lives in the left rail */

  // A slot named in the link (?a=DRUG&b=DRUG) wins; any slot the link does not
  // name is filled from what the Drug Library remembered, so a drug can be
  // assigned to one slot on the library page and the other one later.
  const p = new URLSearchParams(location.search);
  const slotFrom = (param, slot) => {
    const id = p.get(param);
    if (id) return Store.drug(id) ? id : null;      // an explicit link is taken as-is
    const remembered = Selection.get(slot);
    return remembered && Store.drug(remembered) ? remembered : null;
  };
  const a = slotFrom('a', 'a'), b = slotFrom('b', 'b');
  if (a) pickerA.select(a);
  if (b) pickerB.select(b);
  updateExploreButton();
  if (pickerA.value && pickerB.value) explore();
});

/* Drop both slots: clears the pickers, the remembered choice and the results. */
function resetSelection() {
  calcSeq++;   // an in-flight evaluation overlay stops updating itself
  pickerA.clear();
  pickerB.clear();
  Selection.clear();
  ['result-section', 'rewiring-section', 'subsystem-section', 'shap-section']
    .forEach(id => { document.getElementById(id).style.display = 'none'; });
  const empty = document.getElementById('result-empty');
  if (empty) empty.style.display = '';
  history.replaceState(null, '', location.pathname);
  updateExploreButton();
}

function updateExploreButton() {
  const btn = document.getElementById('explore-btn');
  const warn = document.getElementById('pick-warn');
  const ok = pickerA.value && pickerB.value && pickerA.value !== pickerB.value;
  btn.disabled = !ok;

  // keep the Drug Library in step with whatever is selected here
  Selection.set('a', pickerA.value);
  Selection.set('b', pickerB.value);
  document.getElementById('reset-btn').style.display =
    (pickerA.value || pickerB.value || pickerA.input.value.trim() || pickerB.input.value.trim())
      ? '' : 'none';

  let msg = '';
  if (pickerA.value && pickerB.value && pickerA.value === pickerB.value) {
    msg = '请选择两种不同的药物。';
  } else if ((pickerA.input.value.trim() && !pickerA.value) ||
             (pickerB.input.value.trim() && !pickerB.value)) {
    msg = '请从下拉列表中选择一种药物(或输入其完整名称)。';
  }
  warn.textContent = msg;
  warn.style.display = msg ? '' : 'none';

  /* keep the library rows' A/B marks in step with the two pickers */
  if (libReady) syncLibraryCards();
}

/* ------------------------------------------------------------
   Explore — the evaluation flow
   Clicking 评估组合 runs a short on-screen evaluation sequence
   (model load -> index load -> reaction rewiring -> subsystem
   aggregation -> SHAP ranking -> classification verdict) whose
   pacing doubles as the progress feedback for the one-time load
   of the large evaluation tables.
   ------------------------------------------------------------ */
let calcSeq = 0;   // invalidates an in-flight evaluation (reset / new pair)

function calcSteps() {
  const nRx = Store.reactions.size || 2583;
  return [
    `载入代谢模型 iJO1366(${nRx.toLocaleString('en-US')} 个反应 · 39 个子系统)`,
    '药物扰动信号捕捉',
    '通量结果特征优化',
    '模型推理',
    '读取反应级代谢重编(Top 10 上调 / 下调)',
    '聚合子系统级效应(39 个子系统)',
    '计算模型关联特征(SHAP,Top 10)',
    '汇总三分类判定(协同 / 中性 / 拮抗)',
  ];
}

/* Renders the evaluation overlay and resolves once the sequence ends.
   Real work takes an uneven amount of time, so every run draws fresh
   random holds per step (the heavier steps longer), the bar creeps in
   small irregular nudges, and both the spin-up and the wrap-up pause
   briefly — no metronome beat, no equal quarters. A superseded run
   (reset / new pair) stops updating. */
function runCalc(steps, pairLabel, seq) {
  return new Promise(resolve => {
    const card = document.getElementById('result-card');
    card.innerHTML = `
      <div class="calc">
        <div class="calc-head"><span class="calc-dot"></span>正在评估组合<b>${escapeHtml(pairLabel)}</b></div>
        <div class="calc-steps">
          ${steps.map((s, i) => `
            <div class="calc-step" data-i="${i}">
              <span class="calc-mark"></span><span class="calc-txt">${escapeHtml(s)}</span>
            </div>`).join('')}
        </div>
        <div class="calc-bar"><div class="calc-bar-fill"></div></div>
      </div>`;
    const els = Array.from(card.querySelectorAll('.calc-step'));
    const bar = card.querySelector('.calc-bar-fill');

    const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
    // fresh random hold per step each run; model inference is the long pole,
    // the three large tables (reaction effects, subsystem effects, SHAP) sit
    // in the middle, and the signal/context steps plus the verdict are quick.
    // 44 轮:用户重排为 8 步流程,要求"模型推理稍慢、其他维持或略快"——权重
    // [.7,.5,.5,1.6,1.35,1.2,1.05,.55],基准 rnd(750,1050)ms,推理 1200-1680ms
    // 全场最重;45 轮:用户"模型推理不变,其余再快点"——基准不变(推理 = 基准×1.6
    // 不变),其余 7 步权重下调:载入 .7→.45、捕捉 .5→.35、特征优化 .5→.35、反应级
    // 1.35→.95、子系统 1.2→.85、SHAP 1.05→.75、判定 .55→.4。整轮约 4.3-6.4s。
    const weight = [0.45, 0.35, 0.35, 1.6, 0.95, 0.85, 0.75, 0.4];
    const holds = steps.map((_, k) => Math.round(rnd(750, 1050) * (weight[k] || 1)));
    els.forEach((el, k) => { el.dataset.dur = holds[k]; });  // pacing, for the smoke test

    const finish = () => {
      els.forEach(el => { el.classList.remove('active'); el.classList.add('done'); });
      bar.style.width = '100%';
      setTimeout(resolve, 500 + Math.random() * 400);   // 43 轮:300+rnd(300) → 500+rnd(400)
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }

    let i = 0, shown = 0, running = true;
    const target = () => ((i + 1) / steps.length) * 100;

    // the bar closes a random fraction of the remaining gap at irregular
    // moments — it crawls like a real progress bar instead of stepping
    // through equal quarters
    const creep = () => {
      if (!running || seq !== calcSeq) return;
      const tgt = target();
      if (shown < tgt) {
        shown = Math.min(tgt, shown + (tgt - shown) * rnd(0.10, 0.30) + rnd(0.3, 1.4));
        bar.style.width = shown.toFixed(1) + '%';
      }
      if (running && seq === calcSeq) setTimeout(creep, rnd(110, 300));  // 43 轮:rnd(90,260) → rnd(110,300)
    };

    const advance = () => {
      if (seq !== calcSeq) { running = false; return; }   // superseded
      els[i].classList.remove('active');
      els[i].classList.add('done');
      i++;
      if (i >= steps.length) { running = false; finish(); return; }
      els[i].classList.add('active');
      setTimeout(advance, holds[i]);
    };

    // short irregular spin-up before the first step lights up
    setTimeout(() => {
      if (seq !== calcSeq) return;
      els[0].classList.add('active');
      creep();
      setTimeout(advance, holds[0]);
    }, rnd(300, 600));   // 43 轮:rnd(180,420) → rnd(300,600)
  });
}

async function explore() {
  pickerA.resolve(); pickerB.resolve();
  const a = pickerA.value, b = pickerB.value;
  if (!a || !b || a === b) { updateExploreButton(); return; }

  const seq = ++calcSeq;   // any earlier in-flight evaluation is now stale
  document.getElementById('result-section').style.display = '';
  const empty = document.getElementById('result-empty');
  if (empty) empty.style.display = 'none';
  ['rewiring-section', 'subsystem-section', 'shap-section'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });

  const comboId = combinationId(a, b);
  const res = Store.result(comboId);
  if (!res) {
    document.getElementById('result-card').innerHTML =
      `<div class="empty-box">暂无该组合的结果。</div>`;
    return;
  }

  // the evaluation overlay paces the shard load for this combination
  const da = Store.drug(a), db = Store.drug(b);
  const pairLabel = `${drugDisplay(da) || a} × ${drugDisplay(db) || b}`;
  const calcP = runCalc(calcSteps(), pairLabel, seq);
  let bigErr = null;
  try { await Store.loadCombo(comboId); } catch (err) { bigErr = err; }
  await calcP;
  if (seq !== calcSeq) return;   // superseded by reset / a newer pair

  if (bigErr) {
    document.getElementById('result-card').innerHTML =
      `<div class="empty-box">评估数据加载失败。<br>
       <span style="font-size:13px">${escapeHtml(bigErr.message)}</span></div>`;
    return;
  }

  history.replaceState(null, '', `?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);

  renderResult(res);
  renderRewiring(comboId);
  renderSubsystems(comboId);
  renderShap(comboId);

  /* 单列布局里结果在药物库下方,不滚一下会以为没反应 */
  if (matchMedia('(max-width: 1020px)').matches) {
    const sec = document.getElementById('result-section');
    if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/* ------------------------------------------------------------
   1. Combination Result  (highest visual priority)
   ------------------------------------------------------------ */
function renderResult(res) {
  const cls = res.result;
  document.getElementById('result-card').innerHTML = `
    <div class="result-card fade glow-${cls}">
      <div class="result-label">组 合 结 果</div>
      <div class="result-value r-${cls}">${escapeHtml(resultLabel(cls))}</div>
      <div class="result-pair">
        <strong>${escapeHtml(drugDisplay(Store.drug(res.drug_a)) || res.drug_a)}</strong><span class="x">×</span><strong>${escapeHtml(drugDisplay(Store.drug(res.drug_b)) || res.drug_b)}</strong>
      </div>
    </div>`;
}

/* ------------------------------------------------------------
   2. Reaction-level Metabolic Rewiring
   ------------------------------------------------------------ */
let rxMode = 'top_increased';
let currentComboId = null;

/* Bind the rewiring tabs ONCE, not on every exploration —
   re-binding on each explore would stack duplicate listeners. */
function initRxTabs() {
  document.querySelectorAll('#rx-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      rxMode = tab.dataset.mode;
      document.querySelectorAll('#rx-tabs .tab').forEach(t =>
        t.classList.toggle('active', t === tab));
      const fx = currentComboId && Store.reactionEffects(currentComboId);
      if (fx) drawReactionTable(fx);
    });
  });
}

function renderRewiring(comboId) {
  currentComboId = comboId;
  const fx = Store.reactionEffects(comboId);
  if (!fx) return;
  document.getElementById('rewiring-section').style.display = '';
  document.querySelectorAll('#rx-tabs .tab').forEach(t =>
    t.classList.toggle('active', t.dataset.mode === rxMode));
  drawReactionTable(fx);
}

function drawReactionTable(fx) {
  const rows = fx[rxMode] || [];
  const body = document.getElementById('rx-body');
  if (!rows.length) {
    body.innerHTML = `<div class="empty-box">该类别下暂无反应。</div>`;
    return;
  }
  const max = maxAbs(rows);
  body.innerHTML = rows.map((r, i) => `
    <div class="chart-row" data-rx="${escapeHtml(r.reaction_id)}" style="--i:${i}">
      <div class="chart-label">
        <div class="rx-name">${escapeHtml(r.reaction_name || r.reaction_id)}</div>
        <div class="rx-id">${escapeHtml(r.reaction_id)} · ${escapeHtml(subsystemLabel(r.subsystem))}</div>
      </div>
      <div class="bar-track"><div class="bar-mid"></div>
        <div class="bar-fill ${r.effect > 0 ? 'pos' : 'neg'}"
             style="${barStyle(r.effect, max)}"></div></div>
      <div class="eff ${r.effect > 0 ? 'pos' : 'neg'}">${fmtEffect(r.effect)}</div>
    </div>`).join('');

  body.querySelectorAll('.chart-row').forEach(el => {
    el.addEventListener('click', () => showReactionDetail(el.dataset.rx, fx));
  });
  growBars(body);
}

function maxAbs(rows) {
  return Math.max(...rows.map(r => Math.abs(r.effect)), 1e-9);
}

function barStyle(v, max) {
  const pct = Math.min(Math.abs(v) / max * 50, 50);
  return v > 0
    ? `left:50%;width:${pct}%`
    : `left:${50 - pct}%;width:${pct}%`;
}

/* Bars grow from zero to their target width just after render, so each
   evaluation draws its charts instead of pasting them in. */
function growBars(container) {
  const fills = container.querySelectorAll('.bar-fill');
  fills.forEach(f => {
    const m = /width:\s*([\d.]+)%/.exec(f.getAttribute('style') || '');
    if (!m) return;
    f.dataset.w = m[1] + '%';
    f.style.width = '0%';
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fills.forEach(f => { if (f.dataset.w) f.style.width = f.dataset.w; });
  }));
}

function showReactionDetail(rid, fx) {
  const panel = document.getElementById('rx-detail');
  const hit = ['top_increased', 'top_decreased', 'top_absolute']
    .flatMap(k => fx[k] || []).find(r => r.reaction_id === rid);
  const ont = Store.reactions.get(rid);
  panel.innerHTML = `
    <dl class="kv">
      <dt>反应</dt><dd class="plain">${escapeHtml(hit ? hit.reaction_name : Store.reactionName(rid))}</dd>
      <dt>反应编号</dt><dd>${escapeHtml(rid)}</dd>
      <dt>所属子系统</dt><dd class="plain">${escapeHtml(subsystemLabel(hit ? hit.subsystem : Store.reactionSubsystem(rid)))}</dd>
      <dt>代谢效应</dt>
      <dd class="${hit && hit.effect > 0 ? 'eff pos' : 'eff neg'}">
        ${hit ? fmtEffect(hit.effect) : '未进入 Top 列表'}</dd>
      <dt>反应序号</dt><dd>${ont ? ont.position : '—'}</dd>
    </dl>
    <p style="margin:12px 0 0;font-size:13px;color:var(--text-3)">
      代谢效应指该反应的非加性通量变化(组合通量减去两种单药通量)。
    </p>`;
  panel.classList.add('open');
}

/* ------------------------------------------------------------
   3. Subsystem-level Metabolic Rewiring
   ------------------------------------------------------------ */
const SUBS_DEFAULT = 12;
let subsShown = SUBS_DEFAULT;

function renderSubsystems(comboId) {
  const pe = Store.pathwayEffects(comboId);
  if (!pe) return;
  document.getElementById('subsystem-section').style.display = '';

  const arr = Store.pathwaySubsystems.map((name, i) => ({
    name,
    agg: pe.aggregate_effect[i],
    mean: pe.mean_effect[i],
    meanAbs: pe.mean_abs_effect[i],
    sumAbs: pe.sum_abs_effect[i],
    count: Store.pathwayReactionCount[i],
  })).sort((x, y) => Math.abs(y.agg) - Math.abs(x.agg));

  drawSubsystemBars(arr.slice(0, subsShown), Math.abs(arr[0].agg) || 1, arr, comboId);
  renderRadar(arr, Math.abs(arr[0].agg) || 1);

  const more = document.getElementById('subs-more');
  more.style.display = '';
  if (subsShown < arr.length) {
    more.textContent = `展开全部 ${arr.length} 个子系统`;
    more.onclick = () => {
      subsShown = arr.length;
      renderSubsystems(comboId);
    };
  } else {
    more.textContent = `收起,仅看前 ${SUBS_DEFAULT} 个`;
    more.onclick = () => {
      subsShown = SUBS_DEFAULT;
      renderSubsystems(comboId);
    };
  }
}

function drawSubsystemBars(rows, max, all, comboId) {
  const box = document.getElementById('subs-bars');
  box.innerHTML = rows.map((r, i) => `
    <div class="bar-row" data-sub="${escapeHtml(r.name)}" style="--i:${i}">
      <div class="bar-name" title="${escapeHtml(r.name)}">${escapeHtml(subsystemLabel(r.name))}</div>
      <div class="bar-track"><div class="bar-mid"></div>
        <div class="bar-fill ${r.agg > 0 ? 'pos' : 'neg'}" style="${barStyle(r.agg, max)}"></div>
      </div>
      <div class="bar-val">${fmtEffect(r.agg, 2)}</div>
    </div>`).join('');

  box.querySelectorAll('.bar-row').forEach(el => {
    el.addEventListener('click', () =>
      showSubsystemDetail(el.dataset.sub, all.find(r => r.name === el.dataset.sub), comboId));
  });
  growBars(box);
}

/* ------------------------------------------------------------
   4b. Subsystem radar — top-8 subsystems on a diverging polar plot.
   The zero plane is a regular octagon (not a point) at half the radar
   radius — big enough that no effect can cross the centre. Every
   spoke starts on the octagon's rim: positive effects run outward,
   negative effects point inward toward the centre but always stop
   before it. Effect sizes are measured from the zero plane in both
   directions (the largest lands on the outer ring). One dashed
   polygon follows the signed endpoints — bulging out on positive
   axes, dipping toward the centre on negative ones.
   ------------------------------------------------------------ */
function renderRadar(arr, max) {
  const svg = document.getElementById('subs-radar');
  if (!svg) return;
  const N = Math.min(8, arr.length);
  if (!N) { svg.innerHTML = ''; return; }
  const top = arr.slice(0, N);
  const cx = 240, cy = 240, R = 138, LBL_R = 168;
  const ZP = R * 0.5;             // zero-plane octagon circumradius (69px):
                                  // half the radius, so even a full-scale
                                  // negative cannot reach or cross the centre
  const SPAN = R - ZP;            // effect sizes are measured from the zero plane
  const pt = (i, r) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / N;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a), Math.cos(a), Math.sin(a)];
  };
  const ring = r => {
    const pts = [];
    for (let i = 0; i < N; i++) {
      const p = pt(i, r);
      pts.push(p[0].toFixed(1) + ',' + p[1].toFixed(1));
    }
    return pts.join(' ');
  };
  // effect size as a length measured from the zero-plane rim
  const mag = r => Math.min(Math.abs(r.agg) / max, 1) * SPAN;
  // every spoke leaves the rim vertex on its own axis: positive effects
  // run outward, negative effects point inward toward the centre — and,
  // since SPAN <= ZP, can never pass it
  const rimPt = (r, i) => pt(i, ZP);
  const endPt = (r, i) => pt(i, r.agg >= 0 ? ZP + mag(r) : ZP - mag(r));

  let s = '';
  // outer grid rings: 25/50/75/100% of the effect span above the zero
  // plane (the positive range)
  [0.25, 0.5, 0.75, 1].forEach(f =>
    s += `<polygon class="ring" points="${ring(ZP + SPAN * f)}"/>`);
  // axis stubs emanate from the zero-plane octagon out to the axis tip
  for (let i = 0; i < N; i++) {
    const a = pt(i, R), z = pt(i, ZP);
    s += `<line class="axis" x1="${z[0].toFixed(1)}" y1="${z[1].toFixed(1)}"`
      + ` x2="${a[0].toFixed(1)}" y2="${a[1].toFixed(1)}"/>`;
  }
  // the zero plane itself: a regular octagon; positive spokes leave it
  // outward, negative spokes point from it toward the centre
  s += `<polygon class="zeroplane" points="${ring(ZP)}"/>`;
  // inner grid rings (the negative range): drawn after the octagon so its
  // fill does not swallow them; the 100% inner ring would collapse to
  // the centre, so it is not drawn
  [0.25, 0.5, 0.75].forEach(f =>
    s += `<polygon class="ring" points="${ring(ZP - SPAN * f)}"/>`);
  // signed data envelope — the polygon through every spoke endpoint
  // (positive outward, negative inward toward the centre), so the dashed
  // silhouette follows the signed effects; drawn after the octagon so
  // its inward dips stay visible
  s += `<polygon class="outline" points="${top.map((r, i) => {
    const p = endPt(r, i);
    return p[0].toFixed(1) + ',' + p[1].toFixed(1);
  }).join(' ')}"/>`;

  top.forEach((r, i) => {
    const p = endPt(r, i), z = rimPt(r, i), lp = pt(i, LBL_R);
    const cls = r.agg >= 0 ? 'pos' : 'neg';
    const name = subsystemLabel(r.name);
    const short = name.length > 9 ? name.slice(0, 9) + '…' : name;
    // every label is centre-anchored: no start/end overflow past the viewBox
    s += `<g class="hit" data-sub="${escapeHtml(r.name)}">`
      + `<title>${escapeHtml(name)}: ${fmtEffect(r.agg, 2)}</title>`
      + `<line class="spoke ${cls}" x1="${z[0].toFixed(1)}" y1="${z[1].toFixed(1)}" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}"/>`
      + `<circle class="dot ${cls}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4.2"/>`
      + `<text class="lbl" x="${lp[0].toFixed(1)}" y="${(lp[1] + 4).toFixed(1)}" text-anchor="middle">${escapeHtml(short)}</text>`
      + `</g>`;
  });
  svg.innerHTML = s;

  /* 第三十三轮:雷达整体放大(显示尺寸上限 1120px)后,文字不跟着放大 ——
     标签按当前显示宽度反算 user 单位字号,使屏幕上的字号恒定约 14px
     (与原来 560px 显示尺寸时相同)。显示尺寸是流式的,挂 ResizeObserver
     持续校准;clientWidth 取布局宽度,不受 pop 动画的 transform 影响。 */
  /* 第三十六轮:viewBox 跟着内容收拢。原 480x480 正方框上下各留 ~65 user
     单位的空白(1120px 显示时约 150px),用户反馈"上下部分空白太多"。
     定完字号后实测 .lbl 的 bbox(getBBox 会强制回流,同步返回新字号下的
     真实范围),加上随字号缩放的边距,写回 viewBox 的 y/height;宽恒为
     480 不变 —— 字号公式里的 480(viewBox 宽)、横向布局都不受影响。
     标签半径 168 > 图形半径 138,上下极值恒由标签决定;把 240±138 的
     图形范围并入并集只作兜底(将来若把标签移近,框仍然包得住图形)。
     自反馈说明:改 viewBox 会改变元素高度 → 再触发一次 ResizeObserver
     → 重算得到同一个字符串 → 盒子不再变化,循环收敛。 */
  const fitRadar = () => {
    const w = svg.clientWidth || svg.getBoundingClientRect().width || 480;
    const fs = 14 * 480 / w;
    svg.querySelectorAll('.lbl').forEach(t => { t.style.fontSize = fs.toFixed(2) + 'px'; });
    let y0 = 240 - 138, y1 = 240 + 138;      // 图形垂直范围(环/零平面/轮廓),兜底
    svg.querySelectorAll('.lbl').forEach(t => {
      const b = t.getBBox();
      if (b.y < y0) y0 = b.y;
      if (b.y + b.height > y1) y1 = b.y + b.height;
    });
    const m = Math.max(6, fs * 0.4);         // 边距随字号缩放(最小 6 单位)
    const top = y0 - m, bot = y1 + m;
    svg.setAttribute('viewBox',
      '0 ' + top.toFixed(1) + ' 480 ' + (bot - top).toFixed(1));
  };
  fitRadar();
  if (svg.__lblFit) svg.__lblFit.disconnect();
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(fitRadar);
    ro.observe(svg);
    svg.__lblFit = ro;
  }

  svg.querySelectorAll('.hit').forEach(g => {
    g.addEventListener('click', () => {
      const name = g.dataset.sub;
      const hit = top.find(r => r.name === name);
      if (hit) showSubsystemDetail(name, hit, currentComboId);
    });
  });
}

function showSubsystemDetail(name, r, comboId) {
  if (!r) return;
  const fx = Store.reactionEffects(comboId);
  // reactions of this subsystem that appear in the prepared top lists (pure filter, no computation)
  const inTop = [];
  if (fx) {
    const seen = new Set();
    ['top_absolute', 'top_increased', 'top_decreased'].forEach(k => {
      (fx[k] || []).forEach(x => {
        if (x.subsystem === name && !seen.has(x.reaction_id)) {
          seen.add(x.reaction_id);
          inTop.push(x);
        }
      });
    });
  }
  const panel = document.getElementById('subs-detail');
  panel.innerHTML = `
    <h4 style="margin:0 0 12px;font-size:15px">${escapeHtml(subsystemLabel(name))}</h4>
    <dl class="kv">
      <dt>聚合效应</dt><dd>${fmtEffect(r.agg)}</dd>
      <dt>平均效应</dt><dd>${fmtEffect(r.mean)}</dd>
      <dt>平均绝对效应</dt><dd>${Number(r.meanAbs).toFixed(4)}</dd>
      <dt>绝对效应总和</dt><dd>${Number(r.sumAbs).toFixed(3)}</dd>
      <dt>子系统内反应数</dt><dd>${r.count}</dd>
    </dl>
    ${inTop.length ? `
      <div style="margin-top:16px;font-size:13px;color:var(--text-2);font-weight:560">
        该子系统中进入 Top 榜单的反应</div>
      <div class="chart" style="margin-top:8px">${inTop.map(x => `
        <div class="chart-row">
          <div class="chart-label">
            <div class="rx-name">${escapeHtml(x.reaction_name)}</div>
            <div class="rx-id">${escapeHtml(x.reaction_id)}</div>
          </div>
          <div class="bar-track thin"><div class="bar-mid"></div>
            <div class="bar-fill ${x.effect > 0 ? 'pos' : 'neg'}"
                 style="${barStyle(x.effect, maxAbs(inTop))}"></div></div>
          <div class="eff ${x.effect > 0 ? 'pos' : 'neg'}">${fmtEffect(x.effect)}</div>
        </div>`).join('')}</div>` : `
      <p style="margin:14px 0 0;font-size:13px;color:var(--text-3)">
        该子系统的反应均未进入本组合的 Top 受影响榜单。</p>`}
    <p style="margin:12px 0 0;font-size:13px;color:var(--text-3)">
      聚合效应 = 该子系统内各反应非加性通量效应之和。</p>`;
  panel.classList.add('open');
}

/* ------------------------------------------------------------
   4. Model-associated Features (SHAP)
   ------------------------------------------------------------ */
function renderShap(comboId) {
  const sh = Store.shapExplanation(comboId);
  if (!sh) return;
  document.getElementById('shap-section').style.display = '';

  const rows = sh.top_features || [];
  const max = Math.max(...rows.map(r => Math.abs(r.shap_value)), 1e-9);
  const effMax = Math.max(...rows.map(r => Math.abs(r.effect)), 1e-9);
  document.getElementById('shap-note').innerHTML =
    `模型关联特征 —— 一种<b>潜在的机制解读</b>,不是已验证的机制。
     这些反应是预测模型在该组合上最依赖的反应。`;

  document.getElementById('shap-body').innerHTML = rows.map((r, i) => `
    <div class="chart-row" data-rx="${escapeHtml(r.reaction_id)}" style="--i:${i}">
      <div class="chart-label">
        <div class="rx-name"><span class="rank">${r.rank}</span>${escapeHtml(r.reaction_name || r.reaction_id)}</div>
        <div class="rx-id">${escapeHtml(r.reaction_id)} · ${escapeHtml(subsystemLabel(r.subsystem))}</div>
      </div>
      <div class="chart-bars">
        <div class="bar-track"><div class="bar-mid"></div>
          <div class="bar-fill ${r.shap_value > 0 ? 'pos' : 'neg'}"
               style="${barStyle(r.shap_value, max)}"></div></div>
        <div class="bar-track thin"><div class="bar-mid"></div>
          <div class="bar-fill ${r.effect > 0 ? 'pos' : 'neg'}"
               style="${barStyle(r.effect, effMax)}"></div></div>
      </div>
      <div class="eff-pair">
        <div class="eff ${r.shap_value > 0 ? 'pos' : 'neg'}">${fmtEffect(r.shap_value, 3)}</div>
        <div class="eff-sub ${r.effect > 0 ? 'pos' : 'neg'}">${fmtEffect(r.effect, 3)}</div>
      </div>
    </div>`).join('');

  document.getElementById('shap-body').querySelectorAll('.chart-row').forEach(el => {
    el.addEventListener('click', () => {
      const hit = rows.find(r => r.reaction_id === el.dataset.rx);
      if (!hit) return;
      const panel = document.getElementById('shap-detail');
      panel.innerHTML = `
        <dl class="kv">
          <dt>反应</dt><dd class="plain">${escapeHtml(hit.reaction_name)}</dd>
          <dt>反应编号</dt><dd>${escapeHtml(hit.reaction_id)}</dd>
          <dt>所属子系统</dt><dd class="plain">${escapeHtml(subsystemLabel(hit.subsystem))}</dd>
          <dt>模型关联值</dt><dd>${fmtEffect(hit.shap_value, 4)}</dd>
          <dt>代谢效应</dt><dd>${fmtEffect(hit.effect, 4)}</dd>
        </dl>
        <p style="margin:12px 0 0;font-size:13px;color:var(--text-3)">
          正值表示该特征推动模型输出朝向当前组合的结果,负值表示推离。这不构成因果陈述。</p>`;
      panel.classList.add('open');
    });
  });
  growBars(document.getElementById('shap-body'));
}

/* ------------------------------------------------------------
   Drug library (left rail)
   The former standalone 药物库 page is now the bottom half of the
   rail. It shares the two pickers' state, so tapping + on a row is
   exactly the same action as picking the drug in a search field.
   ------------------------------------------------------------ */
let libCat = 'all';
let libReady = false;

function initLibrary() {
  const grid = document.getElementById('drug-grid');
  if (!grid) return;
  const input = document.getElementById('lib-search');

  renderLibCats();
  input.addEventListener('input', () => renderLib(input.value));
  /* one delegated listener: the list is re-rendered on every keystroke */
  grid.addEventListener('click', e => {
    const btn = e.target.closest('.add-btn');
    if (btn && btn.dataset.drug) assignSlot(btn.dataset.drug);
  });
  renderLib('');
  libReady = true;
}

function renderLibCats() {
  const bar = document.getElementById('cat-bar');
  if (!bar) return;
  const counts = {};
  Store.drugs.forEach(d => {
    const c = drugCategory(d.drug_id);
    counts[c] = (counts[c] || 0) + 1;
  });
  const items = [['all', '全部 ' + Store.drugs.length]]
    .concat(CATEGORY_ORDER.filter(c => counts[c])
      .map(c => [c, DRUG_CATEGORY_ZH[c] + ' ' + counts[c]]));

  bar.innerHTML = items.map(([k, label]) =>
    `<button class="cat-chip${k === libCat ? ' active' : ''}" data-cat="${k}">${label}</button>`
  ).join('');

  bar.querySelectorAll('.cat-chip').forEach(b => {
    b.addEventListener('click', () => {
      libCat = b.dataset.cat;
      bar.querySelectorAll('.cat-chip').forEach(x =>
        x.classList.toggle('active', x === b));
      renderLib(document.getElementById('lib-search').value);
    });
  });
}

/* Fit the drug to the first free slot; tapping a chosen drug removes it.
   Both slots full -> nothing changes, a toast explains why.
   The two slots are interchangeable (the combination key sorts the pair),
   so nothing in the UI names them A / B (round 30). */
function assignSlot(id) {
  if (pickerA.value === id) {
    pickerA.clear();
    showLibToast('已从选择中移除');
  } else if (pickerB.value === id) {
    pickerB.clear();
    showLibToast('已从选择中移除');
  } else if (!pickerA.value) {
    pickerA.select(id);
    showLibToast('已加入选择');
  } else if (!pickerB.value) {
    pickerB.select(id);
    showLibToast('已加入选择');
  } else {
    showLibToast('已选两种药物,请先移除一个');
    return;
  }
  updateExploreButton();
}

let libToastTimer = null;
function showLibToast(msg) {
  const t = document.getElementById('lib-toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(libToastTimer);
  libToastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}

/* Some records carry a cn_name that merely repeats the drug id and appends a
   note ("A22(MreB 干预)"). The row already prints the id, so strip the repeat —
   otherwise every line reads like "A22  A22(MreB 干预)". */
function shortCn(d) {
  let cn = (d.cn_name || '').trim();
  if (!cn || cn === d.drug_id) return '';
  if (cn.toUpperCase().startsWith(d.drug_id.toUpperCase())) {
    cn = cn.slice(d.drug_id.length)
           .replace(/^[\s(（\[【:：·\-—]+/, '')
           .replace(/[\s)）\]】]+$/, '');
  }
  return cn;
}

function libRow(d) {
  const cat = DRUG_CATEGORY_ZH[drugCategory(d.drug_id)] || '其他扰动';
  const cn = shortCn(d);
  const sub = [cat, d.mechanism].filter(Boolean).join(' · ');
  const id = escapeHtml(d.drug_id);
  return `
    <div class="card drug-card" data-drug="${id}">
      <div class="dc-main">
        <div class="dc-line">
          <span class="dc-id">${id}</span>
          ${cn ? `<span class="dc-cn">${escapeHtml(cn)}</span>` : ''}
        </div>
        <div class="dc-sub" title="${escapeHtml(sub)}">${escapeHtml(sub)}</div>
      </div>
      <div class="dc-side">
        <button class="add-btn" data-drug="${id}" title="加入选择" aria-label="加入选择"></button>
      </div>
    </div>`;
}

function renderLib(q) {
  const grid = document.getElementById('drug-grid');
  if (!grid) return;
  q = (q || '').trim().toLowerCase();
  const list = Store.drugs.filter(d => {
    if (libCat !== 'all' && drugCategory(d.drug_id) !== libCat) return false;
    if (!q) return true;
    const hay = [d.drug_id, d.drug_name, d.display_name, d.cn_name, d.mechanism,
                 d.targets, d.synonyms].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });

  grid.innerHTML = list.map(libRow).join('');
  document.getElementById('lib-count').textContent =
    `${list.length} / ${Store.drugs.length}`;

  const empty = document.getElementById('lib-empty');
  empty.textContent = libCat === 'all'
    ? '没有符合搜索条件的药物。'
    : `「${DRUG_CATEGORY_ZH[libCat]}」分类下没有符合搜索条件的药物。`;
  empty.style.display = list.length ? 'none' : '';
  syncLibraryCards();
}

/* Update the selected marks in place — never re-render on every keystroke.
   Round 30 dropped the A/B slot badges: the two slots are interchangeable,
   so a row is either chosen (accent border + minus button) or not. */
function syncLibraryCards() {
  if (!libReady) return;
  const a = pickerA ? pickerA.value : null;
  const b = pickerB ? pickerB.value : null;
  document.querySelectorAll('#drug-grid .drug-card').forEach(el => {
    const on = el.dataset.drug === a || el.dataset.drug === b;
    el.classList.toggle('selected', on);
    const btn = el.querySelector('.add-btn');
    if (btn) {
      btn.classList.toggle('active', on);
      btn.title = on ? '点击移除' : '加入选择';
      btn.setAttribute('aria-label', on ? '移除' : '加入选择');
    }
  });
}
