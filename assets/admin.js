/* ============================================================
   招聘进展看板 · 管理后台逻辑
   依赖服务器（node server.js）才能保存；本页面仅限本机访问
   ============================================================ */
'use strict';

var RESULT_OPTIONS = ['通过', '待面试', '暂缓结果', '不通过', '待约', '暂无'];
var TYPE_OPTIONS = ['实习', '社招', '实习/校招', '校招'];
var SOURCE_OPTIONS = ['BOSS', '猎头', '内推'];

var DATA = null;        // 全量数据 { teams: [...] }
var curTeamId = null;   // 当前编辑的团队
var mode = 'live';      // live = 服务器模式可保存；file = 静态快照模式
var dirty = false;
var parsedRows = null;  // 粘贴导入解析结果

/* ---------- 基础 UI ---------- */

function $(id) { return document.getElementById(id); }

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

var toastTimer = null;
function toast(msg, isErr) {
  var t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.className = 'toast' + (isErr ? ' err' : ''); }, 2600);
}

function setDirty(d) {
  dirty = d;
  var el = $('saveStatus');
  el.className = 'save-status' + (d ? ' dirty' : '');
  el.innerHTML = '<span class="dot"></span>' + (d ? '有未保存的更改' : '已保存 · 就绪');
}

function emptyCand() {
  return {
    name: '', type: '',
    r1: { interviewer: '', result: '' },
    r2: { interviewer: '', result: '' },
    r3: { interviewer: '', result: '' },
    note: '', source: '', mark: ''
  };
}

/* 海外人才汇总（独立表结构） */
var OV_STAGES = ['00 待推荐', '01 已推荐', '02 交流中', '03 Offer中', '04 长期跟踪'];
var OV_FIELDS = [
  ['status', '状态'], ['name', '姓名'], ['company', '公司'], ['field', '研究领域'],
  ['degree', '最高学历'], ['degreeSchool', '最高学历毕业院校'], ['degreeYear', '最高学历毕业时间'],
  ['bachelorSchool', '本科院校'], ['bachelorYear', '本科毕业时间'],
  ['team', '交流团队'], ['exchange', '交流情况'], ['salary', '薪资情况'], ['bio', '人选简介']
];
/* NeurIPS 建联名单（独立表结构） */
var NR_FIELDS = [
  ['status', '状态'], ['name', '姓名'], ['nameCn', '中文姓名'], ['category', '分类'],
  ['current', '当前所在'], ['degree', '最高学历'], ['degreeSchool', '最高学历院校'],
  ['major', '专业'], ['degreeYear', '毕业时间'], ['bachelorSchool', '本科院校'],
  ['field', '研究方向'], ['outreach', '转化类型'], ['link', '个人主页/Linkedin'],
  ['resume', '是否获取简历'], ['exchange', '交流情况'], ['focus', '重点关注']
];
var MARK_OPTS = ['', '意向', '待入职', '已入职', '淘汰/长期跟踪'];

function markToClass(mk) {
  return { '意向': 'mk-intent', '待入职': 'mk-join', '已入职': 'mk-onboard', '淘汰/长期跟踪': 'mk-out' }[mk] || '';
}

function emptyNeuripsCand() {
  var c = { mark: '' };
  NR_FIELDS.forEach(function (f) { c[f[0]] = ''; });
  return c;
}

function emptyOvCand() {
  var c = {};
  OV_FIELDS.forEach(function (f) { c[f[0]] = ''; });
  return c;
}

function isOvTeam() {
  var t = curTeam();
  return !!(t && t.kind === 'overseas');
}

function markSelect(idx, val) {
  var html = '';
  MARK_OPTS.forEach(function (o) {
    html += '<option value="' + o + '"' + (val === o ? ' selected' : '') + '>' +
      (o === '' ? '流程中（默认）' : o) + '</option>';
  });
  return '<select data-i="' + idx + '" data-f="mark"' +
    (val ? ' data-res="' + esc(val) + '"' : '') + '>' + html + '</select>';
}

function ovStatusSelect(idx, val) {
  var html = '<option value=""' + (!val ? ' selected' : '') + '>未标注</option>';
  OV_STAGES.forEach(function (s) {
    html += '<option value="' + s + '"' + (val === s ? ' selected' : '') + '>' + s + '</option>';
  });
  return '<select data-i="' + idx + '" data-f="status"' +
    (val ? ' data-res="' + esc(val) + '"' : '') + '>' + html + '</select>';
}

var IMPORT_HINT_STD = '在飞书表格或 Excel 里选中一块区域复制（含列顺序：<b>候选人 → 类型 → 一轮面试官 → 一轮结果 → 二轮面试官 → 二轮结果 → 三轮面试官 → 三轮结果 → 备注 → 来源</b>，列可缺失），粘贴到下面，结果列里的 ✅⏰ 等图标会自动清除。';
var IMPORT_HINT_OV = '在飞书表格或 Excel 里选中一块区域复制（含列顺序：<b>状态 → 姓名 → 公司 → 研究领域 → 最高学历 → 最高学历毕业院校 → 最高学历毕业时间 → 本科院校 → 本科毕业时间 → 交流团队 → 交流情况 → 薪资情况 → 人选简介</b>，列可缺失），粘贴到下面。';
var IMPORT_HINT_NR = '在飞书表格或 Excel 里选中一块区域复制（含列顺序：<b>状态 → 姓名 → 中文姓名 → 分类 → 当前所在 → 最高学历 → 最高学历院校 → 专业 → 毕业时间 → 本科院校 → 研究方向 → 转化类型 → 个人主页/Linkedin → 是否获取简历 → 交流情况 → 重点关注</b>，列可缺失），粘贴到下面。';

