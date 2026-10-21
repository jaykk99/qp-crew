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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
