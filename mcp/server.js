#!/usr/bin/env node
// mcp/server.js
// Read-only MCP server for Shram & Site Diary.
//
// Every figure it reports comes from the app's own Store (src/storage.js) built
// around the ledger fetched from Firestore. That is the whole point: a second
// implementation of "what does this worker still owe" would drift from the app
// and quietly disagree with it, which is exactly the class of bug this project
// has already been bitten by.
//
// Read-only by design. It exposes no tool that can change the ledger.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { SiteDiaryClient } from './firestore.js';
import { Store, getThekaTotal, describeTheka, getTxTypeLabel } from '../src/storage.js';

const client = new SiteDiaryClient({
  siteId: process.env.SITE_DIARY_SITE_ID,
  projectId: process.env.SITE_DIARY_PROJECT_ID,
  apiKey: process.env.SITE_DIARY_API_KEY
});

/** A Store wrapping the current cloud ledger — same arithmetic as the app. */
async function getStore() {
  const data = await client.fetchLedger();
  return new Store({ data, persist: false });
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const rupees = n => `₹${(Number(n) || 0).toLocaleString('en-IN')}`;

/** Workers are far easier to name than to id, so accept either. */
function resolveWorker(store, nameOrId) {
  const workers = store.getWorkers();
  const needle = String(nameOrId || '').trim().toLowerCase();
  if (!needle) return null;

  const byId = workers.find(w => w.id.toLowerCase() === needle);
  if (byId) return byId;

  const exact = workers.find(w => w.name.toLowerCase() === needle);
  if (exact) return exact;

  const partial = workers.filter(w => w.name.toLowerCase().includes(needle));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    const err = new Error(
      `"${nameOrId}" matches ${partial.length} workers: ${partial.map(w => w.name).join(', ')}. Use a fuller name.`
    );
    err.ambiguous = true;
    throw err;
  }
  return null;
}

function describeWorker(store, w) {
  const trade = store.getTrade(w.tradeId);
  const role = w.role === 'mistri' ? 'Mistri' : 'Helper';
  const base = {
    id: w.id,
    name: w.name,
    trade: trade.name,
    role,
    contractType: w.contractType === 'theka' ? 'theka' : 'dihadi',
    phone: w.phone || null
  };
  if (w.contractType === 'theka') {
    base.isThekedar = !!w.isThekedar;
    base.contract = describeTheka(w, 'en');
    base.contractValue = getThekaTotal(w);
  } else {
    base.dailyRate = w.dailyRate || 0;
  }
  return base;
}

const TOOLS = [
  {
    name: 'site_summary',
    description:
      "Overall snapshot of the construction site: today's spending broken down, how many workers " +
      'are present today, total workers and trades, and whether the evening diary has been written. ' +
      'Use this first when asked a general question about the site.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' }
      }
    }
  },
  {
    name: 'list_workers',
    description:
      'List the workers on site with their trade, role, daily rate or contract terms. ' +
      'Optionally filter to one trade.',
    inputSchema: {
      type: 'object',
      properties: {
        trade: { type: 'string', description: 'Trade id or part of its name, e.g. "mason" or "बढ़ई".' }
      }
    }
  },
  {
    name: 'worker_ledger',
    description:
      'The money position for one worker: days present and absent, total earned, total paid ' +
      'to them so far, and the balance still due. Accepts a name or an id.',
    inputSchema: {
      type: 'object',
      properties: {
        worker: { type: 'string', description: 'Worker name (partial is fine) or id.' }
      },
      required: ['worker']
    }
  },
  {
    name: 'attendance',
    description:
      'Attendance for one date — who was present, half day, absent, and any overtime hours.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
        trade: { type: 'string', description: 'Optional trade filter.' }
      }
    }
  },
  {
    name: 'muster_roll',
    description:
      'The monthly attendance register: per worker, days present, absent, overtime hours, ' +
      'earned this month, paid this month, and the balance.',
    inputSchema: {
      type: 'object',
      properties: {
        year: { type: 'number', description: 'e.g. 2026. Defaults to the current year.' },
        month: { type: 'number', description: '1-12. Defaults to the current month.' }
      }
    }
  },
  {
    name: 'list_transactions',
    description:
      'Expenses and payments — cash advances, recharges, ration, cylinder, diesel, material and ' +
      'any custom types. Filter by date range, type, or worker.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'YYYY-MM-DD, inclusive.' },
        to: { type: 'string', description: 'YYYY-MM-DD, inclusive.' },
        type: { type: 'string', description: 'cash, recharge, ration, cylinder, diesel, material, other.' },
        worker: { type: 'string', description: 'Worker name or id.' },
        limit: { type: 'number', description: 'Max rows, default 50.' }
      }
    }
  },
  {
    name: 'spend_report',
    description:
      'Total spending over a date range, broken down by transaction type and by trade. ' +
      'Use for questions like "how much did we spend on diesel this month".',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'YYYY-MM-DD, inclusive.' },
        to: { type: 'string', description: 'YYYY-MM-DD, inclusive.' }
      }
    }
  }
];

