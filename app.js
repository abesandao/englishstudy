'use strict';
/* =========================================================
   きょうの単語 — 英語学習アプリ (PWA)
   データは端末の localStorage に保存されます
   ========================================================= */

const STORE_KEY = 'kyotan_v1';
const LEVELS = {
  1: { name: 'Lv1 基礎', desc: '中学英語・日常の基本語' },
  2: { name: 'Lv2 標準', desc: '高校英語・英検2級' },
  3: { name: 'Lv3 応用', desc: '大学受験・TOEIC 600〜' },
  4: { name: 'Lv4 上級', desc: 'TOEIC 800〜・英検準1級' },
  5: { name: 'Lv5 達人', desc: 'ネイティブ寄り・ちょいマイナー' },
  6: { name: 'Lv6 マニア', desc: '辞書でしか見ない一歩手前の語' },
};
const WEEK_JA = ['日', '月', '火', '水', '木', '金', '土'];

/* ---------------- state ---------------- */
const defaultState = () => ({
  settings: { level: 2, perDay: 3 },
  days: {},      // 'YYYY-MM-DD': { words: [], cleared: { word: sentence }, tests: 0 }
  memo: [],      // { w, m, note, t, learned }
  tests: [],     // { t, score, total }
  history: [],   // 辞書で調べた単語
  srs: {},       // テストの記録 word: { b: 連続正解段階, due: 次に出してよい時刻 }
});
let S = load();
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) { /* 読めないときは新規 */ }
  return defaultState();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { toast('保存できませんでした'); }
}

/* ---------------- dictionary ---------------- */
// entry: [word, short, full, rank, level, quizable]
let DICT = [];
const MAP = new Map();
const BASE = new Map();   // ran -> run など活用形 → 原形
const POOL = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
let dictReady = false;

async function loadDict() {
  const res = await fetch('data/dict.json');
  DICT = await res.json();
  const infl = /^([a-z]+)\s*の(過去|過去分詞|複数|現在分詞|三人称|比較級|最上級)/;
  for (const e of DICT) {
    MAP.set(e[0], e);
    const lw = e[0].toLowerCase();
    if (!MAP.has(lw)) MAP.set(lw, e);
    if (e[5]) POOL[e[4]].push(e);
    else {
      const m = e[2].match(infl);
      if (m) BASE.set(e[0], m[1]);
    }
  }
  dictReady = true;
}

/* ---------------- utils ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => keyOf(new Date());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const rand = a => a[Math.floor(Math.random() * a.length)];
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function today() {
  const k = todayKey();
  if (!S.days[k]) S.days[k] = { words: [], cleared: {}, tests: 0 };
  return S.days[k];
}
const dayOf = k => S.days[k] || { words: [], cleared: {}, tests: 0 };
const studied = k => { const d = S.days[k]; return !!d && (Object.keys(d.cleared).length > 0 || d.tests > 0); };
function streak() {
  let d = new Date();
  if (!studied(keyOf(d))) d = addDays(d, -1);
  let n = 0;
  while (studied(keyOf(d))) { n++; d = addDays(d, -1); }
  return n;
}
function bestStreak() {
  const keys = Object.keys(S.days).filter(studied).sort();
  let best = 0, cur = 0, prev = null;
  for (const k of keys) {
    cur = prev && keyOf(addDays(new Date(prev + 'T00:00'), 1)) === k ? cur + 1 : 1;
    best = Math.max(best, cur); prev = k;
  }
  return best;
}
function usedWords() {
  const set = new Set();
  for (const d of Object.values(S.days)) for (const w of Object.keys(d.cleared)) set.add(w);
  return set;
}
function speak(w) {
  if (!('speechSynthesis' in window)) return toast('この端末は読み上げ非対応です');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(w);
  u.lang = 'en-US'; u.rate = 0.9;
  speechSynthesis.speak(u);
}
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 1800);
}
function senses(full) {
  return full.split(' / ').slice(0, 12).map(s =>
    esc(s).replace(/『([^』]*)』/g, '<b>$1</b>'));
}
const lvTag = lv => `<span class="lv lv${lv}">Lv${lv}</span>`;

/* ---------------- icons (線画アイコン) ---------------- */
const ICONS = {
  home: '<path d="M3.5 10.2 12 3.5l8.5 6.7V20a.8.8 0 0 1-.8.8H15v-6.3H9v6.3H4.3a.8.8 0 0 1-.8-.8z"/>',
  wheel: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="1.8"/><path d="M12 3.5v6.7M12 13.8v6.7M3.5 12h6.7M13.8 12h6.7M6 6l4.7 4.7M13.3 13.3 18 18M18 6l-4.7 4.7M10.7 13.3 6 18"/>',
  book: '<path d="M4.5 5.5A2 2 0 0 1 6.5 3.5H19.5v14H6.5a2 2 0 0 0-2 2z"/><path d="M4.5 19.5a2 2 0 0 0 2 2h13v-4"/><path d="M8.5 7.5h7"/>',
  memo: '<path d="M14 3.5H6a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5z"/><path d="M14 3.5v5h5M8.5 12.5h7M8.5 16h4.5"/>',
  test: '<rect x="4.5" y="3.5" width="15" height="17" rx="1.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  speaker: '<path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/><circle cx="12" cy="12" r="6.3"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l.8 12.2a1 1 0 0 0 1 .8h7.4a1 1 0 0 0 1-.8L17.5 7M9.5 7V4.5h5V7"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m9 5.5 6.5 6.5L9 18.5"/>',
};
const ic = (name, size = 22) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

