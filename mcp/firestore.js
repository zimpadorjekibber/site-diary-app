// mcp/firestore.js
// Reads one site's ledger out of Firestore over the REST API.
//
// Deliberately no Firebase SDK: this process starts on every MCP session, and
// the REST endpoint needs nothing but fetch. The security rules apply to REST
// exactly as they do to the SDK, so an unguessable site id is still the only
// thing standing between a caller and the data.

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
  constructor({ siteId, projectId, apiKey } = {}) {
    this.siteId = siteId;
    this.projectId = projectId || DEFAULT_PROJECT_ID;
    this.apiKey = apiKey || DEFAULT_API_KEY;
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

    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}` +
      `/databases/(default)/documents/site_diaries/${encodeURIComponent(this.siteId)}` +
      `?key=${encodeURIComponent(this.apiKey)}`;

    const res = await fetch(url);

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
      throw new Error(
        `Firestore refused the read for site "${this.siteId}". Most likely this ` +
        `ledger now belongs to a Google account, and this tool reads without ` +
        `signing in — it needs a service account to see an owned ledger. ` +
        `(The other possibility is an id that does not match site-XXXX-XXXX.)`
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
