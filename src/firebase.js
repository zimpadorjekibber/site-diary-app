// src/firebase.js
// Firebase Cloud Firestore integration for Shram & Site Diary

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider, signInWithCredential, signOut as authSignOut, onAuthStateChanged } from 'firebase/auth';
import { Capacitor } from '@capacitor/core';

export function parseFirebaseConfig(input) {
  if (!input || typeof input !== 'string') throw new Error('इनपुट खाली है');

  let trimmed = input.trim();

  // Try parsing as strict JSON first
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && parsed.apiKey) return parsed;
  } catch {}

  // If user pasted `<script>...` or `const firebaseConfig = { ... };`
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    trimmed = trimmed.substring(firstBrace, lastBrace + 1);
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && parsed.apiKey) return parsed;
  } catch {}

  // Regex parser for a JS object literal with unquoted keys. This is deliberately
  // the last resort: the previous version fell through to `new Function(...)`,
  // which executed whatever the user pasted.
  const config = {};
  const regex = /([a-zA-Z0-9_]+)\s*:\s*["']([^"']+)["']/g;
  let match;
  while ((match = regex.exec(trimmed)) !== null) {
    config[match[1]] = match[2];
  }

  if (config.apiKey && config.projectId) {
    return config;
  }

  throw new Error('Firebase Config में apiKey या projectId नहीं मिला। कृपया Firebase से कॉपी किया गया पूरा कोड पेस्ट करें।');
}

let app = null;
let db = null;
let unsubscribeRealtime = null;

const NOT_CONNECTED = 'Firebase कनेक्ट नहीं है';

export function initFirebase(config) {
  if (!config || !config.apiKey || !config.projectId) {
    return false;
  }
  try {
    if (getApps().length > 0) {
      app = getApp();
    } else {
      app = initializeApp(config);
    }
    db = getFirestore(app);
    return true;
  } catch (err) {
    console.error('Firebase initialization error:', err);
    return false;
  }
}

export function isFirebaseReady() {
  return !!db;
}

function cleanId(siteId) {
  return String(siteId || 'default_site').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Firestore rejects a document over 1 MiB. Worker photos and voice clips are
// stored inline as base64, so a busy site crosses that line — and the old code
// only logged the rejection to the console, leaving the user believing their
// backup was running.
const FIRESTORE_DOC_LIMIT = 1024 * 1024;

export function buildSyncPayload(data, deviceId) {
  const settings = data.settings || {};
  return {
    // Every job the contractor is running, each with its own ledger.
    projects: data.projects || [],
    activeProjectId: data.activeProjectId || null,
    // Lending is personal and shared across jobs, so it sits outside projects.
    lending: data.lending || [],
    settings: {
      eveningReminderTime: settings.eveningReminderTime || '19:30',
      reminderEnabled: settings.reminderEnabled !== false,
      soundEnabled: settings.soundEnabled !== false,
      // Was hardcoded to a mojibake '?', which overwrote the rupee sign on sync.
      currency: settings.currency || '₹',
      language: settings.language || 'hi-IN',
      otHoursPerDay: settings.otHoursPerDay || 8
    },
    // Identifies the writer so a device can ignore the echo of its own write.
    lastWriterDeviceId: deviceId || null,
    updatedAt: new Date().toISOString(),
    timestamp: Date.now()
  };
}

export async function saveToFirebase(siteId = 'default_site', data, deviceId = null) {
  if (!db) throw new Error(NOT_CONNECTED);

  const payload = buildSyncPayload(data, deviceId);

  const approxSize = new Blob([JSON.stringify(payload)]).size;
  if (approxSize > FIRESTORE_DOC_LIMIT) {
    const mb = (approxSize / (1024 * 1024)).toFixed(2);
    throw new Error(
      `डेटा बहुत बड़ा है (${mb} MB) — Firebase की सीमा 1 MB है। ` +
      `सेटिंग्स में जाकर पुरानी आवाज़ रिकॉर्डिंग व फ़ोटो हटाएँ, या JSON बैकअप फ़ाइल डाउनलोड करें।`
    );
  }

  await setDoc(doc(db, 'site_diaries', cleanId(siteId)), payload, { merge: true });
  return true;
}

export async function loadFromFirebase(siteId = 'default_site') {
  if (!db) throw new Error(NOT_CONNECTED);

  const snap = await getDoc(doc(db, 'site_diaries', cleanId(siteId)));
  if (!snap.exists()) {
    throw new Error('इस साइट आईडी पर क्लाउड में कोई डेटा नहीं मिला।');
  }
  return snap.data();
}

export function enableRealtimeSync(siteId = 'default_site', onDataUpdated) {
  if (!db) return null;
  if (unsubscribeRealtime) {
    unsubscribeRealtime();
    unsubscribeRealtime = null;
  }

  unsubscribeRealtime = onSnapshot(doc(db, 'site_diaries', cleanId(siteId)), (docSnap) => {
    if (docSnap.exists() && onDataUpdated) {
      onDataUpdated(docSnap.data(), { fromCache: docSnap.metadata.hasPendingWrites });
    }
  }, (err) => {
    console.error('Firebase realtime error:', err);
  });

  return unsubscribeRealtime;
}

export function disableRealtimeSync() {
  if (unsubscribeRealtime) {
    unsubscribeRealtime();
    unsubscribeRealtime = null;
  }
}

/* ===================================================
   SIGNING IN

   The site id was the account: an unguessable code that had to be copied by
   hand to reach the same ledger from another phone, and whose loss was the
   loss of the ledger. That is the plumbing a normal app hides behind a login,
   and this is that login.

   Two sign-ins happen, not one. The native plugin talks to Google Play
   Services, which is what makes the account picker look like every other
   Android app; but the Firestore calls in this file go through the JS SDK,
   and the JS SDK has its own idea of who is signed in. If only the native
   half ran, every write would still arrive at the rules as an anonymous
   request and `request.auth` would be null. So on a device the returned
   credential is handed to the JS SDK as well. On the web the plugin already
   drives the JS SDK, and signing in twice there would throw.
=================================================== */

export async function signInWithGoogle() {
  if (!app) throw new Error(NOT_CONNECTED);
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
  const result = await FirebaseAuthentication.signInWithGoogle();

  if (Capacitor.isNativePlatform()) {
    const idToken = result.credential && result.credential.idToken;
    if (!idToken) throw new Error('Google से पहचान नहीं मिली — दोबारा कोशिश करें।');
    await signInWithCredential(getAuth(app), GoogleAuthProvider.credential(idToken));
  }
  // Signed in is not the same as ready to write — see waitForAuth.
  await waitForAuth();
  return describeUser(result.user);
}

/* Firestore does not become authenticated the instant signInWithCredential
   resolves. The token has to reach the channel the writes go out on, and a
   write fired in that gap leaves anonymously and comes back "Missing or
   insufficient permissions" — which reads like a rules bug and is not one.

   So sign-in ends here, holding until a token actually exists. Anything that
   needs permission can then assume it has some. */
async function waitForAuth(timeoutMs = 15000) {
  if (!app) throw new Error(NOT_CONNECTED);
  const auth = getAuth(app);

  const settled = auth.currentUser || await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stop(); reject(new Error('लॉगिन की पुष्टि नहीं हो पाई — दोबारा कोशिश करें।')); }, timeoutMs);
    const stop = onAuthStateChanged(auth, user => {
      if (!user) return;
      clearTimeout(timer); stop(); resolve(user);
    });
  });

  // Forces the token to be minted and cached, which is the part the writes need.
  await settled.getIdToken();
  return settled;
}

