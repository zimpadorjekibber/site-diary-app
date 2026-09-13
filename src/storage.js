// src/storage.js
// LocalStorage data layer for Shram & Site Diary

const STORAGE_KEY = 'site_diary_data_v1';

const DEFAULT_TRADES = [
  { id: 'carpenter', name: 'Carpenter (बढ़ई)', icon: 'hammer', color: '#f59e0b' },
  { id: 'mason', name: 'Mason (राजमिस्त्री)', icon: 'brick-wall', color: '#ef4444' },
  { id: 'plumber', name: 'Plumber (प्लंबर)', icon: 'wrench', color: '#06b6d4' },
  { id: 'painter', name: 'Painter (पेंटर)', icon: 'paint-brush', color: '#8b5cf6' },
  { id: 'electrician', name: 'Electrician (बिजली मिस्त्री)', icon: 'zap', color: '#eab308' },
  { id: 'tile', name: 'Tile & Marble (टाइल मिस्त्री)', icon: 'grid', color: '#10b981' }
];

const DEFAULT_WORKERS = [
  { id: 'w1', name: 'Ramesh Sharma', tradeId: 'carpenter', role: 'mistri', contractType: 'dihadi', dailyRate: 900, phone: '9876543210' },
  { id: 'w2', name: 'Mohan Lal', tradeId: 'carpenter', role: 'helper', contractType: 'dihadi', dailyRate: 550, phone: '9876543211' },
  { id: 'w3', name: 'Sonu', tradeId: 'carpenter', role: 'helper', contractType: 'dihadi', dailyRate: 500, phone: '' },
  { id: 'w4', name: 'Vikram Singh', tradeId: 'mason', role: 'mistri', contractType: 'dihadi', dailyRate: 950, phone: '9876543212' },
  { id: 'w5', name: 'Ramu Paswan', tradeId: 'mason', role: 'helper', contractType: 'dihadi', dailyRate: 550, phone: '9876543213' },
  { id: 'w6', name: 'Dinesh Plumber (ठेका)', tradeId: 'plumber', role: 'mistri', contractType: 'theka', dailyRate: 0, thekaAmount: 35000, thekaDescription: 'पूरे घर का नल व बाथरूम फिटिंग ठेका', phone: '9876543214' },
  { id: 'w7', name: 'Ajay Painter', tradeId: 'painter', role: 'mistri', contractType: 'dihadi', dailyRate: 850, phone: '9876543215' },
  { id: 'w8', name: 'Bablu', tradeId: 'painter', role: 'helper', contractType: 'dihadi', dailyRate: 500, phone: '' }
];

function getTodayString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const DEFAULT_SETTINGS = {
  eveningReminderTime: '19:30', // 7:30 PM
  reminderEnabled: true,
  soundEnabled: true,
  currency: '₹',
  language: 'hi-IN' // for speech recognition
};

// Seed initial sample transactions for today to give the user immediate interactive context
function getInitialSeedTransactions() {
  const today = getTodayString();
  return [
    {
      id: 'tx_1',
      date: today,
      time: '09:30',
      type: 'cash',
      targetType: 'individual', // 'individual' or 'group'
      tradeId: 'carpenter',
      workerId: 'w1', // Ramesh Mistri
      amount: 500,
      subType: 'advance',
      note: 'सुबह काम शुरू करने से पहले पेशगी (Advance)'
    },
    {
      id: 'tx_2',
      date: today,
      time: '11:15',
      type: 'ration',
      targetType: 'group', // Entire group
      tradeId: 'carpenter',
      rationItem: 'Atta (आटा)',
      quantity: '10 kg',
      amount: 380,
      note: 'बढ़ई ग्रुप के लिए 10 किलो आटा'
    },
    {
      id: 'tx_3',
      date: today,
      time: '13:45',
      type: 'recharge',
      targetType: 'individual',
      tradeId: 'mason',
      workerId: 'w5', // Ramu Helper
      amount: 299,
      note: 'रामू हेल्पर का 28 दिन का जिओ रिचार्ज'
    },
    {
      id: 'tx_4',
      date: today,
      time: '15:20',
      type: 'ration',
      targetType: 'group',
      tradeId: 'mason',
      rationItem: 'Gas Cylinder (गैस सिलेंडर)',
      quantity: '1 Cylinder',
      amount: 920,
      note: 'राजमिस्त्री ग्रुप के चूल्हे के लिए गैस सिलेंडर'
    }
  ];
}

