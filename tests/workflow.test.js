import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceSummary, attendanceWorkers, validatePayment } from '../src/workflow-model.js';
import { Store } from '../src/storage.js';

test('pending attendance never counts as an absence or completed work', () => {
  assert.deepEqual(attendanceSummary([{id:'a'},{id:'b'},{id:'c'},{id:'d'}], {a:{status:1},b:{status:.5},c:{status:0}}), {total:4,full:1,half:1,absent:1,pending:1,marked:3});
});
test('suppliers and nonworking contractors do not block the daily attendance review', () => {
  const crew = [{id:'a',tradeId:'labour'},{id:'b',tradeId:'tractor'},{id:'c',tradeId:'labour',isThekedar:true,worksHimself:false},{id:'d',tradeId:'labour',isThekedar:true,worksHimself:true}];
  assert.deepEqual(attendanceWorkers(crew,[{id:'labour'},{id:'tractor',isSupplier:true}]).map(w=>w.id),['a','d']);
});

test('a contractor who also works is included in attendance, while a managing contractor is not', () => {
  const workers = [
    { id: 'working', tradeId: 'mason', role: 'thekedar', isThekedar: true, worksHimself: true },
    { id: 'manager', tradeId: 'mason', role: 'thekedar', isThekedar: true, worksHimself: false },
    { id: 'mistri', tradeId: 'mason', role: 'mistri' },
    { id: 'helper', tradeId: 'mason', role: 'helper' }
  ];
  const eligible = attendanceWorkers(workers, [{ id: 'mason' }]);
  assert.deepEqual(eligible.map(w => w.id), ['working', 'mistri', 'helper']);
});
test('deleted workers and invalid amounts cannot be saved from a stale payment review', () => {
  const valid={amount:100,date:'2026-09-17',targetType:'individual',workerId:'a'};
  assert.equal(validatePayment(valid,[{id:'a'}],[],'2026-09-17'),null);
  assert.equal(validatePayment(valid,[],[],'2026-09-17'),'worker');
  for (const amount of [0,-1,Infinity,'bad']) assert.equal(validatePayment({...valid,amount},[{id:'a'}],[],'2026-09-17'),'amount');
  assert.equal(validatePayment({...valid,date:'2026-09-18'},[{id:'a'}],[],'2026-09-17'),'date');
  for (const date of ['', '2026-02-30', 'yesterday']) assert.equal(validatePayment({...valid,date},[{id:'a'}],[],'2026-09-17'),'date');
});

test('storage failure is visible to workflow even without an alert handler, and retry clears it', () => {
  const store = new Store({persist:false,data:{projects:[],activeProjectId:null}});
  store.persist = true;
  const original = Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  try {
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{setItem(){throw new Error('simulated full storage');}}});
    assert.equal(store.save(),false);
    assert.equal(store.hasUnsavedChanges(),true);
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{setItem(){}}});
    assert.equal(store.save(),true);
    assert.equal(store.hasUnsavedChanges(),false);
  } finally {
    if(original) Object.defineProperty(globalThis,'localStorage',original);
    else delete globalThis.localStorage;
  }
});

test('a trade can be renamed without breaking linked workers', () => {
  const store = new Store({persist:false,data:{activeProjectId:'p',projects:[{id:'p',name:'Site',trades:[{id:'block',name:'Block Builder',icon:'🧱'}],workers:[{id:'w',name:'Ramesh',tradeId:'block'}],transactions:[],haziri:{},haziriMeta:{},diaryNotedDates:{}}]}});
  store.updateTrade('block',{name:'Block Work',icon:'🔨'});
  assert.equal(store.getTrade('block').name,'Block Work');
  assert.equal(store.getWorker('w').tradeId,'block');
});

test('a trade with ledger history cannot be deleted even when it has no current workers', () => {
  const store = new Store({persist:false,data:{activeProjectId:'p',projects:[{id:'p',name:'Site',trades:[{id:'block',name:'Block Builder'}],workers:[],transactions:[{id:'t',tradeId:'block',targetType:'group',amount:100}],haziri:{},haziriMeta:{},diaryNotedDates:{}}]}});
  assert.equal(store.deleteTrade('block').reason,'has_transactions');
  assert.equal(store.getTrades().length,1);
});
test('shared expenses require a valid trade but not an individual worker', () => {
  const draft={amount:500,date:'2026-09-17',targetType:'group',tradeId:'mason'};
  assert.equal(validatePayment(draft,[],[{id:'mason'}],'2026-09-17'),null);
  assert.equal(validatePayment(draft,[],[],'2026-09-17'),'trade');
});
