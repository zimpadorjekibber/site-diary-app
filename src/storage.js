// src/storage.js
// LocalStorage data layer for Shram & Site Diary

const STORAGE_KEY = 'site_diary_data_v1';

const DEFAULT_TRADES = [
  { id: 'carpenter', name: 'Carpenter (बढ़ई)', icon: '🔨', color: '#f59e0b' },
  { id: 'mason', name: 'Mason (राजमिस्त्री)', icon: '🧱', color: '#ef4444' },
  { id: 'plumber', name: 'Plumber (प्लंबर)', icon: '🔧', color: '#06b6d4' },
  { id: 'painter', name: 'Painter (पेंटर)', icon: '🎨', color: '#8b5cf6' },
  { id: 'electrician', name: 'Electrician (बिजली मिस्त्री)', icon: '⚡', color: '#eab308' },
  { id: 'tile', name: 'Tile & Marble (टाइल मिस्त्री)', icon: '🔲', color: '#10b981' },
  // A supplier, not a craftsman: no attendance, no daily wage. What gets counted
  // is trolley loads delivered, so this trade is flagged and treated differently.
  { id: 'tractor', name: 'Tractor / ट्रैक्टर (सप्लाई)', icon: '🚜', color: '#0c7ebd', isSupplier: true }
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
  { id: 'trolley',  icon: '🚜', hi: 'ट्रॉली सप्लाई',  en: 'Trolley Load',  scope: 'site'   },
  { id: 'other',    icon: '📝', hi: 'अन्य खर्च',      en: 'Other',         scope: 'site'   }
];

/* Materials a tractor delivers by the trolley. Each keeps its own rate because
   the owner confirmed they differ — reta is not priced like bajri. The rates
   live on the supplier (a worker record), not here; these are just the defaults
   offered when setting one up. */
export const TROLLEY_MATERIALS = [
  { id: 'reta',   hi: 'रेता',   en: 'Reta (sand)' },
  { id: 'balu',   hi: 'बालू',   en: 'Balu (fine sand)' },
  { id: 'bajri',  hi: 'बजरी',   en: 'Bajri (gravel)' },
  { id: 'gitti',  hi: 'गिट्टी',  en: 'Gitti (crushed stone)' },
  { id: 'mitti',  hi: 'मिट्टी',  en: 'Mitti (soil)' },
  { id: 'malba',  hi: 'मलबा',   en: 'Malba (debris)' }
];

export function getTrolleyMaterial(id) {
  return TROLLEY_MATERIALS.find(m => m.id === id) || { id, hi: id, en: id };
}

/* ===================================================
   JOB TEMPLATES

   A hotel has no masons and a construction site has no chefs. Rather than making
   every new job start with bricklayers and then be edited down, the job says what
   kind of work it is and starts with categories that fit.

   Only a starting point — trades can be added or removed afterwards, and an
   existing job is never touched.
=================================================== */
export const JOB_TEMPLATES = [
  {
    id: 'construction',
    hi: 'निर्माण / मकान',
    en: 'Construction',
    icon: '🏠',
    trades: null   // null = the standard construction set (DEFAULT_TRADES)
  },
  {
    id: 'hotel',
    hi: 'होटल / ढाबा',
    en: 'Hotel / Restaurant',
    icon: '🏨',
    trades: [
      { id: 'chef',        name: 'Chef / रसोइया',          icon: '👨‍🍳', color: '#e11d48' },
      { id: 'kitchen',     name: 'Kitchen Helper / हेल्पर', icon: '🥣', color: '#f59e0b' },
      { id: 'frontoffice', name: 'Front Office / रिसेप्शन', icon: '🛎️', color: '#5b4bcf' },
      { id: 'manager',     name: 'Manager / मैनेजर',        icon: '👔', color: '#0c7ebd' },
      { id: 'waiter',      name: 'Waiter / वेटर',           icon: '🍽️', color: '#10b981' },
      { id: 'housekeep',   name: 'Housekeeping / सफ़ाई',     icon: '🧹', color: '#8b5cf6' },
      { id: 'driver',      name: 'Driver / ड्राइवर',         icon: '🚗', color: '#64748b' },
      { id: 'security',    name: 'Security / चौकीदार',      icon: '🛡️', color: '#78350f' }
    ]
  },
  {
    id: 'farm',
    hi: 'खेती / बाग़वानी',
    en: 'Farm / Orchard',
    icon: '🌾',
    trades: [
      { id: 'labour',  name: 'Labour / मजदूर',          icon: '🧑‍🌾', color: '#10b981' },
      { id: 'driver',  name: 'Tractor Driver / ड्राइवर', icon: '🚜', color: '#0c7ebd' },
      { id: 'pruning', name: 'Pruning / छँटाई',          icon: '✂️', color: '#f59e0b' },
      { id: 'packing', name: 'Packing / पैकिंग',         icon: '📦', color: '#8b5cf6' }
    ]
  },
  {
    id: 'blank',
    hi: 'ख़ाली — मैं ख़ुद बनाऊँगा',
    en: 'Blank',
    icon: '📋',
    trades: []
  }
];

