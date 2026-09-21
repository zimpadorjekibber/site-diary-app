// src/firebase-lazy.js
// The Firebase SDK is ~400 kB of the bundle and most of a contractor's day never
// touches it. Loading it up front cost several seconds on a rural 3G connection
// before the attendance screen appeared, so it is fetched on first actual use
// and the app boots without it.

let modulePromise = null;
let ready = false;

function load() {
  if (!modulePromise) modulePromise = import('./firebase.js');
  return modulePromise;
}

// Synchronous, because callers use it to decide whether to bother syncing at all.
// Mirrors the real module's state once it has loaded.
export function isFirebaseReady() {
  return ready;
}

export async function initFirebase(config) {
  if (!config || !config.apiKey || !config.projectId) return false;
  const m = await load();
  const ok = m.initFirebase(config);
  ready = ok && m.isFirebaseReady();
  return ok;
}

export async function saveToFirebase(siteId, data, deviceId) {
  const m = await load();
  return m.saveToFirebase(siteId, data, deviceId);
}

export async function loadFromFirebase(siteId) {
  const m = await load();
  return m.loadFromFirebase(siteId);
}

export async function enableRealtimeSync(siteId, onDataUpdated) {
  const m = await load();
  return m.enableRealtimeSync(siteId, onDataUpdated);
}

export async function disableRealtimeSync() {
  if (!modulePromise) return;
  const m = await load();
  return m.disableRealtimeSync();
}

// Pure string parsing with no SDK dependency, but it lives in firebase.js, so
// loading the module here also warms it for the connect flow that follows.
export async function parseFirebaseConfig(input) {
  const m = await load();
  return m.parseFirebaseConfig(input);
}

/* Sign-in goes through the same lazy door as everything else: a contractor who
   never signs in should never pay for the auth code, and most days nobody does
   — the account is asked for once, on a new phone. */
export async function signInWithGoogle() {
  const m = await load();
  cachedUser = await m.signInWithGoogle();
  return cachedUser;
}

export async function signOutUser() {
  const m = await load();
  await m.signOutUser();
  cachedUser = null;
  return true;
}

export async function claimSite(siteId, uid) {
  const m = await load();
  return m.claimSite(siteId, uid);
}

export async function listMySites(uid) {
  const m = await load();
  return m.listMySites(uid);
}

/* The signed-in user, kept here as a plain value.

   Renders need it synchronously — the settings screen draws long before the
   SDK has loaded — and a promise cannot answer a render. So the answer is
   cached whenever auth settles, and `currentUser()` reads the cache. Before
   the first answer arrives it is null, which is exactly what an unsigned app
   should draw. */
let cachedUser = null;

export function currentUser() {
  return cachedUser;
}

export async function getCurrentUser() {
  if (!modulePromise) return cachedUser;
  const m = await load();
  cachedUser = m.currentUser();
  return cachedUser;
}

export async function onAuthChanged(handler) {
  const m = await load();
  return m.onAuthChanged(user => {
    cachedUser = user;
    handler(user);
  });
}
