import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSyncPayload } from '../src/firebase.js';

/* The rules require a ledger to arrive already owned, so the payload is the
   gate every new user passes through. Get this wrong and nobody can create a
   ledger at all — which is invisible on a phone whose ledger already exists. */

const ledger = { projects: [{ id: 'p1', workers: [] }], activeProjectId: 'p1', lending: [], settings: {} };

test('a signed-in write carries its owner, so the ledger is owned from birth', () => {
  const payload = buildSyncPayload(ledger, 'dev-1', 'uid-abc');
  assert.equal(payload.ownerUid, 'uid-abc');
});

test('a signed-out write omits the field rather than sending null', () => {
  // Firestore rejects undefined outright, and null would read as a ledger
  // that had been disowned — neither is "we do not know yet".
  const payload = buildSyncPayload(ledger, 'dev-1', null);
  assert.equal('ownerUid' in payload, false);
  for (const value of Object.values(payload)) assert.notEqual(value, undefined);
});

test('the payload carries only the keys the security rules accept', () => {
  // hasOnly() in firestore.rules refuses a write with any other key, and the
  // refusal arrives as a bare permission error with nothing to point at.
  const allowed = ['projects', 'activeProjectId', 'lending', 'settings',
                   'lastWriterDeviceId', 'updatedAt', 'timestamp', 'ownerUid'];
  for (const uid of ['uid-abc', null]) {
    for (const key of Object.keys(buildSyncPayload(ledger, 'dev-1', uid))) {
      assert.ok(allowed.includes(key), `key "${key}" is not allowed by the rules`);
    }
  }
});

test('the ledger itself is passed through untouched', () => {
  const payload = buildSyncPayload(ledger, 'dev-1', 'uid-abc');
  assert.deepEqual(payload.projects, ledger.projects);
  assert.equal(payload.activeProjectId, 'p1');
  assert.equal(payload.lastWriterDeviceId, 'dev-1');
});
