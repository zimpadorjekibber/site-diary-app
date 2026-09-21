import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/storage.js';

const DAY = '2026-09-21';

/** A site with one crew, which is all a day needs to be opened and closed. */
function site() {
  return new Store({
    persist: false,
    data: {
      projects: [{
        id: 'p1', name: 'Test', icon: '🏠', createdAt: 0,
        trades: [{ id: 'welder', name: 'वेल्डर', icon: 'welder' }],
        workers: [
          { id: 'w1', name: 'Ramesh', tradeId: 'welder', dailyRate: 600 },
          { id: 'w2', name: 'Suresh', tradeId: 'welder', dailyRate: 600 }
        ],
        transactions: [], haziri: {}, haziriMeta: {}, diaryNotedDates: {}, siteNotes: []
      }],
      activeProjectId: 'p1'
    }
  });
}

test('a day nobody has marked cannot be closed', () => {
  const store = site();
  assert.equal(store.submitHaziri(DAY), null);
  assert.equal(store.getHaziriSubmission(DAY), null);
});

test('a marked day stays open until it is submitted, and then says when', () => {
  const store = site();
  store.setWorkerHaziri(DAY, 'w1', 1);
  assert.equal(store.getHaziriSubmission(DAY), null);   // marked is not finished

  const before = Date.now();
  assert.ok(store.submitHaziri(DAY));
  const done = store.getHaziriSubmission(DAY);
  assert.ok(done.submittedAt >= before);
  assert.ok(done.timeLabel);
});

test('a man who falls ill after lunch can be changed, and that reopens the day', () => {
  const store = site();
  // Morning: both men are on site.
  store.setWorkerHaziri(DAY, 'w1', 1);
  store.setWorkerHaziri(DAY, 'w2', 1);
  store.submitHaziri(DAY);
  assert.ok(store.getHaziriSubmission(DAY));

  // After lunch one goes home sick — half a day, and the evening is not signed
  // off on a figure that is no longer true.
  store.setWorkerHaziri(DAY, 'w2', 0.5);
  assert.equal(store.getHaziri(DAY).w2.status, 0.5);
  assert.equal(store.getHaziriSubmission(DAY), null);

  store.submitHaziri(DAY);
  assert.ok(store.getHaziriSubmission(DAY));
});

test('closing one day leaves every other day open', () => {
  const store = site();
  store.setWorkerHaziri(DAY, 'w1', 1);
  store.setWorkerHaziri('2026-09-22', 'w1', 1);
  store.submitHaziri(DAY);

  assert.ok(store.getHaziriSubmission(DAY));
  assert.equal(store.getHaziriSubmission('2026-09-22'), null);
});

test('submitting does not disturb the marks, the reasons or the saved-at stamp', () => {
  const store = site();
  store.setWorkerHaziri(DAY, 'w1', 1, 2);
  store.setWorkerHaziri(DAY, 'w2', 0, 0, 'light nahi aayi');
  const savedAt = store.getHaziriSavedAt(DAY).savedAt;

  store.submitHaziri(DAY);
  assert.deepEqual(store.getHaziri(DAY).w1, { status: 1, otHours: 2 });
  assert.equal(store.getHaziri(DAY).w2.reason, 'light nahi aayi');
  assert.equal(store.getHaziriSavedAt(DAY).savedAt, savedAt);
});

test('a whole group can be put down absent for one reason, with the note filed under that group', () => {
  // What the "welder group: all absent" action does, one store call per man
  // plus the single note that explains the row on the diary.
  const store = site();
  const why = 'light nahi aayi';
  store.getWorkers('welder').forEach(w => store.setWorkerHaziri(DAY, w.id, 0, 0, why));
  store.addSiteNote({ date: DAY, tradeId: 'welder', text: `वेल्डर ग्रुप गैरहाजिर — ${why}` });

  const records = store.getHaziri(DAY);
  assert.deepEqual(Object.values(records).map(r => r.status), [0, 0]);
  assert.deepEqual(Object.values(records).map(r => r.reason), [why, why]);

  // One note, and it names the group — not two untagged lines about the light.
  const notes = store.getSiteNotes(DAY);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].tradeId, 'welder');
  assert.equal(notes[0].workerId, null);
});
