// src/storage.js
// LocalStorage data layer for Shram & Site Diary

const STORAGE_KEY = 'site_diary_data_v1';

const DEFAULT_TRADES = [
  { id: 'carpenter', name: 'Carpenter (बढ़ई)', icon: '🔨', color: '#f59e0b' },
  { id: 'mason', name: 'Mason (राजमिस्त्री)', icon: '🧱', color: '#ef4444' },
  { id: 'plumber', name: 'Plumber (प्लंबर)', icon: '🔧', color: '#06b6d4' },
  { id: 'painter', name: 'Painter (पेंटर)', icon: '🎨', color: '#8b5cf6' },
  { id: 'electrician', name: 'Electrician (बिजली मिस्त्री)', icon: '⚡', color: '#eab308' },
  { id: 'tile', name: 'Tile & Marble (टाइल मिस्त्री)', icon: '🔲', color: '#10b981' }
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

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBWCY6fp7P1i5ubqG_OXV74Aq9fGeyrzOQ",
  authDomain: "khalen-dairy.firebaseapp.com",
  projectId: "khalen-dairy",
  storageBucket: "khalen-dairy.firebasestorage.app",
  messagingSenderId: "54398896553",
  appId: "1:54398896553:web:f282e56dd060a624f35cb8",
  measurementId: "G-XE1YCNYJRB"
};

const SITE_ID_KEY = 'site_diary_site_id_v1';
const DEVICE_ID_KEY = 'site_diary_device_id_v1';

