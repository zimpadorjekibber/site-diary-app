// mcp/writer.js
// The write half of the MCP server.
//
// Two rules shape everything here.
//
// 1. Never lose a concurrent edit. The phone writes to the same document, so a
//    naive read-modify-write would silently drop whatever it saved in between.
//    Every write carries the updateTime it read, and Firestore refuses it if the
//    document has moved since; we re-read and retry against the new state. That
//    is what the client SDK's transaction used to do here. It had to go: a
//    ledger belongs to a Google account now, the rules only answer to that
//    account, and the client SDK cannot hold a service account's identity.
//
// 2. Never reimplement the ledger. Changes are applied through the app's own
//    Store, so a worker added here is shaped exactly like one added in the app,
//    ids are generated the same way, and the accounting stays consistent.

import { Store } from '../src/storage.js';
import { loadServiceAccount, getAccessToken } from './auth.js';

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

/* Firestore REST wants every value type-tagged. decodeValue in firestore.js is
   the other half of this; they must agree, so change them together. */
function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (typeof v === 'object') return { mapValue: { fields: encodeFields(v) } };
  return { nullValue: null };
}

function encodeFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;   // Firestore refuses undefined anywhere
    out[k] = encodeValue(v);
  }
  return out;
}

function decodeValue(v) {
  if (v === null || v === undefined || 'nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}

function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decodeValue(v);
  return out;
}

function docUrl(projectId, siteId) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId || DEFAULT_CONFIG.projectId)}` +
    `/databases/(default)/documents/site_diaries/${encodeURIComponent(siteId)}`;
}

function requireAccount() {
  const account = loadServiceAccount();
  if (!account) {
    throw new Error(
      'Writing needs a service account: this ledger belongs to a Google account and ' +
      'the rules only answer to one. Set SITE_DIARY_SERVICE_ACCOUNT (see mcp/README.md).'
    );
  }
  return account;
}

/** The same field set the app itself writes (see buildSyncPayload in
 *  src/firebase.js), and the same one the security rules accept.
 *
 *  This used to write the pre-projects shape — trades, workers and
 *  transactions at the top level. After the ledger moved inside `projects`,
 *  those fields read `undefined` here, so every write replaced the whole
 *  document with empty arrays and dropped `projects` and `lending` entirely.
 *  One write was enough to wipe the cloud copy of a site's ledger. */
// Exported so the shape can be tested directly; the ledger was once emptied
// by exactly this function and that must stay covered.
export function toPayload(data) {
  const settings = data.settings || {};
  // Round-tripped through JSON at the end: Firestore refuses a document that
  // contains undefined anywhere, and one stray field is enough to fail the
  // whole write. JSON drops those keys instead.
  return stripUndefined({
    projects: data.projects || [],
    activeProjectId: data.activeProjectId || null,
    lending: data.lending || [],
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
  });
}

function stripUndefined(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** Refuses a write that would destroy what is already there.
 *
 *  A tool here only ever adds a worker, marks attendance or logs an expense.
 *  None of those can legitimately reduce the ledger to nothing, so if the
 *  outgoing payload has lost the workers or the jobs the incoming document
 *  had, something is wrong with this code rather than with the request —
 *  and the right move is to write nothing at all. */
export function refuseIfDestructive(before, after, intentional = false) {
  // A deletion the caller asked for and confirmed is allowed to shrink the
  // ledger. Everything else still cannot.
  if (intentional) return after;
  const countWorkers = d => (d?.projects || []).reduce((n, p) => n + (p.workers || []).length, 0)
    + (Array.isArray(d?.workers) ? d.workers.length : 0);

  const had = countWorkers(before);
  const has = countWorkers(after);
  if (had > 0 && has === 0) {
    throw new Error(
      `Refusing to write: the ledger had ${had} workers and the update has none. ` +
      'Nothing was changed. This is a bug in the MCP writer, not in your request.'
    );
  }

  const hadProjects = (before?.projects || []).length;
  const hasProjects = (after?.projects || []).length;
  if (hadProjects > 0 && hasProjects === 0) {
    throw new Error(
      `Refusing to write: the ledger had ${hadProjects} jobs and the update has none. ` +
      'Nothing was changed.'
    );
  }
  return after;
}

/**
 * Applies a change to the ledger inside a transaction.
 *
 * @param {object} opts  { siteId, projectId, apiKey }
 * @param {(store: Store) => any} apply  Mutates the store; its return value is
 *   passed back to the caller. Throwing aborts the write with nothing changed.
 */
export async function mutateLedger({ siteId, projectId, apiKey, allowShrink = false }, apply) {
  if (!siteId) {
    throw new Error(
      'No site id configured. Set SITE_DIARY_SITE_ID to the id shown in the app ' +
      'under Settings → उन्नत सेटिंग्स → 🔑 आपकी साइट आईडी.'
    );
  }

  const account = requireAccount();
  const url = docUrl(projectId, siteId);

  // Three tries, because the only reason to fail is that the phone wrote in the
  // same moment — and it does not do that repeatedly.
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = await getAccessToken(account);

    const read = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (read.status === 404) {
      throw new Error(
        `No ledger found for site "${siteId}". Open the app once with cloud backup ` +
        `switched on so the site exists, then try again.`
      );
    }
    if (!read.ok) {
      throw new Error(`Could not read the ledger before writing (${read.status}).`);
    }

    const snapshot = await read.json();
    const before = decodeFields(snapshot.fields || {});

    const store = new Store({ data: before, persist: false });
    const result = apply(store);

    const payload = refuseIfDestructive(before, toPayload(store.data), allowShrink);
    /* The owner comes back untouched. This is a whole-document write, so a
       payload without ownerUid would strip the ledger's owner off it — the
       rules refuse that, but only because they were asked to; the write should
       never have been trying. */
    if (before.ownerUid) payload.ownerUid = before.ownerUid;

    // Refuse the write if the document moved since the read above.
    const write = await fetch(
      `${url}?currentDocument.updateTime=${encodeURIComponent(snapshot.updateTime)}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: encodeFields(payload) })
      }
    );

    if (write.ok) return result;

    // 400/409 here is the precondition: somebody else wrote first. Read again.
    if ((write.status === 400 || write.status === 409) && attempt < 2) continue;

    const detail = await write.text();
    throw new Error(
      write.status === 403
        ? `Firestore refused the write for site "${siteId}". Check the service account ` +
          `belongs to this project.`
        : `Could not save the change (${write.status}). Nothing was written. ${detail.slice(0, 160)}`
    );
  }

  throw new Error(
    'The ledger kept changing while this was being saved. Nothing was written — try again.'
  );
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
