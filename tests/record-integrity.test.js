import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/storage.js';
import { transactionRecipients } from '../src/workflow-model.js';

test('editing a past payment keeps its recipient after archiving or changing trades', () => {
  const workers=[{id:'old',name:'Former worker',tradeId:'painter',archivedAt:1},{id:'other',name:'Active worker',tradeId:'mason'}];
  const choices=transactionRecipients(workers,'mason',{workerId:'old',tradeId:'mason'});
  assert.equal(choices.find(w=>w.id==='old').name,'Former worker');
  assert.equal(transactionRecipients(workers,'painter',{workerId:'other'})[0].id,'other');
  assert.equal(transactionRecipients(workers,'mason',{workerId:'removed',workerName:'Saved name'}).find(w=>w.id==='removed').name,'Saved name');
  assert.equal(transactionRecipients(workers,'mason',{workerId:'other'}).some(w=>w.id==='old'),false);
});

function ledger() {
  return new Store({persist:false, data:{projects:[{
    id:'job', name:'Test job', trades:[{id:'mason',name:'Mason'},{id:'painter',name:'Painter'}],
    workers:[{id:'w',name:'Test worker',tradeId:'mason',dailyRate:600,contractType:'dihadi'}],
    transactions:[{id:'paid',date:'2026-09-20',workerId:'w',tradeId:'mason',targetType:'individual',type:'cash',amount:200}],
    haziri:{'2026-09-20':{w:{status:1,otHours:2}}}, haziriMeta:{},diaryNotedDates:{},siteNotes:[]
  }],activeProjectId:'job'}});
}

test('changing rates preserves legacy attendance and uses the new rate for a new day', () => {
  const s = ledger();
  assert.equal(s.getWorkerLedger('w').totalEarned, 750);
  s.updateWorker('w',{dailyRate:800});
  assert.equal(s.getWorkerLedger('w').totalEarned, 750);
  s.setWorkerHaziri('2026-09-21','w',1,1);
  assert.equal(s.getWorkerLedger('w').totalEarned, 1650);
  assert.equal(s.getMonthlyHaziri(2026,9).rows[0].totalEarnedMonth, 1650);
  s.setWorkerHaziri('2026-09-20','w',.5,0);
  assert.equal(s.getWorkerHaziriHistory('w').find(r=>r.date==='2026-09-20').earned,300);
});

test('failed writes leave payment recovery and worker archive unchanged', () => {
  const s=ledger();
  s.save=()=>false;
  assert.equal(s.deleteTransaction('paid'),false);
  assert.equal(s.getTransaction('paid').amount,200);
  assert.equal(s.getDeletedTransactions().length,0);
  assert.equal(s.archiveWorker('w'),false);
  assert.equal(s.getWorkers().length,1);
  s.save=()=>true;
  s.deleteTransaction('paid'); s.archiveWorker('w');
  s.save=()=>false;
  assert.equal(s.restoreTransaction('paid'),false);
  assert.equal(s.getTransaction('paid'),null);
  assert.equal(s.getDeletedTransactions().length,1);
  assert.equal(s.restoreWorker('w'),false);
  assert.equal(s.getWorkers().length,0);
});

test('changing trade leaves previous payments in the original trade', () => {
  const s=ledger();
  s.getTransactions().push({id:'old',workerId:'w',amount:100,date:'2026-09-19',type:'cash',targetType:'individual'});
  s.updateWorker('w',{tradeId:'painter'});
  assert.equal(s.getTransaction('paid').tradeId,'mason');
  assert.equal(s.getTransaction('old').tradeId,'mason');
  assert.equal(s.getWorker('w').tradeId,'painter');
});

test('trades referenced by archived workers or recoverable entries cannot be removed', () => {
  const s=ledger();
  s.archiveWorker('w');
  assert.equal(s.deleteTrade('mason').reason,'has_workers');
  s.addTransaction({date:'2026-09-20',tradeId:'painter',targetType:'group',type:'ration',amount:100});
  const tx=s.getTransactions().find(t=>t.tradeId==='painter');
  s.deleteTransaction(tx.id);
  assert.equal(s.deleteTrade('painter').reason,'has_transactions');
  assert.equal(s.restoreTransaction(tx.id),true);
  assert.equal(s.getTrade('painter').name,'Painter');
});

test('archiving hides a worker from active attendance without losing the account or monthly history', () => {
  const s=ledger();
  s.archiveWorker('w');
  assert.equal(s.getWorkers().length,0);
  assert.equal(s.getWorkers(null,true).length,1);
  assert.equal(s.getWorkerLedger('w').balanceDue,550);
  assert.equal(s.getHaziri('2026-09-20').w.status,1);
  assert.equal(s.getMonthlyHaziri(2026,9).rows.length,1);
  assert.equal(s.getMonthlyHaziri(2026,10).rows.length,0);
  s.addTransaction({date:'2026-10-01',workerId:'w',tradeId:'mason',targetType:'individual',type:'cash',amount:100});
  assert.equal(s.getMonthlyHaziri(2026,10).rows[0].totalPaidMonth,100);
  s.restoreWorker('w');
  assert.equal(s.getWorkers().length,1);
});

test('deleted payments can be restored exactly once and survive backup/restore', () => {
  const s=ledger();
  s.deleteTransaction('paid');
  assert.equal(s.getWorkerLedger('w').totalIndividualGiven,0);
  assert.equal(s.getDeletedTransactions().length,1);
  const restored=ledger();
  assert.equal(restored.importData(s.exportData()),true);
  assert.equal(restored.restoreTransaction('paid'),true);
  assert.equal(restored.restoreTransaction('paid'),false);
  assert.equal(restored.getDeletedTransactions().length,0);
  assert.equal(restored.getWorkerLedger('w').totalIndividualGiven,200);
  assert.equal(restored.getTransaction('paid').deletedAt,undefined);
});

test('changing the overtime divisor does not recalculate old overtime', () => {
  const s=ledger();
  s.updateSettings({otHoursPerDay:10});
  assert.equal(s.getWorkerLedger('w').totalEarned,750);
  s.setWorkerHaziri('2026-09-21','w',1,2);
  assert.equal(s.getWorkerLedger('w').totalEarned,1470);
});
