// Shared view rules. A missing attendance record is pending, never absent.
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
