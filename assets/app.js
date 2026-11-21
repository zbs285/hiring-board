/* ============================================================
   招聘进展看板 · 公共渲染逻辑
   数据来源自适应：
   - 通过服务器访问 → fetch('/api/data') 实时数据
   - 直接双击 HTML 打开 → 读 assets/data.js 静态快照
   ============================================================ */
'use strict';

/* ---------- 状态定义 ---------- */

var STATUS_META = {
  offer: { label: 'Offer/入职', icon: '🎉', cls: 'b-offer', seg: 'seg-offer' },
  run:   { label: '流程中',     icon: '🔄', cls: 'b-wait',  seg: 'seg-run'   },
  hold:  { label: '暂缓',       icon: '⏸',  cls: 'b-hold',  seg: 'seg-hold'  },
  quit:  { label: '已退出',     icon: '🚪', cls: 'b-none',  seg: 'seg-quit'  },
  fail:  { label: '不通过',     icon: '❌', cls: 'b-fail',  seg: 'seg-fail'  },
  new:   { label: '待推进',     icon: '🆕', cls: 'b-none',  seg: 'seg-new'   }
};

/* 行颜色标记（红=意向 白=流程中 绿=待入职 蓝=已入职 灰=淘汰/长期跟踪） */
var MARK_META = {
  '意向':   { cls: 'mk-intent',  sw: 'sw-red'   },
  '待入职': { cls: 'mk-join',    sw: 'sw-green' },
  '已入职': { cls: 'mk-onboard', sw: 'sw-blue'  },
  '淘汰/长期跟踪': { cls: 'mk-out', sw: 'sw-gray' }
};

/* NeurIPS 建联名单（独立表结构） */
var NR_FIELDS = [
  ['status', '状态'], ['name', '姓名'], ['nameCn', '中文姓名'], ['category', '分类'],
  ['current', '当前所在'], ['degree', '最高学历'], ['degreeSchool', '最高学历院校'],
  ['major', '专业'], ['degreeYear', '毕业时间'], ['bachelorSchool', '本科院校'],
  ['field', '研究方向'], ['outreach', '转化类型'], ['link', '个人主页/Linkedin'],
  ['resume', '是否获取简历'], ['exchange', '交流情况'], ['focus', '重点关注']
];

// 状态值（'00 待推荐' 等）归一到五档阶段；无法识别返回 ''
function stageOfStatus(s) {
  var t = String(s || '').replace(/\s+/g, '');
  if (!t) return '';
  var m = t.match(/^(\d{2})/);
  if (m) {
    for (var i = 0; i < OV_STAGES.length; i++) {
      if (OV_STAGES[i].replace(/\s+/g, '').indexOf(m[1]) === 0) return OV_STAGES[i];
    }
  }
  var n = t.toLowerCase();
  for (var j = 0; j < OV_STAGES.length; j++) {
    if (OV_STAGES[j].replace(/\s+/g, '').toLowerCase() === n) return OV_STAGES[j];
  }
  return '';
}

/* 海外人才汇总（独立表结构） */
var OV_STAGES = ['00 待推荐', '01 已推荐', '02 交流中', '03 Offer中', '04 长期跟踪'];
var OV_STAGE_CLS = {
  '00 待推荐': 'b-none', '01 已推荐': 'b-hold', '02 交流中': 'b-wait',
  '03 Offer中': 'b-pend', '04 长期跟踪': 'b-pass'
};
var OV_STAGE_SEG = {
  '00 待推荐': 'seg-quit', '01 已推荐': 'seg-hold', '02 交流中': 'seg-run',
  '03 Offer中': 'seg-offer', '04 长期跟踪': 'seg-track'
};
var OV_STAGE_CHIP = {
  '00 待推荐': 'c-st00', '01 已推荐': 'c-st01', '02 交流中': 'c-st02',
  '03 Offer中': 'c-st03', '04 长期跟踪': 'c-st04'
};
var OV_FIELDS = [
  ['status', '状态'], ['name', '姓名'], ['company', '公司'], ['field', '研究领域'],
  ['degree', '最高学历'], ['degreeSchool', '最高学历毕业院校'], ['degreeYear', '最高学历毕业时间'],
  ['bachelorSchool', '本科院校'], ['bachelorYear', '本科毕业时间'],
  ['team', '交流团队'], ['exchange', '交流情况'], ['salary', '薪资情况'], ['bio', '人选简介']
];

function markOf(c) { return String(c.mark || '').trim(); }
function markClass(mark) { return MARK_META[mark] ? MARK_META[mark].cls : ''; }

function stageBadge(v) {
  v = String(v || '').trim();
  if (!v) return '<span class="dim">—</span>';
  return '<span class="badge ' + (OV_STAGE_CLS[v] || 'b-none') + '">' + esc(v) + '</span>';
}

/* ---------- 基础工具 ---------- */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pad(n) { return (n < 10 ? '0' : '') + n; }

