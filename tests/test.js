'use strict';
// qp-crew logic tests. Loads the inline <script> blocks from index.html into a
// vm context with stubbed browser globals, then exercises the exported API.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!scripts.length) throw new Error('no script blocks found');

const alerts = [];
const sandbox = {
  console,
  localStorage: {
    _s: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : null; },
    setItem(k, v) { this._s[k] = String(v); },
    removeItem(k) { delete this._s[k]; },
  },
  alert: m => { alerts.push(String(m)); },
  confirm: () => true,
  document: null, // set below
};
function makeEl() {
  return {
    innerHTML: '', value: '', textContent: '', files: [],
    style: {}, dataset: {},
    addEventListener() {}, appendChild() {}, remove() {}, click() {},
    querySelectorAll() { return []; },
  };
}
const els = {};
sandbox.document = {
  getElementById: id => (els[id] = els[id] || makeEl()),
  querySelectorAll: () => [],
  createElement: () => makeEl(),
  body: makeEl(),
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const src of scripts) vm.runInContext(src, sandbox);

const qp = sandbox.__qp;
if (!qp) throw new Error('__qp test hook missing');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL: ' + name); }
}
function reset() {
  alerts.length = 0;
  qp._reset({ crew: [], jobs: [], shifts: [], timeLogs: [], activity: [], meta: { version: 2 } });
}
function setInput(id, v) { sandbox.document.getElementById(id).value = v; }

// ---- helpers ----
reset();
ok(qp.fmtMoney(25) === '$25.00', 'fmtMoney');
ok(qp.fmtMoney(7.5) === '$7.50', 'fmtMoney decimals');
ok(qp.fmtDur(90) === '1h 30m', 'fmtDur 90m');
ok(qp.fmtDur(480) === '8h', 'fmtDur 480m');
ok(qp.fmtDur(45) === '45m', 'fmtDur 45m');
ok(qp.minsBetween('08:00', '16:30') === 510, 'minsBetween');
ok(qp.minsBetween('16:00', '08:00') === 0, 'minsBetween negative clamps');
ok(qp.fmtTime24('08:00') === '8:00 AM', 'fmtTime24 am');
ok(qp.fmtTime24('16:30') === '4:30 PM', 'fmtTime24 pm');
const ws = qp.weekStart(0);
ok(ws.getDay() === 0, 'weekStart lands on Sunday');
ok(qp.dayKey(ws) <= qp.dayKey(new Date()), 'weekStart not in future');

// ---- migrate old data ----
reset();
qp._reset({ crew: [{ id: 'c1', name: 'Old Guy', phone: '', role: 'worker', rate: 25 }],
  jobs: [{ id: 'j1', cust: 'Cust', who: 'c1' }] });
qp.migrate();
const mdb = qp._db();
ok(Array.isArray(mdb.shifts) && Array.isArray(mdb.timeLogs), 'migrate adds shifts/timeLogs');
ok(mdb.jobs[0].status === 'assigned' && mdb.jobs[0].hours === 0 && mdb.jobs[0].amount === 0, 'migrate fills job defaults');

// ---- crew add/delete ----
reset();
setInput('c-name', ''); qp.addCrew();
ok(qp._db().crew.length === 0 && alerts.length === 1, 'addCrew rejects empty name');
setInput('c-name', 'Sam Worker'); setInput('c-phone', '204-555-0100');
setInput('c-role', 'worker'); setInput('c-rate', '25'); qp.addCrew();
ok(qp._db().crew.length === 1, 'addCrew adds worker');
ok(qp._db().crew[0].rate === 25, 'addCrew keeps rate');
setInput('c-name', 'Bad Rate'); setInput('c-rate', 'abc'); qp.addCrew();
ok(qp._db().crew[1].rate === 25, 'addCrew falls back to default rate on bad input');

