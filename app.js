'use strict';
/* Spend: budgeting app UI. Responsive (phone → desktop dashboard). Runs as a web page today, Telegram Mini App later. */

const $ = s => document.querySelector(s);
const tg = window.Telegram?.WebApp;
const inTG = !!tg?.initData;
const coarse = matchMedia('(pointer:coarse)').matches;

/* ---------- constants ---------- */
const CATEGORY_EMOJIS = {
  transport: '🚕', bills: '🧾', shopping: '🛍️', dining: '🍽️', groceries: '🛒',
  health: '❤️', fun: '🎉', home: '🏠', coffee: '☕️', travel: '✈️', phone: '📱',
  education: '🎓', pet: '🐾', salary: '💰', gift: '🎁', other: '✨',
};
const BLOB_PATHS = [
  'M108 34C93 2 54 10 50 47C15 44 3 83 37 101C7 122 25 158 56 150C61 188 100 194 112 160C130 194 169 184 166 149C202 154 212 113 181 98C212 74 196 41 166 47C159 12 122 1 108 34Z',
  'M110 8C122 24 137 19 152 15C155 34 171 34 188 36C183 54 198 63 211 73C196 86 203 101 210 117C191 122 191 139 188 157C170 152 161 167 149 182C134 168 120 178 105 188C93 172 77 178 60 184C56 166 40 165 22 164C27 145 12 137 5 122C20 110 12 94 7 79C27 74 25 56 27 39C46 43 55 29 67 14C82 28 96 18 110 8Z',
  'M34 57C40 32 66 26 84 40C92 12 124 9 140 34C161 17 190 29 192 57C219 61 227 92 206 109C225 133 210 163 181 162C171 190 138 194 121 170C100 193 68 185 62 158C34 166 12 145 22 118C-2 104 0 75 26 64C27 61 30 59 34 57Z',
];
const SWATCHES = ['#AFCBF7', '#F2B8B5', '#E8B8DF', '#F4C0A8', '#B7D5C8', '#ECEAA4', '#BFE1D5', '#CEC3F4', '#F4D0AA', '#C2DDED', '#D6D2CB', '#B9B8B2'];
const SYMBOLS = { SGD: 'S$', USD: 'US$', MYR: 'RM', EUR: '€', GBP: '£', AUD: 'A$', HKD: 'HK$', JPY: '¥', IDR: 'Rp', PHP: '₱', THB: '฿', INR: '₹', CNY: 'CN¥', KRW: '₩', TWD: 'NT$', VND: '₫' };
const UNCAT = { id: null, name: 'Uncategorised', color: '#8d887a', fg: '#ffffff', icon: 'other', type: 'expense' };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const C_SPENT = '#8E83F5', C_INCOME = '#70B8EA';
const TITLES = { home: 'Dashboard', month: 'Month', year: 'Year', insights: 'Insights', history: 'History', installments: 'Instalments' };

/* ---------- state ---------- */
const S = {
  db: null, started: false, live: false,
  profile: null, categories: [], transactions: [], plans: [], catMap: new Map(),
  view: 'home', period: 'month', anchor: today(),
  hist: { type: 'all', cat: null, q: '', limit: 150 },
  sheet: null, draft: null, catDraft: null, catReturn: null, planDraft: null, armed: null, sugg: [],
};

/* ---------- helpers ---------- */
function today() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dim = d => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
const daysIn = r => Math.round((r.end - r.start) / 864e5) + 1;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sym = () => SYMBOLS[S.profile?.currency] ?? (S.profile?.currency || '') + ' ';
function money(n, dec = 2) {
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return (n < 0 ? '−' : '') + sym() + s;
}
const short = n => n >= 1000 ? sym() + (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : sym() + Math.round(n);
const cat = id => S.catMap.get(id) || UNCAT;
const dayLabel = d => `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
const sortTx = (a, b) => b.occurred_on.localeCompare(a.occurred_on) || String(b.created_at || '').localeCompare(String(a.created_at || ''));
function fgFor(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b > .45 ? '#1a1a1a' : '#ffffff';
}
const emojiFor = c => CATEGORY_EMOJIS[c?.icon] || CATEGORY_EMOJIS.other;
const icoHTML = (c, cls = '') => `<div class="ico emoji ${cls}" style="--cat:${esc(c.color)}" aria-hidden="true">${emojiFor(c)}</div>`;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); }
const haptic = (k = 'success') => { try { tg?.HapticFeedback?.notificationOccurred(k); } catch {} };
const tick = () => { try { tg?.HapticFeedback?.selectionChanged(); } catch {} };

/* ---------- periods ---------- */
function range(p, a) {
  if (p === 'day') return { start: a, end: a };
  if (p === 'week') { const s = addDays(a, -((a.getDay() + 6) % 7)); return { start: s, end: addDays(s, 6) }; }
  if (p === 'month') return { start: new Date(a.getFullYear(), a.getMonth(), 1), end: new Date(a.getFullYear(), a.getMonth() + 1, 0) };
  return { start: new Date(a.getFullYear(), 0, 1), end: new Date(a.getFullYear(), 11, 31) };
}
function shift(p, a, n) {
  if (p === 'day') return addDays(a, n);
  if (p === 'week') return addDays(a, 7 * n);
  const months = p === 'month' ? n : 12 * n;
  const first = new Date(a.getFullYear(), a.getMonth() + months, 1);
  return new Date(first.getFullYear(), first.getMonth(), Math.min(a.getDate(), dim(first)));
}
function budgetFor(monthly, p, a) {
  if (monthly == null) return null;
  return { month: monthly, week: monthly * 7 / dim(a), day: monthly / dim(a), year: monthly * 12 }[p];
}
function stats(r) {
  const a = iso(r.start), b = iso(r.end);
  const tx = S.transactions.filter(t => t.occurred_on >= a && t.occurred_on <= b);
  let spent = 0, income = 0; const byCat = new Map();
  for (const t of tx) {
    if (t.type === 'expense') { spent += t.amount; byCat.set(t.category_id ?? null, (byCat.get(t.category_id ?? null) || 0) + t.amount); }
    else income += t.amount;
  }
  return { tx, spent, income, byCat };
}
const curPeriod = () => ({ home: S.period, month: 'month', year: 'year', insights: 'month' }[S.view]);

/* ---------- analysis: monthly insights + where to cut ---------- */
function analyse(a) {
  const r = range('month', a), st = stats(r), n = daysIn(r), t = today();
  const isCur = t >= r.start && t <= r.end, isPast = t > r.end;
  const elapsed = isCur ? t.getDate() : isPast ? n : 0, remaining = n - elapsed;
  const scale = elapsed >= 5 && isCur ? n / elapsed : 1;      // extrapolate only once there's enough signal
  const B = S.profile.monthly_budget || 0;
  const exp = st.tx.filter(x => x.type === 'expense');

  // 3-month baseline per category
  const prev = [1, 2, 3].map(k => stats(range('month', shift('month', a, -k)))).filter(s => s.tx.length);
  const avgCat = new Map();
  prev.forEach(s => s.byCat.forEach((v, k) => avgCat.set(k, (avgCat.get(k) || 0) + v / prev.length)));
  const avgSpent = prev.length ? prev.reduce((x, s) => x + s.spent, 0) / prev.length : null;

  // Recurring bills: same note 1–2× in each of the previous two months (and ≤2× this month).
  // They're fixed costs, so they're not extrapolated; ones not yet charged this month are added as upcoming.
  const key = x => (x.note || '').trim().toLowerCase();
  const counts = m => { const pr = range('month', shift('month', a, -m)), c = new Map(); S.transactions.forEach(x => { if (x.type === 'expense' && key(x) && x.occurred_on >= iso(pr.start) && x.occurred_on <= iso(pr.end)) { const e = c.get(key(x)) || { n: 0, amt: 0, cat: x.category_id, label: x.note.trim() }; e.n++; e.amt = x.amount; c.set(key(x), e); } }); return c; };
  const p1 = counts(1), p2 = counts(2), cur = new Map();
  exp.forEach(x => { if (key(x)) cur.set(key(x), (cur.get(key(x)) || 0) + 1); });
  const recKeys = new Set([...p1].filter(([k, e]) => e.n <= 2 && p2.get(k)?.n >= 1 && p2.get(k).n <= 2 && (cur.get(k) || 0) <= 2).map(([k]) => k));
  const fixedCat = new Map(), add2 = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  exp.forEach(x => { if (recKeys.has(key(x))) add2(fixedCat, x.category_id ?? null, x.amount); });
  const upcoming = isCur ? [...recKeys].filter(k => !cur.get(k)).map(k => p1.get(k)) : [];
  const upCat = new Map(); upcoming.forEach(e => add2(upCat, e.cat ?? null, e.amt));
  const projCat = id => { const spent = st.byCat.get(id) || 0, fixed = fixedCat.get(id) || 0; return fixed + (upCat.get(id) || 0) + (spent - fixed) * scale; };
  const fixedAll = [...fixedCat.values()].reduce((s, v) => s + v, 0), upAll = upcoming.reduce((s, e) => s + e.amt, 0);
  const projected = isCur ? fixedAll + upAll + (st.spent - fixedAll) * (elapsed ? n / elapsed : 0) : st.spent;

  const tips = [];
  const add = (em, title, body, save, kind) => tips.push({ em, title, body, save: Math.max(0, Math.round(save)), kind });

  // 1. pace vs overall budget
  if (isCur && B && projected > B * 1.02 && remaining > 0) {
    const allow = Math.max(0, (B - st.spent) / remaining);
    add('⏱️', 'On pace to overspend', `At this rate you'll reach ${money(projected, 0)} by month-end${upAll ? ` (incl. ${money(upAll, 0)} of upcoming bills)` : ''}, ${money(projected - B, 0)} over budget. Keep to ${money(Math.max(0, allow - upAll / remaining), 0)}/day for the last ${remaining} days to land on target.`, projected - B, 'pace');
  }
  // 2. categories over their limit (projected)
  for (const c of S.categories) {
    if (c.type !== 'expense' || !(c.budget > 0)) continue;
    const proj = projCat(c.id);
    if (proj > c.budget * 1.02) add('🚦', `${c.name} is over its limit`, `${isCur ? 'Heading for' : 'Spent'} ${money(proj, 0)} against a ${money(c.budget, 0)} limit. This is the most direct place to pull back.`, proj - c.budget, 'limit');
  }
  // 3. categories up vs 3-month average
  if (prev.length) for (const [id, avg] of avgCat) {
    if (avg < 20) continue;
    const proj = projCat(id);
    if (proj > avg * 1.25 && proj - avg >= 15 && !tips.some(x => x.kind === 'limit' && x.title.startsWith(cat(id).name)))
      add('📈', `${cat(id).name} is up ${Math.round((proj / avg - 1) * 100)}%`, `${isCur ? 'Tracking' : 'Spent'} ${money(proj, 0)} vs your usual ${money(avg, 0)}. Getting back to normal saves about ${money(proj - avg, 0)}.`, proj - avg, 'trend');
  }
  // 4. many small purchases ("latte factor")
  const byCatCount = new Map();
  exp.forEach(x => { const k = x.category_id ?? null; const e = byCatCount.get(k) || { n: 0, sum: 0 }; e.n++; e.sum += x.amount; byCatCount.set(k, e); });
  const small = [...byCatCount].map(([k, e]) => ({ k, ...e, avg: e.sum / e.n })).filter(e => e.n >= 6 && e.avg <= 20).sort((a, b) => b.sum - a.sum)[0];
  if (small) add('☕', `${small.n} small ${cat(small.k).name} buys`, `They average ${money(small.avg)} each but add up to ${money(small.sum, 0)}. Skipping 1 in 4 saves about ${money(small.sum * .25 * scale, 0)} a month.`, small.sum * .25 * scale, 'small');
  // 5. most repeated merchant / note
  const byNote = new Map();
  exp.forEach(x => { const k = (x.note || '').trim().toLowerCase(); if (!k) return; const e = byNote.get(k) || { label: x.note.trim(), n: 0, sum: 0 }; e.n++; e.sum += x.amount; byNote.set(k, e); });
  const rep = [...byNote.values()].filter(e => e.n >= 4).sort((a, b) => b.sum - a.sum)[0];
  if (rep && !(small && rep.sum >= small.sum * .8)) add('🔁', `“${rep.label}”: ${rep.n}× this month`, `${money(rep.sum, 0)} on your most repeated spend. A cheaper option or a weekly cap could trim about 20% (${money(rep.sum * .2 * scale, 0)}).`, rep.sum * .2 * scale, 'repeat');
  // 6. weekends vs weekdays (last 90 days)
  const end = isPast ? r.end : t, from = iso(addDays(end, -89)), to = iso(end);
  let we = 0, wd = 0, weN = 0, wdN = 0;
  for (let d = addDays(end, -89); d <= end; d = addDays(d, 1)) (d.getDay() % 6 === 0 ? weN++ : wdN++);
  S.transactions.forEach(x => { if (x.type !== 'expense' || x.occurred_on < from || x.occurred_on > to) return; parse(x.occurred_on).getDay() % 6 === 0 ? we += x.amount : wd += x.amount; });
  const weAvg = weN ? we / weN : 0, wdAvg = wdN ? wd / wdN : 0;
  if (wdAvg > 0 && weAvg / wdAvg >= 1.4 && we > 50) add('🛋️', `Weekends cost ${(weAvg / wdAvg).toFixed(1)}× more`, `You average ${money(weAvg, 0)}/day on weekends vs ${money(wdAvg, 0)} on weekdays. One low-spend weekend a month saves about ${money((weAvg - wdAvg) * 2, 0)}.`, (weAvg - wdAvg) * 2, 'weekend');
  // 7. recurring bills / subscriptions (same note in 3 consecutive months)
  const recurring = [...recKeys].map(k => ({ label: p1.get(k).label, amt: p1.get(k).amt }));
  if (recurring.length) add('🧾', `${recurring.length} recurring bill${recurring.length > 1 ? 's' : ''}`, `${recurring.map(x => `${esc(x.label)} (${money(x.amt, 0)})`).join(', ')}. Review plans and subscriptions: renegotiating or cancelling one is an easy, permanent win.`, Math.min(...recurring.map(x => x.amt)) * .3, 'recurring');
  // 8. big categories with no limit
  for (const [id, avg] of avgCat) {
    const c = cat(id);
    if (id && c.type === 'expense' && !(c.budget > 0) && avg >= 60) add('🎯', `Set a limit for ${c.name}`, `You usually spend about ${money(avg, 0)} here with no limit. A cap 10% lower (${money(avg * .9, 0)}) saves ${money(avg * .1, 0)} a month.`, avg * .1, 'nolimit');
  }
  tips.sort((x, y) => y.save - x.save);
  // the pace tip is an aggregate of the others, so leave it out of the total to avoid double counting
  const potential = tips.filter(x => x.kind !== 'pace').reduce((s, x) => s + x.save, 0);

  // verdict
  let tone = 'none', word = 'No data yet', line = 'Add a few transactions and your monthly analysis will show up here.';
  const ref = B || avgSpent;
  if (st.spent && ref) {
    const ratio = projected / ref;
    if (ratio <= .9) { tone = 'good'; word = isCur ? 'On track' : 'Under budget'; line = `${isCur ? 'Projected' : 'Spent'} ${money(projected, 0)}, ${money(ref - projected, 0)} under ${B ? 'budget' : 'your average'}. Nice work.`; }
    else if (ratio <= 1.02) { tone = 'warn'; word = 'Cutting close'; line = `${isCur ? 'Heading for' : 'Spent'} ${money(projected, 0)} of ${money(ref, 0)}. A little restraint keeps you in the green.`; }
    else { tone = 'bad'; word = 'Overspending'; line = `${isCur ? 'Projected' : 'Spent'} ${money(projected, 0)}, ${money(projected - ref, 0)} over ${B ? 'budget' : 'your average'}. See where to cut below.`; }
  } else if (st.spent) { tone = 'warn'; word = 'Tracking'; line = 'Set a monthly budget in Settings to get a verdict.'; }

  // per-category comparison vs average
  const ids = new Set([...st.byCat.keys(), ...avgCat.keys()]);
  const compare = [...ids].map(id => ({ id, cur: st.byCat.get(id) || 0, proj: projCat(id), avg: avgCat.get(id) || 0 }))
    .filter(x => x.cur || x.avg).sort((x, y) => Math.max(y.proj, y.avg) - Math.max(x.proj, x.avg)).slice(0, 7);

  return { r, st, n, isCur, elapsed, remaining, projected, B, avgSpent, prevN: prev.length, tips, potential, tone, word, line, compare, scale };
}

