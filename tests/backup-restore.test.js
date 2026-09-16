import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/storage.js';

/* The backup file is the only copy of a ledger that survives an uninstall, so
   the one thing it must do is come back. It could not: importData demanded
   top-level workers/trades/transactions, which is the shape the app stopped
   writing when jobs moved inside `projects`. */

function ledgerWithTwoJobs() {
  const store = new Store({
    persist: false,
    data: {
      activeProjectId: 'p1',
      lending: [{ id: 'l1', name: 'Chacha', amount: 5000 }],
      projects: [
        {
          id: 'p1', name: 'घर', icon: '🏠', createdAt: 0,
          trades: [{ id: 'mason', name: 'राजमिस्त्री', icon: 'mason' }],
          workers: [{ id: 'w1', name: 'रमेश', tradeId: 'mason', role: 'mistri', dailyRate: 600, contractType: 'dihadi' }],
          transactions: [{ id: 't1', date: '2026-09-02', workerId: 'w1', type: 'cash', amount: 500 }],
          haziri: { '2026-09-02': { w1: { status: 0, otHours: 0, reason: 'sick' } } },
          haziriMeta: {}, diaryNotedDates: {}
        },
        {
          id: 'p2', name: 'सड़क', icon: '🛣️', createdAt: 0,
          trades: [{ id: 'mason', name: 'राजमिस्त्री', icon: 'mason' }],
          workers: [{ id: 'w2', name: 'सुरेश', tradeId: 'mason', role: 'helper', dailyRate: 500, contractType: 'dihadi' }],
          transactions: [], haziri: {}, haziriMeta: {}, diaryNotedDates: {}
        }
      ]
    }
  });
  return store;
}

test('a backup this app wrote can be restored by this app', () => {
  const saved = ledgerWithTwoJobs().exportData();

  const fresh = new Store({ persist: false, data: { projects: [], activeProjectId: null } });
  assert.equal(fresh.importData(saved), true);

  assert.equal(fresh.data.projects.length, 2);
  assert.equal(fresh.data.projects[1].name, 'सड़क');
  assert.equal(fresh.data.lending.length, 1);

  // Right down to the day and why the worker was away.
  fresh.data.activeProjectId = 'p1';
  assert.equal(fresh.getWorkers()[0].name, 'रमेश');
  assert.equal(fresh.getHaziri('2026-09-02').w1.reason, 'sick');
});

test('a backup from before jobs existed still restores', () => {
  const legacy = JSON.stringify({
    trades: [{ id: 'mason', name: 'राजमिस्त्री', icon: 'mason' }],
    workers: [{ id: 'w1', name: 'रमेश', tradeId: 'mason', role: 'mistri', dailyRate: 600, contractType: 'dihadi' }],
    transactions: [{ id: 't1', date: '2026-09-02', workerId: 'w1', type: 'cash', amount: 500 }],
    haziri: { '2026-09-02': { w1: { status: 1, otHours: 0 } } },
    settings: {}
  });

  const fresh = new Store({ persist: false, data: { projects: [], activeProjectId: null } });
  assert.equal(fresh.importData(legacy), true);
  assert.equal(fresh.data.projects.length, 1);
  assert.equal(fresh.getWorkers()[0].name, 'रमेश');
  assert.equal(fresh.getHaziri('2026-09-02').w1.status, 1);
});

test('anything that is not a ledger is still refused', () => {
  const fresh = new Store({ persist: false, data: { projects: [], activeProjectId: null } });
  assert.equal(fresh.importData('not json at all'), false);
  assert.equal(fresh.importData(JSON.stringify({ hello: 'world' })), false);
  assert.equal(fresh.importData(JSON.stringify({ projects: 'nope' })), false);
});
