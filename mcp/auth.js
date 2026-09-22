// mcp/auth.js
// Turns a Google service account key into a Firestore access token.
//
// Why this exists: a ledger now belongs to a Google account, and the security
// rules only answer to that account. This reader is not a person and cannot
// sign in as one, so it uses the other kind of identity Google offers — a
// service account, whose token Firestore honours above the rules rather than
// through them. That is precisely why the key is dangerous, and why it only
// ever arrives from the environment and never from the repository.
//
// No SDK and no dependency: the whole exchange is one signed JWT and one POST,
// and this process starts fresh on every MCP session.

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/datastore';

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Accepts either the JSON itself or a path to it. A path is the better of the
 * two: it keeps the key out of process listings and out of any config file
 * that might get shared or committed.
 */
export function loadServiceAccount(value = process.env.SITE_DIARY_SERVICE_ACCOUNT) {
  if (!value) return null;

  let raw;
  if (value.trim().startsWith('{')) {
    raw = value;
  } else {
    try {
      raw = readFileSync(value, 'utf8');
    } catch (e) {
      // Naming the variable matters: the path is set in a config file the
      // reader of this message is probably not looking at.
      throw new Error(
        `SITE_DIARY_SERVICE_ACCOUNT points at "${value}", which cannot be read (${e.code || e.message}).`
      );
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      'SITE_DIARY_SERVICE_ACCOUNT is neither valid JSON nor a readable path to it.'
    );
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(
      'That service account file has no client_email / private_key. Download the key ' +
      'from Firebase Console → Project settings → Service accounts → Generate new private key.'
    );
  }
  return parsed;
}

let cached = null;   // { token, expiresAt }

/** A Firestore access token, minted on first use and reused until it expires. */
export async function getAccessToken(account) {
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: account.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600
  };
  const unsigned =
    `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claims))}`;

  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  // The JSON stores the PEM with literal \n, which crypto will not parse.
  const pem = account.private_key.replace(/\\n/g, '\n');
  const signature = signer.sign(pem).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`
    })
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(
      `Google refused the service account (${res.status}). ` +
      `Check that the key belongs to this project and has not been revoked. ${detail.slice(0, 200)}`
    );
  }

  const body = await res.json();
  if (!body.access_token) throw new Error('Google returned no access token.');

  // A minute short of the stated life, so a token never expires mid-request.
  cached = { token: body.access_token, expiresAt: Date.now() + ((body.expires_in || 3600) - 60) * 1000 };
  return cached.token;
}
