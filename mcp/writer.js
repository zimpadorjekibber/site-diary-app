// mcp/writer.js
// The write half of the MCP server.
//
// Two rules shape everything here.
//
// 1. Never lose a concurrent edit. The phone writes to the same document, so a
//    naive read-modify-write would silently drop whatever it saved in between.
//    Every change runs inside a Firestore transaction: if the document moved
//    while we were working, the transaction retries against the new state.
//
// 2. Never reimplement the ledger. Changes are applied through the app's own
//    Store, so a worker added here is shaped exactly like one added in the app,
//    ids are generated the same way, and the accounting stays consistent.

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, runTransaction } from 'firebase/firestore';
import { Store } from '../src/storage.js';

const DEFAULT_CONFIG = {
  apiKey: 'AIzaSyBWCY6fp7P1i5ubqG_OXV74Aq9fGeyrzOQ',
  authDomain: 'khalen-dairy.firebaseapp.com',
  projectId: 'khalen-dairy',
  storageBucket: 'khalen-dairy.firebasestorage.app',
  messagingSenderId: '54398896553',
  appId: '1:54398896553:web:f282e56dd060a624f35cb8'
};

// Identifies writes from here, so the phone treats them as somebody else's
// change and pulls them in rather than ignoring its own echo.
const WRITER_DEVICE_ID = 'mcp-server';

let db = null;

function getDb(projectId, apiKey) {
  if (!db) {
    const config = { ...DEFAULT_CONFIG };
    if (projectId) config.projectId = projectId;
    if (apiKey) config.apiKey = apiKey;
    db = getFirestore(getApps().length ? getApp() : initializeApp(config));
  }
  return db;
}

/** Same field set the security rules accept, and the app expects. */
function toPayload(data) {
  const settings = data.settings || {};
  return {
    trades: data.trades || [],
    workers: data.workers || [],
    transactions: data.transactions || [],
    haziri: data.haziri || {},
    haziriMeta: data.haziriMeta || {},
    diaryNotedDates: data.diaryNotedDates || {},
    isCleanStarted: data.isCleanStarted === true,
    settings: {
      eveningReminderTime: settings.eveningReminderTime || '19:30',
      reminderEnabled: settings.reminderEnabled !== false,
      soundEnabled: settings.soundEnabled !== false,
      currency: settings.currency || '₹',
      language: settings.language || 'hi-IN',
      otHoursPerDay: settings.otHoursPerDay || 8
    },
    lastWriterDeviceId: WRITER_DEVICE_ID,
    updatedAt: new Date().toISOString(),
    timestamp: Date.now()
  };
}

/**
 * Applies a change to the ledger inside a transaction.
 *
 * @param {object} opts  { siteId, projectId, apiKey }
 * @param {(store: Store) => any} apply  Mutates the store; its return value is
 *   passed back to the caller. Throwing aborts the write with nothing changed.
 */
export async function mutateLedger({ siteId, projectId, apiKey }, apply) {
  if (!siteId) {
    throw new Error(
      'No site id configured. Set SITE_DIARY_SITE_ID to the id shown in the app ' +
      'under Settings → उन्नत सेटिंग्स → 🔑 आपकी साइट आईडी.'
    );
  }

  const ref = doc(getDb(projectId, apiKey), 'site_diaries', siteId);

  return runTransaction(getDb(projectId, apiKey), async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      throw new Error(
        `No ledger found for site "${siteId}". Open the app once with cloud backup ` +
        `switched on so the site exists, then try again.`
      );
    }

    const store = new Store({ data: snap.data(), persist: false });
    const result = apply(store);
    tx.set(ref, toPayload(store.data));
    return result;
  });
}

/** Resolves a worker by name or id, refusing to guess between near-matches. */
export function findWorker(store, nameOrId) {
  const workers = store.getWorkers();
  const needle = String(nameOrId || '').trim().toLowerCase();
  if (!needle) throw new Error('Which worker? Give a name or an id.');

  const byId = workers.find(w => w.id.toLowerCase() === needle);
  if (byId) return byId;

  const exact = workers.find(w => w.name.toLowerCase() === needle);
  if (exact) return exact;

  const partial = workers.filter(w => w.name.toLowerCase().includes(needle));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new Error(
      `"${nameOrId}" matches ${partial.length} workers: ${partial.map(w => w.name).join(', ')}. Use a fuller name.`
    );
  }
  throw new Error(
    `No worker called "${nameOrId}". Current workers: ${workers.map(w => w.name).join(', ') || 'none yet'}.`
  );
}

/** Resolves a trade by id or part of its name. */
export function findTrade(store, idOrName) {
  const trades = store.getTrades();
  const needle = String(idOrName || '').trim().toLowerCase();
  if (!needle) throw new Error('Which trade? e.g. carpenter, mason.');

  const match = trades.find(t => t.id.toLowerCase() === needle)
    || trades.find(t => t.name.toLowerCase().includes(needle));
  if (match) return match;

  throw new Error(
    `No trade matching "${idOrName}". Available: ${trades.map(t => `${t.id} (${t.name})`).join(', ')}.`
  );
}

export function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Rejects a malformed date early rather than writing it into the ledger. */
export function validDate(date) {
  if (!date) return todayString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Date must look like 2026-09-15, got "${date}".`);
  }
  return date;
}