/* ---------- charts (hand-rolled SVG; one y-axis, hover tooltips) ---------- */
function niceMax(v) { if (v <= 0) return 10; const p = 10 ** Math.floor(Math.log10(v)); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p; }
function barPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
}
function columns({ groups, series, ref, showX = () => true }) {
  const W = 360, H = 170, L = 38, B = 22, T = 10, n = groups.length, k = series.length;
  const max = niceMax(Math.max(ref || 0, ...groups.flatMap(g => g.vals)) * 1.05);
  const y = v => T + (H - T - B) * (1 - v / max);
  const slot = (W - L) / n, bw = Math.max(2, Math.min(16, (slot - 3) / k - 2));
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (const f of [0, .5, 1]) s += `<line class="grid" x1="${L}" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}"/><text class="axis" x="${L - 6}" y="${y(max * f) + 4}" text-anchor="end">${short(max * f)}</text>`;
  groups.forEach((g, i) => {
    const cx = L + slot * i + slot / 2; let x = cx - (k * bw + (k - 1) * 2) / 2, top = H - B;
    s += '<g class="col">';
    g.vals.forEach((v, j) => { if (v > 0) { const yy = y(v); top = Math.min(top, yy); s += `<path class="mk" fill="${series[j].color}" d="${barPath(x, yy, bw, H - B - yy)}"/>`; } x += bw + 2; });
    if (showX(i)) s += `<text class="axis" x="${cx}" y="${H - 6}" text-anchor="middle">${g.x}</text>`;
    s += `<rect class="hit" x="${L + slot * i}" y="${T}" width="${slot}" height="${H - T - B}" data-tip="${esc(g.tip)}" data-y="${top}"/></g>`;
  });
  if (ref) s += `<line x1="${L}" x2="${W}" y1="${y(ref)}" y2="${y(ref)}" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 4" opacity=".55" pointer-events="none"/>`;
  return s + '</svg>';
}
function wireTips(root) {
  root.querySelectorAll('.chartbox').forEach(panel => {
    const tip = panel.querySelector('.tip'), svg = panel.querySelector('svg'); if (!tip || !svg) return;
    const show = e => {
      const h = e.target.closest('.hit'); if (!h) return;
      const pr = panel.getBoundingClientRect(), sr = svg.getBoundingClientRect(), hr = h.getBoundingClientRect(), sc = sr.width / 360;
      const [a, b] = h.dataset.tip.split('|');
      tip.innerHTML = `${esc(a)}<small>${esc(b || '')}</small>`;
      tip.style.left = Math.max(70, Math.min(pr.width - 70, hr.left + hr.width / 2 - pr.left)) + 'px';
      tip.style.top = (sr.top - pr.top + (+h.dataset.y) * sc - 4) + 'px';
      tip.classList.add('show');
      panel.querySelectorAll('.col').forEach(c => c.style.opacity = c.contains(h) ? 1 : .45);
    };
    const hide = () => { tip.classList.remove('show'); panel.querySelectorAll('.col').forEach(c => c.style.opacity = 1); };
    svg.addEventListener('pointerover', show); svg.addEventListener('click', show); svg.addEventListener('pointerleave', hide);
  });
}

/* ---------- views ---------- */
let animate = true;
const w = pct => animate ? `data-w="${pct}" style="width:0"` : `style="width:${pct}%"`;

function rangeLabel(p, r) {
  const y = r.start.getFullYear() !== today().getFullYear() ? ' ' + r.start.getFullYear() : '';
  if (p === 'day') return dayLabel(r.start) + y;
  if (p === 'week') return r.start.getMonth() === r.end.getMonth()
    ? `${r.start.getDate()}–${r.end.getDate()} ${MON[r.end.getMonth()]}${y}`
    : `${r.start.getDate()} ${MON[r.start.getMonth()]} – ${r.end.getDate()} ${MON[r.end.getMonth()]}${y}`;
  if (p === 'month') return MONTHS[r.start.getMonth()] + (S.view !== 'home' ? ' ' + r.start.getFullYear() : y);
  return String(r.start.getFullYear());
}

function catList(byCat, total, onclick = 'cat') {
  const rows = [...byCat].sort((a, b) => b[1] - a[1]); const max = rows[0]?.[1] || 1;
  return rows.map(([id, v]) => { const c = cat(id); return `<button class="cat" data-act="${onclick}" data-id="${id ?? ''}">${icoHTML(c)}<div class="track"><div class="t"><span>${esc(c.name)}</span><span>${money(v)} · ${Math.round(v / total * 100)}%</span></div><div class="p"><span ${w(v / max * 100)} data-bg="${esc(c.color)}"></span></div></div></button>`; }).join('');
}
function categorySummary(byCat, total, period, anchor, maxRows = Infinity) {
  const rows = [...byCat].map(([id, value]) => {
    const c = cat(id), limit = c.budget > 0 ? budgetFor(c.budget, period, anchor) : 0;
    return { id, value, c, limit, ratio: limit ? value / limit : 0 };
  }).sort((a, b) => (b.limit ? b.ratio + 1 : b.value / total) - (a.limit ? a.ratio + 1 : a.value / total)).slice(0, maxRows);
  return `<div class="category-summary">${rows.map(({ id, value, c, limit, ratio }) => {
    const pct = total ? Math.round(value / total * 100) : 0;
    const state = !limit ? 'neutral' : ratio > 1 ? 'over' : ratio >= .8 ? 'warn' : 'ok';
    const remaining = limit - value;
    const detail = limit ? `${money(value, 0)} of ${money(limit, 0)} · ${state === 'over' ? 'over limit' : state === 'warn' ? 'nearly full' : 'on pace'}` : `${pct}% of spending · no limit`;
    const trailing = limit ? remaining >= 0 ? `${money(remaining, 0)} left` : `${money(-remaining, 0)} over` : money(value, 0);
    const bar = limit ? Math.min(ratio, 1) * 100 : pct;
    return `<button class="category-summary-item ${state}" style="--cat:${esc(c.color)};--pct:${bar}%" data-act="cat" data-id="${id ?? ''}">
      <div class="category-summary-main">${icoHTML(c, 'sm')}<span><b>${esc(c.name)}</b><small>${detail}</small></span><strong>${trailing}</strong></div>
      <div class="category-summary-bar"><i></i></div>
    </button>`;
  }).join('')}</div>`;
}
const txRow = t => { const c = cat(t.category_id); return `<button class="tx" data-act="tx" data-id="${t.id}">${icoHTML(c, 'sm')}<div class="w"><b>${esc(t.note || c.name)}</b><small>${t.note ? esc(c.name) : t.type === 'income' ? 'Income' : ''}${S.view === 'home' ? ' · ' + dayLabel(parse(t.occurred_on)) : ''}</small></div><span class="amt ${t.type === 'income' ? 'inc' : ''}">${t.type === 'income' ? '+' : '−'}${money(t.amount)}</span></button>`; };