function curTeam() {
  if (!DATA) return null;
  for (var i = 0; i < DATA.teams.length; i++) {
    if (DATA.teams[i].id === curTeamId) return DATA.teams[i];
  }
  return null;
}

/* ---------- 启动 ---------- */

async function boot() {
  try {
    var r = await fetch('/api/data', { cache: 'no-store' });
    if (!r.ok) throw new Error('status ' + r.status);
    DATA = await r.json();
    mode = 'live';
  } catch (e) {
    DATA = window.__SNAPSHOT__ || { updatedAt: '', teams: [] };
    mode = 'file';
    $('banner').style.display = '';
    $('bannerText').innerHTML = '⚠️ 当前是<b>静态快照模式</b>（直接双击打开的页面）。' +
      '请先在本机终端运行 <code>node server.js</code>，再通过 <code>http://localhost:端口/admin</code> ' +
      '打开管理后台才能保存修改。';
  }

  $('btnSave').disabled = mode !== 'live';

  // 恢复上次编辑的团队 / URL 指定团队
  var want = new URLSearchParams(location.search).get('team');
  var ids = DATA.teams.map(function (t) { return t.id; });
  curTeamId = want && ids.indexOf(want) >= 0 ? want : ids[0];

  renderTabs();
  renderMeta();
  renderEditor();
  setDirty(false);
}

/* ---------- 团队 Tabs ---------- */

function renderTabs() {
  $('teamTabs').innerHTML = DATA.teams.map(function (t) {
    var n = (t.candidates || []).length;
    return '<button class="tab' + (t.id === curTeamId ? ' active' : '') +
      '" data-id="' + esc(t.id) + '">' + esc(t.name) +
      '<span class="n">' + n + '</span></button>';
  }).join('');
  Array.prototype.forEach.call($('teamTabs').querySelectorAll('.tab'), function (el) {
    el.addEventListener('click', function () {
      curTeamId = this.getAttribute('data-id');
      parsedRows = null;
      $('importPreview').innerHTML = '';
      $('importInfo').textContent = '';
      renderTabs();
      renderMeta();
      renderEditor();
    });
  });
}

/* ---------- 团队信息 ---------- */

function renderMeta() {
  var t = curTeam();
  if (!t) return;
  $('mName').value = t.name || '';
  $('mLead').value = t.lead || '';
  $('mDesc').value = t.desc || '';
}

function bindMeta() {
  ['mName', 'mLead', 'mDesc'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      var t = curTeam();
      if (!t) return;
      var key = this.getAttribute('data-m');
      t[key] = this.value;
      setDirty(true);
      renderTabs();
    });
  });
}

/* ---------- 候选人编辑表格 ---------- */

