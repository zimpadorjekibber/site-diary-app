// mcp/tools.js
// Read-only MCP server for Shram & Site Diary.
//
// Every figure it reports comes from the app's own Store (src/storage.js) built
// around the ledger fetched from Firestore. That is the whole point: a second
// implementation of "what does this worker still owe" would drift from the app
// and quietly disagree with it, which is exactly the class of bug this project
// has already been bitten by.
//
// Writes are supported but deliberately narrow: add a worker, mark attendance,
// log an expense, correct a worker's details. There is no tool that deletes a
// worker or wipes the ledger — destruction by misread sentence is not a risk
// worth taking, and the app has those controls behind explicit confirmations.
// Set SITE_DIARY_READONLY=1 to disable every write tool.

import { SiteDiaryClient } from './firestore.js';
import { mutateLedger, findWorker, findTrade, validDate, todayString as writerToday } from './writer.js';
import { Store, getThekaTotal, describeTheka, getTxTypeLabel, ABSENCE_REASONS, absenceReasonLabel } from '../src/storage.js';

const READ_ONLY = process.env.SITE_DIARY_READONLY === '1';

const siteRef = {
  siteId: process.env.SITE_DIARY_SITE_ID,
  projectId: process.env.SITE_DIARY_PROJECT_ID,
  apiKey: process.env.SITE_DIARY_API_KEY
};

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

/** How a worker's role should read. Stored, a role is only ever mistri or
    helper, with holding the contract kept as a separate flag — but a man shown
    as "Mistri" beside a seven-lakh contract looks like a mistake, so every
    place that reports a role goes through here rather than through w.role. */
function roleLabel(w) {
  if (!w.isThekedar) return w.role === 'mistri' ? 'Mistri' : 'Helper';
  return w.worksHimself === false
    ? 'Thekedar (does not work on site)'
    : 'Thekedar (works on site too)';
}

function describeWorker(store, w) {
  const trade = store.getTrade(w.tradeId);
  /* The stored role is only ever mistri or helper; holding the contract is a
     separate flag. But a man who reads "Mistri" next to a seven-lakh contract
     looks like a day labourer with a typo, so say what he actually is. */
  const role = roleLabel(w);
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
    if (w.isThekedar) base.worksHimself = w.worksHimself !== false;
    base.contract = describeTheka(w, 'en');
    base.contractValue = getThekaTotal(w);
  } else {
    base.dailyRate = w.dailyRate || 0;
  }
  return base;
}