function planStats(p) {
  const total = Math.max(1, Number(p.total_payments) || 1);
  const logged = S.transactions.filter(t => t.plan_id === p.id).length;
  const paid = Math.min(total, Math.max(0, Number(p.paid_before) || 0) + logged);
  const remaining = Math.max(0, total - paid), pct = Math.round(paid / total * 100);
  const next = remaining ? SpendDB.occDate(p, paid) : null;
  return { total, paid, remaining, pct, next, left: remaining * Number(p.amount || 0) };
}
function planDateLabel(value) {
  if (!value) return 'Complete';
  const d = parse(value), now = today(), prefix = d < now ? 'Due ' : 'Next ';
  return `${prefix}${d.getDate()} ${MON[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}
function planRow(p, compact = false) {
  const c = cat(p.category_id), x = planStats(p), done = !x.remaining;
  return `<button class="plan-row ${compact ? 'compact' : ''}" data-act="plan" data-id="${p.id}">
    ${icoHTML(c, 'sm')}
    <span class="plan-copy"><b>${esc(p.name)}</b><small>${done ? 'All payments completed' : `${x.paid} of ${x.total} paid · ${planDateLabel(x.next)}`}</small></span>
    <span class="plan-status ${done ? 'done' : ''}">${done ? 'Paid off' : `${x.paid}/${x.total} paid`}</span>
    <span class="plan-amount"><b>${money(p.amount, 0)}</b><small>${done ? 'finished' : 'per month'}</small></span>
    <span class="plan-progress"><i style="width:${x.pct}%"></i></span>
  </button>`;
}
function planTotals(plans = S.plans) {
  return plans.reduce((a, p) => { const x = planStats(p); a.paid += x.paid; a.total += x.total; a.left += x.left; if (x.next && (!a.next || x.next < a.next)) a.next = x.next; return a; }, { paid: 0, total: 0, left: 0, next: null });
}
function installmentCard() {
  const active = S.plans.filter(p => planStats(p).remaining), totals = planTotals(active), pct = totals.total ? Math.round(totals.paid / totals.total * 100) : 0;
  return `<section class="box plans-card">
    <h2><span class="box-title">Instalment plans</span><button data-act="goplans">View all →</button></h2>
    ${active.length ? `<div class="plan-card-summary"><span><strong>${totals.paid}</strong> of ${totals.total} payments complete</span><b>${pct}%</b></div><div class="plan-overall-bar"><i style="width:${pct}%"></i></div><div class="plan-card-meta"><span>${money(totals.left, 0)} remaining</span><span>${planDateLabel(totals.next)}</span></div>${active.slice(0, 2).map(p => planRow(p, true)).join('')}`
      : `<div class="plan-empty"><span>🧾</span><b>No instalment plans yet</b><p>Track what is paid, what remains, and the next due date.</p><button class="btn sec2" data-act="newplan">Add a plan</button></div>`}
  </section>`;
}

function quickAdd(st) {
  const counts = new Map();
  S.transactions.filter(t => t.type === 'expense').slice(0, 120).forEach(t => counts.set(t.category_id, (counts.get(t.category_id) || 0) + 1));
  const exp = S.categories.filter(c => c.type === 'expense')
    .sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0) || (st.byCat.get(b.id) || 0) - (st.byCat.get(a.id) || 0)).slice(0, 4);
  return `<section class="box quick"><h2><span class="box-title">Quick add</span><span class="box-meta">your frequent categories</span></h2>
    <div class="qgrid">${exp.map(c => `<button class="qt" style="--cat:${esc(c.color)}" data-act="quick" data-id="${c.id}"><span class="qt-emoji" aria-hidden="true">${emojiFor(c)}</span><div><b>${esc(c.name)}</b><small>${money(st.byCat.get(c.id) || 0, 0)}</small></div></button>`).join('')}
      <button class="qt inc" data-act="quickinc"><span class="qt-emoji" aria-hidden="true">💰</span><div><b>Income</b><small>${money(st.income, 0)}</small></div></button>
      <button class="qt more" data-act="quickmore"><span class="qt-emoji" aria-hidden="true">＋</span><div><b>More</b><small>Choose any category</small></div></button>
    </div></section>`;
}
function tipCard(A) {
  const t = A.tips[0];
  return `<section class="box toptip"><h2>Smart suggestion <button data-act="goinsights">All insights →</button></h2>
    ${t ? `<div class="bigtip"><div class="em">${t.em}</div><div><b>${esc(t.title)}</b><p>${t.body}</p>${t.save ? `<span class="save">Save ~${money(t.save, 0)}/mo</span>` : ''}</div></div>`
        : `<div class="bigtip"><div class="em">✨</div><div><b>Nothing to flag</b><p>${A.st.spent ? 'Spending looks healthy this month. Keep it up!' : 'Log a few expenses to get personalised tips.'}</p></div></div>`}
  </section>`;
}

function homeView() {
  const p = S.period, r = range(p, S.anchor), st = stats(r), t = today();
  const mst = p === 'month' ? st : stats(range('month', S.anchor));
  const analysis = analyse(S.anchor);
  const budget = budgetFor(S.profile.monthly_budget, p, S.anchor) || 0;
  const ratio = budget > 0 ? st.spent / budget : 0;
  const elapsed = t < r.start ? 0 : t > r.end ? daysIn(r) : Math.round((t - r.start) / 864e5) + 1;
  const left = budget - st.spent;
  const isCurrent = t >= r.start && t <= r.end;
  const daysLeft = t < r.start ? daysIn(r) : t > r.end ? 0 : Math.max(0, daysIn(r) - elapsed);
  const safeDaily = budget && left > 0 && isCurrent ? left / Math.max(1, daysLeft) : 0;
  const bigTxt = budget ? money(Math.abs(left), 0) : money(st.spent, 0);
  const bigLabel = !budget ? 'Spent so far' : left >= 0 ? 'Left to spend' : 'Over budget';
  const status = !budget ? 'Set a budget' : ratio > 1 ? 'Needs attention' : ratio > .8 ? 'Nearly there' : 'On track';
  const daily = Array(daysIn(r)).fill(0);
  st.tx.forEach(x => {
    if (x.type !== 'expense') return;
    const index = Math.round((parse(x.occurred_on) - r.start) / 864e5);
    if (index >= 0 && index < daily.length) daily[index] += x.amount;
  });
  const chartGroups = daily.map((value, index) => {
    const date = addDays(r.start, index);
    return { x: p === 'month' ? date.getDate() : DOW[date.getDay()][0], vals: [value], tip: `${dayLabel(date)}|${money(value)} spent` };
  });
  const dailyBudget = budget ? budget / Math.max(1, daily.length) : 0;
  const averageDaily = elapsed ? st.spent / elapsed : 0;
  const projection = p === 'month' && analysis.isCur ? analysis.projected : st.spent;
  const projectionCopy = p === 'month' && analysis.isCur ? 'Projected this month' : 'Recorded this period';
  const primaryCat = [...st.byCat].sort((a, b) => b[1] - a[1])[0];
  const primary = primaryCat ? cat(primaryCat[0]) : null;
  const transactionCount = st.tx.filter(x => x.type === 'expense').length;

  return `<div class="grid home">
  <section class="home-metrics" aria-label="Budget overview">
    <article class="overview-card overview-primary ${left < 0 ? 'over' : ''}">
      <div class="overview-card-top"><span>${bigLabel}</span><b>${status}</b></div>
      <strong>${bigTxt}</strong>
      <small>${budget ? `${Math.round(ratio * 100)}% of ${money(budget, 0)} budget used` : 'Add a monthly budget in Settings'}</small>
      <div class="overview-progress"><i style="width:${budget ? Math.min(ratio, 1) * 100 : 0}%"></i></div>
      <svg class="overview-shape" viewBox="0 0 220 200" aria-hidden="true"><path d="${BLOB_PATHS[0]}"/></svg>
      <span class="overview-emoji" aria-hidden="true">${primary ? emojiFor(primary) : '✨'}</span>
    </article>
    <article class="overview-card">
      <div class="overview-icon soft-purple" aria-hidden="true">↗</div>
      <span>Spent</span><strong>${money(st.spent, 0)}</strong>
      <small>${transactionCount} expense${transactionCount === 1 ? '' : 's'} · ${money(averageDaily, 0)}/day</small>
    </article>
    <article class="overview-card">
      <div class="overview-icon soft-lime" aria-hidden="true">◎</div>
      <span>${isCurrent ? 'Safe each day' : 'Budget remaining'}</span><strong>${budget ? money(isCurrent ? safeDaily : Math.max(left, 0), 0) : '—'}</strong>
      <small>${isCurrent ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining` : rangeLabel(p, r)}</small>
    </article>
    <article class="overview-card">
      <div class="overview-icon soft-blue" aria-hidden="true">＋</div>
      <span>Income</span><strong>${money(st.income, 0)}</strong>
      <small>${st.tx.length} total transaction${st.tx.length === 1 ? '' : 's'}</small>
    </article>
  </section>
  ${quickAdd(mst)}
  <section class="box home-trend chartbox chart">
    <div class="trend-heading">
      <div><span>Spending activity</span><strong>${money(st.spent, 0)}</strong><small>${rangeLabel(p, r)} · ${status.toLowerCase()}</small></div>
      <button data-act="goinsights">Open insights ↗</button>
    </div>
    <div class="trend-layout">
      <div class="trend-chart">
        <div class="trend-legend"><span><i></i>Daily spend</span>${dailyBudget ? `<span>— ${money(dailyBudget, 0)} daily budget</span>` : ''}</div>
        ${columns({ groups: chartGroups, series: [{ name: 'Spent', color: '#f8f8f3' }], ref: dailyBudget, showX: index => daily.length <= 8 || index === 0 || (index + 1) % 5 === 0 })}
      </div>
      <div class="trend-side">
        <div class="trend-stat"><span>${projectionCopy}</span><strong>${money(projection, 0)}</strong><small>${budget ? projection > budget ? `${money(projection - budget, 0)} above budget` : `${money(budget - projection, 0)} below budget` : 'Budget not set'}</small></div>
        <div class="trend-stat lime"><span>Daily allowance</span><strong>${budget && isCurrent ? money(safeDaily, 0) : '—'}</strong><small>${budget && isCurrent ? 'to stay within budget' : 'available in the current period'}</small></div>
      </div>
    </div>
    <div class="tip"></div>
  </section>
  <section class="box where"><h2><span class="box-title">Summary by category</span><button data-act="goinsights">View all →</button></h2>
    ${st.spent ? categorySummary(st.byCat, st.spent, p, S.anchor, 4) : `<div class="empty">Nothing spent ${p === 'day' ? 'this day' : 'this ' + p} yet.<br>Tap a category above to log one.</div>`}
  </section>
  <section class="box recent"><h2>Recent <button data-goto="history">See all</button></h2>
    ${S.transactions.slice(0, 5).map(txRow).join('') || '<div class="empty">No transactions yet.</div>'}
  </section>
  ${installmentCard()}
  ${tipCard(analysis)}
  </div>`;
}

function monthView() {
  const r = range('month', S.anchor), st = stats(r), n = daysIn(r);
  const daily = Array(n).fill(0);
  st.tx.forEach(t => { if (t.type === 'expense') daily[+t.occurred_on.slice(8) - 1] += t.amount; });
  const ref = S.profile.monthly_budget ? S.profile.monthly_budget / n : 0;
  const net = st.income - st.spent;
  const exp = S.categories.filter(c => c.type === 'expense');
  const inc = new Map(); st.tx.forEach(t => { if (t.type === 'income') inc.set(t.category_id ?? null, (inc.get(t.category_id ?? null) || 0) + t.amount); });
  const budgetRow = (c, spent, b) => {
    const pct = b ? spent / b : 0;
    const flag = !b ? '' : pct > 1 ? '<span class="flag over">Over</span>' : pct >= .8 ? '<span class="flag warn">80%+</span>' : '';
    return `<button class="cat" data-act="editcat" data-id="${c.id ?? ''}">${icoHTML(c)}<div class="track"><div class="t"><span>${esc(c.name)}${flag}</span><span class="s">${b ? `${money(spent, 0)} / ${money(b, 0)}` : `${money(spent, 0)} · set limit`}</span></div><div class="p"><span ${w(b ? Math.min(pct, 1) * 100 : 0)} data-bg="${pct > 1 ? '#D6392F' : esc(c.color)}"></span></div></div></button>`;
  };
  return `<div class="grid month">
  <div class="cards">
    <div class="card"><label>Income</label><b>${money(st.income, 0)}</b></div>
    <div class="card"><label>Spent</label><b>${money(st.spent, 0)}</b></div>
    <div class="card"><label>Net</label><b class="${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : ''}${money(net, 0)}</b></div>
  </div>
  <section class="box chartbox chart"><h2>Daily spending <button data-act="goinsights">Analyse →</button></h2>
    <div class="legend"><span><i style="background:${C_SPENT}"></i>Spent</span>${ref ? `<span>- - Daily budget ${money(ref, 0)}</span>` : ''}</div>
    ${columns({ groups: daily.map((v, i) => ({ x: i + 1, vals: [v], tip: `${DOW[new Date(r.start.getFullYear(), r.start.getMonth(), i + 1).getDay()]} ${i + 1} ${MON[r.start.getMonth()]}|${money(v)}` })), series: [{ name: 'Spent', color: C_SPENT }], ref, showX: i => i === 0 || (i + 1) % 5 === 0 })}
    <div class="tip"></div>
  </section>
  <section class="box budgets"><h2>Budgets <button data-act="settings">Edit</button></h2>
    ${budgetRow({ name: 'All spending', color: '#E9F25B', fg: '#0F0F0F', icon: 'other', id: '__overall' }, st.spent, S.profile.monthly_budget)}
    ${exp.map(c => budgetRow(c, st.byCat.get(c.id) || 0, c.budget)).join('')}
    ${st.byCat.get(null) ? budgetRow(UNCAT, st.byCat.get(null), null) : ''}
  </section>
  ${st.income ? `<section class="box income"><h2>Income</h2>${catList(inc, st.income, 'catinc')}</section>` : ''}
  </div>`;
}

function yearView() {
  const yr = S.anchor.getFullYear(), st = stats(range('year', S.anchor)), t = today();
  const m = Array.from({ length: 12 }, () => ({ s: 0, i: 0 }));
  st.tx.forEach(x => { const k = +x.occurred_on.slice(5, 7) - 1; x.type === 'expense' ? m[k].s += x.amount : m[k].i += x.amount; });
  const active = m.filter(v => v.s || v.i);
  const saved = st.income - st.spent;
  const months = m.map((v, i) => ({ ...v, k: i })).filter(v => !(yr === t.getFullYear() && v.k > t.getMonth()) && (v.s || v.i || yr === t.getFullYear())).reverse();
  const B = S.profile.monthly_budget || 0;
  return `<div class="grid year">
  <div class="cards">
    <div class="card"><label>Income</label><b>${money(st.income, 0)}</b></div>
    <div class="card"><label>Spent</label><b>${money(st.spent, 0)}</b>${active.length ? `<small>avg ${money(st.spent / active.length, 0)}/mo</small>` : ''}</div>
    <div class="card"><label>Saved</label><b class="${saved >= 0 ? 'pos' : 'neg'}">${saved >= 0 ? '+' : ''}${money(saved, 0)}</b>${st.income ? `<small>${Math.round(saved / st.income * 100)}% of income</small>` : ''}</div>
  </div>
  <section class="box chartbox chart"><h2>Month by month</h2>
    <div class="legend"><span><i style="background:${C_SPENT}"></i>Spent</span><span><i style="background:${C_INCOME}"></i>Income</span></div>
    ${columns({ groups: m.map((v, i) => ({ x: MON[i][0], vals: [v.s, v.i], tip: `${MONTHS[i]}|Spent ${money(v.s, 0)} · Income ${money(v.i, 0)}` })), series: [{ name: 'Spent', color: C_SPENT }, { name: 'Income', color: C_INCOME }] })}
    <div class="tip"></div>
  </section>
  <section class="box months"><h2>Months</h2>
    ${months.map(v => `<button class="cat" data-act="gomonth" data-m="${v.k}"><div class="ico" style="background:var(--card2);color:var(--ink);font-weight:700">${MON[v.k]}</div><div class="track"><div class="t"><span>${MONTHS[v.k]}${B && v.s > B ? '<span class="flag over">Over</span>' : ''}</span><span class="s">${money(v.s, 0)}${B ? ' / ' + money(B, 0) : ''}</span></div><div class="p"><span ${w(B ? Math.min(v.s / B, 1) * 100 : 0)} data-bg="${B && v.s > B ? '#D6392F' : C_SPENT}"></span></div></div></button>`).join('') || '<div class="empty">No data for this year.</div>'}
  </section>
  ${st.spent ? `<section class="box topcats"><h2>Top categories · ${yr}</h2>${catList(st.byCat, st.spent)}</section>` : ''}
  </div>`;
}

function insightsView() {
  const A = analyse(S.anchor), st = A.st;
  const face = { good: 'M20 40q50 50 110 0M40 10v.1M110 10v.1', warn: 'M20 50h110M40 10v.1M110 10v.1', bad: 'M20 60q55-45 110 0M40 10v.1M110 10v.1', none: 'M20 50h110' }[A.tone];
  const saveRate = st.income ? (st.income - st.spent) / st.income : null;
  const distribution = [...st.byCat].sort((a, b) => b[1] - a[1]);
  let angle = 0;
  const ring = distribution.length ? distribution.map(([id, value]) => { const start = angle; angle += value / Math.max(st.spent, 1) * 360; return `${cat(id).color} ${start}deg ${angle}deg`; }).join(',') : 'var(--line) 0deg 360deg';

  // calendar heatmap (Mon-first)
  const daily = new Map(); st.tx.forEach(x => { if (x.type === 'expense') daily.set(x.occurred_on, (daily.get(x.occurred_on) || 0) + x.amount); });
  const vals = [...daily.values()].sort((a, b) => a - b), q = p => vals[Math.floor((vals.length - 1) * p)] || 0;
  const cuts = [q(.25), q(.5), q(.8)];
  const lvl = v => !v ? 0 : v <= cuts[0] ? 1 : v <= cuts[1] ? 2 : v <= cuts[2] ? 3 : 4;
  const lead = (A.r.start.getDay() + 6) % 7, t = iso(today());
  let cal = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dh">${d[0]}</div>`).join('') + '<div></div>'.repeat(lead);
  for (let d = 1; d <= A.n; d++) {
    const k = iso(new Date(A.r.start.getFullYear(), A.r.start.getMonth(), d)), v = daily.get(k) || 0;
    cal += `<button class="d l${lvl(v)} ${k > t ? 'fut' : ''} ${k === t ? 'now' : ''}" data-act="day" data-d="${k}" title="${dayLabel(parse(k))}: ${money(v)}">${d}</button>`;
  }
  const busiest = [...daily].sort((a, b) => b[1] - a[1])[0];

  // vs average
  const cmax = Math.max(1, ...A.compare.map(x => Math.max(x.proj, x.avg)));
  const cmp = A.compare.map(x => {
    const c = cat(x.id), diff = x.avg ? (x.proj / x.avg - 1) : null;
    const flag = diff == null ? '<span class="flag warn">New</span>' : diff > .15 ? `<span class="flag over">▲ ${Math.round(diff * 100)}%</span>` : diff < -.15 ? `<span class="flag ok">▼ ${Math.round(-diff * 100)}%</span>` : '';
    return `<button class="cat" data-act="cat" data-id="${x.id ?? ''}">${icoHTML(c, 'sm')}<div class="track"><div class="t"><span>${esc(c.name)}${flag}</span><span class="s">${money(x.proj, 0)}${x.avg ? ' vs ' + money(x.avg, 0) : ''}</span></div><div class="p"><span ${w(x.proj / cmax * 100)} data-bg="${esc(c.color)}"></span>${x.avg ? `<i style="left:${x.avg / cmax * 100}%"></i>` : ''}</div></div></button>`;
  }).join('');

  return `<div class="grid insights">
  <div class="verdict ${A.tone}">
    <div><label>Monthly summary · ${MONTHS[A.r.start.getMonth()]}</label><h3>${A.word}</h3><p>${A.line}</p></div>
    <svg viewBox="0 0 150 90"><path d="${face}"/></svg>
  </div>
  <div class="tiles">
    <div class="card"><label>${A.isCur ? 'Projected' : 'Spent'}</label><b>${money(A.projected, 0)}</b><small>${A.B ? `budget ${money(A.B, 0)}` : 'no budget set'}</small></div>
    <div class="card"><label>Avg per day</label><b>${money(A.elapsed ? st.spent / A.elapsed : 0, 0)}</b><small>${A.isCur ? `${A.remaining} days left` : `${A.n} days`}</small></div>
    <div class="card"><label>Saved</label><b class="${saveRate == null ? '' : saveRate >= 0 ? 'pos' : 'neg'}">${saveRate == null ? '—' : Math.round(saveRate * 100) + '%'}</b><small>${st.income ? `of ${money(st.income, 0)} income` : 'no income logged'}</small></div>
    <div class="card"><label>Could save</label><b>${money(A.potential, 0)}</b><small>per month, across ${A.tips.filter(x => x.kind !== 'pace').length} areas</small></div>
  </div>
  <section class="box breakdown"><h2>Spending mix</h2>
    ${st.spent ? `<div class="donut-wrap"><div class="donut" style="background:conic-gradient(${ring})"><div><small>Spent</small><b>${money(st.spent, 0)}</b></div></div><div class="donut-list">${distribution.slice(0, 6).map(([id, value]) => { const c = cat(id); return `<button data-act="cat" data-id="${id ?? ''}"><i class="donut-emoji" style="--cat:${esc(c.color)}">${emojiFor(c)}</i><span>${esc(c.name)}</span><b>${Math.round(value / st.spent * 100)}%</b></button>`; }).join('')}</div></div>` : '<div class="empty">Add expenses to see your spending mix.</div>'}
  </section>
  <section class="box tipsbox"><h2>Where to cut</h2>
    ${A.tips.length ? A.tips.map(x => `<div class="tipi"><div class="em">${x.em}</div><div><b>${esc(x.title)}</b><p>${x.body}</p>${x.save ? `<span class="save">Save ~${money(x.save, 0)}/mo</span>` : ''}</div></div>`).join('')
      : `<div class="empty">${st.spent ? 'Nothing stands out. Your spending looks balanced. 🎉' : 'No spending logged for this month yet.'}</div>`}
  </section>
  <section class="box calbox"><h2>Spending calendar</h2>
    ${busiest ? `<p class="sub">Biggest day: ${dayLabel(parse(busiest[0]))} · ${money(busiest[1], 0)}</p>` : ''}
    <div class="cal">${cal}</div>
    <div class="scale">Less <i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> More</div>
  </section>
  <section class="box cmpbox"><h2>Vs your 3-month average</h2>
    ${A.prevN ? `<p class="sub">${A.isCur ? 'Bars show this month projected to month-end' : 'Bars show the month'}; the ▏ marks your usual.</p>${cmp}` : '<div class="empty">Comparison appears once you have a previous month of data.</div>'}
  </section>
  </div>`;
}

function installmentsView() {
  const totals = planTotals(), pct = totals.total ? Math.round(totals.paid / totals.total * 100) : 0;
  const active = S.plans.filter(p => planStats(p).remaining), complete = S.plans.filter(p => !planStats(p).remaining);
  return `<div class="grid installments">
    <section class="installment-overview">
      <div class="installment-overview-top"><span>Payment progress</span><button data-act="newplan">+ Add plan</button></div>
      <div class="installment-count"><strong>${totals.paid}</strong><span>of ${totals.total || 0} paid</span></div>
      <div class="plan-overall-bar"><i style="width:${pct}%"></i></div>
      <div class="installment-overview-meta"><span><small>Remaining</small><b>${money(totals.left, 0)}</b></span><span><small>Next payment</small><b>${totals.next ? planDateLabel(totals.next).replace(/^Next /, '') : '—'}</b></span></div>
    </section>
    <section class="box plan-list">
      <h2><span class="box-title">Active plans</span><span class="box-meta">${active.length} ongoing</span></h2>
      ${active.length ? active.map(p => planRow(p)).join('') : `<div class="plan-empty"><span>✨</span><b>Nothing left to pay</b><p>Add a plan when you split a purchase into monthly payments.</p><button class="btn sec2" data-act="newplan">Add installment plan</button></div>`}
      ${complete.length ? `<div class="completed-heading">Paid off</div>${complete.map(p => planRow(p)).join('')}` : ''}
    </section>
  </div>`;
}

function historyView() {
  const pills = [['all', 'All'], ['expense', 'Expenses'], ['income', 'Income']];
  return `<div class="grid history">
  <div class="search"><input id="histQ" type="search" placeholder="Search notes or categories" value="${esc(S.hist.q)}"></div>
  <div class="pills">${pills.map(([k, l]) => `<button class="pill ${S.hist.type === k ? 'on' : ''}" data-act="htype" data-k="${k}">${l}</button>`).join('')}</div>
  <div class="pills">${S.categories.map(c => `<button class="pill ${S.hist.cat === c.id ? 'on' : ''}" data-act="hcat" data-id="${c.id}">${esc(c.name)}</button>`).join('')}</div>
  <div id="histList">${historyList()}</div>
  </div>`;
}
function historyList() {
  const q = S.hist.q.trim().toLowerCase();
  const rows = S.transactions.filter(t => (S.hist.type === 'all' || t.type === S.hist.type) && (!S.hist.cat || t.category_id === S.hist.cat) &&
    (!q || (t.note || '').toLowerCase().includes(q) || cat(t.category_id).name.toLowerCase().includes(q) || String(t.amount).includes(q)));
  if (!rows.length) return '<div class="empty">No transactions match.</div>';
  let html = '', day = null; const shown = rows.slice(0, S.hist.limit);
  const dayTotals = {}; rows.forEach(t => { if (t.type === 'expense') dayTotals[t.occurred_on] = (dayTotals[t.occurred_on] || 0) + t.amount; });
  for (const t of shown) {
    if (t.occurred_on !== day) { html += `${day ? '</div>' : ''}<div class="day"><h3><span>${dayLabel(parse(t.occurred_on))}${parse(t.occurred_on).getFullYear() !== today().getFullYear() ? ' ' + t.occurred_on.slice(0, 4) : ''}</span><span>${dayTotals[t.occurred_on] ? '−' + money(dayTotals[t.occurred_on]) : ''}</span></h3>`; day = t.occurred_on; }
    html += txRow(t);
  }
  html += '</div>';
  if (rows.length > shown.length) html += `<button class="btn sec2" data-act="more">Show more (${rows.length - shown.length})</button>`;
  return html;
}

const VIEWS = { home: homeView, month: monthView, year: yearView, insights: insightsView, history: historyView, installments: installmentsView };

/* ---------- render ---------- */
function render(anim = false) {
  if (!S.profile) return;
  animate = anim;
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
  $('#ptitle').textContent = TITLES[S.view];
  $('#liveTag').innerHTML = S.db.kind === 'demo' ? '<span class="live"></span>Demo · this device' : `<span class="live ${S.live ? 'on' : ''}"></span>${S.live ? 'Live' : 'Connecting…'} · ${dbName()}`;
  const p = curPeriod(), bar = $('.date');
  bar.classList.toggle('hidden', !p);
  if (p) {
    const r = range(p, S.anchor), t = today();
    $('#dateLabel').textContent = rangeLabel(p, r);
    $('#todayBtn').classList.toggle('off', !(t >= r.start && t <= r.end));
  }
  const v = $('#view');
  if (S.view === 'history' && v.dataset.rendered === 'history' && !anim) { $('#histList').innerHTML = historyList(); return; }
  v.dataset.rendered = S.view;
  v.innerHTML = VIEWS[S.view]();
  v.querySelectorAll('[data-bg]').forEach(s => s.style.background = s.dataset.bg);
  wireTips(v);
  if (anim) requestAnimationFrame(() => setTimeout(() => {
    v.querySelectorAll('[data-w]').forEach(s => s.style.width = s.dataset.w + '%');
    const g = v.querySelector('#prog'); if (g) g.setAttribute('stroke-dasharray', g.dataset.g + ' 100');
  }, 60));
}
let rq; const scheduleRender = () => { cancelAnimationFrame(rq); rq = requestAnimationFrame(() => render(false)); };

/* ---------- realtime ---------- */
function indexCats() { S.categories.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.created_at).localeCompare(String(b.created_at))); S.catMap = new Map(S.categories.map(c => [c.id, c])); }
function upsertLocal(key, row) { const i = S[key].findIndex(x => x.id === row.id); if (i >= 0) S[key][i] = row; else S[key].unshift(row); }
function applyChange(table, { eventType, new: n, old: o }) {
  if (table === 'profiles') { if (n) S.profile = { ...S.profile, ...n }; }
  else {
    const id = n?.id || o?.id;
    if (eventType === 'DELETE') {
      S[table] = S[table].filter(x => x.id !== id);
      if (table === 'categories') S.transactions.forEach(t => { if (t.category_id === id) t.category_id = null; });
    } else if (n) upsertLocal(table, n);
    if (table === 'categories') indexCats(); else if (table === 'transactions') S.transactions.sort(sortTx);
  }
  scheduleRender();
}
function setLive(on) { S.live = on; scheduleRender(); }