function formatTime(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function b64u8(s) {
  var b = atob(s);
  var u = new Uint8Array(b.length);
  for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}

function showUnlockOverlay(onTry, onDone) {
  var mask = document.createElement('div');
  mask.className = 'unlock-mask';
  mask.innerHTML =
    '<div class="unlock-card">' +
      '<div class="unlock-logo">🎓</div><h1>招聘进展看板</h1>' +
      '<p>内部数据 · 请输入访问口令</p>' +
      '<input type="password" placeholder="访问口令" autocomplete="off">' +
      '<button>进 入</button>' +
      '<div class="unlock-err">口令不正确，请重试</div>' +
    '</div>';
  document.body.appendChild(mask);
  var input = mask.querySelector('input');
  var err = mask.querySelector('.unlock-err');
  var go = function () {
    var v = input.value;
    if (!v) return;
    err.style.display = 'none';
    onTry(v).then(function (ok) {
      if (ok) { mask.remove(); onDone(v); }
      else err.style.display = 'block';
    });
  };
  mask.querySelector('button').addEventListener('click', go);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
}

function decryptPages(pass) {
  var e = window.__ENC__;
  var keyMat, key;
  return crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey'])
    .then(function (km) {
      keyMat = km;
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: b64u8(e.s), iterations: e.it || 120000, hash: 'SHA-256' },
        keyMat, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    })
    .then(function (k) {
      key = k;
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u8(e.i) }, key, b64u8(e.d));
    })
    .then(function (plain) {
      return JSON.parse(new TextDecoder().decode(plain));
    });
}

// GitHub Pages 公网快照：口令解锁后把解密结果交给标准渲染流程
function unlockPages() {
  return new Promise(function (resolve) {
    var attempt = function (pass) {
      return decryptPages(pass)
        .then(function (data) { return { ok: true, data: data }; },
          function () { return { ok: false }; });
    };
    var finish = function (data, pass) {
      window.__SNAPSHOT__ = data;
      if (pass) localStorage.setItem('hb-pages-pass', pass);
      resolve({ data: data, mode: 'pages' });
    };
    var saved = localStorage.getItem('hb-pages-pass');
    if (saved) {
      attempt(saved).then(function (r) {
        if (r.ok) return finish(r.data, saved);
        localStorage.removeItem('hb-pages-pass');
        showUnlockOverlay(attempt, function (pass) {
          return attempt(pass).then(function (r2) {
            if (r2.ok) finish(r2.data, pass);
            return r2.ok;
          });
        });
      });
    } else {
      showUnlockOverlay(attempt, function (pass) {
        return attempt(pass).then(function (r2) {
          if (r2.ok) finish(r2.data, pass);
          return r2.ok;
        });
      });
    }
  });
}

async function loadData() {
  // GitHub Pages 公网快照：需口令解密后渲染
  if (window.__ENC__ && !window.__ENC_DATA__) {
    return unlockPages().then(function (r) {
      window.__ENC_DATA__ = r.data;
      return { data: r.data, mode: 'pages' };
    });
  }
  if (window.__ENC_DATA__) {
    return { data: window.__ENC_DATA__, mode: 'pages' };
  }
  try {
    var r = await fetch('api/data', { cache: 'no-store' });
    if (!r.ok) throw new Error('bad status');
    var d = await r.json();
    return { data: d, mode: 'live' };
  } catch (e) {
    return {
      data: window.__SNAPSHOT__ || { updatedAt: '', teams: [] },
      mode: 'snapshot'
    };
  }
}

function modeChipHTML(mode, updatedAt) {
  var chip;
  if (mode === 'live') chip = '<span class="mode-chip live">● 实时数据</span>';
  else if (mode === 'pages') chip = '<span class="mode-chip snap">🌐 公网快照</span>';
  else chip = '<span class="mode-chip snap">◐ 静态快照</span>';
  var time = updatedAt ? '<span>最近更新：' + esc(formatTime(updatedAt)) + '</span>' : '';
  return chip + time;
}

/* ---------- 候选人状态推断 ---------- */

function statusOf(c) {
  var rs = ['r1', 'r2', 'r3'].map(function (k) {
    return String((c[k] && c[k].result) || '').trim();
  });
  var note = String(c.note || '');
  if (rs.some(function (s) { return s.indexOf('不通过') >= 0; })) return 'fail';
  if (rs.some(function (s) { return s.indexOf('暂缓') >= 0; })) return 'hold';
  if (note.indexOf('退出') >= 0) return 'quit';
  if (/offer|入职/i.test(note) || rs[2].indexOf('通过') >= 0) return 'offer';
  if (rs.some(function (s) {
    return s.indexOf('通过') >= 0 || s.indexOf('待面试') >= 0 || s.indexOf('待约') >= 0;
  })) return 'run';
  return 'new';
}

function countStatuses(team) {
  var c = { total: 0, offer: 0, run: 0, hold: 0, quit: 0, fail: 0, new: 0 };
  (team.candidates || []).forEach(function (x) {
    c.total += 1;
    c[statusOf(x)] += 1;
  });
  return c;
}

/* ---------- 徽章渲染 ---------- */