function randomCode(len = 4) {
  // Avoids look-alike characters (0/O, 1/I) so a contractor can read it off a screen aloud.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

// Every install gets its OWN cloud document. Previously all installs shared one
// hardcoded id, so each site silently overwrote every other site's ledger.
function getOrCreateSiteId() {
  try {
    const existing = localStorage.getItem(SITE_ID_KEY);
    if (existing) return existing;
    const fresh = `site-${randomCode(4)}-${randomCode(4)}`;
    localStorage.setItem(SITE_ID_KEY, fresh);
    return fresh;
  } catch {
    return `site-${randomCode(4)}-${randomCode(4)}`;
  }
}

// Identifies this phone/browser so realtime sync can ignore the echo of its own writes.
export function getDeviceId() {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const fresh = `dev-${randomCode(6)}-${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    return `dev-${randomCode(6)}`;
  }
}

const DEFAULT_SETTINGS = {
  eveningReminderTime: '19:30', // 7:30 PM
  reminderEnabled: true,
  soundEnabled: true,
  currency: '₹',
  language: 'hi-IN', // for speech recognition
  otHoursPerDay: 8, // divisor used to convert a daily rate into an hourly OT rate
  firebaseConfig: DEFAULT_FIREBASE_CONFIG,
  firebaseSiteId: '', // filled from getOrCreateSiteId() on first load
  firebaseAutoSync: true,
  lastFirebaseSync: null
};

/* ===================================================
   TRANSACTION TYPES — single source of truth
   Every screen (stats, diary slip, ledger, filters) reads this list, so adding a
   type here makes it count everywhere instead of being silently dropped.
=================================================== */
export const TX_TYPES = [
  { id: 'cash',     icon: '💵', hi: 'नकद पेशगी',    en: 'Cash Advance',  scope: 'worker' },
  { id: 'recharge', icon: '📱', hi: 'मोबाइल रिचार्ज', en: 'Recharge',      scope: 'worker' },
  { id: 'ration',   icon: '🍚', hi: 'राशन',          en: 'Ration',        scope: 'site'   },
  { id: 'cylinder', icon: '🔥', hi: 'गैस सिलेंडर',    en: 'Gas Cylinder',  scope: 'site'   },
  { id: 'diesel',   icon: '⛽', hi: 'डीजल',          en: 'Diesel',        scope: 'site'   },
  { id: 'material', icon: '🧱', hi: 'सामान',         en: 'Material',      scope: 'site'   },
  { id: 'other',    icon: '📝', hi: 'अन्य खर्च',      en: 'Other',         scope: 'site'   }
];

export function getCustomTxTypes() {
  try {
    const raw = JSON.parse(localStorage.getItem('custom_tx_types') || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function getAllTxTypes() {
  const custom = getCustomTxTypes().map(t => ({
    id: t.id || t.type,
    icon: t.icon || '🏷️',
    hi: t.name || t.label || t.id,
    en: t.name || t.label || t.id,
    scope: 'site',
    custom: true
  }));
  return [...TX_TYPES, ...custom.filter(c => c.id && !TX_TYPES.some(b => b.id === c.id))];
}

export function getTxTypeMeta(typeId) {
  return getAllTxTypes().find(t => t.id === typeId)
    || { id: typeId, icon: '🏷️', hi: typeId, en: typeId, scope: 'site' };
}

export function getTxTypeLabel(typeId, lang = 'hi') {
  const meta = getTxTypeMeta(typeId);
  return lang === 'en' ? meta.en : meta.hi;
}

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

/* Anything logged against a named worker counts as money that worker received —
   cash, recharge, or a bag of cement bought in their name. The old code only
   counted cash+recharge in the ledger but counted everything in the muster roll,
   so the same worker showed two different balances on two screens. */
function sumWorkerPayments(txs) {
  return txs
    .filter(t => t.targetType !== 'group')
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
}

export class Store {
  constructor() {
    this.data = this.load();
  }

  getOtHoursPerDay() {
    const n = Number(this.data?.settings?.otHoursPerDay);
    return n > 0 ? n : 8;
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.workers && parsed.trades) {
          // If existing haziri has less than 5 dates and not clean-started, merge with seed
          if (!parsed.isCleanStarted && (!parsed.haziri || Object.keys(parsed.haziri).length < 5)) {
            parsed.haziri = { ...getInitialSeedHaziri(), ...(parsed.haziri || {}) };
            this.save(parsed);
          }
          parsed.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
          let needsSave = false;
          if (!parsed.settings.firebaseConfig || !parsed.settings.firebaseConfig.apiKey) {
            parsed.settings.firebaseConfig = DEFAULT_FIREBASE_CONFIG;
            parsed.settings.firebaseAutoSync = true;
            needsSave = true;
          }
          // Migration: installs created before per-site ids all pointed at the same
          // shared document. Move them onto their own, keeping a custom id if set.
          if (!parsed.settings.firebaseSiteId || parsed.settings.firebaseSiteId === 'khalen-dairy') {
            parsed.settings.firebaseSiteId = getOrCreateSiteId();
            needsSave = true;
          }
          // A restored-from-cloud payload used to lose this flag, which let the demo
          // seed below re-inject 8 fake workers into a real site's register.
          if (parsed.workers.length > 0 && !parsed.workers.some(w => String(w.id).startsWith('w') && w.id.length <= 3)) {
            parsed.isCleanStarted = true;
            needsSave = true;
          }
          if (needsSave) this.save(parsed);
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
      settings: { ...DEFAULT_SETTINGS, firebaseSiteId: getOrCreateSiteId() }
    };
    this.save(initial);
    return initial;
  }

  // Called with a user-facing message whenever a write could not be persisted.
  // Silently swallowing these was losing entries once the 5MB quota filled up.
  onSaveError(handler) {
    this._saveErrorHandler = handler;
  }

  save(data = this.data) {
    this.data = data;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      this._lastSaveFailed = false;
      return true;
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
      // Quota is the realistic failure here: voice clips and worker photos are
      // stored inline as base64. Drop the heaviest optional data and retry once
      // so the ledger itself — the part that matters — still gets written.
      const recovered = this.trySaveAfterFreeingSpace(data);
      if (!recovered && this._saveErrorHandler && !this._lastSaveFailed) {
        this._lastSaveFailed = true;
        this._saveErrorHandler(e);
      }
      return recovered;
    }
  }

  trySaveAfterFreeingSpace(data) {
    try {
      let freedAudio = 0;
      (data.transactions || []).forEach(tx => {
        if (tx.audioDataUrl) {
          tx.audioDataUrl = null;
          freedAudio++;
        }
      });
      if (freedAudio === 0) return false;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      if (this._saveErrorHandler) {
        this._saveErrorHandler(null, {
          recovered: true,
          droppedAudio: freedAudio
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  // Rough byte size of the stored payload, used by the Settings storage meter.
  getStorageUsage() {
    try {
      const bytes = new Blob([JSON.stringify(this.data)]).size;
      const limit = 5 * 1024 * 1024; // browsers typically allow ~5MB per origin
      return {
        bytes,
        limit,
        percent: Math.min(100, Math.round((bytes / limit) * 100)),
        readable: bytes > 1024 * 1024
          ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
          : `${Math.round(bytes / 1024)} KB`
      };
    } catch {
      return { bytes: 0, limit: 0, percent: 0, readable: '—' };
    }
  }

  resetToClean() {
    this.data = {
      trades: (this.data && this.data.trades && this.data.trades.length > 0) ? this.data.trades : DEFAULT_TRADES,
      workers: [],
      transactions: [],
      haziri: {},
      diaryNotedDates: {},
      settings: (this.data && this.data.settings) ? this.data.settings : DEFAULT_SETTINGS,
      isCleanStarted: true
    };
    this.save();
    return this.data;
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

  // Refuses to orphan workers. Deleting a trade used to leave its workers pointing
  // at a trade that no longer exists, so they showed up as "Unknown Trade" while
  // still being counted in every total.
  deleteTrade(id) {
    const attached = this.getWorkers(id);
    if (attached.length > 0) {
      return { ok: false, reason: 'has_workers', workers: attached };
    }
    this.data.trades = this.data.trades.filter(t => t.id !== id);
    this.save();
    return { ok: true };
  }

  moveTradeWorkers(fromTradeId, toTradeId) {
    this.data.workers.forEach(w => {
      if (w.tradeId === fromTradeId) w.tradeId = toTradeId;
    });
    (this.data.transactions || []).forEach(tx => {
      if (tx.tradeId === fromTradeId) tx.tradeId = toTradeId;
    });
    this.save();
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
      const oldTradeId = this.data.workers[idx].tradeId;
      this.data.workers[idx] = { ...this.data.workers[idx], ...updates };

      // If tradeId changed, also update all individual transactions for this worker so they belong to the new trade
      if (updates.tradeId && updates.tradeId !== oldTradeId && this.data.transactions) {
        this.data.transactions.forEach(tx => {
          if (tx.workerId === id) {
            tx.tradeId = updates.tradeId;
          }
        });
      }

      this.save();
      return this.data.workers[idx];
    }
    return null;
  }

  // Keeps the money history (it really happened) but stamps the name onto each
  // transaction first, so the timeline shows "Ramesh Sharma (हटाया गया)" instead
  // of "Unknown Worker", and clears the attendance rows that can no longer be read.
  deleteWorker(id) {
    const worker = this.getWorker(id);
    if (worker) {
      (this.data.transactions || []).forEach(tx => {
        if (tx.workerId === id && !tx.workerName) tx.workerName = worker.name;
      });
    }
    Object.keys(this.data.haziri || {}).forEach(date => {
      if (this.data.haziri[date] && this.data.haziri[date][id]) {
        delete this.data.haziri[date][id];
        if (Object.keys(this.data.haziri[date]).length === 0) delete this.data.haziri[date];
      }
    });
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

  getTransaction(id) {
    return this.data.transactions.find(t => t.id === id) || null;
  }

  updateTransaction(id, updates) {
    const idx = this.data.transactions.findIndex(t => t.id === id);
    if (idx !== -1) {
      this.data.transactions[idx] = {
        ...this.data.transactions[idx],
        ...updates,
        amount: updates.amount !== undefined ? Number(updates.amount) || 0 : this.data.transactions[idx].amount
      };
      this.save();
      return this.data.transactions[idx];
    }
    return null;
  }

  getWorkerTransactions(workerId) {
    return this.data.transactions
      .filter(t => t.workerId === workerId)
      .sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
  }

  getWorkerHaziriHistory(workerId) {
    const history = [];
    const dates = Object.keys(this.data.haziri).sort().reverse();
    for (const date of dates) {
      const rec = this.data.haziri[date] ? this.data.haziri[date][workerId] : null;
      if (rec) {
        history.push({
          date,
          status: rec.status,
          otHours: rec.otHours || 0
        });
      }
    }
    return history;
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
    if (!this.data.haziriMeta) this.data.haziriMeta = {};
    this.data.haziriMeta[date] = { savedAt: Date.now(), deviceId: getDeviceId() };
    this.save();
  }

  // Backs the "already saved — editing will overwrite" notice on the attendance
  // screen. Returns null for a date nobody has marked yet.
  getHaziriSavedAt(date) {
    const meta = this.data.haziriMeta && this.data.haziriMeta[date];
    const hasRows = this.data.haziri[date] && Object.keys(this.data.haziri[date]).length > 0;
    if (!hasRows) return null;

    if (!meta) return { savedAt: null, byLabel: '' };

    const when = new Date(meta.savedAt);
    const time = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const sameDevice = meta.deviceId === getDeviceId();
    return {
      savedAt: meta.savedAt,
      sameDevice,
      byLabel: sameDevice ? `(${time})` : `(${time}, दूसरे फ़ोन से)`
    };
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
      const otDivisor = this.getOtHoursPerDay();
      let totalEarnedMonth = 0;
      if (!isTheka) {
        totalEarnedMonth = totalPresent * (worker.dailyRate || 0);
        if (totalOtHours > 0) {
          totalEarnedMonth += totalOtHours * ((worker.dailyRate || 0) / otDivisor);
        }
      }
      // A theka worker earns one lump sum for the whole job, not that sum again
      // every month — so the monthly column stays 0 and the contract is settled
      // against lifetime payments below.

      // Payments made in this month. Uses the same "what counts as paid to this
      // worker" rule as getWorkerLedger() so the two screens can never disagree.
      const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
      const workerMonthTxs = this.data.transactions.filter(t => t.workerId === worker.id && t.date.startsWith(monthPrefix));
      const totalPaidMonth = sumWorkerPayments(workerMonthTxs);
      const totalPaidLifetime = sumWorkerPayments(this.data.transactions.filter(t => t.workerId === worker.id));

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
        totalPaidLifetime,
        thekaAmount: worker.thekaAmount || 0,
        netBalance: isTheka
          ? ((worker.thekaAmount || 0) - totalPaidLifetime)
          : (totalEarnedMonth - totalPaidMonth)
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
              const hourlyRate = (worker.dailyRate || 0) / this.getOtHoursPerDay();
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

    // Everything charged to this worker by name — cash, recharge, diesel, material,
    // anything. Restricting this to cash+recharge was hiding real payments from the
    // balance, so a worker paid ₹2,000 in material still showed the full amount due.
    const workerTxs = this.data.transactions.filter(t => t.workerId === workerId);
    const totalCashPaid = workerTxs
      .filter(t => t.type === 'cash')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    const totalRechargePaid = workerTxs
      .filter(t => t.type === 'recharge')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    const totalIndividualGiven = sumWorkerPayments(workerTxs);
    const totalOtherPaid = totalIndividualGiven - totalCashPaid - totalRechargePaid;

    // Per-type breakdown so the statement screen can itemise "अन्य" honestly.
    const paidByType = {};
    workerTxs.filter(t => t.targetType !== 'group').forEach(t => {
      paidByType[t.type] = (paidByType[t.type] || 0) + (Number(t.amount) || 0);
    });

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
      totalOtherPaid,
      paidByType,
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

    // Every shared cost for this group, not just ration — a cylinder or a diesel
    // run booked to the group was previously invisible on this screen.
    const totalGroupSpend = groupTxs.reduce((sum, t) => sum + (t.amount || 0), 0);
    const groupSpendByType = {};
    groupTxs.forEach(t => {
      groupSpendByType[t.type] = (groupSpendByType[t.type] || 0) + (Number(t.amount) || 0);
    });

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
      totalGroupSpend,
      groupSpendByType,
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

  // Local file backup replaces the old kvdb.io sync: that pushed the entire
  // unencrypted ledger to a public key-value bucket whose id shipped in the
  // source, so anyone who guessed a sync key could read or overwrite a site.
  // Cloud sync now goes through Firebase only.
  downloadBackupFile() {
    const stamp = getTodayString();
    const blob = new Blob([this.exportData()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `site-diary-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }
}

export const store = new Store();
export { getTodayString };
