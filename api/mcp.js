// api/mcp.js
// Vercel's wrapper around the server in mcp/http.js.
//
// This is the endpoint the phone actually talks to. It lives here rather than on
// Netlify because Netlify's free tier allows twenty production deploys a month,
// and one day of fixing this thing used all of them — the website changes rarely
// and can stay there, but a tool definition changes several times an afternoon.
//
// Vercel hands Node's req/res rather than a Request, so the only work here is
// translating between the two. The server itself knows nothing about either.

import { handleMcpRequest } from '../mcp/http.js';

// Read the body ourselves. Vercel's parser would hand back an object, and this
// endpoint cares about the exact bytes: a malformed body must come back as a
// JSON-RPC parse error, not as a framework 400 the client cannot read.
export const config = { api: { bodyParser: false } };

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const url = `${proto}://${host}${req.url}`;

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const body = hasBody ? await readBody(req) : undefined;

  const request = new Request(url, {
    method: req.method,
    headers: new Headers(req.headers),
    body: body && body.length ? body : undefined
  });

  const response = await handleMcpRequest(request);

  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const text = await response.text();
  res.end(text);
}
