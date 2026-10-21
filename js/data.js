/* ============================================================
   data.js — static data access layer
   Frontend does: Read -> Lookup -> Display.  No scientific computation.
   ============================================================ */

/* 数据目录:从页面位置自动推导,一份代码同时适配两种布局 ——
   ① 开发快照(页面在 /frontend/ 下,数据在站点根 /static_data/)
   ② GitHub 包(页面在仓库根或项目子路径 /<repo>/ 下,数据在同级 static_data/)
   相对路径在这里不可靠:GitHub Pages 项目站点的页面带子路径,
   '../static_data/' 会跳出项目根变成 404(第 49 轮实测踩到)。 */
const DATA_BASE = (function () {
  const dir = location.pathname.replace(/\/[^\/]*$/, '/');  // 页面所在目录
  const root = dir.replace(/\/frontend\/$/, '/');            // 快照布局:往上退一级
  return root + 'static_data/';
})();

/* 数据文件缓存戳:与 HTML 里的 ?v= 版本戳保持同步,每次发布一起 +1。
   loadJSON 用 cache:'force-cache',URL 不变时浏览器会一直复用旧副本 ——
   第 40 轮(药物中文名补全)是首次改动数据文件,加这个查询串保证新的
   drugs.json 立即生效(本地预览与部署后都适用)。 */
const DATA_Q = '?v=56';

/* ---------- small loader with cache ---------- */
const _cache = {};

async function loadJSON(name) {
  if (_cache[name]) return _cache[name];
  const res = await fetch(DATA_BASE + name + DATA_Q, { cache: 'force-cache' });
  if (!res.ok) throw new Error('Failed to load ' + name + ' (' + res.status + ')');
  const json = await res.json();
  _cache[name] = json;
  return json;
}

/* ---------- sharded loader for the three large tables (round 49) ----------
   The monolithic reaction_effects / pathway_effects / shap_explanations
   files (58.7 MB) were replaced by 256 per-combination shards under
   static_data/shards/ (11.1 MB total; generator: verify_shots/gen_shards.py).
   A query fetches only the shard holding its combination (~45 KB raw), so
   the first result appears without waiting for the whole matrix.
   Slim item format (one item per combination inside a shard):
     c  : combination_id
     rx : [[ [reaction_id, effect] x10 ] x3]   top_increased/decreased/absolute
     pw : [[ 39 floats ] x4]                   aggregate/mean/meanAbs/sumAbs
     sh : {pc, pn, tf:[[reaction_id, shap_value, effect] x10]}
   reaction_name / subsystem are NOT stored per entry — they are looked up
   in the eager reactions.json (Store.reactions), which covers every id
   used by the top lists (verified at generation time). */
const N_SHARDS = 256;

function shardOf(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % N_SHARDS;
}

/* ============================================================
   Canonical combination id.
   Combination ids are DRUG_A__DRUG_B with the two drug names sorted
   lexicographically, so A/B order never matters.  Sorting is plain
   code-unit ordering, identical to Python's sorted() over these
   uppercase ASCII names.
   ============================================================ */
function combinationId(a, b) {
  return (a < b) ? (a + '__' + b) : (b + '__' + a);
}

/* ============================================================
   Transient two-slot selection (this browser tab only).
   The Drug Library records which drugs the visitor assigned to the
   Drug A and Drug B slots, so a choice survives the trip to the
   Explorer and back.  This is interface state only: nothing
   scientific is stored, and it disappears when the tab closes.
   ============================================================ */
const Selection = {
  A: 'eccombo.slot.a',
  B: 'eccombo.slot.b',
  _key(slot) { return slot === 'a' ? this.A : this.B; },
  get(slot) {
    try { return sessionStorage.getItem(this._key(slot)) || null; }
    catch (e) { return null; }
  },
  set(slot, id) {
    try {
      if (id) sessionStorage.setItem(this._key(slot), id);
      else sessionStorage.removeItem(this._key(slot));
    } catch (e) { /* storage unavailable — the choice is simply not remembered */ }
  },
  clear() { this.set('a', null); this.set('b', null); },
};