function resultBadge(text) {
  var t = String(text || '').trim();
  if (!t) return '<span class="badge b-none">暂无</span>';
  if (t.indexOf('不通过') >= 0) return '<span class="badge b-fail">❌ ' + esc(t) + '</span>';
  if (t.indexOf('暂缓') >= 0) return '<span class="badge b-hold">⏳ ' + esc(t) + '</span>';
  if (t.indexOf('待面试') >= 0) return '<span class="badge b-wait">⏰ ' + esc(t) + '</span>';
  if (t.indexOf('待约') >= 0) return '<span class="badge b-pend">📞 ' + esc(t) + '</span>';
  if (t.indexOf('通过') >= 0) return '<span class="badge b-pass">✅ ' + esc(t) + '</span>';
  return '<span class="badge b-none">' + esc(t) + '</span>';
}

function interviewerCell(text) {
  var t = String(text || '').trim();
  if (!t) return '<span class="dim">—</span>';
  if (t === '待安排') return '<span class="badge b-none">待安排</span>';
  return esc(t);
}

function typePill(t) {
  var s = String(t || '').trim();
  return s ? '<span class="pill pill-type">' + esc(s) + '</span>' : '<span class="dim">—</span>';
}

function sourcePill(s) {
  var t = String(s || '').trim();
  if (!t) return '<span class="dim">—</span>';
  var cls = 'pill pill-src';
  if (/boss/i.test(t)) cls += ' src-boss';
  else if (t.indexOf('猎头') >= 0) cls += ' src-hh';
  else if (t.indexOf('内推') >= 0) cls += ' src-ref';
  return '<span class="' + cls + '">' + esc(t) + '</span>';
}

function statusBadge(key) {
  var m = STATUS_META[key] || STATUS_META.new;
  return '<span class="badge ' + m.cls + '">' + m.icon + ' ' + m.label + '</span>';
}

/* ============================================================
   首页
   ============================================================ */

async function renderIndex() {
  var res = await loadData();
  var data = res.data;
  var teams = data.teams || [];

  document.getElementById('heroMeta').innerHTML = modeChipHTML(res.mode, data.updatedAt);

  // 总览统计（海外/NeurIPS 为独立口径，不计入招聘漏斗统计）
  var sum = { total: 0, offer: 0, run: 0, hold: 0, fail: 0 };
  teams.forEach(function (t) {
    if (t.kind === 'overseas' || t.kind === 'neurips') return;
    var c = countStatuses(t);
    sum.total += c.total; sum.offer += c.offer; sum.run += c.run;
    sum.hold += c.hold; sum.fail += c.fail;
  });

  var stats = [
    { ico: '👥', cls: '', num: sum.total, lbl: '候选人总数' },
    { ico: '🎉', cls: 'offer', num: sum.offer, lbl: 'Offer / 入职' },
    { ico: '🔄', cls: 'run', num: sum.run, lbl: '流程中' },
    { ico: '⏸', cls: 'hold', num: sum.hold, lbl: '暂缓' },
    { ico: '❌', cls: 'fail', num: sum.fail, lbl: '不通过' }
  ];
  document.getElementById('overallStats').innerHTML = stats.map(function (s) {
    return '<div class="stat-card"><div class="stat-ico ' + s.cls + '">' + s.ico +
      '</div><div><div class="stat-num">' + s.num + '</div><div class="stat-lbl">' +
      s.lbl + '</div></div></div>';
  }).join('');

  // 团队卡片
  var grid = document.getElementById('teamGrid');
  grid.innerHTML = teams.map(function (t, i) {
    if (t.kind === 'overseas') return overseasCard(t, i);
    if (t.kind === 'neurips') return neuripsCard(t, i);
    var c = countStatuses(t);
    var segs = '';
    ['offer', 'run', 'hold', 'quit', 'fail', 'new'].forEach(function (k) {
      if (c[k] > 0) {
        segs += '<span class="' + STATUS_META[k].seg + '" style="width:' +
          (c[k] / c.total * 100).toFixed(1) + '%"></span>';
      }
    });
    var chips =
      '<span class="chip c-offer">🎉 <b>' + c.offer + '</b> Offer</span>' +
      '<span class="chip c-run">🔄 <b>' + c.run + '</b> 流程中</span>' +
      (c.fail > 0 ? '<span class="chip c-fail">❌ <b>' + c.fail + '</b> 不通过</span>' : '');

    return '<a class="team-card" style="animation-delay:' + (i * 0.05) +
      's" href="team.html?id=' + encodeURIComponent(t.id) + '">' +
      '<div class="tc-head"><div class="tc-name">' + esc(t.name) + '</div>' +
      '<div class="tc-lead">👤 ' + esc(t.lead || '—') + '</div></div>' +
      (c.total === 0
        ? '<div class="tc-empty">暂无候选人记录</div>'
        : '<div class="tc-count"><span class="big">' + c.total + '</span>' +
          '<span class="lbl">位候选人</span></div>' +
          '<div class="tc-bar">' + segs + '</div>' +
          '<div class="tc-chips">' + chips + '</div>') +
      '<div class="tc-go">查看进展 →</div></a>';
  }).join('');
}

/* ============================================================
   团队详情页
   ============================================================ */