/* ---------- sheets ---------- */
function openSheet(kind, html) {
  S.sheet = kind; S.armed = null;
  if (!S.returnFocus) S.returnFocus = document.activeElement;
  $('#sheet').dataset.kind = kind;
  $('#sheet').innerHTML = '<div class="grab"></div><button class="sheet-close" data-act="close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg></button>' + html;
  $('#scrim').classList.add('open');
  document.body.classList.add('sheet-open');
  setTimeout(() => $('#sheet').querySelector('input:not([type=hidden]),button:not(.sheet-close),select')?.focus(), 40);
  if (inTG) { try { tg.BackButton.show(); if (kind !== 'tx') tg.MainButton.hide(); } catch {} }
}
function closeSheet() {
  S.sheet = null; $('#scrim').classList.remove('open');
  document.body.classList.remove('sheet-open');
  const target = S.returnFocus; S.returnFocus = null; setTimeout(() => target?.focus?.(), 0);
  if (inTG) { try { tg.BackButton.hide(); tg.MainButton.hide(); } catch {} }
}

// --- add / edit transaction (quick-add aware)
function openTx(tx = null, opts = {}) {
  const defDate = S.view === 'home' && S.period === 'day' ? S.anchor : today();
  const type = opts.type || 'expense';
  S.draft = tx ? { ...tx, amount: String(tx.amount) } : { type, amount: '', category_id: opts.category_id || null, note: '', occurred_on: iso(defDate) };
  renderTxSheet();
  if (!tx && !coarse) setTimeout(() => $('#amt')?.focus(), 200);
}
function suggestions(catId, type) {
  if (!catId) return [];
  const m = new Map(); let seen = 0;
  for (const t of S.transactions) {
    if (t.type !== type || t.category_id !== catId) continue;
    if (++seen > 60) break;
    // one chip per note; use its most common exact amount if it repeats, else the most recent amount
    const k = (t.note || '').trim().toLowerCase();
    const e = m.get(k) || { note: (t.note || '').trim(), amount: t.amount, n: 0, amts: new Map() };
    e.n++; e.amts.set(t.amount, (e.amts.get(t.amount) || 0) + 1); m.set(k, e);
  }
  return [...m.values()].map(e => { const [amt, c] = [...e.amts].sort((a, b) => b[1] - a[1])[0]; return { ...e, amount: c > 1 ? amt : e.amount }; })
    .sort((a, b) => b.n - a.n).slice(0, 5);
}
function suggHTML() {
  const d = S.draft; S.sugg = d.id ? [] : suggestions(d.category_id, d.type);
  return S.sugg.map((s, i) => `<button class="chip" data-act="sugg" data-i="${i}">${esc(s.note || cat(d.category_id).name)}<em>${money(s.amount)}</em></button>`).join('');
}
function readTxInputs() { const d = S.draft; if (!$('#amt')) return; d.amount = $('#amt').value; d.note = $('#note').value; d.occurred_on = $('#when').value || d.occurred_on; }
function txDateLabel(value) {
  if (value === iso(today())) return 'Today';
  const tomorrow = iso(addDays(today(), 1)), yesterday = iso(addDays(today(), -1));
  if (value === yesterday) return 'Yesterday';
  if (value === tomorrow) return 'Tomorrow';
  return dayLabel(parse(value));
}
function setTxError(message = '') {
  const el = $('#txError'); if (el) { el.textContent = message; el.classList.toggle('show', !!message); }
}
function updateTxValidity() {
  if (!S.draft || !$('#amt')) return;
  const amount = parseFloat($('#amt').value.replace(/,/g, ''));
  const valid = amount > 0 && !!S.draft.category_id;
  const save = $('#saveTx'); if (save) save.disabled = !valid;
  if (inTG) { try { valid ? tg.MainButton.enable() : tg.MainButton.disable(); } catch {} }
}
function renderTxSheet() {
  const d = S.draft, cats = S.categories.filter(c => c.type === d.type), c = cat(d.category_id);
  openSheet('tx', `
    <div class="sheet-heading"><span class="eyebrow">${d.id ? 'Edit transaction' : 'New transaction'}</span><h2>${d.id ? 'Update the details' : 'How much did you spend?'}</h2><p>Enter the amount, then choose a category.</p></div>
    <div class="typeseg"><button class="${d.type === 'expense' ? 'on' : ''}" data-act="ttype" data-k="expense">Expense</button><button class="${d.type === 'income' ? 'on' : ''}" data-act="ttype" data-k="income">Income</button></div>
    <div class="amount"><span>${esc(sym())}</span><input id="amt" inputmode="${coarse ? 'none' : 'decimal'}" ${coarse ? 'readonly' : ''} placeholder="0" value="${esc(d.amount)}" autocomplete="off" aria-label="Amount"></div>
    <div class="tx-section-label"><span>Choose category</span><small>Required</small></div>
    <div class="catpick">${cats.map(x => `<button class="${d.category_id === x.id ? 'on' : ''}" data-act="pick" data-id="${x.id}">${icoHTML(x, 'sm')}<span>${esc(x.name)}</span></button>`).join('')}
      <button data-act="newcat"><div class="ico sm" style="background:var(--card);color:var(--ink);font-size:22px">+</div><span>New</span></button></div>
    <div class="sugg" id="sugg">${suggHTML()}</div>
    <div class="tx-details">
      <label class="field"><span>Note <small>Optional</small></span><input id="note" maxlength="200" placeholder="${d.type === 'expense' ? 'What was it for?' : 'Where did it come from?'}" value="${esc(d.note)}"></label>
      <button class="date-chip" data-act="txdate" type="button"><span>Date</span><b id="dateSummary">${txDateLabel(d.occurred_on)}</b><svg viewBox="0 0 24 24"><path d="M7 3v4M17 3v4M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z"/></svg></button>
      <label class="field date-field hidden" id="dateField"><span>Transaction date</span><input id="when" type="date" value="${d.occurred_on}"></label>
    </div>
    <div class="keypad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map(k => `<button data-act="key" data-k="${k}">${k}</button>`).join('')}</div>
    <div class="tx-error" id="txError" role="alert"></div>
    <button class="btn lime ${inTG ? 'hidden' : ''}" id="saveTx" data-act="savetx" disabled>${d.id ? 'Update transaction' : 'Save transaction'}</button>
    ${d.id ? '<button class="btn ghost" data-act="deltx" style="margin-top:10px">Delete</button>' : ''}`);
  sizeAmt();
  updateTxValidity();
  $('#sheet .catpick .on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  if (inTG) { try { tg.MainButton.setText(d.id ? 'Update transaction' : 'Save transaction'); tg.MainButton.show(); updateTxValidity(); } catch {} }
}
function sizeAmt() { const a = $('#amt'); if (a) a.style.width = Math.max(2, a.value.length + .6) + 'ch'; }
function keypad(k) {
  const a = $('#amt'); let v = a.value;
  if (k === '⌫') v = v.slice(0, -1);
  else if (k === '.') { if (!v.includes('.')) v = (v || '0') + '.'; }
  else if (!/\.\d{2}$/.test(v) && v.replace('.', '').length < 9) v = (v === '0' ? '' : v) + k;
  a.value = v; sizeAmt(); updateTxValidity(); setTxError(); tick();
}

async function saveTx() {
  readTxInputs();
  const d = S.draft, amount = Math.round(parseFloat(String(d.amount).replace(/,/g, '')) * 100) / 100;
  if (!(amount > 0) || amount >= 1e10) { setTxError('Enter an amount greater than zero.'); if (!coarse) $('#amt')?.focus(); haptic('error'); return; }
  if (!d.category_id) { setTxError('Choose a category before saving.'); haptic('error'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.occurred_on)) { setTxError('Choose a valid transaction date.'); return; }
  const row = { type: d.type, amount, category_id: d.category_id || null, note: d.note.trim() || null, occurred_on: d.occurred_on };
  closeSheet(); haptic();
  if (d.id) {
    const prev = S.transactions.find(t => t.id === d.id);
    upsertLocal('transactions', { ...prev, ...row }); S.transactions.sort(sortTx); render();
    try { upsertLocal('transactions', await S.db.update('transactions', d.id, row)); toast('Updated'); }
    catch (e) { if (prev) upsertLocal('transactions', prev); toast('Could not save: ' + e.message); }
  } else {
    const temp = { ...row, id: 'tmp-' + Date.now(), created_at: new Date().toISOString() };
    S.transactions.unshift(temp); S.transactions.sort(sortTx); render();
    try {
      const saved = await S.db.insert('transactions', row);
      S.transactions = S.transactions.filter(t => t.id !== temp.id); upsertLocal('transactions', saved);
      toast(`Saved ${row.type === 'income' ? '+' : '−'}${money(amount)} · ${cat(row.category_id).name} · ${txDateLabel(row.occurred_on)}`);
    } catch (e) { S.transactions = S.transactions.filter(t => t.id !== temp.id); toast('Could not save: ' + e.message); }
  }
  S.transactions.sort(sortTx); render();
}
async function deleteTx(id) {
  const prev = S.transactions.find(t => t.id === id); closeSheet();
  S.transactions = S.transactions.filter(t => t.id !== id); render();
  try { await S.db.remove('transactions', id); toast('Deleted'); }
  catch (e) { if (prev) { S.transactions.push(prev); S.transactions.sort(sortTx); render(); } toast('Could not delete: ' + e.message); }
}

// --- category editor
function openCat(c = null, type = 'expense', ret = null) {
  S.catDraft = c ? { ...c } : { name: '', type, icon: 'other', color: SWATCHES[0], budget: null };
  S.catReturn = ret; renderCatSheet();
}
function readCatInputs() { const d = S.catDraft; if (!$('#cname')) return; d.name = $('#cname').value; d.budget = $('#cbudget') ? $('#cbudget').value : d.budget; }
function renderCatSheet() {
  const d = S.catDraft;
  openSheet('cat', `
    <h2>${d.id ? 'Edit' : 'New'} category</h2>
    <div class="typeseg"><button class="${d.type === 'expense' ? 'on' : ''}" data-act="ctype" data-k="expense">Expense</button><button class="${d.type === 'income' ? 'on' : ''}" data-act="ctype" data-k="income">Income</button></div>
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px">${icoHTML({ ...d, fg: fgFor(d.color) })}<label class="field" style="flex:1;margin:0"><input id="cname" maxlength="40" placeholder="Name" value="${esc(d.name)}"></label></div>
    <div class="icons emoji-picker">${Object.entries(CATEGORY_EMOJIS).map(([k, emoji]) => `<button class="${d.icon === k ? 'on' : ''}" data-act="cicon" data-k="${k}" aria-label="${k}"><span aria-hidden="true">${emoji}</span></button>`).join('')}</div>
    <div class="swatches">${SWATCHES.map(s => `<button class="${d.color === s ? 'on' : ''}" style="background:${s}" data-act="ccolor" data-k="${s}" aria-label="${s}"></button>`).join('')}</div>
    ${d.type === 'expense' ? `<label class="field"><span>Monthly limit (optional)</span><input id="cbudget" inputmode="decimal" placeholder="No limit" value="${d.budget ?? ''}"></label>` : ''}
    <button class="btn lime" data-act="savecat">Save</button>
    ${d.id ? '<button class="btn ghost" data-act="delcat" style="margin-top:10px">Delete category</button>' : ''}`);
}
async function saveCat() {
  readCatInputs();
  const d = S.catDraft, name = d.name.trim();
  if (!name) { toast('Give it a name'); return; }
  const b = d.type === 'expense' && String(d.budget ?? '').trim() !== '' ? Math.round(parseFloat(String(d.budget).replace(/,/g, '')) * 100) / 100 : null;
  if (b != null && !(b >= 0)) { toast('Limit must be a number'); return; }
  const row = { name, type: d.type, icon: d.icon, color: d.color, fg: fgFor(d.color), budget: b };
  try {
    const saved = d.id ? await S.db.update('categories', d.id, row)
      : await S.db.insert('categories', { ...row, sort: Math.max(0, ...S.categories.map(c => c.sort || 0)) + 1 });
    upsertLocal('categories', saved); indexCats(); haptic(); toast('Category saved');
    if (S.catReturn === 'settings') openSettings();
    else if (S.catReturn === 'tx' && S.draft) { S.draft.type = saved.type; S.draft.category_id = saved.id; renderTxSheet(); }
    else closeSheet();
    render();
  } catch (e) { toast('Could not save: ' + e.message); }
}
async function deleteCat(id) {
  try {
    await S.db.remove('categories', id);
    S.categories = S.categories.filter(c => c.id !== id); S.transactions.forEach(t => { if (t.category_id === id) t.category_id = null; });
    indexCats(); toast('Category deleted'); S.catReturn === 'settings' ? openSettings() : closeSheet(); render();
  } catch (e) { toast('Could not delete: ' + e.message); }
}

// --- installment plans
function openPlan(plan = null) {
  const expense = S.categories.find(c => c.type === 'expense');
  S.planDraft = plan ? { ...plan } : { kind: 'instalment', name: '', amount: '', category_id: expense?.id || '', frequency: 'monthly', total_payments: 12, paid_before: 0, start_date: iso(today()), auto: false, auto_from: iso(today()), note: '' };
  renderPlanSheet();
}
function readPlanInputs() {
  if (!$('#planName')) return;
  Object.assign(S.planDraft, {
    name: $('#planName').value,
    amount: $('#planAmount').value,
    total_payments: $('#planTotal').value,
    paid_before: $('#planPaid').value,
    start_date: $('#planStart').value,
    category_id: $('#planCategory').value,
    note: $('#planNote').value,
  });
}
function renderPlanSheet() {
  const d = S.planDraft, categories = S.categories.filter(c => c.type === 'expense');
  openSheet('plan', `
    <div class="sheet-heading"><span class="eyebrow">${d.id ? 'Edit instalment' : 'New instalment'}</span><h2>${d.id ? 'Update the payment plan' : 'Track a payment plan'}</h2><p>Add the amount per payment and how many payments are expected.</p></div>
    <label class="field"><span>Plan name</span><input id="planName" maxlength="60" placeholder="Laptop, phone, course…" value="${esc(d.name)}"></label>
    <div class="row2 plan-form-grid">
      <label class="field"><span>Amount per payment</span><input id="planAmount" inputmode="decimal" placeholder="0.00" value="${esc(d.amount)}"></label>
      <label class="field"><span>Total payments</span><input id="planTotal" inputmode="numeric" placeholder="12" value="${esc(d.total_payments)}"></label>
    </div>
    <div class="row2 plan-form-grid">
      <label class="field"><span>Already paid</span><input id="planPaid" inputmode="numeric" placeholder="0" value="${esc(d.paid_before)}"></label>
      <label class="field"><span>First payment date</span><input id="planStart" type="date" value="${esc(d.start_date)}"></label>
    </div>
    <label class="field"><span>Expense category</span><select id="planCategory">${categories.map(c => `<option value="${c.id}" ${d.category_id === c.id ? 'selected' : ''}>${emojiFor(c)} ${esc(c.name)}</option>`).join('')}</select></label>
    <label class="field"><span>Note <small>Optional</small></span><input id="planNote" maxlength="200" placeholder="Store, item details, account…" value="${esc(d.note || '')}"></label>
    <button class="btn lime" data-act="saveplan">Save instalment plan</button>
    ${d.id ? '<button class="btn ghost" data-act="delplan" style="margin-top:10px">Delete plan</button>' : ''}`);
}
async function savePlan() {
  readPlanInputs();
  const d = S.planDraft, name = d.name.trim(), amount = Number(String(d.amount).replace(/,/g, '')), total = Math.floor(Number(d.total_payments)), paid = Math.floor(Number(d.paid_before));
  if (!name) return toast('Give the plan a name');
  if (!(amount > 0)) return toast('Payment amount must be greater than zero');
  if (!(total >= 1)) return toast('Enter the total number of payments');
  if (!(paid >= 0 && paid <= total)) return toast('Paid payments must be between 0 and the total');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.start_date)) return toast('Choose the first payment date');
  if (!d.category_id) return toast('Choose an expense category');
  const row = { kind: 'instalment', name, amount: Math.round(amount * 100) / 100, category_id: d.category_id, frequency: 'monthly', total_payments: total, paid_before: paid, start_date: d.start_date, auto: false, auto_from: d.start_date, note: d.note.trim() || null };
  try {
    const saved = d.id ? await S.db.update('plans', d.id, row) : await S.db.insert('plans', row);
    upsertLocal('plans', saved); closeSheet(); haptic(); toast('Instalment plan saved'); render();
  } catch (e) { toast('Could not save plan: ' + e.message); }
}
async function deletePlan(id) {
  try { await S.db.remove('plans', id); S.plans = S.plans.filter(p => p.id !== id); closeSheet(); toast('Plan deleted'); render(); }
  catch (e) { toast('Could not delete plan: ' + e.message); }
}