// ---- jobs ----
reset();
setInput('c-name', 'Quoter Q'); setInput('c-role', 'quoter'); setInput('c-rate', '25'); qp.addCrew();
const wid = qp._db().crew[0].id;
setInput('j-cust', ''); setInput('j-who', wid); qp.addJob();
ok(qp._db().jobs.length === 0, 'addJob rejects empty customer');
setInput('j-cust', 'Farm Co'); setInput('j-phone', '204-555-0200'); setInput('j-addr', '12 Road');
setInput('j-type', 'build'); setInput('j-who', wid); setInput('j-date', '2026-10-21'); setInput('j-notes', '40x60');
qp.addJob();
const job = qp._db().jobs[0];
ok(job && job.status === 'assigned' && job.type === 'build', 'addJob creates build job');

// ---- time logs + hour sync ----
reset();
setInput('c-name', 'W1'); setInput('c-role', 'worker'); setInput('c-rate', '25'); qp.addCrew();
const w1 = qp._db().crew[0].id;
setInput('j-cust', 'Barn'); setInput('j-type', 'build'); setInput('j-who', w1); qp.addJob();
const jid = qp._db().jobs[0].id;
qp.clockIn(jid);
ok(qp._db().timeLogs.length === 1 && qp._db().timeLogs[0].end === null, 'clockIn opens entry');
ok(qp._db().jobs[0].status === 'in progress', 'clockIn moves assigned job to in progress');
alerts.length = 0; qp.clockIn(jid);
ok(alerts.length === 1, 'double clockIn warns');
// simulate 2h worked by backdating start, then clock out
qp._db().timeLogs[0].start = Date.now() - 2 * 3600 * 1000;
qp.clockOut(jid);
const j2 = qp._db().jobs[0];
ok(j2.hours >= 1.99 && j2.hours <= 2.01, 'clockOut syncs hours from log (got ' + j2.hours + ')');
ok(j2.amount === 50, 'build amount = hours * rate (got ' + j2.amount + ')');
ok(qp.jobHasLogs(jid), 'jobHasLogs true');
alerts.length = 0; qp.setHours(jid, '9');
ok(alerts.length === 1 && qp._db().jobs[0].hours !== 9, 'setHours blocked when logs exist');
qp.delTimeLog(qp._db().timeLogs[0].id);
ok(qp._db().jobs[0].hours === 0, 'deleting last log resets hours');
qp.setHours(jid, '7.5');
ok(qp._db().jobs[0].hours === 7.5 && qp._db().jobs[0].amount === 187.5, 'manual hours edit works without logs');

// ---- status pipeline / payable ----
reset();
setInput('c-name', 'W2'); setInput('c-role', 'worker'); setInput('c-rate', '30'); qp.addCrew();
const w2 = qp._db().crew[0].id;
setInput('j-cust', 'Shed'); setInput('j-type', 'build'); setInput('j-who', w2); qp.addJob();
const j3id = qp._db().jobs[0].id;
qp.setHours(j3id, '4');
qp.setStatus(j3id, 'payable');
ok(qp._db().jobs[0].amount === 120, 'payable auto-computes amount at crew rate');
qp.setStatus(j3id, 'paid');
ok(qp._db().jobs[0].paidAt > 0, 'paid stamps paidAt');
qp.setStatus(j3id, 'done');
ok(qp._db().jobs[0].paidAt === 0, 'leaving paid clears paidAt');
const chart = qp.paidByDay(14);
ok(chart.length === 14 && chart.every(c => typeof c.total === 'number'), 'paidByDay 14 entries');

// ---- shifts + overlaps ----
reset();
setInput('c-name', 'S1'); setInput('c-role', 'worker'); setInput('c-rate', '25'); qp.addCrew();
const s1 = qp._db().crew[0].id;
setInput('s-crew', s1); setInput('s-date', '2026-10-21'); setInput('s-start', '08:00'); setInput('s-end', '16:00'); setInput('s-notes', ''); setInput('s-job', '');
qp.addShift();
ok(qp._db().shifts.length === 1, 'addShift adds');
setInput('s-start', '12:00'); setInput('s-end', '20:00'); qp.addShift(); // confirm() stubbed true
ok(qp._db().shifts.length === 2, 'overlapping shift added after confirm');
const ov = qp.findOverlaps(s1, '2026-10-21');
ok(ov.length === 1, 'findOverlaps detects clash');
const noOv = qp.findOverlaps(s1, '2026-10-22');
ok(noOv.length === 0, 'findOverlaps empty on clear day');
alerts.length = 0; setInput('s-start', '20:00'); setInput('s-end', '08:00'); qp.addShift();
ok(alerts.length === 1 && qp._db().shifts.length === 2, 'addShift rejects end before start');
const st = qp.crewStats(s1);
ok(st.upcomingShifts === 2, 'crewStats counts upcoming shifts');
ok(st.hours === 0 && st.jobs === 0, 'crewStats zero job stats');