var teamState = { q: '', type: '', source: '', status: '', mark: '' };
var teamData = null;
var teamView = { hideSource: false }; // 观众端显示设置（来源列可见性等）

async function renderTeam() {
  var res = await loadData();
  var id = new URLSearchParams(location.search).get('id') || '';
  teamData = (res.data.teams || []).find(function (t) { return t.id === id; });

  var root = document.getElementById('teamPage');
  if (!teamData) {
    document.getElementById('pageHead').style.display = 'none';
    root.innerHTML =
      '<div style="text-align:center;padding:80px 0;color:#8071a0">' +
      '<div style="font-size:40px">🤔</div><p>没有找到这个团队</p>' +
      '<p><a href="index.html">← 返回首页</a></p></div>';
    return;
  }

  document.title = teamData.name + ' · 招聘进展';
  document.getElementById('teamName').textContent = teamData.name;
  document.getElementById('teamMeta').innerHTML =
    '<span>👤 负责人：' + esc(teamData.lead || '—') + '</span>' +
    (teamData.desc ? '<span>' + esc(teamData.desc) + '</span>' : '') +
    modeChipHTML(res.mode, res.data.updatedAt);

  // 海外人才汇总：独立表结构
  if (teamData.kind === 'overseas') {
    document.getElementById('stdView').style.display = 'none';
    renderOverseasView();
    return;
  }
  // NeurIPS 建联：独立表结构
  if (teamData.kind === 'neurips') {
    document.getElementById('stdView').style.display = 'none';
    renderNeuripsView();
    return;
  }
  document.getElementById('ovView').style.display = 'none';
  document.getElementById('nrView').style.display = 'none';

  // 观众端显示设置：是否隐藏来源列
  teamView.hideSource = !!(res.data.view && res.data.view.hideSource);
  var thSource = document.getElementById('thSource');
  if (thSource) thSource.style.display = teamView.hideSource ? 'none' : '';
  var fSourceEl = document.getElementById('fSource');
  if (fSourceEl) fSourceEl.style.display = teamView.hideSource ? 'none' : '';
  var stdTable = document.getElementById('stdTable');
  if (stdTable) stdTable.style.minWidth = teamView.hideSource ? '880px' : '980px';

  // 信息密度（紧凑默认，记忆在浏览器本地）
  var densityBtn = document.getElementById('densityBtn');
  var applyDensity = function () {
    var compact = (localStorage.getItem('hb-density') || 'compact') === 'compact';
    document.getElementById('teamPage').classList.toggle('compact', compact);
    densityBtn.textContent = compact ? '🔲 切换宽松' : '🔳 切换紧凑';
  };
  densityBtn.addEventListener('click', function () {
    var next = (localStorage.getItem('hb-density') || 'compact') === 'compact' ? 'cozy' : 'compact';
    localStorage.setItem('hb-density', next);
    applyDensity();
  });
  applyDensity();

  // 颜色图例（红=意向 白=流程中 绿=待入职 蓝=已入职 灰=淘汰/长期跟踪）
  document.getElementById('markLegend').innerHTML = '<b>行颜色</b>' +
    '<span class="lg-item"><i class="sw sw-red"></i>意向</span>' +
    '<span class="lg-item"><i class="sw sw-white"></i>流程中（默认）</span>' +
    '<span class="lg-item"><i class="sw sw-green"></i>待入职</span>' +
    '<span class="lg-item"><i class="sw sw-blue"></i>已入职</span>' +
    '<span class="lg-item"><i class="sw sw-gray"></i>淘汰/长期跟踪</span>';

  // 筛选选项
  var types = {}, sources = {};
  (teamData.candidates || []).forEach(function (c) {
    if ((c.type || '').trim()) types[c.type.trim()] = 1;
    if ((c.source || '').trim()) sources[c.source.trim()] = 1;
  });
  fillSelect('fType', Object.keys(types).sort());
  fillSelect('fSource', Object.keys(sources).sort());

  var filterMap = { fType: 'type', fSource: 'source', fStatus: 'status', fMark: 'mark' };
  Object.keys(filterMap).forEach(function (fid) {
    document.getElementById(fid).addEventListener('change', function () {
      teamState[filterMap[fid]] = this.value;
      drawTeamTable();
    });
  });
  document.getElementById('fSearch').addEventListener('input', function () {
    teamState.q = this.value.trim().toLowerCase();
    drawTeamTable();
  });

  drawTeamTable();
}

function fillSelect(id, options) {
  var sel = document.getElementById(id);
  var first = sel.querySelector('option');
  sel.innerHTML = first.outerHTML + options.map(function (o) {
    return '<option value="' + esc(o) + '">' + esc(o) + '</option>';
  }).join('');
}

