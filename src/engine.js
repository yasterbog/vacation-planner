// Расчётное ядро: календарь РФ, НДФЛ, зарплата, премии, отпускные (Положение № 922).
(function (root) {
  'use strict';

  // ---------- даты: целые номера дней (UTC), без часовых поясов ----------
  const MS = 86400000;
  const mk = (y, m, d) => Date.UTC(y, m - 1, d) / MS;
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return mk(y, m, d); };
  const iso = (n) => new Date(n * MS).toISOString().slice(0, 10);
  const parts = (n) => { const t = new Date(n * MS); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]; };
  const dow = (n) => new Date(n * MS).getUTCDay();
  const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mkey = (y, m) => y + '-' + String(m).padStart(2, '0');
  const addMonths = (y, m, k) => { const t = (y * 12 + m - 1) + k; return [Math.floor(t / 12), (t % 12) + 1]; };
  const r2 = (x) => Math.round(x * 100) / 100;

  // ---------- производственный календарь ----------
  // Нерабочие праздничные дни по ст. 112 ТК РФ (в число дней отпуска не входят, ст. 120 ТК).
  const H112 = ['01-01', '01-02', '01-03', '01-04', '01-05', '01-06', '01-07', '01-08', '02-23', '03-08', '05-01', '05-09', '06-12', '11-04'];
  // off: дополнительные выходные (переносы), work: рабочие субботы/воскресенья.
  const CAL = {
    2025: { status: 'approved', off: ['2025-05-02', '2025-05-08', '2025-06-13', '2025-11-03', '2025-12-31'], work: ['2025-11-01'] },
    2026: { status: 'approved', off: ['2026-01-09', '2026-03-09', '2026-05-11', '2026-12-31'], work: [] },
    2027: { status: 'draft', off: ['2027-02-22', '2027-05-03', '2027-05-10', '2027-06-14', '2027-11-05', '2027-12-31'], work: ['2027-02-20'] },
  };
  const yearCache = {};
  function yearInfo(y) {
    if (yearCache[y]) return yearCache[y];
    let c = CAL[y], off = new Set(), work = new Set(), status;
    if (c) { c.off.forEach((s) => off.add(parse(s))); c.work.forEach((s) => work.add(parse(s))); status = c.status; }
    else {
      // Прогноз: праздник на выходном переносится на следующий рабочий день (кроме январских —
      // их распределяет Правительство, заранее неизвестно куда).
      status = 'auto';
      H112.filter((h) => !h.startsWith('01')).forEach((h) => {
        const n = parse(y + '-' + h);
        if (dow(n) === 0 || dow(n) === 6) {
          let k = n + 1;
          while (dow(k) === 0 || dow(k) === 6 || isH112(k) || off.has(k)) k++;
          off.add(k);
        }
      });
    }
    return (yearCache[y] = { off, work, status });
  }
  const hCache = new Map(), offCache = new Map();
  function isH112(n) {
    let r = hCache.get(n);
    if (r === undefined) { const [, m, d] = parts(n); r = H112.includes(String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')); hCache.set(n, r); }
    return r;
  }
  function isOff(n) {
    let r = offCache.get(n);
    if (r !== undefined) return r;
    const yi = yearInfo(parts(n)[0]);
    const w = dow(n);
    r = yi.work.has(n) ? false : (w === 0 || w === 6 || isH112(n) || yi.off.has(n));
    offCache.set(n, r);
    return r;
  }
  const isWorkWeekend = (n) => { const w = dow(n); return (w === 0 || w === 6) && yearInfo(parts(n)[0]).work.has(n); };
  function workdays(a, b, skip) { let c = 0; for (let n = a; n <= b; n++) if (!isOff(n) && !(skip && skip(n))) c++; return c; }
  const prevWorkday = (n) => { while (isOff(n)) n--; return n; };
  const calStatus = (y) => yearInfo(y).status;

  // ---------- НДФЛ (прогрессивная шкала, база считается с 1 января) ----------
  const BRACKETS = [[2.4e6, 0.13], [5e6, 0.15], [20e6, 0.18], [50e6, 0.20], [Infinity, 0.22]];
  function taxCum(base) {
    let t = 0, prev = 0;
    for (const [lim, rate] of BRACKETS) { if (base > prev) t += (Math.min(base, lim) - prev) * rate; prev = lim; }
    return t;
  }
  const marginal = (base) => BRACKETS.find(([lim]) => base < lim)[1];

  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

  // ---------- дни отпуска ----------
  function chargedDays(a, b) { let c = 0; for (let n = a; n <= b; n++) if (!isH112(n)) c++; return c; }
  function holidaysIn(a, b) { const r = []; for (let n = a; n <= b; n++) if (isH112(n)) r.push(n); return r; }
  function endForCharged(a, k) { let n = a - 1, c = 0; while (c < k) { n++; if (!isH112(n)) c++; } return n; }
  function restBlock(a, b) { let s = a, e = b; while (isOff(s - 1)) s--; while (isOff(e + 1)) e++; return [s, e]; }

  // ---------- симуляция всех начислений и выплат ----------
  // S: настройки, vacs: [{start, end}] (номера дней), horizon: номер дня
  // X: { extras: [{date, gross, label}] — выплаты из выписки вне модели; k — поправка среднего по факту }
  function simulate(S, vacs, horizon, X) {
    X = X || {};
    const k = X.k || 1;
    const emp = parse(S.empStart);
    const advDay = +S.advDay || 22, salDay = +S.salDay || 7;
    const salary = +S.salary;
    const vlist = vacs.map((v, i) => ({ ...v, idx: i })).sort((a, b) => a.start - b.start);
    const vacDay = new Set();
    vlist.forEach((v) => { for (let n = v.start; n <= v.end; n++) vacDay.add(n); });
    const adj = {};
    (S.adjustments || []).forEach((a) => { if (a.month && +a.amount) adj[a.month] = (adj[a.month] || 0) + +a.amount; });
    const extrasAll = (X.extras || []).concat(S.extras || []);
    extrasAll.forEach((e) => { if (!e.inAvg) return; const key = e.accrual || mkey(...parts(parse(e.date))); adj[key] = (adj[key] || 0) + e.gross; });

    // Месяцы: зарплата за фактически отработанные рабочие дни
    const months = {};
    let [y, m] = parts(emp);
    const [hy, hm] = parts(horizon);
    while (y * 12 + m <= hy * 12 + hm) {
      const first = mk(y, m, 1), last = mk(y, m, dim(y, m));
      const wd = workdays(first, last);
      const notWorked = (n) => n < emp || vacDay.has(n);
      const w1 = workdays(first, mk(y, m, 15), notWorked);
      const w2 = workdays(mk(y, m, 16), last, notWorked);
      let excl = 0, vacCal = 0;
      for (let n = first; n <= last; n++) { if (n < emp) excl++; else if (vacDay.has(n)) { excl++; vacCal++; } }
      months[mkey(y, m)] = {
        key: mkey(y, m), y, m, first, last, wd, w1, w2, cd: dim(y, m), excl, vacCal,
        normWd: workdays(first, last), // норма месяца (для пропорции премий)
        sal1: r2(salary / wd * w1), sal2: r2(salary / wd * w2), adj: adj[mkey(y, m)] || 0,
      };
      [y, m] = addMonths(y, m, 1);
    }

    // Премии и отпускные считаются в хронологическом порядке (премия может зависеть от отпускных)
    const bonuses = {};
    const vacRes = [];
    function quarterBonus(qy, q) {
      const k = qy + 'Q' + q;
      if (bonuses[k]) return bonuses[k];
      const qStart = mk(qy, 3 * q - 2, 1);
      const [py, pm] = addMonths(qy, 3 * q, 1);
      const payDay = prevWorkday(mk(py, pm, dim(py, pm)));
      let amount = 0, base = 0, source = 'model', fact = 0, norm = 0;
      const ms = [0, 1, 2].map((i) => months[mkey(qy, 3 * q - 2 + i)]);
      if (S.bonusBase === 'worked') {
        // Положение работодателя о премировании: Б = факт отработки / норма отработки × оклад × 3,
        // факт — рабочие дни квартала за вычетом отпусков; премия есть, если приняли не позднее 15-го числа 2-го месяца (п. 6.3.2)
        const qEnd = mk(qy, 3 * q, dim(qy, 3 * q));
        if (emp <= mk(qy, 3 * q - 1, 15) && ms.every(Boolean)) {
          norm = workdays(qStart, qEnd);
          fact = workdays(qStart, qEnd, (n) => n < emp || vacDay.has(n));
          base = r2(salary * 3 * fact / norm);
          amount = r2(base * S.bonusPct / 100);
        }
      } else if (qStart >= emp && ms.every(Boolean)) {
        if (S.bonusBase === 'accrued' || S.bonusBase === 'income') base = ms.reduce((s, x) => s + x.sal1 + x.sal2, 0);
        else base = salary * 3;
        if (S.bonusBase === 'income') base += vacRes.filter((v) => v.start >= qStart && v.start <= ms[2].last).reduce((s, v) => s + v.pay, 0);
        amount = r2(base * S.bonusPct / 100);
      }
      const ov = S.bonusOverrides && S.bonusOverrides[k];
      if (ov !== undefined && ov !== null && ov !== '') { amount = +ov; source = 'fact'; }
      return (bonuses[k] = { key: k, y: qy, q, amount, base, fact, norm, payDay, accrual: mkey(py, pm), source });
    }
    function bonusesAccruedIn(keys) {
      const out = [];
      keys.forEach((k) => {
        const [yy, mm] = k.split('-').map(Number);
        if (mm % 3 === 1) { const [qy, qm] = addMonths(yy, mm, -1); const b = quarterBonus(qy, qm / 3); if (b.amount > 0) out.push(b); }
      });
      return out;
    }

    vlist.forEach((v) => {
      const [vy, vm] = parts(v.start);
      const calc = [];
      for (let i = 12; i >= 1; i--) { const [cy, cm] = addMonths(vy, vm, -i); if (months[mkey(cy, cm)]) calc.push(months[mkey(cy, cm)]); }
      // пересчёт исключённых дней только по отпускам ДО этого (дни этого отпуска в расчётный период не попадают)
      let days = 0, earn = 0, workedWd = 0, normWd = 0;
      const rows = calc.map((x) => {
        const worked = x.cd - x.excl;
        const dd = x.excl === 0 ? 29.3 : 29.3 * worked / x.cd;
        days += dd; earn += x.sal1 + x.sal2 + x.adj; workedWd += x.w1 + x.w2; normWd += x.normWd;
        return { key: x.key, y: x.y, m: x.m, cd: x.cd, worked, days: dd, salary: r2(x.sal1 + x.sal2), adj: x.adj, full: x.excl === 0 };
      });
      const bl = bonusesAccruedIn(calc.map((x) => x.key));
      const ratio = normWd ? workedWd / normWd : 0;
      const bonusRows = bl.map((b) => ({
        key: b.key, accrual: b.accrual, amount: b.amount, source: b.source,
        counted: S.bonusMode === 'none' ? 0 : S.bonusMode === 'prorata' && ratio < 1 ? r2(b.amount * ratio) : b.amount,
      }));
      const bonusSum = bonusRows.reduce((s, b) => s + b.counted, 0);
      if (v.unpaid) { vacRes.push({ idx: v.idx, start: v.start, end: v.end, unpaid: true, charged: 0, holidays: [], avg: 0, modelAvg: 0, k: 1, actual: false, pay: 0, payDay: v.start, rows, bonusRows: [], earn: r2(earn), bonusSum: 0, days, workedWd, normWd, ratio: 0, fallback: false }); return; }
      const fallback = days === 0;
      const modelAvg = fallback ? r2(salary / 29.3) : r2((earn + bonusSum) / days);
      const charged = chargedDays(v.start, v.end);
      const actual = v.actualGross > 0;
      const avg = actual ? r2(v.actualGross / charged) : r2(modelAvg * k);
      const pay = actual ? r2(v.actualGross) : r2(avg * charged);
      const payDay = prevWorkday(v.start - (+S.payGap + 1));
      vacRes.push({ idx: v.idx, start: v.start, end: v.end, charged, holidays: holidaysIn(v.start, v.end), avg, modelAvg, k: actual ? 1 : k, actual, pay, payDay,
        rows, bonusRows, earn: r2(earn), bonusSum: r2(bonusSum), days, workedWd, normWd, ratio, fallback });
    });

    // Все премии до горизонта
    Object.values(months).forEach((x) => { if (x.m % 3 === 0) quarterBonus(x.y, x.m / 3); });

    // Выплаты
    const pays = [];
    Object.values(months).forEach((x) => {
      if (x.last < emp) return;
      pays.push({ date: prevWorkday(mk(x.y, x.m, advDay)), kind: 'adv', ref: x.key, gross: x.sal1,
        label: 'Аванс за 1–15 ' + MONTHS_GEN[x.m - 1], note: x.w1 + ' из ' + workdays(x.first, mk(x.y, x.m, 15)) + ' раб. дн.' });
      const [ny, nm] = addMonths(x.y, x.m, 1);
      pays.push({ date: prevWorkday(mk(ny, nm, salDay)), kind: 'sal', ref: x.key, gross: x.sal2,
        label: 'Зарплата за 16–' + x.cd + ' ' + MONTHS_GEN[x.m - 1], note: x.w2 + ' из ' + workdays(mk(x.y, x.m, 16), x.last) + ' раб. дн.' });
    });
    Object.values(bonuses).forEach((b) => {
      if (b.amount > 0) pays.push({ date: b.payDay, kind: 'bonus', ref: b.key, gross: b.amount, label: 'Премия за ' + b.q + ' кв. ' + b.y, note: b.source === 'fact' ? 'факт' : '' });
    });
    vacRes.forEach((v) => {
      if (v.unpaid) return;
      pays.push({ date: v.payDay, kind: 'vac', ref: iso(v.start), gross: v.pay, label: 'Отпускные ' + fmtRange(v.start, v.end), note: v.charged + ' дн. × ' + new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v.avg) + ' ₽' });
    });
    extrasAll.forEach((e) => {
      pays.push({ date: parse(e.date), kind: 'other', ref: e.date + ':' + e.gross, gross: e.gross, label: e.label || 'Прочая выплата', note: e.note || 'из выписки', fact: true });
    });
    // Совместительство в ПАО: факты из выписки, дальше — последние суммы по тому же графику
    if (X.pao && (X.pao.past.length || X.pao.adv || X.pao.sal)) {
      const lastDay = X.pao.past.reduce((m, p) => Math.max(m, parse(p.date)), -Infinity);
      const paoPay = (date, net, t, fact, ref) => pays.push({ date, kind: 'pao', emp: 'pao', ref, net0: net, gross: grossFromNet(net, 0), fact,
        label: (X.pao.label || 'Совместительство') + ': ' + (t === 'adv' ? 'аванс' : 'зарплата'), note: fact ? 'совместительство' : 'совместительство, прогноз' });
      X.pao.past.forEach((p) => paoPay(parse(p.date), p.net, p.t, true, p.date + ':' + p.net));
      Object.values(months).forEach((x) => {
        const a = prevWorkday(mk(x.y, x.m, advDay)), [ny, nm] = addMonths(x.y, x.m, 1), b = prevWorkday(mk(ny, nm, salDay));
        if (X.pao.adv && a > lastDay) paoPay(a, X.pao.adv, 'adv', false, 'adv:' + x.key);
        if (X.pao.sal && b > lastDay) paoPay(b, X.pao.sal, 'sal', false, 'sal:' + x.key);
      });
    }
    const order = { sal: 0, adv: 1, bonus: 2, other: 3, vac: 4, pao: 5 };
    pays.sort((a, b) => a.date - b.date || order[a.kind] - order[b.kind]);
    // НДФЛ: каждый работодатель ведёт свою базу с 1 января
    const cums = {};
    pays.forEach((p) => {
      const key = parts(p.date)[0] + ':' + (p.emp || 'rtk');
      const cum = cums[key] || 0;
      p.cumBefore = cum;
      if (p.net0 !== undefined) { p.net = p.net0; p.ndfl = r2(p.gross - p.net0); }
      else { p.ndfl = Math.round(taxCum(cum + p.gross)) - Math.round(taxCum(cum)); p.net = r2(p.gross - p.ndfl); }
      p.rate = marginal(cum + p.gross);
      cums[key] = cum + p.gross;
    });
    return { months, bonuses, vacRes, pays: pays.filter((p) => p.date <= horizon + 45) };
  }

  function fmtRange(a, b) {
    const [ay, am, ad] = parts(a), [by, bm, bd] = parts(b);
    if (a === b) return ad + ' ' + MONTHS_GEN[am - 1];
    if (ay === by && am === bm) return ad + '–' + bd + ' ' + MONTHS_GEN[am - 1];
    return ad + ' ' + MONTHS_GEN[am - 1] + (ay !== by ? ' ' + ay : '') + ' – ' + bd + ' ' + MONTHS_GEN[bm - 1];
  }

  // Подбор gross по сумме «на руки» (с учётом округления НДФЛ)
  function grossFromNet(net, cumBefore) {
    let g = net / (1 - marginal(cumBefore));
    for (let i = 0; i < 6; i++) { const nd = Math.round(taxCum(cumBefore + g)) - Math.round(taxCum(cumBefore)); g = net + nd; }
    return r2(g);
  }

  // Накопленный отпуск (28 дн./год) к дате
  function entitlement(empStart, date) {
    const e = parse(empStart);
    if (date <= e) return 0;
    const [ey, em, ed] = parts(e);
    let full = 0, [y, m] = [ey, em];
    for (;;) {
      const [ny, nm] = addMonths(y, m, 1);
      const nd = Math.min(ed, dim(ny, nm));
      const next = mk(ny, nm, nd);
      if (next > date) break;
      full++; [y, m] = [ny, nm];
    }
    const anchor = mk(y, m, Math.min(ed, dim(y, m)));
    const rest = date - anchor;
    const months = full + (rest >= 15 ? 1 : 0);
    return Math.round(28 / 12 * months * 100) / 100;
  }

  // ---------- сценарий: с отпуском и без ----------
  function overlaps(a, b) { return a.start <= b.end && b.start <= a.end; }
  function scenario(S, saved, target, X, win) {
    const others = saved.filter((v) => !overlaps(v, target));
    const lastEnd = Math.max(target.end, win ? win.b : 0, ...others.map((v) => v.end));
    const horizon = mk(parts(lastEnd)[0] + 1, 2, 28);
    const withV = simulate(S, [...others, target], horizon, X);
    const without = simulate(S, others, horizon, X);
    const tIdx = others.length;
    const tv = withV.vacRes.find((v) => v.idx === tIdx);
    const sum = (ps, f) => ps.reduce((s, p) => s + (f ? (f(p) ? p.net : 0) : p.net), 0);
    const sumG = (ps, f) => ps.reduce((s, p) => s + (f(p) ? p.gross : 0), 0);
    const isTargetVac = (p) => p.kind === 'vac' && p.ref === iso(target.start);
    const delta = {
      net: r2(sum(withV.pays) - sum(without.pays)),
      vacPay: tv.pay,
      salary: r2(sumG(withV.pays, (p) => p.kind === 'adv' || p.kind === 'sal') - sumG(without.pays, (p) => p.kind === 'adv' || p.kind === 'sal')),
      bonus: r2(sumG(withV.pays, (p) => p.kind === 'bonus') - sumG(without.pays, (p) => p.kind === 'bonus')),
      otherVac: r2(sumG(withV.pays, (p) => p.kind === 'vac' && !isTargetVac(p)) - sumG(without.pays, (p) => p.kind === 'vac')),
    };
    delta.gross = r2(delta.vacPay + delta.salary + delta.bonus + delta.otherVac);
    delta.ndfl = r2(delta.gross - delta.net);
    // Окно: два месяца до начала — два месяца после окончания
    const [sy, sm] = parts(target.start), [ey, em] = parts(target.end);
    const [wy1, wm1] = addMonths(sy, sm, -2), [wy2, wm2] = addMonths(ey, em, 2);
    const wa = win ? win.a : mk(wy1, wm1, 1), wb = win ? win.b : mk(wy2, wm2, dim(wy2, wm2));
    const keyOf = (p) => p.kind + ':' + p.ref;
    const baseMap = new Map(without.pays.map((p) => [keyOf(p), p]));
    const rows = withV.pays.filter((p) => p.date >= wa && p.date <= wb).map((p) => ({ ...p, base: baseMap.get(keyOf(p)) || null }));
    // выплаты, которые есть только в сценарии «без отпуска», в окне
    const withKeys = new Set(withV.pays.map(keyOf));
    without.pays.filter((p) => p.date >= wa && p.date <= wb && !withKeys.has(keyOf(p))).forEach((p) => rows.push({ ...p, gross: 0, ndfl: 0, net: 0, base: p, ghost: true }));
    rows.sort((a, b) => a.date - b.date);
    return { tv, delta, rows, wa, wb, withV, without, others };
  }


  // Потеря квартальных премий из-за отпуска: сравнение сценариев «с отпуском» и «без»
  function bonusLoss(sc) {
    const qs = [];
    Object.keys(sc.withV.bonuses).forEach((k) => {
      const a = sc.withV.bonuses[k], b = sc.without.bonuses[k];
      if (!b || Math.abs(a.amount - b.amount) < 0.5) return;
      const pa = sc.withV.pays.find((p) => p.kind === 'bonus' && p.ref === k), pb = sc.without.pays.find((p) => p.kind === 'bonus' && p.ref === k);
      qs.push({ key: k, y: a.y, q: a.q, with: a.amount, without: b.amount, gross: r2(a.amount - b.amount),
        net: r2((pa ? pa.net : 0) - (pb ? pb.net : 0)), fact: a.fact, norm: a.norm, factWithout: b.fact, payDay: a.payDay });
    });
    return { qs, gross: r2(qs.reduce((s, x) => s + x.gross, 0)), net: r2(qs.reduce((s, x) => s + x.net, 0)) };
  }

  function alternatives(S, saved, target, span, X) {
    const k = chargedDays(target.start, target.end);
    const base = saved.filter((v) => !overlaps(v, target));
    const out = [];
    for (let off = -span; off <= span; off++) {
      const s = target.start + off, e = endForCharged(s, k);
      const sc = scenario(S, base, { start: s, end: e }, X);
      const [rs, re] = restBlock(s, e);
      out.push({ off, start: s, end: e, net: sc.delta.net, vacNet: sc.withV.pays.find((p) => p.kind === 'vac' && p.ref === iso(s)).net, bonusLoss: bonusLoss(sc).net,
        workMissed: workdays(s, e), rest: re - rs + 1, restStart: rs, restEnd: re });
    }
    return out;
  }


  // ---------- выписка банка (CSV, разделитель «;») ----------
  function parseCsvLine(line) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true; else if (c === ';') { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur); return out;
  }
  // employers: [{ re, src }] — чьи зачисления брать
  function parseStatement(text, employers) {
    if (employers instanceof RegExp) employers = [{ re: employers, src: 'rtk' }];
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
    const head = parseCsvLine(lines[0]).map((h) => h.trim());
    const col = (re) => head.findIndex((h) => re.test(h));
    const iDate = col(/^Дата и время операции/i), iDir = col(/^Списание\/Зачисление/i), iSum = col(/^Сумма в валюте операции/i), iName = col(/^Наименование операции/i);
    const iType = col(/^Тип операции/i), iCat = col(/^Категория/i);
    if (iDate < 0 || iSum < 0 || iName < 0) throw new Error('Не нашёл нужные столбцы (дата, сумма, наименование операции).');
    const out = [];
    lines.slice(1).forEach((l) => {
      const c = parseCsvLine(l);
      const hay = (c[iName] || '') + ' | ' + (iType >= 0 ? c[iType] : '') + ' | ' + (iCat >= 0 ? c[iCat] : '');
      const emp = employers.find((e) => e.re.test(e.anyField ? hay : (c[iName] || '')));
      if (!emp) return;
      if (iDir >= 0 && !/Зачисление/i.test(c[iDir])) return;
      const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(c[iDate]); if (!m) return;
      const net = Math.abs(parseFloat(String(c[iSum]).replace(/\s/g, '').replace(',', '.')));
      if (!(net > 0)) return;
      const row = { date: m[3] + '-' + m[2] + '-' + m[1], net: r2(net), src: emp.src };
      if (emp.src !== 'rtk') row.t = /аванс/i.test(c[iName]) ? 'adv' : 'sal';
      out.push(row);
    });
    return out;
  }

  // Сверка выписки с моделью: регулярные выплаты, отпускные, прочее.
  // P: профиль, saved: [{start,end,status,actualNet}], ledger: [{date, net}]
  function reconcile(P, saved, ledger, horizon) {
    const sim0 = simulate(P, saved, horizon);
    const all = ledger.map((l) => ({ ...l, src: l.src || 'rtk', day: parse(l.date) })).sort((a, b) => a.day - b.day);
    const L = all.filter((l) => l.src === 'rtk');
    const paoL = all.filter((l) => l.src === 'pao');
    const lastOf = (t) => { const r = paoL.filter((l) => l.t === t); return r.length ? r[r.length - 1].net : 0; };
    const pao = { past: paoL.map((l) => ({ date: l.date, net: l.net, t: l.t })), adv: lastOf('adv'), sal: lastOf('sal'), label: (P.employers || []).filter((e) => e.src === 'pao').map((e) => e.label)[0] };
    const used = new Set();
    const regular = sim0.pays.filter((p) => p.kind !== 'vac');
    const near = (day, net) => regular.filter((p) => !used.has(p) && Math.abs(p.date - day) <= 3 && Math.abs(p.net - net) <= Math.max(5, p.net * 0.005))
      .sort((a, b) => Math.abs(a.net - net) - Math.abs(b.net - net))[0];
    L.forEach((l) => { const m = near(l.day, l.net); if (m) { used.add(m); l.match = m; } });
    // выплата может прийти несколькими переводами в один день (например, оклад и авторское вознаграждение)
    const byDay = {};
    L.filter((l) => !l.match).forEach((l) => (byDay[l.day] = byDay[l.day] || []).push(l));
    Object.values(byDay).forEach((grp) => {
      if (grp.length < 2) return;
      const m = near(grp[0].day, grp.reduce((s, l) => s + l.net, 0));
      if (m) { used.add(m); grp.forEach((l) => { l.match = m; l.part = true; }); }
    });
    const vac = saved.map((v) => ({ ...v }));
    vac.forEach((v) => {
      if (v.status !== 'taken' || v.unpaid) return;
      const res = sim0.vacRes.find((r) => r.start === v.start);
      const cand = L.filter((l) => !l.match && !l.vac && l.day >= v.start - 21 && l.day < v.start)
        .sort((a, b) => Math.abs(a.day - res.payDay) - Math.abs(b.day - res.payDay))[0];
      if (cand) { cand.vac = v; v.factNet = cand.net; v.factSource = 'ledger'; v.factDate = cand.day; }
      else if (+v.actualNet > 0) { v.factNet = +v.actualNet; v.factSource = 'manual'; }
    });
    const cumAt = (sim, day) => { const y = parts(day)[0]; return sim.pays.filter((p) => p.date < day && parts(p.date)[0] === y).reduce((s, p) => s + p.gross, 0); };
    // Поступления вне графика зарплаты: облагаются НДФЛ; в средний заработок — по флагу профиля (п. 3 Положения № 922)
    const extras = L.filter((l) => !l.match && !l.vac).map((l) => { l.extra = true; return { date: l.date, gross: grossFromNet(l.net, cumAt(sim0, l.day)), label: P.extraLabel || 'Прочая выплата', note: P.extraInAvg ? 'входит в средний заработок' : 'облагается НДФЛ, в средний заработок не входит', inAvg: !!P.extraInAvg }; });
    // поправка среднего: по последнему состоявшемуся отпуску с известной суммой
    const sim1 = simulate(P, vac, horizon, { extras, pao });
    let k = 1, calib = null;
    vac.forEach((v) => {
      if (!(v.factNet > 0) || v.unpaid) return;
      const p = sim1.pays.find((x) => x.kind === 'vac' && x.ref === iso(v.start));
      const res = sim1.vacRes.find((r) => r.start === v.start);
      v.actualGross = grossFromNet(v.factNet, p.cumBefore);
      v.modelNet = p.net; v.modelAvg = res.modelAvg;
      const implied = v.actualGross / res.charged;
      if (!calib || v.start > calib.start) { calib = { start: v.start, end: v.end, modelAvg: res.modelAvg, implied, modelNet: p.net, factNet: v.factNet, k: implied / res.modelAvg }; k = calib.k; }
    });
    const missing = sim0.pays.filter((p) => p.kind !== 'vac' && !used.has(p) && L.length && p.date >= L[0].day && p.date <= L[L.length - 1].day);
    return { ledger: L, paoLedger: paoL, pao, extras, vac, k, calib, missing };
  }

  root.VacEngine = { parseStatement, reconcile, bonusLoss, mk, parse, iso, parts, dim, dow, isWorkWeekend, mkey, addMonths, r2, isOff, isH112, workdays, prevWorkday, calStatus, taxCum, marginal,
    chargedDays, holidaysIn, endForCharged, restBlock, simulate, scenario, alternatives, grossFromNet, entitlement, fmtRange, MONTHS, MONTHS_GEN };
})(typeof window !== 'undefined' ? window : globalThis);
