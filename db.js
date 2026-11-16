/* Data layer. Two backends with one interface:
 *   SupabaseDB – live Postgres database with realtime sync (the real thing)
 *   DemoDB     – localStorage + BroadcastChannel, so you can try the app offline
 * Interface:
 *   load() -> {profile, categories, transactions}
 *   insert(table,row) -> row · update(table,id,patch) -> row · remove(table,id)
 *   saveProfile(patch) -> profile
 *   subscribe(onChange(table, {eventType,new,old}), onStatus(bool))
 */

const DEFAULT_PROFILE = { currency: 'SGD', monthly_budget: 800 };
const DEFAULT_CATEGORIES = [
  { name: 'Transport', type: 'expense', color: '#AFCBF7', fg: '#171717', icon: 'transport', budget: 450, sort: 1 },
  { name: 'Bills',     type: 'expense', color: '#F2B8B5', fg: '#171717', icon: 'bills',     budget: 150, sort: 2 },
  { name: 'Shopping',  type: 'expense', color: '#E8B8DF', fg: '#171717', icon: 'shopping',  budget: 120, sort: 3 },
  { name: 'Dining',    type: 'expense', color: '#F4C0A8', fg: '#171717', icon: 'dining',    budget: 150, sort: 4 },
  { name: 'Groceries', type: 'expense', color: '#B7D5C8', fg: '#171717', icon: 'groceries', budget: 200, sort: 5 },
  { name: 'Health',    type: 'expense', color: '#BFE1D5', fg: '#171717', icon: 'health',    budget: null, sort: 6 },
  { name: 'Fun',       type: 'expense', color: '#ECEAA4', fg: '#171717', icon: 'fun',       budget: null, sort: 7 },
  { name: 'Other',     type: 'expense', color: '#D6D2CB', fg: '#171717', icon: 'other',     budget: null, sort: 8 },
  { name: 'Salary',       type: 'income', color: '#B9DCCB', fg: '#171717', icon: 'salary', budget: null, sort: 20 },
  { name: 'Other income', type: 'income', color: '#CEC3F4', fg: '#171717', icon: 'gift',   budget: null, sort: 21 },
];
const TABLES = ['transactions', 'categories', 'profiles'];
// Postgres numeric arrives as a string; convert money columns to numbers
const num = r => { if (!r) return r; const o = { ...r }; for (const k of ['amount', 'budget', 'monthly_budget']) if (o[k] != null) o[k] = +o[k]; return o; };