export async function signOutUser() {
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
  await FirebaseAuthentication.signOut();
  if (app) { try { await authSignOut(getAuth(app)); } catch {} }
  return true;
}

/** Who is signed in right now, or null. Reads the JS SDK, which is the half
 *  that the Firestore rules actually see. */
export function currentUser() {
  if (!app) return null;
  return describeUser(getAuth(app).currentUser);
}

/** Fires whenever sign-in state settles, including the silent restore on
 *  launch — a phone at the bottom of a valley must not be asked to log in
 *  again just because it has no signal. */
export function onAuthChanged(handler) {
  if (!app) return () => {};
  return onAuthStateChanged(getAuth(app), u => handler(describeUser(u)));
}

function describeUser(u) {
  if (!u) return null;
  return {
    uid: u.uid,
    email: u.email || '',
    name: u.displayName || u.email || '',
    photoUrl: u.photoUrl || u.photoURL || ''
  };
}

/* Claiming ties this ledger to the account: `ownerUid` on the site document,
   and the id recorded in the account's own directory. Two writes because the
   rules forbid listing site_diaries — without the directory a new phone would
   have no way to ask which ledger is its owner's, which is the entire point. */
export async function claimSite(siteId, _uid) {
  if (!db) throw new Error(NOT_CONNECTED);
  /* The uid that matters is the JS SDK's, because that is the one the rules
     see as request.auth.uid. The native sign-in returns its own copy and they
     should agree, but "should" is doing real work in that sentence and a
     mismatch here reads as a permissions error with nothing to point at. */
  const account = await waitForAuth();
  const uid = account.uid;
  const id = cleanId(siteId);

  /* The directory goes first, and the order is the whole point.

     Writing it needs a working token, while stamping ownerUid on an unclaimed
     ledger does not — the id alone still opens that one. Done the other way
     round, a token that turns out not to work leaves the ledger claimed and
     nobody able to reach it: locked out of your own hisaab by the act of
     claiming it. This way a broken token fails on the first write, having
     changed nothing, and the ledger stays as open as it was. */
  /* Read, merge, write — deliberately not arrayUnion.

     A field transform is applied after the rules run, so `siteIds` can be
     absent from request.resource.data while the rule is being evaluated and a
     check as ordinary as "siteIds is list" fails on a field the write plainly
     contains. Computing the array here keeps what the rules see and what is
     written the same thing. */
  const directory = doc(db, 'user_sites', uid);
  let siteIds = [];
  try {
    const existing = await getDoc(directory);
    if (existing.exists() && Array.isArray(existing.data().siteIds)) siteIds = existing.data().siteIds;
  } catch (e) {
    throw new Error(`खाते की डायरेक्टरी पढ़ी नहीं जा सकी (${e.code || e.message})`);
  }
  if (!siteIds.includes(id)) siteIds = [...siteIds, id];

  try {
    await setDoc(directory, { siteIds, updatedAt: new Date().toISOString() }, { merge: true });
  } catch (e) {
    throw new Error(`खाते की डायरेक्टरी लिखी नहीं जा सकी (${e.code || e.message})`);
  }

  try {
    await setDoc(doc(db, 'site_diaries', id), { ownerUid: uid }, { merge: true });
  } catch (e) {
    throw new Error(`हिसाब खाते से जोड़ा नहीं जा सका (${e.code || e.message})`);
  }
  return id;
}

/** The site ids this account has claimed, newest claim last. Empty for an
 *  account that has never claimed one — a genuinely new user, not an error. */
export async function listMySites(uid) {
  if (!db) throw new Error(NOT_CONNECTED);
  const snap = await getDoc(doc(db, 'user_sites', uid));
  if (!snap.exists()) return [];
  const ids = snap.data().siteIds;
  return Array.isArray(ids) ? ids : [];
}