/* ---------------- mascot (オリジナルキャラ「ほっぷ」: ふくろう) ---------------- */
function mascot(mood = 'normal') {
  const eyes = mood === 'happy' || mood === 'genius'
    ? `<path d="M34 50 q7 -8 14 0" stroke="#3A2E25" stroke-width="4" fill="none" stroke-linecap="round"/>
       <path d="M62 50 q7 -8 14 0" stroke="#3A2E25" stroke-width="4" fill="none" stroke-linecap="round"/>`
    : mood === 'sad'
      ? `<circle cx="41" cy="50" r="9" fill="#fff"/><circle cx="69" cy="50" r="9" fill="#fff"/>
         <circle cx="41" cy="53" r="4.5" fill="#3A2E25"/><circle cx="69" cy="53" r="4.5" fill="#3A2E25"/>
         <path d="M31 39 l14 4 M79 39 l-14 4" stroke="#3A2E25" stroke-width="3" stroke-linecap="round"/>`
      : `<circle cx="41" cy="50" r="10" fill="#fff"/><circle cx="69" cy="50" r="10" fill="#fff"/>
         <circle cx="43" cy="51" r="5" fill="#3A2E25"/><circle cx="71" cy="51" r="5" fill="#3A2E25"/>
         <circle cx="45" cy="49" r="1.6" fill="#fff"/><circle cx="73" cy="49" r="1.6" fill="#fff"/>`;
  const crown = mood === 'genius'
    ? `<path d="M36 22 l8 -14 l11 10 l11 -10 l8 14 z" fill="#FFD23F" stroke="#E0A800" stroke-width="2" stroke-linejoin="round"/>
       <circle cx="55" cy="15" r="3" fill="#E5533D"/>` : '';
  return `<svg class="mascot" viewBox="0 0 110 110" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <ellipse cx="55" cy="104" rx="28" ry="4" fill="rgba(0,0,0,.08)"/>
    <path d="M24 34 L20 14 L40 28 Z M86 34 L90 14 L70 28 Z" fill="#E8862A"/>
    <ellipse cx="55" cy="62" rx="36" ry="40" fill="#F7A23B"/>
    <ellipse cx="55" cy="76" rx="22" ry="22" fill="#FFE2B5"/>
    <path d="M60 70 q-5 3 -10 0 M64 80 q-9 4 -18 0" stroke="#F0C48A" stroke-width="2" fill="none" stroke-linecap="round"/>
    <ellipse cx="22" cy="68" rx="7" ry="16" fill="#E8862A" transform="rotate(12 22 68)"/>
    <ellipse cx="88" cy="68" rx="7" ry="16" fill="#E8862A" transform="rotate(-12 88 68)"/>
    ${eyes}
    <path d="M51 58 l4 7 l4 -7 z" fill="#E5533D" stroke="#C94430" stroke-width="1" stroke-linejoin="round"/>
    <ellipse cx="31" cy="62" rx="5" ry="3" fill="#FF8C7A" opacity=".55"/><ellipse cx="79" cy="62" rx="5" ry="3" fill="#FF8C7A" opacity=".55"/>
    <path d="M44 100 v4 M48 100 v4 M62 100 v4 M66 100 v4" stroke="#E8862A" stroke-width="3" stroke-linecap="round"/>
    ${crown}
  </svg>`;
}

/* ---------------- router ---------------- */
let tab = 'home';
const views = {};
function go(t) {
  tab = t;
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  render();
  $('#view').scrollTop = 0;
}
function render() {
  $('#view').innerHTML = views[tab]();
  const unl = S.memo.filter(m => !m.learned).length;
  $('#memoBadge').textContent = unl ? unl : '';
  if (tab === 'roulette') afterRoulette();
}

/* =========================================================
   HOME
   ========================================================= */
views.home = () => {
  const d = today();
  const done = Object.keys(d.cleared).length;
  const total = S.settings.perDay;
  let msg;
  if (!d.words.length) msg = '今日の単語をまだ決めていません。ルーレットを回してみましょう';
  else if (done < d.words.length) msg = `今日はあと ${d.words.length - done} 語`;
  else msg = '今日の分は完了。おつかれさまでした';

  const now = new Date();
  const monday = addDays(now, -((now.getDay() + 6) % 7));
  const week = [...Array(7)].map((_, i) => {
    const day = addDays(monday, i), k = keyOf(day);
    const on = studied(k), isToday = k === todayKey();
    return `<div><div class="d">${WEEK_JA[day.getDay()]}</div>
      <div class="dot ${on ? 'on' : ''} ${isToday ? 'today' : ''}">${on ? ic('check', 14) : ''}</div></div>`;
  }).join('');

  const bars = [...Array(7)].map((_, i) => {
    const day = addDays(now, i - 6), k = keyOf(day), dd = dayOf(k);
    return { k, n: Object.keys(dd.cleared).length + dd.tests, label: `${day.getMonth() + 1}/${day.getDate()}` };
  });
  const max = Math.max(3, ...bars.map(b => b.n));
  const chart = bars.map(b => `<div class="bar ${b.k === todayKey() ? 'today' : ''}">
      <span>${b.n || ''}</span><i style="height:${(b.n / max) * 70}%"></i><span>${b.label}</span></div>`).join('');

  const todayList = d.words.length
    ? `<ul class="today-words">${d.words.map(w => {
      const e = MAP.get(w);
      return `<li class="${d.cleared[w] ? 'done' : ''}"><span class="cb">${d.cleared[w] ? ic('check', 13) : ''}</span>
        <span class="w">${esc(w)}</span><span class="m">${esc(e ? e[1] : '')}</span></li>`;
    }).join('')}</ul>`
    : `<div class="spin-row">ルーレットを回して、今日使う ${total} 語を決める<span class="go">${ic('chevron', 18)}</span></div>`;

  const studiedDays = Object.keys(S.days).filter(studied).length;
  const best = S.tests.length ? Math.max(...S.tests.map(t => Math.round(t.score / t.total * 100))) : null;

  return `
  <div class="hello">${mascot(done && done >= d.words.length && d.words.length ? 'happy' : 'normal')}
    <div class="bubble">${esc(msg)}</div>
    <button class="icon-btn gear" data-action="settings" aria-label="設定">${ic('gear', 18)}</button>
  </div>

  <button class="today-card" data-action="goto" data-to="roulette">
    <div class="row between"><span class="label">今日の単語</span>
      <span class="sub">${esc(LEVELS[S.settings.level].name)}${d.words.length ? ` · ${done}/${d.words.length}` : ''}</span></div>
    ${todayList}
  </button>

  <div class="card">
    <div class="row between">
      <div><div class="sub">連続学習日数</div><div class="sub">自己ベスト ${bestStreak()}日</div></div>
      <div class="streak-num">${streak()}<small>日</small></div>
    </div>
    <div class="week">${week}</div>
    <div class="chart">${chart}</div>
  </div>

  <div class="card">
    <h3>学習のきろく</h3>
    <div class="stats">
      <div class="stat"><div class="sub">学習した日数</div><div class="n">${studiedDays}<small>日</small></div></div>
      <div class="stat"><div class="sub">使えた単語</div><div class="n">${usedWords().size}<small>語</small></div></div>
      <div class="stat"><div class="sub">メモ中の単語</div><div class="n">${S.memo.filter(m => !m.learned).length}<small>語</small></div></div>
      <div class="stat"><div class="sub">テスト最高</div><div class="n">${best === null ? '-' : best}<small>${best === null ? '' : '%'}</small></div></div>
    </div>
  </div>`;
};