function drawTeamTable() {
  var all = (teamData && teamData.candidates) || [];
  var st = teamState;
  var list = all.filter(function (c) {
    if (st.type && (c.type || '').trim() !== st.type) return false;
    if (st.source && (c.source || '').trim() !== st.source) return false;
    if (st.status && statusOf(c) !== st.status) return false;
    if (st.mark) {
      var mk = markOf(c);
      if (st.mark === '流程中') { if (mk !== '') return false; }
      else if (mk !== st.mark) return false;
    }
    if (st.q) {
      var hay = [c.name, c.note, c.source, c.type,
        c.r1 && c.r1.interviewer, c.r2 && c.r2.interviewer, c.r3 && c.r3.interviewer
      ].join(' ').toLowerCase();
      if (hay.indexOf(st.q) < 0) return false;
    }
    return true;
  });

  // 状态筛选 chips
  var cnt = countStatuses(teamData);
  var legend = document.getElementById('statusChips');
  legend.innerHTML = '<span class="chip" data-st=""><b>' + cnt.total + '</b> 全部</span>' +
    ['offer', 'run', 'hold', 'fail', 'quit', 'new'].map(function (k) {
      if (cnt[k] === 0 && k !== 'offer') return '';
      var m = STATUS_META[k];
      return '<span class="chip' + (teamState.status === k ? ' c-offer' : '') +
        '" data-st="' + k + '">' + m.icon + ' <b>' + cnt[k] + '</b> ' + m.label + '</span>';
    }).join('');
  Array.prototype.forEach.call(legend.querySelectorAll('[data-st]'), function (el) {
    el.style.cursor = 'pointer';
    el.addEventListener('click', function () {
      teamState.status = this.getAttribute('data-st');
      document.getElementById('fStatus').value = teamState.status;
      drawTeamTable();
    });
  });

  document.getElementById('filterCount').textContent =
    '显示 ' + list.length + ' / 共 ' + all.length + ' 人';
  var emptyRow = document.getElementById('emptyRow');
  if (emptyRow) emptyRow.firstElementChild.setAttribute('colspan', teamView.hideSource ? 9 : 10);

  var rows = list.map(function (c, i) {
    var mk = markOf(c);
    return '<tr class="' + markClass(mk) + '">' +
      '<td class="cand">' + (i + 1) + '. ' + esc(c.name) + '</td>' +
      '<td>' + typePill(c.type) + '</td>' +
      '<td>' + interviewerCell(c.r1 && c.r1.interviewer) + '</td>' +
      '<td>' + resultBadge(c.r1 && c.r1.result) + '</td>' +
      '<td>' + interviewerCell(c.r2 && c.r2.interviewer) + '</td>' +
      '<td>' + resultBadge(c.r2 && c.r2.result) + '</td>' +
      '<td>' + interviewerCell(c.r3 && c.r3.interviewer) + '</td>' +
      '<td>' + resultBadge(c.r3 && c.r3.result) + '</td>' +
      (c.note
        ? clampTd(c.note, false)
        : '<td><span class="dim">—</span></td>') +
      (teamView.hideSource ? '' : '<td>' + sourcePill(c.source) + '</td>') +
      '</tr>';
  }).join('');

  document.getElementById('teamTableBody').innerHTML = rows || '';
  document.getElementById('emptyRow').style.display = list.length ? 'none' : '';
  bindClampToggles('teamTableBody');
}

/* ============================================================
   海外人才汇总（独立表结构）
   ============================================================ */

var ovState = { q: '', status: '' };

function ovCounts(team) {
  var list = (team && team.candidates) || [];
  var c = { total: list.length, none: 0 };
  OV_STAGES.forEach(function (s) { c[s] = 0; });
  list.forEach(function (x) {
    var v = String(x.status || '').trim();
    if (c[v] !== undefined) c[v] += 1;
    else if (!v) c.none += 1;
  });
  return c;
}

function overseasCard(t, i) {
  var c = ovCounts(t);
  var segs = '', chips = '';
  if (c.total > 0) {
    OV_STAGES.forEach(function (s) {
      if (c[s] > 0) segs += '<span class="' + OV_STAGE_SEG[s] + '" style="width:' +
        (c[s] / c.total * 100).toFixed(1) + '%"></span>';
    });
    if (c.none > 0) segs += '<span class="seg-new" style="width:' +
      (c.none / c.total * 100).toFixed(1) + '%"></span>';
    OV_STAGES.forEach(function (s) {
      if (c[s] > 0) chips += '<span class="chip ' + OV_STAGE_CHIP[s] + '"><b>' + c[s] +
        '</b> ' + esc(s.slice(3)) + '</span>';
    });
    if (c.none > 0) chips += '<span class="chip">未标注 <b>' + c.none + '</b></span>';
  }
  return '<a class="team-card" style="animation-delay:' + (i * 0.05) +
    's" href="team.html?id=' + encodeURIComponent(t.id) + '">' +
    '<div class="tc-head"><div class="tc-name">' + esc(t.name) + '</div>' +
    '<div class="tc-lead">👤 ' + esc(t.lead || '—') + '</div></div>' +
    (c.total === 0
      ? '<div class="tc-empty">暂无人选记录</div>'
      : '<div class="tc-count"><span class="big">' + c.total + '</span>' +
        '<span class="lbl">位人选</span></div>' +
        '<div class="tc-bar">' + segs + '</div>' +
        '<div class="tc-chips">' + chips + '</div>') +
    '<div class="tc-go">查看汇总 →</div></a>';
}

