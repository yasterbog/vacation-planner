(function () {
  'use strict';
  const E = window.VacEngine;
  // Профили и их данные лежат в хранилище (state/<id>), в коде страницы личных цифр нет.
  const PROFILE_IDS = ['main', 'partner'];
  const DEF = { bonusPct: 0, bonusBase: 'worked', bonusMode: 'full', payGap: 3, advDay: 22, salDay: 7, bonusOverrides: {}, employers: [], extras: [] };
  const MSHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const nfd = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
  const money = (x) => nf2.format(x);
  const rub = (x) => nf0.format(Math.round(x)) + ' ₽';
  const signed = (x, f) => (x > 0.004 ? '+' : x < -0.004 ? '−' : '') + (f || rub)(Math.abs(x));
  const cls = (x) => (x > 0.004 ? 'pos' : x < -0.004 ? 'neg' : '');
  const dshort = (n) => { const [, m, d] = E.parts(n); return d + ' ' + MSHORT[m - 1]; };
  const dwd = (n) => dshort(n) + ', ' + WD[E.dow(n)];
  const dfull = (n) => { const [y, m, d] = E.parts(n); return d + ' ' + MSHORT[m - 1] + ' ' + y; };
  const mtitle = (y, m) => E.MONTHS[m - 1] + ' ' + y;
  const mcap = (y, m) => { const t = mtitle(y, m); return t[0].toUpperCase() + t.slice(1); };
  const mPrep = (m) => E.MONTHS[m - 1].replace(/ь$/, 'е').replace(/й$/, 'е').replace(/т$/, 'те');
  const daysWord = (k) => { const a = Math.abs(k) % 100, b = a % 10; return a > 10 && a < 20 ? 'дней' : b === 1 ? 'день' : b >= 2 && b <= 4 ? 'дня' : 'дней'; };
  const cap = (w) => w[0].toUpperCase() + w.slice(1);
  const today = E.parse(new Date().toISOString().slice(0, 10));

  // ---------- состояние ----------
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const data = {};
  PROFILE_IDS.forEach((id) => { data[id] = { profile: null, vacations: [], ledger: [], loaded: false }; });
  let cur = ls.get('vp-tab'); if (!PROFILE_IDS.includes(cur)) cur = 'main';
  const targets = {};
  let calAnchor = null, pickStage = 0, inClaude = null;
  const store = { kind: 'pending', refs: {} };
  const D = () => data[cur];
  const P = () => ({ ...DEF, ...(D().profile || {}) });
  const employers = () => {
    const list = (P().employers || []).map((e) => ({ re: new RegExp(e.pattern, 'i'), src: e.src, label: e.label, anyField: !!e.anyField }));
    return list.length ? list : [{ re: /заработн|зарплат/i, src: 'rtk', label: 'работодатель', anyField: true }];
  };
  const mainLabel = () => (P().employers || []).filter((e) => e.src === 'rtk').map((e) => e.label)[0] || 'работодателя';
  const vacs = () => D().vacations.map((v) => ({ ...v, start: E.parse(v.start), end: E.parse(v.end) }));
  const tkey = (id) => 'vp-target-' + id;

  function initTarget(id) {
    const t = ls.get(tkey(id)) || (id === 'main' ? ls.get('vp-target') : null);
    if (t && t.none) { targets[id] = null; return; }
    if (t && t.start && t.end) { targets[id] = { start: E.parse(t.start), end: E.parse(t.end) }; return; }
    const next = data[id].vacations.map((v) => ({ start: E.parse(v.start), end: E.parse(v.end), unpaid: v.unpaid })).filter((v) => v.start >= today && !v.unpaid).sort((a, b) => a.start - b.start)[0];
    targets[id] = next ? { start: next.start, end: next.end } : null;
  }
  const target = () => targets[cur];
  function setTarget(s, e, keepCal) {
    if (s === null) { targets[cur] = null; ls.set(tkey(cur), { none: true }); }
    else {
      if (e < s) e = s;
      if (e - s > 120) e = s + 120;
      targets[cur] = { start: s, end: e };
      ls.set(tkey(cur), { start: E.iso(s), end: E.iso(e) });
    }
    if (!keepCal) calAnchor = null;
    render();
  }

  // ---------- хранение: db артефакта (в Claude), закрытый репозиторий GitHub (на сайте), иначе браузер ----------
  const b64enc = (str) => { const u = new TextEncoder().encode(str); let bin = ''; for (let i = 0; i < u.length; i += 8192) bin += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(bin); };
  const b64dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
  const gh = {
    cfg: ls.get('vp-gh'), sha: {}, loadedAt: null,
    url(id) { return 'https://api.github.com/repos/' + this.cfg.repo + '/contents/' + id + '.json'; },
    headers() { return { Authorization: 'Bearer ' + this.cfg.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }; },
    async get(id) {
      const r = await fetch(this.url(id) + '?t=' + Date.now(), { headers: this.headers(), cache: 'no-store' });
      if (r.status === 404) { this.sha[id] = undefined; return null; }
      if (!r.ok) throw new Error(r.status === 401 ? 'токен не подходит или истёк' : r.status === 403 ? 'у токена нет доступа к репозиторию' : 'GitHub ответил ' + r.status);
      const j = await r.json(); this.sha[id] = j.sha;
      return JSON.parse(b64dec(j.content));
    },
    async put(id, body, retry) {
      const payload = { message: 'Обновление: ' + id, content: b64enc(JSON.stringify(body, null, 1)) };
      if (this.sha[id]) payload.sha = this.sha[id];
      const r = await fetch(this.url(id), { method: 'PUT', headers: this.headers(), body: JSON.stringify(payload) });
      if ((r.status === 409 || r.status === 422) && !retry) { await this.get(id); return this.put(id, body, true); }
      if (!r.ok) throw new Error('GitHub ответил ' + r.status);
      const j = await r.json(); this.sha[id] = j.content.sha;
    },
  };
  async function ghLoadAll() {
    for (const id of PROFILE_IDS) { applyLoaded(id, await gh.get(id)); }
    gh.loadedAt = new Date();
  }
  const timers = {}; let saving = Promise.resolve();
  function persist(id) {
    id = id || cur;
    clearTimeout(timers[id]);
    timers[id] = setTimeout(() => {
      timers[id] = null;
      const d = data[id];
      const body = JSON.parse(JSON.stringify({ v: 3, profile: d.profile, vacations: d.vacations, ledger: d.ledger }));
      if (store.kind === 'db') {
        saving = saving.then(() => store.refs[id].set(body)).then(() => setStore('db'), (e) => {
          ls.set('vp-state-' + id, body); setStore('local', 'Не удалось сохранить в облако (' + (e && e.code || 'ошибка') + '). Данные остались в этом браузере.');
        });
      } else if (store.kind === 'gh') {
        ls.set('vp-state-' + id, body);
        setStore('gh', 'Сохраняю в GitHub…');
        saving = saving.then(() => gh.put(id, body)).then(() => setStore('gh'), (e) => setStore('gh', 'Не удалось сохранить в GitHub: ' + e.message + '. Копия осталась в этом браузере.'));
      } else { ls.set('vp-state-' + id, body); }
    }, 400);
  }
  function setStore(kind, text) {
    if (kind !== 'pending') store.kind = kind;
    $('store').dataset.k = kind;
    $('store').dataset.k = kind === 'gh' ? 'db' : kind;
    $('storeText').textContent = text || (kind === 'db' ? 'Сохранено, доступно с любого устройства' : kind === 'gh' ? 'Синхронизируется через GitHub' : kind === 'local' ? 'Сохраняется только в этом браузере' : 'Загружаю сохранённые данные…');
  }
  function applyLoaded(id, body) {
    if (!body) return;
    const d = data[id];
    d.profile = body.profile || d.profile;
    d.vacations = Array.isArray(body.vacations) ? body.vacations.slice() : [];
    d.ledger = Array.isArray(body.ledger) ? body.ledger.slice() : [];
  }
  function loaded(id) {
    const first = !data[id].loaded;
    data[id].loaded = true;
    if (first || targets[id] === undefined) initTarget(id);
    if (id === cur) render(); else renderTabs();
  }
  async function connect() {
    let db = null;
    try { db = window.claude && window.claude.use ? await window.claude.use('db') : null; } catch (e) { db = null; }
    if (!db) {
      inClaude = false;
      PROFILE_IDS.forEach((id) => { applyLoaded(id, ls.get('vp-state-' + id) || (id === 'main' ? ls.get('vp-state') : null)); });
      if (gh.cfg && gh.cfg.repo && gh.cfg.token) {
        setStore('gh', 'Загружаю данные из GitHub…');
        try { await ghLoadAll(); setStore('gh'); store.kind = 'gh'; }
        catch (e) { setStore('local', 'Не удалось загрузить из GitHub: ' + e.message + '. Показана копия из этого браузера.'); }
      } else setStore('local');
      PROFILE_IDS.forEach(loaded); renderSync(); return;
    }
    inClaude = true; renderSync();
    PROFILE_IDS.forEach((id) => {
      store.refs[id] = db.doc('state/' + id);
      let first = true;
      store.refs[id].onSnapshot((snap) => {
        if (snap.metadata.hasPendingWrites) return;
        if (snap.exists) applyLoaded(id, snap.data());
        setStore('db');
        if (first) { first = false; loaded(id); } else if (id === cur) render(); else renderTabs();
      }, () => {
        if (first) { first = false; applyLoaded(id, ls.get('vp-state-' + id)); loaded(id); }
        setStore('local', 'Облачное хранилище недоступно, сохраняю в этом браузере');
      });
    });
  }

  // ---------- расчёт ----------
  let M = null, sc = null, rows = [], win = null;
  function windowFor(t) {
    let a = today, b = E.mk(E.parts(today)[0] + 1, 12, 31);
    if (t) {
      const [sy, sm] = E.parts(t.start), [ey, em] = E.parts(t.end);
      if (t.start < today) { const [py, pm] = E.addMonths(sy, sm, -1); a = E.mk(py, pm, 1); }
      const [ny, nm] = E.addMonths(ey, em, 1);
      b = Math.max(b, E.mk(ny, nm, E.dim(ny, nm)));
    }
    return { a, b };
  }
  function model(t) {
    const saved = vacs();
    const lastEnd = Math.max(t ? t.end : 0, today, win.b, ...saved.map((v) => v.end));
    const horizon = E.mk(E.parts(lastEnd)[0] + 1, 2, 28);
    const R = E.reconcile(P(), saved, D().ledger, horizon);
    return { R, X: { extras: R.extras, k: R.k, pao: R.pao }, saved: R.vac, horizon };
  }
  function render() {
    renderTabs();
    const has = !!D().profile;
    $('app').hidden = !has; $('noProfile').hidden = has;
    if (!has) { $('noProfile').textContent = inClaude === false && store.kind !== 'gh' ? 'Подключите синхронизацию выше, чтобы загрузить ваши данные.' : D().loaded ? 'Для этого профиля пока нет данных.' : 'Загружаю профиль…'; return; }
    const t = target();
    win = windowFor(t);
    try {
      M = model(t);
      if (t) {
        const same = M.saved.find((v) => v.start === t.start && v.end === t.end);
        sc = E.scenario(P(), M.saved, same || t, M.X, win);
        rows = sc.rows;
      } else {
        sc = null;
        rows = E.simulate(P(), M.saved, M.horizon, M.X).pays.filter((p) => p.date >= win.a && p.date <= win.b);
      }
    } catch (err) { $('tiles').innerHTML = '<div class="note"><b>Ошибка расчёта:</b> ' + esc(err.message) + '</div>'; return; }
    $('inStart').value = t ? E.iso(t.start) : ''; $('inEnd').value = t ? E.iso(t.end) : '';
    ['btnPlan', 'btnTaken', 'btnReset'].forEach((id) => { $(id).disabled = !t; });
    document.querySelectorAll('[data-len]').forEach((b) => { b.disabled = !t; });
    $('detAlt').hidden = !t || !!(sc && sc.tv.unpaid); $('detCalc').hidden = !t || !!(sc && sc.tv.unpaid);
    renderFacts(); renderCal(); renderNotes(); renderTiles(); renderSchedule(); if (t && !sc.tv.unpaid) { renderAlts(); renderCalc(); }
    renderSaved(); renderRecon(); renderRules();
  }
  const usedBefore = (t) => vacs().filter((v) => !v.unpaid && v.start < t.start && !(v.start <= t.end && t.start <= v.end)).reduce((s, v) => s + E.chargedDays(v.start, v.end), 0);

  function renderTabs() {
    $('tabs').innerHTML = PROFILE_IDS.map((id) => {
      const name = (data[id].profile && data[id].profile.name) || (id === 'main' ? 'Профиль 1' : 'Профиль 2');
      return '<button role="tab" data-tab="' + id + '" aria-selected="' + (id === cur) + '">' + esc(name) + '</button>';
    }).join('');
  }

  function renderFacts() {
    const t = target();
    if (!t) { $('facts').innerHTML = '<span class="muted">Даты не выбраны. Ниже график всех выплат до конца следующего года без нового отпуска.</span>'; return; }
    const tv = sc.tv;
    const cal = t.end - t.start + 1, wm = E.workdays(t.start, t.end), [rs, re] = E.restBlock(t.start, t.end);
    if (tv.unpaid) { $('facts').innerHTML = '<span>Отпуск за свой счёт: <b>' + cal + '</b> ' + daysWord(cal) + ', рабочих дней без оплаты: <b>' + wm + '</b></span>'; return; }
    const hol = tv.holidays.length ? 'праздники внутри: ' + tv.holidays.map(dshort).join(', ') + ' (не входят в отпуск, он продлевается)' : 'праздников внутри нет';
    $('facts').innerHTML =
      '<span>Отпуск: <b>' + tv.charged + '</b> ' + daysWord(tv.charged) + (cal !== tv.charged ? ' из ' + cal + ' календарных' : '') + '</span>' +
      '<span>Пропускаете рабочих дней: <b>' + wm + '</b></span>' +
      '<span>Отдых подряд: <b>' + (re - rs + 1) + '</b> ' + daysWord(re - rs + 1) + ' (' + dshort(rs) + ' – ' + dshort(re) + ')</span>' +
      '<span class="muted">' + hol + '</span>';
  }

  function renderCal() {
    const t = target();
    if (!calAnchor) { const [y, m] = E.parts(t ? t.start : today); calAnchor = [y, m]; }
    const months = [calAnchor, E.addMonths(calAnchor[0], calAnchor[1], 1)];
    const saved = vacs();
    const pays = rows.filter((p) => p.gross > 0 && p.kind !== 'pao' && !p.ghost);
    const payDays = new Set(pays.map((p) => p.date));
    $('cals').innerHTML = months.map(([y, m]) => {
      const first = E.mk(y, m, 1), lead = (E.dow(first) + 6) % 7, n = E.dim(y, m), last = E.mk(y, m, n);
      const wdCount = E.workdays(first, last);
      let h = '<div class="cal"><h3>' + mcap(y, m) + '<span>' + wdCount + ' раб. · ' + (n - wdCount) + ' вых. и празд.</span></h3><div class="grid">' +
        ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((w, i) => '<span class="wd' + (i > 4 ? ' we' : '') + '">' + w + '</span>').join('');
      for (let i = 0; i < lead; i++) h += '<span class="d empty"></span>';
      for (let d = 1; d <= n; d++) {
        const k = E.mk(y, m, d), c = ['d'];
        const hol = E.isH112(k), off = E.isOff(k), ww = E.isWorkWeekend(k);
        if (hol) c.push('hol'); else if (off) c.push('off');
        if (ww) c.push('ww');
        if (t && k >= t.start && k <= t.end) c.push('v');
        else { const sv = saved.find((v) => k >= v.start && k <= v.end); if (sv) c.push(sv.status === 'taken' ? 'taken' : 'plan'); }
        if (payDays.has(k)) c.push('pay');
        const tip = dwd(k) + (hol ? ', праздник' : ww ? ', рабочий день по переносу' : off ? ', выходной' : ', рабочий день') +
          (payDays.has(k) ? '. Выплата: ' + pays.filter((p) => p.date === k).map((p) => p.label).join('; ') : '');
        h += '<button class="' + c.join(' ') + '" data-day="' + k + '" title="' + esc(tip) + '" aria-label="' + esc(tip) + '">' + d + '</button>';
      }
      return h + '</div></div>';
    }).join('');
    $('calHint').textContent = pickStage === 1 ? 'Теперь нажмите на последний день отпуска.' : 'Нажмите на день начала, затем на день окончания.';
  }

  function renderNotes() {
    const out = [], t = target();
    const years = new Set(rows.map((r) => E.parts(r.date)[0]));
    if (t) { years.add(E.parts(t.start)[0]); years.add(E.parts(t.end)[0]); sc.tv.rows.forEach((r) => years.add(r.y)); }
    [...years].sort().forEach((y) => {
      const st = E.calStatus(y);
      if (st === 'draft') out.push('<b>Календарь ' + y + ':</b> по проекту постановления о переносе выходных (Минтруд, август 2026). Если итоговое постановление изменит переносы, даты выплат и число рабочих дней сдвинутся.');
      if (st === 'auto') out.push('<b>Календарь ' + y + ' ещё не опубликован.</b> Праздники по ст. 112 ТК учтены, переносы январских выходных неизвестны. Расчёт предварительный.');
    });
    if (t) {
      if (vacs().some((v) => v.start <= t.end && t.start <= v.end && !(v.start === t.start && v.end === t.end))) out.push('<b>Пересечение:</b> выбранные даты накладываются на сохранённый отпуск. В расчёте сохранённый заменён выбранным.');
      if (!sc.tv.unpaid) {
        const ent = E.entitlement(P().empStart, t.start), used = usedBefore(t);
        if (sc.tv.charged > ent - used + 0.001) out.push('<b>Дней больше, чем накоплено:</b> к началу отпуска накопится около ' + nfd.format(Math.max(0, ent - used)) + ' дн. Остальное можно взять только авансом, по согласованию с работодателем.');
        if (sc.tv.fallback) out.push('<b>Нет отработанных дней в расчётном периоде:</b> средний заработок взят из оклада (оклад ÷ 29,3).');
        if (!sc.tv.actual && E.isWorkWeekend(sc.tv.payDay)) out.push('<b>Отпускные:</b> крайний срок ' + dwd(sc.tv.payDay) + ' — рабочая суббота по переносу. Скорее всего, заплатят в пятницу, ' + dwd(E.prevWorkday(sc.tv.payDay - 1)) + '.');
      }
    }
    $('notes').innerHTML = out.map((x) => '<div class="note">' + x + '</div>').join('');
  }

  function renderTiles() {
    const t = target();
    if (!t) { $('tiles').innerHTML = ''; return; }
    const tv = sc.tv, d = sc.delta;
    const big = (x) => { const s = money(x).split(','); return s[0] + '<small>,' + s[1] + ' ₽</small>'; };
    if (tv.unpaid) {
      $('tiles').innerHTML = '<div class="tile hero"><span class="lbl">Отпуск за свой счёт</span><span class="big num neg">' + signed(d.net) + '</span><span class="small muted">столько меньше придёт на руки по сравнению с работой в эти дни</span></div>';
      return;
    }
    const vp = sc.withV.pays.find((p) => p.kind === 'vac' && p.ref === E.iso(t.start));
    const ent = E.entitlement(P().empStart, t.start), used = usedBefore(t);
    const left = ent - used - tv.charged;
    const calc = tv.rows.length ? mtitle(tv.rows[0].y, tv.rows[0].m) + ' – ' + mtitle(tv.rows[tv.rows.length - 1].y, tv.rows[tv.rows.length - 1].m) : '—';
    const kTxt = tv.actual ? 'сумма из выписки или листка' : (Math.abs(tv.k - 1) > 0.0005 ? 'с поправкой ×' + tv.k.toFixed(4).replace('.', ',') + ' по факту' : 'по модели');
    let second;
    if (P().bonusPct > 0) {
      const bl = E.bonusLoss(sc);
      const blTxt = bl.qs.length ? bl.qs.map((x) => '<span class="small muted">' + x.q + ' кв. ' + x.y + ': ' + rub(x.with) + ' вместо ' + rub(x.without) + ' до НДФЛ; в отпуске ' + (x.factWithout - x.fact) + ' из ' + x.norm + ' рабочих дней</span>' +
        '<span class="small">придёт ' + dwd(x.payDay) + ', на руки ' + signed(x.net) + '</span>').join('')
        : '<span class="small muted">' + (E.workdays(t.start, t.end) === 0 ? 'в отпуск не попало ни одного рабочего дня' : 'премия за этот квартал не начисляется') + '</span>';
      second = '<div class="tile"><span class="lbl">Потеря премии</span><span class="big num ' + cls(bl.net) + '">' + (Math.abs(bl.net) < 0.5 ? '0 ₽' : signed(bl.net)) + '</span>' + blTxt + '</div>';
    } else {
      second = '<div class="tile"><span class="lbl">Средний дневной заработок</span><span class="big num">' + big(tv.avg) + '</span><span class="small muted">' + kTxt + '</span><span class="small muted">расчётный период: ' + calc + '</span></div>';
    }
    $('tiles').innerHTML =
      '<div class="tile hero"><span class="lbl">Отпускные на руки</span><span class="big num">' + big(vp.net) + '</span>' +
      '<span class="small muted">начислено ' + money(vp.gross) + ' · НДФЛ ' + nf0.format(vp.ndfl) + ' (' + Math.round(vp.rate * 100) + '%)</span>' +
      (P().bonusPct > 0 ? '<span class="small muted">' + money(tv.avg) + ' в день × ' + tv.charged + ' ' + daysWord(tv.charged) + '; ' + kTxt + '</span>' : '') +
      '<span class="small">' + (tv.actual ? 'выплачено <b>' : 'выплата не позднее <b>') + dwd(vp.date) + '</b></span></div>' + second +
      '<div class="tile"><span class="lbl">Итог против работы</span><span class="big num ' + cls(d.net) + '">' + signed(d.net) + '</span>' +
      '<span class="small muted">на руки, с учётом НДФЛ до конца года. Начислено: отпускные +' + rub(d.vacPay) + ', зарплата ' + signed(d.salary) +
      (Math.abs(d.bonus) > 0.5 ? ', премия ' + signed(d.bonus) : '') + (Math.abs(d.otherVac) > 0.5 ? ', другие отпуска ' + signed(d.otherVac) : '') + '</span></div>' +
      '<div class="tile"><span class="lbl">Дни отпуска</span><span class="big num">' + nfd.format(Math.max(0, ent - used)) + '<small> дн.</small></span>' +
      '<span class="small muted">накопится к ' + dshort(t.start) + ' (28 дн. в год, использовано ' + used + ')</span>' +
      '<span class="small">после отпуска останется <b>' + nfd.format(left) + '</b></span></div>';
  }

  function renderSchedule() {
    const [y1, m1] = E.parts(win.a), [y2, m2] = E.parts(win.b);
    $('schedSub').textContent = 'С ' + dfull(win.a) + ' по ' + dfull(win.b) + '. Суммы на руки, после НДФЛ. Аванс и зарплата за один месяц выделены общим блоком.';
    const byDate = new Map();
    const pl = (P().employers || []).filter((e) => e.src === 'pao').map((e) => e.label)[0] || 'совместительство';
    rows.filter((r) => !r.ghost && r.net > 0.004).forEach((r) => {
      const g = byDate.get(r.date) || { date: r.date, items: [], net: 0, vac: false, adv: null, sal: null };
      const what = r.kind === 'pao' ? pl : r.kind === 'vac' ? 'отпускные' : r.label;
      if (!g.items.includes(what)) g.items.push(what);
      g.net += r.net; g.vac = g.vac || r.kind === 'vac';
      if (r.kind === 'adv') g.adv = r.ref; if (r.kind === 'sal') g.sal = r.ref;
      byDate.set(r.date, g);
    });
    const list = [...byDate.values()].sort((x, y) => x.date - y.date);
    let open = null;
    list.forEach((g) => {
      if (g.adv) open = g.adv;
      if (g.sal && open !== g.sal) open = g.sal;
      g.blk = open;
      if (g.sal && g.sal === open) open = null;
    });
    const t = target(), refY = t ? E.parts(t.start)[0] : E.parts(today)[0];
    let h = '<thead><tr><th>Месяц</th><th>Когда</th><th>За что</th><th class="n">На руки</th></tr></thead><tbody>';
    let band = 0;
    for (let i = 0; i < list.length;) {
      let j = i; while (j < list.length && list[j].blk === list[i].blk) j++;
      const k = list[i].blk, isBand = k !== null;
      if (isBand) band++;
      const [by, bm] = k ? k.split('-').map(Number) : [0, 0];
      for (let r = i; r < j; r++) {
        const g = list[r], w = g.items.join(' + ');
        const c = [r === i ? 'blk-start' : '', isBand && band % 2 ? 'band' : '', g.vac ? 'vac' : ''].filter(Boolean).join(' ');
        h += '<tr class="' + c + '">' + (r === i ? '<td class="mcol" rowspan="' + (j - i) + '">' + (k ? E.MONTHS[bm - 1] + (by !== refY ? ' ' + by : '') : '') + '</td>' : '') +
          '<td class="num" style="white-space:nowrap">' + dwd(g.date) + '</td><td>' + esc(cap(w)) + '</td><td class="n"><b>' + money(g.net) + ' ₽</b></td></tr>';
      }
      i = j;
    }
    $('sched').innerHTML = list.length ? h + '</tbody>' : '<tbody><tr><td class="muted">В этом периоде выплат нет.</td></tr></tbody>';
  }

  let altCache = { key: '', list: [] };
  function renderAlts() {
    const t = target();
    const key = JSON.stringify([cur, D().vacations, D().ledger, D().profile, t.start, t.end]);
    if (altCache.key !== key) altCache = { key, list: E.alternatives(P(), M.saved, t, 14, M.X) };
    const list = altCache.list.slice().sort((a, b) => b.net - a.net);
    const curA = list.find((a) => a.off === 0);
    const show = list.slice(0, 7); if (!show.includes(curA)) show.push(curA);
    const withBonus = P().bonusPct > 0;
    $('alts').innerHTML = '<thead><tr><th>Даты</th><th class="n">Рабочих дней пропуска</th><th class="n">Отдых подряд</th><th class="n">Отпускные на руки</th>' + (withBonus ? '<th class="n">Потеря премии</th>' : '') + '<th class="n">Итог против работы</th><th></th></tr></thead><tbody>' +
      show.map((a) => '<tr class="' + (a.off === 0 ? 'cur' : '') + '"><td style="white-space:nowrap">' + E.fmtRange(a.start, a.end) + '<span class="sub">' + (a.off === 0 ? 'выбранные даты' : (a.off > 0 ? 'на ' + a.off + ' дн. позже' : 'на ' + -a.off + ' дн. раньше')) +
        '</span></td><td class="n">' + a.workMissed + '</td><td class="n">' + a.rest + ' дн.<span class="sub">' + dshort(a.restStart) + ' – ' + dshort(a.restEnd) + '</span></td><td class="n">' + money(a.vacNet) + '</td>' +
        (withBonus ? '<td class="n ' + cls(a.bonusLoss) + '">' + (Math.abs(a.bonusLoss) < 0.5 ? '0 ₽' : signed(a.bonusLoss)) + '</td>' : '') +
        '<td class="n ' + cls(a.net) + '">' + signed(a.net) + '</td><td>' + (a.off === 0 ? '' : '<button class="chip" data-alt="' + a.start + ',' + a.end + '">Выбрать</button>') + '</td></tr>').join('') + '</tbody>';
  }

  function renderCalc() {
    const tv = sc.tv;
    let h = '<p class="small" style="margin-bottom:10px;max-width:78ch">Расчётный период — 12 месяцев до месяца начала отпуска, но не раньше месяца приёма. Полный месяц = 29,3 дня; неполный = 29,3 ÷ дней в месяце × отработанные календарные дни (отпуска, дни за свой счёт и дни до приёма исключаются вместе с оплатой за них).</p>';
    h += '<div class="tw"><table><thead><tr><th>Месяц</th><th class="n">Кал. дней в расчёт</th><th class="n">Дней по 29,3</th><th class="n">Заработок</th></tr></thead><tbody>';
    tv.rows.forEach((r) => {
      h += '<tr><td>' + mcap(r.y, r.m) + '</td><td class="n">' + r.worked + ' из ' + r.cd + '</td><td class="n">' + r.days.toFixed(4).replace('.', ',') + '</td><td class="n">' + money(r.salary + r.adj) + (r.adj ? '<span class="sub">в т. ч. разовые выплаты ' + money(r.adj) + '</span>' : '') + '</td></tr>';
    });
    tv.bonusRows.forEach((b) => {
      const [y, q] = b.key.split('Q'), [ay, am] = b.accrual.split('-').map(Number);
      h += '<tr><td>Премия за ' + q + ' кв. ' + y + '<span class="sub">начислена в ' + mPrep(am) + ' ' + ay + '</span></td><td></td><td></td><td class="n">' + money(b.counted) + '</td></tr>';
    });
    h += '<tr class="total"><td>Итого</td><td></td><td class="n">' + tv.days.toFixed(4).replace('.', ',') + '</td><td class="n">' + money(tv.earn + tv.bonusSum) + '</td></tr></tbody></table></div>';
    h += '<p class="num" style="margin-top:12px">' + money(tv.earn + tv.bonusSum) + ' ÷ ' + tv.days.toFixed(4).replace('.', ',') + ' = <b>' + money(tv.modelAvg) + '</b> в день по модели</p>';
    if (tv.actual) h += '<p class="num" style="margin-top:4px">Факт: ' + money(tv.pay) + ' ÷ ' + tv.charged + ' = <b>' + money(tv.avg) + '</b> в день</p>';
    else if (Math.abs(tv.k - 1) > 0.0005) h += '<p class="num" style="margin-top:4px">' + money(tv.modelAvg) + ' × ' + tv.k.toFixed(4).replace('.', ',') + ' = <b>' + money(tv.avg) + '</b> × ' + tv.charged + ' дн. = <b>' + money(tv.pay) + '</b></p>';
    else h += '<p class="num" style="margin-top:4px">× ' + tv.charged + ' дн. = <b>' + money(tv.pay) + '</b></p>';
    const c = M.R.calib;
    if (c && !tv.actual) h += '<p class="small muted" style="margin-top:8px;max-width:78ch">Поправка ' + tv.k.toFixed(4).replace('.', ',') + ': за отпуск ' + E.fmtRange(c.start, c.end) + ' бухгалтерия начислила ' + money(c.implied) + ' в день, а модель даёт ' + money(c.modelAvg) +
      '. Разница переносится на будущие отпускные пропорционально. Каждый новый отпуск с известной суммой уточняет поправку.</p>';
    if (P().bonusPct > 0) h += '<p class="small muted" style="margin-top:6px">Премии, начисленные внутри расчётного периода, учтены полностью: премия уже считается от отработанного времени (п. 15 Положения № 922).</p>';
    $('calc').innerHTML = h;
  }

  function renderSaved() {
    const list = M.saved.map((v, i) => ({ ...v, i })).sort((a, b) => a.start - b.start);
    if (!list.length) { $('saved').innerHTML = '<p class="empty-state">Пока пусто. Выберите даты выше и нажмите «Отметить как состоявшийся» для прошедших отпусков или «Сохранить как план» для будущих.</p>'; return; }
    const sim = E.simulate(P(), list, M.horizon, M.X);
    const t = target();
    $('saved').innerHTML = list.map((v) => {
      const p = sim.pays.find((x) => x.kind === 'vac' && x.ref === E.iso(v.start));
      const active = t && v.start === t.start && v.end === t.end;
      const ch = v.unpaid ? v.end - v.start + 1 : E.chargedDays(v.start, v.end);
      let line = '';
      if (v.unpaid) line = '<span class="muted">Без сохранения зарплаты: дни не оплачиваются и исключаются из расчёта отпускных.</span>';
      else if (v.factSource === 'ledger') line = '<span>Получено <b class="num">' + money(v.factNet) + '</b> на руки ' + dwd(v.factDate) + ' <span class="tag ok">из выписки</span></span><span class="muted">модель без поправки: ' + money(v.modelNet) + ' (' + signed(v.factNet - v.modelNet, money) + ')</span>';
      else if (v.factSource === 'manual') line = '<span>Получено <b class="num">' + money(v.factNet) + '</b> на руки <span class="tag ok">' + esc(v.factNote || 'введено вручную') + '</span></span><span class="muted">модель без поправки: ' + money(v.modelNet) + ' (' + signed(v.factNet - v.modelNet, money) + ')</span>';
      else if (v.status === 'taken') line = '<span>Суммы нет в выписке. ' + (p ? 'По модели ' + money(p.net) + ' на руки.' : '') + '</span><label class="f" style="grid-auto-flow:column;align-items:center;gap:8px">Получено на руки, ₽<input type="number" step="0.01" min="0" style="width:140px" id="act-' + esc(v.id) + '" data-act="' + v.i + '" value=""></label>';
      else if (p) line = '<span>По прогнозу <b class="num">' + money(p.net) + '</b> на руки, выплата ' + dwd(p.date) + '</span>';
      const pill = v.unpaid ? '<span class="pill">за свой счёт</span>' : '';
      return '<div class="sv' + (active ? ' active' : '') + '"><div class="top"><div><b>' + E.fmtRange(v.start, v.end) + ' ' + E.parts(v.end)[0] + '</b> <span class="muted small">· ' + ch + ' ' + daysWord(ch) + '</span></div>' +
        '<span class="row" style="gap:6px">' + pill + '<span class="pill ' + v.status + '">' + (v.status === 'taken' ? 'состоялся' : 'запланирован') + '</span></span></div>' +
        '<div class="row small" style="align-items:center;gap:6px 14px">' + line + '</div>' +
        '<div class="row" style="gap:8px">' + (active ? '' : '<button class="chip" data-open="' + v.i + '">Открыть в расчёте</button>') +
        '<button class="chip" data-toggle="' + v.i + '">' + (v.status === 'taken' ? 'Вернуть в планы' : 'Отметить как состоявшийся') + '</button>' +
        '<button class="chip" data-unpaid="' + v.i + '">' + (v.unpaid ? 'Сделать оплачиваемым' : 'Сделать за свой счёт') + '</button>' +
        '<button class="chip danger" data-del="' + v.i + '">Удалить</button></div></div>';
    }).join('');
  }

  function renderRecon() {
    const R = M.R, L = R.ledger, PL = R.paoLedger, ml = mainLabel();
    if (!L.length && !PL.length) {
      $('reconSum').textContent = 'Выписка не загружена. Загрузите CSV из банка: калькулятор найдёт зарплатные поступления и сверит их с моделью.';
      $('recon').innerHTML = ''; return;
    }
    const matched = L.filter((l) => l.match), groups = new Set(matched.map((l) => l.match)), exact = [...groups].filter((m) => Math.abs(matched.filter((l) => l.match === m).reduce((s, l) => s + l.net, 0) - m.net) < 0.005);
    const vacL = L.filter((l) => l.vac), extra = L.filter((l) => l.extra);
    const parts = L.length ? [L.length + ' поступлений от ' + ml + ' с ' + dshort(L[0].day) + ' по ' + dfull(L[L.length - 1].day) + '.',
      'Авансы, зарплата и премии: ' + groups.size + ', из них ' + exact.length + ' совпали с моделью до копейки' + (groups.size > exact.length ? ', остальные в пределах 0,5%' : '') + '.'] : [];
    if (vacL.length) parts.push('Отпускные: ' + vacL.map((l) => money(l.net) + ' против ' + money(l.vac.modelNet) + ' по модели (' + signed((l.net / l.vac.modelNet - 1) * 100, (x) => x.toFixed(1).replace('.', ',') + '%') + ')').join('; ') + '. Разницу калькулятор учитывает поправкой для будущих отпускных.');
    if (extra.length) parts.push((P().extraLabel || 'Выплаты вне графика') + ': ' + extra.map((l) => money(l.net)).join(' и ') + ' на руки (' + R.extras.map((e) => rub(e.gross)).join(' и ') + ' до НДФЛ). ' + (P().extraInAvg ? 'Учтены в среднем заработке.' : 'Облагаются НДФЛ и приближают порог 2,4 млн ₽, но в средний заработок для отпускных не входят.'));
    if (PL.length) {
      const yr = E.parts(today)[0], rg = {}, pg = {};
      E.simulate(P(), M.saved, M.horizon, M.X).pays.forEach((p) => { const y = E.parts(p.date)[0]; if (p.emp === 'pao') pg[y] = (pg[y] || 0) + p.gross; else rg[y] = (rg[y] || 0) + p.gross; });
      const extraTax = Math.round(E.taxCum((rg[yr] || 0) + (pg[yr] || 0)) - E.taxCum(rg[yr] || 0) - E.taxCum(pg[yr] || 0));
      const pl = (P().employers || []).filter((e) => e.src === 'pao').map((e) => e.label)[0] || 'Совместительство';
      parts.push(pl + ' (совместительство): ' + PL.length + ' выплат, ' + money(PL.reduce((s, l) => s + l.net, 0)) + ' ₽ на руки; дальше в графике по последним суммам. На отпускные основного работодателя не влияет.' +
        (extraTax > 0 ? ' Каждый работодатель удерживает НДФЛ отдельно, поэтому за ' + yr + ' год налоговая доначислит около ' + extraTax + ' ₽, уведомление придёт в ' + (yr + 1) + '.' : ''));
    }
    if (R.missing.length) parts.push('Нет в выписке: ' + R.missing.map((p) => p.label + ' (' + dshort(p.date) + ')').join('; ') + '.');
    $('reconSum').textContent = parts.join(' ');
    const pl = (P().employers || []).filter((e) => e.src === 'pao').map((e) => e.label)[0] || 'Совместительство';
    let h = '<thead><tr><th>Дата</th><th>Что</th><th class="n">Пришло</th><th class="n">По модели</th><th class="n">Разница</th></tr></thead><tbody>';
    const seen = new Set();
    const rowsR = [];
    L.forEach((l) => {
      if (l.match && l.part) { if (seen.has(l.match)) return; seen.add(l.match); const parts2 = L.filter((x) => x.match === l.match); rowsR.push({ day: l.day, label: l.match.label + ' (' + parts2.length + ' перевода)', fact: parts2.reduce((s, x) => s + x.net, 0), model: l.match.net }); return; }
      rowsR.push({ day: l.day, label: l.match ? l.match.label : l.vac ? 'Отпускные ' + E.fmtRange(l.vac.start, l.vac.end) : (P().extraLabel || 'Выплата вне графика'), fact: l.net, model: l.match ? l.match.net : l.vac ? l.vac.modelNet : null, tag: l.extra ? (P().extraInAvg ? 'вне графика' : 'не в среднем') : '' });
    });
    PL.forEach((l) => rowsR.push({ day: l.day, label: pl + ': ' + (l.t === 'adv' ? 'аванс' : 'зарплата'), fact: l.net, model: null, tag: 'совместительство', pao: true }));
    R.missing.forEach((p) => rowsR.push({ day: p.date, label: p.label, fact: null, model: p.net, tag: 'нет в выписке' }));
    rowsR.sort((a, b) => a.day - b.day).forEach((r) => {
      const diff = r.fact !== null && r.model !== null ? r.fact - r.model : null;
      h += '<tr' + (r.pao ? ' class="pao"' : '') + '><td class="num" style="white-space:nowrap">' + dwd(r.day) + '</td><td>' + esc(r.label) + (r.tag ? '<span class="tag' + (r.pao ? '' : ' warn') + '">' + r.tag + '</span>' : '') + '</td><td class="n">' + (r.fact !== null ? money(r.fact) : '—') + '</td><td class="n muted">' + (r.model !== null ? money(r.model) : '—') +
        '</td><td class="n ' + (diff !== null && Math.abs(diff) >= 0.005 ? cls(diff) : '') + '">' + (diff === null ? '' : Math.abs(diff) < 0.005 ? '<span class="pos">✓</span>' : signed(diff, money)) + '</td></tr>';
    });
    $('recon').innerHTML = h + '</tbody>';
  }

  function renderRules() {
    const p = P(), list = [];
    list.push('Профиль: оклад ' + rub(p.salary) + ' в месяц до НДФЛ, работа с ' + dfull(E.parse(p.empStart)) + '. Аванс за 1–15 число — ' + p.advDay + '-го, остаток за 16–конец месяца — ' + p.salDay + '-го следующего месяца. ' + (p.bonusPct > 0 ? 'Квартальная премия ' + p.bonusPct + '%.' : 'Регулярных премий нет.') + ' Если что-то изменится, попросите Claude обновить профиль.');
    list.push('Зарплата за месяц: оклад ÷ рабочих дней месяца × отработанные рабочие дни. Выплата на выходном или празднике переносится на предыдущий рабочий день.');
    if (p.bonusPct > 0) list.push('Квартальная премия = ' + p.bonusPct + '% × оклад × 3 × отработанные рабочие дни квартала ÷ норма рабочих дней × КПЭ (положение работодателя о материальном стимулировании). Отпускные в базу не входят, дни отпуска её уменьшают. КПЭ принят равным 1. Премия платится в последний день месяца после квартала, за IV квартал — в январе. Принятым позже 15-го числа второго месяца квартала премия за этот квартал не положена.');
    list.push('Отпускные = средний дневной заработок × дни отпуска. Средний дневной = заработок за расчётный период ÷ (29,3 × полные месяцы + дни неполных месяцев). Постановление Правительства № 922, ст. 139 ТК РФ. Если известна фактическая сумма хотя бы одного отпуска, расхождение с моделью переносится на будущие отпускные как поправочный коэффициент.');
    if (p.extraLabel) list.push('Поступления от ' + mainLabel() + ' вне графика зарплаты считаются так: ' + p.extraLabel.toLowerCase() + '. ' + (p.extraInAvg ? 'Они входят в средний заработок.' : 'Облагаются НДФЛ и входят в годовую базу, но в средний заработок не входят: это выплата социального характера (п. 3 Положения № 922).'));
    if ((p.extras || []).length) list.push('Разовые выплаты из расчётных листков: ' + p.extras.map((e) => e.label + ' ' + rub(e.gross) + ' (' + e.accrual + ')').join(', ') + '. Учтены в графике и в среднем заработке.');
    if ((p.employers || []).some((e) => e.src === 'pao')) list.push('Совместительство: выплаты показаны в графике (будущие — по последним суммам). НДФЛ каждый работодатель удерживает отдельно и порог 2,4 млн ₽ считает только по своим выплатам; разницу за общий доход налоговая доначисляет по уведомлению в следующем году. Отпускные по совместительству — единицы рублей, в расчёте не учитываются.');
    list.push('Нерабочие праздники по ст. 112 ТК (1–8 января, 23 февраля, 8 марта, 1 и 9 мая, 12 июня, 4 ноября) в дни отпуска не входят (ст. 120 ТК), отпуск на них продлевается. Перенесённые выходные в отпуск входят. Дни за свой счёт не оплачиваются и исключаются из расчётного периода.');
    list.push('Отпускные выплачиваются не позднее чем за 3 дня до начала (ст. 136 ТК): между выплатой и первым днём отпуска три полных дня. Если срок выпадает на выходной, выплата раньше.');
    list.push('НДФЛ удерживается с каждой выплаты, включая аванс: 13% до 2,4 млн ₽ дохода за год, 15% до 5 млн. База обнуляется 1 января и считается по дате выплаты. Законопроект, внесённый 30.09.2026, сохраняет эти пороги для зарплаты, но ещё не принят.');
    list.push('Производственный календарь 2025 и 2026 — утверждённые. 2027 — по проекту постановления (20 февраля 2027 — рабочая суббота, 22 февраля — выходной). Для 2028 и позже переносы январских выходных неизвестны.');
    list.push('Не учитываются больничные и вычеты по НДФЛ.');
    $('rules').innerHTML = list.map((x) => '<li>' + esc(x) + '</li>').join('');
  }


  // ---------- панель синхронизации (только вне Claude) ----------
  function renderSync() {
    const el = $('syncPanel');
    if (inClaude !== false) { el.hidden = true; return; }
    el.hidden = false;
    const on = store.kind === 'gh';
    const host = location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : '';
    // без подключения панель стоит наверху, после подключения — внизу страницы
    const anchor = on ? $('detRules') : $('noProfile');
    if (on) anchor.after(el); else anchor.before(el);
    el.innerHTML = '<h2>Синхронизация</h2>' + (on
      ? '<p class="small">Данные в закрытом репозитории GitHub <b>' + esc(gh.cfg.repo) + '</b>. Загружены в ' + (gh.loadedAt ? gh.loadedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—') + '.</p>' +
        '<div class="row"><button id="ghReload">Загрузить заново</button><button class="danger" id="ghOff">Отключить на этом устройстве</button></div>'
      : '<p class="small" style="max-width:70ch">Расчёты и отпуска хранятся в вашем закрытом репозитории на GitHub. Подключите его один раз на каждом устройстве: укажите репозиторий и вставьте токен доступа.</p>' +
        '<div class="row"><label class="f">Репозиторий<input id="ghRepo" value="' + esc((gh.cfg && gh.cfg.repo) || (host ? host + '/vacation-planner-data' : '')) + '" placeholder="владелец/репозиторий" style="min-width:240px"></label>' +
        '<label class="f">Токен доступа<input id="ghToken" type="password" autocomplete="off" placeholder="github_pat_…" style="min-width:240px"></label>' +
        '<button class="primary" id="ghConnect">Подключить</button></div>') +
      '<p class="small muted" id="ghMsg" role="status"></p>';
  }
  $('syncPanel').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'ghConnect') {
      const repo = $('ghRepo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, ''), token = $('ghToken').value.trim();
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) { $('ghMsg').textContent = 'Укажите репозиторий в виде «владелец/название» и вставьте токен.'; return; }
      gh.cfg = { repo, token }; $('ghMsg').textContent = 'Проверяю доступ…';
      try { await ghLoadAll(); ls.set('vp-gh', gh.cfg); store.kind = 'gh'; setStore('gh'); PROFILE_IDS.forEach((id) => { data[id].loaded = false; loaded(id); }); renderSync(); }
      catch (err) { gh.cfg = null; $('ghMsg').textContent = 'Не получилось подключиться: ' + err.message + '.'; }
    } else if (b.id === 'ghReload') { await refreshGh(true); }
    else if (b.id === 'ghOff') {
      if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = 'Точно отключить?'; return; }
      try { localStorage.removeItem('vp-gh'); } catch (err) {}
      gh.cfg = null; store.kind = 'local'; setStore('local'); renderSync();
    }
  });
  async function refreshGh(force) {
    if (store.kind !== 'gh' || Object.values(timers).some(Boolean) && !force) return;
    try { await ghLoadAll(); setStore('gh'); render(); renderSync(); } catch (e) { setStore('gh', 'Не удалось обновить из GitHub: ' + e.message); }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshGh(false); });

  // ---------- события ----------
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]'); if (!b || b.dataset.tab === cur) return;
    cur = b.dataset.tab; ls.set('vp-tab', cur); calAnchor = null; pickStage = 0; $('saveMsg').textContent = ''; $('csvMsg').textContent = '';
    if (targets[cur] === undefined && D().loaded) initTarget(cur);
    render();
  });
  $('inStart').addEventListener('change', (e) => {
    if (!e.target.value) return; const s = E.parse(e.target.value), t = target();
    setTarget(s, E.endForCharged(s, t ? E.chargedDays(t.start, t.end) : 14));
  });
  $('inEnd').addEventListener('change', (e) => { if (!e.target.value) return; const en = E.parse(e.target.value), t = target(); setTarget(t ? Math.min(t.start, en) : en, en); });
  document.querySelectorAll('[data-len]').forEach((b) => b.addEventListener('click', () => { const t = target(); if (t) setTarget(t.start, E.endForCharged(t.start, +b.dataset.len)); }));
  $('btnReset').addEventListener('click', () => { pickStage = 0; setTarget(null, null, true); });
  $('calPrev').addEventListener('click', () => { calAnchor = E.addMonths(calAnchor[0], calAnchor[1], -1); renderCal(); });
  $('calNext').addEventListener('click', () => { calAnchor = E.addMonths(calAnchor[0], calAnchor[1], 1); renderCal(); });
  $('cals').addEventListener('click', (e) => {
    const b = e.target.closest('[data-day]'); if (!b) return;
    const k = +b.dataset.day, t = target();
    if (pickStage === 0 || !t || k < t.start) { pickStage = 1; setTarget(k, k, true); }
    else { pickStage = 0; setTarget(t.start, k, true); }
  });
  $('alts').addEventListener('click', (e) => { const b = e.target.closest('[data-alt]'); if (!b) return; const [s, en] = b.dataset.alt.split(',').map(Number); setTarget(s, en); });

  function saveTarget(status) {
    const t = target(); if (!t) return;
    const ov = (v) => E.parse(v.start) <= t.end && t.start <= E.parse(v.end);
    const old = D().vacations.find(ov);
    const rest = D().vacations.filter((v) => !ov(v));
    rest.push({ id: old ? old.id : 'v' + Date.now().toString(36), start: E.iso(t.start), end: E.iso(t.end), status, unpaid: !!(old && old.unpaid), actualNet: (old && old.actualNet) || null, factNote: old && old.factNote || undefined });
    D().vacations = rest.sort((a, b) => a.start.localeCompare(b.start));
    $('saveMsg').textContent = (status === 'taken' ? 'Отмечен как состоявшийся: ' : 'Сохранён в планы: ') + E.fmtRange(t.start, t.end) + (old ? ' (заменил пересекающийся)' : '');
    persist(); render();
  }
  $('btnPlan').addEventListener('click', () => saveTarget('planned'));
  $('btnTaken').addEventListener('click', () => saveTarget('taken'));
  $('saved').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const v = D().vacations[+(b.dataset.open ?? b.dataset.toggle ?? b.dataset.del ?? b.dataset.unpaid)];
    if (!v) return;
    if (b.dataset.open !== undefined) { setTarget(E.parse(v.start), E.parse(v.end)); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else if (b.dataset.toggle !== undefined) { v.status = v.status === 'taken' ? 'planned' : 'taken'; persist(); render(); }
    else if (b.dataset.unpaid !== undefined) { v.unpaid = !v.unpaid; persist(); render(); }
    else if (b.dataset.del !== undefined) {
      if (b.dataset.armed) { D().vacations = D().vacations.filter((x) => x !== v); persist(); render(); }
      else { b.dataset.armed = 1; b.textContent = 'Точно удалить?'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Удалить'; } }, 4000); }
    }
  });
  $('saved').addEventListener('change', (e) => {
    const i = e.target.dataset.act; if (i === undefined) return;
    const v = D().vacations[+i]; v.actualNet = e.target.value === '' ? null : +e.target.value; persist(); render();
  });
  $('csv').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const id = cur, rd = new FileReader();
    rd.onload = () => {
      try {
        const rowsC = E.parseStatement(String(rd.result), employers());
        const key = (l) => (l.src || 'rtk') + ':' + l.date + ':' + l.net;
        const have = new Set(data[id].ledger.map(key));
        const add = rowsC.filter((r) => !have.has(key(r)));
        data[id].ledger = data[id].ledger.concat(add).sort((a, b) => a.date.localeCompare(b.date));
        $('csvMsg').textContent = rowsC.length ? 'В файле ' + rowsC.length + ' зарплатных поступлений, новых: ' + add.length + '.' : 'В файле не нашлось зарплатных поступлений.';
        if (add.length) { persist(id); render(); }
      } catch (err) { $('csvMsg').textContent = 'Не получилось прочитать файл: ' + err.message; }
      e.target.value = '';
    };
    rd.onerror = () => { $('csvMsg').textContent = 'Не получилось прочитать файл.'; };
    rd.readAsText(f, 'utf-8');
  });

  renderTabs(); render();
  connect();
})();