/** One note as it reads outside the app: the trade spelled out, and no ids. */
function describeNote(store, n) {
  return {
    date: n.date,
    time: n.time || null,
    text: n.text,
    trade: n.tradeId ? store.getTrade(n.tradeId).name : null
  };
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
      'Attendance for one date — who was present, half day, absent, any overtime hours, ' +
      'and the reason for an absence where one was recorded.',
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
      'earned this month, paid this month, the balance, and the dates of any absence that ' +
      'was given a reason.',
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
  },
  {
    name: 'list_site_notes',
    description:
      'Plain notes written about the site on a day — what held the work up, who came, what the ' +
      'weather did. Newest first. Use for questions about what happened on site as opposed to ' +
      'who was present or what was spent.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD, one day only. Overrides dateFrom/dateTo.' },
        dateFrom: { type: 'string', description: 'YYYY-MM-DD, inclusive.' },
        dateTo: { type: 'string', description: 'YYYY-MM-DD, inclusive.' },
        trade: { type: 'string', description: 'Only notes tied to this work group.' },
        limit: { type: 'number', description: 'Max rows, default 50.' }
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
    const notes = store.getSiteNotes(day);

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
      // What happened on site that is neither a mark nor an amount. Left out
      // entirely on a day with none, so the summary does not grow an empty list.
      notes: notes.length ? notes.map(n => describeNote(store, n)) : undefined,
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
        overtimeHours: r?.otHours || 0,
        // Absent with no reason given — the usual case — reports no field at all
        // rather than an empty one, and so does every record marked before
        // reasons existed.
        reason: r?.reason ? absenceReasonLabel(r.reason, 'en') : undefined
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
    const explainedAbsences = (dailyStatuses) => {
      const given = Object.entries(dailyStatuses)
        .filter(([, rec]) => rec && rec.status === 0 && rec.reason)
        .map(([date, rec]) => ({ date, reason: absenceReasonLabel(rec.reason, 'en') }));
      return given.length ? given : undefined;
    };

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
        contract: r.thekaLabel || null,
        // Only the absences somebody bothered to explain; the plain ones are
        // already counted in daysAbsent. A worker with none reports no field
        // at all rather than an empty list — which is also what every row of
        // a register marked before reasons existed looks like.
        absenceReasons: explainedAbsences(r.dailyStatuses)
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

  async list_site_notes({ date, dateFrom, dateTo, trade, limit }) {
    const store = await getStore();
    let notes = date ? store.getSiteNotes(date) : store.getSiteNotes();

    if (!date) {
      if (dateFrom) notes = notes.filter(n => n.date >= dateFrom);
      if (dateTo) notes = notes.filter(n => n.date <= dateTo);
    }
    if (trade) {
      const needle = String(trade).toLowerCase();
      const match = store.getTrades().find(
        t => t.id.toLowerCase() === needle || t.name.toLowerCase().includes(needle)
      );
      if (!match) {
        return { error: `No trade matching "${trade}". Available: ${store.getTrades().map(t => t.name).join(', ')}` };
      }
      notes = notes.filter(n => n.tradeId === match.id);
    }

    /* Newest first. Sorted on createdAt rather than on the displayed time,
       which is a locale string ("03:33 PM") and does not order correctly as
       text — 11 AM would sort after 3 PM. */
    notes = notes.slice().sort(
      (a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0)
    );
    const capped = notes.slice(0, limit || 50);

    return {
      matched: notes.length,
      returned: capped.length,
      notes: capped.map(n => describeNote(store, n))
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

const WRITE_TOOLS = [
  {
    name: 'add_worker',
    description:
      'Add a worker to the site. For daily-wage (dihadi) workers give dailyRate. For contract ' +
      '(theka) work, the contract belongs to ONE person: set isThekedar true for the contractor ' +
      'and give either thekaAmount, or thekaRate plus thekaUnit. Everyone else working under that ' +
      'contractor is added with contractType "theka" and isThekedar false, and carries no amount ' +
      'of their own — their wages come from the contractor, not the site.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: "The worker's name." },
        trade: { type: 'string', description: 'Trade id or name, e.g. carpenter, mason.' },
        role: { type: 'string', enum: ['mistri', 'helper', 'thekedar'], description: "mistri (craftsman), helper, or thekedar — 'thekedar' is the same as sending isThekedar: true." },
        contractType: { type: 'string', enum: ['dihadi', 'theka'], description: 'Daily wage or contract. Default dihadi.' },
        dailyRate: { type: 'number', description: 'Rupees per day. Required for dihadi.' },
        isThekedar: { type: 'boolean', description: 'True only for the person who holds the contract.' },
        worksHimself: { type: 'boolean', description: 'For a thekedar: does he work the job himself, or only give out the contract? Default true.' },
        thekaAmount: { type: 'number', description: 'Lump-sum contract value. May be left out and filled in later.' },
        thekaRate: { type: 'number', description: 'Rate per unit, e.g. 25 for ₹25 per square ft.' },
        thekaUnit: { type: 'string', description: 'Unit for the rate, e.g. "square ft".' },
        thekaQuantity: { type: 'number', description: 'Measured quantity. Omit if not measured yet.' },
        thekaDescription: { type: 'string', description: 'What the contract covers.' },
        phone: { type: 'string', description: 'Mobile number.' }
      },
      required: ['name', 'trade']
    }
  },
  {
    name: 'mark_attendance',
    description:
      "Record one worker's attendance for a date: present, half day, or absent, with optional " +
      'overtime hours, and for an absence an optional reason. Overwrites whatever was recorded ' +
      'for that worker on that date.',
    inputSchema: {
      type: 'object',
      properties: {
        worker: { type: 'string', description: 'Worker name or id.' },
        status: { type: 'string', enum: ['present', 'half', 'absent'], description: 'Attendance for the day.' },
        date: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
        overtimeHours: { type: 'number', description: 'Extra hours worked beyond the normal day.' },
        reason: {
          type: 'string',
          description:
            'Why the worker was away. Only for status "absent", and always optional. Prefer one of ' +
            ABSENCE_REASONS.map(r => `"${r.id}" (${r.en})`).join(', ') +
            '; anything else is kept as free text.'
        }
      },
      required: ['worker', 'status']
    }
  },
  {
    name: 'mark_all_present',
    description:
      'Mark every worker present for a date — the usual morning action. Optionally limit to one trade. ' +
      'Does not disturb workers already marked half day or absent unless overwrite is true.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
        trade: { type: 'string', description: 'Optional trade filter.' },
        overwrite: { type: 'boolean', description: 'Also overwrite existing half-day/absent marks. Default false.' }
      }
    }
  },
  {
    name: 'add_expense',
    description:
      'Log money spent. Either against one worker (a cash advance, a recharge — counts toward what ' +
      'they have been paid) or against a trade group as a shared site cost (ration, cylinder, diesel, ' +
      'material). Give exactly one of worker or trade.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Rupees.' },
        type: {
          type: 'string',
          description: 'cash, recharge, ration, cylinder, diesel, material, other. Default cash.'
        },
        worker: { type: 'string', description: 'Worker this was paid to or spent on.' },
        trade: { type: 'string', description: 'Trade group this shared cost belongs to.' },
        note: { type: 'string', description: 'What it was for, in the user\'s own words.' },
        item: { type: 'string', description: 'Item name, for ration or material.' },
        quantity: { type: 'string', description: 'e.g. "10 kg", "1 cylinder".' },
        date: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' }
      },
      required: ['amount']
    }
  },
  {
    name: 'add_site_note',
    description:
      'Write a plain note about the site for a day — what stopped the work, who visited, what ' +
      'the weather did, anything worth remembering that is not attendance and not money. ' +
      "Record it in the user's own words, Hindi or English, including any time of day they " +
      'mention ("2:15 PM light chali gayi"). Use add_expense instead when money was spent, and ' +
      'mark_attendance when it is about who worked.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: "The note, in the user's own words." },
        date: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
        trade: { type: 'string', description: 'Only if the note is about one work group, e.g. the masons.' }
      },
      required: ['text']
    }
  },
  {
    name: 'update_worker',
    description:
      "Correct a worker's details: their name, daily rate, phone, trade, role, whether they hold "+
      'the contract, and the contract terms. Also moves someone between daily wages and '+
      'contract work — send contractType, or simply give a dailyRate to someone on contract, '+
      'which clears the contract and puts them on daily wages. Only the fields given change.',
    inputSchema: {
      type: 'object',
      properties: {
        worker: { type: 'string', description: 'Worker name or id.' },
        name: { type: 'string', description: 'Correct their name — use this to fix a typo instead of adding a second entry.' },
        dailyRate: { type: 'number', description: 'New daily wage. Giving this to someone on contract moves them to daily wages.' },
        contractType: { type: 'string', enum: ['dihadi', 'theka'], description: 'Move between daily wages and contract work.' },
        isThekedar: { type: 'boolean', description: 'Whether this person holds the contract.' },
        worksHimself: { type: 'boolean', description: 'For a thekedar: true if he works the job himself, false if he only gives out the contract.' },
        thekaRate: { type: 'number', description: 'Rate per unit for a measured contract, e.g. 25.' },
        thekaUnit: { type: 'string', description: 'Unit for that rate, e.g. "square ft".' },
        phone: { type: 'string', description: 'New mobile number.' },
        trade: { type: 'string', description: 'Move to a different trade.' },
        role: { type: 'string', enum: ['mistri', 'helper', 'thekedar'], description: "Change role. 'thekedar' also marks them as holding the contract." },
        thekaQuantity: { type: 'number', description: 'Measured quantity for a rate contract.' },
        thekaAmount: { type: 'number', description: 'New lump-sum contract value.' },
        thekaDescription: { type: 'string', description: 'What the contract covers.' }
      },
      required: ['worker']
    }
  },
  {
    name: 'remove_worker',
    description:
      'Remove a worker from the site. Use only when the user clearly means to delete the '+
      'person from the ledger, not merely to mark them absent or finished for the day. '+
      'Call it FIRST WITHOUT confirm: nothing is deleted and it reports exactly what would '+
      'be lost. Show that to the user, and only if they agree, call again with confirm set '+
      'to the full name exactly as stored. Money already paid to them stays in the accounts '+
      'under their name.',
    inputSchema: {
      type: 'object',
      properties: {
        worker: { type: 'string', description: 'Worker name or id.' },
        confirm: {
          type: 'string',
          description: "The worker's full name, exactly. Omit on the first call to see what would be lost."
        }
      },
      required: ['worker']
    }
  }
];

