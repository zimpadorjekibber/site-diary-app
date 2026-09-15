// netlify/functions/mcp.js
// The Site Diary MCP server, reachable over HTTPS — this is the one the phone
// talks to. Claude connects to it from Anthropic's servers, not from the phone,
// so it has to be on the public internet; that is the whole reason this exists
// rather than the stdio server in mcp/server.js.
//
// The tools are NOT redefined here. They come from mcp/tools.js, the same module
// the stdio server uses, so an answer given on the phone cannot differ from the
// same answer given on the laptop.
//
// Speaking MCP directly rather than through the SDK's transport: this endpoint
// is stateless and never streams, and Streamable HTTP allows a plain JSON reply
// to a POST. A serverless function that holds no session between requests is a
// poor fit for a transport built around one, and the protocol surface we need is
// four methods wide.

import { createHash, timingSafeEqual } from 'node:crypto';
import { ALL_TOOLS, WRITE_TOOL_NAMES, callTool } from '../../mcp/tools.js';

// Versions this server knows how to answer. The newest is offered when a client
// asks for something unfamiliar.
const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_VERSION = SUPPORTED_VERSIONS[0];

/* Writes are off unless switched on deliberately. The stdio server runs on a
   machine the owner is sitting at; this one answers anybody on the internet who
   holds the token, so the safe default is different: read, and nothing more. */
const ALLOW_WRITE = process.env.SITE_DIARY_ALLOW_WRITE === '1';

const VISIBLE_TOOLS = ALLOW_WRITE
  ? ALL_TOOLS
  : ALL_TOOLS.filter(t => !WRITE_TOOL_NAMES.includes(t.name));

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id'
};

/** Compares without leaking, through a hash so lengths cannot differ. */
function sameSecret(a, b) {
  if (!a || !b) return false;
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * The token may arrive three ways. A header is the right place for a secret and
 * is preferred; the path and the query string are there because a connector
 * dialog that only accepts a URL leaves no other option.
 */
function suppliedToken(req) {
  const auth = req.headers.get('authorization') || '';
  if (/^Bearer /i.test(auth)) return auth.slice(7).trim();

  const url = new URL(req.url);
  const fromQuery = url.searchParams.get('token');
  if (fromQuery) return fromQuery.trim();

  const parts = url.pathname.split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  return last && last !== 'mcp' ? last : '';
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extraHeaders }
  });
}

function rpcError(id, code, message) {
  return json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

async function handleRpc(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : DEFAULT_VERSION,
          capabilities: { tools: {} },
          serverInfo: {
            name: 'site-diary',
            version: '1.0.0',
            title: 'श्रम व साइट डायरी'
          },
          instructions: ALLOW_WRITE
            ? 'Site ledger for an Indian construction contractor. Attendance, wages, ' +
              'advances, contracts, tractor trolley loads and JCB hours. Amounts are ' +
              'rupees; dates are YYYY-MM-DD. Workers can be named rather than given by id.'
            : 'Site ledger for an Indian construction contractor, read-only over this ' +
              'connection. Attendance, wages, advances, contracts, tractor trolley loads ' +
              'and JCB hours. Amounts are rupees; dates are YYYY-MM-DD.'
        }
      };
    }

    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };

    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: VISIBLE_TOOLS } };

    case 'tools/call': {
      const name = params?.name;
      // A write tool is hidden when writes are off; refusing by name as well
      // means a client working from a stale tool list still cannot get through.
      if (!ALLOW_WRITE && WRITE_TOOL_NAMES.includes(name)) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [{
              type: 'text',
              text: 'This connection can only read the ledger. Changes have to be made ' +
                    'in the app on the phone.'
            }]
          }
        };
      }
      const result = await callTool(name, params?.arguments);
      return { jsonrpc: '2.0', id, result };
    }

    default:
      // Notifications carry no id and expect no reply.
      if (id === undefined || id === null) return null;
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } };
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  /* Say plainly that there is no sign-in service here.

     Before connecting, a client asks whether the host has an OAuth server, by
     fetching /.well-known/oauth-*. On a single-page site every unknown path
     returns 200 with index.html, so those questions were answered "yes, and
     here is some HTML" — the client then tried to register with a sign-in
     service that does not exist and gave up. A real 404 ends that search and
     lets it connect with no auth at all, which is the truth: the secret is in
     the URL, and it was already checked below. */
  if (/^\/(\.well-known\/(oauth|openid)|register$|authorize$|token$)/.test(new URL(req.url).pathname)) {
    return json({ error: 'No authorization server here.' }, 404);
  }

  // No token configured means the endpoint is live but unguarded. Refuse rather
  // than serve the ledger to whoever found the URL.
  const expected = process.env.SITE_DIARY_TOKEN;
  if (!expected) {
    return json({ error: 'Server not configured: set SITE_DIARY_TOKEN.' }, 503);
  }
  if (!process.env.SITE_DIARY_SITE_ID) {
    return json({ error: 'Server not configured: set SITE_DIARY_SITE_ID.' }, 503);
  }
  /* Wrong or missing token answers 404, never 401.

     A 401 with WWW-Authenticate tells an MCP client to go and find an
     authorization server and start OAuth. There is no OAuth here — the secret
     is the URL — so that challenge sends Claude looking for something that
     does not exist, and the connector fails to attach at all.

     404 also happens to be the better answer: someone probing for this
     endpoint cannot tell from the reply that it is here. */
  if (!sameSecret(suppliedToken(req), expected)) {
    return json({ error: 'Not found' }, 404);
  }

  // Nothing here pushes to the client, so there is no stream to open.
  if (req.method === 'GET') return json({ error: 'Method Not Allowed' }, 405);
  // Stateless: there is no session to end, but saying so cleanly is kinder.
  if (req.method === 'DELETE') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return rpcError(null, -32700, 'Parse error');
  }

  try {
    // A batch is a list; a single call is not. Both are valid JSON-RPC.
    if (Array.isArray(body)) {
      const replies = (await Promise.all(body.map(handleRpc))).filter(Boolean);
      return replies.length ? json(replies) : new Response(null, { status: 202, headers: CORS });
    }
    const reply = await handleRpc(body);
    return reply ? json(reply) : new Response(null, { status: 202, headers: CORS });
  } catch (err) {
    return rpcError(body?.id, -32603, err?.message || 'Internal error');
  }
}

export const config = {
  // /mcp for a header-capable client; /mcp/:token for one that can only be given
  // a URL. The rest are the discovery paths a client probes for a sign-in
  // service — claimed here only so they can answer 404 instead of being
  // swallowed by the single-page app and answered 200.
  path: [
    '/mcp',
    '/mcp/:token',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-authorization-server/*',
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/*',
    '/.well-known/openid-configuration',
    '/.well-known/openid-configuration/*',
    '/register',
    '/authorize',
    '/token'
  ]
};
