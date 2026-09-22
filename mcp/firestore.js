// mcp/firestore.js
// Reads one site's ledger out of Firestore over the REST API.
//
// Deliberately no Firebase SDK: this process starts on every MCP session, and
// the REST endpoint needs nothing but fetch.
//
// Two ways in. With a service account configured it sends that account's token,
// which is what an owned ledger requires — every ledger is owned now, so this is
// the ordinary path. Without one it falls back to the API key, which can still
// read a ledger nobody has claimed; that is only old sites and test data, and it
// keeps this useful before the key is set up.

import { loadServiceAccount, getAccessToken } from './auth.js';

const DEFAULT_PROJECT_ID = 'khalen-dairy';
const DEFAULT_API_KEY = 'AIzaSyBWCY6fp7P1i5ubqG_OXV74Aq9fGeyrzOQ';

/** Firestore REST wraps every value in a type tag; unwrap back to plain JS. */
function decodeValue(v) {
  if (v === null || v === undefined) return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('timestampValue' in v) return v.timestampValue;
  if ('bytesValue' in v) return v.bytesValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}

function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decodeValue(v);
  return out;
}

export class SiteDiaryClient {
  constructor({ siteId, projectId, apiKey, serviceAccount } = {}) {
    this.siteId = siteId;
    this.projectId = projectId || DEFAULT_PROJECT_ID;
    this.apiKey = apiKey || DEFAULT_API_KEY;
    // Read once at construction so a bad key is reported when the server
    // starts, not in the middle of answering a question about wages.
    this.account = serviceAccount === undefined ? loadServiceAccount() : serviceAccount;
    this._cache = null;
    this._cachedAt = 0;
  }

  /**
   * @param {number} maxAgeMs A single question often triggers several tools;
   *   caching briefly keeps them consistent with each other and avoids
   *   re-fetching the whole ledger for each one.
   */
  async fetchLedger(maxAgeMs = 15000) {
    if (this._cache && Date.now() - this._cachedAt < maxAgeMs) return this._cache;

    if (!this.siteId) {
      throw new Error(
        'No site id configured. Set SITE_DIARY_SITE_ID to the id shown in the app ' +
        'under Settings → उन्नत सेटिंग्स → Firebase (looks like site-XXXX-XXXX).'
      );
    }

    const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}` +
      `/databases/(default)/documents/site_diaries/${encodeURIComponent(this.siteId)}`;

    let url = base;
    const headers = {};
    if (this.account) {
      headers.Authorization = `Bearer ${await getAccessToken(this.account)}`;
    } else {
      url += `?key=${encodeURIComponent(this.apiKey)}`;
    }

    const res = await fetch(url, { headers });

    if (res.status === 404) {
      throw new Error(
        `No ledger found for site "${this.siteId}". Check the id in the app, and ` +
        `make sure cloud backup is switched on there.`
      );
    }
    if (res.status === 403) {
      /* Two different refusals arrive as the same 403, and blaming the id was
         wrong for the common one. Since ledgers became owned by a Google
         account, a well-formed id is no longer enough: this reader holds only
         an API key, and a claimed ledger answers to a signed-in account. The
         message used to send people off to check a site id that was perfectly
         correct. */
      throw new Error(this.account
        ? `Firestore refused the read for site "${this.siteId}" even with the service ` +
          `account. Check that the key belongs to project "${this.projectId}" and that ` +
          `the site id is right.`
        : `Firestore refused the read for site "${this.siteId}". This ledger belongs to ` +
          `a Google account, and this tool reads without signing in. Set ` +
          `SITE_DIARY_SERVICE_ACCOUNT to a service account key so it can read an owned ledger.`
      );
    }
    if (!res.ok) {
      throw new Error(`Firestore returned ${res.status} ${res.statusText}`);
    }

    const body = await res.json();
    const data = decodeFields(body.fields || {});

    this._cache = data;
    this._cachedAt = Date.now();
    return data;
  }
}