function setField(obj, path, val) {
  var parts = path.split('.');
  var o = obj;
  for (var i = 0; i < parts.length - 1; i++) {
    if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = val;
}

function resultSelect(idx, round, val) {
  var opts = ['<option value="">（空）</option>'].concat(RESULT_OPTIONS.map(function (o) {
    return '<option value="' + o + '"' + (val === o ? ' selected' : '') + '>' + o + '</option>';
  })).join('');
  return '<select data-i="' + idx + '" data-f="' + round + '.result"' +
    (val ? ' data-res="' + esc(val) + '"' : '') + '>' + opts + '</select>';
}

function textInput(idx, field, val, listId) {
  return '<input type="text" data-i="' + idx + '" data-f="' + field + '" value="' + esc(val) + '"' +
    (listId ? ' list="' + listId + '"' : '') + '>';
}

var STD_HEAD = '<th>#</th><th>候选人</th><th>类型</th>' +
  '<th>一轮面试官</th><th>一轮结果</th>' +
  '<th>二轮面试官</th><th>二轮结果</th>' +
  '<th>三轮面试官</th><th>三轮结果</th>' +
  '<th>备注</th><th>来源</th><th>标记</th><th></th>';

function renderEditor() {
  var t = curTeam();
  if (!t) return;
  if (!t.candidates) t.candidates = [];
  if (t.kind === 'overseas') return renderOverseasEditor(t);
  if (t.kind === 'neurips') return renderNeuripsEditor(t);

  document.querySelector('table.editor').style.minWidth = '1180px';
  $('editorHead').innerHTML = STD_HEAD;
  $('importHint').innerHTML = IMPORT_HINT_STD;
  $('teamHint').textContent = '共 ' + t.candidates.length + ' 人 · 修改后请点右上角「保存全部」';

  var rows = t.candidates.map(function (c, i) {
    c.r1 = c.r1 || {}; c.r2 = c.r2 || {}; c.r3 = c.r3 || {};
    var mk = String(c.mark || '').trim();
    return '<tr class="' + markToClass(mk) + '">' +
      '<td class="idx">' + (i + 1) + '</td>' +
      '<td>' + textInput(i, 'name', c.name) + '</td>' +
      '<td>' + textInput(i, 'type', c.type, 'dlType') + '</td>' +
      '<td>' + textInput(i, 'r1.interviewer', c.r1.interviewer) + '</td>' +
      '<td>' + resultSelect(i, 'r1', c.r1.result) + '</td>' +
      '<td>' + textInput(i, 'r2.interviewer', c.r2.interviewer) + '</td>' +
      '<td>' + resultSelect(i, 'r2', c.r2.result) + '</td>' +
      '<td>' + textInput(i, 'r3.interviewer', c.r3.interviewer) + '</td>' +
      '<td>' + resultSelect(i, 'r3', c.r3.result) + '</td>' +
      '<td>' + textInput(i, 'note', c.note) + '</td>' +
      '<td>' + textInput(i, 'source', c.source, 'dlSource') + '</td>' +
      '<td>' + markSelect(i, mk) + '</td>' +
      '<td><button class="del-btn" data-del="' + i + '" title="删除该候选人">✕</button></td>' +
      '</tr>';
  }).join('');

  $('editorBody').innerHTML = rows ||
    '<tr><td colspan="13" style="text-align:center;padding:30px;color:#8071a0">' +
    '该团队还没有候选人，点上方「＋ 添加候选人」或用粘贴导入</td></tr>';
}

/* ---------- NeurIPS 建联编辑器 ---------- */

function renderNeuripsEditor(t) {
  document.querySelector('table.editor').style.minWidth = '2300px';
  $('editorHead').innerHTML = '<th>#</th>' +
    NR_FIELDS.map(function (f) { return '<th>' + f[1] + '</th>'; }).join('') +
    '<th>标记</th><th></th>';
  $('importHint').innerHTML = IMPORT_HINT_NR;
  $('teamHint').textContent = '共 ' + t.candidates.length + ' 人 · 修改后请点右上角「保存全部」';

  var rows = t.candidates.map(function (c, i) {
    var mk = String(c.mark || '').trim();
    return '<tr class="' + markToClass(mk) + '">' +
      '<td class="idx">' + (i + 1) + '</td>' +
      NR_FIELDS.map(function (f) {
        var val = String(c[f[0]] == null ? '' : c[f[0]]);
        if (f[0] === 'status') return '<td>' + ovStatusSelect(i, val) + '</td>';
        return '<td>' + textInput(i, f[0], val) + '</td>';
      }).join('') +
      '<td>' + markSelect(i, mk) + '</td>' +
      '<td><button class="del-btn" data-del="' + i + '" title="删除该人选">✕</button></td>' +
      '</tr>';
  }).join('');

  $('editorBody').innerHTML = rows ||
    '<tr><td colspan="18" style="text-align:center;padding:30px;color:#8071a0">' +
    '该团队还没有人选，点上方「＋ 添加候选人」或用粘贴导入</td></tr>';
}

/* ---------- 海外人才汇总编辑器 ---------- */

function renderOverseasEditor(t) {
  document.querySelector('table.editor').style.minWidth = '1780px';
  $('editorHead').innerHTML = '<th>#</th>' +
    OV_FIELDS.map(function (f) { return '<th>' + f[1] + '</th>'; }).join('') + '<th></th>';
  $('importHint').innerHTML = IMPORT_HINT_OV;
  $('teamHint').textContent = '共 ' + t.candidates.length + ' 人 · 修改后请点右上角「保存全部」';

  var rows = t.candidates.map(function (c, i) {
    return '<tr>' +
      '<td class="idx">' + (i + 1) + '</td>' +
      OV_FIELDS.map(function (f) {
        var val = String(c[f[0]] == null ? '' : c[f[0]]);
        if (f[0] === 'status') return '<td>' + ovStatusSelect(i, val) + '</td>';
        if (f[0] === 'name') return '<td>' + textInput(i, 'name', val) + '</td>';
        return '<td>' + textInput(i, f[0], val) + '</td>';
      }).join('') +
      '<td><button class="del-btn" data-del="' + i + '" title="删除该人选">✕</button></td>' +
      '</tr>';
  }).join('');

  $('editorBody').innerHTML = rows ||
    '<tr><td colspan="15" style="text-align:center;padding:30px;color:#8071a0">' +
    '该团队还没有人选，点上方「＋ 添加候选人」或用粘贴导入</td></tr>';
}

function bindEditor() {
  // 行内编辑（事件委托，避免重渲染丢焦点）
  $('editorBody').addEventListener('input', function (e) {
    var el = e.target;
    if (!el.getAttribute || !el.getAttribute('data-f')) return;
    var t = curTeam();
    var i = Number(el.getAttribute('data-i'));
    if (!t || !t.candidates[i]) return;
    setField(t.candidates[i], el.getAttribute('data-f'), el.value);
    setDirty(true);
  });

  // 结果下拉着色
  $('editorBody').addEventListener('change', function (e) {
    var el = e.target;
    if (el.tagName === 'SELECT' && el.getAttribute('data-f')) {
      var v = el.value;
      if (v) el.setAttribute('data-res', v);
      else el.removeAttribute('data-res');
      var t = curTeam();
      var i = Number(el.getAttribute('data-i'));
      if (t && t.candidates[i]) {
        setField(t.candidates[i], el.getAttribute('data-f'), v);
        setDirty(true);
      }
    }
  });

  // 删除行
  $('editorBody').addEventListener('click', function (e) {
    var idx = e.target.getAttribute && e.target.getAttribute('data-del');
    if (idx === null || idx === undefined) return;
    var t = curTeam();
    var i = Number(idx);
    var name = (t.candidates[i] && t.candidates[i].name) || '该候选人';
    if (!confirm('确定删除「' + name + '」？')) return;
    t.candidates.splice(i, 1);
    setDirty(true);
    renderTabs();
    renderEditor();
  });
}

/* ---------- 工具栏动作 ---------- */

function bindToolbar() {
  $('btnAdd').addEventListener('click', function () {
    var t = curTeam();
    if (!t) return;
    t.candidates.push(
      t.kind === 'overseas' ? emptyOvCand() :
      t.kind === 'neurips' ? emptyNeuripsCand() : emptyCand()
    );
    setDirty(true);
    renderTabs();
    renderEditor();
    var inputs = $('editorBody').querySelectorAll('input[data-f="name"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  $('btnClear').addEventListener('click', function () {
    var t = curTeam();
    if (!t) return;
    if (!confirm('确定清空「' + t.name + '」的全部 ' + (t.candidates || []).length + ' 条候选人记录？此操作保存后不可恢复。')) return;
    t.candidates = [];
    setDirty(true);
    renderTabs();
    renderEditor();
  });

  $('btnCopyTSV').addEventListener('click', function () {
    var t = curTeam();
    if (!t) return;
    var header, rowOf;
    if (t.kind === 'overseas') {
      header = OV_FIELDS.map(function (f) { return f[1]; });
      rowOf = function (c) {
        return OV_FIELDS.map(function (f) { return String(c[f[0]] == null ? '' : c[f[0]]); });
      };
    } else if (t.kind === 'neurips') {
      header = NR_FIELDS.map(function (f) { return f[1]; });
      rowOf = function (c) {
        return NR_FIELDS.map(function (f) { return String(c[f[0]] == null ? '' : c[f[0]]); });
      };
    } else {
      header = ['候选人', '类型', '一轮面试官', '一轮结果', '二轮面试官', '二轮结果', '三轮面试官', '三轮结果', '备注', '来源'];
      rowOf = function (c) {
        return [c.name, c.type,
          (c.r1 && c.r1.interviewer) || '', (c.r1 && c.r1.result) || '',
          (c.r2 && c.r2.interviewer) || '', (c.r2 && c.r2.result) || '',
          (c.r3 && c.r3.interviewer) || '', (c.r3 && c.r3.result) || '',
          c.note || '', c.source || ''];
      };
    }
    var lines = [header.join('\t')];
    (t.candidates || []).forEach(function (c) { lines.push(rowOf(c).join('\t')); });
    var text = lines.join('\n');
    var done = function () { toast('已复制 ' + t.candidates.length + ' 行到剪贴板，可直接粘贴进 Excel 或其他团队'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else {
      fallbackCopy(text); done();
    }
  });

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  $('btnSave').addEventListener('click', save);
}

/* ---------- 保存 ---------- */

async function save() {
  if (mode !== 'live') {
    toast('静态快照模式无法保存，请通过 node server.js 启动后访问', true);
    return;
  }
  try {
    var r = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teams: DATA.teams })
    });
    var j = await r.json();
    if (!r.ok || !j.ok) {
      toast('保存失败：' + (j.error || ('HTTP ' + r.status)), true);
      return;
    }
    setDirty(false);
    toast(j.autoPublish
      ? '✅ 已保存 · 正在自动发布到公网（约 1~2 分钟后生效）'
      : '✅ 已保存，前台刷新即可看到最新内容');
  } catch (e) {
    toast('保存失败：' + e.message, true);
  }
}