/** Trades a new job starts with, given its template. */
function buildTemplateTrades(templateId) {
  const template = JOB_TEMPLATES.find(t => t.id === templateId) || JOB_TEMPLATES[0];
  if (template.trades === null) return DEFAULT_TRADES.map(t => ({ ...t }));

  const trades = template.trades.map(t => ({ ...t }));
  // The tractor supplier travels with every template: material gets delivered to
  // a hotel build or a farm just as much as to a house.
  const tractor = DEFAULT_TRADES.find(t => t.isSupplier);
  if (tractor && !trades.some(t => t.id === tractor.id)) trades.push({ ...tractor });
  return trades;
}

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
/* Ids must not collide. `prefix + Date.now()` alone does, because two records
   added in the same millisecond — which happens on any bulk add, or simply by
   tapping quickly — end up sharing an id, and every lookup then returns whichever
   one is first in the array. */
function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sumWorkerPayments(txs) {
  return txs
    .filter(t => t.targetType !== 'group')
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
}

/* A theka is worth either a flat sum ("₹35,000 for the whole job") or a rate
   times a measurement ("₹25 per sq ft × 400 sq ft"). The measurement is often
   unknown until the work is finished, so quantity 0 is normal and simply means
   "not measured yet" — the contract shows as pending rather than as ₹0 earned. */
export function getThekaTotal(worker) {
  if (!worker || worker.contractType !== 'theka' || !worker.isThekedar) return 0;
  if (worker.thekaMode === 'rate') {
    return (Number(worker.thekaRate) || 0) * (Number(worker.thekaQuantity) || 0);
  }
  return Number(worker.thekaAmount) || 0;
}

// True when a rate contract has been agreed but not yet measured.
export function isThekaUnmeasured(worker) {
  return !!worker
    && worker.contractType === 'theka'
    && worker.isThekedar
    && worker.thekaMode === 'rate'
    && (Number(worker.thekaRate) || 0) > 0
    && !(Number(worker.thekaQuantity) > 0);
}

// "₹25 × 400 sq ft" or "₹35,000 (एकमुश्त)" — one phrasing used by every screen.
export function describeTheka(worker, lang = 'hi') {
  if (!worker || worker.contractType !== 'theka') return '';
  if (!worker.isThekedar) {
    return lang === 'en' ? 'Works under the contractor' : 'ठेकेदार के अधीन';
  }
  if (worker.thekaMode === 'rate') {
    const rate = Number(worker.thekaRate) || 0;
    const unit = worker.thekaUnit || (lang === 'en' ? 'unit' : 'इकाई');
    const qty = Number(worker.thekaQuantity) || 0;
    if (qty > 0) {
      return `₹${rate.toLocaleString('en-IN')} × ${qty.toLocaleString('en-IN')} ${unit}`;
    }
    return lang === 'en'
      ? `₹${rate.toLocaleString('en-IN')} per ${unit} — not measured yet`
      : `₹${rate.toLocaleString('en-IN')} प्रति ${unit} — नाप अभी बाकी`;
  }
  const amt = Number(worker.thekaAmount) || 0;
  return lang === 'en' ? `₹${amt.toLocaleString('en-IN')} (lump sum)` : `₹${amt.toLocaleString('en-IN')} (एकमुश्त)`;
}

