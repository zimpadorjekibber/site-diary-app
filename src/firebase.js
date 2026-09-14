// src/firebase.js
// Firebase Cloud Firestore integration for Shram & Site Diary

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore';

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
    trades: data.trades || [],
    workers: data.workers || [],
    transactions: data.transactions || [],
    haziri: data.haziri || {},
    haziriMeta: data.haziriMeta || {},
    diaryNotedDates: data.diaryNotedDates || {},
    // Preserved so restoring a site does not re-seed the demo workers.
    isCleanStarted: data.isCleanStarted === true,
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