// ---- export / import roundtrip ----
reset();
setInput('c-name', 'E1'); setInput('c-role', 'worker'); setInput('c-rate', '25'); qp.addCrew();
setInput('j-cust', 'JC'); setInput('j-type', 'quote'); setInput('j-who', qp._db().crew[0].id); qp.addJob();
const exported = qp.exportJsonString();
const parsed = JSON.parse(exported);
ok(parsed.crew.length === 1 && parsed.jobs.length === 1, 'export has data');
const clean = qp.validateImport(parsed);
ok(clean.crew.length === 1 && clean.jobs.length === 1, 'validateImport roundtrip');
let threw = false;
try { qp.validateImport({ nope: true }); } catch (e) { threw = true; }
ok(threw, 'validateImport rejects garbage');
const clean2 = qp.validateImport({ crew: [{ id: 'x' }], jobs: [] });
ok(clean2.crew.length === 0, 'validateImport drops nameless crew');

// ---- quote fee model ----
reset();
setInput('c-name', 'Quoter Z'); setInput('c-role', 'quoter'); setInput('c-rate', '25'); setInput('c-qfee', '40'); qp.addCrew();
const qz = qp._db().crew[0];
ok(qz.quoteFee === 40, 'addCrew stores quote fee');
setInput('j-cust', 'Quote Me'); setInput('j-type', 'quote'); setInput('j-who', qz.id); qp.addJob();
ok(qp._db().jobs[0].amount === 40, 'quote job prefills quoter fee');
setInput('rate-' + qz.id, '30'); setInput('qfee-' + qz.id, '55'); qp.updateCrew(qz.id);
ok(qp._db().crew[0].rate === 30 && qp._db().crew[0].quoteFee === 55, 'updateCrew edits pay');
const qjid = qp._db().jobs[0].id;
qp.setStatus(qjid, 'customer confirmed');
qp.setStatus(qjid, 'payable');
ok(qp._db().jobs[0].amount === 40, 'quote fee survives to payable');

// ---- activity log ----
reset();
const a0 = qp._db().activity.length;
qp.logAct('test entry');
ok(qp._db().activity.length === a0 + 1 && qp._db().activity[0].text === 'test entry', 'logAct records');
setInput('c-name', 'Act Guy'); setInput('c-role', 'worker'); setInput('c-rate', '25'); qp.addCrew();
ok(qp._db().activity.some(a => a.text.includes('Act Guy')), 'addCrew logs activity');
for (let i = 0; i < 250; i++) qp.logAct('x' + i);
ok(qp._db().activity.length === 200, 'activity capped at 200');

// ---- payroll CSV ----
reset();
setInput('c-name', 'P1'); setInput('c-role', 'worker'); setInput('c-rate', '25'); qp.addCrew();
const p1 = qp._db().crew[0].id;
setInput('j-cust', 'CSV "Customer", Inc'); setInput('j-type', 'build'); setInput('j-who', p1); qp.addJob();
const pjid = qp._db().jobs[0].id;
qp.setHours(pjid, '2'); qp.setStatus(pjid, 'payable');
const csv = qp.exportPayrollCsvString();
ok(csv.split('\r\n').length === 2, 'CSV has header + 1 row');
ok(csv.includes('"CSV ""Customer"", Inc"'), 'CSV escapes quotes');
ok(csv.includes('50.00'), 'CSV carries amount');

// ---- migrate old crew gets quoteFee ----
reset();
qp._reset({ crew: [{ id: 'c9', name: 'Legacy', role: 'worker', rate: 25 }], jobs: [], shifts: [], timeLogs: [], activity: [] });
qp.migrate();
ok(qp._db().crew[0].quoteFee === 25, 'migrate backfills quoteFee');