function settingsSheet() {
  const s = S.settings;
  openSheet(`
    <div class="title">設定</div>
    <label class="lbl">ルーレットに出る単語のレベル</label>
    ${Object.entries(LEVELS).map(([k, v]) => `
      <button class="item card" style="margin-bottom:8px;border:2px solid ${+k === s.level ? 'var(--orange)' : 'transparent'}" data-action="setLevel" data-lv="${k}">
        ${lvTag(k)}<div class="grow"><div class="w" style="font-size:15px">${v.name}</div><div class="m">${v.desc}（${POOL[k].length.toLocaleString()}語）</div></div>
        ${+k === s.level ? '<span class="chip">選択中</span>' : ''}
      </button>`).join('')}
    <label class="lbl">1日に使う単語の数</label>
    <div class="opt-grid" style="grid-template-columns:repeat(5,1fr)">
      ${[1, 2, 3, 4, 5].map(n => `<button class="opt ${n === s.perDay ? 'on' : ''}" data-action="setPerDay" data-n="${n}">${n}</button>`).join('')}
    </div>
    <p class="sub">※ 変更は次にルーレットを回すときから反映されます。</p>
    <button class="btn ghost" style="margin-top:20px" data-action="resetAll">すべてのデータをリセット</button>
  `);
}

/* =========================================================
   ROULETTE + MISSION
   ========================================================= */
// 1回まわすと、針の数（=今日まだ決まっていない語数）だけ同時に単語が決まる
let wheel = { cands: [], rot: 0, spinning: false, hits: [], np: 0 };
function freshCands() {
  const used = usedWords(), d = today();
  const np = Math.max(1, S.settings.perDay - d.words.length);
  const segs = np * Math.ceil(10 / np);
  const pool = POOL[S.settings.level].filter(e => !used.has(e[0]) && !d.words.includes(e[0]));
  const src = pool.length >= segs ? pool : POOL[S.settings.level];
  const set = new Set();
  while (set.size < segs && set.size < src.length) set.add(rand(src)[0]);
  wheel.cands = [...set]; wheel.hits = []; wheel.np = np;
}

views.roulette = () => {
  if (!dictReady) return `<div class="empty">辞書を読み込み中…</div>`;
  const d = today();
  const remain = S.settings.perDay - d.words.length;
  if (remain > 0 && !wheel.spinning && (wheel.np !== remain || !wheel.cands.length)) freshCands();

  const tasks = d.words.map((w, i) => {
    const e = MAP.get(w);
    const used = d.cleared[w];
    const when = typeof used === 'number' ? new Date(used) : null;
    return `<div class="card task ${used ? 'done' : ''}" style="animation-delay:${i * 90}ms">
      <div class="row">
        <button class="said ${used ? 'on' : ''}" data-action="useWord" data-w="${esc(w)}" aria-label="${used ? '取り消す' : '会話で使った'}">${ic('check', 20)}</button>
        <div class="grow" style="min-width:0">
          <div class="row" style="gap:4px"><span class="w">${esc(w)}</span>
            <button class="icon-btn" data-action="speak" data-w="${esc(w)}" aria-label="発音">${ic('speaker', 17)}</button>
            <span style="margin-left:auto">${e ? lvTag(e[4]) : ''}</span></div>
          <div class="m">${esc(e ? e[1] : '')}<button class="link" data-action="word" data-w="${esc(w)}">辞書で見る</button></div>
        </div>
      </div>
      ${used
        ? `<div class="said-note">${when ? `${pad(when.getHours())}:${pad(when.getMinutes())} に会話で使った` : '使った'}${typeof used === 'string' ? `：${highlight(used, w)}` : ''}</div>`
        : `<button class="btn said-btn" data-action="useWord" data-w="${esc(w)}">会話で使った</button>`}
    </div>`;
  }).join('');

  return `
    <div class="title">今日の単語</div>
    ${remain > 0 ? `
      <div class="wheel-wrap"><canvas id="wheel" width="720" height="720"></canvas></div>
      <button class="btn" id="spinBtn" data-action="spin">回す</button>
      <p class="sub" style="text-align:center;margin-top:10px">${esc(LEVELS[S.settings.level].name)}から ${remain} 語が同時に決まります</p>` : ''}
    ${tasks ? `<div class="section-head">今日の会話で使う</div>
      <p class="sub" style="margin:-4px 0 12px">1日のどこかで実際に口に出して使えたら「会話で使った」を押して消そう。間違えて押したら左の丸でもとに戻せます。</p>${tasks}` : ''}
    ${d.words.length && remain <= 0 && d.words.every(w => d.cleared[w]) ? `
      <div class="card" style="text-align:center">
        <div style="font-weight:700;font-size:16px;margin:4px 0 12px">今日の分はすべて完了しました</div>
        <button class="btn" data-action="goto" data-to="test">テストで復習する</button></div>` : ''}
  `;
};