/* ---------- 粘贴导入 ---------- */

function cleanCell(s) {
  return String(s == null ? '' : s)
    .replace(/^[\s✅✔☑⏰⏳❌📞☎️🎉⏸️⏸]+/u, '')
    .replace(/\s+$/, '')
    .trim();
}

function parseTSV(text, kind) {
  var lines = String(text || '').split(/\r?\n/);
  // 去掉行尾多余 tab（Excel 复制常见）
  lines = lines.map(function (l) { return l.replace(/\t+$/, ''); })
    .filter(function (l) { return l.trim() !== ''; });
  // 跳过表头行
  if (kind === 'overseas') {
    if (lines.length && lines[0].indexOf('姓名') >= 0 && lines[0].indexOf('公司') >= 0) lines.shift();
  } else if (kind === 'neurips') {
    if (lines.length && lines[0].indexOf('姓名') >= 0 && lines[0].indexOf('转化类型') >= 0) lines.shift();
  } else if (lines.length && lines[0].indexOf('候选人') >= 0 && lines[0].indexOf('类型') >= 0) {
    lines.shift();
  }
  var skipped = 0;
  var rows = lines.map(function (l) {
    var c = l.split('\t').map(cleanCell);
    var nameCol = kind === 'overseas' || kind === 'neurips' ? 1 : 0;
    if (!c[nameCol] || c.length < 2) { skipped += 1; return null; }
    if (kind === 'overseas') {
      return {
        status: c[0] || '', name: c[1] || '', company: c[2] || '', field: c[3] || '',
        degree: c[4] || '', degreeSchool: c[5] || '', degreeYear: c[6] || '',
        bachelorSchool: c[7] || '', bachelorYear: c[8] || '', team: c[9] || '',
        exchange: c[10] || '', salary: c[11] || '', bio: c[12] || '', mark: ''
      };
    }
    if (kind === 'neurips') {
      var o = { mark: '' };
      NR_FIELDS.forEach(function (f, i) { o[f[0]] = c[i] || ''; });
      return o;
    }
    return {
      name: c[0], type: c[1] || '',
      r1: { interviewer: c[2] || '', result: c[3] || '' },
      r2: { interviewer: c[4] || '', result: c[5] || '' },
      r3: { interviewer: c[6] || '', result: c[7] || '' },
      note: c[8] || '', source: c[9] || '', mark: ''
    };
  }).filter(Boolean);
  return { rows: rows, skipped: skipped };
}

