// Shared view rules. A missing attendance record is pending, never absent.
// 'trade' covers everything spent on a trade: its workers' payments and its shared supplies.
// tradeOf lets old entries saved without a tradeId fall back to their worker's trade.
export function filterRecipient(transactions, targetType = 'all', recipientId = '', tradeOf = tx => tx.tradeId) {
  return transactions.filter(tx => targetType === 'all' || (targetType === 'trade'
    ? (!recipientId || tradeOf(tx) === recipientId)
    : tx.targetType !== 'group' && !!tx.workerId && (!recipientId || tx.workerId === recipientId)));
}

export function transactionHistory(transactions, { targetType, recipientId, from = '', to = '', type = '' }) {
  const entries = transactions.filter(tx =>
    (targetType === 'group' ? tx.targetType === 'group' && tx.tradeId === recipientId : tx.targetType !== 'group' && tx.workerId === recipientId) &&
    (!from || tx.date >= from) && (!to || tx.date <= to) && (!type || tx.type === type)
  ).sort((a, b) => b.date.localeCompare(a.date));
  const days = [];
  for (const tx of entries) {
    let day = days.at(-1);
    if (!day || day.date !== tx.date) { day = { date: tx.date, total: 0, entries: [] }; days.push(day); }
    day.entries.push(tx);
    day.total += Number(tx.amount) || 0;
  }
  return { days, count: entries.length, total: days.reduce((sum, day) => sum + day.total, 0) };
}

export function attendanceSummary(workers, records) {
  const result = { total: workers.length, full: 0, half: 0, absent: 0, pending: 0, marked: 0 };
  for (const worker of workers) {
    const record = records[worker.id];
    if (!record || ![0, 0.5, 1].includes(record.status)) result.pending++;
    else {
      result.marked++;
      result[record.status === 1 ? 'full' : record.status === 0.5 ? 'half' : 'absent']++;
    }
  }
  return result;
}

export function attendanceWorkers(workers, trades) {
  const suppliers = new Set(trades.filter(t => t.isSupplier).map(t => t.id));
  return workers.filter(w => !suppliers.has(w.tradeId) && !(w.isThekedar && w.worksHimself === false));
}

export function validatePayment(draft, workers, trades, today) {
  if (!Number.isFinite(Number(draft.amount)) || Number(draft.amount) <= 0) return 'amount';
  const date = new Date(`${draft.date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date || '') || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== draft.date || draft.date > today) return 'date';
  if (draft.targetType === 'individual' && !workers.some(w => w.id === draft.workerId)) return 'worker';
  if (draft.targetType === 'group' && !trades.some(t => t.id === draft.tradeId)) return 'trade';
  return null;
}