function neuripsCard(t, i) {
  var list = (t.candidates || []);
  var total = list.length;
  // 按「状态」五档分布生成 chips
  var dist = {};
  OV_STAGES.forEach(function (st) { dist[st] = 0; });
  var none = 0;
  list.forEach(function (c) {
    var st = stageOfStatus(c.status);
    if (st) dist[st] += 1; else none += 1;
  });
  var segs = '';
  var chips = '';
  if (total > 0) {
    OV_STAGES.forEach(function (st) {
      if (dist[st] > 0) {
        segs += '<span class="' + OV_STAGE_SEG[st] + '" style="width:' +
          (dist[st] / total * 100).toFixed(1) + '%"></span>';
        chips += '<span class="chip ' + OV_STAGE_CHIP[st] + '"><b>' + dist[st] + '</b> ' +
          esc(st.slice(3)) + '</span>';
      }
    });
    if (none > 0) {
      segs += '<span class="seg-new" style="width:' + (none / total * 100).toFixed(1) + '%"></span>';
      chips += '<span class="chip">未标注 <b>' + none + '</b></span>';
    }
  }
  return '<a class="team-card" style="animation-delay:' + (i * 0.05) +
    's" href="team.html?id=' + encodeURIComponent(t.id) + '">' +
    '<div class="tc-head"><div class="tc-name">' + esc(t.name) + '</div>' +
    '<div class="tc-lead">👤 ' + esc(t.lead || '—') + '</div></div>' +
    (total === 0
      ? '<div class="tc-empty">暂无人选记录</div>'
      : '<div class="tc-count"><span class="big">' + total + '</span>' +
        '<span class="lbl">位人选</span></div>' +
        '<div class="tc-chips">' + chips + '</div>') +
    '<div class="tc-go">查看建联 →</div></a>';
}

function renderOverseasView() {
  var root = document.getElementById('ovView');
  root.style.display = '';
  root.innerHTML =
    '<div class="filter-bar">' +
      '<input type="text" id="ovSearch" placeholder="🔍 搜索姓名 / 公司 / 学校 / 研究领域…">' +
      '<select id="ovStatus"><option value="">全部状态</option>' +
        OV_STAGES.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('') +
        '<option value="__none">未标注</option>' +
      '</select>' +
      '<span class="filter-count" id="ovCount"></span>' +
    '</div>' +
    '<div class="legend" id="ovChips"></div>' +
    '<div class="tbl-wrap"><table class="tbl" style="min-width:1560px">' +
      '<thead><tr>' +
        OV_FIELDS.map(function (f) { return '<th>' + f[1] + '</th>'; }).join('') +
      '</tr></thead>' +
      '<tbody id="ovBody"></tbody>' +
      '<tbody><tr id="ovEmptyRow" style="display:none"><td colspan="13" style="text-align:center;padding:36px;color:#8071a0">没有符合筛选条件的人选</td></tr></tbody>' +
    '</table></div>';

  document.getElementById('ovSearch').addEventListener('input', function () {
    ovState.q = this.value.trim().toLowerCase();
    drawOverseas();
  });
  document.getElementById('ovStatus').addEventListener('change', function () {
    ovState.status = this.value;
    drawOverseas();
  });
  drawOverseas();
}

function drawOverseas() {
  var all = (teamData && teamData.candidates) || [];
  var list = all.filter(function (c) {
    if (ovState.status) {
      var v = String(c.status || '').trim();
      if (ovState.status === '__none') { if (v !== '') return false; }
      else if (v !== ovState.status) return false;
    }
    if (ovState.q) {
      var hay = OV_FIELDS.map(function (f) { return c[f[0]]; }).join(' ').toLowerCase();
      if (hay.indexOf(ovState.q) < 0) return false;
    }
    return true;
  });

  // 状态分段图例（点击即筛选）
  var cnt = ovCounts(teamData);
  document.getElementById('ovChips').innerHTML =
    '<span class="chip' + (ovState.status === '' ? ' c-offer' : '') + '" data-st=""><b>' + cnt.total + '</b> 全部</span>' +
    OV_STAGES.map(function (s) {
      return '<span class="chip ' + OV_STAGE_CHIP[s] + (ovState.status === s ? ' c-offer' : '') +
        '" data-st="' + esc(s) + '"><b>' + cnt[s] + '</b> ' + esc(s) + '</span>';
    }).join('') +
    (cnt.none > 0 ? '<span class="chip' + (ovState.status === '__none' ? ' c-offer' : '') +
      '" data-st="__none">未标注 <b>' + cnt.none + '</b></span>' : '');
  Array.prototype.forEach.call(document.getElementById('ovChips').querySelectorAll('[data-st]'), function (el) {
    el.style.cursor = 'pointer';
    el.addEventListener('click', function () {
      ovState.status = this.getAttribute('data-st');
      document.getElementById('ovStatus').value = ovState.status;
      drawOverseas();
    });
  });

  document.getElementById('ovCount').textContent = '显示 ' + list.length + ' / 共 ' + all.length + ' 人';

  var rows = list.map(function (c, i) {
    return '<tr>' + OV_FIELDS.map(function (f, fi) {
      var v = String(c[f[0]] == null ? '' : c[f[0]]);
      if (f[0] === 'status') return '<td>' + stageBadge(v) + '</td>';
      if (f[0] === 'name') return '<td class="cand">' + (i + 1) + '. ' + esc(v) + '</td>';
      if (!v) return '<td><span class="dim">—</span></td>';
      return '<td' + (f[0] === 'exchange' || f[0] === 'bio' ? ' class="note"' : '') + '>' + esc(v) + '</td>';
    }).join('') + '</tr>';
  }).join('');

  document.getElementById('ovBody').innerHTML = rows;
  document.getElementById('ovEmptyRow').style.display = list.length ? 'none' : '';
}