/* ============================================================
   Store — holds the loaded indexes
   ============================================================ */
const Store = {
  drugs: [],              // array of drug objects
  drugById: new Map(),    // drug_id -> drug
  results: null,          // Map combination_id -> {result, drug_a, drug_b}
  reactions: null,        // Map reaction_id -> {name, subsystem}
  reactionOrder: [],      // ordered reaction ids (iJO1366 order)
  pathways: null,         // array of pathway objects
  manifest: null,

  _reactionEffects: new Map(),  // combination_id -> reconstructed item (per combo)
  _pathwayEffects: new Map(),   // combination_id -> reconstructed item (per combo)
  _shap: new Map(),             // combination_id -> reconstructed item (per combo)
  _shardMeta: null,      // shard headers (subsystems, top_n, method texts…)
  _shards: new Map(),    // shard number -> parsed shard json (session cache)
  _loadedCombos: new Set(),

  /* ---- eager: everything the shell needs immediately (~1.4 MB) ---- */
  async init() {
    const [drugs, results, reactions, pathways, manifest] = await Promise.all([
      loadJSON('drugs.json'),
      loadJSON('combination_results.json'),
      loadJSON('reactions.json'),
      loadJSON('pathways.json'),
      loadJSON('manifest.json'),
    ]);

    this.drugs = drugs.items.slice().sort((x, y) => x.drug_id.localeCompare(y.drug_id));
    this.drugById = new Map(this.drugs.map(d => [d.drug_id, d]));

    this.results = new Map();
    for (const it of results.items) this.results.set(it.combination_id, it);

    this.reactions = new Map();
    for (const r of reactions.items) {
      this.reactions.set(r.reaction_id, r);
      this.reactionOrder.push(r.reaction_id);
    }

    this.pathways = pathways.items;
    this.manifest = manifest;
    return this;
  },

  /* ---- lazy: one shard per queried combination (round 49) ---- */
  async loadCombo(comboId) {
    if (this._loadedCombos.has(comboId)) return;
    if (!this._shardMeta) {
      this._shardMeta = await loadJSON('shards/meta.json');
      this.pathwaySubsystems = this._shardMeta.subsystems;
      this.pathwayReactionCount = this._shardMeta.reaction_count;
      this.pathwayAggregation = this._shardMeta.aggregation_method;
      this.shapMethod = this._shardMeta.method;
      this.shapInterpretation = this._shardMeta.interpretation;
      this.topN = this._shardMeta.top_n;
    }
    const n = shardOf(comboId);
    let shard = this._shards.get(n);
    if (!shard) {
      shard = await loadJSON('shards/shard_' +
                             String(n).padStart(3, '0') + '.json');
      this._shards.set(n, shard);
    }
    const hit = shard.items.find(i => i.c === comboId);
    if (!hit) throw new Error('shard ' + n + ' 中没有组合 ' + comboId);

    /* Reconstruct the original per-combination shapes so every renderer
       downstream is unchanged: names/subsystems come from the eager
       reactions map (round-49 string interning). */
    const rxEntry = pair => {
      const rx = this.reactions.get(pair[0]) || {};
      return { reaction_id: pair[0],
               reaction_name: rx.reaction_name || pair[0],
               subsystem: rx.subsystem || '',
               effect: pair[1] };
    };
    this._reactionEffects.set(comboId, {
      combination_id: comboId,
      top_increased: hit.rx[0].map(rxEntry),
      top_decreased: hit.rx[1].map(rxEntry),
      top_absolute: hit.rx[2].map(rxEntry),
    });
    this._pathwayEffects.set(comboId, {
      combination_id: comboId,
      aggregate_effect: hit.pw[0],
      mean_effect: hit.pw[1],
      mean_abs_effect: hit.pw[2],
      sum_abs_effect: hit.pw[3],
    });
    this._shap.set(comboId, {
      combination_id: comboId,
      prediction_class: hit.sh.pc,
      prediction_name: hit.sh.pn,
      top_features: hit.sh.tf.map((f, i) => {
        const rx = this.reactions.get(f[0]) || {};
        return { rank: i + 1, reaction_id: f[0],
                 reaction_name: rx.reaction_name || f[0],
                 subsystem: rx.subsystem || '',
                 shap_value: f[1], effect: f[2] };
      }),
    });
    this._loadedCombos.add(comboId);
  },

  /* ---- lookups (no computation, pure reads) ----
     NOTE: the backing stores above are prefixed with "_" so they can never
     collide with these accessor method names. */
  drug(id) { return this.drugById.get(id) || null; },

  result(comboId) { return this.results.get(comboId) || null; },

  reactionEffects(comboId) { return this._reactionEffects.get(comboId) || null; },

  pathwayEffects(comboId) { return this._pathwayEffects.get(comboId) || null; },

  shapExplanation(comboId) { return this._shap.get(comboId) || null; },

  /* human-readable name; falls back to the raw id when the ontology has none */
  reactionName(id) {
    const r = this.reactions.get(id);
    return r && r.reaction_name ? r.reaction_name : id;
  },

  reactionSubsystem(id) {
    const r = this.reactions.get(id);
    return r && r.subsystem ? r.subsystem : '';
  },
};

