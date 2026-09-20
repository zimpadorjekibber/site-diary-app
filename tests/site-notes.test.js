import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/storage.js';

const DAY = '2026-09-18';
const NEXT_DAY = '2026-09-19';

/** A job with nothing in it but the trades — the state a site note is usually
 *  written in, since a note needs neither workers nor money to exist. */
function ledger(project = {}) {
  return new Store({
    persist: false,
    data: {
      projects: [{
        id: 'p1', name: 'Test', icon: '🏠', createdAt: 0,
        trades: [
          { id: 'mason', name: 'राजमिस्त्री', icon: 'mason' },
          { id: 'carpenter', name: 'बढ़ई', icon: 'carpenter' }
        ],
        workers: [],
        transactions: [],
        haziri: {}, haziriMeta: {}, diaryNotedDates: {},
        ...project
      }],
      activeProjectId: 'p1'
    }
  });
}

test('a note is kept exactly as it was written, in whatever language', () => {
  const store = ledger();
  const text = '2:15 PM light chali gayi, kaam nahi ho raha';
  const note = store.addSiteNote({ date: DAY, text });

  assert.equal(note.text, text);
  assert.equal(note.date, DAY);
  assert.equal(store.getSiteNotes(DAY)[0].text, text);

  // Hindi, English or both — nothing here interprets the words.
  store.addSiteNote({ date: DAY, text: 'बारिश दोपहर तक' });
  assert.equal(store.getSiteNotes(DAY)[0].text, 'बारिश दोपहर तक');
});

test('a note carries a time and a createdAt, and never an undefined field', () => {
  const store = ledger();
  const before = Date.now();
  const note = store.addSiteNote({ text: 'inspector aaya tha' });

  assert.ok(note.createdAt >= before);
  assert.ok(note.time);
  // Firestore rejects a document with undefined anywhere in it, which fails the
  // whole backup silently — an untagged note must store null, not nothing.
  assert.equal(note.tradeId, null);
  for (const value of Object.values(note)) assert.notEqual(value, undefined);
});

test('a note belongs to one day, and reads newest first', () => {
  const store = ledger();
  store.addSiteNote({ date: DAY, text: 'pehla' });
  store.addSiteNote({ date: DAY, text: 'doosra' });
  store.addSiteNote({ date: NEXT_DAY, text: 'agle din ka' });

  assert.deepEqual(store.getSiteNotes(DAY).map(n => n.text), ['doosra', 'pehla']);
  assert.deepEqual(store.getSiteNotes(NEXT_DAY).map(n => n.text), ['agle din ka']);
  // No date asked for means every note in this job.
  assert.equal(store.getSiteNotes().length, 3);
});

test('a note can name one work group, and usually does not', () => {
  const store = ledger();
  const tagged = store.addSiteNote({ date: DAY, text: 'mistri log jaldi gaye', tradeId: 'mason' });
  const plain = store.addSiteNote({ date: DAY, text: 'paani nahi aaya' });

  assert.equal(tagged.tradeId, 'mason');
  assert.equal(plain.tradeId, null);
});

test('a note can be written against one worker on one day', () => {
  const store = ledger();
  const onWeld = store.addSiteNote({ date: DAY, text: 'jaldi chala gaya', workerId: 'w1' });
  store.addSiteNote({ date: DAY, text: 'paani nahi aaya' });            // about the site
  store.addSiteNote({ date: NEXT_DAY, text: 'aaj theek tha', workerId: 'w1' });

  assert.equal(onWeld.workerId, 'w1');
  assert.deepEqual(store.getWorkerSiteNotes(DAY, 'w1').map(n => n.text), ['jaldi chala gaya']);
  // Another day's note about the same man does not leak into this one.
  assert.deepEqual(store.getWorkerSiteNotes(NEXT_DAY, 'w1').map(n => n.text), ['aaj theek tha']);
  assert.deepEqual(store.getWorkerSiteNotes(DAY, 'w2'), []);

  // The day still shows both — the man's note and the site's.
  assert.equal(store.getSiteNotes(DAY).length, 2);
});

test('a site note names no worker, and never undefined', () => {
  const store = ledger();
  const note = store.addSiteNote({ date: DAY, text: 'barish thi' });
  assert.equal(note.workerId, null);
  for (const value of Object.values(note)) assert.notEqual(value, undefined);
});

test('an empty note is refused rather than written as a blank line', () => {
  const store = ledger();
  assert.throws(() => store.addSiteNote({ date: DAY, text: '' }));
  assert.throws(() => store.addSiteNote({ date: DAY, text: '   ' }));
  assert.throws(() => store.addSiteNote({ date: DAY }));
  assert.equal(store.getSiteNotes(DAY).length, 0);
});

test('a note is trimmed, and a runaway one is cut to a length the slip can hold', () => {
  const store = ledger();
  assert.equal(store.addSiteNote({ date: DAY, text: '  light gayi  ' }).text, 'light gayi');
  assert.equal(store.addSiteNote({ date: DAY, text: 'x'.repeat(2000) }).text.length, 500);
});

test('a note can be corrected, and removed', () => {
  const store = ledger();
  const note = store.addSiteNote({ date: DAY, text: 'light gayi 2 baje' });

  const fixed = store.updateSiteNote(note.id, { text: 'light gayi 2:15 baje', tradeId: 'carpenter' });
  assert.equal(fixed.text, 'light gayi 2:15 baje');
  assert.equal(fixed.tradeId, 'carpenter');
  assert.equal(fixed.createdAt, note.createdAt);   // still the same note
  // Correcting it to nothing would leave a blank line on the diary.
  assert.throws(() => store.updateSiteNote(note.id, { text: '  ' }));
  assert.equal(store.updateSiteNote('note_nope', { text: 'x' }), null);

  assert.equal(store.deleteSiteNote(note.id), true);
  assert.equal(store.deleteSiteNote(note.id), false);
  assert.equal(store.getSiteNotes(DAY).length, 0);
});

test('a job written before site notes existed still reads and writes cleanly', () => {
  // normalise() is what a cloud payload goes through; none of those payloads
  // have siteNotes yet, and reading one must not throw or lose the notes added
  // afterwards.
  const store = ledger();
  assert.deepEqual(store.getSiteNotes(DAY), []);
  assert.deepEqual(store.getSiteNotes(), []);

  store.addSiteNote({ date: DAY, text: 'pehla note' });
  assert.equal(store.getSiteNotes(DAY).length, 1);
});

test('notes stay with the job they were written on', () => {
  const store = ledger();
  store.addSiteNote({ date: DAY, text: 'ghar ka note' });

  const second = store.addProject('नहर');
  assert.deepEqual(store.getSiteNotes(), []);

  store.addSiteNote({ date: DAY, text: 'nahar ka note' });
  assert.deepEqual(store.getSiteNotes().map(n => n.text), ['nahar ka note']);

  store.setActiveProject('p1');
  assert.deepEqual(store.getSiteNotes().map(n => n.text), ['ghar ka note']);
  assert.equal(second.siteNotes.length, 1);
});

test('erasing a job clears its notes along with the rest of its ledger', () => {
  const store = ledger();
  store.addSiteNote({ date: DAY, text: 'purana note' });
  store.eraseAll();
  assert.deepEqual(store.getSiteNotes(), []);
});