// Initial attendance for past days of the month to showcase monthly sheet
function getInitialSeedHaziri() {
  const today = getTodayString();
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const haziriMap = {};

  // Populate days 1 to current day
  const currentDay = d.getDate();
  for (let day = 1; day <= currentDay; day++) {
    const dayStr = String(day).padStart(2, '0');
    const dateKey = `${year}-${month}-${dayStr}`;
    const dayOfWeek = new Date(year, d.getMonth(), day).getDay();

    if (dayOfWeek === 0) {
      // Sunday - Chhutti / Absent
      haziriMap[dateKey] = {
        'w1': { status: 0, otHours: 0 },
        'w2': { status: 0, otHours: 0 },
        'w3': { status: 0, otHours: 0 },
        'w4': { status: 0, otHours: 0 },
        'w5': { status: 0, otHours: 0 },
        'w6': { status: 0, otHours: 0 }, // Theka absent
        'w7': { status: 0, otHours: 0 },
        'w8': { status: 0, otHours: 0 }
      };
    } else {
      haziriMap[dateKey] = {
        'w1': { status: 1.0, otHours: day % 4 === 0 ? 2 : 0 },
        'w2': { status: 1.0, otHours: 0 },
        'w3': { status: day % 3 === 0 ? 0.5 : 1.0, otHours: 0 },
        'w4': { status: 1.0, otHours: day % 5 === 0 ? 1 : 0 },
        'w5': { status: day % 6 === 0 ? 0 : 1.0, otHours: 0 },
        'w6': { status: day % 4 === 0 ? 0 : 1.0, otHours: 0 }, // Theka presence/absence
        'w7': { status: 1.0, otHours: 0 },
        'w8': { status: day % 5 === 0 ? 0 : 1.0, otHours: 0 }
      };
    }
  }

  // Ensure today has specific entries
  haziriMap[today] = {
    'w1': { status: 1.0, otHours: 0 },
    'w2': { status: 1.0, otHours: 0 },
    'w3': { status: 0.5, otHours: 0 },
    'w4': { status: 1.0, otHours: 1 },
    'w5': { status: 1.0, otHours: 0 },
    'w6': { status: 1.0, otHours: 0 },
    'w7': { status: 1.0, otHours: 0 },
    'w8': { status: 0, otHours: 0 }
  };

  return haziriMap;
}

export class Store {
  constructor() {
    this.data = this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.workers && parsed.trades) {
          // If existing haziri has less than 5 dates, merge with seed so full month is visible
          if (!parsed.haziri || Object.keys(parsed.haziri).length < 5) {
            parsed.haziri = { ...getInitialSeedHaziri(), ...(parsed.haziri || {}) };
            this.save(parsed);
          }
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to load from storage, using defaults:', e);
    }