/* ============================================================
   NeurIPS 建联名单（独立表结构）
   ============================================================ */

var nrState = { q: '', category: '', outreach: '', status: '' };

function nrStageCounts(team) {
  var list = (team && team.candidates) || [];
  var c = { total: list.length, none: 0 };
  OV_STAGES.forEach(function (s) { c[s] = 0; });
  list.forEach(function (x) {
    var st = stageOfStatus(x.status);
    if (st) c[st] += 1; else c.none += 1;
  });
  return c;
}

function renderNeuripsView() {
  var root = document.getElementById('nrView');
  root.style.display = '';
  root.innerHTML =
    '<div class="filter-bar">' +
      '<input type="text" id="nrSearch" placeholder="🔍 搜索姓名 / 院校 / 专业 / 研究方向…">' +
      '<select id="nrCategory" data-all="全部分类"><option value=""></option></select>' +
      '<select id="nrOutreach" data-all="全部转化类型"><option value=""></option></select>' +
      '<button class="density-btn" id="nrDensityBtn"></button>' +
      '<span class="filter-count" id="nrCount"></span>' +
    '</div>' +
    '<div class="legend" id="nrChips"></div>' +
    '<div class="mk-legend" id="nrLegend"></div>' +
    '<div class="tbl-wrap"><table class="tbl" style="min-width:2000px">' +
      '<thead><tr>' +
        NR_FIELDS.map(function (f) { return '<th>' + f[1] + '</th>'; }).join('') +
      '</tr></thead>' +
      '<tbody id="nrBody"></tbody>' +
      '<tbody><tr id="nrEmptyRow" style="display:none"><td colspan="17" style="text-align:center;padding:36px;color:#8071a0">没有符合筛选条件的人选</td></tr></tbody>' +
    '</table></div>';

  document.getElementById('nrSearch').addEventListener('input', function () {
    nrState.q = this.value.trim().toLowerCase();
    drawNeurips();
  });
  ['nrCategory', 'nrOutreach'].forEach(function (fid) {
    document.getElementById(fid).addEventListener('change', function () {
      nrState[fid === 'nrCategory' ? 'category' : 'outreach'] = this.value;
      drawNeurips();
    });
  });

  // 密度切换（与常规团队页共用记忆）
  var nrBtn = document.getElementById('nrDensityBtn');
  var apply = function () {
    var compact = (localStorage.getItem('hb-density') || 'compact') === 'compact';
    document.getElementById('teamPage').classList.toggle('compact', compact);
    nrBtn.textContent = compact ? '🔲 切换宽松' : '🔳 切换紧凑';
  };
  nrBtn.addEventListener('click', function () {
    localStorage.setItem('hb-density',
      (localStorage.getItem('hb-density') || 'compact') === 'compact' ? 'cozy' : 'compact');
    apply();
  });
  apply();

  // 颜色图例
  document.getElementById('nrLegend').innerHTML = '<b>行颜色</b>' +
    '<span class="lg-item"><i class="sw sw-red"></i>意向</span>' +
    '<span class="lg-item"><i class="sw sw-white"></i>流程中（默认）</span>' +
    '<span class="lg-item"><i class="sw sw-green"></i>待入职</span>' +
    '<span class="lg-item"><i class="sw sw-blue"></i>已入职</span>' +
    '<span class="lg-item"><i class="sw sw-gray"></i>淘汰/长期跟踪</span>';

  drawNeurips();
}

function nrFillSelect(id, options) {
  var sel = document.getElementById(id);
  sel.innerHTML = '<option value="">' + (sel.getAttribute('data-all') || '全部') + '</option>' +
    options.map(function (o) { return '<option value="' + esc(o) + '">' + esc(o) + '</option>'; }).join('');
  sel.value = nrState[id === 'nrCategory' ? 'category' : 'outreach'] || '';
}

// 长文本单元格：默认单行省略，点 ▾ 展开全文
function clampTd(v, isLink) {
  if (!v) return '<td><span class="dim">—</span></td>';
  var isUrl = /^https?:\/\//i.test(v);
  var inner = isLink && isUrl
    ? '<a class="clamp" href="' + esc(v) + '" target="_blank" rel="noopener">' + esc(v) + '</a>'
    : '<span class="clamp">' + esc(v) + '</span>';
  var tgl = v.length > 30
    ? '<button class="clamp-toggle" title="展开 / 收起">▾</button>'
    : '';
  return '<td class="clamped-td">' + inner + tgl + '</td>';
}