function highlight(sentence, w) {
  return esc(sentence).replace(/[A-Za-z]+(?:[-'][A-Za-z]+)*/g, t => matchesWord(t, w) ? `<mark>${t}</mark>` : t);
}
function matchesWord(token, w) {
  let t = token.toLowerCase().replace(/'s$/, '');
  if (t === w || BASE.get(t) === w) return true;
  const c = [w + 's', w + 'es', w + 'ed', w + 'd', w + 'ing', w + 'er', w + 'est', w + 'ly', w + 'r', w + 'st'];
  if (w.endsWith('y')) { const b = w.slice(0, -1); c.push(b + 'ies', b + 'ied', b + 'ier', b + 'iest', b + 'ily'); }
  if (w.endsWith('e')) c.push(w.slice(0, -1) + 'ing');
  if (w.endsWith('ie')) c.push(w.slice(0, -2) + 'ying');
  const last = w[w.length - 1];
  if (/[bdfgklmnprtvz]/.test(last)) c.push(w + last + 'ed', w + last + 'ing', w + last + 'er');
  return c.includes(t);
}

function drawWheel() {
  const cv = $('#wheel'); if (!cv) return;
  const ctx = cv.getContext('2d'), R = cv.width / 2, Rw = R - 46;
  const n = wheel.cands.length, seg = Math.PI * 2 / n;
  const colors = ['#F7A54A', '#FFF3E4', '#EE8A2E', '#FFE4C4'];
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.save(); ctx.translate(R, R);
  ctx.beginPath(); ctx.arc(0, 0, Rw + 9, 0, Math.PI * 2); ctx.fillStyle = '#3A2E25'; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, Rw, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
  for (let i = 0; i < n; i++) {
    const a0 = wheel.rot + i * seg - Math.PI / 2;
    const dim = wheel.hits.length && !wheel.hits.includes(i);
    ctx.globalAlpha = dim ? 0.25 : 1;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, Rw, a0, a0 + seg); ctx.closePath();
    ctx.fillStyle = colors[i % 4]; ctx.fill();
    ctx.strokeStyle = '#3A2E25'; ctx.lineWidth = 2; ctx.stroke();
    ctx.save(); ctx.rotate(a0 + seg / 2);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillStyle = i % 4 === 2 ? '#fff' : '#3A2E25';
    const w = wheel.cands[i];
    ctx.font = `700 ${w.length > 10 ? 23 : w.length > 7 ? 27 : 31}px -apple-system, "Segoe UI", "Helvetica Neue", sans-serif`;
    ctx.fillText(w, Rw - 22, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(0, 0, 44, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = '#3A2E25'; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fillStyle = '#EE8A2E'; ctx.fill();
  // 針（等間隔に np 本）
  for (let p = 0; p < wheel.np; p++) {
    ctx.save(); ctx.rotate(-Math.PI / 2 + p * Math.PI * 2 / wheel.np);
    ctx.beginPath(); ctx.moveTo(Rw - 10, 0); ctx.lineTo(Rw + 40, -19); ctx.lineTo(Rw + 40, 19); ctx.closePath();
    ctx.fillStyle = '#E5533D'; ctx.fill(); ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}
function afterRoulette() { drawWheel(); }

function spin() {
  const d = today();
  const np = wheel.np;
  if (wheel.spinning || S.settings.perDay - d.words.length <= 0) return;
  wheel.spinning = true; wheel.hits = [];
  $('#spinBtn').disabled = true;
  const n = wheel.cands.length, seg = Math.PI * 2 / n, step = n / np;
  const k = Math.floor(Math.random() * n);
  const jitter = (Math.random() - 0.5) * seg * 0.6;
  const TAU = Math.PI * 2;
  const targetMod = ((-(k + 0.5) * seg + jitter) % TAU + TAU) % TAU;
  const startRot = wheel.rot;
  const curMod = ((startRot % TAU) + TAU) % TAU;
  const delta = TAU * 6 + ((targetMod - curMod + TAU) % TAU);
  const dur = 3800, t0 = performance.now();
  const ease = t => 1 - Math.pow(1 - t, 4);
  if (navigator.vibrate) navigator.vibrate(20);
  (function frame(now) {
    const t = Math.min(1, (now - t0) / dur);
    wheel.rot = startRot + delta * ease(t);
    drawWheel();
    if (t < 1) return requestAnimationFrame(frame);
    wheel.hits = [...Array(np)].map((_, i) => (k + i * step) % n);
    drawWheel();
    for (const h of wheel.hits) d.words.push(wheel.cands[h]);
    save();
    if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
    setTimeout(() => { wheel.spinning = false; freshCands(); render(); }, 1500);
  })(t0);
}

// 会話で使ったら押して消す（もう一度押すと取り消し）
function useWord(w) {
  const d = today();
  if (d.cleared[w]) { delete d.cleared[w]; save(); render(); return; }
  d.cleared[w] = Date.now(); save();
  if (navigator.vibrate) navigator.vibrate(40);
  const all = d.words.length >= S.settings.perDay && d.words.every(x => d.cleared[x]);
  toast(all ? '今日の分はすべて完了' : `${w} をクリア`);
  if (all) confetti();
  render();
}

/* =========================================================
   DICTIONARY
   ========================================================= */
let dictQuery = '';
function searchDict(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  if (/^[a-z\-' ]+$/.test(q)) {
    let lo = 0, hi = DICT.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (DICT[mid][0].toLowerCase() < q) lo = mid + 1; else hi = mid; }
    const out = [];
    for (let i = lo; i < DICT.length && DICT[i][0].toLowerCase().startsWith(q) && out.length < 400; i++) out.push(DICT[i]);
    if (!out.length && BASE.has(q)) { const b = MAP.get(BASE.get(q)); if (b) out.push(b); }
    return out.sort((a, b) => (a[0].toLowerCase() === q ? -1 : b[0].toLowerCase() === q ? 1 : a[3] - b[3])).slice(0, 60);
  }
  const out = [];
  for (const e of DICT) if (e[2].includes(q)) out.push(e);
  return out.sort((a, b) => (a[1].includes(q) ? 0 : 1) - (b[1].includes(q) ? 0 : 1) || a[3] - b[3]).slice(0, 60);
}
function dictList(items) {
  if (!items.length) return `<div class="empty">${dictQuery ? '見つかりませんでした' : ''}</div>`;
  return `<div class="list">${items.map(e => `
    <button class="item" data-action="word" data-w="${esc(e[0])}">
      <div class="grow"><div class="w">${esc(e[0])}</div><div class="m">${esc(e[1])}</div></div>${lvTag(e[4])}
    </button>`).join('')}</div>`;
}
views.dict = () => {
  if (!dictReady) return `<div class="empty">辞書を読み込み中…</div>`;
  const hist = S.history.map(w => MAP.get(w)).filter(Boolean);
  return `
    <div class="title">辞書 <span class="sub" style="font-weight:400">${DICT.length.toLocaleString()}語</span></div>
    <div class="search"><input class="field" id="dictQ" type="search" placeholder="英語 または 日本語で検索" value="${esc(dictQuery)}" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
    <div id="dictRes">${dictQuery ? dictList(searchDict(dictQuery)) :
      hist.length ? `<div class="sub" style="margin:4px 0 8px">最近しらべた単語</div>${dictList(hist)}` :
        `<div class="empty">${mascot().replace('class="mascot"', 'class="mascot" style="width:80px;height:80px"')}<br>英語・日本語のどちらでも検索できます</div>`}</div>`;
};

function wordSheet(w) {
  const e = MAP.get(w);
  const inMemo = S.memo.find(m => m.w === w);
  if (e) { S.history = [w, ...S.history.filter(x => x !== w)].slice(0, 30); save(); }
  openSheet(`
    <div class="row between"><div class="row"><span style="font-size:30px;font-weight:800">${esc(w)}</span>
      <button class="icon-btn" data-action="speak" data-w="${esc(w)}" aria-label="発音">${ic('speaker', 17)}</button></div>${e ? lvTag(e[4]) : ''}</div>
    ${e ? `<div class="sub" style="margin-top:4px">頻度ランク #${e[3].toLocaleString()}</div>
      <ol class="senses">${senses(e[2]).map(s => `<li>${s}</li>`).join('')}</ol>`
      : `<p>${esc(inMemo?.m || '辞書に登録がありません')}</p>`}
    <div style="margin-top:16px">
      ${inMemo
        ? `<button class="btn ghost" data-action="memoRemove" data-w="${esc(w)}">メモから外す</button>`
        : `<button class="btn" data-action="memoAdd" data-w="${esc(w)}">メモに追加</button>`}
    </div>`);
}

/* =========================================================
   MEMO（わからない単語）
   ========================================================= */
let memoFilter = 'todo';
views.memo = () => {
  const list = S.memo.filter(m => memoFilter === 'all' || (memoFilter === 'todo' ? !m.learned : m.learned));
  return `
    <div class="title">わからない単語メモ</div>
    <div class="card">
      <div class="row"><input class="field" id="memoW" placeholder="英単語を入力" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
      <div class="suggest" id="memoSug"></div>
      <input class="field" id="memoNote" placeholder="メモ（どこで見たか・例文など）任意" style="margin-top:8px">
      <button class="btn" style="margin-top:10px" data-action="memoAddForm">メモする</button>
    </div>
    <div class="seg">
      <button class="${memoFilter === 'todo' ? 'on' : ''}" data-action="memoFilter" data-f="todo">まだ (${S.memo.filter(m => !m.learned).length})</button>
      <button class="${memoFilter === 'done' ? 'on' : ''}" data-action="memoFilter" data-f="done">覚えた (${S.memo.filter(m => m.learned).length})</button>
      <button class="${memoFilter === 'all' ? 'on' : ''}" data-action="memoFilter" data-f="all">すべて</button>
    </div>
    ${list.length ? `<div class="list">${list.map(m => `
      <div class="item memo-item">
        <button class="check ${m.learned ? 'on' : ''}" data-action="memoToggle" data-w="${esc(m.w)}" aria-label="覚えた">${m.learned ? ic('check', 15) : ''}</button>
        <button class="grow" style="text-align:left" data-action="word" data-w="${esc(m.w)}">
          <div class="w">${esc(m.w)}</div><div class="m">${esc(m.m)}</div>
          ${m.note ? `<div class="note">${esc(m.note)}</div>` : ''}
        </button>
        <button class="icon-btn" data-action="speak" data-w="${esc(m.w)}" aria-label="発音">${ic('speaker', 17)}</button>
        <button class="icon-btn" data-action="memoRemove" data-w="${esc(m.w)}" aria-label="削除">${ic('trash', 17)}</button>
      </div>`).join('')}</div>
      ${memoFilter !== 'done' && S.memo.some(m => !m.learned) ? `<button class="btn" style="margin-top:14px" data-action="startTest" data-src="memo">メモの単語でテスト</button>` : ''}`
      : `<div class="empty">${memoFilter === 'done' ? 'まだ覚えた単語はありません' : '知らない単語を見つけたら、ここにメモしておけます'}</div>`}`;
};
function memoAdd(w, note = '') {
  w = w.trim().toLowerCase();
  if (!w) return false;
  const e = MAP.get(w) || (BASE.has(w) ? MAP.get(BASE.get(w)) : null);
  if (e) w = e[0];
  if (S.memo.find(m => m.w === w)) { toast('すでにメモにあります'); return false; }
  S.memo.unshift({ w, m: e ? e[1] : '（辞書にない単語）', note, t: Date.now(), learned: false });
  save(); toast(`${w} をメモしました`);
  return true;
}

/* =========================================================
   TEST
   ========================================================= */
// 正解した単語はしばらく出題しない（連続正解するほど休みが長くなる）
const REST_DAYS = [0, 3, 7, 14, 30, 60];
function srsRecord(w, ok) {
  const r = S.srs[w] || { b: 0, due: 0 };
  if (ok) { r.b = Math.min(r.b + 1, REST_DAYS.length - 1); r.due = Date.now() + REST_DAYS[r.b] * 864e5; }
  else { r.b = 0; r.due = 0; }
  S.srs[w] = r;
}
const resting = w => { const r = S.srs[w]; return !!r && r.due > Date.now(); };
const dueReview = w => { const r = S.srs[w]; return !!r && r.due <= Date.now(); };
const restingCount = () => Object.keys(S.srs).filter(resting).length;

let T = null;   // テスト中の状態
let testOpt = { src: 'level', dir: 'en' };
views.test = () => {
  if (!dictReady) return `<div class="empty">辞書を読み込み中…</div>`;
  if (T && T.done) return testResult();
  if (T) return testQuestion();
  const memoN = S.memo.filter(m => !m.learned && MAP.has(m.w)).length;
  const usedN = usedWords().size;
  const srcs = [
    ['level', `${LEVELS[S.settings.level].name}`, 'ランダム10問'],
    ['memo', 'メモの単語', `${memoN}語`],
    ['used', 'ミッションで使った単語', `${usedN}語`],
    ['mix', 'ぜんぶミックス', 'メモ＋使った単語＋レベル'],
  ];
  const last = S.tests.slice(-5).reverse();
  return `
    <div class="title">単語テスト</div>
    <div class="card">
      <h3>出題範囲</h3>
      <div class="opt-grid">${srcs.map(([k, a, b]) => `
        <button class="opt ${testOpt.src === k ? 'on' : ''}" data-action="testSrc" data-src="${k}">${a}<div class="sub">${b}</div></button>`).join('')}</div>
      <h3>出題形式</h3>
      <div class="seg">
        <button class="${testOpt.dir === 'en' ? 'on' : ''}" data-action="testDir" data-d="en">英語 → 日本語</button>
        <button class="${testOpt.dir === 'ja' ? 'on' : ''}" data-action="testDir" data-d="ja">日本語 → 英語</button>
      </div>
      <button class="btn" data-action="startTest" data-src="${testOpt.src}">スタート</button>
      <p class="sub" style="margin:10px 0 0;line-height:1.6">正解した単語はしばらく出題されません（1回目3日、続けて正解すると7日→14日→30日→60日）。間違えた単語は次のテストで優先して出ます。いまお休み中 ${restingCount()}語</p>
    </div>
    ${last.length ? `<div class="card"><h3>最近の結果</h3>${last.map(t => {
      const d = new Date(t.t);
      return `<div class="row between" style="padding:6px 0;border-bottom:1px solid #F7EFE5"><span class="sub">${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}</span><b>${t.score} / ${t.total}</b></div>`;
    }).join('')}</div>` : ''}`;
};

function buildTest(src) {
  const N = 10;
  const lv = S.settings.level;
  const lvPool = POOL[lv].filter(e => !resting(e[0]));
  const memo = S.memo.filter(m => !m.learned).map(m => MAP.get(m.w)).filter(e => e && e[1]);
  const used = [...usedWords()].map(w => MAP.get(w)).filter(Boolean);
  let src0 = src === 'memo' ? memo : src === 'used' ? used : src === 'mix' ? [...memo, ...used] : [];
  src0 = [...new Map(src0.map(e => [e[0], e])).values()];
  const ok = src0.filter(e => !resting(e[0]));
  if (src0.length && !ok.length) toast('この範囲の単語はすべてお休み中です');
  // 前に間違えた・お休みが明けた単語を優先
  let base = [...shuffle(ok.filter(e => dueReview(e[0]))), ...shuffle(ok.filter(e => !S.srs[e[0]]))].slice(0, N);
  if (src === 'level' || src === 'mix' || base.length < 4) {
    const have = new Set(base.map(e => e[0]));
    const review = shuffle(lvPool.filter(e => dueReview(e[0]) && !have.has(e[0]))).slice(0, Math.ceil(N / 2));
    review.forEach(e => have.add(e[0]));
    const fresh = shuffle(lvPool.filter(e => !S.srs[e[0]] && !have.has(e[0])));
    const extra = [...review, ...fresh].slice(0, N - base.length);
    if (src !== 'level' && src !== 'mix' && extra.length) toast('単語が少ないのでレベル別の単語も混ぜました');
    base = base.concat(extra);
  }
  base = shuffle(base);
  const qs = base.map(e => {
    const pool = POOL[e[4]].length > 50 ? POOL[e[4]] : DICT.filter(x => x[5]);
    const ds = new Set();
    while (ds.size < 3) {
      const x = rand(pool);
      if (x[0] !== e[0] && x[1] !== e[1]) ds.add(x);
    }
    return { e, choices: shuffle([e, ...ds]), picked: null };
  });
  T = { qs, i: 0, dir: testOpt.dir, done: false, src };
}
function testQuestion() {
  const q = T.qs[T.i], e = q.e, en = T.dir === 'en';
  const answered = q.picked !== null;
  const good = answered && q.picked === e[0];
  return `
    <div class="row" style="margin-bottom:8px"><button class="icon-btn" data-action="quitTest" aria-label="やめる">${ic('close', 18)}</button>
      <div class="progress"><i style="width:${(T.i + (answered ? 1 : 0)) / T.qs.length * 100}%"></i></div></div>
    <div style="text-align:center;margin-top:18px"><span class="q-tag">${en ? '意味を選ぼう' : '英単語を選ぼう'}</span></div>
    <div class="q-count" style="margin-top:12px">${T.i + 1} / ${T.qs.length}</div>
    <div class="q-word ${en ? '' : 'ja'}">${esc(en ? e[0] : e[1])}</div>
    ${en ? `<div style="text-align:center"><button class="icon-btn" data-action="speak" data-w="${esc(e[0])}" aria-label="発音">${ic('speaker', 17)}</button></div>` : '<div style="height:36px"></div>'}
    <div class="feedback ${answered ? (good ? 'good' : 'bad') : ''}">${answered ? (good ? '正解' : '不正解') : ''}</div>
    ${q.choices.map(c => {
      let cls = '';
      if (answered) cls = c[0] === e[0] ? 'correct' : c[0] === q.picked ? 'wrong' : 'dim';
      const mk = answered ? (c[0] === e[0] ? ic('check', 18) : c[0] === q.picked ? ic('close', 18) : '') : '';
      return `<button class="choice ${cls}" data-action="answer" data-w="${esc(c[0])}" ${answered ? 'disabled' : ''}>
        <span class="mk">${mk}</span>${esc(en ? c[1] : c[0])}</button>`;
    }).join('')}
    ${answered ? `<button class="btn" style="margin-top:8px" data-action="nextQ">${T.i + 1 < T.qs.length ? 'つぎへ' : '結果を見る'}</button>` : ''}`;
}
function answer(w) {
  const q = T.qs[T.i];
  if (q.picked !== null) return;
  q.picked = w;
  const ok = w === q.e[0];
  if (navigator.vibrate) navigator.vibrate(ok ? 25 : [60, 40, 60]);
  srsRecord(q.e[0], ok); save();
  if (T.dir === 'en' && ok) speak(q.e[0]);
  render();
  if (ok) setTimeout(() => { if (T && T.qs[T.i] === q) nextQ(); }, 750);
}
function nextQ() {
  if (T.i + 1 < T.qs.length) T.i++;
  else {
    T.done = true;
    const score = T.qs.filter(q => q.picked === q.e[0]).length;
    S.tests.push({ t: Date.now(), score, total: T.qs.length });
    today().tests++;
    // メモの単語で正解したら「覚えた」に近づける: 2回連続正解で自動チェック
    for (const q of T.qs) {
      const m = S.memo.find(x => x.w === q.e[0]);
      if (!m) continue;
      m.streak = q.picked === q.e[0] ? (m.streak || 0) + 1 : 0;
      if (m.streak >= 2) m.learned = true;
    }
    save();
    if (score === T.qs.length) setTimeout(confetti, 150);
  }
  render();
  $('#view').scrollTop = 0;
}
function testResult() {
  const score = T.qs.filter(q => q.picked === q.e[0]).length, n = T.qs.length, r = score / n;
  const [rank, mood, line] = r === 1 ? ['天才', 'genius', '全問正解']
    : r >= 0.8 ? ['すごい', 'happy', 'あと少しで満点']
      : r >= 0.5 ? ['いい調子', 'normal', '間違えた単語をメモして復習しよう']
        : ['がんばろう', 'sad', '大丈夫、くりかえせば覚えられるよ'];
  const wrong = T.qs.filter(q => q.picked !== q.e[0]);
  return `
    <div class="result-head">
      <div class="sub">${esc(line)}</div>
      <div class="rank">${rank}</div>
      ${mascot(mood)}
    </div>
    <div class="card score-card">
      <span class="chip">${esc(T.dir === 'en' ? '英→日' : '日→英')}テスト</span>
      <div class="sc">${score}<small>/${n}</small></div>
      <div class="row" style="justify-content:space-around">
        <div><div class="sub">連続学習</div><b>${streak()}日</b></div>
        <div><div class="sub">累計テスト</div><b>${S.tests.length}回</b></div>
      </div>
    </div>
    ${wrong.length ? `<button class="btn ghost" style="margin-bottom:10px" data-action="memoWrong">間違えた${wrong.length}語をメモに追加</button>` : ''}
    <div class="row" style="gap:10px;margin-bottom:14px">
      <button class="btn" data-action="startTest" data-src="${T.src}">もう一回</button>
      <button class="btn ghost" data-action="quitTest">おわる</button>
    </div>
    <div class="list">${T.qs.map(q => `
      <div class="item">
        <button class="icon-btn" data-action="speak" data-w="${esc(q.e[0])}" aria-label="発音">${ic('speaker', 17)}</button>
        <button class="grow" style="text-align:left" data-action="word" data-w="${esc(q.e[0])}"><div class="w">${esc(q.e[0])}</div><div class="m">${esc(q.e[1])}</div></button>
        <span class="chip ${q.picked === q.e[0] ? 'green' : ''}">${q.picked === q.e[0] ? `正解 · ${REST_DAYS[S.srs[q.e[0]]?.b || 1]}日お休み` : '不正解'}</span>
      </div>`).join('')}</div>`;
}

/* ---------------- sheet / confetti ---------------- */
function openSheet(html) { $('#sheetBody').innerHTML = html; $('#sheet').classList.remove('hidden'); }
function closeSheet() { $('#sheet').classList.add('hidden'); }
function confetti() {
  const box = document.createElement('div'); box.className = 'confetti';
  const cols = ['#F5891F', '#FFD23F', '#4CAF50', '#3D8BFD', '#E5533D'];
  for (let i = 0; i < 70; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + '%';
    p.style.background = rand(cols);
    p.style.animationDuration = 1.6 + Math.random() * 1.6 + 's';
    p.style.animationDelay = Math.random() * 0.5 + 's';
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 4000);
}

/* ---------------- events ---------------- */
const actions = {
  goto: el => go(el.dataset.to),
  speak: el => speak(el.dataset.w),
  word: el => wordSheet(el.dataset.w),
  closeSheet,
  settings: settingsSheet,
  setLevel: el => { S.settings.level = +el.dataset.lv; save(); freshCands(); settingsSheet(); render(); },
  setPerDay: el => { S.settings.perDay = +el.dataset.n; save(); settingsSheet(); render(); },
  resetAll: () => {
    if (!confirm('学習記録・メモをすべて消します。よろしいですか？')) return;
    S = defaultState(); save(); closeSheet(); render(); toast('リセットしました');
  },
  spin,
  useWord: el => useWord(el.dataset.w),
  memoAdd: el => { memoAdd(el.dataset.w); wordSheet(el.dataset.w); render(); },
  memoRemove: el => { S.memo = S.memo.filter(m => m.w !== el.dataset.w); save(); toast('メモから外しました'); if (!$('#sheet').classList.contains('hidden')) wordSheet(el.dataset.w); render(); },
  memoToggle: el => { const m = S.memo.find(x => x.w === el.dataset.w); m.learned = !m.learned; m.streak = 0; save(); render(); },
  memoFilter: el => { memoFilter = el.dataset.f; render(); },
  memoAddForm: () => {
    const w = $('#memoW').value, note = $('#memoNote').value.trim();
    if (!w.trim()) return toast('単語を入力してね');
    if (memoAdd(w, note)) { memoFilter = 'todo'; render(); }
  },
  memoPick: el => { $('#memoW').value = el.dataset.w; $('#memoSug').innerHTML = ''; $('#memoNote').focus(); },
  memoWrong: () => { let n = 0; for (const q of T.qs) if (q.picked !== q.e[0] && !S.memo.find(m => m.w === q.e[0])) { S.memo.unshift({ w: q.e[0], m: q.e[1], note: 'テストで間違えた', t: Date.now(), learned: false }); n++; } save(); toast(`${n}語をメモしました`); render(); },
  testSrc: el => { testOpt.src = el.dataset.src; render(); },
  testDir: el => { testOpt.dir = el.dataset.d; render(); },
  startTest: el => { testOpt.src = el.dataset.src; buildTest(el.dataset.src); go('test'); },
  answer: el => answer(el.dataset.w),
  nextQ,
  quitTest: () => { T = null; render(); },
};
document.addEventListener('click', ev => {
  const tabBtn = ev.target.closest('#tabbar button');
  if (tabBtn) return go(tabBtn.dataset.tab);
  const el = ev.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) {
    if (el.closest('#sheetBody') && ['word', 'goto', 'startTest'].includes(el.dataset.action)) closeSheet();
    fn(el);
  }
});
document.addEventListener('input', ev => {
  if (ev.target.id === 'dictQ') {
    dictQuery = ev.target.value;
    $('#dictRes').innerHTML = dictQuery ? dictList(searchDict(dictQuery)) : '';
  }
  if (ev.target.id === 'memoW') {
    const q = ev.target.value.trim().toLowerCase();
    const res = q && dictReady ? searchDict(q).slice(0, 5) : [];
    $('#memoSug').innerHTML = res.map(e => `<button data-action="memoPick" data-w="${esc(e[0])}"><b>${esc(e[0])}</b> <span class="sub">${esc(e[1])}</span></button>`).join('');
  }
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && ev.target.id === 'memoW') { ev.preventDefault(); actions.memoAddForm(); }
  if (ev.key === 'Enter' && ev.target.id === 'memoNote') { ev.preventDefault(); actions.memoAddForm(); }
});
// 日付が変わったら再描画
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

/* ---------------- boot ---------------- */
const TAB_ICON = { home: 'home', roulette: 'wheel', dict: 'book', memo: 'memo', test: 'test' };
document.querySelectorAll('#tabbar button').forEach(b => { b.querySelector('.ti').innerHTML = ic(TAB_ICON[b.dataset.tab], 24); });
go('home');
loadDict().then(() => { freshCands(); render(); }).catch(() => toast('辞書の読み込みに失敗しました'));
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
