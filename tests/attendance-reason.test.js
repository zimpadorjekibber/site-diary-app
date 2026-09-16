import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, ABSENCE_REASONS, absenceReasonLabel } from '../src/storage.js';

const WORKER = 'w1';
const LEGACY_DAY = '2026-09-01';   // marked before `reason` existed
const DAY = '2026-09-02';

/** A ledger holding one absence written the old way: status and otHours, and
 *  no reason key at all. Every assertion about old records reads from this. */
function ledger() {
  return new Store({
    persist: false,
    data: {
      projects: [{
        id: 'p1', name: 'Test', icon: '🏠', createdAt: 0,
        trades: [{ id: 'mason', name: 'राजमिस्त्री', icon: 'mason' }],
        workers: [{ id: WORKER, name: 'रमेश', tradeId: 'mason', role: 'mistri', dailyRate: 600, contractType: 'dihadi' }],
        transactions: [],
        haziri: { [LEGACY_DAY]: { [WORKER]: { status: 0, otHours: 0 } } },
        haziriMeta: {}, diaryNotedDates: {}
      }],
      activeProjectId: 'p1'
    }
  });
}

test('a record written before reasons existed still reads cleanly', () => {
  const store = ledger();
  const old = store.getHaziri(LEGACY_DAY)[WORKER];

  assert.equal(old.status, 0);
  assert.equal(old.reason, undefined);
  assert.equal(absenceReasonLabel(old.reason), '');

  // And it still counts as the absence it always was.
  const row = store.getMonthlyHaziri(2026, 9).rows.find(r => r.worker.id === WORKER);
  assert.equal(row.totalAbsent, 1);
  assert.equal(row.dailyStatuses[LEGACY_DAY].reason, undefined);
});

test('an absence keeps the reason it was given, quick or typed', () => {
  const store = ledger();

  store.setWorkerHaziri(DAY, WORKER, 0, 0, 'sick');
  assert.equal(store.getHaziri(DAY)[WORKER].reason, 'sick');
  assert.equal(absenceReasonLabel('sick', 'hi'), 'बीमार');
  assert.equal(absenceReasonLabel('sick', 'en'), 'Sick');

  // Anything not on the picklist is somebody's own words: stored as typed,
  // trimmed, and handed straight back by the label lookup.
  store.setWorkerHaziri(DAY, WORKER, 0, 0, '  gaon gaya hai  ');
  assert.equal(store.getHaziri(DAY)[WORKER].reason, 'gaon gaya hai');
  assert.equal(absenceReasonLabel('gaon gaya hai', 'en'), 'gaon gaya hai');

  // Every quick reason survives the round trip and reads in both languages.
  for (const reason of ABSENCE_REASONS) {
    store.setWorkerHaziri(DAY, WORKER, 0, 0, reason.id);
    assert.equal(store.getHaziri(DAY)[WORKER].reason, reason.id);
    assert.equal(absenceReasonLabel(reason.id, 'hi'), reason.hi);
    assert.equal(absenceReasonLabel(reason.id, 'en'), reason.en);
  }
});

test('the reason stays optional and never outlives the absence', () => {
  const store = ledger();

  // Skipped: no key at all, so the record looks exactly like an old one.
  store.setWorkerHaziri(DAY, WORKER, 0, 0);
  assert.equal('reason' in store.getHaziri(DAY)[WORKER], false);

  // A worker who turned up has nothing to explain, even if a reason is passed.
  store.setWorkerHaziri(DAY, WORKER, 0, 0, 'sick');
  store.setWorkerHaziri(DAY, WORKER, 1, 0, 'sick');
  assert.equal('reason' in store.getHaziri(DAY)[WORKER], false);
  store.setWorkerHaziri(DAY, WORKER, 0.5, 0, 'sick');
  assert.equal('reason' in store.getHaziri(DAY)[WORKER], false);

  // Absent again, then cleared by picking the blank option.
  store.setWorkerHaziri(DAY, WORKER, 0, 0, 'sick');
  store.setWorkerHaziri(DAY, WORKER, 0, 0, '');
  assert.equal('reason' in store.getHaziri(DAY)[WORKER], false);
});

test('a runaway reason is cut to something a register column can hold', () => {
  const store = ledger();
  store.setWorkerHaziri(DAY, WORKER, 0, 0, 'x'.repeat(500));
  assert.equal(store.getHaziri(DAY)[WORKER].reason.length, 60);
});

test('the muster roll and the worker\'s own history carry the reason', () => {
  const store = ledger();
  store.setWorkerHaziri(DAY, WORKER, 0, 0, 'family_work');

  const row = store.getMonthlyHaziri(2026, 9).rows.find(r => r.worker.id === WORKER);
  assert.equal(row.totalAbsent, 2);
  assert.equal(row.dailyStatuses[DAY].reason, 'family_work');
  assert.equal(row.dailyStatuses[LEGACY_DAY].reason, undefined);

  const history = store.getWorkerHaziriHistory(WORKER);
  assert.equal(history.find(h => h.date === DAY).reason, 'family_work');
  assert.equal(history.find(h => h.date === LEGACY_DAY).reason, '');
});