// --- settings
const dbName = () => S.db.kind === 'sheets' ? 'Google Sheet' : 'Supabase';
function openMore() {
  const live = S.db.kind !== 'demo'
    ? `<span class="live ${S.live ? 'on' : ''}"></span>${S.live ? `Live sync is on · ${dbName()}` : `Connecting to ${dbName()}…`}`
    : '<span class="live"></span>Demo data stays on this device';
  openSheet('more', `
    <div class="sheet-heading"><span class="eyebrow">Explore</span><h2>More ways to understand your money</h2><p>Open a report or manage how the app works.</p></div>
    <div class="more-grid">
      <button data-act="moreplans"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 9h8M8 13h5M8 17h3"/></svg><span><b>Instalments</b><small>Payment progress and due dates</small></span></button>
      <button data-act="moremonth"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M7 3v4M17 3v4M4 10h16M8 14h2M14 14h2M8 17h2"/></svg><span><b>Month</b><small>Daily spending and budgets</small></span></button>
      <button data-act="moreyear"><svg viewBox="0 0 24 24"><path d="M5 20V11M10 20V5M15 20v-7M20 20V8"/><path d="M3 20.5h19"/></svg><span><b>Year</b><small>Income and spending trends</small></span></button>
      <button data-act="moresettings"><svg viewBox="0 0 24 24"><path d="M12 3.5c1.4 0 1.7 1.8 2.9 2.3 1.2.5 2.7-.6 3.7.4 1 1-.1 2.5.4 3.7.5 1.2 2.3 1.5 2.3 2.9s-1.8 1.7-2.3 2.9c-.5 1.2.6 2.7-.4 3.7-1 1-2.5-.1-3.7.4-1.2.5-1.5 2.3-2.9 2.3s-1.7-1.8-2.9-2.3c-1.2-.5-2.7.6-3.7-.4-1-1 .1-2.5-.4-3.7-.5-1.2-2.3-1.5-2.3-2.9s1.8-1.7 2.3-2.9c.5-1.2-.6-2.7.4-3.7 1-1 2.5.1 3.7-.4 1.2-.5 1.5-2.3 2.9-2.3Z"/><circle cx="12" cy="12" r="3"/></svg><span><b>Settings</b><small>Budgets, categories and data</small></span></button>
    </div>
    <div class="sync-card">${live}</div>`);
}