/* ---------- 中文展示映射(仅展示层;数据文件中的取值一律不改) ---------- */

/* 三分类结果:数据值为 Synergy/Neutral/Antagonism,CSS class 也依赖原值,
   这里只把「显示文本」换成中文。 */
const RESULT_ZH = {
  Synergy: '协同',
  Neutral: '中性',
  Antagonism: '拮抗',
};

/* 39 个 iJO1366 子系统译名(显示用;查不到时回退英文原名) */
const SUBSYSTEM_ZH = {
  'Alanine and Aspartate Metabolism': '丙氨酸与天冬氨酸代谢',
  'Alternate Carbon Metabolism': '替代碳源代谢',
  'Anaplerotic Reactions': '回补反应',
  'Arginine and Proline Metabolism': '精氨酸与脯氨酸代谢',
  'Biomass and maintenance functions': '生物量与维持功能',
  'Cell Envelope Biosynthesis': '细胞被膜合成',
  'Citric Acid Cycle': '三羧酸循环',
  'Cofactor and Prosthetic Group Biosynthesis': '辅因子与辅基合成',
  'Cysteine Metabolism': '半胱氨酸代谢',
  'Extracellular exchange': '胞外交换',
  'Folate Metabolism': '叶酸代谢',
  'Glutamate Metabolism': '谷氨酸代谢',
  'Glycerophospholipid Metabolism': '甘油磷脂代谢',
  'Glycine and Serine Metabolism': '甘氨酸与丝氨酸代谢',
  'Glycolysis/Gluconeogenesis': '糖酵解/糖异生',
  'Glyoxylate Metabolism': '乙醛酸代谢',
  'Histidine Metabolism': '组氨酸代谢',
  'Inorganic Ion Transport and Metabolism': '无机离子转运与代谢',
  'Intracellular demand': '胞内需求',
  'Lipopolysaccharide Biosynthesis / Recycling': '脂多糖合成/回收',
  'Membrane Lipid Metabolism': '膜脂代谢',
  'Methionine Metabolism': '甲硫氨酸代谢',
  'Methylglyoxal Metabolism': '甲基乙二醛代谢',
  'Murein Biosynthesis': '肽聚糖合成',
  'Murein Recycling': '肽聚糖回收',
  'Nitrogen Metabolism': '氮代谢',
  'Nucleotide Salvage Pathway': '核苷酸补救途径',
  'Oxidative Phosphorylation': '氧化磷酸化',
  'Pentose Phosphate Pathway': '磷酸戊糖途径',
  'Purine and Pyrimidine Biosynthesis': '嘌呤与嘧啶合成',
  'Pyruvate Metabolism': '丙酮酸代谢',
  'Threonine and Lysine Metabolism': '苏氨酸与赖氨酸代谢',
  'Transport, Inner Membrane': '内膜转运',
  'Transport, Outer Membrane': '外膜转运',
  'Transport, Outer Membrane Porin': '外膜孔蛋白转运',
  'Tyrosine, Tryptophan, and Phenylalanine Metabolism': '酪氨酸、色氨酸与苯丙氨酸代谢',
  'Unassigned': '未归类',
  'Valine, Leucine, and Isoleucine Metabolism': '缬氨酸、亮氨酸与异亮氨酸代谢',
  'tRNA Charging': 'tRNA 装载',
};