const writeHandlers = {
  async add_worker(args) {
    return mutateLedger(siteRef, (store) => {
      const name = String(args.name || '').trim();
      if (!name) throw new Error('The worker needs a name.');

      const existing = store.getWorkers().find(w => w.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        throw new Error(`"${name}" is already on the site (${store.getTrade(existing.tradeId).name}). Use update_worker to change their details.`);
      }

      const trade = findTrade(store, args.trade);
      // Saying someone holds the contract says the work is on contract. Making
      // the caller spell out both meant a thekedar sent with only the flag fell
      // through to the daily-wage branch and was refused for having no rate.
      // "Thekedar" is how people name the job, so accept it where a role goes
      // as well as through the flag. Underneath he is still a mistri who holds
      // the contract; the two are separate fields because a helper can hold one
      // too, but nobody should have to know that to add him.
      const roleIsThekedar = args.role === 'thekedar';
      const isThekedar = args.isThekedar === true || roleIsThekedar;
      const isTheka = isThekedar || args.contractType === 'theka';

      // A daily-wage worker without a rate earns nothing, which silently
      // understates what the site owes — refuse rather than write that.
      if (!isTheka && !(Number(args.dailyRate) > 0)) {
        throw new Error('A dihadi worker needs a dailyRate, otherwise their wages compute to zero.');
      }
      // A contract often gets agreed before its price does, and the work is
      // measured later. Refusing to record the man until the number exists put
      // the ledger behind the site, so let him in and say what is still missing.
      const amountSettled = Number(args.thekaAmount) > 0 || Number(args.thekaRate) > 0;

      const worker = store.addWorker({
        name,
        tradeId: trade.id,
        role: args.role === 'helper' ? 'helper' : 'mistri',  // 'thekedar' is carried by isThekedar
        contractType: isTheka ? 'theka' : 'dihadi',
        dailyRate: args.dailyRate,
        isThekedar,
        worksHimself: args.worksHimself,
        thekaMode: Number(args.thekaRate) > 0 ? 'rate' : 'lumpsum',
        thekaAmount: args.thekaAmount,
        thekaRate: args.thekaRate,
        thekaUnit: args.thekaUnit,
        thekaQuantity: args.thekaQuantity,
        thekaDescription: args.thekaDescription,
        phone: args.phone
      });

      return {
        added: worker.name,
        trade: trade.name,
        role: roleLabel(worker),
        contract: isTheka
          ? (isThekedar ? describeTheka(worker, 'en') : 'works under the contractor — carries no amount of their own')
          : `₹${worker.dailyRate}/day`,
        note: isThekedar && !amountSettled
          ? 'Added. The contract amount is not set yet — send it with update_worker '
            + '(thekaAmount for a lump sum, or thekaRate with thekaUnit) once it is agreed.'
          : 'Open the app on the phone to pull this in.'
      };
    });
  },

  async mark_attendance(args) {
    return mutateLedger(siteRef, (store) => {
      const worker = findWorker(store, args.worker);
      const date = validDate(args.date);
      const status = args.status === 'present' ? 1 : args.status === 'half' ? 0.5 : 0;
      const ot = Number(args.overtimeHours) || 0;
      const reason = String(args.reason || '').trim();

      if (status === 0 && ot > 0) {
        throw new Error('An absent worker cannot have overtime hours.');
      }
      if (status !== 0 && reason) {
        throw new Error('A reason belongs to an absence — a worker who turned up does not need one.');
      }

      store.setWorkerHaziri(date, worker.id, status, ot, reason);
      return {
        worker: worker.name,
        date,
        status: args.status,
        overtimeHours: ot,
        reason: reason ? absenceReasonLabel(reason, 'en') : undefined,
        note: 'Open the app on the phone to pull this in.'
      };
    });
  },

  async mark_all_present(args) {
    return mutateLedger(siteRef, (store) => {
      const date = validDate(args.date);
      const trade = args.trade ? findTrade(store, args.trade) : null;
      const workers = trade ? store.getWorkers(trade.id) : store.getWorkers();

      if (workers.length === 0) {
        throw new Error(trade ? `No workers in ${trade.name}.` : 'No workers on the site yet.');
      }

      const existing = store.getHaziri(date);
      const marked = [];
      const leftAlone = [];

      for (const w of workers) {
        const already = existing[w.id];
        // Someone deliberately marked half day or absent; do not quietly undo it.
        if (already && already.status !== 1 && !args.overwrite) {
          leftAlone.push(w.name);
          continue;
        }
        // Marking present drops any absence reason, which setWorkerHaziri does
        // for us — nothing to pass here.
        store.setWorkerHaziri(date, w.id, 1, already?.otHours || 0);
        marked.push(w.name);
      }

      return {
        date,
        trade: trade ? trade.name : 'all trades',
        markedPresent: marked,
        leftUnchanged: leftAlone.length
          ? { workers: leftAlone, reason: 'already marked half day or absent — pass overwrite: true to change them' }
          : undefined,
        note: 'Open the app on the phone to pull this in.'
      };
    });
  },

  async add_expense(args) {
    return mutateLedger(siteRef, (store) => {
      const amount = Number(args.amount);
      if (!(amount > 0)) throw new Error('Amount must be a positive number of rupees.');

      if (args.worker && args.trade) {
        throw new Error('Give either worker (paid to one person) or trade (a shared site cost), not both.');
      }
      if (!args.worker && !args.trade) {
        throw new Error('Who was this for? Give worker for a payment to one person, or trade for a shared cost.');
      }

      const date = validDate(args.date);
      let worker = null;
      let trade;

      if (args.worker) {
        worker = findWorker(store, args.worker);
        trade = store.getTrade(worker.tradeId);
      } else {
        trade = findTrade(store, args.trade);
      }

      const tx = store.addTransaction({
        date,
        type: args.type || 'cash',
        targetType: worker ? 'individual' : 'group',
        tradeId: trade.id,
        workerId: worker ? worker.id : null,
        amount,
        rationItem: args.item || '',
        quantity: args.quantity || '',
        note: args.note || ''
      });

      return {
        logged: `₹${amount.toLocaleString('en-IN')}`,
        type: getTxTypeLabel(tx.type, 'en'),
        paidTo: worker ? worker.name : `${trade.name} (shared)`,
        date,
        note: 'Open the app on the phone to pull this in.'
      };
    });
  },

  async add_site_note(args) {
    return mutateLedger(siteRef, (store) => {
      const text = String(args.text || '').trim();
      if (!text) throw new Error('What should the note say?');

      const date = validDate(args.date);
      // Optional: most notes are about the day, not about one group.
      const trade = args.trade ? findTrade(store, args.trade) : null;

      const note = store.addSiteNote({ date, text, tradeId: trade ? trade.id : null });

      return {
        wrote: note.text,
        date,
        trade: trade ? trade.name : null,
        note: 'Open the app on the phone to pull this in.'
      };
    });
  },

  async update_worker(args) {
    return mutateLedger(siteRef, (store) => {
      const worker = findWorker(store, args.worker);
      const updates = {};

      if (args.dailyRate !== undefined) {
        if (!(Number(args.dailyRate) >= 0)) throw new Error('dailyRate must be a number.');
        updates.dailyRate = Number(args.dailyRate);
      }
      if (args.name !== undefined) {
        const name = String(args.name).trim();
        if (!name) throw new Error('The name cannot be empty.');
        const clash = store.getWorkers()
          .find(w => w.id !== worker.id && w.name.toLowerCase() === name.toLowerCase());
        if (clash) throw new Error(`"${name}" is already someone else on this site.`);
        updates.name = name;
      }
      if (args.phone !== undefined) updates.phone = String(args.phone).trim();
      if (args.role !== undefined) {
        updates.role = args.role === 'helper' ? 'helper' : 'mistri';
        // Naming the role as thekedar is the same as saying he holds the contract.
        if (args.role === 'thekedar') { updates.isThekedar = true; updates.contractType = 'theka'; }
      }
      if (args.trade !== undefined) updates.tradeId = findTrade(store, args.trade).id;
      if (args.thekaDescription !== undefined) updates.thekaDescription = String(args.thekaDescription);

      /* Moving between contract kinds.

         People change how they are engaged mid-job, and there was no way to say
         so: setting a daily rate on a contract worker left him on contract with
         a rate nothing ever read. Either name the kind outright, or give a daily
         rate to someone on contract, which can only mean he is on daily wages
         now. Leaving contract means the contract itself is cleared — keeping a
         stale lakh on a day labourer would quietly wreck every total. */
      const wantsDihadi = args.contractType === 'dihadi'
        || (args.contractType === undefined && worker.contractType === 'theka' && Number(args.dailyRate) > 0);
      const wantsTheka = args.contractType === 'theka' || args.isThekedar === true;

      if (wantsDihadi && worker.contractType === 'theka') {
        updates.contractType = 'dihadi';
        updates.isThekedar = false;
        updates.thekaMode = null;
        updates.thekaAmount = 0;
        updates.thekaRate = 0;
        updates.thekaUnit = '';
        updates.thekaQuantity = 0;
        if (!(Number(args.dailyRate) > 0) && !(Number(worker.dailyRate) > 0)) {
          throw new Error(
            `${worker.name} would move to daily wages with no rate, so their wages would ` +
            'compute to zero. Send dailyRate as well.'
          );
        }
      } else if (wantsTheka && worker.contractType !== 'theka') {
        updates.contractType = 'theka';
        updates.dailyRate = 0;
      }

      if (args.isThekedar !== undefined) {
        updates.isThekedar = args.isThekedar === true;
        if (updates.isThekedar) updates.contractType = 'theka';
      }

      if (args.worksHimself !== undefined) {
        const willHold = updates.isThekedar !== undefined ? updates.isThekedar : worker.isThekedar;
        if (!willHold) {
          throw new Error(`${worker.name} does not hold a contract, so there is nothing to say about whether he works it himself.`);
        }
        updates.worksHimself = args.worksHimself === true;
      }

      if (args.thekaQuantity !== undefined || args.thekaAmount !== undefined
          || args.thekaRate !== undefined || args.thekaUnit !== undefined) {
        const willHoldContract = updates.isThekedar !== undefined ? updates.isThekedar : worker.isThekedar;
        if (!willHoldContract) {
          throw new Error(
            `${worker.name} does not hold a contract — only the thekedar carries an amount. ` +
            'Send isThekedar: true in the same call if they should.'
          );
        }
        if (args.thekaQuantity !== undefined) updates.thekaQuantity = Number(args.thekaQuantity) || 0;
        if (args.thekaAmount !== undefined) {
          updates.thekaAmount = Number(args.thekaAmount) || 0;
          updates.thekaMode = 'lumpsum';
        }
        if (args.thekaRate !== undefined) {
          updates.thekaRate = Number(args.thekaRate) || 0;
          updates.thekaMode = 'rate';
        }
        if (args.thekaUnit !== undefined) updates.thekaUnit = String(args.thekaUnit).trim();
      }

      if (Object.keys(updates).length === 0) {
        throw new Error('Nothing to change — give at least one field to update.');
      }

      const updated = store.updateWorker(worker.id, updates);
      return {
        worker: updated.name,
        changed: Object.keys(updates),
        role: roleLabel(updated),
        contract: updated.contractType === 'theka' ? describeTheka(updated, 'en') : `₹${updated.dailyRate}/day`,
        note: 'Open the app on the phone to pull this in.'
      };
    });
  },
  /* Deleting is the one write here that cannot be undone from a chat, so it
     takes two turns: the first says what would go, the second does it. The
     confirmation is the full name rather than a bare yes, so a sentence that
     named the wrong person cannot be waved through by a reflexive 'haan'. */
  async remove_worker(args) {
    const store = await getStore();
    const worker = findWorker(store, args.worker);

    const days = Object.values(store.activeProject().haziri || {})
      .filter(day => day && day[worker.id]).length;
    const txs = (store.activeProject().transactions || [])
      .filter(t => t.workerId === worker.id);
    const paid = txs.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    if (String(args.confirm || '').trim() !== worker.name) {
      return {
        willDelete: worker.name,
        trade: store.getTrade(worker.tradeId)?.name || worker.tradeId,
        attendanceDaysLost: days,
        paymentsKept: txs.length,
        amountKept: rupees(paid),
        deleted: false,
        note:
          `Nothing has been deleted. ${days} day(s) of attendance for ${worker.name} would be ` +
          `erased. ${txs.length} payment(s) totalling ${rupees(paid)} would stay in the accounts ` +
          `under their name. Ask the user to confirm, then call again with confirm: "${worker.name}".`
      };
    }

    return mutateLedger({ ...siteRef, allowShrink: true }, (s2) => {
      const target = findWorker(s2, worker.id);
      s2.deleteWorker(target.id);
      return {
        deleted: target.name,
        attendanceDaysErased: days,
        paymentsKept: txs.length,
        amountKept: rupees(paid),
        note: 'Open the app on the phone to pull this in.'
      };
    });
  }
};

/* Read-only mode drops the write tools entirely, so Claude never sees a
   capability it is not allowed to use. */
export const ALL_TOOLS = READ_ONLY ? TOOLS : [...TOOLS, ...WRITE_TOOLS];
const ALL_HANDLERS = READ_ONLY ? handlers : { ...handlers, ...writeHandlers };

export { READ_ONLY };

/* The names that change data. The HTTP front end keeps its own, stricter
   default about whether those are allowed at all. */
export const WRITE_TOOL_NAMES = WRITE_TOOLS.map(t => t.name);

/**
 * Runs one tool and returns an MCP tool result. Shared by both front ends —
 * the stdio server people run on a laptop, and the HTTP function the phone
 * talks to — so neither can answer a question differently from the other.
 */
export async function callTool(name, args) {
  const handler = ALL_HANDLERS[name];
  if (!handler) {
    return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  }
  try {
    const result = await handler(args || {});
    // A write changes the ledger the read tools cache; drop it so a follow-up
    // question does not answer from the state before the change.
    if (writeHandlers[name]) client._cache = null;
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
}