// ---- quote -> build conversion, duplication, overdue ----
reset();
setInput('c-name', 'QW'); setInput('c-role', 'quoter'); setInput('c-rate', '25'); qp.addCrew();
const qw = qp._db().crew[0].id;
setInput('j-cust', 'Convert Me'); setInput('j-type', 'quote'); setInput('j-who', qw); setInput('j-date', '2001-01-01'); qp.addJob();
const cq = qp._db().jobs[0];
ok(qp.isOverdue(cq), 'past-dated open job is overdue');
qp.convertToBuild(cq.id);
const after = qp._db().jobs;
ok(after.length === 2, 'convertToBuild adds a build job');
ok(after.find(j => j.id === cq.id).status === 'done', 'quote marked done after conversion');
ok(after.find(j => j.type === 'build' && j.cust === 'Convert Me'), 'build job carries customer over');
qp.dupJob(cq.id);
ok(qp._db().jobs.length === 3 && qp._db().jobs[2].status === 'assigned', 'dupJob copies job as assigned');
const doneJ = qp._db().jobs[2];
qp.setStatus(doneJ.id, 'done');
ok(!qp.isOverdue(qp._db().jobs.find(j => j.id === doneJ.id)), 'done job with past date not overdue');
setInput('j-cust', 'Future'); setInput('j-type', 'build'); setInput('j-who', qw); setInput('j-date', '2099-01-01'); qp.addJob();
ok(!qp.isOverdue(qp._db().jobs[qp._db().jobs.length - 1]), 'future job not overdue');

// ---- confirm + payable shortcut ----
reset();
setInput('c-name', 'CW'); setInput('c-role', 'worker'); setInput('c-rate', '20'); qp.addCrew();
const cw = qp._db().crew[0].id;
setInput('j-cust', 'Shortcut'); setInput('j-type', 'build'); setInput('j-who', cw); qp.addJob();
const sj = qp._db().jobs[0].id;
qp.setHours(sj, '3');
qp.setStatus(sj, 'done');
qp.confirmAndPayable(sj);
const sjd = qp._db().jobs[0];
ok(sjd.status === 'payable' && sjd.amount === 60, 'confirmAndPayable jumps done -> payable with computed amount');
ok(qp._db().activity.some(a => a.text.includes('customer confirmed')), 'shortcut logs both transitions');

// ---- expenses, pricing, profit ----
reset();
setInput('c-name', 'E2'); setInput('c-role', 'worker'); setInput('c-rate', '20'); qp.addCrew();
const e2 = qp._db().crew[0].id;
setInput('j-cust', 'Profit Job'); setInput('j-type', 'build'); setInput('j-who', e2); qp.addJob();
const pj = qp._db().jobs[0].id;
qp.setHours(pj, '5'); // 5h x $20 = $100 labor
qp.setPrice(pj, '300');
ok(qp._db().jobs[0].price === 300, 'setPrice stores customer price');
setInput('ex-desc-' + pj, 'Steel'); setInput('ex-amt-' + pj, '80'); qp.addExpense(pj);
ok(qp.materialsCost(pj) === 80, 'materialsCost sums expenses');
setInput('ex-desc-' + pj, 'Screws'); setInput('ex-amt-' + pj, '20'); qp.addExpense(pj);
const prof = qp.jobProfit(pj);
ok(prof.labor === 100 && prof.materials === 100 && prof.profit === 100, 'jobProfit = price - labor - materials (got ' + prof.profit + ')');
ok(prof.margin === 33.33, 'margin percent (got ' + prof.margin + ')');
alerts.length = 0; setInput('ex-desc-' + pj, ''); setInput('ex-amt-' + pj, '5'); qp.addExpense(pj);
ok(alerts.length === 1 && qp.materialsCost(pj) === 100, 'addExpense rejects empty description');
qp.delExpense(qp._db().expenses[0].id); // confirm() stubbed true
ok(qp.materialsCost(pj) === 20, 'delExpense removes expense');