/* ---------------- Supabase ---------------- */
class SupabaseDB {
  constructor(url, key) {
    // A Google Apps Script URL means the Google Sheets backend (keeps app.js boot unchanged)
    if (SheetsDB.isSheetsUrl(url)) return new SheetsDB(url, key);
    this.kind = 'supabase';
    this.sb = window.supabase.createClient(url, key, { auth: { persistSession: true, detectSessionInUrl: true, storageKey: 'spend-auth' } });
  }
  async session() {
    const tgw = window.Telegram?.WebApp, tgId = tgw?.initDataUnsafe?.user?.id;
    let { data: { session } } = await this.sb.auth.getSession();
    // Inside Telegram: a stored session must belong to the same Telegram account (shared devices)
    if (session && tgId && session.user.user_metadata?.telegram_id !== tgId) { await this.sb.auth.signOut(); session = null; }
    if (!session && tgw?.initData) session = await this.telegramSignIn(tgw.initData);
    this.user = session?.user; return session;
  }
  // Exchange Telegram's signed initData for a Supabase session via the telegram-auth Edge Function
  async telegramSignIn(initData) {
    const { data, error } = await this.sb.functions.invoke('telegram-auth', { body: { initData } });
    if (error || !data?.token_hash) { console.error('Telegram sign-in failed', error || data); return null; }
    let r = await this.sb.auth.verifyOtp({ token_hash: data.token_hash, type: 'email' });
    if (r.error) r = await this.sb.auth.verifyOtp({ token_hash: data.token_hash, type: 'magiclink' });
    if (r.error) { console.error('Telegram sign-in failed', r.error); return null; }
    return r.data.session;
  }
  onAuth(cb) { this.sb.auth.onAuthStateChange((_e, s) => { this.user = s?.user; cb(s); }); }
  async sendCode(email) {
    const { error } = await this.sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.href.split('#')[0] } });
    if (error) throw error;
  }
  async verify(email, token) {
    const { data, error } = await this.sb.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw error; this.user = data.user; return data.session;
  }
  async signOut() { await this.sb.auth.signOut(); }
  ok({ data, error }) { if (error) throw error; return data; }
  planKey() { return `spend-plans-v1:${this.user?.id || 'local'}`; }
  readPlans() { try { return JSON.parse(localStorage.getItem(this.planKey())) || []; } catch { return []; } }
  writePlans(plans) { localStorage.setItem(this.planKey(), JSON.stringify(plans)); }
  localId() { return crypto.randomUUID ? crypto.randomUUID() : 'plan-' + Date.now().toString(36) + Math.random().toString(36).slice(2); }

  async load() {
    // First visit: create profile. Only the request that actually inserted it seeds categories (race-safe across tabs).
    const inserted = this.ok(await this.sb.from('profiles').upsert({ user_id: this.user.id, ...DEFAULT_PROFILE }, { onConflict: 'user_id', ignoreDuplicates: true }).select());
    if (inserted?.length) this.ok(await this.sb.from('categories').insert(DEFAULT_CATEGORIES));
    const [profile, categories] = await Promise.all([
      this.sb.from('profiles').select('*').single().then(r => this.ok(r)),
      this.sb.from('categories').select('*').order('sort').order('created_at').then(r => this.ok(r)),
    ]);
    const transactions = [];
    for (let from = 0; ; from += 1000) { // PostgREST caps responses at 1000 rows
      const page = this.ok(await this.sb.from('transactions').select('*').order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).range(from, from + 999));
      transactions.push(...page); if (page.length < 1000) break;
    }
    return { profile: num(profile), categories: categories.map(num), transactions: transactions.map(num), plans: this.readPlans().map(num) };
  }
  async insert(t, row) {
    if (t === 'plans') { const plans = this.readPlans(), saved = { ...row, id: this.localId(), created_at: new Date().toISOString() }; plans.push(saved); this.writePlans(plans); return num(saved); }
    return num(this.ok(await this.sb.from(t).insert(row).select().single()));
  }
  async update(t, id, patch) {
    if (t === 'plans') { const plans = this.readPlans(), i = plans.findIndex(x => x.id === id); if (i < 0) throw new Error('Plan not found'); plans[i] = { ...plans[i], ...patch }; this.writePlans(plans); return num(plans[i]); }
    return num(this.ok(await this.sb.from(t).update(patch).eq('id', id).select().single()));
  }
  async remove(t, id) {
    if (t === 'plans') { this.writePlans(this.readPlans().filter(x => x.id !== id)); return; }
    this.ok(await this.sb.from(t).delete().eq('id', id));
  }
  async saveProfile(patch) { return num(this.ok(await this.sb.from('profiles').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', this.user.id).select().single())); }
  subscribe(onChange, onStatus) {
    if (this.ch) this.sb.removeChannel(this.ch);
    let ch = this.sb.channel('spend-' + this.user.id);
    for (const table of TABLES) ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, p => onChange(table, { eventType: p.eventType, new: num(p.new), old: p.old }));
    this.ch = ch.subscribe(s => onStatus(s === 'SUBSCRIBED'));
  }
}

/* ---------------- Demo (on-device) ---------------- */
class DemoDB {
  constructor() { this.kind = 'demo'; this.key = 'spend-demo-v1'; this.bc = 'BroadcastChannel' in window ? new BroadcastChannel('spend-demo') : null; }
  async session() { return { user: { email: 'demo' } }; }
  onAuth() {} async signOut() {}
  id() { return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2); }
  read() { try { return JSON.parse(localStorage.getItem(this.key)); } catch { return null; } }
  write(s) { localStorage.setItem(this.key, JSON.stringify(s)); }
  seed() {
    const categories = DEFAULT_CATEGORIES.map(c => ({ ...c, id: this.id(), created_at: new Date().toISOString() }));
    const by = n => categories.find(c => c.name === n).id;
    let r = 7; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
    const plan = [['Transport', 0.9, 4, 22, 'MRT / Grab'], ['Dining', 0.6, 8, 28, 'Lunch'], ['Groceries', 0.25, 12, 60, 'FairPrice'], ['Shopping', 0.12, 15, 80, 'Online order'], ['Fun', 0.08, 12, 45, 'Movies'], ['Health', 0.04, 20, 60, 'Pharmacy']];
    const tx = []; const today = new Date();
    for (let back = 0; back < 6; back++) {
      const m = new Date(today.getFullYear(), today.getMonth() - back, 1);
      const last = back === 0 ? today.getDate() : new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
      const d = day => `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      tx.push({ type: 'income', amount: 4200, category_id: by('Salary'), note: 'Salary', occurred_on: d(1) });
      if (last >= 3) tx.push({ type: 'expense', amount: 136.82, category_id: by('Bills'), note: 'Phone + utilities', occurred_on: d(3) });
      for (let day = 1; day <= last; day++) for (const [n, p, lo, hi, note] of plan)
        if (rnd() < p) tx.push({ type: 'expense', amount: Math.round((lo + rnd() * (hi - lo)) * 100) / 100, category_id: by(n), note, occurred_on: d(day) });
    }
    const transactions = tx.map((t, i) => ({ ...t, id: this.id(), created_at: new Date(Date.now() - i * 1000).toISOString() }));
    const monthStart = new Date(today.getFullYear(), today.getMonth() - 6, 1);
    const start = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}-05`;
    const plans = [
      { id: this.id(), kind: 'instalment', name: 'Laptop', amount: 180, category_id: by('Shopping'), frequency: 'monthly', total_payments: 12, paid_before: 7, start_date: start, auto: false, auto_from: start, note: 'Work setup', created_at: new Date().toISOString() },
      { id: this.id(), kind: 'instalment', name: 'Phone', amount: 95, category_id: by('Bills'), frequency: 'monthly', total_payments: 24, paid_before: 10, start_date: start, auto: false, auto_from: start, note: 'Device plan', created_at: new Date().toISOString() },
    ];
    const s = { profile: { ...DEFAULT_PROFILE }, categories, transactions, plans }; this.write(s); return s;
  }
  async load() {
    const s = this.read() || this.seed(); s.plans = s.plans || [];
    const added = autoPostPlans(s.plans, s.transactions, () => this.id());
    s.transactions.unshift(...added); this.write(s);
    return JSON.parse(JSON.stringify(s));
  }
  emit(table, eventType, row, old) { const msg = { table, eventType, new: row, old: old || { id: row?.id } }; this.bc?.postMessage(msg); }
  async insert(t, row) { const s = this.read(); const r = { ...row, id: this.id(), created_at: new Date().toISOString() }; s[t].unshift(r); this.write(s); this.emit(t, 'INSERT', r); return r; }
  async update(t, id, patch) { const s = this.read(); const i = s[t].findIndex(x => x.id === id); if (i < 0) throw new Error('Not found'); s[t][i] = { ...s[t][i], ...patch }; this.write(s); this.emit(t, 'UPDATE', s[t][i]); return s[t][i]; }
  async remove(t, id) {
    const s = this.read(); s[t] = s[t].filter(x => x.id !== id);
    if (t === 'categories') s.transactions.forEach(x => { if (x.category_id === id) x.category_id = null; }); // mirror "on delete set null"
    this.write(s); this.emit(t, 'DELETE', null, { id });
  }
  async saveProfile(patch) { const s = this.read(); s.profile = { ...s.profile, ...patch }; this.write(s); this.emit('profiles', 'UPDATE', s.profile); return s.profile; }
  subscribe(onChange, onStatus) {
    if (this.bc) this.bc.onmessage = e => onChange(e.data.table, e.data);
    onStatus(!!this.bc);
  }
  reset() { localStorage.removeItem(this.key); }
}

/* ---------------- Google Sheets (via Apps Script web app) ----------------
 * See google-sheets/Code.gs. Auth: a passcode in the browser, or Telegram's signed initData in the Mini App.
 * "Live": polls a version counter (bumped on every write) and diffs changes into realtime-style events.
 */
class SheetsDB {
  static isSheetsUrl(u) { return /^https:\/\/script\.google(usercontent)?\.com\//.test(u || ''); }
  constructor(url, pass) { this.kind = 'sheets'; this.url = url; this.pass = pass || localStorage.getItem('spend-sheets-pass') || ''; this.version = -1; this.snap = null; }
  id() { return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2); }
  auth() { const tgw = window.Telegram?.WebApp; return tgw?.initData ? { initData: tgw.initData } : { pass: this.pass }; }
  async call(action, args = {}) {
    // text/plain avoids a CORS preflight, which Apps Script can't answer
    const res = await fetch(this.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, auth: this.auth(), ...args }) });
    let j; try { j = await res.json(); } catch { throw new Error('Google Sheet did not answer. Check the Web app URL and that it is deployed for "Anyone".'); }
    if (j.error) throw new Error(j.error);
    return j;
  }
  async session() {
    // Browser (not Telegram) with the sheet URL baked into config.js: ask for the passcode once
    if (!window.Telegram?.WebApp?.initData && !this.pass) {
      const p = (window.prompt('Enter your Spend passcode (from the Apps Script setup log):') || '').trim();
      if (p) { this.pass = p; localStorage.setItem('spend-sheets-pass', p); }
    }
    try { const j = await this.call('ping'); this.user = { email: j.user === 'passcode' ? 'Google Sheet' : j.user }; return { user: this.user }; }
    catch (e) { console.error('Google Sheet sign-in failed:', e.message); if (/authori/i.test(e.message)) localStorage.removeItem('spend-sheets-pass'); return null; }
  }
  onAuth() {}
  async signOut() { localStorage.removeItem('spend-config'); localStorage.removeItem('spend-sheets-pass'); }
  async sendCode() { throw new Error('This app uses a Google Sheet. Tap "Use a different database" and re-enter the Web app URL and passcode.'); }
  async verify() { return this.sendCode(); }
  async load() {
    const j = await this.call('load');
    this.version = j.version; const data = { profile: j.profile, categories: j.categories, transactions: j.transactions, plans: j.plans || [] };
    this.snap = JSON.parse(JSON.stringify(data)); return data;
  }
  track(v) { if (v === this.version + 1) this.version = v; } // our own write; anything else is picked up by the poll
  async insert(t, row) { const j = await this.call('insert', { table: t, row: { ...row, id: this.id(), created_at: new Date().toISOString() } }); this.track(j.version); this.remember(t, j.row); return j.row; }
  async update(t, id, patch) { const j = await this.call('update', { table: t, id, patch }); this.track(j.version); this.remember(t, j.row); return j.row; }
  async remove(t, id) { const j = await this.call('remove', { table: t, id }); this.track(j.version); if (this.snap) this.snap[t] = this.snap[t].filter(x => x.id !== id); }
  async saveProfile(patch) { const j = await this.call('saveProfile', { patch }); this.track(j.version); if (this.snap) this.snap.profile = j.row; return j.row; }
  remember(t, row) { if (!this.snap || !row) return; const a = this.snap[t], i = a.findIndex(x => x.id === row.id); i >= 0 ? (a[i] = row) : a.unshift(row); }
  subscribe(onChange, onStatus) {
    const poll = async () => {
      if (document.hidden || this.polling) return; this.polling = true;
      try {
        const { version } = await this.call('version'); onStatus(true);
        if (version !== this.version) {
          const before = this.snap, j = await this.call('load'); this.version = j.version;
          j.plans = j.plans || [];
          for (const t of ['transactions', 'categories', 'plans']) {
            const old = new Map((before?.[t] || []).map(x => [x.id, x])), now = new Map(j[t].map(x => [x.id, x]));
            for (const [id, x] of now) if (!old.has(id)) onChange(t, { eventType: 'INSERT', new: x }); else if (JSON.stringify(old.get(id)) !== JSON.stringify(x)) onChange(t, { eventType: 'UPDATE', new: x });
            for (const id of old.keys()) if (!now.has(id)) onChange(t, { eventType: 'DELETE', old: { id } });
          }
          if (JSON.stringify(before?.profile) !== JSON.stringify(j.profile)) onChange('profiles', { eventType: 'UPDATE', new: j.profile });
          this.snap = { profile: j.profile, categories: j.categories, transactions: j.transactions, plans: j.plans };
        }
      } catch (e) { onStatus(false); console.warn('Sheet sync:', e.message); }
      this.polling = false;
    };
    clearInterval(this.timer); this.timer = setInterval(poll, 10000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
    poll();
  }
}

