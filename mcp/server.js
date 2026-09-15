#!/usr/bin/env node
// mcp/server.js
// Runs the Site Diary tools over stdio — the local setup, for Claude Desktop
// and Claude Code on a machine that has this repo.
//
// The tools themselves live in ./tools.js, shared with the HTTP function in
// netlify/functions/mcp.js. One definition, so the laptop and the phone can
// never disagree about what a worker is owed.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { ALL_TOOLS, callTool } from './tools.js';

const server = new Server(
  { name: 'site-diary', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ALL_TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (request) =>
  callTool(request.params.name, request.params.arguments)
);

const transport = new StdioServerTransport();
await server.connect(transport);