const handlers = {
  async site_summary({ date }) {
    const store = await getStore();
    const day = date || today();
    const txs = store.getTransactions(day);
    const haziri = store.getHaziri(day);
    const workers = store.getWorkers();

    const byType = {};
    for (const t of txs) byType[t.type] = (byType[t.type] || 0) + (Number(t.amount) || 0);

    // Full days only, matching the app's P chip and the attendance tool — counting
    // half days as present made the two tools disagree about the same date.
    const present = Object.values(haziri).filter(h => h.status === 1).length;
    const half = Object.values(haziri).filter(h => h.status === 0.5).length;
    const absent = Object.values(haziri).filter(h => h.status === 0).length;

    return {
      date: day,
      totalSpent: txs.reduce((s, t) => s + (Number(t.amount) || 0), 0),
      spentByType: Object.fromEntries(
        Object.entries(byType).map(([k, v]) => [getTxTypeLabel(k, 'en'), v])
      ),
      attendance: { present, halfDay: half, absent, notMarked: workers.length - Object.keys(haziri).length },
      totalWorkers: workers.length,
      trades: store.getTrades().map(t => t.name),
      diaryWritten: store.isDateMarkedInDiary(day)
    };
  },

  async list_workers({ trade }) {
    const store = await getStore();
    let workers = store.getWorkers();

    if (trade) {
      const needle = String(trade).toLowerCase();
      const match = store.getTrades().find(
        t => t.id.toLowerCase() === needle || t.name.toLowerCase().includes(needle)
      );
      if (!match) {
        return { error: `No trade matching "${trade}". Available: ${store.getTrades().map(t => t.name).join(', ')}` };
      }
      workers = store.getWorkers(match.id);
    }

    return { count: workers.length, workers: workers.map(w => describeWorker(store, w)) };
  },

  async worker_ledger({ worker }) {
    const store = await getStore();
    const w = resolveWorker(store, worker);
    if (!w) return { error: `No worker matching "${worker}".` };

    const l = store.getWorkerLedger(w.id);
    return {
      worker: describeWorker(store, w),
      daysPresent: l.totalHaziriDays,
      daysAbsent: l.totalAbsentDays,
      attendancePercent: l.presenceRate,
      totalEarned: l.totalEarned,
      totalPaid: l.totalIndividualGiven,
      paidBreakdown: Object.fromEntries(
        Object.entries(l.paidByType || {}).map(([k, v]) => [getTxTypeLabel(k, 'en'), v])
      ),
      balanceDue: l.balanceDue,
      // Spelled out because a negative balance means an overpayment, which reads
      // confusingly as a bare number.
      summary: l.balanceDue >= 0
        ? `${w.name} is still owed ${rupees(l.balanceDue)}.`
        : `${w.name} has been overpaid by ${rupees(Math.abs(l.balanceDue))}.`,
      contractNote: w.contractType === 'theka' ? describeTheka(w, 'en') : null
    };
  },

  async attendance({ date, trade }) {
    const store = await getStore();
    const day = date || today();
    const record = store.getHaziri(day);

    let workers = store.getWorkers();
    if (trade) {
      const needle = String(trade).toLowerCase();
      const match = store.getTrades().find(
        t => t.id.toLowerCase() === needle || t.name.toLowerCase().includes(needle)
      );
      if (match) workers = store.getWorkers(match.id);
    }

    const rows = workers.map(w => {
      const r = record[w.id];
      let status = 'not marked';
      if (r) status = r.status === 1 ? 'present' : r.status === 0.5 ? 'half day' : 'absent';
      return {
        name: w.name,
        trade: store.getTrade(w.tradeId).name,
        role: w.role === 'mistri' ? 'Mistri' : 'Helper',
        status,
        overtimeHours: r?.otHours || 0
      };
    });

    return {
      date: day,
      present: rows.filter(r => r.status === 'present').length,
      halfDay: rows.filter(r => r.status === 'half day').length,
      absent: rows.filter(r => r.status === 'absent').length,
      notMarked: rows.filter(r => r.status === 'not marked').length,
      workers: rows
    };
  },

  async muster_roll({ year, month }) {
    const store = await getStore();
    const now = new Date();
    const y = year || now.getFullYear();
    const m = month || now.getMonth() + 1;
    const data = store.getMonthlyHaziri(y, m);

    return {
      year: y,
      month: m,
      daysInMonth: data.daysInMonth,
      workers: data.rows.map(r => ({
        name: r.worker.name,
        trade: r.trade.name,
        role: r.worker.role === 'mistri' ? 'Mistri' : 'Helper',
        contractType: r.isTheka ? 'theka' : 'dihadi',
        isThekedar: r.isThekedar || false,
        daysPresent: r.totalPresent,
        daysAbsent: r.totalAbsent,
        overtimeHours: r.totalOtHours,
        earnedThisMonth: r.totalEarnedMonth,
        paidThisMonth: r.totalPaidMonth,
        balance: r.netBalance,
        contract: r.thekaLabel || null
      }))
    };
  },

  async list_transactions({ from, to, type, worker, limit }) {
    const store = await getStore();
    let txs = store.getTransactions();

    if (from) txs = txs.filter(t => t.date >= from);
    if (to) txs = txs.filter(t => t.date <= to);
    if (type) txs = txs.filter(t => t.type === type);
    if (worker) {
      const w = resolveWorker(store, worker);
      if (!w) return { error: `No worker matching "${worker}".` };
      txs = txs.filter(t => t.workerId === w.id);
    }

    txs = txs.sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
    const capped = txs.slice(0, limit || 50);

    return {
      matched: txs.length,
      returned: capped.length,
      total: txs.reduce((s, t) => s + (Number(t.amount) || 0), 0),
      transactions: capped.map(t => ({
        date: t.date,
        time: t.time,
        type: getTxTypeLabel(t.type, 'en'),
        amount: t.amount,
        paidTo: t.targetType === 'group'
          ? `${store.getTrade(t.tradeId).name} (shared)`
          : (store.getWorker(t.workerId)?.name || t.workerName || 'site'),
        item: t.rationItem || null,
        quantity: t.quantity || null,
        note: t.note || null
      }))
    };
  },

  async spend_report({ from, to }) {
    const store = await getStore();
    let txs = store.getTransactions();
    if (from) txs = txs.filter(t => t.date >= from);
    if (to) txs = txs.filter(t => t.date <= to);

    const byType = {};
    const byTrade = {};
    let workerPayments = 0;
    let sharedCosts = 0;

    for (const t of txs) {
      const amt = Number(t.amount) || 0;
      byType[getTxTypeLabel(t.type, 'en')] = (byType[getTxTypeLabel(t.type, 'en')] || 0) + amt;
      const tradeName = store.getTrade(t.tradeId).name;
      byTrade[tradeName] = (byTrade[tradeName] || 0) + amt;
      // Same split the app's screens use: booked to a person, or to the site.
      if (t.targetType !== 'group' && t.workerId) workerPayments += amt;
      else sharedCosts += amt;
    }

    return {
      from: from || 'beginning',
      to: to || 'today',
      transactionCount: txs.length,
      totalSpent: txs.reduce((s, t) => s + (Number(t.amount) || 0), 0),
      paidToWorkers: workerPayments,
      sharedSiteCosts: sharedCosts,
      byType,
      byTrade
    };
  }
};

const server = new Server(
  { name: 'site-diary', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = handlers[name];
  if (!handler) {
    return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  }
  try {
    const result = await handler(args || {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