export class Store {
  /**
   * @param {object} [options]
   * @param {object} [options.data]     Use this ledger instead of reading localStorage.
   * @param {boolean} [options.persist] Write changes back to localStorage (default true).
   *
   * The MCP server runs in Node, where there is no localStorage, and needs the
   * ledger it fetched from Firestore. Letting it build a Store around that data
   * means it reports the same numbers as the app instead of a second, drifting
   * implementation of the same arithmetic.
   */
  constructor(options = {}) {
    this.persist = options.persist !== false;
    this.data = options.data ? this.normalise(options.data) : this.load();
  }

  // A cloud payload may predate fields the calculations expect.
  normalise(data) {
    // Accepts either shape: the current one, or a pre-projects payload from an
    // older device that has not updated yet.
    const projects = Array.isArray(data.projects) && data.projects.length
      ? data.projects
      : [{
          id: data.activeProjectId || makeId('proj'),
          name: 'मेरा काम',
          icon: '🏠',
          note: '',
          createdAt: Date.now(),
          trades: data.trades || [],
          workers: data.workers || [],
          transactions: data.transactions || [],
          haziri: data.haziri || {},
          haziriMeta: data.haziriMeta || {},
          diaryNotedDates: data.diaryNotedDates || {},
          isCleanStarted: data.isCleanStarted === true
        }];

    return {
      projects: projects.map(p => ({
        ...p,
        trades: p.trades || [],
        workers: p.workers || [],
        transactions: p.transactions || [],
        haziri: p.haziri || {},
        haziriMeta: p.haziriMeta || {},
        diaryNotedDates: p.diaryNotedDates || {}
      })),
      activeProjectId: projects.some(p => p.id === data.activeProjectId)
        ? data.activeProjectId
        : projects[0].id,
      lending: Array.isArray(data.lending) ? data.lending : [],
      settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) }
    };
  }

  /* ===================================================
     PROJECTS (काम)

     A contractor runs several jobs at once — a house, a canal, a boundary wall,
     road tarring — and each keeps its own workers, attendance and expenses. Each
     is stored as a self-contained ledger inside `projects`, and everything below
     reads through activeProject() rather than touching this.data directly.

     Settings and the lending register stay outside projects: settings describe
     the phone, and lending in a village is personal, not tied to one job.
  =================================================== */

  /** The ledger currently being worked on. Never returns null. */
  activeProject() {
    const list = this.data.projects || [];
    return list.find(p => p.id === this.data.activeProjectId) || list[0];
  }

  getProjects() {
    return this.data.projects || [];
  }

  getProject(id) {
    return (this.data.projects || []).find(p => p.id === id) || null;
  }

  getActiveProjectId() {
    return this.activeProject()?.id || null;
  }

  setActiveProject(id) {
    if (!this.getProject(id)) return false;
    this.data.activeProjectId = id;
    this.save();
    return true;
  }

  addProject(name, { icon = '🏗️', note = '', template = 'construction' } = {}) {
    const clean = String(name || '').trim();
    if (!clean) throw new Error('काम का नाम डालें');
    const project = {
      id: makeId('proj'),
      name: clean,
      icon,
      note: String(note || '').trim(),
      createdAt: Date.now(),
      // A fresh job starts with categories that suit the kind of work, empty.
      trades: buildTemplateTrades(template),
      workers: [],
      transactions: [],
      haziri: {},
      haziriMeta: {},
      diaryNotedDates: {},
      isCleanStarted: true
    };
    this.data.projects.push(project);
    this.data.activeProjectId = project.id;
    this.save();
    return project;
  }

  updateProject(id, updates) {
    const p = this.getProject(id);
    if (!p) return null;
    if (updates.name !== undefined) p.name = String(updates.name).trim() || p.name;
    if (updates.icon !== undefined) p.icon = updates.icon;
    if (updates.note !== undefined) p.note = String(updates.note).trim();
    this.save();
    return p;
  }

  /** Refuses to leave the app with no ledger at all. */
  deleteProject(id) {
    if ((this.data.projects || []).length <= 1) {
      return { ok: false, reason: 'last_project' };
    }
    const p = this.getProject(id);
    if (!p) return { ok: false, reason: 'not_found' };

    this.data.projects = this.data.projects.filter(x => x.id !== id);
    if (this.data.activeProjectId === id) {
      this.data.activeProjectId = this.data.projects[0].id;
    }
    this.save();
    return { ok: true, deleted: p.name };
  }

  /** Totals across every job, for the projects screen. */
  getProjectSummary(id) {
    const p = this.getProject(id);
    if (!p) return null;
    const spent = (p.transactions || []).reduce((s, t) => s + (Number(t.amount) || 0), 0);
    return {
      id: p.id,
      name: p.name,
      icon: p.icon || '🏗️',
      note: p.note || '',
      workers: (p.workers || []).length,
      transactions: (p.transactions || []).length,
      daysTracked: Object.keys(p.haziri || {}).length,
      totalSpent: spent,
      isActive: p.id === this.data.activeProjectId
    };
  }

  getOtHoursPerDay() {
    const n = Number(this.data?.settings?.otHoursPerDay);
    return n > 0 ? n : 8;
  }

  /**
   * Brings a stored payload up to the current shape. Returns null if it is not
   * recognisable as a ledger at all, so the caller can fall back to a fresh one.
   *
   * Every step here has to be safe on real data — this runs against the owner's
   * live accounts on every app start.
   */
  migrate(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;

    let needsSave = false;

    /* v3: everything used to live at the top level, one job per install. It now
       lives inside `projects` so a contractor can run a house, a canal and a
       boundary wall side by side. The existing ledger becomes the first job with
       all of its data intact — nothing is dropped or reset. */
    if (!Array.isArray(parsed.projects)) {
      if (!parsed.workers || !parsed.trades) return null;   // not a ledger
      parsed.projects = [{
        id: makeId('proj'),
        name: 'मेरा काम',
        icon: '🏠',
        note: '',
        createdAt: Date.now(),
        trades: parsed.trades,
        workers: parsed.workers,
        transactions: parsed.transactions || [],
        haziri: parsed.haziri || {},
        haziriMeta: parsed.haziriMeta || {},
        diaryNotedDates: parsed.diaryNotedDates || {},
        isCleanStarted: parsed.isCleanStarted === true
      }];
      parsed.activeProjectId = parsed.projects[0].id;
      // The originals are removed only after the copy is in place.
      delete parsed.trades;
      delete parsed.workers;
      delete parsed.transactions;
      delete parsed.haziri;
      delete parsed.haziriMeta;
      delete parsed.diaryNotedDates;
      delete parsed.isCleanStarted;
      needsSave = true;
    }

    if (parsed.projects.length === 0) return null;
    if (!parsed.projects.some(p => p.id === parsed.activeProjectId)) {
      parsed.activeProjectId = parsed.projects[0].id;
      needsSave = true;
    }

    // Lending is personal and shared across every job.
    if (!Array.isArray(parsed.lending)) {
      parsed.lending = [];
      needsSave = true;
    }

    parsed.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
    if (!parsed.settings.firebaseConfig || !parsed.settings.firebaseConfig.apiKey) {
      parsed.settings.firebaseConfig = DEFAULT_FIREBASE_CONFIG;
      parsed.settings.firebaseAutoSync = true;
      needsSave = true;
    }
    // Installs created before per-site ids all pointed at one shared document.
    if (!parsed.settings.firebaseSiteId || parsed.settings.firebaseSiteId === 'khalen-dairy') {
      parsed.settings.firebaseSiteId = getOrCreateSiteId();
      needsSave = true;
    }

    for (const project of parsed.projects) {
      project.trades = project.trades || [];
      project.workers = project.workers || [];
      project.transactions = project.transactions || [];
      project.haziri = project.haziri || {};
      project.haziriMeta = project.haziriMeta || {};
      project.diaryNotedDates = project.diaryNotedDates || {};

      // New built-in supplier trades reach existing jobs too; DEFAULT_TRADES only
      // applies to a first run. Trades the user deleted stay deleted.
      DEFAULT_TRADES.forEach(def => {
        if (def.isSupplier && !project.trades.some(t => t.id === def.id)) {
          project.trades.push({ ...def });
          needsSave = true;
        }
      });

      // Theka used to be a flat amount on any worker, so a trade with three
      // contract workers counted the same contract three times. The amount now
      // belongs to one thekedar; anyone who already had an amount becomes one,
      // which keeps existing numbers unchanged until the user says otherwise.
      project.workers.forEach(w => {
        if (w.contractType === 'theka' && w.isThekedar === undefined) {
          w.isThekedar = (Number(w.thekaAmount) || 0) > 0;
          w.thekaMode = w.isThekedar ? 'lumpsum' : null;
          needsSave = true;
        }
      });

      // A restored-from-cloud payload used to lose this flag, which let the demo
      // seed re-inject eight fake workers into a real register.
      if (project.workers.length > 0 &&
          !project.workers.some(w => String(w.id).startsWith('w') && w.id.length <= 3)) {
        project.isCleanStarted = true;
        needsSave = true;
      }
    }

    if (needsSave) this.save(parsed);
    return parsed;
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const migrated = this.migrate(parsed);
        if (migrated) return migrated;
      }
    } catch (e) {
      console.warn('Failed to load from storage, using defaults:', e);
    }

    // A first run starts with one job holding the sample data, so the app has
    // something to show before anything real is entered.
    const firstProject = {
      id: makeId('proj'),
      name: 'मेरा काम',
      icon: '🏠',
      note: '',
      createdAt: Date.now(),
      trades: DEFAULT_TRADES.map(t => ({ ...t })),
      workers: DEFAULT_WORKERS,
      transactions: getInitialSeedTransactions(),
      haziri: getInitialSeedHaziri(),
      haziriMeta: {},
      diaryNotedDates: {},
      isCleanStarted: false
    };
    const initial = {
      projects: [firstProject],
      activeProjectId: firstProject.id,
      lending: [],
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
    // A read-only Store (the MCP server) has nowhere to write and nothing to save.
    if (!this.persist) return true;
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
    return this.eraseAll({ keepTrades: true });
  }

  /**
   * Wipes THIS job's ledger — its workers, attendance and every transaction.
   * Irreversible, so the caller must offer a backup first.
   *
   * Scoped to the active project on purpose: other jobs, the lending register and
   * settings are untouched. Losing the site id would orphan the cloud copy and
   * quietly start a second one.
   *
   * @param {boolean} keepTrades Keep the trade list (Carpenter, Mason…), which is
   *   job setup rather than ledger data and is tedious to rebuild by hand.
   */
  eraseAll({ keepTrades = true } = {}) {
    const project = this.activeProject();
    project.trades = keepTrades && project.trades?.length ? project.trades : DEFAULT_TRADES.map(t => ({ ...t }));
    project.workers = [];
    project.transactions = [];
    project.haziri = {};
    project.haziriMeta = {};
    project.diaryNotedDates = {};
    // Marks the ledger as deliberately empty so the demo seed never returns.
    project.isCleanStarted = true;
    this.save();
    return project;
  }

  // --- TRADES ---
  getTrades() {
    return this.activeProject().trades;
  }

  addTrade(name, icon = 'briefcase', color = '#f59e0b') {
    const id = makeId('trade');
    this.activeProject().trades.push({ id, name, icon, color });
    this.save();
    return id;
  }

  getTrade(id) {
    return this.activeProject().trades.find(t => t.id === id) || { id, name: 'Unknown Trade', color: '#64748b' };
  }

  // Refuses to orphan workers. Deleting a trade used to leave its workers pointing
  // at a trade that no longer exists, so they showed up as "Unknown Trade" while
  // still being counted in every total.
  deleteTrade(id) {
    const attached = this.getWorkers(id);
    if (attached.length > 0) {
      return { ok: false, reason: 'has_workers', workers: attached };
    }
    this.activeProject().trades = this.activeProject().trades.filter(t => t.id !== id);
    this.save();
    return { ok: true };
  }

  moveTradeWorkers(fromTradeId, toTradeId) {
    this.activeProject().workers.forEach(w => {
      if (w.tradeId === fromTradeId) w.tradeId = toTradeId;
    });
    (this.activeProject().transactions || []).forEach(tx => {
      if (tx.tradeId === fromTradeId) tx.tradeId = toTradeId;
    });
    this.save();
  }

  // --- WORKERS ---
  getWorkers(tradeId = null) {
    if (!tradeId || tradeId === 'all') return this.activeProject().workers;
    return this.activeProject().workers.filter(w => w.tradeId === tradeId);
  }

  getWorker(id) {
    return this.activeProject().workers.find(w => w.id === id);
  }

  addWorker({ name, tradeId, role, contractType, dailyRate, isThekedar, thekaMode,
              thekaAmount, thekaRate, thekaUnit, thekaQuantity, thekaDescription, phone, photoUrl }) {
    const id = makeId('w');
    const isTheka = contractType === 'theka';
    // The contract belongs to one person — the thekedar. Everyone else working
    // under him has attendance but no separate amount, otherwise the same
    // contract gets counted once per worker in the trade.
    const holdsContract = isTheka && !!isThekedar;
    const worker = {
      id,
      name: name.trim(),
      tradeId,
      role: role || 'mistri', // 'mistri' or 'helper'
      contractType: isTheka ? 'theka' : 'dihadi',
      isThekedar: holdsContract,
      dailyRate: isTheka ? 0 : (Number(dailyRate) || 0),
      thekaMode: holdsContract ? (thekaMode === 'rate' ? 'rate' : 'lumpsum') : null,
      thekaAmount: holdsContract && thekaMode !== 'rate' ? (Number(thekaAmount) || 0) : 0,
      thekaRate: holdsContract && thekaMode === 'rate' ? (Number(thekaRate) || 0) : 0,
      thekaUnit: holdsContract && thekaMode === 'rate' ? (thekaUnit || '').trim() : '',
      thekaQuantity: holdsContract && thekaMode === 'rate' ? (Number(thekaQuantity) || 0) : 0,
      thekaDescription: (thekaDescription || '').trim(),
      phone: (phone || '').trim(),
      photoUrl: photoUrl || null
    };
    this.activeProject().workers.push(worker);
    this.save();
    return worker;
  }

  updateWorker(id, updates) {
    const idx = this.activeProject().workers.findIndex(w => w.id === id);
    if (idx !== -1) {
      const oldTradeId = this.activeProject().workers[idx].tradeId;
      this.activeProject().workers[idx] = { ...this.activeProject().workers[idx], ...updates };

      // If tradeId changed, also update all individual transactions for this worker so they belong to the new trade
      if (updates.tradeId && updates.tradeId !== oldTradeId && this.activeProject().transactions) {
        this.activeProject().transactions.forEach(tx => {
          if (tx.workerId === id) {
            tx.tradeId = updates.tradeId;
          }
        });
      }

      this.save();
      return this.activeProject().workers[idx];
    }
    return null;
  }

  // Keeps the money history (it really happened) but stamps the name onto each
  // transaction first, so the timeline shows "Ramesh Sharma (हटाया गया)" instead
  // of "Unknown Worker", and clears the attendance rows that can no longer be read.
  deleteWorker(id) {
    const worker = this.getWorker(id);
    if (worker) {
      (this.activeProject().transactions || []).forEach(tx => {
        if (tx.workerId === id && !tx.workerName) tx.workerName = worker.name;
      });
    }
    Object.keys(this.activeProject().haziri || {}).forEach(date => {
      if (this.activeProject().haziri[date] && this.activeProject().haziri[date][id]) {
        delete this.activeProject().haziri[date][id];
        if (Object.keys(this.activeProject().haziri[date]).length === 0) delete this.activeProject().haziri[date];
      }
    });
    this.activeProject().workers = this.activeProject().workers.filter(w => w.id !== id);
    this.save();
  }

  /* ===================================================
     TRACTOR / TROLLEY SUPPLY

     A tractor owner is a supplier, not a craftsman: nothing is gained by marking
     him present, and he has no daily wage. What matters is how many trolley loads
     arrived on a day — often more than one, and the count varies with distance.

     Each material carries its own rate (reta is not priced like bajri), stored on
     the supplier as { materialId: ratePerTrolley }. A delivery is recorded as an
     ordinary transaction of type 'trolley', so it flows into the day's total, the
     evening diary and every report without any of them needing to know about
     tractors.
  =================================================== */

  isSupplierTrade(tradeId) {
    const trade = this.activeProject().trades.find(t => t.id === tradeId);
    return !!(trade && trade.isSupplier);
  }

  getSuppliers() {
    return this.activeProject().workers.filter(w => this.isSupplierTrade(w.tradeId));
  }

  /** Rate this supplier charges for one trolley of a given material. */
  getTrolleyRate(workerId, materialId) {
    const w = this.getWorker(workerId);
    return Number(w?.trolleyRates?.[materialId]) || 0;
  }

  setTrolleyRates(workerId, rates) {
    const clean = {};
    Object.entries(rates || {}).forEach(([k, v]) => {
      const n = Number(v);
      if (n > 0) clean[k] = n;
    });
    return this.updateWorker(workerId, { trolleyRates: clean });
  }

  /**
   * Records trolley loads delivered on one date.
   * @returns the created transaction, or null if the rate is not set up yet.
   */
  addTrolleyDelivery({ workerId, materialId, trips, date, note, ratePerTrolley }) {
    const worker = this.getWorker(workerId);
    if (!worker) throw new Error('सप्लायर नहीं मिला');

    const count = Number(trips) || 0;
    if (count <= 0) throw new Error('कितनी ट्रॉली आईं, वो संख्या डालें');

    // An explicit rate wins — a one-off trip may be priced differently — but the
    // supplier's own rate is the normal path.
    const rate = Number(ratePerTrolley) > 0
      ? Number(ratePerTrolley)
      : this.getTrolleyRate(workerId, materialId);
    if (rate <= 0) {
      throw new Error(`${getTrolleyMaterial(materialId).hi} का ट्रॉली रेट पहले भरें`);
    }

    const material = getTrolleyMaterial(materialId);
    return this.addTransaction({
      date,
      type: 'trolley',
      targetType: 'group',       // a site cost, not money owed to a worker
      tradeId: worker.tradeId,
      supplierId: workerId,      // who delivered, for the WhatsApp update
      materialId,
      trips: count,
      ratePerTrolley: rate,
      rationItem: material.hi,
      quantity: `${count} ट्रॉली`,
      amount: count * rate,
      note: note || ''
    });
  }

  /** Every trolley delivery by this supplier, newest first, with running totals. */
  getSupplierLedger(workerId, { from, to } = {}) {
    const worker = this.getWorker(workerId);
    if (!worker) return null;

    let deliveries = this.activeProject().transactions.filter(
      t => t.type === 'trolley' && t.supplierId === workerId
    );
    if (from) deliveries = deliveries.filter(t => t.date >= from);
    if (to) deliveries = deliveries.filter(t => t.date <= to);
    deliveries.sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));

    const byMaterial = {};
    let totalTrips = 0;
    let totalAmount = 0;
    for (const d of deliveries) {
      const key = d.materialId || 'other';
      if (!byMaterial[key]) byMaterial[key] = { trips: 0, amount: 0 };
      byMaterial[key].trips += Number(d.trips) || 0;
      byMaterial[key].amount += Number(d.amount) || 0;
      totalTrips += Number(d.trips) || 0;
      totalAmount += Number(d.amount) || 0;
    }

    // What the site has actually handed over, so the balance is honest.
    const paid = this.activeProject().transactions
      .filter(t => t.workerId === workerId && t.type !== 'trolley')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    return {
      worker,
      deliveries,
      byMaterial,
      totalTrips,
      totalAmount,
      totalPaid: paid,
      balanceDue: totalAmount - paid
    };
  }

  /** Trolleys delivered on one date, grouped by supplier — the WhatsApp update. */
  getTrolleyDeliveriesForDate(date = getTodayString(), supplierId = null) {
    return this.activeProject().transactions.filter(
      t => t.type === 'trolley' && t.date === date && (!supplierId || t.supplierId === supplierId)
    );
  }

  // --- TRANSACTIONS ---
  getTransactions(date = null) {
    if (!date) return this.activeProject().transactions;
    return this.activeProject().transactions.filter(t => t.date === date);
  }

  addTransaction(tx) {
    const newTx = {
      id: makeId('tx'),
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
      audioDataUrl: tx.audioDataUrl || null, // backup voice audio recording
      // Trolley deliveries only. Kept on the transaction so a delivery is a
      // first-class record — who brought it, what, how many loads, at what rate —
      // rather than something reconstructed from a free-text note later.
      supplierId: tx.supplierId || null,
      materialId: tx.materialId || null,
      trips: Number(tx.trips) || 0,
      ratePerTrolley: Number(tx.ratePerTrolley) || 0
    };
    this.activeProject().transactions.unshift(newTx);
    this.save();
    return newTx;
  }

  deleteTransaction(id) {
    this.activeProject().transactions = this.activeProject().transactions.filter(t => t.id !== id);
    this.save();
  }

  getTransaction(id) {
    return this.activeProject().transactions.find(t => t.id === id) || null;
  }

  updateTransaction(id, updates) {
    const idx = this.activeProject().transactions.findIndex(t => t.id === id);
    if (idx !== -1) {
      this.activeProject().transactions[idx] = {
        ...this.activeProject().transactions[idx],
        ...updates,
        amount: updates.amount !== undefined ? Number(updates.amount) || 0 : this.activeProject().transactions[idx].amount
      };
      this.save();
      return this.activeProject().transactions[idx];
    }
    return null;
  }

  getWorkerTransactions(workerId) {
    return this.activeProject().transactions
      .filter(t => t.workerId === workerId)
      .sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
  }

  getWorkerHaziriHistory(workerId) {
    const history = [];
    const dates = Object.keys(this.activeProject().haziri).sort().reverse();
    for (const date of dates) {
      const rec = this.activeProject().haziri[date] ? this.activeProject().haziri[date][workerId] : null;
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
    return this.activeProject().haziri[date] || {};
  }

  setWorkerHaziri(date, workerId, status, otHours = 0) {
    if (!this.activeProject().haziri[date]) {
      this.activeProject().haziri[date] = {};
    }
    this.activeProject().haziri[date][workerId] = {
      status: Number(status), // 1.0 (full), 0.5 (half), 0 (absent)
      otHours: Number(otHours) || 0
    };
    if (!this.activeProject().haziriMeta) this.activeProject().haziriMeta = {};
    this.activeProject().haziriMeta[date] = { savedAt: Date.now(), deviceId: getDeviceId() };
    this.save();
  }

  // Backs the "already saved — editing will overwrite" notice on the attendance
  // screen. Returns null for a date nobody has marked yet.
  getHaziriSavedAt(date) {
    const meta = this.activeProject().haziriMeta && this.activeProject().haziriMeta[date];
    const hasRows = this.activeProject().haziri[date] && Object.keys(this.activeProject().haziri[date]).length > 0;
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
        const dayHaziri = this.activeProject().haziri[dateStr];
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
      const workerMonthTxs = this.activeProject().transactions.filter(t => t.workerId === worker.id && t.date.startsWith(monthPrefix));
      const totalPaidMonth = sumWorkerPayments(workerMonthTxs);
      const totalPaidLifetime = sumWorkerPayments(this.activeProject().transactions.filter(t => t.workerId === worker.id));

      return {
        worker,
        trade: this.getTrade(worker.tradeId),
        isTheka,
        isThekedar: !!worker.isThekedar,
        dailyStatuses,
        totalPresent,
        totalAbsent,
        totalOtHours,
        totalEarnedMonth,
        totalPaidMonth,
        totalPaidLifetime,
        thekaAmount: getThekaTotal(worker),
        thekaLabel: describeTheka(worker),
        // Only the thekedar carries the contract; the crew working under him is
        // paid by him, so their balance is just what the site advanced them.
        netBalance: isTheka
          ? (getThekaTotal(worker) - totalPaidLifetime)
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
    return !!this.activeProject().diaryNotedDates[date];
  }

  setMarkedInDiary(date = getTodayString(), marked = true) {
    if (marked) {
      this.activeProject().diaryNotedDates[date] = Date.now();
    } else {
      delete this.activeProject().diaryNotedDates[date];
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

    Object.keys(this.activeProject().haziri).forEach(date => {
      const record = this.activeProject().haziri[date][workerId];
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
      totalEarned = getThekaTotal(worker);
    }

    // Everything charged to this worker by name — cash, recharge, diesel, material,
    // anything. Restricting this to cash+recharge was hiding real payments from the
    // balance, so a worker paid ₹2,000 in material still showed the full amount due.
    const workerTxs = this.activeProject().transactions.filter(t => t.workerId === workerId);
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
      isThekedar: !!worker.isThekedar,
      thekaAmount: getThekaTotal(worker),
      thekaLabel: describeTheka(worker),
      thekaUnmeasured: isThekaUnmeasured(worker),
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
    const groupTxs = this.activeProject().transactions.filter(t => t.tradeId === tradeId && t.targetType === 'group');

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

/* The app's singleton. Guarded because storage.js is also imported by the MCP
   server in Node, where constructing this would pointlessly seed demo data. */
export const store = typeof localStorage !== 'undefined' ? new Store() : null;
export { getTodayString };