function openSettings() {
  const P = S.profile, theme = localStorage.getItem('spend-theme') || 'auto';
  const who = S.db.kind !== 'demo' ? `Live database · ${dbName()}<br><small style="color:var(--mute)">${esc(S.db.user?.email || '')} · <span class="live ${S.live ? 'on' : ''}"></span>${S.live ? 'realtime connected' : 'connecting…'}</small>` : 'Demo mode · stored on this device only';
  openSheet('settings', `
    <h2>Settings</h2>
    <div class="row2" style="grid-template-columns:1fr 1fr">
      <label class="field"><span>Currency</span><select id="cur">${Object.keys(SYMBOLS).map(k => `<option ${P.currency === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
      <label class="field"><span>Monthly budget</span><input id="mb" inputmode="decimal" value="${P.monthly_budget ?? ''}"></label>
    </div>
    <div class="field"><span>Appearance</span><div class="typeseg" style="grid-template-columns:repeat(3,1fr)">${['auto', 'light', 'dark'].map(k => `<button class="${theme === k ? 'on' : ''}" data-act="theme" data-k="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div></div>
    <div class="boxh" style="margin-top:14px">Categories <button data-act="addcat">+ New</button></div>
    <div class="setlist">${S.categories.map(c => `<button class="cat" data-act="setcat" data-id="${c.id}">${icoHTML(c, 'sm')}<div class="track"><div class="t" style="margin:0"><span>${esc(c.name)}</span><span class="s">${c.type === 'income' ? 'income' : c.budget ? money(c.budget, 0) + '/mo' : 'no limit'}</span></div></div></button>`).join('')}</div>
    <div class="boxh" style="margin-top:14px">Data</div>
    <p style="margin:0 4px 12px;line-height:1.5">${who}</p>
    <button class="btn sec2" data-act="csv">Export CSV</button>
    ${S.db.kind === 'demo' ? '<button class="btn" data-act="connect" style="margin-top:10px">Connect Supabase</button><button class="btn ghost" data-act="resetdemo" style="margin-top:10px">Reset demo data</button>' : '<button class="btn ghost" data-act="signout" style="margin-top:10px">Sign out</button>'}`);
  $('#cur').onchange = e => saveProfile({ currency: e.target.value });
  $('#mb').onchange = e => { const v = parseFloat(e.target.value.replace(/,/g, '')); if (v >= 0) saveProfile({ monthly_budget: Math.round(v * 100) / 100 }); else toast('Budget must be a number'); };
}
async function saveProfile(patch) {
  const prev = S.profile; S.profile = { ...S.profile, ...patch }; render();
  try { S.profile = { ...S.profile, ...(await S.db.saveProfile(patch)) }; toast('Saved'); render(); }
  catch (e) { S.profile = prev; render(); toast('Could not save: ' + e.message); }
}
function exportCSV() {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['date', 'type', 'amount', 'currency', 'category', 'note'].join(',')]
    .concat(S.transactions.map(t => [t.occurred_on, t.type, t.amount.toFixed(2), S.profile.currency, q(cat(t.category_id).name), q(t.note)].join(',')));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  a.download = `spend-${iso(today())}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// --- recap (period summary on Home)
function openRecap() {
  const p = S.period, r = range(p, S.anchor), st = stats(r), t = today();
  // compare like-for-like: same number of elapsed days in the previous period
  const pr = range(p, shift(p, S.anchor, -1));
  const elapsed = t >= r.start && t <= r.end ? Math.round((t - r.start) / 864e5) : daysIn(r) - 1;
  const pv = stats({ start: pr.start, end: addDays(pr.start, Math.min(elapsed, daysIn(pr) - 1)) });
  const budget = budgetFor(S.profile.monthly_budget, p, S.anchor) || 0;
  const top = [...st.byCat].sort((a, b) => b[1] - a[1])[0];
  const biggest = st.tx.filter(x => x.type === 'expense').sort((a, b) => b.amount - a.amount)[0];
  const over = S.categories.filter(c => c.type === 'expense' && c.budget > 0 && (st.byCat.get(c.id) || 0) > budgetFor(c.budget, p, S.anchor));
  const label = rangeLabel(p, r), pl = { day: 'the day before', week: 'the same point last week', month: 'the same point last month' }[p];
  const lines = [];
  if (!st.spent && !st.income) lines.push(`Nothing logged for <b>${label}</b> yet.`);
  else {
    lines.push(`You spent <b>${money(st.spent)}</b> in ${label}${budget ? `, which is <b>${Math.round(st.spent / budget * 100)}%</b> of your ${money(budget, 0)} budget` : ''}.`);
    if (pv.spent) { const d = st.spent - pv.spent; lines.push(`That's <b>${money(Math.abs(d), 0)} ${d >= 0 ? 'more' : 'less'}</b> than ${pl} (${money(pv.spent, 0)}).`); }
    if (top) lines.push(`Biggest category: <b>${esc(cat(top[0]).name)}</b> at ${money(top[1])} (${Math.round(top[1] / st.spent * 100)}%).`);
    if (biggest) lines.push(`Largest single expense: <b>${money(biggest.amount)}</b>${biggest.note ? ` for ${esc(biggest.note)}` : ''} on ${dayLabel(parse(biggest.occurred_on))}.`);
    if (over.length) lines.push(`Over the limit: <b>${over.map(c => esc(c.name)).join(', ')}</b>.`);
    else if (st.spent) lines.push('Every category is within its limit. 🎉');
    if (st.income) lines.push(`Income: <b>${money(st.income)}</b>. Net: <b>${st.income - st.spent >= 0 ? '+' : ''}${money(st.income - st.spent)}</b>.`);
  }
  openSheet('recap', `<h2>Recap · ${label}</h2><div class="recapbody">${lines.map(l => `<p>${l}</p>`).join('')}</div><button class="btn sec2" data-act="goinsights">See monthly insights</button><button class="btn" data-act="close" style="margin-top:10px">Done</button>`);
}

/* ---------- events ---------- */
function go(view) { S.view = view; $('#view').dataset.rendered = ''; window.scrollTo(0, 0); render(true); }

document.addEventListener('click', e => { const b = e.target.closest('[data-view],[data-goto]'); if (b && !b.closest('#sheet')) go(b.dataset.view || b.dataset.goto); });
$('#navAdd').onclick = () => openTx();
$('#navMore').onclick = () => openMore();
$('#gear').onclick = $('#gear2').onclick = () => openSettings();
$('#prev').onclick = () => { S.anchor = shift(curPeriod(), S.anchor, -1); render(true); };
$('#next').onclick = () => { S.anchor = shift(curPeriod(), S.anchor, 1); render(true); };
$('#todayBtn').onclick = () => { S.anchor = today(); render(true); };

$('#view').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.dataset.id || null;
  switch (b.dataset.act) {
    case 'period': S.period = b.dataset.p; render(true); break;
    case 'recap': openRecap(); break;
    case 'quick': openTx(null, { category_id: id }); break;
    case 'quickinc': openTx(null, { type: 'income' }); break;
    case 'quickmore': openTx(); break;
    case 'goinsights': go('insights'); break;
    case 'goplans': go('installments'); break;
    case 'newplan': openPlan(); break;
    case 'plan': { const p = S.plans.find(x => x.id === id); if (p) openPlan(p); break; }
    case 'cat': S.hist = { type: 'expense', cat: id, q: '', limit: 150 }; go('history'); break;
    case 'catinc': S.hist = { type: 'income', cat: id, q: '', limit: 150 }; go('history'); break;
    case 'editcat': if (id === '__overall') openSettings(); else if (id) openCat(S.catMap.get(id)); break;
    case 'settings': openSettings(); break;
    case 'gomonth': S.anchor = new Date(S.anchor.getFullYear(), +b.dataset.m, 1); go('month'); break;
    case 'day': S.anchor = parse(b.dataset.d); S.period = 'day'; go('home'); break;
    case 'htype': S.hist.type = b.dataset.k; S.hist.limit = 150; render(true); break;
    case 'hcat': S.hist.cat = S.hist.cat === id ? null : id; S.hist.limit = 150; render(true); break;
    case 'more': S.hist.limit += 300; render(); break;
    case 'tx': { const t = S.transactions.find(x => x.id === id); if (t && !t.id.startsWith('tmp-')) openTx(t); break; }
  }
});
$('#view').addEventListener('input', e => { if (e.target.id === 'histQ') { S.hist.q = e.target.value; S.hist.limit = 150; render(); } });

