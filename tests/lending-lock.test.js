import test from 'node:test';
import assert from 'node:assert/strict';
import { LendingLock, passwordHash } from '../src/lending-lock.js';

const KEY = 'site_diary_lending_lock_v1';

// Minimal DOM adapter: exercise the actual form handlers and async password
// checks without writing test credentials into a user's browser storage.
class Dialog extends EventTarget {
  constructor() {
    super();
    this.fields = new Map();
    for (const selector of ['form', '[type="button"]', '[type="submit"]', '[role="alert"]', '#lendingNewPassword', '#lendingConfirmPassword', '#lendingCurrentPassword']) {
      this.fields.set(selector, { value: '', disabled: false, textContent: '', reset() {} });
    }
  }
  setAttribute() {}
  querySelector(selector) { return this.fields.get(selector); }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
  remove() {}
}

function environment(t) {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  t.mock.method(globalThis, 'setTimeout', callback => ({ callback }));
  t.mock.method(globalThis, 'clearTimeout', () => {});
  const previous = { document: globalThis.document, localStorage: globalThis.localStorage, alert: globalThis.alert };
  globalThis.document = { createElement: () => new Dialog(), body: { append() {} } };
  globalThis.localStorage = storage;
  globalThis.alert = () => {};
  t.after(() => Object.assign(globalThis, previous));
  let lockCalls = 0;
  const lock = new LendingLock(() => lockCalls++);
  return { lock, values, storage, lockCalls: () => lockCalls };
}

async function submit(lock, { password = '', next = '', confirm = next } = {}) {
  const dialog = lock.dialog;
  dialog.querySelector('#lendingCurrentPassword').value = password;
  dialog.querySelector('#lendingNewPassword').value = next;
  dialog.querySelector('#lendingConfirmPassword').value = confirm;
  await dialog.querySelector('form').onsubmit({ preventDefault() {} });
  return dialog.querySelector('[role="alert"]').textContent;
}

test('setup confirms password, stores a salted hash, and a fresh session starts locked', async t => {
  const { lock, values } = environment(t);
  const request = lock.request();
  assert.ok(await submit(lock, { next: 'sample-password', confirm: 'different' }));
  assert.equal(lock.unlocked, false);
  assert.equal(values.has(KEY), false);
  assert.equal(await submit(lock, { next: 'sample-password' }), '');
  assert.equal(await request, true);
  assert.equal(lock.unlocked, true);
  assert.ok(!values.get(KEY).includes('sample-password'));
  const saved = JSON.parse(values.get(KEY));
  assert.equal(saved.salt.length, 16);
  assert.equal(saved.hash, await passwordHash('sample-password', saved.salt));
  assert.equal(new LendingLock(() => {}).unlocked, false);
});

test('wrong passwords fail and the fifth failure imposes a persisted cooldown', async t => {
  const { lock, values } = environment(t);
  const setup = lock.request();
  await submit(lock, { next: 'sample-password' });
  await setup;
  lock.lock();
  const request = lock.request();
  for (let i = 0; i < 5; i++) {
    assert.ok(await submit(lock, { password: 'incorrect' }));
    assert.equal(lock.unlocked, false);
  }
  assert.ok(JSON.parse(values.get(`${KEY}_attempts`)).until > Date.now());
  assert.ok(await submit(lock, { password: 'sample-password' }));
  assert.equal(lock.unlocked, false);
  lock.dialog.close();
  assert.equal(await request, false);
});

test('changing the password requires the old one, rejects it afterwards, and unlocks with the new one', async t => {
  const { lock } = environment(t);
  const setup = lock.request();
  await submit(lock, { next: 'old-password' });
  await setup;
  const change = lock.request({ change: true });
  assert.ok(await submit(lock, { password: 'wrong-old', next: 'new-password' }));
  await submit(lock, { password: 'old-password', next: 'new-password' });
  assert.equal(await change, true);
  lock.lock();
  const unlock = lock.request();
  assert.ok(await submit(lock, { password: 'old-password' }));
  assert.equal(lock.unlocked, false);
  await submit(lock, { password: 'new-password' });
  assert.equal(await unlock, true);
});

test('inactivity locks and an in-flight password check cannot unlock after leaving the screen', async t => {
  const { lock, lockCalls } = environment(t);
  const setup = lock.request();
  await submit(lock, { next: 'sample-password' });
  await setup;
  lock.timer.callback();
  assert.equal(lock.unlocked, false);
  assert.equal(lockCalls(), 1);
  const request = lock.request();
  const check = submit(lock, { password: 'sample-password' });
  lock.lock();
  await check;
  assert.equal(await request, false);
  assert.equal(lock.unlocked, false);
});

test('corrupt lock settings and storage write failure never expose the register', async t => {
  const { lock, values, storage } = environment(t);
  values.set(KEY, 'null');
  assert.equal(await lock.request(), false);
  assert.equal(lock.unlocked, false);
  values.delete(KEY);
  const request = lock.request();
  storage.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
  assert.ok(await submit(lock, { next: 'sample-password' }));
  assert.equal(lock.unlocked, false);
  lock.dialog.close();
  assert.equal(await request, false);
});