function resultLabel(cls) { return RESULT_ZH[cls] || cls; }

function subsystemLabel(name) {
  if (!name) return '';
  return SUBSYSTEM_ZH[name] || name;
}

/* 药物展示名:有中文名优先中文名,否则用编号 */
function drugDisplay(d) {
  if (!d) return '';
  return (d.cn_name && d.cn_name !== d.drug_id) ? d.cn_name : d.drug_id;
}

/* ---------- 药物库分类(UI 辅助,仅供参考) ----------
   依据:数据自带 targets 字段(54/106) + 名称归类;不属于任何已知类别的归 other。
   这是浏览辅助,不是科学论断;正式口径以 02 数据资产文档为准。 */
const DRUG_CATEGORY_ZH = {
  cellwall:  '细胞壁合成',
  ribo30:    '30S 核糖体',
  ribo50:    '50S 核糖体',
  nucleic:   '核酸合成与损伤',
  folate:    '叶酸代谢',
  membrane:  '膜与离子梯度',
  lipid:     '脂肪酸合成',
  nutrient:  '营养与离子',
  other:     '其他扰动',
};

const DRUG_CATEGORY = {
  /* 细胞壁合成(β-内酰胺、糖肽、磷霉素、环丝氨酸、LPS/被膜相关) */
  AMOXICILLIN: 'cellwall', AMPICILLIN: 'cellwall', OXACILLIN: 'cellwall',
  CARBENICILLIN: 'cellwall', MECILLINAM: 'cellwall', CEFACLOR: 'cellwall',
  CEFOXITIN: 'cellwall', CEFSULODIN: 'cellwall', CEFTAZIDIME: 'cellwall',
  AZTREONAM: 'cellwall', VANCOMYCIN: 'cellwall', BACITRACIN: 'cellwall',
  CYCLOSERINED: 'cellwall', FOSFOMYCIN: 'cellwall', GLUFOSFOMYCIN: 'cellwall',
  TUNICAMYCIN: 'cellwall', A22: 'cellwall', CHIR090: 'cellwall',
  CALCOFLUOR: 'cellwall',
  /* 30S 核糖体(四环素类、氨基糖苷类) */
  AMIKACIN: 'ribo30', GENTAMICIN: 'ribo30', STREPTOMYCIN: 'ribo30',
  TOBRAMYCIN: 'ribo30', SPECTINOMYCIN: 'ribo30', TETRACYCLINE: 'ribo30',
  DOXYCYCLINE: 'ribo30', MINOCYCLINE: 'ribo30',
  /* 50S 核糖体(大环内酯类、氯霉素、梭链孢酸、嘌呤霉素) */
  ERYTHROMYCIN: 'ribo50', AZITHROMYCIN: 'ribo50', CLARYTHROMYCIN: 'ribo50',
  SPIRAMYCIN: 'ribo50', CHLORAMPHENICOL: 'ribo50', FUSIDICACID: 'ribo50',
  PUROMYCIN: 'ribo50',
  /* 核酸合成与损伤(喹诺酮、利福平、DNA 嵌入/交联、抗代谢) */
  CIPROFLOXACIN: 'nucleic', NORFLOXACIN: 'nucleic', LEVOFLOXACIN: 'nucleic',
  NALIDIXICACID: 'nucleic', NOVOBIOCIN: 'nucleic', BICYCLOMYCIN: 'nucleic',
  RIFAMPICIN: 'nucleic', MITOMYCINC: 'nucleic', BLEOMYCIN: 'nucleic',
  PHLEOMYCIN: 'nucleic', DOXORUBICIN: 'nucleic', CISPLATIN: 'nucleic',
  STREPTONIGRIN: 'nucleic', MMS: 'nucleic', ETHIDIUMBROMIDE: 'nucleic',
  PROPIDIUMIODIDE: 'nucleic', HYDROXYUREA: 'nucleic', AZIDOTHYMIDINE: 'nucleic',
  ACRIFLAVINE: 'nucleic', ACTINOMYCIND: 'nucleic',
  /* 叶酸代谢 */
  TRIMETHOPRIM: 'folate', SULFAMETHIZOLE: 'folate', SULFAMONOMETHOXINE: 'folate',
  METHOTREXATE: 'folate',
  /* 膜与离子梯度(去污剂、胆盐、抗菌肽、解偶联剂、离子载体) */
  POLYMYXINB: 'membrane', CECROPINB: 'membrane', INDOLICIDIN: 'membrane',
  SDS: 'membrane', TRITONX: 'membrane', BENZALKONIUM: 'membrane',
  CHOLATE: 'membrane', DEOXYCHOLATE: 'membrane', TAUROCHOLATE: 'membrane',
  BILE: 'membrane', EDTA: 'membrane', EGTA: 'membrane',
  CCCP: 'membrane', NIGERICIN: 'membrane', PARAQUAT: 'membrane',
  /* 脂肪酸合成 */
  CERULENIN: 'lipid', THIOLACTOMYCIN: 'lipid', TRICLOSAN: 'lipid',
  /* 营养与离子 */
  ACETATE: 'nutrient', GLUCOSE: 'nutrient', GLUCOSAMINE: 'nutrient',
  'N-ACETYLGLUCOSAMINE': 'nutrient', GLYCEROL: 'nutrient', MALTOSE: 'nutrient',
  SUCCINATE: 'nutrient', NACL: 'nutrient', NH4CL: 'nutrient',
  HIGHCOBALT: 'nutrient', HIGHCOPPER: 'nutrient', HIGHFE: 'nutrient',
  HIGHNICKEL: 'nutrient', LOWFE: 'nutrient',
  /* 其他扰动 */
  ETHANOL: 'other', PEROXIDE: 'other', PMS: 'other', EGCG: 'other',
  THEOPHYLLINE: 'other', VERAPAMIL: 'other', CHLOROPROMAZINE: 'other',
  EPINEPHRINE: 'other', NOREPINEPHRINE: 'other', PROCAINE: 'other',
  DIBUCAINE: 'other', RADICICOL: 'other', PYOCYANIN: 'other',
  ISONIAZID: 'other', NITROFURANTOIN: 'other', ANAEROBIC: 'other',
};

function drugCategory(id) { return DRUG_CATEGORY[id] || 'other'; }

/* 分类顺序(用于筛选栏) */
const CATEGORY_ORDER = ['cellwall', 'ribo30', 'ribo50', 'nucleic',
                        'folate', 'membrane', 'lipid', 'nutrient', 'other'];

/* ---------- small formatting helpers (display only) ---------- */
function fmtEffect(v, digits = 3) {
  if (v === null || v === undefined) return '—';
  const s = Number(v).toFixed(digits);
  return (v > 0 ? '+' : '') + s;
}

function drugLabel(d) {
  // display_name already falls back to drug_name in the data layer
  return d.display_name && d.display_name !== d.drug_name
    ? d.display_name
    : d.drug_name;
}

function escapeHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