/* ---------------- plans: shared date logic (mirrors google-sheets/Code.gs) ---------------- */
const isoUTC = d => d.toISOString().slice(0, 10);
function occDate(p, k) {
  const [y, m, d] = String(p.start_date).split('-').map(Number);
  if (p.frequency === 'weekly') return isoUTC(new Date(Date.UTC(y, m - 1, d + 7 * k)));
  const months = (p.frequency === 'yearly' ? 12 : 1) * k;
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return isoUTC(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))));
}
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayGap = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
// Demo-mode equivalent of Code.gs autoPost(): returns the new transactions it created
function autoPostPlans(plans, tx, newId) {
  const today = localToday(), ids = new Set(tx.map(t => String(t.id))), add = [];
  for (const p of plans) {
    if (!p.auto || !(p.amount > 0)) continue;
    const n = p.kind === 'instalment' ? Number(p.total_payments) || 0 : 1200, from = p.auto_from || today, win = p.frequency === 'weekly' ? 3 : 10;
    for (let k = 0; k < n; k++) {
      const d = occDate(p, k); if (d > today) break;
      if (d < from || (p.kind === 'instalment' && k < (p.paid_before || 0))) continue;
      const id = `auto-${p.id}-${k}`; if (ids.has(id)) continue;
      if (tx.concat(add).some(t => dayGap(t.occurred_on, d) <= win && (t.plan_id === p.id || (!t.plan_id && t.category_id === p.category_id && Math.abs(t.amount - p.amount) <= 0.1)))) continue;
      add.push({ id, type: 'expense', amount: p.amount, category_id: p.category_id, occurred_on: d, plan_id: p.id, note: p.name + (p.kind === 'instalment' ? ` ${k + 1}/${n}` : ''), created_at: new Date().toISOString() });
      ids.add(id);
    }
  }
  return add;
}

window.SpendDB = { SupabaseDB, DemoDB, SheetsDB, DEFAULT_CATEGORIES, occDate };