// ---- overtime: daily ----
reset();
setInput('set-otmode', 'daily'); setInput('set-otrate', '1.5'); qp.saveSettings();
ok(qp.otSettings().otMode === 'daily' && qp.otSettings().otRate === 1.5, 'saveSettings persists OT rule');
setInput('c-name', 'OT1'); setInput('c-role', 'worker'); setInput('c-rate', '20'); qp.addCrew();
const ot1 = qp._db().crew[0].id;
setInput('j-cust', 'Long Day'); setInput('j-type', 'build'); setInput('j-who', ot1); qp.addJob();
const otj = qp._db().jobs[0].id;
const day = new Date(2026, 9, 21, 8, 0, 0).getTime();
qp._db().timeLogs.push({ id: 'ot-a', jobId: otj, crewId: ot1, start: day, end: day + 6 * 3600e3 });
qp._db().timeLogs.push({ id: 'ot-b', jobId: otj, crewId: ot1, start: day + 6 * 3600e3, end: day + 10 * 3600e3 });
const lab = qp.jobLabor(otj);
ok(lab.regMins === 480 && lab.otMins === 120, 'daily OT split after 8h (got ' + lab.regMins + '/' + lab.otMins + ')');
ok(lab.regPay === 160 && lab.otPay === 60 && lab.total === 220, 'OT pay at 1.5x (got ' + lab.total + ')');
// OT earned across two jobs on the same day splits by hours worked
setInput('j-cust', 'Long Day 2'); setInput('j-type', 'build'); setInput('j-who', ot1); qp.addJob();
const otj2 = qp._db().jobs[1].id;
qp._db().timeLogs.push({ id: 'ot-c', jobId: otj2, crewId: ot1, start: day, end: day + 5 * 3600e3 });
const l1 = qp.jobLabor(otj), l2 = qp.jobLabor(otj2);
ok(l1.otMins === 280 && l2.otMins === 140, 'OT splits across jobs by hours (got ' + l1.otMins + '/' + l2.otMins + ')');
const otTot = qp.crewOtTotals(ot1);
ok(otTot.otMins === 420 && otTot.otPay === 210, 'crewOtTotals aggregates (got ' + otTot.otMins + ')');

// ---- overtime: weekly ----
reset();
setInput('set-otmode', 'weekly'); setInput('set-otrate', '2'); qp.saveSettings();
setInput('c-name', 'OTW'); setInput('c-role', 'worker'); setInput('c-rate', '10'); qp.addCrew();
const otw = qp._db().crew[0].id;
setInput('j-cust', 'Week Job'); setInput('j-type', 'build'); setInput('j-who', otw); qp.addJob();
const otwj = qp._db().jobs[0].id;
const mon = new Date(2026, 9, 19, 8, 0, 0).getTime(); // Monday
for (let d = 0; d < 5; d++) {
  qp._db().timeLogs.push({ id: 'w' + d, jobId: otwj, crewId: otw, start: mon + d * 86400e3, end: mon + d * 86400e3 + 9 * 3600e3 });
}
const wlab = qp.jobLabor(otwj);
ok(wlab.otMins === 300 && wlab.regMins === 2400, 'weekly OT after 40h (got ' + wlab.otMins + ')');
ok(wlab.otPay === 100, 'weekly OT at 2x (got ' + wlab.otPay + ')');
setInput('set-otmode', 'none'); qp.saveSettings();
const nlab = qp.jobLabor(otwj);
ok(nlab.otMins === 0 && nlab.regMins === 2700, 'OT off -> all regular');

// ---- photos ----
reset();
setInput('c-name', 'Ph'); setInput('c-role', 'worker'); setInput('c-rate', '25'); qp.addCrew();
setInput('j-cust', 'Photo Job'); setInput('j-type', 'build'); setInput('j-who', qp._db().crew[0].id); qp.addJob();
const phj = qp._db().jobs[0].id;
ok(qp.pushPhoto(phj, 'data:image/jpeg;base64,AAAA') === true, 'pushPhoto attaches');
ok(qp.photosForJob(phj).length === 1, 'photosForJob returns photo');
alerts.length = 0;
ok(qp.pushPhoto(phj, 'x'.repeat(2000000)) === false && alerts.length === 1, 'pushPhoto rejects oversized');
qp.delPhoto(phj, qp._db().jobs[0].photos[0].id); // confirm() stubbed true
ok(qp.photosForJob(phj).length === 0, 'delPhoto removes');