    const initial = {
      trades: DEFAULT_TRADES,
      workers: DEFAULT_WORKERS,
      transactions: getInitialSeedTransactions(),
      haziri: getInitialSeedHaziri(),
      diaryNotedDates: {}, // { "2026-09-12": timestamp }
      settings: DEFAULT_SETTINGS
    };
    this.save(initial);
    return initial;
  }

  save(data = this.data) {
    this.data = data;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
    }
  }

  // --- TRADES ---
  getTrades() {
    return this.data.trades;
  }

  addTrade(name, icon = 'briefcase', color = '#f59e0b') {
    const id = 'trade_' + Date.now();
    this.data.trades.push({ id, name, icon, color });
    this.save();
    return id;
  }

  getTrade(id) {
    return this.data.trades.find(t => t.id === id) || { id, name: 'Unknown Trade', color: '#64748b' };
  }

  // --- WORKERS ---
  getWorkers(tradeId = null) {
    if (!tradeId || tradeId === 'all') return this.data.workers;
    return this.data.workers.filter(w => w.tradeId === tradeId);
  }

  getWorker(id) {
    return this.data.workers.find(w => w.id === id);
  }

  addWorker({ name, tradeId, role, contractType, dailyRate, thekaAmount, thekaDescription, phone, photoUrl }) {
    const id = 'w_' + Date.now();
    const isTheka = contractType === 'theka';
    const worker = {
      id,
      name: name.trim(),
      tradeId,
      role: role || 'mistri', // 'mistri' or 'helper'
      contractType: isTheka ? 'theka' : 'dihadi',
      dailyRate: isTheka ? 0 : (Number(dailyRate) || 0),
      thekaAmount: isTheka ? (Number(thekaAmount) || 0) : 0,
      thekaDescription: (thekaDescription || '').trim(),
      phone: (phone || '').trim(),
      photoUrl: photoUrl || null
    };
    this.data.workers.push(worker);
    this.save();
    return worker;
  }

  updateWorker(id, updates) {
    const idx = this.data.workers.findIndex(w => w.id === id);
    if (idx !== -1) {
      this.data.workers[idx] = { ...this.data.workers[idx], ...updates };
      this.save();
      return this.data.workers[idx];
    }
    return null;
  }

  deleteWorker(id) {
    this.data.workers = this.data.workers.filter(w => w.id !== id);
    this.save();
  }

  // --- TRANSACTIONS ---
  getTransactions(date = null) {
    if (!date) return this.data.transactions;
    return this.data.transactions.filter(t => t.date === date);
  }

  addTransaction(tx) {
    const newTx = {
      id: 'tx_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      date: tx.date || getTodayString(),
      time: tx.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: tx.type || 'cash', // 'cash' | 'ration' | 'recharge' | 'other'
      targetType: tx.targetType || 'individual', // 'individual' | 'group'
      tradeId: tx.tradeId,
      workerId: tx.targetType === 'individual' ? tx.workerId : null,
      amount: Number(tx.amount) || 0,
      rationItem: tx.rationItem || '',
      quantity: tx.quantity || '',
      subType: tx.subType || 'general',
      note: tx.note || '',
      audioDataUrl: tx.audioDataUrl || null // backup voice audio recording
    };
    this.data.transactions.unshift(newTx);
    this.save();
    return newTx;
  }

  deleteTransaction(id) {
    this.data.transactions = this.data.transactions.filter(t => t.id !== id);
    this.save();
  }

  // --- HAZIRI (ATTENDANCE) ---
  getHaziri(date = getTodayString()) {
    return this.data.haziri[date] || {};
  }

  setWorkerHaziri(date, workerId, status, otHours = 0) {
    if (!this.data.haziri[date]) {
      this.data.haziri[date] = {};
    }
    this.data.haziri[date][workerId] = {
      status: Number(status), // 1.0 (full), 0.5 (half), 0 (absent)
      otHours: Number(otHours) || 0
    };
    this.save();
  }

  // --- MONTHLY HAZIRI / MUSTER ROLL ---
  getMonthlyHaziri(year, month) {
    // year: e.g. 2026, month: 1 to 12
    const daysInMonth = new Date(year, month, 0).getDate();
    const days = [];
    const hindiDayNames = ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि'];

    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = String(day).padStart(2, '0');
      const monthStr = String(month).padStart(2, '0');
      const dateStr = `${year}-${monthStr}-${dayStr}`;
      const d = new Date(year, month - 1, day);
      const dayOfWeek = hindiDayNames[d.getDay()];
      days.push({ day, dateStr, dayOfWeek, isSunday: d.getDay() === 0 });
    }

    const workers = this.getWorkers();
    const rows = workers.map(worker => {
      let totalPresent = 0;
      let totalAbsent = 0;
      let totalOtHours = 0;
      const dailyStatuses = {};

      days.forEach(({ dateStr }) => {
        const dayHaziri = this.data.haziri[dateStr];
        const record = dayHaziri ? dayHaziri[worker.id] : null;
        if (record) {
          dailyStatuses[dateStr] = record;
          if (record.status > 0) {
            totalPresent += record.status;
            if (record.otHours > 0) totalOtHours += record.otHours;
          } else if (record.status === 0) {
            totalAbsent += 1;
          }
        } else {
          dailyStatuses[dateStr] = null;
        }
      });

      const isTheka = worker.contractType === 'theka';
      let totalEarnedMonth = 0;
      if (!isTheka) {
        totalEarnedMonth = totalPresent * (worker.dailyRate || 0);
        if (totalOtHours > 0) {
          totalEarnedMonth += totalOtHours * ((worker.dailyRate || 0) / 8);
        }
      } else {
        totalEarnedMonth = worker.thekaAmount || 0;
      }

      // Payments made in this month
      const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
      const workerMonthTxs = this.data.transactions.filter(t => t.workerId === worker.id && t.date.startsWith(monthPrefix));
      const totalPaidMonth = workerMonthTxs.reduce((sum, t) => sum + (t.amount || 0), 0);

      return {
        worker,
        trade: this.getTrade(worker.tradeId),
        isTheka,
        dailyStatuses,
        totalPresent,
        totalAbsent,
        totalOtHours,
        totalEarnedMonth,
        totalPaidMonth,
        netBalance: isTheka ? ((worker.thekaAmount || 0) - totalPaidMonth) : (totalEarnedMonth - totalPaidMonth)
      };
    });

    return {
      year,
      month,
      daysInMonth,
      days,
      rows
    };
  }

  // --- DIARY MARKED TRACKER ---
  isDateMarkedInDiary(date = getTodayString()) {
    return !!this.data.diaryNotedDates[date];
  }

  setMarkedInDiary(date = getTodayString(), marked = true) {
    if (marked) {
      this.data.diaryNotedDates[date] = Date.now();
    } else {
      delete this.data.diaryNotedDates[date];
    }
    this.save();
  }

  // --- SETTINGS ---
  getSettings() {
    return this.data.settings;
  }

  updateSettings(updates) {
    this.data.settings = { ...this.data.settings, ...updates };
    this.save();
    return this.data.settings;
  }

  // --- LEDGER STATS CALCULATION ---
  getWorkerLedger(workerId) {
    const worker = this.getWorker(workerId);
    if (!worker) return null;

    const isTheka = worker.contractType === 'theka';

    // Attendance and absence tracking
    let totalHaziriDays = 0;
    let totalAbsentDays = 0;
    let totalEarned = 0;
    const absentDates = [];

    Object.keys(this.data.haziri).forEach(date => {
      const record = this.data.haziri[date][workerId];
      if (record) {
        if (record.status > 0) {
          totalHaziriDays += record.status;
          if (!isTheka) {
            totalEarned += record.status * (worker.dailyRate || 0);
            if (record.otHours > 0) {
              const hourlyRate = (worker.dailyRate || 0) / 8;
              totalEarned += record.otHours * hourlyRate;
            }
          }
        } else if (record.status === 0) {
          totalAbsentDays += 1;
          absentDates.push(date);
        }
      }
    });

    if (isTheka) {
      totalEarned = worker.thekaAmount || 0;
    }

    // Individual transactions (Cash + Recharge)
    const workerTxs = this.data.transactions.filter(t => t.workerId === workerId);
    const totalCashPaid = workerTxs
      .filter(t => t.type === 'cash')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    const totalRechargePaid = workerTxs
      .filter(t => t.type === 'recharge')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    const totalIndividualGiven = totalCashPaid + totalRechargePaid;

    const balanceDue = totalEarned - totalIndividualGiven;

    const totalDaysTracked = totalHaziriDays + totalAbsentDays;
    const presenceRate = totalDaysTracked > 0 ? Math.round((totalHaziriDays / totalDaysTracked) * 100) : 100;

    return {
      worker,
      isTheka,
      totalHaziriDays,
      totalAbsentDays,
      absentDates,
      totalDaysTracked,
      presenceRate,
      thekaAmount: worker.thekaAmount || 0,
      thekaDescription: worker.thekaDescription || '',
      totalEarned,
      totalCashPaid,
      totalRechargePaid,
      totalIndividualGiven,
      balanceDue,
      transactions: workerTxs
    };
  }

  getGroupLedger(tradeId) {
    const trade = this.getTrade(tradeId);
    const workers = this.getWorkers(tradeId);
    const groupTxs = this.data.transactions.filter(t => t.tradeId === tradeId && t.targetType === 'group');

    const totalGroupRationCost = groupTxs
      .filter(t => t.type === 'ration')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const rationItemsBreakdown = {};
    groupTxs.filter(t => t.type === 'ration').forEach(t => {
      const key = t.rationItem || 'Miscellaneous';
      if (!rationItemsBreakdown[key]) {
        rationItemsBreakdown[key] = { name: key, count: 0, totalAmount: 0, details: [] };
      }
      rationItemsBreakdown[key].count += 1;
      rationItemsBreakdown[key].totalAmount += t.amount;
      rationItemsBreakdown[key].details.push(t.quantity ? `${t.quantity} (₹${t.amount})` : `₹${t.amount}`);
    });

    return {
      trade,
      workers,
      mistriCount: workers.filter(w => w.role === 'mistri').length,
      helperCount: workers.filter(w => w.role === 'helper').length,
      totalGroupRationCost,
      rationItemsBreakdown,
      groupTransactions: groupTxs
    };
  }

  exportData() {
    return JSON.stringify(this.data, null, 2);
  }

  importData(jsonString) {
    try {
      const parsed = JSON.parse(jsonString);
      if (parsed.workers && parsed.trades && parsed.transactions) {
        this.data = parsed;
        this.save();
        return true;
      }
    } catch (e) {
      console.error('Import failed', e);
    }
    return false;
  }
}

export const store = new Store();
export { getTodayString };