$('#sheet').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const k = b.dataset.k, id = b.dataset.id;
  // two-tap confirm for destructive actions (no blocking browser dialogs; they freeze Telegram webviews)
  const confirm2 = (key, label) => { if (S.armed === key) return true; S.armed = key; b.textContent = label; haptic('warning'); setTimeout(() => { if (S.armed === key) S.armed = null; }, 4000); return false; };
  switch (b.dataset.act) {
    case 'ttype': readTxInputs(); S.draft.type = k; S.draft.category_id = null; renderTxSheet(); break;
    case 'pick': {
      S.draft.category_id = id; tick();
      $('#sheet').querySelectorAll('.catpick button').forEach(x => x.classList.toggle('on', x === b));
      $('#sugg').innerHTML = suggHTML(); updateTxValidity(); setTxError(); break;
    }
    case 'sugg': { const s = S.sugg[+b.dataset.i]; if (!s) break; $('#amt').value = String(s.amount); $('#note').value = s.note; sizeAmt(); updateTxValidity(); setTxError(); tick(); break; }
    case 'key': keypad(k); break;
    case 'txdate': $('#dateField').classList.toggle('hidden'); if (!$('#dateField').classList.contains('hidden')) $('#when').focus(); break;
    case 'newcat': readTxInputs(); openCat(null, S.draft.type, 'tx'); break;
    case 'savetx': saveTx(); break;
    case 'deltx': if (confirm2('tx', 'Tap again to delete')) deleteTx(S.draft.id); break;
    case 'ctype': readCatInputs(); S.catDraft.type = k; renderCatSheet(); break;
    case 'cicon': readCatInputs(); S.catDraft.icon = k; renderCatSheet(); break;
    case 'ccolor': readCatInputs(); S.catDraft.color = k; renderCatSheet(); break;
    case 'savecat': saveCat(); break;
    case 'delcat': if (confirm2('cat', 'Tap again: past entries become Uncategorised')) deleteCat(S.catDraft.id); break;
    case 'saveplan': savePlan(); break;
    case 'delplan': if (confirm2('plan', 'Tap again to delete this plan')) deletePlan(S.planDraft.id); break;
    case 'addcat': openCat(null, 'expense', 'settings'); break;
    case 'setcat': openCat(S.catMap.get(id), 'expense', 'settings'); break;
    case 'theme': localStorage.setItem('spend-theme', k); applyTheme(); openSettings(); break;
    case 'csv': exportCSV(); break;
    case 'resetdemo': if (confirm2('reset', 'Tap again to reset all demo data')) { S.db.reset(); location.reload(); } break;
    case 'connect': localStorage.removeItem('spend-config'); location.reload(); break;
    case 'signout': S.db.signOut().then(() => location.reload()); break;
    case 'moremonth': closeSheet(); go('month'); break;
    case 'moreyear': closeSheet(); go('year'); break;
    case 'moreplans': closeSheet(); go('installments'); break;
    case 'moresettings': openSettings(); break;
    case 'goinsights': closeSheet(); go('insights'); break;
    case 'close': closeSheet(); break;
  }
});
$('#sheet').addEventListener('input', e => {
  if (e.target.id === 'amt') { e.target.value = e.target.value.replace(/[^\d.,]/g, '').replace(/(\..*)\./g, '$1'); sizeAmt(); updateTxValidity(); setTxError(); }
  if (e.target.id === 'when') { S.draft.occurred_on = e.target.value; $('#dateSummary').textContent = txDateLabel(e.target.value); setTxError(); }
});
$('#sheet').addEventListener('keydown', e => { if (e.key === 'Enter' && S.sheet === 'tx' && e.target.tagName === 'INPUT') { e.preventDefault(); saveTx(); } });
$('#scrim').addEventListener('click', e => { if (e.target.id === 'scrim') closeSheet(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.sheet) return closeSheet();
  if (e.key === 'Tab' && S.sheet) {
    const focusable = [...$('#sheet').querySelectorAll('button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled])')].filter(x => x.offsetParent !== null);
    if (focusable.length) {
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  // desktop shortcut: press N to add a transaction
  if (!S.sheet && S.profile && (e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) { e.preventDefault(); openTx(); }
});

/* ---------- theme & Telegram ---------- */
function applyTheme() {
  let t = localStorage.getItem('spend-theme') || 'auto';
  if (t === 'auto' && inTG) t = tg.colorScheme;
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
}
let startupLoaderShownAt = 0, startupLoaderTimer = null;
function showStartupLoader() {
  if (!inTG) return;
  const loader = $('#startupLoader'); if (!loader) return;
  clearTimeout(startupLoaderTimer); startupLoaderShownAt = performance.now();
  loader.classList.remove('leaving'); loader.classList.add('show');
  document.body.classList.add('startup-loading');
}
function hideStartupLoader() {
  const loader = $('#startupLoader'); if (!loader?.classList.contains('show')) return;
  const wait = Math.max(0, 850 - (performance.now() - startupLoaderShownAt));
  clearTimeout(startupLoaderTimer);
  startupLoaderTimer = setTimeout(() => {
    loader.classList.add('leaving');
    setTimeout(() => {
      loader.classList.remove('show', 'leaving');
      document.body.classList.remove('startup-loading');
    }, 360);
  }, wait);
}
function initTelegram() {
  if (!inTG) return;
  showStartupLoader();
  try {
    tg.ready(); tg.expand();
    tg.MainButton.setParams({ color: '#E9F25B', text_color: '#0F0F0F' });
    tg.MainButton.onClick(() => { if (S.sheet === 'tx') saveTx(); });
    tg.BackButton.onClick(closeSheet);
    tg.onEvent('themeChanged', applyTheme);
  } catch (e) { console.warn('Telegram init', e); }
}

/* ---------- boot ---------- */
function show(id) { ['setup', 'auth', 'app'].forEach(x => $('#' + x).classList.toggle('hidden', x !== id)); }

async function start() {
  if (S.started) return; S.started = true;
  show('app');
  $('#view').innerHTML = '<div class="empty">Loading…</div>';
  try {
    Object.assign(S, await S.db.load()); indexCats(); S.transactions.sort(sortTx);
    S.db.subscribe(applyChange, setLive);
    render(true);
    hideStartupLoader();
  } catch (e) {
    console.error(e);
    $('#view').innerHTML = `<div class="empty">Couldn't load your data.<br><small>${esc(e.message)}</small><br><br>${S.db?.kind === 'sheets' ? 'Check the Google Sheet web app is deployed and you ran setup().' : 'Did you run <code>supabase/schema.sql</code>?'}</div><div style="padding:0 20px"><button class="btn sec2" onclick="localStorage.removeItem('spend-config');location.reload()">Change database</button></div>`;
    hideStartupLoader();
  }
}

async function boot() {
  initTelegram(); applyTheme();
  let cfg = null; try { cfg = JSON.parse(localStorage.getItem('spend-config')); } catch {}
  cfg = cfg || window.SPEND_CONFIG || null;
  if (!cfg) { show('setup'); hideStartupLoader(); return; }
  if (cfg.mode === 'demo') { S.db = new SpendDB.DemoDB(); return start(); }
  if (!window.supabase) { show('setup'); $('#setupErr').textContent = 'Could not load the Supabase library. Check your connection.'; hideStartupLoader(); return; }
  S.db = new SpendDB.SupabaseDB(cfg.url, cfg.key);
  // Supabase may complete a magic-link sign-in asynchronously; defer work out of the auth callback.
  S.db.onAuth(s => setTimeout(() => { if (s && !S.started) start(); else if (!s && S.started) location.reload(); }, 0));
  const session = await S.db.session().catch(() => null);
  if (session) start(); else if (!S.started) { show('auth'); hideStartupLoader(); }
}

/* setup screen */
$('#connectBtn').onclick = () => {
  const url = $('#sbUrl').value.trim().replace(/\/+$/, ''), key = $('#sbKey').value.trim();
  if (!/^https:\/\/.+/.test(url)) return $('#setupErr').textContent = 'Project URL should look like https://xxxx.supabase.co';
  if (key.length < 20) return $('#setupErr').textContent = 'Paste the anon public key from Project Settings → API';
  localStorage.setItem('spend-config', JSON.stringify({ mode: 'supabase', url, key })); location.reload();
};
$('#demoBtn').onclick = () => { localStorage.setItem('spend-config', JSON.stringify({ mode: 'demo' })); location.reload(); };

/* auth screen */
let authEmail = null;
$('#authBtn').onclick = async () => {
  const btn = $('#authBtn'), err = $('#authErr'); err.textContent = '';
  btn.disabled = true;
  try {
    if (!authEmail) {
      const email = $('#email').value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email');
      await S.db.sendCode(email); authEmail = email;
      $('#emailField').classList.add('hidden'); $('#codeField').classList.remove('hidden');
      $('#authMsg').innerHTML = `Code sent to <b>${esc(email)}</b>. Enter it below, or tap the link in the email on this device.`;
      btn.textContent = 'Verify'; $('#code').focus();
    } else {
      await S.db.verify(authEmail, $('#code').value.trim()); start();
    }
  } catch (e) { err.textContent = e.message || String(e); }
  btn.disabled = false;
};
$('#code').addEventListener('keydown', e => { if (e.key === 'Enter') $('#authBtn').click(); });
$('#email').addEventListener('keydown', e => { if (e.key === 'Enter') $('#authBtn').click(); });
$('#authBack').onclick = () => { localStorage.removeItem('spend-config'); location.reload(); };

boot().catch(e => {
  console.error('Boot failed', e);
  show('setup');
  $('#setupErr').textContent = 'The app could not start. Please try again.';
  hideStartupLoader();
});