// ---- integrity ----
reset();
setInput('c-name', 'I1'); setInput('c-role', 'worker'); setInput('c-rate', '25'); qp.addCrew();
setInput('j-cust', 'Int Job'); setInput('j-type', 'build'); setInput('j-who', qp._db().crew[0].id); qp.addJob();
ok(qp.integrityReport().ok, 'integrityReport clean on fresh data');
qp._db().jobs[0].who = 'ghost-crew';
const rep = qp.integrityReport();
ok(!rep.ok && rep.count >= 1 && rep.issues.some(i => i.includes('removed crew')), 'integrityReport flags orphan crew ref');

// ---- crew search/filter ----
reset();
qp.setCrewFilter('', '');
setInput('c-name', 'Alice Worker'); setInput('c-role', 'worker'); setInput('c-rate', '25'); qp.addCrew();
setInput('c-name', 'Bob Quoter'); setInput('c-role', 'quoter'); setInput('c-rate', '25'); qp.addCrew();
ok(qp.filteredCrew().length === 2, 'filteredCrew all');
qp.setCrewFilter('', 'quoter');
ok(qp.filteredCrew().length === 1 && qp.filteredCrew()[0].name === 'Bob Quoter', 'filteredCrew role filter');
qp.setCrewFilter('ali', '');
ok(qp.filteredCrew().length === 1 && qp.filteredCrew()[0].name === 'Alice Worker', 'filteredCrew name search');
qp.setCrewFilter('', '');

// ---- migrate backfills new fields ----
reset();
qp._reset({ crew: [{ id: 'c1', name: 'M', role: 'worker', rate: 25 }], jobs: [{ id: 'j1', cust: 'C', who: 'c1' }] });
qp.migrate();
const m2 = qp._db();
ok(Array.isArray(m2.expenses) && m2.jobs[0].price === 0 && Array.isArray(m2.jobs[0].photos), 'migrate backfills expenses/price/photos');
ok(m2.meta.settings.otMode === 'none', 'migrate backfills settings');

// ---- export/import with expenses, photos, settings ----
reset();
setInput('set-otmode', 'daily'); setInput('set-otrate', '1.5'); qp.saveSettings();
setInput('c-name', 'X1'); setInput('c-role', 'worker'); setInput('c-rate', '25'); qp.addCrew();
setInput('j-cust', 'Full Job'); setInput('j-type', 'build'); setInput('j-who', qp._db().crew[0].id); qp.addJob();
const fj = qp._db().jobs[0].id;
qp.setPrice(fj, '500');
setInput('ex-desc-' + fj, 'Lumber'); setInput('ex-amt-' + fj, '120'); qp.addExpense(fj);
qp.pushPhoto(fj, 'data:image/jpeg;base64,BBBB');
const full = JSON.parse(qp.exportJsonString());
ok(full.expenses.length === 1 && full.meta.settings.otMode === 'daily', 'export carries expenses + settings');
const cfull = qp.validateImport(full);
ok(cfull.expenses.length === 1 && cfull.jobs[0].price === 500 && cfull.jobs[0].photos.length === 1 && cfull.meta.settings.otMode === 'daily', 'validateImport keeps expenses/price/photos/settings');

// ---- invoice ----
reset();
setInput('c-name', 'V1'); setInput('c-role', 'worker'); setInput('c-rate', '25'); qp.addCrew();
setInput('j-cust', 'Invoice Co'); setInput('j-type', 'build'); setInput('j-who', qp._db().crew[0].id); qp.addJob();
const vj = qp._db().jobs[0].id;
qp.setHours(vj, '4'); qp.setPrice(vj, '400');
setInput('ex-desc-' + vj, 'Steel'); setInput('ex-amt-' + vj, '150'); qp.addExpense(vj);
qp.openInvoice(vj);
const invHtml = sandbox.document.getElementById('invoice-root').innerHTML;
ok(invHtml.includes('Invoice Co') && invHtml.includes('Total due') && invHtml.includes('$400.00'), 'openInvoice renders invoice with price total');
qp.closeInvoice();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
