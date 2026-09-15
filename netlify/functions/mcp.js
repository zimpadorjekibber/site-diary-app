// netlify/functions/mcp.js
// Netlify’s wrapper around the server in mcp/http.js. Nothing lives here but the
// routing table — the same function is served from Vercel by api/mcp.js, because
// Netlify’s free tier allows twenty production deploys a month and this endpoint
// changes more often than that.

import { handleMcpRequest } from '../../mcp/http.js';

export default handleMcpRequest;

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