function bindClampToggles(bodyId) {
  document.getElementById(bodyId).addEventListener('click', function (e) {
    var t = e.target;
    if (!t.classList || !t.classList.contains('clamp-toggle')) return;
    var clamp = t.parentElement.querySelector('.clamp');
    if (!clamp) return;
    var open = clamp.classList.toggle('open');
    t.textContent = open ? '▴' : '▾';
  });
}

// 点击文本单元格 → 展开 / 收起（链接列不受影响）
function bindCellExpand(bodyId) {
  document.getElementById(bodyId).addEventListener('click', function (e) {
    if (e.target.tagName === 'A') return; // 链接点击保持原行为（新窗口打开）
    var td = e.target.closest ? e.target.closest('td.clamp-td') : null;
    if (!td) return;
    var clamp = td.querySelector('.clamp');
    if (!clamp) return;
    clamp.classList.toggle('open');
  });
}

function drawNeurips() {
  var all = (teamData && teamData.candidates) || [];

  var cats = {}, outs = {};
  all.forEach(function (c) {
    var ct = String(c.category || '').trim() || '未记录';
    var ot = String(c.outreach || '').trim() || '未记录';
    cats[ct] = (cats[ct] || 0) + 1;
    outs[ot] = (outs[ot] || 0) + 1;
  });
  nrFillSelect('nrCategory', Object.keys(cats).sort());
  nrFillSelect('nrOutreach', Object.keys(outs).sort());

  var list = all.filter(function (c) {
    var ct = String(c.category || '').trim() || '未记录';
    var ot = String(c.outreach || '').trim() || '未记录';
    if (nrState.category && ct !== nrState.category) return false;
    if (nrState.outreach && ot !== nrState.outreach) return false;
    if (nrState.status) {
      var st = stageOfStatus(c.status);
      if (nrState.status === '__none') { if (st) return false; }
      else if (st !== nrState.status) return false;
    }
    if (nrState.q) {
      var hay = NR_FIELDS.map(function (f) { return c[f[0]]; }).join(' ').toLowerCase();
      if (hay.indexOf(nrState.q) < 0) return false;
    }
    return true;
  });

  // 状态图例：00~04 各档人数统计（点击即筛选）
  var cnt = nrStageCounts(teamData);
  document.getElementById('nrChips').innerHTML =
    '<span class="chip' + (nrState.status === '' ? ' c-offer' : '') + '" data-st=""><b>' + cnt.total + '</b> 全部</span>' +
    OV_STAGES.map(function (s2) {
      return '<span class="chip ' + OV_STAGE_CHIP[s2] + (nrState.status === s2 ? ' c-offer' : '') +
        '" data-st="' + esc(s2) + '"><b>' + cnt[s2] + '</b> ' + esc(s2) + '</span>';
    }).join('') +
    (cnt.none > 0 ? '<span class="chip' + (nrState.status === '__none' ? ' c-offer' : '') +
      '" data-st="__none">未标注 <b>' + cnt.none + '</b></span>' : '');
  Array.prototype.forEach.call(document.getElementById('nrChips').querySelectorAll('[data-st]'), function (el) {
    el.style.cursor = 'pointer';
    el.addEventListener('click', function () {
      nrState.status = this.getAttribute('data-st');
      drawNeurips();
    });
  });

  document.getElementById('nrCount').textContent = '显示 ' + list.length + ' / 共 ' + all.length + ' 人';

  var rows = list.map(function (c, i) {
    var mk = String(c.mark || '').trim();
    return '<tr class="' + markClass(mk) + '">' + NR_FIELDS.map(function (f) {
      var v = String(c[f[0]] == null ? '' : c[f[0]]);
      if (f[0] === 'status') {
        var st = stageOfStatus(v);
        if (!v) return '<td><span class="dim">—</span></td>';
        return '<td>' + (st
          ? '<span class="badge ' + OV_STAGE_CLS[st] + '">' + esc(st) + '</span>'
          : '<span class="badge b-none">' + esc(v) + '</span>') + '</td>';
      }
      if (f[0] === 'link') return clampTd(v, true);
      if (f[0] === 'outreach') return '<td>' + (v ? '<span class="pill pill-type">' + esc(v) + '</span>' : '<span class="dim">—</span>') + '</td>';
      // 姓名 + 中文姓名合并展示；其余文本列一律单行省略，点击单元格展开全文
      var text = v;
      if (f[0] === 'name') {
        var cn = String(c.nameCn || '').trim();
        if (cn) text = text + '（' + cn + '）';
        return '<td class="clamp-td"><span class="clamp"><b>' + (i + 1) + '. ' + esc(text) + '</b></span></td>';
      }
      if (!v) return '<td><span class="dim">—</span></td>';
      return '<td class="clamp-td"><span class="clamp">' + esc(v) + '</span></td>';
    }).join('') + '</tr>';
  }).join('');

  document.getElementById('nrBody').innerHTML = rows;
  document.getElementById('nrEmptyRow').style.display = list.length ? 'none' : '';
  bindClampToggles('nrBody');
  bindCellExpand('nrBody');
}