function bindImport() {
  $('btnPreview').addEventListener('click', function () {
    var kind = isOvTeam() ? 'overseas' : 'std';
    var res = parseTSV($('importText').value, kind);
    parsedRows = res.rows;
    if (!res.rows.length) {
      $('importInfo').textContent = '没有解析到有效行（需要至少前两列，用 Tab 分隔）';
      $('importPreview').innerHTML = '';
      return;
    }
    $('importInfo').textContent = '解析到 ' + res.rows.length + ' 行' +
      (res.skipped ? '，跳过 ' + res.skipped + ' 行' : '');
    var head, cell;
    if (kind === 'overseas') {
      head = ['状态', '姓名', '公司', '研究领域', '毕业院校', '交流团队', '交流情况', '薪资情况'];
      cell = function (r) {
        return [r.status || '—', r.name, r.company, r.field || '—', r.degreeSchool || '—',
          r.team || '—', r.exchange || '—', r.salary || '—'];
      };
    } else if (kind === 'neurips') {
      head = ['状态', '姓名', '中文姓名', '分类', '当前所在', '最高学历院校', '研究方向', '转化类型', '交流情况'];
      cell = function (r) {
        return [r.status || '—', r.name, r.nameCn || '—', r.category || '—', r.current || '—',
          r.degreeSchool || '—', r.field || '—', r.outreach || '—', r.exchange || '—'];
      };
    } else {
      head = ['候选人', '类型', '一轮', '二轮', '三轮', '备注', '来源'];
      cell = function (r) {
        return [r.name, r.type,
          (r.r1.result ? r.r1.result + (r.r1.interviewer ? '·' + r.r1.interviewer : '') : '—'),
          (r.r2.result ? r.r2.result + (r.r2.interviewer ? '·' + r.r2.interviewer : '') : '—'),
          (r.r3.result ? r.r3.result + (r.r3.interviewer ? '·' + r.r3.interviewer : '') : '—'),
          r.note || '—', r.source || '—'];
      };
    }
    var max = Math.min(res.rows.length, 5);
    $('importPreview').innerHTML = '<div>前 ' + max + ' 行预览：</div><table><tr>' +
      head.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr>' +
      res.rows.slice(0, max).map(function (r) {
        return '<tr>' + cell(r).map(function (v) { return '<td>' + esc(v) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</table>' + (res.rows.length > max ? '<div>… 其余 ' + (res.rows.length - max) + ' 行将一并导入</div>' : '');
  });

  $('btnImport').addEventListener('click', function () {
    var t = curTeam();
    if (!t) return;
    if (!parsedRows || !parsedRows.length) {
      toast('请先点「解析预览」', true);
      return;
    }
    var replace = document.querySelector('input[name="impMode"]:checked').value === 'replace';
    if (replace) {
      if (!confirm('确定用导入的 ' + parsedRows.length + ' 行替换「' + t.name + '」现有的 ' + t.candidates.length + ' 行？')) return;
      t.candidates = parsedRows.slice();
    } else {
      t.candidates = (t.candidates || []).concat(parsedRows.slice());
    }
    setDirty(true);
    renderTabs();
    renderEditor();
    $('importText').value = '';
    $('importPreview').innerHTML = '';
    $('importInfo').textContent = '';
    parsedRows = null;
    $('importBox').open = false;
    toast('已导入 ' + t.candidates.length + ' 行（还未保存，请点「保存全部」）');
  });
}

/* ---------- 飞书同步（多文档：每团队一个链接） ---------- */

var FS_CFG = { appId: '', teams: {} };

function fsLog(html) { $('fsLog').innerHTML = html; }
function fsInfo(text) { $('fsInfo').textContent = text; }

function saveFsConfigNow() {
  return fetch('/api/feishu/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appId: $('fsAppId').value.trim(),
      appSecret: $('fsSecret').value.trim(),
      teams: collectTeams()
    })
  });
}

// 面板输入停顿后自动保存，刷新/重启后不丢
var fsSaveTimer = null;
function scheduleFsAutoSave() {
  clearTimeout(fsSaveTimer);
  fsSaveTimer = setTimeout(async function () {
    if (mode !== 'live') return;
    try {
      var r = await saveFsConfigNow();
      var j = await r.json();
      if (j.ok) {
        $('fsSecret').placeholder = '已保存（留空则不修改）';
        fsInfo('已自动保存 ✓ ' + new Date().toTimeString().slice(0, 8));
      }
    } catch (e) { /* 静默失败，下次输入再试 */ }
  }, 1500);
}

async function loadFeishuConfig() {
  try {
    var r = await fetch('/api/feishu/config', { cache: 'no-store' });
    if (!r.ok) return;
    FS_CFG = await r.json();
    $('fsAppId').value = FS_CFG.appId || '';
    if (FS_CFG.appSecret) $('fsSecret').placeholder = '已保存（留空则不修改）';
    renderFsMapping();
  } catch (e) { /* 静态模式下无此接口 */ }
}

function renderFsMapping() {
  var wrap = $('fsMapping');
  if (!DATA || !DATA.teams) return;
  wrap.innerHTML = DATA.teams.map(function (t) {
    var cfg = (FS_CFG.teams || {})[t.id] || {};
    return '<div class="fs-map-row">' +
      '<span class="fs-team" title="' + esc(t.name) + '">' + esc(t.name) + '</span>' +
      '<input type="text" id="fsUrl_' + esc(t.id) + '" value="' + esc(cfg.docUrl || '') +
      '" placeholder="粘贴该团队的飞书表格链接（/sheets/… 或 /wiki/…）">' +
      '<input type="text" id="fsSheet_' + esc(t.id) + '" class="fs-sheet" value="' + esc(cfg.sheet || '') +
      '" placeholder="sheet 名（可选）" title="同一篇文档里有多个 sheet 时填写；留空取第一个">' +
      '</div>';
  }).join('');
}

function collectTeams() {
  var m = {};
  DATA.teams.forEach(function (t) {
    var u = $('fsUrl_' + t.id), s = $('fsSheet_' + t.id);
    if (u) m[t.id] = { docUrl: u.value.trim(), sheet: s ? s.value.trim() : '' };
  });
  return m;
}

function shortUrl(u) {
  var m = String(u).match(/\/(sheets|wiki|base|docx)\/([A-Za-z0-9]{6})/);
  return m ? '…/' + m[1] + '/' + m[2] + '…' : u;
}

function bindFeishu() {
  // 输入即自动保存（App ID / Secret / 各团队链接）
  ['fsAppId', 'fsSecret'].forEach(function (id) {
    $(id).addEventListener('input', scheduleFsAutoSave);
  });
  $('fsMapping').addEventListener('input', scheduleFsAutoSave);

  $('fsSave').addEventListener('click', async function () {
    try {
      var r = await saveFsConfigNow();
      var j = await r.json();
      if (!j.ok) throw new Error('HTTP ' + r.status);
      $('fsSecret').value = '';
      $('fsSecret').placeholder = '已保存（留空则不修改）';
      fsInfo('配置已保存 ✓');
      toast('飞书配置已保存');
    } catch (e) {
      toast('保存失败：' + e.message, true);
    }
  });

  $('fsTest').addEventListener('click', async function () {
    fsInfo('连接中…');
    try {
      await saveFsConfigNow(); // 顺手持久化，刷新不丢
      var cfg = {
        appId: $('fsAppId').value.trim(),
        teams: collectTeams()
      };
      if ($('fsSecret').value.trim()) cfg.appSecret = $('fsSecret').value.trim();
      var r = await fetch('/api/feishu/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: cfg })
      });
      var j = await r.json();
      if (!j.ok) throw new Error(j.error || ('HTTP ' + r.status));

      var lines = (j.results || []).map(function (x) {
        if (!x.ok) {
          return '<div style="color:#b23333">❌ ' + esc(shortUrl(x.url)) + '：' + esc(x.error) + '</div>';
        }
        return '<div>✅ ' + esc(shortUrl(x.url)) + ' · ' + x.sheets.length + ' 个 sheet：' +
          x.sheets.map(function (s) { return '<span class="chip">' + esc(s.title) + '</span>'; }).join(' ') +
          '</div>';
      }).join('');
      fsLog('<div><b>连接测试完成</b>（共 ' + (j.results || []).length + ' 篇文档）</div>' + lines);
      fsInfo('测试完成 ✓');

      // 自动填 sheet 名：单 sheet 直接填；多 sheet 时找与团队名匹配的（不覆盖已填内容）
      DATA.teams.forEach(function (t) {
        var u = $('fsUrl_' + t.id), s = $('fsSheet_' + t.id);
        if (!u || !s || s.value.trim() || !u.value.trim()) return;
        var hit = (j.results || []).find(function (x) { return x.ok && x.url === u.value.trim(); });
        if (!hit) return;
        if (hit.sheets.length === 1) { s.value = hit.sheets[0].title; return; }
        var b = t.name.replace(/\s/g, '').toLowerCase();
        var match = hit.sheets.find(function (sh) {
          var a = sh.title.replace(/\s/g, '').toLowerCase();
          return a === b || (b && a.indexOf(b) >= 0) || (a && b.indexOf(a) >= 0);
        });
        if (match) s.value = match.title;
      });
    } catch (e) {
      fsInfo('');
      fsLog('<div style="color:#b23333">❌ ' + esc(e.message) + '</div>' +
        '<div style="color:#8071a0;font-size:12px;margin-top:4px">常见原因：App ID/Secret 不对；应用没发布；对应文档没有添加文档应用（每篇文档都要添加）。</div>');
    }
  });

  $('fsSync').addEventListener('click', async function () {
    var btn = this;
    btn.disabled = true;
    fsInfo('同步中…');
    try {
      // 先把面板当前内容持久化（不用先点「保存配置」），再同步
      await saveFsConfigNow();
      var r = await fetch('/api/feishu/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      var j = await r.json();
      if (!j.ok) throw new Error(j.error || ('HTTP ' + r.status));
      var lines = (j.results || []).filter(function (x) { return !x.skipped; }).map(function (x) {
        return x.error
          ? '<div style="color:#b23333">❌ ' + esc(x.name) + '：' + esc(x.error) + '</div>'
          : '<div>✅ ' + esc(x.name) + '：同步 ' + x.count + ' 人（sheet：' + esc(x.sheet || '—') + '）</div>';
      }).join('');
      var skipped = (j.results || []).filter(function (x) { return x.skipped; }).map(function (x) { return x.name; });
      fsLog('<div><b>同步完成</b></div>' + lines +
        (skipped.length ? '<div class="muted" style="font-size:12px;margin-top:4px">未参与同步（未填链接）：' + esc(skipped.join('、')) + '</div>' : ''));
      fsInfo('同步完成 ✓');
      toast('✅ 已从飞书同步，前台刷新即可看到最新');
      // 重新加载看板数据并刷新编辑器
      var r2 = await fetch('/api/data', { cache: 'no-store' });
      DATA = await r2.json();
      renderTabs();
      renderMeta();
      renderEditor();
    } catch (e) {
      fsInfo('');
      fsLog('<div style="color:#b23333">❌ 同步失败：' + esc(e.message) + '</div>');
      toast('同步失败：' + e.message, true);
    } finally {
      btn.disabled = false;
    }
  });
}

/* ---------- 分享弹窗 ---------- */

function bindShare() {
  var mask = $('shareModal');
  var QR = null; // 当前二维码对应的地址

  function setQr(url) {
    if (!url || QR === url) return;
    QR = url;
    var box = $('shareQr');
    if (typeof qrcode === 'function') {
      try {
        var q = qrcode(0, 'M'); q.addData(url); q.make();
        box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
        return;
      } catch (e) { /* 类型放不下时降级 */ }
      try {
        var q2 = qrcode(6, 'M'); q2.addData(url); q2.make();
        box.innerHTML = q2.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
        return;
      } catch (e) { box.innerHTML = ''; }
    } else { box.innerHTML = ''; }
  }

  function setTunnelUI(j) {
    var running = j.tunnelRunning && j.tunnelUrl;
    $('tunnelUrlBox').style.display = running ? 'flex' : 'none';
    if (running) $('tunnelUrlText').textContent = j.tunnelUrl;
    $('btnTunnel').textContent = running ? '🔄 刷新地址' : '🚀 启动公网隧道';
    $('tunnelHint').textContent = running
      ? '公网地址已生效（电脑关机/服务停止即失效；每次启动地址会变化）'
      : '启动后会得到一个 https 公网网址，任何网络都能访问（依赖 Cloudflare 中转）';
  }

  $('btnShare').addEventListener('click', async function () {
    mask.style.display = 'flex';
    $('shareUrls').innerHTML = '<div class="muted">获取地址中…</div>';
    try {
      var r = await fetch('/api/share', { cache: 'no-store' });
      var j = await r.json();
      var urls = j.urls || [];
      $('shareUrls').innerHTML = urls.length
        ? urls.map(function (u) {
            return '<div class="share-url"><span class="share-link">' + esc(u) +
              '</span><button class="btn ghost small" data-copy="' + esc(u) + '">复制</button></div>';
          }).join('')
        : '<div class="muted">这台电脑没有检测到局域网 IP</div>';
      Array.prototype.forEach.call($('shareUrls').querySelectorAll('[data-copy]'), function (btn) {
        btn.addEventListener('click', function () { copyText(this.getAttribute('data-copy')); });
      });
      // 公网隧道状态
      setTunnelUI(j);
      if (j.tunnelRunning && j.tunnelUrl) {
        $('tunnelUrlText').textContent = j.tunnelUrl;
        setQr(j.tunnelUrl);
      } else {
        setQr(urls[0]);
      }
      // 口令
      $('pubKeyInput').value = j.publicKey || '';
      // GitHub Pages
      $('pagesRepoInput').value = j.pagesRepo || '';
      $('autoPubChk').checked = !!j.autoPublish;
      // 观众端显示
      $('hideSrcChk').checked = !!j.hideSource;
    } catch (e) {
      $('shareUrls').innerHTML = '<div class="muted">获取失败（该接口仅限本机访问）</div>';
    }
  });

  $('btnCopyTunnel').addEventListener('click', function () {
    copyText($('tunnelUrlText').textContent.trim());
  });

  $('btnTunnel').addEventListener('click', async function () {
    var btn = this;
    btn.disabled = true;
    $('tunnelHint').textContent = '正在启动隧道（约 3~8 秒）…';
    try {
      var r = await fetch('/api/tunnel/start', { method: 'POST' });
      var j = await r.json();
      if (!j.ok) throw new Error(j.error || 'HTTP ' + r.status);
      $('tunnelUrlText').textContent = j.url;
      $('tunnelUrlBox').style.display = 'flex';
      $('tunnelHint').textContent = '公网地址已生效（电脑关机/服务停止即失效；每次启动地址会变化）';
      btn.textContent = '🔄 刷新地址';
      setQr(j.url);
      toast('🚀 公网地址已就绪：' + j.url);
    } catch (e) {
      $('tunnelHint').textContent = e.message;
      toast('启动失败：' + e.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  $('btnStopTunnel').addEventListener('click', async function () {
    try {
      await fetch('/api/tunnel/stop', { method: 'POST' });
      $('tunnelUrlBox').style.display = 'none';
      $('btnTunnel').textContent = '🚀 启动公网隧道';
      $('tunnelHint').textContent = '隧道已关闭';
      setQr(($('shareUrls').querySelector('.share-link') || {}).textContent || '');
      QR = null;
    } catch (e) { toast('关闭失败：' + e.message, true); }
  });

  // 保存时自动发布开关
  $('autoPubChk').addEventListener('change', async function () {
    try {
      var r = await fetch('/api/pages/autopublish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: this.checked })
      });
      var j = await r.json();
      if (!j.ok) throw new Error('HTTP ' + r.status);
      toast(j.autoPublish
        ? '📦 已开启自动发布：每次保存后公网自动更新（需已设仓库与口令）'
        : '已关闭自动发布，需要手动点「📤 发布」');
    } catch (e) {
      this.checked = !this.checked;
      toast('设置失败：' + e.message, true);
    }
  });

  $('btnPubKey').addEventListener('click', async function () {
    try {
      var r = await fetch('/api/public-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: $('pubKeyInput').value.trim() })
      });
      var j = await r.json();
      if (!j.ok) throw new Error('HTTP ' + r.status);
      $('pubKeyInput').value = j.publicKey || '';
      toast(j.publicKey ? '🔒 已设置口令：公网打开页面需先输入口令' : '已关闭口令：公网完全公开（注意风险）');
    } catch (e) {
      toast('保存失败：' + e.message, true);
    }
  });

  // 观众端显示：隐藏来源列
  $('hideSrcChk').addEventListener('change', async function () {
    try {
      var r = await fetch('/api/view-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hideSource: this.checked })
      });
      var j = await r.json();
      if (!j.ok) throw new Error('HTTP ' + r.status);
      var scope = [];
      scope.push('局域网/公网观众刷新页面后生效');
      if (j.hideSource) scope.push('「来源」列已从观众端整体移除');
      else scope.push('「来源」列已恢复显示');
      hint.textContent = '✓ 已保存：' + scope.join('；') + '（GitHub Pages 随下次发布或自动发布更新）';
      toast(j.hideSource ? '👁 已隐藏观众端「来源」列' : '👁 已恢复观众端「来源」列');
    } catch (e) {
      this.checked = !this.checked;
      toast('设置失败：' + e.message, true);
    }
  });

  $('btnPagesPublish').addEventListener('click', async function () {
    var btn = this;
    var hint = $('pagesHint');
    btn.disabled = true;
    hint.textContent = '发布中（加密 → 构建 → 推送，约 10~60 秒）…';
    // 口令有改动时先保存，保证加密使用最新口令
    try {
      await fetch('/api/public-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: $('pubKeyInput').value.trim() })
      });
    } catch (e) { /* 继续 */ }
    try {
      var r = await fetch('/api/pages/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: $('pagesRepoInput').value.trim() })
      });
      var j = await r.json();
      if (!j.ok) throw new Error(j.error || 'HTTP ' + r.status);
      if (j.url) {
        $('pagesUrlText').textContent = j.url;
        $('pagesUrlBox').style.display = 'flex';
        hint.innerHTML = '✅ 已发布（Pages 构建约 1 分钟后生效）。改完数据在这里重新点「📤 发布」即可更新';
      } else {
        hint.textContent = '✅ 已发布';
      }
      toast('📦 已发布到 GitHub Pages');
    } catch (e) {
      hint.textContent = '❌ ' + e.message;
      toast('发布失败：' + e.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  $('btnCopyPages').addEventListener('click', function () {
    copyText($('pagesUrlText').textContent.trim());
  });

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('链接已复制'); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      toast('链接已复制');
    }
  }

  $('shareClose').addEventListener('click', function () { mask.style.display = 'none'; });
  mask.addEventListener('click', function (e) { if (e.target === mask) mask.style.display = 'none'; });
}

/* ---------- datalist ---------- */

function injectDatalists() {
  var dl1 = document.createElement('datalist');
  dl1.id = 'dlType';
  dl1.innerHTML = TYPE_OPTIONS.map(function (o) { return '<option value="' + o + '">'; }).join('');
  var dl2 = document.createElement('datalist');
  dl2.id = 'dlSource';
  dl2.innerHTML = SOURCE_OPTIONS.map(function (o) { return '<option value="' + o + '">'; }).join('');
  document.body.appendChild(dl1);
  document.body.appendChild(dl2);
}

/* ---------- 初始化 ---------- */

window.addEventListener('beforeunload', function (e) {
  if (dirty && mode === 'live') {
    e.preventDefault();
    e.returnValue = '';
  }
});

document.addEventListener('DOMContentLoaded', function () {
  injectDatalists();
  bindMeta();
  bindEditor();
  bindToolbar();
  bindImport();
  bindFeishu();
  bindShare();
  boot().then(function () {
    if (mode === 'live') loadFeishuConfig();
  });
});
