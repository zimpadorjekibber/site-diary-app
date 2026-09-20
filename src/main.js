// src/main.js
// Main Application Controller for Shram & Site Diary

import { store, getTodayString, getDeviceId, getAllTxTypes, getTxTypeMeta, getTxTypeLabel, getThekaTotal, describeTheka, isThekaUnmeasured, TROLLEY_MATERIALS, getTrolleyMaterial, JOB_TEMPLATES, MACHINE_WORKS, getMachineWork, computeHours, formatHours, ABSENCE_REASONS, absenceReasonLabel } from './storage.js';
import { VoiceManager } from './speech.js';
import { ReminderManager } from './reminder.js';
import confetti from 'canvas-confetti';
import { initFirebase, isFirebaseReady, saveToFirebase, loadFromFirebase, enableRealtimeSync, parseFirebaseConfig } from './firebase-lazy.js';
import { translations } from './i18n.js';
import { LendingLock } from './lending-lock.js';
import { initModalUX } from './modal-ux.js';

/* Every list in this app is built with innerHTML from data a user typed — worker
   names, notes, trade names — and that data also arrives from cloud sync, i.e.
   from another device. Without escaping, a name like `<img onerror=...>` runs as
   markup on every phone that syncs the site. */
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inr(n) {
  return `₹${(Number(n) || 0).toLocaleString('en-IN')}`;
}

/* Common village lending items, as a starting point only. Whatever the user
   types is remembered and joins this list next time, so the suggestions grow
   into their own vocabulary instead of staying stuck at ours. */
const LENDING_ITEM_SUGGESTIONS = [
  'पानी का ड्रम', 'पिलर फर्मा', 'बल्ली', 'कुल्हाड़ी', 'फावड़ा',
  'तसला', 'सीढ़ी', 'मिक्सर मशीन', 'शटरिंग प्लेट'
];

const ICON_MAP = {
  'hammer': '🔨',
  'brick-wall': '🧱',
  'wrench': '🔧',
  'paint-brush': '🎨',
  'zap': '⚡',
  'grid': '🔲',
  'briefcase': '💼'
};

function getTradeIcon(icon) {
  if (!icon) return '🔨';
  return ICON_MAP[icon] || icon;
}

function getPhoneDialerHref(phone) {
  if (!phone) return '#';
  const cleaned = String(phone).replace(/[^\d+]/g, '');
  return `tel:${cleaned}`;
}

function getWhatsAppUrl(phone, text = '') {
  if (!phone) return '#';
  let digits = String(phone).replace(/[^0-9]/g, '');
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = '91' + digits.slice(1);
  } else if (digits.length === 10) {
    digits = '91' + digits;
  }
  const query = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${digits}${query}`;
}

function formatShortDate(dateStr, lang = 'hi') {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const d = parseInt(parts[2], 10);
  const m = parseInt(parts[1], 10);
  const monthsHi = ['जन', 'फ़र', 'मार्च', 'अप्रै', 'मई', 'जून', 'जुला', 'अग', 'सितं', 'अक्टू', 'नवं', 'दिसं'];
  const monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const months = (lang === 'en') ? monthsEn : monthsHi;
  return `${d} ${months[m - 1] || ''}`;
}

class App {
  constructor() {
    this.store = store;
    this.currentTab = 'tab-haziri'; // Daily Attendance is #1 contractor priority
    this.tabScrollPositions = new Map();
    this.activeFilterType = 'all';
    this.activeFilterTrade = null;
    this.selectedHaziriDate = getTodayString();
    this.activeHaziriTradeId = null; // Trade tab for attendance (e.g. 'carpenter', 'mason')

    // Monthly Muster Roll state
    this.haziriSubView = 'daily'; // 'daily' | 'monthly'
    const now = new Date();
    this.monthlyYear = now.getFullYear();
    this.monthlyMonth = now.getMonth() + 1;

    // Modal state
    this.modalTxType = 'cash';
    this.modalTargetType = 'individual';
    this.modalWorkerRole = 'mistri';
    this.modalContractType = 'dihadi';
    this.modalWorksHimself = true;
    this.lendingFilter = 'pending';
    this.lendingDirection = 'given';
    this.lendingKind = 'item';
    this.lendingPhotoDataUrl = null;
    this.lendingLock = new LendingLock(() => {
      document.getElementById('modalLending')?.classList.remove('open');
      document.getElementById('lendingPhotoViewer')?.remove();
      ['lendingPerson', 'lendingPhone', 'lendingItem', 'lendingQty', 'lendingAmount', 'lendingNote']
        .forEach(id => { const input = document.getElementById(id); if (input) input.value = ''; });
      const chips = document.getElementById('lendingItemChips');
      if (chips) chips.innerHTML = '';
      this.clearLendingPhoto();
      this.renderLending();
    });
    this.trolleyMaterial = null;
    this.trolleyRatesWorkerId = null;
    this.jcbWork = null;
    this.machineRatesWorkerId = null;
    this.modalIsThekedar = true;   // a theka worker holds the contract unless told otherwise
    this.modalThekaMode = 'lumpsum';
    this.newWorkerPhotoDataUrl = null;

    // Voice & Reminder managers
    this.voiceManager = new VoiceManager(this.store);
    this.reminderManager = new ReminderManager(this.store, () => this.onEveningReminderTriggered());

    // Timeline date & search filters
    this.timelineDateMode = 'today';
    this.timelineCustomDate = getTodayString();
    this.timelineSearchQuery = '';

    // Passbook & statement state
    this.activeStatementWorkerId = null;
    this.statementSubTab = 'stmt-payments';

    // Edit worker state
    this.editWorkerPhotoDataUrl = null;
    this.editWorkerRole = 'mistri';
    this.editWorkerContract = 'dihadi';

    // Edit transaction state
    this.editTxType = 'cash';
    this.editTxTarget = 'individual';

    // Trade creation return modal state
    this.tradeReturnModal = null;

    // Language state ('hi' | 'en')
    const savedLang = this.store.getSettings().language;
    this.currentLang = (savedLang === 'en' || savedLang === 'en-IN') ? 'en' : 'hi';

    // Cloud sync state
    this.deviceId = getDeviceId();
    this.lastKnownRemoteStamp = 0;
    this.pendingRemoteData = null;
    this.suppressNextSync = false;
    this.syncErrorMessage = null;

    // A write that cannot be persisted must reach the user, not just the console.
    this.store.onSaveError((err, info) => {
      if (info && info.recovered) {
        this.showToast(this.currentLang === 'en'
          ? `Storage full — ${info.droppedAudio} old voice clip(s) removed to save your ledger`
          : `मेमोरी भर गई — हिसाब बचाने के लिए ${info.droppedAudio} पुरानी आवाज़ रिकॉर्डिंग हटाई गईं`, 6000);
        return;
      }
      alert(this.currentLang === 'en'
        ? 'Could not save! Phone storage is full. Download a backup from Settings and clear old photos/voice notes.'
        : 'सेव नहीं हो पाया! फ़ोन की मेमोरी भर गई है।\n\nसेटिंग्स से बैकअप फ़ाइल डाउनलोड करें और पुरानी फ़ोटो / आवाज़ नोट हटाएँ।');
    });

    this.init();
  }

  showToast(message, duration = 2200) {
    let toast = document.getElementById('appGlobalToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'appGlobalToast';
      toast.className = 'app-global-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  }

  // Compress image file to a lightweight data URL for efficient storage & instant display
  compressImage(file, maxDimension = 240, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxDimension) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            }
          } else {
            if (height > maxDimension) {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  init() {
    initModalUX();
    this.bindEvents();
    this.populateSelects();
    this.applyLanguage(this.currentLang, false);
    this.renderAll();
    this.startClock();
    this.checkEveningBanner();
    this.initFirebaseIntegration();
    this.bindTrolleyEvents();
    this.bindJcbEvents();
    this.bindProjectEvents();
    this.bindLendingEvents();
    this.renderProjectHeader();
  }

  applyLanguage(lang, reRender = true) {
    this.currentLang = (lang === 'en' || lang === 'en-IN') ? 'en' : 'hi';
    const dict = translations[this.currentLang] || translations.hi;

    // Update html lang attribute
    document.documentElement.lang = this.currentLang;

    // Update Header button label: shows target language to switch to
    const currentLangLabel = document.getElementById('currentLangLabel');
    if (currentLangLabel) {
      currentLangLabel.textContent = this.currentLang === 'hi' ? 'English' : 'हिंदी';
    }

    // Update Settings modal language segmented switcher
    document.querySelectorAll('#settingsLangSwitcher .segment-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-lang') === this.currentLang);
    });

    // Update all data-i18n elements
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (dict[key]) el.textContent = dict[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (dict[key]) el.placeholder = dict[key];
    });

    // Update filter chips default labels if present
    const filterAll = document.querySelector('#timelineFilters [data-filter-type="all"]');
    if (filterAll && dict.filterAll) filterAll.textContent = dict.filterAll;
    const filterCash = document.querySelector('#timelineFilters [data-filter-type="cash"]');
    if (filterCash && dict.filterCash) filterCash.textContent = dict.filterCash;
    const filterRation = document.querySelector('#timelineFilters [data-filter-type="ration"]');
    if (filterRation && dict.filterRation) filterRation.textContent = dict.filterRation;
    const filterRecharge = document.querySelector('#timelineFilters [data-filter-type="recharge"]');
    if (filterRecharge && dict.filterRecharge) filterRecharge.textContent = dict.filterRecharge;
    const filterCylinder = document.querySelector('#timelineFilters [data-filter-type="cylinder"]');
    if (filterCylinder && dict.filterCylinder) filterCylinder.textContent = dict.filterCylinder;
    const filterDiesel = document.querySelector('#timelineFilters [data-filter-type="diesel"]');
    if (filterDiesel && dict.filterDiesel) filterDiesel.textContent = dict.filterDiesel;
    const filterMaterial = document.querySelector('#timelineFilters [data-filter-type="material"]');
    if (filterMaterial && dict.filterMaterial) filterMaterial.textContent = dict.filterMaterial;
    const filterOther = document.querySelector('#timelineFilters [data-filter-type="other"]');
    if (filterOther && dict.filterOther) filterOther.textContent = dict.filterOther;
    const btnAddFilter = document.getElementById('btnAddFilterType');
    if (btnAddFilter && dict.filterAdd) btnAddFilter.textContent = dict.filterAdd;

    if (reRender) {
      this.renderAll();
    }
  }

  setLanguage(lang) {
    this.currentLang = (lang === 'en' || lang === 'en-IN') ? 'en' : 'hi';
    const settings = this.store.getSettings();
    settings.language = this.currentLang;
    this.store.updateSettings(settings);

    // Update speech recognition language
    if (this.voiceManager && this.voiceManager.recognition) {
      this.voiceManager.recognition.lang = this.currentLang === 'en' ? 'en-IN' : 'hi-IN';
    }

    this.applyLanguage(this.currentLang, true);
  }

  toggleLanguage() {
    const nextLang = this.currentLang === 'hi' ? 'en' : 'hi';
    this.setLanguage(nextLang);
  }

  /* Cloud sync is disabled while running from a dev server. Testing on localhost
     was pushing the demo ledger straight into the owner's live Firestore, which
     littered it with junk site documents that had to be deleted by hand. A
     developer who genuinely wants to test sync can set VITE_ALLOW_DEV_SYNC=1. */
  isCloudSyncBlocked() {
    return !!import.meta.env?.DEV && import.meta.env?.VITE_ALLOW_DEV_SYNC !== '1';
  }

  async initFirebaseIntegration() {
    const s = this.store.getSettings();
    if (this.isCloudSyncBlocked()) {
      console.info('[site-diary] Dev server: cloud sync disabled so test data cannot reach the live database.');
      this.updateSyncIndicator();
      return;
    }
    if (!s.firebaseConfig) return;
    try {
      const ok = await initFirebase(s.firebaseConfig);
      if (ok && s.firebaseAutoSync) {
        await enableRealtimeSync(s.firebaseSiteId, (remoteData) => this.onRemoteData(remoteData));
      }
      this.updateSyncIndicator();
    } catch (err) {
      console.warn('Firebase init on start failed:', err);
      this.updateSyncIndicator();
    }
  }

  // The realtime callback used to only console.log, so an incoming update was
  // thrown away while this device kept uploading — one-way sync that silently
  // overwrote the other phone. Now remote changes are actually applied.
  /* Does this look like a ledger at all?

     Both shapes count: the current one, which carries `projects`, and the
     pre-projects one a phone on an older build still sends. The old check
     asked only for top-level `workers` and `trades`, so once uploads moved
     inside `projects` every incoming update was dropped on the floor and
     sync quietly stopped working in one direction. */
  looksLikeLedger(d) {
    if (!d || typeof d !== 'object') return false;
    if (Array.isArray(d.projects)) return true;
    return Array.isArray(d.workers) && Array.isArray(d.trades);
  }

  /** Workers across every job — the measure of whether a ledger holds anything. */
  countWorkers(data) {
    if (!data) return 0;
    const inProjects = (data.projects || [])
      .reduce((n, p) => n + (p.workers || []).length, 0);
    return inProjects + (Array.isArray(data.workers) ? data.workers.length : 0);
  }

  onRemoteData(remoteData) {
    if (!this.looksLikeLedger(remoteData)) return;

    // Ignore the echo of our own write.
    if (remoteData.lastWriterDeviceId && remoteData.lastWriterDeviceId === this.deviceId) {
      this.lastKnownRemoteStamp = remoteData.timestamp || 0;
      this.updateSyncIndicator('synced');
      return;
    }

    const remoteStamp = Number(remoteData.timestamp) || 0;
    if (remoteStamp && remoteStamp <= (this.lastKnownRemoteStamp || 0)) return;

    // A remote edit arriving while the user is mid-entry would yank the screen
    // out from under them, so ask rather than overwrite.
    if (this.hasOpenModal()) {
      this.pendingRemoteData = remoteData;
      return;
    }

    this.lastKnownRemoteStamp = remoteStamp;
    this.applyRemoteData(remoteData);
  }

  applyRemoteData(remoteData) {
    // normalise() understands both shapes and migrates the old one, so this
    // no longer flattens projects and lending away the way hand-copying the
    // old top-level fields did.
    const incoming = this.store.normalise(remoteData);

    /* An empty ledger must never silently replace a full one.

       This is not hypothetical: a bug in the MCP writer once wrote back an
       empty document, and nothing here stood between that and the phone's
       own copy. Sync exists to carry work between devices, and no ordinary
       edit on another phone turns a site with workers into a site with
       none. So keep what is here, push it back up, and say so — the local
       copy is the one with something to lose. */
    if (this.countWorkers(this.store.data) > 0 && this.countWorkers(incoming) === 0) {
      this.scheduleSync('empty-remote-rejected');
      this.showToast(this.currentLang === 'en'
        ? 'Cloud copy was empty — kept this phone\u2019s ledger and sent it back up'
        : 'क्लाउड वाली copy खाली थी — '
          + 'इस फ़ोन का हिसाब सुरक्षित है, वही वापस चढ़ा दिया', 6000);
      return;
    }

    this.store.data = {
      ...incoming,
      // Device-local settings (this phone's Firebase config, its site id) must
      // not be replaced by another device's copy.
      settings: {
        ...this.store.getSettings(),
        ...(remoteData.settings || {})
      }
    };
    this.store.save();
    this.suppressNextSync = true; // rendering the result must not bounce it back
    this.activeHaziriTradeId = null;   // the job may have changed under us
    this.populateSelects();
    this.renderProjectHeader();
    this.renderAll();
    this.updateSyncIndicator('synced');
    this.showToast(this.currentLang === 'en'
      ? 'Updated from another device'
      : 'दूसरे फ़ोन से नया हिसाब आ गया');
  }

  hasOpenModal() {
    return !!document.querySelector('.modal-overlay.active, .modal-backdrop.active');
  }

  /* Sync used to run inside renderAll(), so every tab switch and every toggle
     wrote the whole database to Firestore. It now runs only when data actually
     changed, and is debounced so a burst of edits collapses into one write. */
  scheduleSync(reason = 'edit') {
    if (this.isCloudSyncBlocked()) return;
    if (this.suppressNextSync) {
      this.suppressNextSync = false;
      return;
    }
    const s = this.store.getSettings();
    if (!s.firebaseAutoSync || !isFirebaseReady()) return;

    /* An empty ledger is never worth uploading, and can destroy what is up
       there. A fresh install, or one whose data has just been cleared, has
       nothing to back up — but it would happily replace a full cloud copy
       with its own emptiness. The download side already refuses the mirror
       of this; without the same rule here, the very first sync of a new
       phone could wipe the only remaining copy. */
    if (this.countWorkers(this.store.data) === 0) {
      this.updateSyncIndicator('synced');
      return;
    }

    this.updateSyncIndicator('pending');
    clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => this.runSync(reason), 2500);
  }

  async runSync(reason = 'edit') {
    if (this.isCloudSyncBlocked()) return;
    const s = this.store.getSettings();
    if (!s.firebaseAutoSync || !isFirebaseReady()) return;

    this.updateSyncIndicator('syncing');
    try {
      await saveToFirebase(s.firebaseSiteId, this.store.data, this.deviceId);
      this.store.updateSettings({ lastFirebaseSync: Date.now() });
      this.syncErrorMessage = null;
      this.updateSyncIndicator('synced');
    } catch (err) {
      // A failed backup must be visible. Previously this was a console.warn, so a
      // site could go weeks believing it had a cloud copy that never existed.
      this.syncErrorMessage = err.message || String(err);
      this.updateSyncIndicator('error');
      console.warn('AutoSync error:', err);
    }
  }

  updateSyncIndicator(state = null) {
    const el = document.getElementById('syncStatusChip');
    if (!el) return;

    if (this.isCloudSyncBlocked()) {
      el.className = 'sync-chip sync-off';
      el.innerHTML = `<span class="sync-dot"></span><span>DEV</span>`;
      el.title = 'Dev server: cloud sync is off so test data cannot reach the live database.';
      return;
    }

    const s = this.store.getSettings();
    if (!s.firebaseAutoSync || !isFirebaseReady()) {
      el.className = 'sync-chip sync-off';
      el.innerHTML = `<span class="sync-dot"></span><span>${this.currentLang === 'en' ? 'Offline' : 'ऑफ़लाइन'}</span>`;
      el.title = this.currentLang === 'en'
        ? 'Cloud backup is off. Turn it on in Settings.'
        : 'क्लाउड बैकअप बंद है। सेटिंग्स में चालू करें।';
      return;
    }

    const labels = {
      pending: this.currentLang === 'en' ? 'Saving…' : 'सेव हो रहा…',
      syncing: this.currentLang === 'en' ? 'Saving…' : 'सेव हो रहा…',
      synced: this.currentLang === 'en' ? 'Saved' : 'सुरक्षित',
      error: this.currentLang === 'en' ? 'Not saved' : 'सेव नहीं हुआ',
      idle: this.currentLang === 'en' ? 'Not saved yet' : 'अभी सेव नहीं'
    };

    /* Never claim "saved" without evidence. With no explicit state, report what
       actually happened: a failed sync stays failed, and a session that has not
       synced yet says so rather than defaulting to the reassuring label. */
    let key = state;
    if (!key) {
      if (this.syncErrorMessage) key = 'error';
      else if (s.lastFirebaseSync) key = 'synced';
      else key = 'idle';
    }

    const variant = key === 'pending' ? 'syncing' : (key === 'idle' ? 'off' : key);
    el.className = `sync-chip sync-${variant}`;
    el.innerHTML = `<span class="sync-dot"></span><span>${labels[key] || labels.idle}</span>`;

    if (key === 'error' && this.syncErrorMessage) {
      el.title = this.syncErrorMessage;
    } else if (key === 'synced' && s.lastFirebaseSync) {
      const t = new Date(s.lastFirebaseSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      el.title = this.currentLang === 'en' ? `Cloud backup — last saved ${t}` : `क्लाउड बैकअप — अंतिम सेव ${t}`;
    } else {
      el.title = this.currentLang === 'en' ? 'Cloud backup' : 'क्लाउड बैकअप';
    }
  }

  startClock() {
    const updateTime = () => {
      const now = new Date();
      const dateEl = document.getElementById('currentDateDisplay');
      const timeEl = document.getElementById('currentTimeDisplay');
      if (dateEl) {
        const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
        dateEl.textContent = now.toLocaleDateString('hi-IN', options);
      }
      if (timeEl) {
        timeEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    };
    updateTime();
    setInterval(updateTime, 10000);
  }

  onEveningReminderTriggered() {
    this.checkEveningBanner();
  }

  checkEveningBanner() {
    const banner = document.getElementById('eveningAlertBanner');
    if (!banner) return;

    const today = getTodayString();
    const isMarked = this.store.isDateMarkedInDiary(today);
    const settings = this.store.getSettings();

    const now = new Date();
    const [h, m] = (settings.eveningReminderTime || '19:30').split(':').map(Number);
    const reminderMinutes = h * 60 + m;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // Show banner if evening arrived or user already has transactions logged and hasn't marked diary
    const txsToday = this.store.getTransactions(today);
    if (!isMarked && (currentMinutes >= reminderMinutes || txsToday.length > 0)) {
      banner.style.display = 'flex';
      const summaryEl = document.getElementById('eveningAlertSummary');
      if (summaryEl) {
        summaryEl.textContent = `आज कुल ${txsToday.length} लेनदेन व हाजिरी दर्ज है। फिजिकल डायरी में नोट कर लें।`;
      }
    } else {
      banner.style.display = 'none';
    }
  }

  renderAll() {
    this.renderHeaderInfo();
    this.renderStats();
    this.renderTimeline();
    this.renderHaziri();
    this.renderMonthlyHaziri();
    this.renderGroupsLedger();
    this.renderDiarySheet();
    this.renderLending();
    this.checkEveningBanner();
    this.renderProjectHeader();
    // No scheduleSync here: renderAll runs on every tab switch and re-render, and
    // syncing from it is what used to write the whole database on each one. Only
    // commit() — called after a real change — schedules a sync.
    this.updateSyncIndicator();
  }

  /* Shows only the theka fields that apply: the crew working under a thekedar
     has no amount of its own, and a lump-sum contract has no rate or measurement. */
  syncThekaFields() {
    const amountFields = document.getElementById('thekedarAmountFields');
    const helpText = document.getElementById('thekedarHelpText');
    const lumpsum = document.getElementById('thekaLumpsumGroup');
    const rateGroup = document.getElementById('thekaRateGroup');
    const amtInput = document.getElementById('workerThekaAmount');

    if (amountFields) amountFields.style.display = this.modalIsThekedar ? 'block' : 'none';
    const worksRow = document.getElementById('thekedarWorksRow');
    if (worksRow) worksRow.style.display = this.modalIsThekedar ? 'block' : 'none';
    if (helpText) {
      helpText.textContent = this.modalIsThekedar
        ? 'ठेके की पूरी रक़म इन्हीं के नाम पर चढ़ेगी। इनके साथ काम करने वाले बाकी कारीगरों को "ठेकेदार के अधीन" चुनें — उनकी हाजिरी लगेगी पर अलग रक़म नहीं जुड़ेगी।'
        : 'इनकी रोज़ाना हाजिरी लगेगी, पर ठेके की रक़म ठेकेदार के नाम पर ही रहेगी — यहाँ दोबारा नहीं जुड़ेगी।';
    }

    const isRate = this.modalThekaMode === 'rate';
    if (lumpsum) lumpsum.style.display = isRate ? 'none' : 'block';
    if (rateGroup) rateGroup.style.display = isRate ? 'block' : 'none';
    // Only require an amount when this person actually holds a lump-sum contract.
    if (amtInput) {
      if (this.modalIsThekedar && !isRate) amtInput.setAttribute('required', 'true');
      else amtInput.removeAttribute('required');
    }
    this.updateThekaPreview();
  }

  updateThekaPreview() {
    const box = document.getElementById('thekaRatePreview');
    if (!box) return;
    const rate = Number(document.getElementById('workerThekaRate')?.value) || 0;
    const unit = (document.getElementById('workerThekaUnit')?.value || '').trim();
    const qty = Number(document.getElementById('workerThekaQuantity')?.value) || 0;

    if (!rate) {
      box.textContent = 'दर भरते ही कुल रक़म यहाँ दिखेगी।';
      box.classList.remove('has-total');
      return;
    }
    if (!qty) {
      // A rate contract with no measurement yet is normal, not an error.
      box.innerHTML = `दर <strong>₹${rate.toLocaleString('en-IN')}</strong> प्रति ${esc(unit || 'इकाई')} दर्ज है। ` +
        `नाप बाद में भर देंगे तो कुल रक़म अपने आप बन जाएगी।`;
      box.classList.remove('has-total');
      return;
    }
    box.innerHTML = `₹${rate.toLocaleString('en-IN')} × ${qty.toLocaleString('en-IN')} ${esc(unit || 'इकाई')} = ` +
      `<strong>${inr(rate * qty)}</strong>`;
    box.classList.add('has-total');
  }

  /* ===================================================
     TROLLEY DELIVERY
  =================================================== */

  openTrolleyModal(supplierId = null) {
    const suppliers = this.store.getSuppliers('trolley');
    const select = document.getElementById('trolleySupplierSelect');
    const note = document.getElementById('trolleyNoSupplierNote');

    if (suppliers.length === 0) {
      // Nothing to record against yet; say so instead of showing an empty form.
      if (select) select.innerHTML = '<option value="">(कोई ट्रैक्टर वाला नहीं जुड़ा)</option>';
      if (note) note.style.display = 'block';
    } else {
      if (note) note.style.display = 'none';
      if (select) {
        select.innerHTML = suppliers
          .map(w => `<option value="${esc(w.id)}">${esc(w.name)}</option>`)
          .join('');
        if (supplierId) select.value = supplierId;
      }
    }

    this.trolleyMaterial = null;
    const tripsInput = document.getElementById('trolleyTrips');
    if (tripsInput) tripsInput.value = 1;
    const dateInput = document.getElementById('trolleyDate');
    if (dateInput) dateInput.value = getTodayString();
    const noteInput = document.getElementById('trolleyNote');
    if (noteInput) noteInput.value = '';

    this.renderTrolleyMaterials();
    this.updateTrolleyTotal();
    document.getElementById('modalTrolley')?.classList.add('open');
  }

  renderTrolleyMaterials() {
    const box = document.getElementById('trolleyMaterialChips');
    if (!box) return;
    const supplierId = document.getElementById('trolleySupplierSelect')?.value;

    box.innerHTML = TROLLEY_MATERIALS.map(mat => {
      const rate = supplierId ? this.store.getTrolleyRate(supplierId, mat.id) : 0;
      const active = this.trolleyMaterial === mat.id;
      return `
        <button type="button" class="trolley-material-chip ${active ? 'active' : ''} ${rate ? '' : 'no-rate'}"
                data-material="${esc(mat.id)}">
          ${esc(mat.hi)}
          <small>${rate ? `₹${rate.toLocaleString('en-IN')}/ट्रॉली` : 'रेट नहीं भरा'}</small>
        </button>
      `;
    }).join('');
  }

  updateTrolleyTotal() {
    const box = document.getElementById('trolleyTotalBox');
    if (!box) return;
    const supplierId = document.getElementById('trolleySupplierSelect')?.value;
    const trips = Number(document.getElementById('trolleyTrips')?.value) || 0;

    if (!this.trolleyMaterial) {
      box.textContent = 'ऊपर से सामान चुनिए।';
      box.classList.remove('has-total');
      return;
    }
    const rate = this.store.getTrolleyRate(supplierId, this.trolleyMaterial);
    const mat = getTrolleyMaterial(this.trolleyMaterial);
    if (!rate) {
      box.innerHTML = `${esc(mat.hi)} का रेट अभी तय नहीं है। ` +
        `<button type="button" id="btnOpenTrolleyRatesInline" style="background:none;border:none;color:var(--blue-accent);font-weight:700;cursor:pointer;text-decoration:underline;">अभी भरें</button>`;
      box.classList.remove('has-total');
      return;
    }
    box.innerHTML = `${trips} ट्रॉली ${esc(mat.hi)} × ₹${rate.toLocaleString('en-IN')}<strong>${inr(trips * rate)}</strong>`;
    box.classList.add('has-total');
  }

  openTrolleyRatesModal(supplierId) {
    const worker = this.store.getWorker(supplierId);
    if (!worker) return;
    const nameEl = document.getElementById('trolleyRatesWorkerName');
    if (nameEl) nameEl.textContent = worker.name;

    const fields = document.getElementById('trolleyRatesFields');
    if (fields) {
      fields.innerHTML = TROLLEY_MATERIALS.map(mat => `
        <div class="trolley-rate-row">
          <label for="rate_${esc(mat.id)}">${esc(mat.hi)}</label>
          <input type="number" class="form-input" id="rate_${esc(mat.id)}" data-rate-material="${esc(mat.id)}"
                 min="0" step="10" placeholder="₹ प्रति ट्रॉली"
                 value="${this.store.getTrolleyRate(supplierId, mat.id) || ''}" />
        </div>
      `).join('');
    }
    this.trolleyRatesWorkerId = supplierId;
    document.getElementById('modalTrolleyRates')?.classList.add('open');
  }

  /** The message the tractor owner receives — his record of what was delivered. */
  buildTrolleyWhatsAppMessage(supplierId, date) {
    const worker = this.store.getWorker(supplierId);
    const deliveries = this.store.getTrolleyDeliveriesForDate(date, supplierId);
    if (!worker || deliveries.length === 0) return '';

    const dayTotal = deliveries.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const dayTrips = deliveries.reduce((s, d) => s + (Number(d.trips) || 0), 0);
    const ledger = this.store.getSupplierLedger(supplierId);

    let msg = `🚜 *ट्रॉली हिसाब*\n`;
    msg += `------------------------------------\n`;
    msg += `📅 ${formatShortDate(date, 'hi')}\n`;
    msg += `👤 ${worker.name}\n\n`;

    deliveries.forEach(d => {
      const mat = getTrolleyMaterial(d.materialId);
      msg += `• ${mat.hi} — ${d.trips} ट्रॉली × ₹${(d.ratePerTrolley || 0).toLocaleString('en-IN')} = ₹${(d.amount || 0).toLocaleString('en-IN')}\n`;
      if (d.note) msg += `   (${d.note})\n`;
    });

    msg += `------------------------------------\n`;
    msg += `*आज कुल:* ${dayTrips} ट्रॉली — ₹${dayTotal.toLocaleString('en-IN')}\n`;

    if (ledger && ledger.totalAmount !== dayTotal) {
      msg += `\n*अब तक का पूरा हिसाब:*\n`;
      msg += `कुल ट्रॉली: ${ledger.totalTrips}\n`;
      msg += `कुल रक़म: ₹${ledger.totalAmount.toLocaleString('en-IN')}\n`;
      if (ledger.totalPaid > 0) msg += `दिया गया: ₹${ledger.totalPaid.toLocaleString('en-IN')}\n`;
      msg += `*बाकी: ₹${ledger.balanceDue.toLocaleString('en-IN')}*\n`;
    }

    msg += `\n_'श्रम व साइट डायरी' ऐप से_`;
    return msg;
  }

  shareTrolleyOnWhatsApp(supplierId, date) {
    const worker = this.store.getWorker(supplierId);
    const msg = this.buildTrolleyWhatsAppMessage(supplierId, date);
    if (!msg) {
      alert('इस तारीख को इनकी कोई ट्रॉली दर्ज नहीं है।');
      return;
    }
    const digits = (worker.phone || '').replace(/[^0-9]/g, '');
    if (digits.length >= 10) {
      window.open(getWhatsAppUrl(worker.phone, msg), '_blank');
    } else {
      // No number saved — copying still lets them paste it into any chat.
      navigator.clipboard.writeText(msg)
        .then(() => alert('इनका मोबाइल नंबर नहीं है, इसलिए हिसाब कॉपी कर दिया है।\n\nकिसी भी चैट में पेस्ट कर दीजिए।'))
        .catch(() => prompt('कॉपी करने के लिए Ctrl+C दबाएं:', msg));
    }
  }

  /* ===================================================
     JCB / MACHINE HIRE

     A machine is hired by the hour and the day comes in slots — dig from nine
     to one, break from two to half four. Each slot is entered on its own, so
     the form shows what is already down for the day and starts the next slot
     at the time the last one ended.
  =================================================== */

  openJcbModal(supplierId = null) {
    const suppliers = this.store.getSuppliers('machine');
    const select = document.getElementById('jcbSupplierSelect');
    const note = document.getElementById('jcbNoSupplierNote');

    if (suppliers.length === 0) {
      if (select) select.innerHTML = '<option value="">(कोई JCB वाला नहीं जुड़ा)</option>';
      if (note) note.style.display = 'block';
    } else {
      if (note) note.style.display = 'none';
      if (select) {
        select.innerHTML = suppliers
          .map(w => `<option value="${esc(w.id)}">${esc(w.name)}</option>`)
          .join('');
        if (supplierId) select.value = supplierId;
      }
    }

    this.jcbWork = null;
    const dateInput = document.getElementById('jcbDate');
    if (dateInput) dateInput.value = getTodayString();
    ['jcbStart', 'jcbEnd', 'jcbHours', 'jcbNote']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

    this.renderJcbWorks();
    this.renderJcbTodaySlots();
    this.updateJcbTotal();
    document.getElementById('modalJcb')?.classList.add('open');
  }

  renderJcbWorks() {
    const box = document.getElementById('jcbWorkChips');
    if (!box) return;
    const supplierId = document.getElementById('jcbSupplierSelect')?.value;

    box.innerHTML = MACHINE_WORKS.map(work => {
      const rate = supplierId ? this.store.getMachineRate(supplierId, work.id) : 0;
      const active = this.jcbWork === work.id;
      return `
        <button type="button" class="trolley-material-chip ${active ? 'active' : ''} ${rate ? '' : 'no-rate'}"
                data-machine-work="${esc(work.id)}">
          ${esc(work.icon)} ${esc(work.hi)}
          <small>${rate ? `₹${rate.toLocaleString('en-IN')}/घंटा` : 'रेट नहीं भरा'}</small>
        </button>
      `;
    }).join('');
  }

  /** Today's slots for this machine, and the reason the next one starts where
      the last ended — "उससे आगे से आगे तक". */
  renderJcbTodaySlots() {
    const box = document.getElementById('jcbTodaySlots');
    if (!box) return;
    const supplierId = document.getElementById('jcbSupplierSelect')?.value;
    const date = document.getElementById('jcbDate')?.value || getTodayString();
    const slots = supplierId ? this.store.getMachineSlotsForDate(date, supplierId) : [];

    if (slots.length === 0) {
      box.innerHTML = '';
      box.style.display = 'none';
      return;
    }

    const total = slots.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const hours = slots.reduce((sum, t) => sum + (Number(t.hours) || 0), 0);
    box.style.display = 'block';
    box.innerHTML = `
      <div class="jcb-slot-head">इस दिन अब तक दर्ज:</div>
      ${slots.map(t => `
        <div class="jcb-slot-row">
          <span>${esc(getMachineWork(t.workId).hi)}</span>
          <span class="jcb-slot-time">${esc(t.startTime || '?')} – ${esc(t.endTime || '?')}</span>
          <span class="jcb-slot-amt">${inr(t.amount)}</span>
        </div>
      `).join('')}
      <div class="jcb-slot-total">कुल ${esc(formatHours(hours))} — <strong>${inr(total)}</strong></div>
    `;

    // Carry on from where the day left off, unless the user already typed a time.
    const startEl = document.getElementById('jcbStart');
    const lastEnd = slots[slots.length - 1]?.endTime;
    if (startEl && !startEl.value && lastEnd) startEl.value = lastEnd;
  }

  /** Fills the hours from the two times — but never overwrites a figure the
      user typed themselves, because the settled number wins over the clock. */
  syncJcbHoursFromClock() {
    const start = document.getElementById('jcbStart')?.value;
    const end = document.getElementById('jcbEnd')?.value;
    const hoursEl = document.getElementById('jcbHours');
    if (!hoursEl || !start || !end) return;
    const hours = computeHours(start, end);
    if (hours > 0) hoursEl.value = hours;
  }

  updateJcbTotal() {
    const box = document.getElementById('jcbTotalBox');
    if (!box) return;
    const supplierId = document.getElementById('jcbSupplierSelect')?.value;
    const hours = Number(document.getElementById('jcbHours')?.value) || 0;

    if (!this.jcbWork) {
      box.textContent = 'ऊपर से काम चुनिए — बैकहो या ब्रेकर।';
      box.classList.remove('has-total');
      return;
    }
    const rate = this.store.getMachineRate(supplierId, this.jcbWork);
    const work = getMachineWork(this.jcbWork);
    if (!rate) {
      box.innerHTML = `${esc(work.hi)} का घंटे का रेट अभी तय नहीं है। ` +
        `<button type="button" id="btnOpenMachineRatesInline" style="background:none;border:none;color:var(--purple-accent);font-weight:700;cursor:pointer;text-decoration:underline;">अभी भरें</button>`;
      box.classList.remove('has-total');
      return;
    }
    if (hours <= 0) {
      box.textContent = 'कितने बजे से कितने बजे तक चली, वो भरिए।';
      box.classList.remove('has-total');
      return;
    }
    box.innerHTML = `${esc(formatHours(hours))} × ₹${rate.toLocaleString('en-IN')}/घंटा<strong>${inr(Math.round(hours * rate))}</strong>`;
    box.classList.add('has-total');
  }

  openMachineRatesModal(supplierId) {
    const worker = this.store.getWorker(supplierId);
    if (!worker) return;
    const nameEl = document.getElementById('machineRatesWorkerName');
    if (nameEl) nameEl.textContent = worker.name;

    const fields = document.getElementById('machineRatesFields');
    if (fields) {
      fields.innerHTML = MACHINE_WORKS.map(work => `
        <div class="trolley-rate-row">
          <label for="mrate_${esc(work.id)}">${esc(work.icon)} ${esc(work.hi)}</label>
          <input type="number" class="form-input" id="mrate_${esc(work.id)}" data-rate-work="${esc(work.id)}"
                 min="0" step="50" placeholder="₹ प्रति घंटा"
                 value="${this.store.getMachineRate(supplierId, work.id) || ''}" />
        </div>
      `).join('');
    }
    this.machineRatesWorkerId = supplierId;
    document.getElementById('modalMachineRates')?.classList.add('open');
  }

  /** The day's slots, as the machine owner would read them out. */
  buildJcbWhatsAppMessage(supplierId, date) {
    const worker = this.store.getWorker(supplierId);
    const slots = this.store.getMachineSlotsForDate(date, supplierId);
    if (!worker || slots.length === 0) return '';

    const dayTotal = slots.reduce((s2, t) => s2 + (Number(t.amount) || 0), 0);
    const dayHours = slots.reduce((s2, t) => s2 + (Number(t.hours) || 0), 0);
    const ledger = this.store.getSupplierLedger(supplierId);

    let msg = `🏗️ *JCB का हिसाब*\n`;
    msg += `------------------------------------\n`;
    msg += `📅 ${formatShortDate(date, 'hi')}\n`;
    msg += `👤 ${worker.name}\n\n`;

    slots.forEach(t => {
      const work = getMachineWork(t.workId);
      msg += `• ${work.hi}\n`;
      msg += `   ${t.startTime || '?'} – ${t.endTime || '?'} = ${formatHours(t.hours)}\n`;
      msg += `   ${formatHours(t.hours)} × ₹${(t.ratePerHour || 0).toLocaleString('en-IN')} = ₹${(t.amount || 0).toLocaleString('en-IN')}\n`;
      if (t.note) msg += `   (${t.note})\n`;
    });

    msg += `------------------------------------\n`;
    msg += `*आज कुल:* ${formatHours(dayHours)} — ₹${dayTotal.toLocaleString('en-IN')}\n`;

    if (ledger && ledger.totalAmount !== dayTotal) {
      msg += `\n*अब तक का पूरा हिसाब:*\n`;
      msg += `कुल समय: ${formatHours(ledger.totalHours)}\n`;
      msg += `कुल रक़म: ₹${ledger.totalAmount.toLocaleString('en-IN')}\n`;
      if (ledger.totalPaid > 0) msg += `दिया गया: ₹${ledger.totalPaid.toLocaleString('en-IN')}\n`;
      msg += `*बाकी: ₹${ledger.balanceDue.toLocaleString('en-IN')}*\n`;
    }

    msg += `\n_'श्रम व साइट डायरी' ऐप से_`;
    return msg;
  }

  shareJcbOnWhatsApp(supplierId, date) {
    const worker = this.store.getWorker(supplierId);
    const msg = this.buildJcbWhatsAppMessage(supplierId, date);
    if (!msg) {
      alert('इस तारीख को इनका कोई समय दर्ज नहीं है।');
      return;
    }
    const digits = (worker.phone || '').replace(/[^0-9]/g, '');
    if (digits.length >= 10) {
      window.open(getWhatsAppUrl(worker.phone, msg), '_blank');
    } else {
      navigator.clipboard.writeText(msg)
        .then(() => alert('इनका मोबाइल नंबर नहीं है, इसलिए हिसाब कॉपी कर दिया है।\n\nकिसी भी चैट में पेस्ट कर दीजिए।'))
        .catch(() => prompt('कॉपी करने के लिए Ctrl+C दबाएं:', msg));
    }
  }

  bindJcbEvents() {
    document.addEventListener('click', (e) => {
      if (e.target.closest('#btnOpenJcb, [data-open-jcb]')) {
        const id = e.target.closest('[data-open-jcb]')?.getAttribute('data-open-jcb');
        if (!id && this.store.getSuppliers('machine').length === 0) {
          const jcbTrade = this.store.getTrades().find(t => t.supplierKind === 'machine');
          this.openAddWorkerModal(jcbTrade ? jcbTrade.id : null);
          this.showToast('JCB वाले का नाम व नंबर भरें — फिर समय दर्ज कर सकेंगे', 4000);
          return;
        }
        this.openJcbModal(id || null);
      }

      const workChip = e.target.closest('[data-machine-work]');
      if (workChip) {
        this.jcbWork = workChip.getAttribute('data-machine-work');
        this.renderJcbWorks();
        this.updateJcbTotal();
      }

      if (e.target.closest('#btnOpenMachineRatesInline')) {
        const supplierId = document.getElementById('jcbSupplierSelect')?.value;
        if (supplierId) this.openMachineRatesModal(supplierId);
      }

      const rateBtn = e.target.closest('[data-open-machine-rates]');
      if (rateBtn) this.openMachineRatesModal(rateBtn.getAttribute('data-open-machine-rates'));

      const waBtn = e.target.closest('[data-jcb-wa]');
      if (waBtn) {
        this.shareJcbOnWhatsApp(waBtn.getAttribute('data-jcb-wa'),
                                waBtn.getAttribute('data-jcb-date') || getTodayString());
      }
    });

    ['jcbStart', 'jcbEnd'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        this.syncJcbHoursFromClock();
        this.updateJcbTotal();
      });
    });
    document.getElementById('jcbHours')?.addEventListener('input', () => this.updateJcbTotal());
    document.getElementById('jcbSupplierSelect')?.addEventListener('change', () => {
      this.renderJcbWorks();
      this.renderJcbTodaySlots();
      this.updateJcbTotal();
    });
    document.getElementById('jcbDate')?.addEventListener('change', () => this.renderJcbTodaySlots());

    document.getElementById('btnSaveJcb')?.addEventListener('click', () => {
      const supplierId = document.getElementById('jcbSupplierSelect')?.value;
      if (!supplierId) {
        alert('पहले JCB वाले को जोड़ें।');
        return;
      }
      if (!this.jcbWork) {
        alert('कौन सा काम हुआ — बैकहो या ब्रेकर, वो चुनिए।');
        return;
      }
      const startTime = document.getElementById('jcbStart')?.value || '';
      const endTime = document.getElementById('jcbEnd')?.value || '';
      const hours = Number(document.getElementById('jcbHours')?.value) || 0;
      const date = document.getElementById('jcbDate')?.value || getTodayString();
      const note = document.getElementById('jcbNote')?.value || '';

      let tx;
      try {
        tx = this.store.addMachineSlot({ workerId: supplierId, workId: this.jcbWork,
                                        date, startTime, endTime, hours, note });
      } catch (err) {
        alert(err.message);
        return;
      }

      this.commit();
      const worker = this.store.getWorker(supplierId);
      const work = getMachineWork(this.jcbWork);

      // The day often has a second slot, so offer to stay and add it rather
      // than making them find the button again.
      const another = confirm(
        `✅ दर्ज हो गया\n\n${work.hi} — ${formatHours(tx.hours)} — ${inr(tx.amount)}\n\nइसी दिन का एक और समय जोड़ना है?`
      );

      if (another) {
        // Keep the machine and the date; clear the slot so the next one starts
        // from where this one ended.
        this.jcbWork = null;
        ['jcbStart', 'jcbEnd', 'jcbHours', 'jcbNote']
          .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        this.renderJcbWorks();
        this.renderJcbTodaySlots();
        this.updateJcbTotal();
        return;
      }

      this.closeModals();
      if (confirm(`${worker.name} को WhatsApp पर आज का हिसाब भेजें?`)) {
        this.shareJcbOnWhatsApp(supplierId, date);
      }
    });

    document.getElementById('btnSaveMachineRates')?.addEventListener('click', () => {
      const rates = {};
      document.querySelectorAll('#machineRatesFields [data-rate-work]').forEach(input => {
        rates[input.getAttribute('data-rate-work')] = input.value;
      });
      this.store.setMachineRates(this.machineRatesWorkerId, rates);
      document.getElementById('modalMachineRates')?.classList.remove('open');
      this.renderJcbWorks();
      this.updateJcbTotal();
      this.commit();
      this.showToast('घंटे का रेट सेव हो गया');
    });
  }

  bindTrolleyEvents() {
    document.addEventListener('click', (e) => {
      if (e.target.closest('#btnOpenTrolley, [data-open-trolley]')) {
        const id = e.target.closest('[data-open-trolley]')?.getAttribute('data-open-trolley');
        // Nothing to record against yet — send them to add the tractor owner,
        // with the trade already chosen, instead of an empty delivery form.
        if (!id && this.store.getSuppliers('trolley').length === 0) {
          const tractorTrade = this.store.getTrades()
            .find(t => t.isSupplier && (t.supplierKind || 'trolley') === 'trolley');
          this.openAddWorkerModal(tractorTrade ? tractorTrade.id : null);
          this.showToast('ट्रैक्टर वाले का नाम व नंबर भरें — फिर ट्रॉली दर्ज कर सकेंगे', 4000);
          return;
        }
        this.openTrolleyModal(id || null);
      }

      const matChip = e.target.closest('[data-material]');
      if (matChip) {
        this.trolleyMaterial = matChip.getAttribute('data-material');
        this.renderTrolleyMaterials();
        this.updateTrolleyTotal();
      }

      const quick = e.target.closest('[data-trips]');
      if (quick) {
        const input = document.getElementById('trolleyTrips');
        if (input) input.value = quick.getAttribute('data-trips');
        document.querySelectorAll('.trolley-quick-btn').forEach(b => b.classList.toggle('active', b === quick));
        this.updateTrolleyTotal();
      }

      if (e.target.closest('#btnOpenTrolleyRatesInline')) {
        const supplierId = document.getElementById('trolleySupplierSelect')?.value;
        if (supplierId) this.openTrolleyRatesModal(supplierId);
      }

      const rateBtn = e.target.closest('[data-open-trolley-rates]');
      if (rateBtn) this.openTrolleyRatesModal(rateBtn.getAttribute('data-open-trolley-rates'));

      const waBtn = e.target.closest('[data-trolley-wa]');
      if (waBtn) {
        this.shareTrolleyOnWhatsApp(waBtn.getAttribute('data-trolley-wa'), waBtn.getAttribute('data-trolley-date') || getTodayString());
      }
    });

    const step = (delta) => {
      const input = document.getElementById('trolleyTrips');
      if (!input) return;
      input.value = Math.max(1, Math.min(50, (Number(input.value) || 1) + delta));
      document.querySelectorAll('.trolley-quick-btn').forEach(b => b.classList.remove('active'));
      this.updateTrolleyTotal();
    };
    document.getElementById('btnTripMinus')?.addEventListener('click', () => step(-1));
    document.getElementById('btnTripPlus')?.addEventListener('click', () => step(1));
    document.getElementById('trolleyTrips')?.addEventListener('input', () => this.updateTrolleyTotal());
    document.getElementById('trolleySupplierSelect')?.addEventListener('change', () => {
      this.renderTrolleyMaterials();
      this.updateTrolleyTotal();
    });

    document.getElementById('btnSaveTrolley')?.addEventListener('click', () => {
      const supplierId = document.getElementById('trolleySupplierSelect')?.value;
      if (!supplierId) {
        alert('पहले ट्रैक्टर वाले को जोड़ें।');
        return;
      }
      if (!this.trolleyMaterial) {
        alert('कौन सा सामान आया, वो चुनिए।');
        return;
      }
      const trips = Number(document.getElementById('trolleyTrips')?.value) || 0;
      const date = document.getElementById('trolleyDate')?.value || getTodayString();
      const note = document.getElementById('trolleyNote')?.value || '';

      let tx;
      try {
        tx = this.store.addTrolleyDelivery({ workerId: supplierId, materialId: this.trolleyMaterial, trips, date, note });
      } catch (err) {
        alert(err.message);
        return;
      }

      this.closeModals();
      this.commit();

      const worker = this.store.getWorker(supplierId);
      const mat = getTrolleyMaterial(this.trolleyMaterial);
      // Offer the update straight away — that is the moment it is worth sending.
      if (confirm(
        `✅ दर्ज हो गया\n\n${trips} ट्रॉली ${mat.hi} — ${inr(tx.amount)}\n\n` +
        `${worker.name} को WhatsApp पर हिसाब भेजें?`
      )) {
        this.shareTrolleyOnWhatsApp(supplierId, date);
      }
    });

    document.getElementById('btnSaveTrolleyRates')?.addEventListener('click', () => {
      const rates = {};
      document.querySelectorAll('[data-rate-material]').forEach(input => {
        rates[input.getAttribute('data-rate-material')] = input.value;
      });
      this.store.setTrolleyRates(this.trolleyRatesWorkerId, rates);
      document.getElementById('modalTrolleyRates')?.classList.remove('open');
      this.renderTrolleyMaterials();
      this.updateTrolleyTotal();
      this.commit();
      this.showToast('ट्रॉली के रेट सेव हो गए');
    });
  }

  /* ===================================================
     PROJECTS (काम)

     A contractor runs several jobs at once. Each keeps its own workers,
     attendance and expenses, so switching jobs re-renders everything below the
     header. Per-screen state that belonged to the previous job is reset too,
     otherwise a trade tab or an open worker statement carries across.
  =================================================== */

  renderProjectHeader() {
    const project = this.store.activeProject();
    if (!project) return;
    const iconEl = document.getElementById('activeProjectIcon');
    const nameEl = document.getElementById('activeProjectName');
    if (iconEl) iconEl.textContent = project.icon || '🏗';
    if (nameEl) nameEl.textContent = project.name;
    // With only one job there is nothing to switch to, so drop the hint.
    const hint = document.querySelector('.brand-switch-hint');
    if (hint) hint.style.display = this.store.getProjects().length > 1 ? '' : 'none';
  }

  openProjectsModal() {
    this.renderProjectsList();
    document.getElementById('modalProjects')?.classList.add('open');
  }

  renderProjectsList() {
    const box = document.getElementById('projectsList');
    if (!box) return;

    box.innerHTML = this.store.getProjects().map(p => {
      const s = this.store.getProjectSummary(p.id);
      return `
        <div class="project-row ${s.isActive ? 'is-active' : ''}">
          <button type="button" class="project-pick" data-pick-project="${esc(p.id)}">
            <span class="project-row-icon">${esc(s.icon)}</span>
            <span class="project-row-body">
              <span class="project-row-name">${esc(s.name)}${s.isActive ? ' <em>· अभी खुला</em>' : ''}</span>
              <span class="project-row-meta">${s.workers} कारीगर · ${s.daysTracked} दिन · ${inr(s.totalSpent)}</span>
              ${s.note ? `<span class="project-row-note">${esc(s.note)}</span>` : ''}
            </span>
          </button>
          <button type="button" class="project-edit" data-edit-project="${esc(p.id)}" title="नाम बदलें या हटाएँ">✏️</button>
        </div>
      `;
    }).join('');
  }

  switchProject(id) {
    if (!this.store.setActiveProject(id)) return;
    this.closeModals();
    this.activeHaziriTradeId = null;
    this.activeStatementWorkerId = null;
    this.selectedHaziriDate = getTodayString();
    this.populateSelects();
    this.renderProjectHeader();
    this.commit();
    this.showToast(this.store.activeProject().name + ' खुल गया');
  }

  promptNewProject() {
    // Ask what kind of work first: a hotel has no masons and a building site has
    // no chefs, so the job starts with categories that actually fit.
    const choices = JOB_TEMPLATES.map((t, n) => (n + 1) + '. ' + t.icon + ' ' + t.hi).join('\n');
    const pick = prompt('यह किस तरह का काम है?' + '\n' + '\n' + choices + '\n' + '\n' + 'नंबर लिखिए:', '1');
    if (pick === null) return;
    const template = JOB_TEMPLATES[(Number(pick) || 1) - 1] || JOB_TEMPLATES[0];

    const name = prompt('काम का नाम?' + '\n' + '\n' + 'जैसे: नहर का काम, बाउंड्री वॉल, होटल का स्टाफ');
    if (!name || !name.trim()) return;

    const project = this.store.addProject(name.trim(), { icon: template.icon, template: template.id });
    this.closeModals();
    this.activeHaziriTradeId = null;
    this.selectedHaziriDate = getTodayString();
    this.populateSelects();
    this.renderProjectHeader();
    this.commit();
    this.showToast('"' + project.name + '"' + ' बन गया — अब इसमें कारीगर जोड़िए', 4000);
  }

  editProject(id) {
    const project = this.store.getProject(id);
    if (!project) return;
    const summary = this.store.getProjectSummary(id);

    const name = prompt('काम का नाम:', project.name);
    if (name === null) return;           // cancelled

    // Clearing the name is how the user asks to delete the job.
    if (!name.trim()) {
      if (this.store.getProjects().length <= 1) {
        alert('यह आख़िरी काम है — इसे हटाया नहीं जा सकता।');
        return;
      }
      const warning = '"' + project.name + '" को हटाएँ?' + '\n\n' +
        'इसके ' + summary.workers + ' कारीगर, ' + summary.transactions + ' लेन-देन और ' +
        summary.daysTracked + ' दिन की हाजिरी हमेशा के लिए चली जाएगी।' + '\n\n' + 'हटाएँ?';
      if (!confirm(warning)) return;
      this.store.deleteProject(id);
      this.renderProjectsList();
      this.renderProjectHeader();
      this.commit();
      this.showToast('काम हटा दिया गया');
      return;
    }

    const note = prompt('छोटा विवरण (ज़रूरी नहीं):', project.note || '');
    this.store.updateProject(id, { name: name.trim(), note: note === null ? project.note : note });
    this.renderProjectsList();
    this.renderProjectHeader();
    this.commit();
  }

  bindProjectEvents() {
    document.getElementById('btnProjectSwitch')?.addEventListener('click', () => this.openProjectsModal());
    document.getElementById('btnAddProject')?.addEventListener('click', () => this.promptNewProject());
    document.addEventListener('click', (e) => {
      const pick = e.target.closest('[data-pick-project]');
      if (pick) this.switchProject(pick.getAttribute('data-pick-project'));
      const edit = e.target.closest('[data-edit-project]');
      if (edit) this.editProject(edit.getAttribute('data-edit-project'));
    });
  }

  /* ===================================================
     LENDING REGISTER (उधार)

     Both directions in one list: what you lent out, and what you borrowed. The
     question a contractor actually asks is "who owes whom what", so splitting
     them into two screens would only mean looking in two places.
  =================================================== */

  renderLending() {
    const box = document.getElementById('lendingList');
    const summaryBox = document.getElementById('lendingSummary');
    if (!box) return;
    const unlocked = this.lendingLock.unlocked;
    document.getElementById('lendingLocked').hidden = unlocked;
    document.getElementById('lendingPrivateContent').hidden = !unlocked;
    if (!unlocked) {
      box.innerHTML = '';
      if (summaryBox) summaryBox.innerHTML = '';
      return;
    }

    const s = this.store.getLendingSummary();
    if (summaryBox) {
      summaryBox.innerHTML = `
        <div class="lend-stat lend-stat-out">
          <span class="lend-stat-label">लोगों से लेना है</span>
          <strong>${inr(s.moneyOut)}</strong>
          <small>${s.itemsOut} सामान बाहर</small>
        </div>
        <div class="lend-stat lend-stat-in">
          <span class="lend-stat-label">मुझे देना है</span>
          <strong>${inr(s.moneyIn)}</strong>
          <small>${s.itemsIn} सामान लिया हुआ</small>
        </div>
      `;
    }

    const filter = this.lendingFilter || 'pending';
    let list;
    if (filter === 'pending') list = this.store.getLending({ pending: true });
    else if (filter === 'returned') list = this.store.getLending({ pending: false });
    else if (filter === 'given' || filter === 'taken') list = this.store.getLending({ direction: filter });
    else list = this.store.getLending();

    if (list.length === 0) {
      box.innerHTML = `
        <div class="lending-empty">
          <div style="font-size: 2.4rem; margin-bottom: 8px;">🤝</div>
          <p>${filter === 'pending'
            ? 'कुछ भी बाकी नहीं — सब निपट गया।'
            : 'यहाँ अभी कुछ दर्ज नहीं है।'}</p>
          <p class="lending-empty-hint">ऊपर से "मैंने दिया" या "मैंने लिया" दबाकर शुरू कीजिए।</p>
        </div>
      `;
      return;
    }

    box.innerHTML = list.map(l => {
      const given = l.direction === 'given';
      const what = l.kind === 'money'
        ? inr(l.amount)
        : `${esc(l.itemName)}${l.quantity ? ' · ' + esc(l.quantity) : ''}`;
      return `
        <div class="lend-card ${l.returned ? 'is-returned' : ''} ${given ? 'is-given' : 'is-taken'}">
          ${l.photoUrl
            ? `<img class="lend-photo" src="${esc(l.photoUrl)}" alt="${esc(l.itemName)}" data-lend-photo="${esc(l.id)}" />`
            : `<div class="lend-photo lend-photo-none">${l.kind === 'money' ? '💵' : '📦'}</div>`}
          <div class="lend-body">
            <div class="lend-top">
              <span class="lend-dir">${given ? '📤 दिया' : '📥 लिया'}</span>
              ${l.returned ? '<span class="lend-done">✓ निपट गया</span>' : ''}
            </div>
            <div class="lend-what">${what}</div>
            <div class="lend-person">${given ? 'किसको:' : 'किससे:'} <strong>${esc(l.personName)}</strong></div>
            <div class="lend-meta">📅 ${esc(l.date)}${l.returnedDate ? ` · वापस ${esc(l.returnedDate)}` : ''}</div>
            ${l.note ? `<div class="lend-note">${esc(l.note)}</div>` : ''}
            ${l.returnNote ? `<div class="lend-note">वापसी: ${esc(l.returnNote)}</div>` : ''}
            <div class="lend-actions">
              ${l.returned
                ? `<button type="button" class="lend-btn" data-lend-reopen="${esc(l.id)}">↩︎ वापस खोलें</button>`
                : `<button type="button" class="lend-btn lend-btn-done" data-lend-return="${esc(l.id)}">✓ वापस आ गया</button>`}
              ${l.phone ? `<a class="lend-btn" href="${esc(getWhatsAppUrl(l.phone, this.buildLendingReminder(l)))}" target="_blank">📲 याद दिलाएँ</a>` : ''}
              <button type="button" class="lend-btn lend-btn-del" data-lend-delete="${esc(l.id)}">🗑️</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  buildLendingReminder(l) {
    const what = l.kind === 'money' ? `₹${(l.amount || 0).toLocaleString('en-IN')}` :
      `${l.itemName}${l.quantity ? ' (' + l.quantity + ')' : ''}`;
    if (l.direction === 'given') {
      return `नमस्ते ${l.personName} जी,\n\n${l.date} को आपने ${what} लिया था।\n\nअगर हो सके तो वापस कर दीजिए। धन्यवाद।`;
    }
    return `नमस्ते ${l.personName} जी,\n\n${l.date} को मैंने आपसे ${what} लिया था — याद है, जल्द वापस कर दूँगा।`;
  }

  openLendingModal(direction) {
    if (!this.lendingLock.unlocked) return;
    this.lendingDirection = direction === 'taken' ? 'taken' : 'given';
    this.lendingKind = 'item';
    this.lendingPhotoDataUrl = null;

    const title = document.getElementById('lendingModalTitle');
    if (title) title.textContent = this.lendingDirection === 'given' ? '📤 मैंने दिया' : '📥 मैंने लिया';
    const personLabel = document.getElementById('lendingPersonLabel');
    if (personLabel) {
      personLabel.textContent = this.lendingDirection === 'given' ? 'किसको दिया? (नाम)' : 'किससे लिया? (नाम)';
    }

    ['lendingPerson', 'lendingPhone', 'lendingItem', 'lendingQty', 'lendingAmount', 'lendingNote']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const dateEl = document.getElementById('lendingDate');
    if (dateEl) dateEl.value = getTodayString();

    this.clearLendingPhoto();
    this.renderLendingItemChips();
    this.syncLendingKindFields();
    document.querySelectorAll('#lendingKindSwitcher .segment-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-lend-kind') === 'item');
    });
    document.getElementById('modalLending')?.classList.add('open');
  }

  /* Suggestions the user can tap, sitting under a box they can also just type
     into. Deliberately not a <datalist>: the Android WebView renders that as a
     full-screen popup that reads like a closed list of choices, so the user
     could not tell that any name was allowed. */
  renderLendingItemChips() {
    const box = document.getElementById('lendingItemChips');
    if (!box) return;

    // Names this user has actually used come first; ours fill in behind them.
    const used = [];
    this.store.getLending({ kind: 'item' }).forEach(l => {
      const name = (l.itemName || '').trim();
      if (name && !used.includes(name)) used.push(name);
    });
    const names = used
      .concat(LENDING_ITEM_SUGGESTIONS.filter(n => !used.includes(n)))
      .slice(0, 14);

    box.innerHTML = names.map(n =>
      `<button type="button" class="suggest-chip" data-lend-item="${esc(n)}">${esc(n)}</button>`
    ).join('');
  }

  syncLendingKindFields() {
    const isMoney = this.lendingKind === 'money';
    const itemFields = document.getElementById('lendingItemFields');
    const moneyFields = document.getElementById('lendingMoneyFields');
    if (itemFields) itemFields.style.display = isMoney ? 'none' : 'block';
    if (moneyFields) moneyFields.style.display = isMoney ? 'block' : 'none';
  }

  clearLendingPhoto() {
    this.lendingPhotoDataUrl = null;
    const img = document.getElementById('lendingPhotoImg');
    const ph = document.getElementById('lendingPhotoPlaceholder');
    const rm = document.getElementById('btnLendingPhotoRemove');
    const input = document.getElementById('lendingPhotoInput');
    if (img) { img.src = ''; img.style.display = 'none'; }
    if (ph) ph.style.display = 'block';
    if (rm) rm.style.display = 'none';
    if (input) input.value = '';
  }

  bindLendingEvents() {
    document.getElementById('btnBackFromLending').addEventListener('click', () => {
      this.goToTab(this.lendingReturnTab || 'tab-haziri');
    });
    document.getElementById('btnUnlockLending').addEventListener('click', async () => {
      if (await this.lendingLock.request()) this.renderLending();
    });
    document.getElementById('btnLockLending').addEventListener('click', () => this.lendingLock.lock());
    document.getElementById('btnChangeLendingPassword').addEventListener('click', async () => {
      if (await this.lendingLock.request({ change: true })) this.showToast('पासवर्ड बदल दिया गया');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.lendingLock.lock();
    });
    window.addEventListener('pagehide', () => this.lendingLock.lock());
    window.addEventListener('storage', event => {
      if (event.key === null || event.key === 'site_diary_lending_lock_v1') this.lendingLock.lock();
    });
    ['pointerdown', 'keydown', 'scroll'].forEach(name => {
      document.addEventListener(name, () => this.lendingLock.touch(), { passive: true, capture: true });
    });
    // Typing by hand drops the picked highlight, so chip and box never disagree.
    document.getElementById('lendingItem')?.addEventListener('input', () => {
      document.querySelectorAll('#lendingItemChips .suggest-chip')
        .forEach(c => c.classList.remove('is-picked'));
    });

    document.addEventListener('click', (e) => {
      const add = e.target.closest('[data-new-lending]');
      if (!this.lendingLock.unlocked) return;
      if (add) this.openLendingModal(add.getAttribute('data-new-lending'));

      const pickItem = e.target.closest('[data-lend-item]');
      if (pickItem) {
        const input = document.getElementById('lendingItem');
        if (input) input.value = pickItem.getAttribute('data-lend-item');
        document.querySelectorAll('#lendingItemChips .suggest-chip')
          .forEach(c => c.classList.toggle('is-picked', c === pickItem));
      }

      const kind = e.target.closest('[data-lend-kind]');
      if (kind) {
        document.querySelectorAll('#lendingKindSwitcher .segment-btn').forEach(b => b.classList.remove('active'));
        kind.classList.add('active');
        this.lendingKind = kind.getAttribute('data-lend-kind');
        this.syncLendingKindFields();
      }

      const filter = e.target.closest('[data-lend-filter]');
      if (filter) {
        document.querySelectorAll('#lendingFilters .filter-chip').forEach(b => b.classList.remove('active'));
        filter.classList.add('active');
        this.lendingFilter = filter.getAttribute('data-lend-filter');
        this.renderLending();
      }

      const ret = e.target.closest('[data-lend-return]');
      if (ret) {
        const note = prompt('वापसी के बारे में कुछ लिखना है? (ज़रूरी नहीं)', '');
        if (note === null) return;
        this.store.setLendingReturned(ret.getAttribute('data-lend-return'), true, note);
        this.renderLending();
        this.scheduleSync('lending');
        this.showToast('निपट गया — रिकॉर्ड में रहेगा');
      }

      const reopen = e.target.closest('[data-lend-reopen]');
      if (reopen) {
        this.store.setLendingReturned(reopen.getAttribute('data-lend-reopen'), false);
        this.renderLending();
        this.scheduleSync('lending');
      }

      const del = e.target.closest('[data-lend-delete]');
      if (del) {
        const entry = this.store.getLendingEntry(del.getAttribute('data-lend-delete'));
        if (entry && confirm(`"${entry.personName}" वाली यह लिखत हटाएँ?\n\nयह वापस नहीं आएगी।`)) {
          this.store.deleteLending(entry.id);
          this.renderLending();
          this.scheduleSync('lending');
        }
      }

      // Tapping the photo opens it full size — the whole reason it was taken.
      const photo = e.target.closest('[data-lend-photo]');
      if (photo) {
        const entry = this.store.getLendingEntry(photo.getAttribute('data-lend-photo'));
        if (entry?.photoUrl) {
          const viewer = document.createElement('dialog');
          viewer.id = 'lendingPhotoViewer';
          viewer.className = 'lending-password-dialog';
          const image = document.createElement('img');
          image.src = entry.photoUrl;
          image.alt = 'उधार की फ़ोटो';
          image.style.width = '100%';
          const close = document.createElement('button');
          close.className = 'btn-secondary';
          close.textContent = 'बंद करें';
          close.onclick = () => viewer.close();
          viewer.append(image, close);
          viewer.addEventListener('close', () => viewer.remove(), { once: true });
          document.body.append(viewer);
          viewer.showModal();
        }
      }
    });

    document.getElementById('btnLendingPhoto')?.addEventListener('click', () => {
      if (!this.lendingLock.unlocked) return;
      document.getElementById('lendingPhotoInput')?.click();
    });
    document.getElementById('btnLendingPhotoRemove')?.addEventListener('click', () => this.clearLendingPhoto());
    document.getElementById('lendingPhotoInput')?.addEventListener('change', async (e) => {
      if (!this.lendingLock.unlocked) return;
      const generation = this.lendingLock.generation;
      const file = e.target.files[0];
      if (!file) return;
      try {
        // Compressed like worker photos: a full-size camera image would eat the
        // 5MB storage budget in a handful of entries.
        const photoData = await this.resizeImage(file, 800, 800, 0.72);
        if (!this.lendingLock.unlocked || generation !== this.lendingLock.generation) return;
        this.lendingPhotoDataUrl = photoData;
        const img = document.getElementById('lendingPhotoImg');
        const ph = document.getElementById('lendingPhotoPlaceholder');
        const rm = document.getElementById('btnLendingPhotoRemove');
        if (img) { img.src = this.lendingPhotoDataUrl; img.style.display = 'block'; }
        if (ph) ph.style.display = 'none';
        if (rm) rm.style.display = 'inline-flex';
      } catch {
        alert('फ़ोटो नहीं ली जा सकी।');
      }
    });

    document.getElementById('btnSaveLending')?.addEventListener('click', () => {
      if (!this.lendingLock.unlocked) return;
      try {
        this.store.addLending({
          direction: this.lendingDirection,
          kind: this.lendingKind,
          personName: document.getElementById('lendingPerson')?.value,
          phone: document.getElementById('lendingPhone')?.value,
          itemName: document.getElementById('lendingItem')?.value,
          quantity: document.getElementById('lendingQty')?.value,
          amount: document.getElementById('lendingAmount')?.value,
          photoUrl: this.lendingPhotoDataUrl,
          date: document.getElementById('lendingDate')?.value,
          note: document.getElementById('lendingNote')?.value
        });
      } catch (err) {
        alert(err.message);
        return;
      }
      this.closeModals();
      this.lendingFilter = 'pending';
      document.querySelectorAll('#lendingFilters .filter-chip').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-lend-filter') === 'pending');
      });
      this.renderLending();
      this.scheduleSync('lending');
      this.showToast('उधार में दर्ज हो गया');
    });
  }

  // Call this after anything that CHANGES data (not after merely re-rendering).
  commit(reason = 'edit') {
    this.renderAll();
    this.scheduleSync(reason);
  }

  renderHeaderInfo() {
    const settings = this.store.getSettings();
    const reminderTimeEl = document.getElementById('headerReminderTime');
    if (reminderTimeEl) {
      reminderTimeEl.textContent = settings.eveningReminderTime || '19:30';
    }
  }

  renderStats() {
    const today = getTodayString();
    const txs = this.store.getTransactions(today);
    const haziri = this.store.getHaziri(today);

    /* Same worker/site split the ledger and the diary slip use, so all three
       screens tell the same story. Tile 1 is everything charged to a named
       worker (cash, recharge, an advance in material) — not just type 'cash'. */
    const cashTotal = txs
      .filter(t => t.targetType !== 'group' && t.workerId)
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const statCashEl = document.getElementById('statTodayCash');
    if (statCashEl) statCashEl.textContent = `₹${cashTotal.toLocaleString('en-IN')}`;

    // Ration
    const rationTotal = txs
      .filter(t => t.type === 'ration')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    const statRationEl = document.getElementById('statTodayRation');
    if (statRationEl) statRationEl.textContent = `₹${rationTotal.toLocaleString('en-IN')}`;

    // Every type counts toward the headline figure. Summing only cash+ration meant
    // a ₹5,000 diesel or material entry showed the day's total as ₹0.
    const todayTotal = txs.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const otherTotal = todayTotal - cashTotal - rationTotal;
    const statOtherEl = document.getElementById('statTodayOther');
    if (statOtherEl) statOtherEl.textContent = inr(otherTotal);
    const otherCard = document.getElementById('metricCardOther');
    if (otherCard) otherCard.style.display = otherTotal > 0 ? '' : 'none';
    const overviewTotalEl = document.getElementById('overviewTodayTotalDisplay');
    if (overviewTotalEl) overviewTotalEl.textContent = `₹${todayTotal.toLocaleString('en-IN')}`;

    // Haziri count
    let workerCount = 0;
    Object.values(haziri).forEach(h => {
      if (h.status > 0) workerCount += 1;
    });
    const statHaziriEl = document.getElementById('statTodayHaziri');
    if (statHaziriEl) statHaziriEl.textContent = `${workerCount} लोग`;

    // Update real-time quick summary on primary Haziri button
    const quickSummary = document.getElementById('quickHaziriStatusSummary');
    if (quickSummary) {
      const allWorkers = this.store.getWorkers();
      if (this.currentLang === 'en') {
        quickSummary.textContent = `${workerCount} of ${allWorkers.length} present • Mark or review →`;
      } else {
        quickSummary.textContent = `${allWorkers.length} में से ${workerCount} उपस्थित • हाजिरी भरें या बदलें →`;
      }
    }

    /* The two supplier buttons. Each stays visible as long as its trade exists,
       even with nobody added yet: hiding them until a supplier existed made the
       whole feature undiscoverable — nothing on screen said a tractor or a JCB
       could be added at all. Empty, the button is the invitation to set one up. */
    const trolleyBtn = document.getElementById('btnOpenTrolley');
    const jcbBtn = document.getElementById('btnOpenJcb');

    if (trolleyBtn) {
      const suppliers = this.store.getSuppliers('trolley');
      const hasTrade = this.store.getTrades()
        .some(t => t.isSupplier && (t.supplierKind || 'trolley') === 'trolley');
      trolleyBtn.style.display = hasTrade ? '' : 'none';
      trolleyBtn.classList.toggle('is-setup', suppliers.length === 0);

      const label = document.getElementById('trolleyBtnLabel');
      if (label) {
        label.textContent = suppliers.length === 0
          ? 'ट्रैक्टर जोड़ें'
          : 'ट्रॉली';
      }
      const summary = document.getElementById('trolleyTodaySummary');
      if (summary) {
        const todays = this.store.getTrolleyDeliveriesForDate(today);
        if (suppliers.length === 0) {
          summary.textContent = 'रेता, बजरी गिनने →';
        } else if (todays.length === 0) {
          summary.textContent = 'रेता, बजरी +';
        } else {
          const trips = todays.reduce((n, t) => n + (Number(t.trips) || 0), 0);
          const amt = todays.reduce((n, t) => n + (Number(t.amount) || 0), 0);
          summary.textContent = `आज ${trips} · ${inr(amt)}`;
        }
      }
    }

    if (jcbBtn) {
      const machines = this.store.getSuppliers('machine');
      const hasTrade = this.store.getTrades().some(t => t.supplierKind === 'machine');
      jcbBtn.style.display = hasTrade ? '' : 'none';
      jcbBtn.classList.toggle('is-setup', machines.length === 0);

      const label = document.getElementById('jcbBtnLabel');
      if (label) {
        label.textContent = machines.length === 0 ? 'JCB जोड़ें' : 'JCB';
      }
      const summary = document.getElementById('jcbTodaySummary');
      if (summary) {
        const todays = this.store.getMachineSlotsForDate(today);
        if (machines.length === 0) {
          summary.textContent = 'घंटे का हिसाब →';
        } else if (todays.length === 0) {
          summary.textContent = 'खुदाई / ब्रेकर +';
        } else {
          const hours = todays.reduce((n, t) => n + (Number(t.hours) || 0), 0);
          const amt = todays.reduce((n, t) => n + (Number(t.amount) || 0), 0);
          summary.textContent = `आज ${inr(amt)}`;
        }
      }
    }

    // With only one of them on screen it takes the full width rather than
    // leaving a hole in the grid.
    const shown = [trolleyBtn, jcbBtn].filter(b => b && b.style.display !== 'none');
    [trolleyBtn, jcbBtn].forEach(b => b?.classList.toggle('is-solo', shown.length === 1));

    // Diary status
    const isMarked = this.store.isDateMarkedInDiary(today);
    const statDiaryEl = document.getElementById('statTodayDiaryStatus');
    if (statDiaryEl) {
      if (isMarked) {
        statDiaryEl.innerHTML = 'डायरी दर्ज ✓';
        statDiaryEl.style.color = '#10b981';
        statDiaryEl.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        statDiaryEl.style.background = 'rgba(16, 185, 129, 0.15)';
      } else {
        statDiaryEl.innerHTML = 'डायरी बाकी ⏳';
        statDiaryEl.style.color = '#fbbf24';
        statDiaryEl.style.borderColor = 'rgba(245, 158, 11, 0.3)';
        statDiaryEl.style.background = 'rgba(245, 158, 11, 0.15)';
      }
    }
  }

  // --- TAB 1: TIMELINE ---
  renderTimeline() {
    const container = document.getElementById('timelineListContainer');
    if (!container) return;

    let txs = [];
    const today = getTodayString();

    if (this.timelineDateMode === 'today') {
      txs = this.store.getTransactions(today);
    } else if (this.timelineDateMode === 'yesterday') {
      const y = new Date(Date.now() - 86400000);
      const yStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
      txs = this.store.getTransactions(yStr);
    } else if (this.timelineDateMode === 'custom') {
      txs = this.store.getTransactions(this.timelineCustomDate || today);
    } else {
      // 'all'
      txs = this.store.getTransactions(null);
    }

    // Apply search query
    if (this.timelineSearchQuery && this.timelineSearchQuery.trim()) {
      const q = this.timelineSearchQuery.trim().toLowerCase();
      txs = txs.filter(t => {
        const trade = this.store.getTrade(t.tradeId);
        const worker = t.workerId ? this.store.getWorker(t.workerId) : null;
        const matchWorker = worker && worker.name.toLowerCase().includes(q);
        const matchTrade = trade && trade.name.toLowerCase().includes(q);
        const matchNote = t.note && t.note.toLowerCase().includes(q);
        const matchItem = t.rationItem && t.rationItem.toLowerCase().includes(q);
        const matchAmount = String(t.amount || '').includes(q);
        return matchWorker || matchTrade || matchNote || matchItem || matchAmount;
      });
    }

    // Apply type filter
    if (this.activeFilterType !== 'all') {
      txs = txs.filter(t => t.type === this.activeFilterType);
    }
    // Apply trade filter
    if (this.activeFilterTrade) {
      txs = txs.filter(t => t.tradeId === this.activeFilterTrade);
    }

    if (txs.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; background: var(--bg-card); border-radius: var(--radius-md); border: 1px dashed var(--border-card);">
          <div style="font-size: 32px; margin-bottom: 10px;">📝</div>
          <div style="font-weight: 600; color: var(--text-main); margin-bottom: 6px;">कोई लेन-देन नहीं मिला</div>
          <div style="font-size: 0.84rem; color: var(--text-muted);">
            इस फ़िल्टर या तारीख में कोई रिकॉर्ड दर्ज नहीं है। ऊपर "+ नकद / राशन" बटन दबाकर नया लेन-देन जोड़ें।
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = txs.map(tx => {
      const trade = this.store.getTrade(tx.tradeId);
      const isGroup = tx.targetType === 'group';
      const worker = !isGroup ? this.store.getWorker(tx.workerId) : null;

      // Icon and colour come from the shared type registry, so cylinder/diesel/
      // material/custom types no longer all render as a generic cash entry.
      const typeMeta = getTxTypeMeta(tx.type);
      const icon = typeMeta.icon;
      const TYPE_TINTS = {
        cash: ['rgba(16, 185, 129, 0.15)', 'cash'],
        recharge: ['rgba(56, 189, 248, 0.15)', 'recharge'],
        ration: ['rgba(245, 158, 11, 0.15)', 'ration'],
        cylinder: ['rgba(249, 115, 22, 0.15)', 'cylinder'],
        diesel: ['rgba(139, 92, 246, 0.15)', 'diesel'],
        material: ['rgba(100, 116, 139, 0.15)', 'material'],
        other: ['rgba(148, 163, 184, 0.15)', 'other']
      };
      const [iconBg, amountClass] = TYPE_TINTS[tx.type] || ['rgba(148, 163, 184, 0.15)', 'other'];

      const roleBadge = worker
        ? `<span class="tag-badge ${worker.role === 'mistri' ? 'tag-mistri' : 'tag-helper'}">${worker.role === 'mistri' ? 'मिस्त्री' : 'हेल्पर'}</span>`
        : `<span class="tag-badge tag-group">ग्रुप (सांझा)</span>`;

      const targetDisplayName = isGroup
        ? `${trade.name} (सांझा ग्रुप)`
        : (worker ? worker.name : (tx.workerName ? `${tx.workerName} (हटाया गया)` : 'साइट खर्च'));

      return `
        <div class="tx-card" data-tx-id="${tx.id}">
          <div class="tx-left">
            <div class="tx-icon-badge" style="background: ${iconBg};">
              ${icon}
            </div>
            <div class="tx-info">
              <div class="tx-target-row">
                <span class="tx-target-name">${esc(targetDisplayName)}</span>
                ${roleBadge}
                <span style="font-size: 0.76rem; color: var(--text-dim);">${esc(trade.name)}</span>
              </div>
              ${tx.rationItem ? `<div style="font-size: 0.85rem; font-weight: 600; color: var(--amber-light);">${esc(tx.rationItem)} ${tx.quantity ? `(${esc(tx.quantity)})` : ''}</div>` : ''}
              ${tx.note ? `<div class="tx-note">${esc(tx.note)}</div>` : ''}
              <div class="tx-meta">
                <span>📅 ${tx.date}</span>
                <span>🕒 ${tx.time}</span>
                ${tx.audioDataUrl ? `<span>• <button class="btn-audio-play" data-audio="${tx.audioDataUrl}" style="background:none;border:none;color:var(--amber-primary);cursor:pointer;font-size:0.76rem;">▶ आवाज सुनें</button></span>` : ''}
              </div>
            </div>
          </div>
          <div class="tx-right">
            <div class="tx-amount ${amountClass}">₹${(tx.amount || 0).toLocaleString('en-IN')}</div>
            ${tx.quantity && ['ration', 'cylinder'].includes(tx.type) ? `<span class="tx-item-qty">${esc(tx.quantity)}</span>` : ''}
            <div class="tx-actions-row">
              <button class="btn-icon-action btn-edit-tx" data-edit-tx="${tx.id}" title="सुधारें">
                ✏️
              </button>
              <button class="btn-icon-action btn-del-tx" data-delete-tx="${tx.id}" title="हटाएं">
                🗑️
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // --- TAB 2: HAZIRI (ATTENDANCE) ---
  renderHaziri() {
    // First, and outside the roster: a site with no workers yet still has days
    // worth writing about, and the roster's own early return would skip this.
    this.renderHaziriNotes();

    const container = document.getElementById('haziriTradesContainer');
    if (!container) return;

    const date = this.selectedHaziriDate || getTodayString();
    const trades = this.store.getTrades();
    const haziriRecord = this.store.getHaziri(date);
    const allWorkers = this.store.getWorkers();

    // 1. Update Date Display and native input
    const dateDisplay = document.getElementById('haziriDateDisplay');
    if (dateDisplay) {
      dateDisplay.textContent = formatShortDate(date, this.currentLang);
    }
    const datePicker = document.getElementById('haziriDatePicker');
    if (datePicker && datePicker.value !== date) {
      datePicker.value = date;
    }

    // If no workers exist on site
    if (allWorkers.length === 0) {
      const groupTabsEl = document.getElementById('haziriGroupTabs');
      if (groupTabsEl) groupTabsEl.innerHTML = '';
      const countBadge = document.getElementById('haziriActiveGroupCount');
      if (countBadge) countBadge.textContent = '0';

      container.innerHTML = `
        <div style="background: rgba(245, 158, 11, 0.08); border: 2px dashed rgba(245, 158, 11, 0.35); border-radius: 14px; padding: 40px 20px; text-align: center; margin: 20px 0;">
          <div style="font-size: 3rem; margin-bottom: 12px;">👷‍♂️</div>
          <h3 style="font-size: 1.25rem; font-weight: 700; color: var(--text-main); margin-bottom: 8px;">अभी आपकी साइट पर कोई कारीगर नहीं जुड़ा है</h3>
          <p style="font-size: 0.88rem; color: var(--text-muted); max-width: 480px; margin: 0 auto 20px;">
            हाजिरी लगाने के लिए पहले अपने मिस्त्री, हेल्पर या ठेकेदार को जोड़ें।
          </p>
          <button class="btn-primary btn-add-first-worker" style="font-size: 0.95rem; padding: 12px 28px;">
            👷 + पहला कारीगर जोड़ें (Add Worker)
          </button>
        </div>
      `;
      return;
    }

    // Active trade determination
    const tradesWithWorkers = trades.filter(t => this.store.getWorkers(t.id).length > 0);
    if (!this.activeHaziriTradeId || (this.activeHaziriTradeId !== 'all' && !trades.some(t => t.id === this.activeHaziriTradeId))) {
      this.activeHaziriTradeId = tradesWithWorkers.length > 0 ? tradesWithWorkers[0].id : (trades[0]?.id || 'all');
    }

    // 2. Render Horizontal Group / Trade Tabs
    const groupTabsEl = document.getElementById('haziriGroupTabs');
    if (groupTabsEl) {
      let tabsHtml = trades.map(trade => {
        const count = this.store.getWorkers(trade.id).length;
        const isActive = this.activeHaziriTradeId === trade.id;
        const shortName = trade.name.split(' ')[0];
        return `
          <button type="button" class="attendance-trade-tab ${isActive ? 'active' : ''}" data-trade-id="${esc(trade.id)}" title="${esc(trade.name)} (${count} कारीगर)">
            ${isActive ? '<span class="tab-check">✓</span> ' : ''}${getTradeIcon(trade.icon)} ${shortName} <span class="tab-count">(${count})</span>
          </button>
        `;
      }).join('');

      const isAllActive = this.activeHaziriTradeId === 'all';
      tabsHtml += `
        <button type="button" class="attendance-trade-tab ${isAllActive ? 'active' : ''}" data-trade-id="all" title="सभी कारीगर (${allWorkers.length})">
          ${isAllActive ? '<span class="tab-check">✓</span> ' : ''}📂 सभी <span class="tab-count">(${allWorkers.length})</span>
        </button>
      `;
      groupTabsEl.innerHTML = tabsHtml;
    }

    // 3. Workers for Active Group
    let currentWorkers = [];
    let groupTitle = '';
    let groupIcon = '👷';
    let activeTradeObj = null;

    if (this.activeHaziriTradeId === 'all') {
      currentWorkers = allWorkers;
      groupTitle = this.currentLang === 'en' ? 'All Workers' : 'सभी कारीगर';
      groupIcon = '📂';
    } else {
      activeTradeObj = this.store.getTrade(this.activeHaziriTradeId);
      currentWorkers = this.store.getWorkers(this.activeHaziriTradeId);
      groupTitle = activeTradeObj ? activeTradeObj.name : 'कारीगर ग्रुप';
      groupIcon = activeTradeObj ? getTradeIcon(activeTradeObj.icon) : '🔨';
    }

    // Update group count badge
    const countBadge = document.getElementById('haziriActiveGroupCount');
    if (countBadge) {
      countBadge.textContent = currentWorkers.length;
    }

    // Calculate Group Stats
    let presentCount = 0;
    let halfCount = 0;
    let absentCount = 0;
    let otTotalHours = 0;

    currentWorkers.forEach(w => {
      const rec = haziriRecord[w.id];
      if (!rec || !rec.status || rec.status === 0) {
        absentCount++;
      } else if (rec.status === 1.0) {
        presentCount++;
      } else if (rec.status === 0.5) {
        halfCount++;
      }
      if (rec && rec.otHours > 0) {
        otTotalHours += rec.otHours;
      }
    });

    if (currentWorkers.length === 0) {
      container.innerHTML = `
        <div class="attendance-card" style="padding: 24px; text-align: center;">
          <div style="font-size: 2.2rem; margin-bottom: 8px;">🏷️</div>
          <h4 style="color: var(--text-main); margin-bottom: 6px;">इस ट्रेड (${esc(groupTitle)}) में कोई कारीगर नहीं है</h4>
          <p style="color: var(--text-muted); font-size: 0.82rem; margin-bottom: 14px;">
            इस ग्रुप में काम करने वाले मिस्त्री या हेल्पर को जोड़ें:
          </p>
          <button class="btn-primary" id="btnQuickAddWorkerToTrade" data-trade-id="${this.activeHaziriTradeId}" style="font-size: 0.85rem; padding: 8px 18px;">
            + ${esc(groupTitle)} में कारीगर जोड़ें
          </button>
        </div>
      `;
      return;
    }

    // Warn before an edit silently replaces attendance that was already recorded
    // for this date — on a shared site another phone may have marked it.
    const savedAt = this.store.getHaziriSavedAt(date);
    const savedNotice = savedAt
      ? `<div class="attendance-saved-notice">
           <span class="notice-icon">⚠️</span>
           <span>${this.currentLang === 'en'
             ? `Already saved ${esc(savedAt.byLabel)} — editing will overwrite.`
             : `यह हाजिरी पहले ही सेव हो चुकी है ${esc(savedAt.byLabel)} — बदलने पर पुरानी मिट जाएगी।`}</span>
         </div>`
      : '';

    // 4. Render Group Header + Compact Worker Rows + Bottom Summary Dock
    container.innerHTML = `
      ${savedNotice}
      <div class="attendance-card">
        <!-- Group Header Row with '✓ All Present' Button (Exact Reference Screenshot Style) -->
        <div class="attendance-group-header">
          <div class="group-header-info">
            <span class="group-header-name">${groupIcon} ${esc(groupTitle)}</span>
            <span class="group-header-count">· ${currentWorkers.length} ${this.currentLang === 'en' ? 'workers' : 'सदस्य'}</span>
          </div>
          <button type="button" class="btn-all-present" id="btnMarkAllPresent" title="इस ग्रुप के सभी कारीगरों को उपस्थित करें">
            <span class="btn-check-icon">✓</span>
            <span>${this.currentLang === 'en' ? 'All Present' : 'सब उपस्थित'}</span>
          </button>
        </div>

        <!-- Ultra-Compact Worker List: Entire group fits on 1 mobile screen without scrolling -->
        <div class="attendance-list-rows">
          ${currentWorkers.map((worker, idx) => {
            const rec = haziriRecord[worker.id] || { status: 0, otHours: 0 };
            const isPresent = rec.status > 0;
            const isFull = rec.status === 1.0;
            const isHalf = rec.status === 0.5;
            const numStr = String(idx + 1).padStart(2, '0');

            const statusText = isFull
              ? (this.currentLang === 'en' ? 'Present' : 'उपस्थित')
              : (isHalf
                  ? (this.currentLang === 'en' ? 'Half Day' : '½ हाफ डे')
                  : (this.currentLang === 'en' ? 'Absent' : 'अनुपस्थित'));

            const statusClass = isFull ? 'st-full' : (isHalf ? 'st-half' : 'st-absent');
            const otText = rec.otHours > 0 ? ` • +${rec.otHours}h OT` : '';

            /* Only a worker somebody actually marked absent is asked why. One
               nobody has touched yet reads as absent too, and a reason box on
               every untouched row would bury the screen on a fresh morning. */
            const isMarkedAbsent = !!haziriRecord[worker.id] && rec.status === 0;
            const reasonText = isMarkedAbsent && rec.reason
              ? ` • ${esc(absenceReasonLabel(rec.reason, this.currentLang))}`
              : '';

            return `
              <div class="attendance-row ${isPresent ? 'is-present' : 'is-absent'}${isHalf ? ' is-half' : ''}" data-worker-id="${esc(worker.id)}">
                <!-- Number circle badge (01, 02, 03... Vibrant Green when present) -->
                <div class="attendance-num-badge ${isPresent ? 'badge-green' : 'badge-gray'}">
                  ${numStr}
                </div>

                <!-- Worker Name & Status Details -->
                <div class="attendance-info-col">
                  <div class="attendance-worker-title">
                    <!-- The name is what the contractor reads down the column, so it
                         gets the whole line. Role and contract used to sit here as
                         badges and squeezed the name to nothing; they live in the
                         worker's own screen now, one tap away. -->
                    <button type="button" class="attendance-worker-name" data-open-statement="${esc(worker.id)}"
                            title="${this.currentLang === 'en' ? 'Tap for full details' : 'पूरा विवरण देखने के लिए दबाएँ'}">
                      ${esc(worker.name)}
                      ${worker.isThekedar ? '<span class="thekedar-dot" title="Thekedar">📜</span>' : ''}
                    </button>
                  </div>

                  <div class="attendance-status-line">
                    <span class="attendance-status-text ${statusClass}">${statusText}${otText}${reasonText}</span>
                    
                    <!-- Micro-actions for rare Half-day / OT / Quick Edit without consuming vertical height -->
                    <div class="attendance-micro-actions">
                      <button type="button" class="btn-micro-pill ${isHalf ? 'active' : ''}" data-hz-half="${worker.id}" title="आधा दिन दर्ज करें">
                        ½
                      </button>
                      <button type="button" class="btn-micro-pill ${rec.otHours > 0 ? 'active' : ''}" data-hz-ot="${worker.id}" title="ओवरटाइम दर्ज करें">
                        ${rec.otHours > 0 ? `+${rec.otHours}h` : '+OT'}
                      </button>
                      <button type="button" class="btn-micro-pill" data-open-edit-worker="${worker.id}" title="कारीगर सुधारें">
                        ✏️
                      </button>
                    </div>
                  </div>

                  ${isMarkedAbsent ? this.renderAbsenceReasonPicker(worker, rec) : ''}
                </div>

                <!-- Sleek iOS Toggle Switch (Reference Screenshot Style) -->
                <div class="attendance-toggle-wrap">
                  <label class="ios-toggle-switch">
                    <input type="checkbox" class="attendance-toggle-input" data-worker-id="${worker.id}" ${isPresent ? 'checked' : ''} />
                    <span class="ios-toggle-slider"></span>
                  </label>
                </div>
              </div>
            `;
          }).join('')}

          <button type="button" class="attendance-add-row" id="btnAddWorkerFromHaziri">
            <span class="add-row-plus">+</span>
            <span>${this.currentLang === 'en'
              ? `Add a worker to ${esc(groupTitle)}`
              : `${esc(groupTitle)} में कारीगर जोड़ें`}</span>
          </button>
        </div>

        <!-- Bottom Summary & Update Dock (Reference Screenshot Style: P 6, A 0, Update Button) -->
        <div class="attendance-bottom-bar">
          <div class="attendance-stat-badges">
            <span class="stat-badge-pill stat-p" title="उपस्थित कारीगर">P ${presentCount}</span>
            <span class="stat-badge-pill stat-a" title="अनुपस्थित">A ${absentCount}</span>
            ${halfCount > 0 ? `<span class="stat-badge-pill stat-half" title="हाफ डे">½ ${halfCount}</span>` : ''}
            ${otTotalHours > 0 ? `<span class="stat-badge-pill stat-ot" title="कुल ओवरटाइम">OT ${otTotalHours}h</span>` : ''}
          </div>

          <button type="button" class="btn-attendance-update${savedAt ? ' is-saved' : ''}" id="btnHaziriSaveUpdate" title="हाजिरी अपने आप सुरक्षित हो जाती है">
            <span class="save-icon">💾</span>
            <span>${this.currentLang === 'en' ? 'Update' : 'अपडेट'}</span>
          </button>
        </div>
      </div>
    `;
  }

  /* Why a worker is away, asked for in one tap on the row that is already
     marked absent. It is skippable on purpose: most absences on a site never
     get an explanation, and a register that insists on one gets a shrug and a
     wrong answer instead of a blank. */
  renderAbsenceReasonPicker(worker, rec) {
    const en = this.currentLang === 'en';
    const current = rec.reason || '';
    const isKnown = ABSENCE_REASONS.some(r => r.id === current);
    const options = ABSENCE_REASONS.map(r =>
      `<option value="${r.id}"${current === r.id ? ' selected' : ''}>${esc(en ? r.en : r.hi)}</option>`
    ).join('');
    // A reason typed by hand keeps its own place in the list, so opening the
    // picker again does not quietly throw it away.
    const typedOption = (current && !isKnown)
      ? `<option value="__typed__" selected>${esc(current)}</option>`
      : '';

    return `
      <div class="attendance-reason-row">
        <select class="attendance-reason-select${current ? ' has-reason' : ''}"
                data-hz-reason="${esc(worker.id)}"
                title="${en ? 'Reason for absence (optional)' : 'गैरहाजिरी का कारण (वैकल्पिक)'}">
          <option value="">${en ? 'Reason? (optional)' : 'कारण? (वैकल्पिक)'}</option>
          ${options}
          ${typedOption}
          <option value="__other__">${en ? 'Other (type reason)' : 'अन्य (खुद लिखें)'}</option>
        </select>
      </div>
    `;
  }

  // --- MONTHLY MUSTER ROLL REGISTER ---
  renderMonthlyHaziri() {
    const container = document.getElementById('monthlyMusterRollContainer');
    if (!container) return;

    const data = this.store.getMonthlyHaziri(this.monthlyYear, this.monthlyMonth);
    const hindiMonths = [
      'जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून',
      'जुलाई', 'अगस्त', 'सितम्बर', 'अक्टूबर', 'नवंबर', 'दिसंबर'
    ];
    const monthTitleEl = document.getElementById('monthlyMonthTitle');
    if (monthTitleEl) {
      monthTitleEl.textContent = `${hindiMonths[this.monthlyMonth - 1]} ${this.monthlyYear}`;
    }

    const picker = document.getElementById('monthlyPicker');
    if (picker) {
      picker.value = `${this.monthlyYear}-${String(this.monthlyMonth).padStart(2, '0')}`;
    }

    if (data.rows.length === 0) {
      container.innerHTML = `
        <div style="background: rgba(245, 158, 11, 0.08); border: 2px dashed rgba(245, 158, 11, 0.35); border-radius: 14px; padding: 40px 20px; text-align: center; margin: 20px 0;">
          <div style="font-size: 3rem; margin-bottom: 12px;">📊</div>
          <h3 style="font-size: 1.25rem; font-weight: 700; color: var(--text-main); margin-bottom: 8px;">मस्टर रोल अभी खाली है</h3>
          <p style="font-size: 0.88rem; color: var(--text-muted); max-width: 480px; margin: 0 auto 20px;">
            महीने की 1 से 30 तारीख की हाजिरी रजिस्टर देखने के लिए पहले अपनी साइट का कारीगर जोड़ें।
          </p>
          <button class="btn-primary btn-add-first-worker" style="font-size: 0.95rem; padding: 12px 28px;">
            👷 + नया कारीगर जोड़ें (Add Worker)
          </button>
        </div>
      `;
      return;
    }

    const daysHeaderHtml = data.days.map(d => {
      const cls = d.isSunday ? 'th-sunday' : '';
      return `<th class="${cls}" title="${d.dateStr} (${d.dayOfWeek})">${d.day}<br><span style="font-size:0.65rem;font-weight:400;">${d.dayOfWeek}</span></th>`;
    }).join('');

    const rowsHtml = data.rows.map(row => {
      const w = row.worker;
      const initials = w.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
      const avatarThumb = w.photoUrl
        ? `<div class="worker-avatar" style="width: 26px; height: 26px; border-radius: 6px;"><img src="${esc(w.photoUrl)}" alt="${esc(w.name)}" /></div>`
        : `<div class="worker-avatar" style="width: 26px; height: 26px; border-radius: 6px; font-size: 0.7rem;">${initials}</div>`;

      const contractBadge = row.isTheka
        ? `<span class="tag-badge tag-theka" style="font-size:0.65rem;padding:1px 5px;">📜 ठेका</span>`
        : `<span class="tag-badge tag-dihadi" style="font-size:0.65rem;padding:1px 5px;">👷 दिहाड़ी</span>`;

      const daysCellsHtml = data.days.map(d => {
        const record = row.dailyStatuses[d.dateStr];
        let cellContent = '·';
        let cellClass = 'cell-hz-empty';
        let reasonNote = '';

        if (record) {
          if (record.status === 1.0) {
            cellContent = record.otHours > 0 ? `1+${record.otHours}h` : '1.0';
            cellClass = 'cell-hz-full';
          } else if (record.status === 0.5) {
            cellContent = '0.5';
            cellClass = 'cell-hz-half';
          } else if (record.status === 0) {
            cellContent = 'A';
            cellClass = 'cell-hz-absent';
            /* A register column is one character wide, so the reason rides in
               the tooltip, with a dot on the cell to say there is one to read. */
            if (record.reason) {
              cellClass += ' has-reason';
              reasonNote = ` — ${absenceReasonLabel(record.reason, this.currentLang)}`;
            }
          }
        }

        const tdClass = d.isSunday ? 'td-sunday' : '';
        return `
          <td class="${tdClass}">
            <span class="muster-cell ${cellClass}" data-matrix-worker="${w.id}" data-matrix-date="${d.dateStr}" title="${esc(w.name)} (${d.dateStr})${esc(reasonNote)}: क्लिक करके हाजिरी बदलें">
              ${cellContent}
            </span>
          </td>
        `;
      }).join('');

      return `
        <tr>
          <td class="col-sticky-worker">
            <div style="display: flex; align-items: center; gap: 8px;">
              ${avatarThumb}
              <div>
                <div style="font-weight: 700; color: var(--text-main); font-size: 0.82rem; white-space: nowrap; display: flex; align-items: center; gap: 4px;">
                  <span>${esc(w.name)}</span>
                  ${contractBadge}
                  <button type="button" data-open-edit-worker="${w.id}" title="कारीगर में सुधार करें (ट्रेड, नाम बदलें)" style="background: none; border: 1px solid rgba(15, 23, 42, 0.14); border-radius: 4px; color: var(--amber-light); cursor: pointer; font-size: 0.72rem; padding: 1px 4px;">✏️</button>
                </div>
                <div style="font-size: 0.72rem; color: var(--text-dim);">
                  ${getTradeIcon(row.trade.icon)} ${row.trade.name} (${w.role === 'mistri' ? 'मिस्त्री' : 'हेल्पर'})
                </div>
              </div>
            </div>
          </td>
          ${daysCellsHtml}
          <td class="col-summary-cell" style="color: #34d399; font-weight: 700;">${row.totalPresent} दिन</td>
          <td class="col-summary-cell" style="color: ${row.totalAbsent > 0 ? '#f87171' : '#94a3b8'}; font-weight: 700;">${row.totalAbsent} दिन</td>
          <td class="col-summary-cell" style="color: #c084fc;">${row.totalOtHours > 0 ? `${row.totalOtHours}h` : '-'}</td>
          <td class="col-summary-cell" style="color: #fbbf24;">₹${row.totalEarnedMonth.toLocaleString('en-IN')}</td>
          <td class="col-summary-cell" style="color: #38bdf8;">₹${row.totalPaidMonth.toLocaleString('en-IN')}</td>
          <td class="col-summary-cell" style="color: #34d399; font-weight: 800;">₹${row.netBalance.toLocaleString('en-IN')}</td>
        </tr>
      `;
    }).join('');

    // 1. Calculate Monthly Grand Totals across all workers
    const grandTotalPresent = data.rows.reduce((sum, r) => sum + r.totalPresent, 0);
    const grandTotalAbsent = data.rows.reduce((sum, r) => sum + r.totalAbsent, 0);
    const grandTotalOt = data.rows.reduce((sum, r) => sum + r.totalOtHours, 0);
    const grandTotalEarned = data.rows.reduce((sum, r) => sum + r.totalEarnedMonth, 0);
    const grandTotalPaid = data.rows.reduce((sum, r) => sum + r.totalPaidMonth, 0);
    const grandTotalDue = data.rows.reduce((sum, r) => sum + r.netBalance, 0);

    // 2. Update KPI Card Elements
    const kpiPresent = document.getElementById('monthlyKpiTotalPresent');
    if (kpiPresent) kpiPresent.textContent = `${grandTotalPresent} दिन`;

    const kpiAbsent = document.getElementById('monthlyKpiTotalAbsent');
    if (kpiAbsent) kpiAbsent.textContent = `${grandTotalAbsent} दिन`;

    const kpiOt = document.getElementById('monthlyKpiTotalOt');
    if (kpiOt) kpiOt.textContent = `${grandTotalOt} घंटे`;

    const kpiEarned = document.getElementById('monthlyKpiTotalEarned');
    if (kpiEarned) kpiEarned.textContent = `₹${grandTotalEarned.toLocaleString('en-IN')}`;

    const kpiDue = document.getElementById('monthlyKpiTotalDue');
    if (kpiDue) kpiDue.textContent = `₹${grandTotalDue.toLocaleString('en-IN')}`;

    // 3. Daily attendance totals for each day column (1 to 30/31)
    const dayTotalsCellsHtml = data.days.map(d => {
      let dayPresentSum = 0;
      data.rows.forEach(r => {
        const rec = r.dailyStatuses[d.dateStr];
        if (rec && rec.status > 0) {
          dayPresentSum += rec.status;
        }
      });
      const tdClass = d.isSunday ? 'td-sunday' : '';
      const displayVal = dayPresentSum > 0 ? (Number.isInteger(dayPresentSum) ? dayPresentSum : dayPresentSum.toFixed(1)) : '0';
      return `
        <th class="${tdClass}" style="font-size: 0.76rem; font-weight: 700; color: ${dayPresentSum > 0 ? '#34d399' : '#94a3b8'};">
          ${displayVal}
        </th>
      `;
    }).join('');

    container.innerHTML = `
      <table class="muster-table">
        <thead>
          <tr>
            <th class="col-sticky-worker">कारीगर / पद</th>
            ${daysHeaderHtml}
            <th class="col-summary-header">उपस्थिति (P)</th>
            <th class="col-summary-header">गैरहाजिर (A)</th>
            <th class="col-summary-header">OT</th>
            <th class="col-summary-header">कुल देय (Earned)</th>
            <th class="col-summary-header">दिया गया (Paid)</th>
            <th class="col-summary-header">शुद्ध बाकी (Due)</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
        <tfoot>
          <tr class="muster-tfoot-row">
            <th class="col-sticky-worker" style="font-weight: 800; font-size: 0.82rem;">
              🏆 कुल योग (Grand Total)
            </th>
            ${dayTotalsCellsHtml}
            <th class="col-summary-cell" style="color: #34d399; font-size: 0.85rem; font-weight: 800;">${grandTotalPresent} दिन</th>
            <th class="col-summary-cell" style="color: #f87171; font-size: 0.85rem; font-weight: 800;">${grandTotalAbsent} दिन</th>
            <th class="col-summary-cell" style="color: #c084fc; font-size: 0.85rem; font-weight: 800;">${grandTotalOt > 0 ? `${grandTotalOt}h` : '-'}</th>
            <th class="col-summary-cell" style="color: #fbbf24; font-size: 0.85rem; font-weight: 800;">₹${grandTotalEarned.toLocaleString('en-IN')}</th>
            <th class="col-summary-cell" style="color: #38bdf8; font-size: 0.85rem; font-weight: 800;">₹${grandTotalPaid.toLocaleString('en-IN')}</th>
            <th class="col-summary-cell" style="color: #34d399; font-size: 0.88rem; font-weight: 900;">₹${grandTotalDue.toLocaleString('en-IN')}</th>
          </tr>
        </tfoot>
      </table>
    `;
  }
  renderGroupsLedger() {
    const container = document.getElementById('groupsLedgerContainer');
    if (!container) return;

    const trades = this.store.getTrades();

    container.innerHTML = trades.map(trade => {
      const groupData = this.store.getGroupLedger(trade.id);
      const workers = groupData.workers;

      const rationPills = Object.values(groupData.rationItemsBreakdown).map(item => {
        return `<span class="ration-pill">${item.name}: ${item.count} बार (₹${item.totalAmount})</span>`;
      }).join('');

      const workersHtml = workers.map(w => {
        const ledger = this.store.getWorkerLedger(w.id);
        const initials = w.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        const avatarThumb = w.photoUrl
          ? `<div class="worker-avatar" style="width: 32px; height: 32px; border-radius: 8px;"><img src="${esc(w.photoUrl)}" alt="${esc(w.name)}" /></div>`
          : `<div class="worker-avatar" style="width: 32px; height: 32px; border-radius: 8px; font-size: 0.8rem;">${initials}</div>`;

        const contactPills = w.phone
          ? `<a href="${getPhoneDialerHref(w.phone)}" style="text-decoration:none; margin-left: 4px;" title="कॉल करें">📞</a> <a href="${getWhatsAppUrl(w.phone)}" target="_blank" style="text-decoration:none; margin-left: 2px;" title="व्हाट्सएप">💬</a>`
          : '';

        const contractBadge = ledger.isTheka
          ? `<span class="tag-badge tag-theka">📜 ठेका</span>`
          : `<span class="tag-badge tag-dihadi">👷 दिहाड़ी</span>`;

        let middleStatsHtml = '';
        let balanceHtml = '';

        if (ledger.isTheka) {
          middleStatsHtml = `
            <div style="font-size: 0.76rem; color: #d8b4fe;">
              कुल ठेका: <strong>₹${ledger.thekaAmount.toLocaleString('en-IN')}</strong> ${ledger.thekaDescription ? `• ${ledger.thekaDescription}` : ''}
            </div>
            <div style="font-size: 0.76rem; color: var(--text-dim); margin-top: 2px;">
              साइट पर उपस्थिति: <strong>${ledger.totalHaziriDays} दिन</strong> | गैरहाजिरी: <strong>${ledger.totalAbsentDays} दिन</strong>
            </div>
            ${ledger.totalAbsentDays > 0 ? `
              <div class="theka-proof-box">
                <span style="color:#f87171; font-weight:700;">⚠️ ${ledger.totalAbsentDays} दिन गैरहाजिर / काम बंद रहा:</span> 
                <span>ठेकेदार के 'काम में घाटा लगा' या देरी की दलील का पक्का सबूत!</span>
              </div>
            ` : ''}
          `;
          balanceHtml = `
            <div>पेशगी/दिया: ₹${ledger.totalIndividualGiven.toLocaleString('en-IN')}</div>
            <div class="balance-due" style="color: #a855f7;">बाकी ठेका: ₹${ledger.balanceDue.toLocaleString('en-IN')}</div>
          `;
        } else {
          middleStatsHtml = `
            <div style="font-size: 0.76rem; color: var(--text-dim);">
              हाजिरी: ${ledger.totalHaziriDays} दिन | दर: ₹${w.dailyRate}/दिन
            </div>
          `;
          balanceHtml = `
            <div>नकद/रिचार्ज: ₹${ledger.totalIndividualGiven.toLocaleString('en-IN')}</div>
            <div class="balance-due">बाकी: ₹${ledger.balanceDue.toLocaleString('en-IN')}</div>
          `;
        }

        return `
          <div class="worker-ledger-item" style="flex-direction: column; align-items: stretch; gap: 8px;" data-worker-card-id="${w.id}">
            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 10px; cursor: pointer;" data-open-statement="${w.id}">
                ${avatarThumb}
                <div>
                  <div class="worker-name-line">
                    <strong style="color: var(--text-main); text-decoration: underline dotted var(--amber-primary);">${esc(w.name)}</strong>
                    <span class="tag-badge ${w.role === 'mistri' ? 'tag-mistri' : 'tag-helper'}">
                      ${w.role === 'mistri' ? 'मिस्त्री' : 'हेल्पर'}
                    </span>
                    ${contractBadge}
                    ${contactPills}
                  </div>
                </div>
              </div>
              <div class="worker-ledger-stats">
                ${balanceHtml}
              </div>
            </div>
            <div style="padding-left: 42px;">
              ${middleStatsHtml}
            </div>
            <div class="worker-card-actions">
              <button type="button" class="btn-worker-mini btn-worker-statement" data-open-statement="${w.id}" title="खाता व पासबुक खोलें">
                📖 खाता पासबुक (Passbook)
              </button>
              <button type="button" class="btn-worker-mini btn-worker-wa" data-worker-wa-share="${w.id}" title="व्हाट्सएप पर हिसाब भेजें">
                💬 WhatsApp हिसाब
              </button>
              <button type="button" class="btn-worker-mini btn-worker-edit" data-open-edit-worker="${w.id}" title="कारीगर की जानकारी बदलें">
                ✏️ सुधारें
              </button>
              <button type="button" class="btn-worker-mini btn-worker-delete" data-delete-worker-id="${w.id}" title="कारीगर हटाएं">
                🗑️
              </button>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="group-card">
          <div class="group-card-header">
            <div class="group-card-title">
              <span>${getTradeIcon(trade.icon)}</span>
              <span>${esc(trade.name)}</span>
            </div>
            <span style="font-size: 0.8rem; color: var(--text-muted);">
              ${workers.length} कारीगर
            </span>
          </div>

          <!-- Group Ration Box -->
          <div class="group-ration-summary">
            <div class="group-ration-title">
              <span>🍚 ग्रुप राशन व सामान खर्च:</span>
              <strong style="color: var(--text-main); margin-left: auto;">₹${groupData.totalGroupRationCost.toLocaleString('en-IN')}</strong>
            </div>
            <div class="ration-items-pills">
              ${rationPills.length > 0 ? rationPills : '<span style="font-size: 0.75rem; color: var(--text-dim);">अभी कोई सांझा राशन नहीं जुड़ा</span>'}
            </div>
          </div>

          <!-- Individual Workers List -->
          <div>
            <div style="font-size: 0.82rem; font-weight: 600; color: var(--text-muted); margin-bottom: 8px;">
              व्यक्तिगत खाते (Individual Ledgers):
            </div>
            ${workersHtml.length > 0 ? workersHtml : '<div style="font-size: 0.8rem; color: var(--text-dim); text-align: center; padding: 12px;">कोई कारीगर नहीं है</div>'}
          </div>

          <div style="margin-top: auto; padding-top: 8px;">
            <button class="btn-secondary btn-add-worker-to-trade" data-trade-id="${trade.id}" style="width: 100%; font-size: 0.82rem;">
              + इस ट्रेड में कारीगर जोड़ें
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // --- TAB 4: AUTHENTIC EVENING DIARY SHEET ---
  renderDiarySheet() {
    const today = getTodayString();
    const txs = this.store.getTransactions(today);
    const haziri = this.store.getHaziri(today);
    const trades = this.store.getTrades();
    const isMarked = this.store.isDateMarkedInDiary(today);

    // 1. Header Date
    const now = new Date();
    const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    const dateStr = now.toLocaleDateString('hi-IN', options);
    const dateEl = document.getElementById('diaryPaperDate');
    if (dateEl) dateEl.textContent = dateStr;

    // 2. Haziri Grid
    const haziriGrid = document.getElementById('diaryHaziriGrid');
    if (haziriGrid) {
      haziriGrid.innerHTML = trades.map(trade => {
        const workers = this.store.getWorkers(trade.id);
        if (workers.length === 0) return '';

        let dihadiMistri = 0;
        let dihadiHelper = 0;
        let thekaPresent = 0;

        workers.forEach(w => {
          const rec = haziri[w.id];
          if (rec && rec.status > 0) {
            if (w.contractType === 'theka') {
              thekaPresent += 1;
            } else {
              if (w.role === 'mistri') dihadiMistri += rec.status;
              else dihadiHelper += rec.status;
            }
          }
        });

        let attendanceStr = `${dihadiMistri} दिहाड़ी मिस्त्री, ${dihadiHelper} दिहाड़ी हेल्पर`;
        if (thekaPresent > 0) {
          attendanceStr += ` • [📜 ${thekaPresent} ठेका कारीगर उपस्थित]`;
        }

        return `
          <div class="diary-haziri-item">
            <span><strong>${esc(trade.name)}:</strong></span>
            <span>${attendanceStr}</span>
          </div>
        `;
      }).join('');
    }

    // 3. Worker payments table — anything booked against a named worker, not just
    // cash and recharge, so a material advance shows up on the day's slip too.
    const cashTxs = txs.filter(t => t.targetType !== 'group' && t.workerId);
    const cashBody = document.getElementById('diaryCashTableBody');
    if (cashBody) {
      if (cashTxs.length === 0) {
        cashBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #94a3b8; font-style: italic;">आज कोई व्यक्तिगत नकद या रिचार्ज नहीं दिया गया</td></tr>`;
      } else {
        cashBody.innerHTML = cashTxs.map(t => {
          const worker = this.store.getWorker(t.workerId);
          const trade = this.store.getTrade(t.tradeId);
          const roleText = worker ? (worker.role === 'mistri' ? 'मिस्त्री' : 'हेल्पर') : 'कारीगर';
          const contractText = worker && worker.contractType === 'theka' ? ' [ठेका पेशगी]' : '';
          const typeName = getTxTypeLabel(t.type, 'hi');
          const noteText = t.note ? ` - ${t.note}` : '';
          const displayName = worker ? worker.name : (t.workerName ? `${t.workerName} (हटाया गया)` : 'कारीगर');

          return `
            <tr>
              <td><strong>${esc(displayName)}</strong></td>
              <td>${esc(trade.name)} (${roleText})${contractText}</td>
              <td>${esc(typeName)}${esc(noteText)}</td>
              <td style="text-align: right; font-weight: 700; color: #047857;">${inr(t.amount)}</td>
            </tr>
          `;
        }).join('');
      }
    }

    // 4. Shared site costs — ration plus cylinder, diesel, material and any custom
    // type booked to a group. Filtering on 'ration' alone hid the rest.
    const rationTxs = txs.filter(t => t.targetType === 'group' || !t.workerId);
    const rationBody = document.getElementById('diaryRationTableBody');
    if (rationBody) {
      if (rationTxs.length === 0) {
        rationBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #94a3b8; font-style: italic;">आज कोई सांझा राशन नहीं मंगाया गया</td></tr>`;
      } else {
        rationBody.innerHTML = rationTxs.map(t => {
          const trade = this.store.getTrade(t.tradeId);
          const meta = getTxTypeMeta(t.type);
          const itemLabel = t.rationItem || meta.hi;
          return `
            <tr>
              <td><strong>${esc(trade.name)} ग्रुप</strong></td>
              <td>${meta.icon} ${esc(itemLabel)} ${t.quantity ? `(${esc(t.quantity)})` : ''}</td>
              <td>${esc(t.note || '-')}</td>
              <td style="text-align: right; font-weight: 700; color: #b45309;">${inr(t.amount)}</td>
            </tr>
          `;
        }).join('');
      }
    }

    // 5. Site notes — what happened that was neither a mark nor an amount.
    this.renderNotesInto('diaryNotesList', today);

    // 6. Grand Total
    const grandTotal = txs.reduce((sum, t) => sum + (t.amount || 0), 0);
    const grandTotalEl = document.getElementById('diaryGrandTotalVal');
    if (grandTotalEl) {
      grandTotalEl.textContent = `₹${grandTotal.toLocaleString('en-IN')}`;
    }

    // 7. Marked button status
    const btnMark = document.getElementById('btnMarkInDiary');
    const markedDesc = document.getElementById('markedStatusDesc');
    if (btnMark) {
      if (isMarked) {
        btnMark.classList.add('is-marked');
        btnMark.innerHTML = '<span>✓</span> डायरी में लिख लिया गया है';
        if (markedDesc) markedDesc.textContent = 'बधाई! आज का हिसाब आपकी डायरी में सुरक्षित हो चुका है।';
      } else {
        btnMark.classList.remove('is-marked');
        btnMark.innerHTML = '<span>✓</span> डायरी में लिख लिया!';
        if (markedDesc) markedDesc.textContent = 'डायरी में नोट करने के बाद नीचे बटन दबाएं ताकि शाम का रिमाइंडर शांत हो जाए।';
      }
    }
  }

  /* One list of notes, drawn the same way wherever it is asked for: on the
     attendance screen where the day is worked, and on the diary slip where the
     day is copied into the paper register. */
  renderNotesInto(elementId, date) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const notes = this.store.getSiteNotes(date);
    if (notes.length === 0) {
      el.innerHTML = `<div class="diary-notes-empty">${this.currentLang === 'en'
        ? 'No note for this day — write one below'
        : 'इस दिन का कोई नोट नहीं — नीचे लिखकर जोड़ें'}</div>`;
      return;
    }

    el.innerHTML = notes.map(n => {
      // A note written on a worker's row says whose day it was about; one about
      // the site at large falls back to the trade, if it named one.
      const worker = n.workerId ? this.store.getWorker(n.workerId) : null;
      const trade = !worker && n.tradeId ? this.store.getTrade(n.tradeId) : null;
      return `
        <div class="diary-note-row">
          <span class="diary-note-time">${esc(n.time || '')}</span>
          <span class="diary-note-text">${esc(n.text)}</span>
          ${worker ? `<span class="diary-note-trade">${esc(worker.name)}</span>` : ''}
          ${trade ? `<span class="diary-note-trade">${esc(trade.name)}</span>` : ''}
          <button type="button" class="diary-note-delete" data-delete-note="${esc(n.id)}" aria-label="नोट हटाएँ">✕</button>
        </div>
      `;
    }).join('');
  }

  /** The attendance screen's notes follow the date chip, not today. */
  renderHaziriNotes() {
    const date = this.selectedHaziriDate || getTodayString();
    this.renderNotesInto('haziriNotesList', date);

    const dateEl = document.getElementById('haziriNotesDate');
    if (dateEl) {
      dateEl.textContent = date === getTodayString()
        ? (this.currentLang === 'en' ? 'today' : 'आज')
        : new Date(`${date}T12:00:00`).toLocaleDateString(
            this.currentLang === 'en' ? 'en-IN' : 'hi-IN', { day: 'numeric', month: 'short' });
    }
  }

  /**
   * Saves what is typed in a note box against one date, and clears it.
   * Shared by both boxes so neither can drift from the other.
   */
  addNoteFrom(inputId, date) {
    const input = document.getElementById(inputId);
    const text = (input?.value || '').trim();
    if (!text) {
      this.showToast(this.currentLang === 'en' ? 'Type the note first.' : 'पहले नोट लिखें');
      input?.focus();
      return;
    }
    this.store.addSiteNote({ date, text });
    input.value = '';
    this.commit('site-note');
    this.showToast(this.currentLang === 'en' ? 'Note added' : 'नोट जुड़ गया');
  }

  // --- FORM HELPERS & POPULATION ---
  populateSelects() {
    const trades = this.store.getTrades();
    const tradeSelect = document.getElementById('txTradeSelect');
    const workerTradeSelect = document.getElementById('workerTradeSelect');
    const editWorkerTrade = document.getElementById('editWorkerTrade');
    const editTxTradeSelect = document.getElementById('editTxTradeSelect');

    const optionsHtml = trades.map(t => `<option value="${esc(t.id)}">${getTradeIcon(t.icon)} ${esc(t.name)}</option>`).join('');

    if (tradeSelect) tradeSelect.innerHTML = optionsHtml;
    if (workerTradeSelect) workerTradeSelect.innerHTML = optionsHtml;
    if (editWorkerTrade) editWorkerTrade.innerHTML = optionsHtml;
    if (editTxTradeSelect) editTxTradeSelect.innerHTML = optionsHtml;

    this.updateWorkerSelect();
  }

  updateWorkerSelect() {
    const tradeSelect = document.getElementById('txTradeSelect');
    const workerSelect = document.getElementById('txWorkerSelect');
    if (!tradeSelect || !workerSelect) return;

    const tradeId = tradeSelect.value;
    const workers = this.store.getWorkers(tradeId);

    if (workers.length === 0) {
      workerSelect.innerHTML = `<option value="">(इस ट्रेड में कोई कारीगर नहीं है)</option>`;
      return;
    }

    workerSelect.innerHTML = workers.map(w => {
      const roleText = w.role === 'mistri' ? 'मिस्त्री' : 'हेल्पर';
      return `<option value="${esc(w.id)}">${esc(w.name)} (${roleText}) - दर: ₹${w.dailyRate}</option>`;
    }).join('');
  }

  updateCylinderFields(edit = false) {
    const isCylinder = (edit ? this.editTxType : this.modalTxType) === 'cylinder';
    document.getElementById(edit ? 'editCylinderFields' : 'cylinderFields').style.display = isCylinder ? 'block' : 'none';
    const input = document.getElementById(edit ? 'editTxCylinderCount' : 'txCylinderCount');
    input.disabled = !isCylinder;
    // Older entries may not have a count; editing them must not invent one.
    input.required = isCylinder && !edit;
  }

  openAddTransactionModal(preset = {}) {
    const modal = document.getElementById('modalAddTransaction');
    if (!modal) return;

    // Reset or preset
    this.modalTxType = preset.type || 'cash';
    this.modalTargetType = preset.targetType || (['ration', 'cylinder'].includes(preset.type) ? 'group' : 'individual');
    this.updateCylinderFields();
    document.getElementById('txCylinderCount').value = parseInt(preset.quantity, 10) || '';

    // Update switcher UI
    document.querySelectorAll('#txTypeSwitcher .segment-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-type') === this.modalTxType);
    });
    document.querySelectorAll('#txTargetTypeSwitcher .segment-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-target') === this.modalTargetType);
    });

    // Toggle fields based on type
    const rationFields = document.getElementById('rationFields');
    const targetTypeGroup = document.getElementById('targetTypeGroup');
    const workerSelectGroup = document.getElementById('workerSelectGroup');

    if (rationFields) rationFields.style.display = this.modalTxType === 'ration' ? 'block' : 'none';
    if (workerSelectGroup) workerSelectGroup.style.display = this.modalTargetType === 'individual' ? 'block' : 'none';

    // Trade preset
    const tradeSelect = document.getElementById('txTradeSelect');
    if (tradeSelect && preset.tradeId) {
      tradeSelect.value = preset.tradeId;
    }
    this.updateWorkerSelect();

    // Worker preset
    const workerSelect = document.getElementById('txWorkerSelect');
    if (workerSelect && preset.workerId) {
      workerSelect.value = preset.workerId;
    }

    // Amount & Note preset
    const amtInput = document.getElementById('txAmount');
    if (amtInput) amtInput.value = preset.amount || '';

    const noteInput = document.getElementById('txNote');
    if (noteInput) noteInput.value = preset.note || '';

    const qtyInput = document.getElementById('txQuantity');
    if (qtyInput) qtyInput.value = preset.quantity || '';

    const rationPreset = document.getElementById('txRationItemPreset');
    if (rationPreset && preset.rationItem) {
      rationPreset.value = preset.rationItem;
    }

    modal.classList.add('open');
  }

  closeModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
  }

  openAddTradeModal(returnToModal = null) {
    this.tradeReturnModal = returnToModal;
    const modal = document.getElementById('modalAddTrade');
    if (!modal) return;

    // Reset form
    const form = document.getElementById('formAddTrade');
    if (form) form.reset();

    // Reset chips
    document.querySelectorAll('#quickTradeSuggestionChips .trade-suggestion-chip').forEach(c => c.classList.remove('active'));

    // Reset icon picker to default 🔨
    const hiddenIcon = document.getElementById('selectedTradeIcon');
    if (hiddenIcon) hiddenIcon.value = '🔨';
    document.querySelectorAll('#tradeIconPicker .trade-icon-option').forEach(opt => {
      opt.classList.toggle('active', opt.getAttribute('data-icon') === '🔨');
    });

    // Render existing trades list
    this.renderExistingTradesList();

    modal.classList.add('open');
  }

  renderExistingTradesList() {
    const container = document.getElementById('existingTradesList');
    const countEl = document.getElementById('existingTradesCount');
    if (!container) return;

    const trades = this.store.getTrades();
    if (countEl) countEl.textContent = `${trades.length} ट्रेड्स मौजूद हैं`;

    container.innerHTML = trades.map(t => {
      const workerCount = this.store.getWorkers(t.id).length;
      return `
        <div class="trade-tag-chip">
          <span>${getTradeIcon(t.icon)} ${esc(t.name)}</span>
          <span class="worker-badge-count">${workerCount} कारीगर</span>
          ${workerCount === 0 ? `<button type="button" class="btn-del-custom-trade" data-del-trade-id="${t.id}" title="ट्रेड हटाएं">✕</button>` : ''}
        </div>
      `;
    }).join('');
  }

  /* The single way to change screen. Two tabs (evening diary, lending) have no
     button in the dock any more — they are reached from settings — so this
     must not depend on a nav button existing. */
  goToTab(tabId) {
    const targetView = document.getElementById(tabId);
    if (!targetView) return;
    if (tabId === 'tab-lending' && this.currentTab !== 'tab-lending') {
      this.lendingReturnTab = this.currentTab;
    }
    this.tabScrollPositions.set(this.currentTab, window.scrollY);
    if (tabId !== this.currentTab) this.lendingLock.lock();

    document.querySelectorAll('.nav-tab-btn').forEach(b => {
      b.classList.remove('active');
      b.removeAttribute('aria-current');
    });
    document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));
    targetView.classList.add('active');
    document.querySelector(`.nav-tab-btn[data-tab="${tabId}"]`)?.classList.add('active');
    document.querySelector(`.nav-tab-btn[data-tab="${tabId}"]`)?.setAttribute('aria-current', 'page');
    this.currentTab = tabId;

    if (tabId === 'tab-monthly') this.renderMonthlyHaziri();
    requestAnimationFrame(() => {
      if (this.currentTab !== tabId) return;
      const headerHeight = document.querySelector('.app-header')?.offsetHeight || 0;
      const contentTop = targetView.getBoundingClientRect().top + window.scrollY - headerHeight - 16;
      window.scrollTo({ top: this.tabScrollPositions.get(tabId) ?? Math.max(0, contentTop), behavior: 'instant' });
    });
  }

  async downloadBackup() {
    if (!await this.lendingLock.request()) return false;
    try {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(this.store.exportData());
      const link = document.createElement('a');
      link.href = dataStr;
      link.download = `site_diary_backup_${getTodayString()}.json`;
      link.click();
      return true;
    } finally {
      this.lendingLock.lock();
    }
  }

  // --- EVENT BINDINGS ---
  bindEvents() {
    // Navigation Tabs
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => this.goToTab(btn.getAttribute('data-tab')));
    });

    // The two screens that left the dock are reached from settings instead.
    document.querySelectorAll('[data-go-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.closeModals();
        this.goToTab(btn.getAttribute('data-go-tab'));
      });
    });

    // Modal Close buttons
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => this.closeModals());
    });
    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeModals();
      });
    });

    // Quick Action Buttons
    const btnJumpHaziri = document.getElementById('btnJumpToHaziri');
    if (btnJumpHaziri) {
      btnJumpHaziri.addEventListener('click', () => {
        this.goToTab('tab-haziri');
      });
    }

    const btnCash = document.getElementById('btnQuickCash');
    if (btnCash) btnCash.addEventListener('click', () => this.openAddTransactionModal({ type: 'cash', targetType: 'individual' }));

    const metricCash = document.getElementById('metricCardCash');
    if (metricCash) metricCash.addEventListener('click', () => this.openAddTransactionModal({ type: 'cash', targetType: 'individual' }));

    const btnRation = document.getElementById('btnQuickRation');
    if (btnRation) btnRation.addEventListener('click', () => this.openAddTransactionModal({ type: 'ration', targetType: 'group' }));

    const metricRation = document.getElementById('metricCardRation');
    if (metricRation) metricRation.addEventListener('click', () => this.openAddTransactionModal({ type: 'ration', targetType: 'group' }));

    const btnRecharge = document.getElementById('btnQuickRecharge');
    if (btnRecharge) btnRecharge.addEventListener('click', () => this.openAddTransactionModal({ type: 'recharge', targetType: 'individual' }));

    const metricHaziri = document.getElementById('metricCardHaziri');
    if (metricHaziri) {
      metricHaziri.addEventListener('click', () => {
        this.goToTab('tab-haziri');
      });
    }

    const pillDiary = document.getElementById('statTodayDiaryStatus');
    if (pillDiary) {
      pillDiary.addEventListener('click', () => {
        this.goToTab('tab-diary');
      });
    }

    const btnQuickHaziri = document.getElementById('btnQuickHaziri');
    if (btnQuickHaziri) {
      btnQuickHaziri.addEventListener('click', () => {
        this.goToTab('tab-haziri');
      });
    }

    const btnQuickMonthly = document.getElementById('btnQuickMonthly');
    if (btnQuickMonthly) {
      btnQuickMonthly.addEventListener('click', () => {
        this.goToTab('tab-monthly');
      });
    }

    // The old "📊 महीना" pill was removed from the attendance bar — the bottom
    // nav's "मस्टर रोल" tab already goes there, and the bar needed the width.

    const btnFillDemoMonth = document.getElementById('btnFillDemoMonth');
    if (btnFillDemoMonth) {
      btnFillDemoMonth.addEventListener('click', () => {
        /* This used to overwrite the whole month with randomised attendance, with
           no confirmation — on a live site that silently destroys the register the
           wages are calculated from. It now only fills dates nobody has marked,
           marks everyone present, and asks first. */
        const d = new Date();
        const year = this.monthlyYear;
        const monthNum = this.monthlyMonth;
        const month = String(monthNum).padStart(2, '0');
        const workers = this.store.getWorkers();
        if (workers.length === 0) {
          alert('पहले कम से कम एक कारीगर जोड़ें।');
          return;
        }

        const daysInMonth = new Date(year, monthNum, 0).getDate();
        const today = getTodayString();
        const emptyDates = [];
        for (let day = 1; day <= daysInMonth; day++) {
          const dateKey = `${year}-${month}-${String(day).padStart(2, '0')}`;
          if (dateKey > today) continue; // never pre-fill the future
          const existing = this.store.data.haziri[dateKey];
          if (!existing || Object.keys(existing).length === 0) emptyDates.push(dateKey);
        }

        if (emptyDates.length === 0) {
          alert('इस महीने की हर तारीख की हाजिरी पहले से भरी हुई है — कुछ बदला नहीं गया।');
          return;
        }

        if (!confirm(
          `${emptyDates.length} खाली तारीखों में सभी ${workers.length} कारीगरों की हाजिरी "उपस्थित" लगा दी जाएगी ` +
          `(रविवार को छुट्टी)।\n\nजिन तारीखों की हाजिरी पहले से भरी है, वे नहीं बदलेंगी।\n\nजारी रखें?`
        )) return;

        emptyDates.forEach(dateKey => {
          const day = Number(dateKey.split('-')[2]);
          const isSunday = new Date(year, monthNum - 1, day).getDay() === 0;
          this.store.data.haziri[dateKey] = {};
          workers.forEach(w => {
            this.store.data.haziri[dateKey][w.id] = { status: isSunday ? 0 : 1.0, otHours: 0 };
          });
        });
        this.store.save();
        this.commit();
        alert(`${emptyDates.length} खाली तारीखों की हाजिरी भर दी गई। जो पहले से भरी थीं, वे सुरक्षित हैं।`);
      });
    }

    const btnQuickDiary = document.getElementById('btnQuickDiary');
    if (btnQuickDiary) {
      btnQuickDiary.addEventListener('click', () => {
        this.goToTab('tab-diary');
      });
    }

    const btnBannerOpen = document.getElementById('btnEveningBannerOpen');
    if (btnBannerOpen) {
      btnBannerOpen.addEventListener('click', () => {
        this.goToTab('tab-diary');
      });
    }

    // Modal Transaction Type Switcher
    document.querySelectorAll('#txTypeSwitcher .segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#txTypeSwitcher .segment-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.modalTxType = btn.getAttribute('data-type');
        this.updateCylinderFields();

        const rationFields = document.getElementById('rationFields');
        const targetTypeGroup = document.getElementById('targetTypeGroup');
        const workerSelectGroup = document.getElementById('workerSelectGroup');

        if (['ration', 'cylinder'].includes(this.modalTxType)) {
          rationFields.style.display = this.modalTxType === 'ration' ? 'block' : 'none';
          // Auto switch to group for ration unless user overrides
          this.modalTargetType = 'group';
          document.querySelectorAll('#txTargetTypeSwitcher .segment-btn').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-target') === 'group');
          });
          workerSelectGroup.style.display = 'none';
        } else {
          rationFields.style.display = 'none';
          this.modalTargetType = 'individual';
          document.querySelectorAll('#txTargetTypeSwitcher .segment-btn').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-target') === 'individual');
          });
          workerSelectGroup.style.display = 'block';
        }
      });
    });

    // Modal Target Type Switcher
    document.querySelectorAll('#txTargetTypeSwitcher .segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#txTargetTypeSwitcher .segment-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.modalTargetType = btn.getAttribute('data-target');
        const workerSelectGroup = document.getElementById('workerSelectGroup');
        if (workerSelectGroup) {
          workerSelectGroup.style.display = this.modalTargetType === 'individual' ? 'block' : 'none';
        }
      });
    });

    // Trade select change in tx modal
    const tradeSelect = document.getElementById('txTradeSelect');
    if (tradeSelect) {
      tradeSelect.addEventListener('change', () => this.updateWorkerSelect());
    }

    // Ration custom item selector
    const rationPreset = document.getElementById('txRationItemPreset');
    const customRationWrap = document.getElementById('customRationItemWrap');
    if (rationPreset && customRationWrap) {
      rationPreset.addEventListener('change', () => {
        customRationWrap.style.display = rationPreset.value === 'Other' ? 'block' : 'none';
      });
    }

    // Quick Amount Chips
    document.querySelectorAll('.amt-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const addAmt = Number(chip.getAttribute('data-add-amt')) || 0;
        const amtInput = document.getElementById('txAmount');
        if (amtInput) {
          const current = Number(amtInput.value) || 0;
          amtInput.value = current + addAmt;
        }
      });
    });

    // Form Add Transaction Submit
    const formTx = document.getElementById('formAddTransaction');
    if (formTx) {
      formTx.addEventListener('submit', (e) => {
        e.preventDefault();
        const tradeId = document.getElementById('txTradeSelect').value;
        const workerId = this.modalTargetType === 'individual' ? document.getElementById('txWorkerSelect').value : null;
        const amount = Number(document.getElementById('txAmount').value) || 0;
        const note = document.getElementById('txNote').value;

        let rationItem = '';
        let quantity = '';
        if (this.modalTxType === 'ration') {
          const presetVal = document.getElementById('txRationItemPreset').value;
          rationItem = presetVal === 'Other' ? document.getElementById('txCustomRationItem').value : presetVal;
          quantity = document.getElementById('txQuantity').value;
        }
        if (this.modalTxType === 'cylinder') {
          const count = Number(document.getElementById('txCylinderCount').value);
          if (!Number.isSafeInteger(count) || count < 1) return;
          quantity = `${count} सिलेंडर`;
        }

        this.store.addTransaction({
          tradeId,
          targetType: this.modalTargetType,
          workerId,
          type: this.modalTxType,
          amount,
          rationItem,
          quantity,
          note
        });

        this.closeModals();
        this.commit();
      });
    }

    // Delete Transaction
    document.addEventListener('click', (e) => {
      const delBtn = e.target.closest('[data-delete-tx]');
      if (delBtn) {
        const txId = delBtn.getAttribute('data-delete-tx');
        if (confirm('क्या आप इस लेन-देन को हटाना चाहते हैं?')) {
          this.store.deleteTransaction(txId);
          this.commit();
        }
      }
    });

    // Audio Playback in Timeline
    document.addEventListener('click', (e) => {
      const playBtn = e.target.closest('.btn-audio-play');
      if (playBtn) {
        const audioUrl = playBtn.getAttribute('data-audio');
        if (audioUrl) {
          const audio = new Audio(audioUrl);
          audio.play();
        }
      }
    });

    // Timeline Filters
    const bindFilterChips = () => {
      document.querySelectorAll('#timelineFilters .filter-chip[data-filter-type]').forEach(chip => {
        chip.addEventListener('click', () => {
          document.querySelectorAll('#timelineFilters .filter-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          this.activeFilterType = chip.getAttribute('data-filter-type');
          this.activeFilterTrade = null;
          this.renderTimeline();
        });
      });
    };
    bindFilterChips();

    // "+ जोड़ें" button to add custom transaction types
    const btnAddFilterType = document.getElementById('btnAddFilterType');
    if (btnAddFilterType) {
      btnAddFilterType.addEventListener('click', () => {
        const name = prompt('नया लेन-देन प्रकार का नाम लिखें:\n(जैसे: बिजली बिल, ठेका, चाय-पानी, दवाई आदि)');
        if (!name || !name.trim()) return;
        const typeName = name.trim();
        const typeId = typeName.toLowerCase().replace(/\s+/g, '_');

        // Save to localStorage
        let customTypes = [];
        try { customTypes = JSON.parse(localStorage.getItem('custom_tx_types') || '[]'); } catch(e) {}
        if (!customTypes.find(t => t.id === typeId)) {
          customTypes.push({ id: typeId, label: typeName });
          localStorage.setItem('custom_tx_types', JSON.stringify(customTypes));
        }

        // Add filter chip
        const chip = document.createElement('button');
        chip.className = 'filter-chip';
        chip.setAttribute('data-filter-type', typeId);
        chip.textContent = '🏷️ ' + typeName;
        btnAddFilterType.parentNode.insertBefore(chip, btnAddFilterType);

        // Add to txTypeSwitcher in modal
        const txTypeSwitcher = document.getElementById('txTypeSwitcher');
        if (txTypeSwitcher) {
          const segBtn = document.createElement('button');
          segBtn.type = 'button';
          segBtn.className = 'segment-btn';
          segBtn.setAttribute('data-type', typeId);
          segBtn.textContent = '🏷️ ' + typeName;
          txTypeSwitcher.appendChild(segBtn);
        }

        // Rebind
        bindFilterChips();
        alert(`✅ "${typeName}" प्रकार जोड़ दिया गया!`);
      });

      // Load saved custom types on startup
      try {
        const customTypes = JSON.parse(localStorage.getItem('custom_tx_types') || '[]');
        customTypes.forEach(t => {
          // Add filter chip
          const chip = document.createElement('button');
          chip.className = 'filter-chip';
          chip.setAttribute('data-filter-type', t.id);
          chip.textContent = '🏷️ ' + t.label;
          btnAddFilterType.parentNode.insertBefore(chip, btnAddFilterType);

          // Add to txTypeSwitcher
          const txTypeSwitcher = document.getElementById('txTypeSwitcher');
          if (txTypeSwitcher) {
            const segBtn = document.createElement('button');
            segBtn.type = 'button';
            segBtn.className = 'segment-btn';
            segBtn.setAttribute('data-type', t.id);
            segBtn.textContent = '🏷️ ' + t.label;
            txTypeSwitcher.appendChild(segBtn);
          }
        });
        bindFilterChips();
      } catch(e) {}
    }

    // Timeline Search & Date Mode Switcher
    const timelinePreset = document.getElementById('timelineDatePreset');
    const timelineCustomPicker = document.getElementById('timelineDatePicker');
    const timelineSearch = document.getElementById('timelineSearchInput');

    if (timelinePreset) {
      timelinePreset.addEventListener('change', (e) => {
        this.timelineDateMode = e.target.value;
        if (this.timelineDateMode === 'custom') {
          if (timelineCustomPicker) {
            timelineCustomPicker.style.display = 'inline-block';
            timelineCustomPicker.value = this.timelineCustomDate || getTodayString();
          }
        } else {
          if (timelineCustomPicker) timelineCustomPicker.style.display = 'none';
        }
        this.renderTimeline();
      });
    }

    if (timelineCustomPicker) {
      timelineCustomPicker.addEventListener('change', (e) => {
        this.timelineCustomDate = e.target.value;
        this.renderTimeline();
      });
    }

    if (timelineSearch) {
      timelineSearch.addEventListener('input', (e) => {
        this.timelineSearchQuery = e.target.value;
        clearTimeout(this.timelineSearchTimer);
        this.timelineSearchTimer = setTimeout(() => this.renderTimeline(), 160);
      });
    }

    // Global delegation for Edit Transaction button
    document.addEventListener('click', (e) => {
      const editBtn = e.target.closest('[data-edit-tx]');
      if (editBtn) {
        const txId = editBtn.getAttribute('data-edit-tx');
        this.openEditTransactionModal(txId);
      }
    });

    // Global delegation for Worker Statement (Passbook) button
    document.addEventListener('click', (e) => {
      const stmtBtn = e.target.closest('[data-open-statement]');
      if (stmtBtn) {
        const workerId = stmtBtn.getAttribute('data-open-statement');
        this.openWorkerStatementModal(workerId);
      }
    });

    // Global delegation for Worker WhatsApp statement share button
    document.addEventListener('click', (e) => {
      const waBtn = e.target.closest('[data-worker-wa-share]');
      if (waBtn) {
        const workerId = waBtn.getAttribute('data-worker-wa-share');
        this.shareWorkerStatementWhatsApp(workerId);
      }
    });

    // Global delegation for Edit Worker button
    document.addEventListener('click', (e) => {
      const editWBtn = e.target.closest('[data-open-edit-worker]');
      if (editWBtn) {
        const workerId = editWBtn.getAttribute('data-open-edit-worker');
        this.openEditWorkerModal(workerId);
      }
    });

    // Global delegation for Delete Worker button
    document.addEventListener('click', (e) => {
      const delWBtn = e.target.closest('[data-delete-worker-id]');
      if (delWBtn) {
        const workerId = delWBtn.getAttribute('data-delete-worker-id');
        const worker = this.store.getWorker(workerId);
        if (worker && confirm(`क्या आप कारीगर "${worker.name}" को हटाना चाहते हैं?\n\nहटाने के बाद इस कारीगर का विवरण सूची से हट जाएगा।`)) {
          this.store.deleteWorker(workerId);
          this.closeModals();
          this.populateSelects();
          this.commit();
        }
      }
    });

    // Worker Statement Modal Actions
    const btnShareWA = document.getElementById('btnShareStatementWhatsApp');
    if (btnShareWA) {
      btnShareWA.addEventListener('click', () => {
        if (this.activeStatementWorkerId) {
          this.shareWorkerStatementWhatsApp(this.activeStatementWorkerId);
        }
      });
    }

    const btnPrintStmt = document.getElementById('btnPrintWorkerStatement');
    if (btnPrintStmt) {
      btnPrintStmt.addEventListener('click', () => {
        window.print();
      });
    }

    const btnEditFromStmt = document.getElementById('btnEditWorkerFromStatement');
    if (btnEditFromStmt) {
      btnEditFromStmt.addEventListener('click', () => {
        const wId = this.activeStatementWorkerId;
        this.closeModals();
        if (wId) this.openEditWorkerModal(wId);
      });
    }

    // Statement Subview Switcher (Payments vs Haziri)
    document.querySelectorAll('[data-stmt-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-stmt-tab]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tabId = btn.getAttribute('data-stmt-tab');
        const paymentsView = document.getElementById('stmt-payments');
        const haziriView = document.getElementById('stmt-haziri');
        if (tabId === 'stmt-haziri') {
          if (paymentsView) paymentsView.style.display = 'none';
          if (haziriView) haziriView.style.display = 'block';
        } else {
          if (paymentsView) paymentsView.style.display = 'block';
          if (haziriView) haziriView.style.display = 'none';
        }
      });
    });

    // Edit Worker Role switcher
    document.querySelectorAll('#editWorkerRoleSwitcher .segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#editWorkerRoleSwitcher .segment-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.editWorkerRole = btn.getAttribute('data-role');
      });
    });

    // Edit Worker Contract switcher
    document.querySelectorAll('#editWorkerContractSwitcher .segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#editWorkerContractSwitcher .segment-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.editWorkerContract = btn.getAttribute('data-contract');
        const dihadiGroup = document.getElementById('editDihadiGroup');
        const thekaGroup = document.getElementById('editThekaGroup');
        if (this.editWorkerContract === 'theka') {
          if (dihadiGroup) dihadiGroup.style.display = 'none';
          if (thekaGroup) thekaGroup.style.display = 'block';
        } else {
          if (dihadiGroup) dihadiGroup.style.display = 'block';
          if (thekaGroup) thekaGroup.style.display = 'none';
        }
      });
    });

    // Edit Worker Photo Pick / Remove
    const btnEditPickPhoto = document.getElementById('btnEditPickPhoto');
    const editWorkerPhotoInput = document.getElementById('editWorkerPhotoInput');
    const editWorkerPhotoImg = document.getElementById('editWorkerPhotoImg');
    const editWorkerPhotoPlaceholder = document.getElementById('editWorkerPhotoPlaceholder');
    const btnEditRemovePhoto = document.getElementById('btnEditRemovePhoto');
    const editPhotoPreviewBox = document.getElementById('editWorkerPhotoPreview');

    const triggerEditPhotoPick = () => {
      if (editWorkerPhotoInput) editWorkerPhotoInput.click();
    };
    if (btnEditPickPhoto) btnEditPickPhoto.addEventListener('click', triggerEditPhotoPick);
    if (editPhotoPreviewBox) editPhotoPreviewBox.addEventListener('click', triggerEditPhotoPick);

    if (editWorkerPhotoInput) {
      editWorkerPhotoInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const compressed = await this.compressImage(file);
          this.editWorkerPhotoDataUrl = compressed;
          if (editWorkerPhotoImg) {
            editWorkerPhotoImg.src = compressed;
            editWorkerPhotoImg.style.display = 'block';
          }
          if (editWorkerPhotoPlaceholder) editWorkerPhotoPlaceholder.style.display = 'none';
          if (btnEditRemovePhoto) btnEditRemovePhoto.style.display = 'inline-block';
        } catch (err) {
          console.error('Photo compression error:', err);
        }
      });
    }

    if (btnEditRemovePhoto) {
      btnEditRemovePhoto.addEventListener('click', () => {
        this.editWorkerPhotoDataUrl = null;
        if (editWorkerPhotoInput) editWorkerPhotoInput.value = '';
        if (editWorkerPhotoImg) {
          editWorkerPhotoImg.src = '';
          editWorkerPhotoImg.style.display = 'none';
        }
        if (editWorkerPhotoPlaceholder) editWorkerPhotoPlaceholder.style.display = 'block';
        btnEditRemovePhoto.style.display = 'none';
      });
    }

    // Submit Edit Worker Form
    const formEditWorker = document.getElementById('formEditWorker');
    if (formEditWorker) {
      formEditWorker.noValidate = true;
      formEditWorker.addEventListener('submit', (e) => {
        e.preventDefault();
        const workerId = document.getElementById('editWorkerId').value;
        const name = (document.getElementById('editWorkerName').value || '').trim();
        if (!name) {
          alert('कृपया कारीगर का नाम दर्ज करें!');
          return;
        }
        const tradeId = document.getElementById('editWorkerTrade').value;
        const phone = (document.getElementById('editWorkerPhone').value || '').trim();
        const isTheka = this.editWorkerContract === 'theka';
        const dailyRate = !isTheka ? (Number(document.getElementById('editWorkerDailyRate').value) || 0) : 0;
        const thekaAmount = isTheka ? (Number(document.getElementById('editWorkerThekaAmount').value) || 0) : 0;
        const thekaDescription = isTheka ? document.getElementById('editWorkerThekaDesc').value : '';

        this.store.updateWorker(workerId, {
          name: name.trim(),
          tradeId,
          role: this.editWorkerRole,
          contractType: this.editWorkerContract,
          dailyRate,
          thekaAmount,
          thekaDescription,
          phone: phone.trim(),
          photoUrl: this.editWorkerPhotoDataUrl
        });

        this.closeModals();
        this.populateSelects();
        this.commit();
        alert('कारीगर की जानकारी सफलतापूर्वक अपडेट कर दी गई!');
      });
    }

    // Delete Worker from inside Edit Modal
    const btnDelWorkerInside = document.getElementById('btnDeleteWorker');
    if (btnDelWorkerInside) {
      btnDelWorkerInside.addEventListener('click', () => {
        const workerId = document.getElementById('editWorkerId').value;
        const worker = this.store.getWorker(workerId);
        if (worker && confirm(`क्या आप सच में कारीगर "${worker.name}" को हटाना चाहते हैं?`)) {
          this.store.deleteWorker(workerId);
          this.closeModals();
          this.populateSelects();
          this.commit();
        }
      });
    }

    // Edit Transaction Type & Target Switchers
    document.querySelectorAll('#editTxTypeSwitcher .segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#editTxTypeSwitcher .segment-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.editTxType = btn.getAttribute('data-type');
        this.updateCylinderFields(true);
        const rationFields = document.getElementById('editRationFields');
        if (rationFields) {
          rationFields.style.display = this.editTxType === 'ration' ? 'block' : 'none';
        }
      });
    });

    document.querySelectorAll('#editTxTargetTypeSwitcher .segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#editTxTargetTypeSwitcher .segment-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.editTxTarget = btn.getAttribute('data-target');
        const workerSelectGroup = document.getElementById('editTxWorkerSelectGroup');
        if (workerSelectGroup) {
          workerSelectGroup.style.display = this.editTxTarget === 'individual' ? 'block' : 'none';
        }
      });
    });

    const editTxTradeSelect = document.getElementById('editTxTradeSelect');
    if (editTxTradeSelect) {
      editTxTradeSelect.addEventListener('change', (e) => {
        const workerSelect = document.getElementById('editTxWorkerSelect');
        if (workerSelect) {
          const workers = this.store.getWorkers(e.target.value);
          workerSelect.innerHTML = workers.map(w => `
            <option value="${esc(w.id)}">${esc(w.name)} (${w.role === 'mistri' ? 'मिस्त्री' : 'हेल्पर'})</option>
          `).join('');
        }
      });
    }

    // Submit Edit Transaction Form
    const formEditTx = document.getElementById('formEditTransaction');
    if (formEditTx) {
      formEditTx.addEventListener('submit', (e) => {
        e.preventDefault();
        const txId = document.getElementById('editTxId').value;
        const tradeId = document.getElementById('editTxTradeSelect').value;
        const workerId = this.editTxTarget === 'individual' ? document.getElementById('editTxWorkerSelect').value : null;
        const date = document.getElementById('editTxDate').value;
        const time = document.getElementById('editTxTime').value;
        const amount = Number(document.getElementById('editTxAmount').value) || 0;
        const note = document.getElementById('editTxNote').value;
        const rationItem = this.editTxType === 'ration' ? document.getElementById('editTxRationItem').value : '';
        let quantity = this.editTxType === 'ration' ? document.getElementById('editTxQuantity').value : '';
        if (this.editTxType === 'cylinder') {
          const value = document.getElementById('editTxCylinderCount').value;
          const count = Number(value);
          if (value && (!Number.isSafeInteger(count) || count < 1)) return;
          quantity = value ? `${count} सिलेंडर` : '';
        }

        this.store.updateTransaction(txId, {
          type: this.editTxType,
          targetType: this.editTxTarget,
          tradeId,
          workerId,
          date,
          time,
          amount,
          note,
          rationItem,
          quantity
        });

        this.closeModals();
        this.commit();
        if (this.activeStatementWorkerId) {
          this.openWorkerStatementModal(this.activeStatementWorkerId);
        }
      });
    }

    const btnDelTxFromEdit = document.getElementById('btnDeleteTxFromEdit');
    if (btnDelTxFromEdit) {
      btnDelTxFromEdit.addEventListener('click', () => {
        const txId = document.getElementById('editTxId').value;
        if (confirm('क्या आप इस लेन-देन को हटाना चाहते हैं?')) {
          this.store.deleteTransaction(txId);
          this.closeModals();
          this.commit();
          if (this.activeStatementWorkerId) {
            this.openWorkerStatementModal(this.activeStatementWorkerId);
          }
        }
      });
    }

    // Haziri Date Picker & Chip Wrap
    const haziriDate = document.getElementById('haziriDatePicker');
    const haziriDateWrap = document.getElementById('haziriDateWrap');
    if (haziriDate) {
      haziriDate.value = this.selectedHaziriDate;
      haziriDate.addEventListener('change', (e) => {
        this.selectedHaziriDate = e.target.value;
        this.renderHaziri();
        this.renderStats();
        this.renderDiarySheet();
        this.scheduleSync('haziri');
      });
    }
    if (haziriDateWrap && haziriDate) {
      haziriDateWrap.addEventListener('click', (e) => {
        if (e.target !== haziriDate) {
          if (typeof haziriDate.showPicker === 'function') {
            haziriDate.showPicker();
          } else {
            haziriDate.focus();
            haziriDate.click();
          }
        }
      });
    }

      // Haziri View Switcher (Daily vs Monthly)
      document.querySelectorAll('#haziriViewSwitcher .segment-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#haziriViewSwitcher .segment-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.haziriSubView = btn.getAttribute('data-hz-view');

          const dailyWrap = document.getElementById('haziriDailyView');
          const monthlyWrap = document.getElementById('haziriMonthlyView');

          if (this.haziriSubView === 'monthly') {
            if (dailyWrap) dailyWrap.style.display = 'none';
            if (monthlyWrap) monthlyWrap.style.display = 'block';
            this.renderMonthlyHaziri();
          } else {
            if (dailyWrap) dailyWrap.style.display = 'block';
            if (monthlyWrap) monthlyWrap.style.display = 'none';
            this.renderHaziri();
          }
        });
      });

      // Month Navigation
      const btnPrevMonth = document.getElementById('btnPrevMonth');
      if (btnPrevMonth) {
        btnPrevMonth.addEventListener('click', () => {
          if (this.monthlyMonth === 1) {
            this.monthlyMonth = 12;
            this.monthlyYear -= 1;
          } else {
            this.monthlyMonth -= 1;
          }
          this.renderMonthlyHaziri();
        });
      }

      const btnNextMonth = document.getElementById('btnNextMonth');
      if (btnNextMonth) {
        btnNextMonth.addEventListener('click', () => {
          if (this.monthlyMonth === 12) {
            this.monthlyMonth = 1;
            this.monthlyYear += 1;
          } else {
            this.monthlyMonth += 1;
          }
          this.renderMonthlyHaziri();
        });
      }

      const monthlyPicker = document.getElementById('monthlyPicker');
      if (monthlyPicker) {
        monthlyPicker.addEventListener('change', (e) => {
          if (e.target.value) {
            const [y, m] = e.target.value.split('-').map(Number);
            this.monthlyYear = y;
            this.monthlyMonth = m;
            this.renderMonthlyHaziri();
          }
        });
      }

      // Export Monthly CSV
      const btnExportCsv = document.getElementById('btnExportMonthlyCsv');
      if (btnExportCsv) {
        btnExportCsv.addEventListener('click', () => this.exportMonthlyMusterRollCsv());
      }

      const btnPrintMuster = document.getElementById('btnPrintMonthlySheet');
      if (btnPrintMuster) {
        btnPrintMuster.addEventListener('click', () => window.print());
      }

      // Interactive Cell Click on Monthly Grid
      document.addEventListener('click', (e) => {
        const cell = e.target.closest('[data-matrix-worker]');
        if (cell) {
          const workerId = cell.getAttribute('data-matrix-worker');
          const dateStr = cell.getAttribute('data-matrix-date');
          const dayHaziri = this.store.getHaziri(dateStr);
          const currentRecord = dayHaziri ? dayHaziri[workerId] : null;

          // Cycle: Empty/Null -> 1.0 (Full) -> 0.5 (Half) -> 0 (Absent) -> 1.0
          let nextVal = 1.0;
          if (currentRecord) {
            if (currentRecord.status === 1.0) nextVal = 0.5;
            else if (currentRecord.status === 0.5) nextVal = 0;
            else if (currentRecord.status === 0) nextVal = 1.0;
          }

          this.store.setWorkerHaziri(dateStr, workerId, nextVal, 0, currentRecord?.reason);
          this.renderMonthlyHaziri();
          this.renderHaziri();
          this.renderStats();
          this.renderDiarySheet();
          this.scheduleSync('haziri');
        }
      });

      // Attendance: Trade Tab click
      document.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('.attendance-trade-tab');
        if (tabBtn) {
          const tradeId = tabBtn.getAttribute('data-trade-id');
          if (tradeId) {
            this.activeHaziriTradeId = tradeId;
            this.renderHaziri();
          }
        }
      });

      // Attendance: One-Tap '✓ All Present' (Marks all workers in active group present 1.0)
      document.addEventListener('click', (e) => {
        if (e.target.closest('#btnMarkAllPresent')) {
          const date = this.selectedHaziriDate || getTodayString();
          let currentWorkers = [];
          if (this.activeHaziriTradeId === 'all') {
            currentWorkers = this.store.getWorkers();
          } else {
            currentWorkers = this.store.getWorkers(this.activeHaziriTradeId);
          }
          currentWorkers.forEach(w => {
            const currentRecord = this.store.getHaziri(date)[w.id] || { status: 0, otHours: 0 };
            this.store.setWorkerHaziri(date, w.id, 1.0, currentRecord.otHours);
          });
          this.renderHaziri();
          this.renderMonthlyHaziri();
          this.renderStats();
          this.renderDiarySheet();
          this.scheduleSync('haziri');
          this.showToast(`✓ सभी ${currentWorkers.length} सदस्य उपस्थित दर्ज!`);
        }
      });

      // Attendance: Sleek iOS Toggle Switch Checkbox Change
      document.addEventListener('change', (e) => {
        if (e.target.classList.contains('attendance-toggle-input')) {
          const workerId = e.target.getAttribute('data-worker-id');
          const isChecked = e.target.checked;
          const val = isChecked ? 1.0 : 0;
          const date = this.selectedHaziriDate || getTodayString();
          const currentRecord = this.store.getHaziri(date)[workerId] || { status: 0, otHours: 0 };

          this.store.setWorkerHaziri(date, workerId, val, currentRecord.otHours, currentRecord.reason);
          this.renderHaziri();
          this.renderMonthlyHaziri();
          this.renderStats();
          this.renderDiarySheet();
          this.scheduleSync('haziri');
        }
      });

      /* Attendance: why a worker is absent. Optional throughout — the blank
         first option clears it again, and cancelling the typed reason leaves
         the record exactly as it was. */
      document.addEventListener('change', (e) => {
        const reasonSelect = e.target.closest('[data-hz-reason]');
        if (!reasonSelect) return;

        const workerId = reasonSelect.getAttribute('data-hz-reason');
        const date = this.selectedHaziriDate || getTodayString();
        const currentRecord = this.store.getHaziri(date)[workerId] || { status: 0, otHours: 0 };
        let reason = reasonSelect.value;

        // The already-typed reason, picked again: nothing to change.
        if (reason === '__typed__') return;

        if (reason === '__other__') {
          const known = ABSENCE_REASONS.some(r => r.id === currentRecord.reason);
          const typed = prompt(
            this.currentLang === 'en' ? 'Reason for absence:' : 'गैरहाजिरी का कारण लिखें:',
            (currentRecord.reason && !known) ? currentRecord.reason : ''
          );
          // Cancelled — redraw so the dropdown goes back to what is stored.
          if (typed === null) { this.renderHaziri(); return; }
          reason = typed;
        }

        this.store.setWorkerHaziri(date, workerId, currentRecord.status, currentRecord.otHours, reason);
        this.renderHaziri();
        this.renderMonthlyHaziri();
        this.scheduleSync('haziri');
      });

      // Attendance: Rare Half-Day Micro-chip click
      document.addEventListener('click', (e) => {
        const halfBtn = e.target.closest('[data-hz-half]');
        if (halfBtn) {
          const workerId = halfBtn.getAttribute('data-hz-half');
          const date = this.selectedHaziriDate || getTodayString();
          const currentRecord = this.store.getHaziri(date)[workerId] || { status: 0, otHours: 0 };
          const newStatus = (currentRecord.status === 0.5) ? 1.0 : 0.5;

          this.store.setWorkerHaziri(date, workerId, newStatus, currentRecord.otHours, currentRecord.reason);
          this.renderHaziri();
          this.renderMonthlyHaziri();
          this.renderStats();
          this.renderDiarySheet();
          this.scheduleSync('haziri');
        }
      });

      // Attendance: Overtime Prompt
      document.addEventListener('click', (e) => {
        const otBtn = e.target.closest('[data-hz-ot]');
        if (otBtn) {
          const workerId = otBtn.getAttribute('data-hz-ot');
          const date = this.selectedHaziriDate || getTodayString();
          const currentRecord = this.store.getHaziri(date)[workerId] || { status: 1.0, otHours: 0 };
          const otInput = prompt('ओवरटाइम घंटे (Overtime Hours) दर्ज करें:', currentRecord.otHours || '1');
          if (otInput !== null) {
            const ot = parseFloat(otInput) || 0;
            this.store.setWorkerHaziri(date, workerId, currentRecord.status || 1.0, ot, currentRecord.reason);
            this.renderHaziri();
            this.renderMonthlyHaziri();
            this.renderStats();
            this.renderDiarySheet();
            this.scheduleSync('haziri');
          }
        }
      });

      // Attendance: Update / Save Button Toast
      document.addEventListener('click', (e) => {
        if (e.target.closest('#btnHaziriSaveUpdate')) {
          this.showToast('✓ हाजिरी सफलतापूर्वक सुरक्षित सहेजी गई!');
        }
      });

      // Quick add worker to specific trade when group is empty
      document.addEventListener('click', (e) => {
        const btnAddWorkerTrade = e.target.closest('#btnQuickAddWorkerToTrade');
        if (btnAddWorkerTrade) {
          const tradeId = btnAddWorkerTrade.getAttribute('data-trade-id');
          this.openAddWorkerModal();
          const tradeSelect = document.getElementById('modalWorkerTrade');
          if (tradeSelect && tradeId && tradeId !== 'all') {
            tradeSelect.value = tradeId;
          }
        }
      });

      // Legacy support for any old toggle buttons if present
      document.addEventListener('click', (e) => {
        const hzBtn = e.target.closest('.btn-hz-toggle');
        if (hzBtn && hzBtn.hasAttribute('data-hz-val')) {
          const workerId = hzBtn.getAttribute('data-worker');
          const val = Number(hzBtn.getAttribute('data-hz-val'));
          const date = this.selectedHaziriDate || getTodayString();
          const currentRecord = this.store.getHaziri(date)[workerId] || { status: 0, otHours: 0 };

          this.store.setWorkerHaziri(date, workerId, val, currentRecord.otHours, currentRecord.reason);
          this.renderHaziri();
          this.renderMonthlyHaziri();
          this.renderStats();
          this.renderDiarySheet();
          this.scheduleSync('haziri');
        }
      });

    // Add Worker Modal triggers
    const btnAddWorker = document.getElementById('btnAddWorkerBtn');
    if (btnAddWorker) btnAddWorker.addEventListener('click', () => this.openAddWorkerModal());

    const btnQuickAddWorker = document.getElementById('btnQuickAddWorker');
    if (btnQuickAddWorker) btnQuickAddWorker.addEventListener('click', () => this.openAddWorkerModal());

    const btnHeaderAddWorker = document.getElementById('btnHeaderAddWorker');
    if (btnHeaderAddWorker) btnHeaderAddWorker.addEventListener('click', () => this.openAddWorkerModal());

    const btnAddWorkerFromMonthly = document.getElementById('btnAddWorkerFromMonthly');
    if (btnAddWorkerFromMonthly) btnAddWorkerFromMonthly.addEventListener('click', () => this.openAddWorkerModal());

    // Lives inside the re-rendered roster, so it needs delegation rather than a
    // one-time getElementById binding. Pre-selects the trade currently on screen.
    document.addEventListener('click', (e) => {
      if (e.target.closest('#btnAddWorkerFromHaziri')) {
        const tradeId = this.activeHaziriTradeId !== 'all' ? this.activeHaziriTradeId : null;
        this.openAddWorkerModal(tradeId);
      }
    });

    document.addEventListener('click', (e) => {
      if (e.target.closest('.btn-add-first-worker')) {
        this.openAddWorkerModal();
      }
    });

    document.addEventListener('click', (e) => {
      const tradeWorkerBtn = e.target.closest('.btn-add-worker-to-trade');
      if (tradeWorkerBtn) {
        const tradeId = tradeWorkerBtn.getAttribute('data-trade-id');
        this.openAddWorkerModal(tradeId);
      }
    });

    // Worker Role Switcher in Add Worker Modal
    document.querySelectorAll('#workerRoleSwitcher .segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#workerRoleSwitcher .segment-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.modalWorkerRole = btn.getAttribute('data-role');
        const rateInput = document.getElementById('workerDailyRate');
        if (rateInput && !rateInput.value) {
          rateInput.value = this.modalWorkerRole === 'mistri' ? 900 : 550;
        }
      });
    });

    // Worker Contract Switcher (Dihadi vs Theka)
    document.querySelectorAll('#workerContractSwitcher .segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#workerContractSwitcher .segment-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.modalContractType = btn.getAttribute('data-contract');

        const dihadiGroup = document.getElementById('dihadiRateGroup');
        const thekaGroup = document.getElementById('thekaDetailsGroup');
        const dailyRateInput = document.getElementById('workerDailyRate');
        const thekaAmtInput = document.getElementById('workerThekaAmount');

        if (this.modalContractType === 'theka') {
          if (dihadiGroup) dihadiGroup.style.display = 'none';
          if (thekaGroup) thekaGroup.style.display = 'block';
          if (dailyRateInput) dailyRateInput.removeAttribute('required');
          this.syncThekaFields();
        } else {
          if (dihadiGroup) dihadiGroup.style.display = 'block';
          if (thekaGroup) thekaGroup.style.display = 'none';
          if (dailyRateInput) dailyRateInput.setAttribute('required', 'true');
          if (thekaAmtInput) thekaAmtInput.removeAttribute('required');
        }
      });
    });

    // Theka: who holds the contract, and how it was agreed
    document.querySelectorAll('#workerThekedarSwitcher .segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#workerThekedarSwitcher .segment-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.modalIsThekedar = btn.getAttribute('data-thekedar') === 'yes';
        this.syncThekaFields();
      });

    document.querySelectorAll('#workerWorksHimselfSwitcher .segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#workerWorksHimselfSwitcher .segment-btn')
          .forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.modalWorksHimself = btn.getAttribute('data-works-himself') === 'yes';
      });
    });
    });

    document.querySelectorAll('#workerThekaModeSwitcher .segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#workerThekaModeSwitcher .segment-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.modalThekaMode = btn.getAttribute('data-theka-mode');
        this.syncThekaFields();
      });
    });

    ['workerThekaRate', 'workerThekaUnit', 'workerThekaQuantity'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => this.updateThekaPreview());
    });

    // Worker Photo Upload & Camera Events
    const btnPickPhoto = document.getElementById('btnPickPhoto');
    const workerPhotoBox = document.getElementById('workerPhotoPreview');
    const workerPhotoInput = document.getElementById('workerPhotoInput');
    const workerPhotoImg = document.getElementById('workerPhotoImg');
    const workerPhotoPlaceholder = document.getElementById('workerPhotoPlaceholder');
    const btnRemovePhoto = document.getElementById('btnRemovePhoto');

    const triggerPhotoPick = () => {
      if (workerPhotoInput) workerPhotoInput.click();
    };

    if (btnPickPhoto) btnPickPhoto.addEventListener('click', triggerPhotoPick);
    if (workerPhotoBox) workerPhotoBox.addEventListener('click', triggerPhotoPick);

    if (workerPhotoInput) {
      workerPhotoInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const compressedDataUrl = await this.compressImage(file);
          this.newWorkerPhotoDataUrl = compressedDataUrl;
          if (workerPhotoImg) {
            workerPhotoImg.src = compressedDataUrl;
            workerPhotoImg.style.display = 'block';
          }
          if (workerPhotoPlaceholder) workerPhotoPlaceholder.style.display = 'none';
          if (btnRemovePhoto) btnRemovePhoto.style.display = 'inline-block';
        } catch (err) {
          console.error('Photo compression error:', err);
          alert('फोटो लोड करने में समस्या हुई। कृपया दोबारा प्रयास करें।');
        }
      });
    }

    if (btnRemovePhoto) {
      btnRemovePhoto.addEventListener('click', () => {
        this.newWorkerPhotoDataUrl = null;
        if (workerPhotoInput) workerPhotoInput.value = '';
        if (workerPhotoImg) {
          workerPhotoImg.src = '';
          workerPhotoImg.style.display = 'none';
        }
        if (workerPhotoPlaceholder) workerPhotoPlaceholder.style.display = 'block';
        btnRemovePhoto.style.display = 'none';
      });
    }

    // Form Add Worker Submit
    document.getElementById('workerTradeSelect')?.addEventListener('change', () => this.syncWorkerFormToTrade());

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('#workerSupplierRoleSwitcher .segment-btn');
      if (!btn) return;
      this.modalSupplierRole = btn.getAttribute('data-supplier-role');
      this.modalWorkerRole = this.modalSupplierRole;
      document.querySelectorAll('#workerSupplierRoleSwitcher .segment-btn')
        .forEach(b => b.classList.toggle('active', b === btn));
    });

    const formWorker = document.getElementById('formAddWorker');
    if (formWorker) {
      formWorker.noValidate = true;
      formWorker.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = (document.getElementById('workerNameInput').value || '').trim();
        if (!name) {
          alert('कृपया कारीगर का नाम दर्ज करें!');
          return;
        }
        const tradeId = document.getElementById('workerTradeSelect').value;
        const isSupplier = this.store.isSupplierTrade(tradeId);
        const supplierRates = isSupplier && this.store.getSupplierKind(tradeId) === 'trolley'
          ? this.readSupplierRateInputs()
          : null;
        const dailyRate = isSupplier
          ? 0
          : (this.modalContractType === 'dihadi' ? (Number(document.getElementById('workerDailyRate').value) || 0) : 0);
        const isTheka = this.modalContractType === 'theka';
        const thekaAmount = isTheka ? (Number(document.getElementById('workerThekaAmount').value) || 0) : 0;
        const thekaRate = isTheka ? (Number(document.getElementById('workerThekaRate')?.value) || 0) : 0;
        const thekaUnit = isTheka ? (document.getElementById('workerThekaUnit')?.value || '') : '';
        const thekaQuantity = isTheka ? (Number(document.getElementById('workerThekaQuantity')?.value) || 0) : 0;
        const thekaDescription = document.getElementById('workerThekaDesc') ? document.getElementById('workerThekaDesc').value : '';
        const phone = (document.getElementById('workerPhone').value || '').trim();

        // A rate contract needs a rate; the measurement can come later.
        if (isTheka && this.modalIsThekedar && this.modalThekaMode === 'rate' && !thekaRate) {
          alert('ठेके की दर दर्ज करें (जैसे: 25 प्रति square ft)।');
          return;
        }

        const addedWorker = this.store.addWorker({
          name,
          tradeId,
          role: isSupplier ? (this.modalSupplierRole || 'malik') : this.modalWorkerRole,
          contractType: isSupplier ? 'dihadi' : this.modalContractType,
          worksHimself: this.modalWorksHimself,
          dailyRate,
          isThekedar: this.modalIsThekedar,
          thekaMode: this.modalThekaMode,
          thekaAmount,
          thekaRate,
          thekaUnit,
          thekaQuantity,
          thekaDescription,
          phone,
          photoUrl: this.newWorkerPhotoDataUrl
        });

        // Rates are per material and belong to this man, so they go on his
        // record the moment he is added rather than behind a second screen.
        if (addedWorker && supplierRates && Object.keys(supplierRates).length) {
          this.store.setTrolleyRates(addedWorker.id, supplierRates);
        }

        // Set full attendance for today for the new worker by default
        const today = getTodayString();
        const workers = this.store.getWorkers(tradeId);
        const newW = workers[workers.length - 1];
        if (newW) {
          this.store.setWorkerHaziri(today, newW.id, 1.0);
        }

        formWorker.reset();
        // Reset photo state
        this.newWorkerPhotoDataUrl = null;
        if (workerPhotoInput) workerPhotoInput.value = '';
        if (workerPhotoImg) {
          workerPhotoImg.src = '';
          workerPhotoImg.style.display = 'none';
        }
        if (workerPhotoPlaceholder) workerPhotoPlaceholder.style.display = 'block';
        if (btnRemovePhoto) btnRemovePhoto.style.display = 'none';

        // Reset contract UI
        this.modalContractType = 'dihadi';
        document.querySelectorAll('#workerContractSwitcher .segment-btn').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-contract') === 'dihadi');
        });
        const dihadiGroup = document.getElementById('dihadiRateGroup');
        const thekaGroup = document.getElementById('thekaDetailsGroup');
        if (dihadiGroup) dihadiGroup.style.display = 'block';
        if (thekaGroup) thekaGroup.style.display = 'none';
        this.modalIsThekedar = true;
        this.modalThekaMode = 'lumpsum';
        document.querySelectorAll('#workerThekedarSwitcher .segment-btn').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-thekedar') === 'yes');
        });
        document.querySelectorAll('#workerWorksHimselfSwitcher .segment-btn').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-works-himself') === 'yes');
        });
        document.querySelectorAll('#workerThekaModeSwitcher .segment-btn').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-theka-mode') === 'lumpsum');
        });
        this.syncThekaFields();

        this.closeModals();
        this.populateSelects();
        this.commit();
      });
    }

    // Add Trade Modal Openers & Handlers
    const btnQuickAddTrade = document.getElementById('btnQuickAddTrade');
    if (btnQuickAddTrade) btnQuickAddTrade.addEventListener('click', () => this.openAddTradeModal(null));

    const btnAddTrade = document.getElementById('btnAddTradeBtn');
    if (btnAddTrade) btnAddTrade.addEventListener('click', () => this.openAddTradeModal(null));

    const btnAddTradeFromHz = document.getElementById('btnAddTradeFromHaziri');
    if (btnAddTradeFromHz) btnAddTradeFromHz.addEventListener('click', () => this.openAddTradeModal(null));

    const btnAddTradeFromMonth = document.getElementById('btnAddTradeFromMonthly');
    if (btnAddTradeFromMonth) btnAddTradeFromMonth.addEventListener('click', () => this.openAddTradeModal(null));

    const btnTradeFromWorker = document.getElementById('btnOpenAddTradeFromWorker');
    if (btnTradeFromWorker) btnTradeFromWorker.addEventListener('click', () => this.openAddTradeModal('modalAddWorker'));

    const btnTradeFromEditWorker = document.getElementById('btnOpenAddTradeFromEditWorker');
    if (btnTradeFromEditWorker) btnTradeFromEditWorker.addEventListener('click', () => this.openAddTradeModal('modalEditWorker'));

    const btnTradeFromTx = document.getElementById('btnOpenAddTradeFromTx');
    if (btnTradeFromTx) btnTradeFromTx.addEventListener('click', () => this.openAddTradeModal('modalAddTransaction'));

    // Quick Trade Suggestion Chips Click
    const suggestionContainer = document.getElementById('quickTradeSuggestionChips');
    if (suggestionContainer) {
      suggestionContainer.addEventListener('click', (e) => {
        const chip = e.target.closest('.trade-suggestion-chip');
        if (chip) {
          document.querySelectorAll('#quickTradeSuggestionChips .trade-suggestion-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');

          const name = chip.getAttribute('data-name');
          const icon = chip.getAttribute('data-icon');

          const nameInput = document.getElementById('tradeNameInput');
          if (nameInput) nameInput.value = name;

          const hiddenIcon = document.getElementById('selectedTradeIcon');
          if (hiddenIcon) hiddenIcon.value = icon;

          document.querySelectorAll('#tradeIconPicker .trade-icon-option').forEach(opt => {
            opt.classList.toggle('active', opt.getAttribute('data-icon') === icon);
          });
        }
      });
    }

    // Trade Icon Picker Click
    const iconPicker = document.getElementById('tradeIconPicker');
    if (iconPicker) {
      iconPicker.addEventListener('click', (e) => {
        const opt = e.target.closest('.trade-icon-option');
        if (opt) {
          document.querySelectorAll('#tradeIconPicker .trade-icon-option').forEach(o => o.classList.remove('active'));
          opt.classList.add('active');
          const icon = opt.getAttribute('data-icon');
          const hiddenIcon = document.getElementById('selectedTradeIcon');
          if (hiddenIcon) hiddenIcon.value = icon;
        }
      });
    }

    // Delete Trade Click in Existing Trades List
    const existingList = document.getElementById('existingTradesList');
    if (existingList) {
      existingList.addEventListener('click', (e) => {
        const delBtn = e.target.closest('[data-del-trade-id]');
        if (delBtn) {
          const tradeId = delBtn.getAttribute('data-del-trade-id');
          const trade = this.store.getTrade(tradeId);
          const workers = this.store.getWorkers(tradeId);
          if (workers.length > 0) {
            alert(`इस ट्रेड में अभी ${workers.length} कारीगर जुड़े हुए हैं। पहले उन कारीगरों को किसी अन्य ट्रेड में बदलें या हटाएं।`);
            return;
          }
          if (confirm(`क्या आप ट्रेड "${trade.name}" को सूची से हटाना चाहते हैं?`)) {
            this.store.deleteTrade(tradeId);
            this.renderExistingTradesList();
            this.populateSelects();
            this.commit();
          }
        }
      });
    }

    // Form Add Trade Submit
    const formTrade = document.getElementById('formAddTrade');
    if (formTrade) {
      formTrade.addEventListener('submit', (e) => {
        e.preventDefault();
        const nameInput = document.getElementById('tradeNameInput');
        const name = nameInput ? nameInput.value.trim() : '';
        const hiddenIcon = document.getElementById('selectedTradeIcon');
        const icon = (hiddenIcon && hiddenIcon.value) ? hiddenIcon.value : '🔨';

        if (name) {
          const newTradeId = this.store.addTrade(name, icon);
          formTrade.reset();
          document.getElementById('modalAddTrade')?.classList.remove('open');
          this.populateSelects();
          this.commit();

          // If opened from inside another modal, return to that modal and select the new trade
          if (this.tradeReturnModal) {
            const returnModalEl = document.getElementById(this.tradeReturnModal);
            if (returnModalEl) returnModalEl.classList.add('open');

            if (this.tradeReturnModal === 'modalAddWorker') {
              const sel = document.getElementById('workerTradeSelect');
              if (sel) sel.value = newTradeId;
            } else if (this.tradeReturnModal === 'modalEditWorker') {
              const sel = document.getElementById('editWorkerTrade');
              if (sel) sel.value = newTradeId;
            } else if (this.tradeReturnModal === 'modalAddTransaction') {
              const sel = document.getElementById('txTradeSelect');
              if (sel) {
                sel.value = newTradeId;
                this.updateWorkerSelect();
              }
            }
            this.tradeReturnModal = null;
          }
        }
      });
    }

    // "Marked in Diary ✓" Button with Confetti
    const btnMarkDiary = document.getElementById('btnMarkInDiary');
    if (btnMarkDiary) {
      btnMarkDiary.addEventListener('click', () => {
        const today = getTodayString();
        const isCurrentlyMarked = this.store.isDateMarkedInDiary(today);
        const newStatus = !isCurrentlyMarked;

        this.store.setMarkedInDiary(today, newStatus);
        this.renderStats();
        this.renderDiarySheet();
        this.scheduleSync('haziri');
        this.checkEveningBanner();
        // Cancels tonight's OS alarm once the diary is written (or puts it back
        // if the user un-marks the day).
        this.reminderManager.syncScheduledReminders();

        if (newStatus) {
          confetti({
            particleCount: 80,
            spread: 70,
            origin: { y: 0.7 }
          });
        }
      });
    }

    // Copy Diary Text
    const btnCopyDiary = document.getElementById('btnCopyDiaryText');
    if (btnCopyDiary) {
      btnCopyDiary.addEventListener('click', () => {
        this.copyDiaryFormattedText();
      });
    }

    /* Add a site note. Kept next to the diary it belongs to, so a note can be
       typed on the spot rather than only dictated to the assistant. */
    const diaryNote = () => this.addNoteFrom('diaryNoteInput', getTodayString());
    // The attendance box writes to the date on the chip above it.
    const haziriNote = () => this.addNoteFrom('haziriNoteInput', this.selectedHaziriDate || getTodayString());

    document.getElementById('btnAddDiaryNote')?.addEventListener('click', diaryNote);
    document.getElementById('btnAddHaziriNote')?.addEventListener('click', haziriNote);

    // Enter saves too: the keyboard is already open and the thumb is already there.
    document.getElementById('diaryNoteInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); diaryNote(); }
    });
    document.getElementById('haziriNoteInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); haziriNote(); }
    });

    document.addEventListener('click', (e) => {
      const delNote = e.target.closest('[data-delete-note]');
      if (delNote && confirm('यह नोट हटाएँ?')) {
        this.store.deleteSiteNote(delNote.getAttribute('data-delete-note'));
        this.commit('site-note');
      }
    });

    // Print Diary
    const btnPrint = document.getElementById('btnPrintDiary');
    if (btnPrint) {
      btnPrint.addEventListener('click', () => {
        window.print();
      });
    }

    // Settings Modal
    const btnOpenSettings = document.getElementById('btnOpenSettings');
    const btnOpenReminder = document.getElementById('btnOpenReminderSettings');
    const modalSettings = document.getElementById('modalSettings');

    const openSettings = () => {
      this.lendingLock.lock();
      const s = this.store.getSettings();
      document.getElementById('settingReminderTime').value = s.eveningReminderTime || '19:30';
      document.getElementById('settingNotifToggle').checked = s.reminderEnabled !== false;
      document.getElementById('settingSoundToggle').checked = s.soundEnabled !== false;
      const otHoursInput = document.getElementById('settingOtHours');
      if (otHoursInput) otHoursInput.value = s.otHoursPerDay || 8;

      // Tell the user honestly whether the reminder survives closing the app.
      const modeNote = document.getElementById('reminderModeNote');
      if (modeNote) {
        if (this.reminderManager.isNative) {
          this.reminderManager.syncScheduledReminders().then(info => {
            modeNote.textContent = info && info.scheduled > 0
              ? `✅ ऐप बंद होने पर भी रिमाइंडर बजेगा — अगले ${info.scheduled} दिन का अलार्म सेट है।`
              : 'रिमाइंडर के लिए ऊपर "नोटिफिकेशन अनुमति दें" दबाएं।';
          });
        } else {
          modeNote.textContent = 'ब्राउज़र में रिमाइंडर तभी बजेगा जब ऐप खुला हो। ऐप बंद होने पर भी याद दिलाने के लिए APK इंस्टॉल करें।';
        }
      }

      // 1. Populate Worker select in Settings
      const workerSelect = document.getElementById('settingsWorkerSelect');
      if (workerSelect) {
        const workers = this.store.getWorkers();
        if (workers.length === 0) {
          workerSelect.innerHTML = '<option value="">(अभी कोई कारीगर नहीं है)</option>';
        } else {
          workerSelect.innerHTML = workers.map(w => {
            const tr = this.store.getTrade(w.tradeId);
            const roleText = w.role === 'mistri' ? 'मिस्त्री' : 'हेल्पर';
            return `<option value="${esc(w.id)}">${esc(w.name)} — ${getTradeIcon(tr.icon)} ${esc(tr.name)} (${roleText})</option>`;
          }).join('');
        }
      }

      // 2. Populate Trades in Settings
      const tradesPills = document.getElementById('settingsTradesPills');
      if (tradesPills) {
        const trades = this.store.getTrades();
        tradesPills.innerHTML = trades.map(t => {
          const count = this.store.getWorkers(t.id).length;
          return `
            <span class="filter-chip" style="cursor: default; background: rgba(15, 23, 42, 0.063); font-size: 0.8rem; border-color: rgba(15, 23, 42, 0.14); display: inline-flex; align-items: center; gap: 4px;">
              ${getTradeIcon(t.icon)} ${esc(t.name)} <strong style="color: var(--amber-light); margin-left: 2px;">(${count})</strong>
            </span>
          `;
        }).join('');
      }

      // 3. Populate Transaction Types in Settings
      const txPills = document.getElementById('settingsTxTypesPills');
      if (txPills) {
        const builtIn = [
          { id: 'cash', label: '💵 नकद / पेशगी' },
          { id: 'ration', label: '🍚 राशन' },
          { id: 'recharge', label: '📱 रिचार्ज' },
          { id: 'cylinder', label: '🔥 सिलेंडर' },
          { id: 'diesel', label: '⛽ डीजल' },
          { id: 'material', label: '🧱 सामान / मटेरियल' },
          { id: 'other', label: '📝 अन्य' }
        ];
        let customTypes = [];
        try { customTypes = JSON.parse(localStorage.getItem('custom_tx_types') || '[]'); } catch(e) {}
        const allTypes = [...builtIn, ...customTypes.map(c => ({ id: c.id, label: '🏷️ ' + c.label }))];
        txPills.innerHTML = allTypes.map(t => `
          <span class="filter-chip" style="cursor: default; background: rgba(15, 23, 42, 0.063); font-size: 0.8rem; border-color: rgba(15, 23, 42, 0.14);">
            ${t.label}
          </span>
        `).join('');
      }

      // Storage meter — makes the 5MB ceiling visible before writes start failing.
      const usage = this.store.getStorageUsage();
      const usageLabel = document.getElementById('storageUsageLabel');
      const meterFill = document.getElementById('storageMeterFill');
      const usageNote = document.getElementById('storageUsageNote');
      if (usageLabel) usageLabel.textContent = `${usage.readable} / 5 MB (${usage.percent}%)`;
      if (meterFill) {
        meterFill.style.width = `${Math.max(2, usage.percent)}%`;
        meterFill.className = 'storage-meter-fill' +
          (usage.percent > 85 ? ' meter-danger' : usage.percent > 60 ? ' meter-warn' : '');
      }
      if (usageNote) {
        const photos = (this.store.data.workers || []).filter(w => w.photoUrl).length;
        const clips = (this.store.data.transactions || []).filter(t => t.audioDataUrl).length;
        usageNote.textContent = usage.percent > 60
          ? `जगह भर रही है। ${photos} फ़ोटो और ${clips} आवाज़ रिकॉर्डिंग सबसे ज़्यादा जगह लेती हैं — बैकअप फ़ाइल सेव करके पुराने हटा दें।`
          : `${photos} फ़ोटो, ${clips} आवाज़ रिकॉर्डिंग सुरक्षित हैं।`;
      }

      // Populate Firebase Settings UI
      const fbSiteIdInput = document.getElementById('firebaseSiteIdInput');
      if (fbSiteIdInput) fbSiteIdInput.value = s.firebaseSiteId || '';

      const siteIdDisplay = document.getElementById('siteIdDisplay');
      if (siteIdDisplay) siteIdDisplay.textContent = s.firebaseSiteId || '—';

      const fbConfigInput = document.getElementById('firebaseConfigInput');
      if (fbConfigInput) {
        fbConfigInput.value = s.firebaseConfig ? JSON.stringify(s.firebaseConfig, null, 2) : '';
      }

      const fbAutoSyncToggle = document.getElementById('firebaseAutoSyncToggle');
      if (fbAutoSyncToggle) fbAutoSyncToggle.checked = !!s.firebaseAutoSync;

      const fbBadge = document.getElementById('firebaseStatusBadge');
      const fbNote = document.getElementById('firebaseLastSyncNote');
      if (fbBadge) {
        if (isFirebaseReady()) {
          fbBadge.textContent = '🟢 कनेक्टेड (Live)';
          fbBadge.style.background = 'rgba(16, 185, 129, 0.15)';
          fbBadge.style.color = '#34d399';
          if (fbNote && s.lastFirebaseSync) {
            const fbDateStr = new Date(s.lastFirebaseSync).toLocaleDateString('hi-IN', { day: 'numeric', month: 'short' });
            const fbTimeStr = new Date(s.lastFirebaseSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            fbNote.textContent = `अंतिम Firebase सिंक: ${fbDateStr} ${fbTimeStr} पर सुरक्षित किया गया।`;
          }
        } else {
          fbBadge.textContent = '⚪ कनेक्ट नहीं है';
          fbBadge.style.background = 'rgba(15, 23, 42, 0.084)';
          fbBadge.style.color = 'var(--text-muted)';
        }
      }

      // Sync Language Segmented Switcher in Settings Modal
      document.querySelectorAll('#settingsLangSwitcher .segment-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-lang') === this.currentLang);
      });

      modalSettings.classList.add('open');
    };

    if (btnOpenSettings) btnOpenSettings.addEventListener('click', openSettings);
    if (btnOpenReminder) btnOpenReminder.addEventListener('click', openSettings);

    // Language Toggle in Header
    const btnLangToggle = document.getElementById('btnLanguageToggle');
    if (btnLangToggle) {
      btnLangToggle.addEventListener('click', () => {
        this.toggleLanguage();
      });
    }

    // Language Segmented Control in Settings Modal
    document.querySelectorAll('#settingsLangSwitcher .segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const lang = btn.getAttribute('data-lang');
        this.setLanguage(lang);
      });
    });

    // Settings: Worker, Trade & Transaction Type Buttons
    const btnSettingsAddWorker = document.getElementById('btnSettingsAddWorker');
    if (btnSettingsAddWorker) {
      btnSettingsAddWorker.addEventListener('click', () => {
        this.closeModals();
        this.openAddWorkerModal();
      });
    }

    const btnSettingsEditWorker = document.getElementById('btnSettingsEditWorker');
    if (btnSettingsEditWorker) {
      btnSettingsEditWorker.addEventListener('click', () => {
        const workerId = document.getElementById('settingsWorkerSelect')?.value;
        if (!workerId) {
          alert('कृपया पहले कोई कारीगर चुनें!');
          return;
        }
        this.closeModals();
        this.openEditWorkerModal(workerId);
      });
    }

    // Brings back the standard trades a job has lost, without disturbing the
    // ones it still has or the workers inside them.
    document.getElementById('btnRestoreTrades')?.addEventListener('click', () => {
      const added = this.store.restoreDefaultTrades();
      if (added.length === 0) {
        this.showToast('सारे ट्रेड पहले से मौजूद हैं');
        return;
      }
      this.populateSelects();
      this.renderExistingTradesList();
      this.commit();
      this.showToast(added.length + ' ट्रेड वापस आ गए: ' + added.join(', '), 5000);
    });

    const btnSettingsAddTrade = document.getElementById('btnSettingsAddTrade');
    if (btnSettingsAddTrade) {
      btnSettingsAddTrade.addEventListener('click', () => {
        this.closeModals();
        this.openAddTradeModal('modalSettings');
      });
    }

    const btnSettingsAddTxType = document.getElementById('btnSettingsAddTxType');
    if (btnSettingsAddTxType) {
      btnSettingsAddTxType.addEventListener('click', () => {
        const name = prompt('नया लेन-देन प्रकार का नाम लिखें:\n(जैसे: बिजली बिल, चाय-पानी, दवाई, भाड़ा आदि)');
        if (!name || !name.trim()) return;
        const typeName = name.trim();
        const typeId = typeName.toLowerCase().replace(/\s+/g, '_');

        let customTypes = [];
        try { customTypes = JSON.parse(localStorage.getItem('custom_tx_types') || '[]'); } catch(e) {}
        if (!customTypes.find(t => t.id === typeId)) {
          customTypes.push({ id: typeId, label: typeName });
          localStorage.setItem('custom_tx_types', JSON.stringify(customTypes));
        }

        // Add to timeline filter chips if not present
        const timelineFilters = document.getElementById('timelineFilters');
        const btnAddFilter = document.getElementById('btnAddFilterType');
        if (timelineFilters && btnAddFilter && !timelineFilters.querySelector(`[data-filter-type="${typeId}"]`)) {
          const chip = document.createElement('button');
          chip.className = 'filter-chip';
          chip.setAttribute('data-filter-type', typeId);
          chip.textContent = '🏷️ ' + typeName;
          btnAddFilter.parentNode.insertBefore(chip, btnAddFilter);
          chip.addEventListener('click', () => {
            document.querySelectorAll('#timelineFilters .filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            this.activeFilterType = typeId;
            this.renderTimeline();
          });
        }

        // Add to modal txTypeSwitcher
        const txTypeSwitcher = document.getElementById('txTypeSwitcher');
        if (txTypeSwitcher && !txTypeSwitcher.querySelector(`[data-type="${typeId}"]`)) {
          const segBtn = document.createElement('button');
          segBtn.type = 'button';
          segBtn.className = 'segment-btn';
          segBtn.setAttribute('data-type', typeId);
          segBtn.textContent = '🏷️ ' + typeName;
          txTypeSwitcher.appendChild(segBtn);
          segBtn.addEventListener('click', () => {
            document.querySelectorAll('#txTypeSwitcher .segment-btn').forEach(b => b.classList.remove('active'));
            segBtn.classList.add('active');
            this.modalTxType = typeId;
          });
        }

        openSettings();
        alert(`✅ नया लेन-देन प्रकार "${typeName}" जोड़ दिया गया!`);
      });
    }

    // Firebase Connect & Sync Button Handlers
    const btnConnectFb = document.getElementById('btnConnectFirebase');
    if (btnConnectFb) {
      btnConnectFb.addEventListener('click', async () => {
        const cfgStr = document.getElementById('firebaseConfigInput')?.value.trim();
        const siteId = document.getElementById('firebaseSiteIdInput')?.value.trim() || this.store.getSettings().firebaseSiteId;
        if (!cfgStr) {
          alert('कृपया पहले अपना Firebase Web Config JSON पेस्ट करें।\n\nउदा: {"apiKey": "...", "projectId": "...", "appId": "..."}');
          return;
        }
        try {
          let cfg;
          try {
            cfg = await parseFirebaseConfig(cfgStr);
          } catch (e) {
            throw new Error(e.message || 'अमान्य Firebase Config! कृपया Firebase से कॉपी किया गया पूरा कोड पेस्ट करें।');
          }
          btnConnectFb.disabled = true;
          btnConnectFb.textContent = '⏳ कनेक्ट हो रहा है...';

          const ok = await initFirebase(cfg);
          if (!ok) throw new Error('Firebase प्रारंभ करने में त्रुटि आई। कृपया apiKey और projectId जांचें।');

          // Write back clean formatted JSON to input
          const configInput = document.getElementById('firebaseConfigInput');
          if (configInput) configInput.value = JSON.stringify(cfg, null, 2);

          // Save test snapshot
          await saveToFirebase(siteId, this.store.data, this.deviceId);
          this.store.updateSettings({
            firebaseConfig: cfg,
            firebaseSiteId: siteId,
            lastFirebaseSync: Date.now()
          });

          const fbBadge = document.getElementById('firebaseStatusBadge');
          if (fbBadge) {
            fbBadge.textContent = '🟢 कनेक्टेड (Live)';
            fbBadge.style.background = 'rgba(16, 185, 129, 0.15)';
            fbBadge.style.color = '#34d399';
          }

          alert('✅ Google Firebase सफलतापूर्वक कनेक्ट हो गया और साइट डायरी का बैकअप सुरक्षित हो गया!');
        } catch (err) {
          alert('Firebase कनेक्शन त्रुटि: ' + err.message);
        } finally {
          btnConnectFb.disabled = false;
          btnConnectFb.textContent = '🔥 टेस्ट व कनेक्ट करें';
        }
      });
    }

    const btnPushFb = document.getElementById('btnPushToFirebase');
    if (btnPushFb) {
      btnPushFb.addEventListener('click', async () => {
        const siteId = document.getElementById('firebaseSiteIdInput')?.value.trim() || this.store.getSettings().firebaseSiteId;
        if (!isFirebaseReady()) {
          const cfg = this.store.getSettings().firebaseConfig;
          if (cfg) await initFirebase(cfg);
          else {
            alert('कृपया पहले Firebase Config दर्ज करके "टेस्ट व कनेक्ट करें" दबाएं।');
            return;
          }
        }
        btnPushFb.disabled = true;
        btnPushFb.textContent = '⏳ सेव हो रहा है...';
        try {
          await saveToFirebase(siteId, this.store.data, this.deviceId);
          this.store.updateSettings({ lastFirebaseSync: Date.now() });
          alert('✅ पूरा हिसाब Google Firebase पर सफलतापूर्वक सुरक्षित हो गया!');
        } catch (err) {
          alert('Firebase बैकअप विफल: ' + err.message);
        } finally {
          btnPushFb.disabled = false;
          btnPushFb.textContent = '📤 Firebase पर सेव करें';
        }
      });
    }

    const btnPullFb = document.getElementById('btnPullFromFirebase');
    if (btnPullFb) {
      btnPullFb.addEventListener('click', async () => {
        const siteId = document.getElementById('firebaseSiteIdInput')?.value.trim() || this.store.getSettings().firebaseSiteId;
        if (!isFirebaseReady()) {
          const cfg = this.store.getSettings().firebaseConfig;
          if (cfg) await initFirebase(cfg);
          else {
            alert('कृपया पहले Firebase Config दर्ज करें।');
            return;
          }
        }
        if (!confirm('चेतावनी: Firebase से डेटा लाने पर मौजूदा लोकल डेटा बदल जाएगा। क्या आप जारी रखना चाहते हैं?')) {
          return;
        }
        btnPullFb.disabled = true;
        btnPullFb.textContent = '⏳ लोड हो रहा है...';
        try {
          const remoteData = await loadFromFirebase(siteId);
          /* Hand-copying the old top-level fields meant this button could only
             read a pre-projects ledger: against today's cloud copy it found no
             remoteData.workers and refused the restore outright. It now takes
             the same road as a ledger arriving by realtime sync — looksLikeLedger
             accepts both shapes, applyRemoteData normalises, keeps this phone's
             own settings, and refuses to let an empty cloud copy wipe a full
             phone. */
          if (!this.looksLikeLedger(remoteData)) {
            throw new Error('अमान्य डेटा संरचना');
          }
          this.applyRemoteData(remoteData);
          alert('✅ Google Firebase से डेटा सफलतापूर्वक आ गया!');
          location.reload();
        } catch (err) {
          alert('Firebase से डेटा लाना विफल: ' + err.message);
        } finally {
          btnPullFb.disabled = false;
          btnPullFb.textContent = '📥 Firebase से लाएं';
        }
      });
    }

    const formSettings = document.getElementById('formSettings');
    if (formSettings) {
      formSettings.addEventListener('submit', (e) => {
        e.preventDefault();
        const time = document.getElementById('settingReminderTime').value;
        const reminderEnabled = document.getElementById('settingNotifToggle').checked;
        const soundEnabled = document.getElementById('settingSoundToggle').checked;
        const current = this.store.getSettings();
        // Never fall back to the old shared id — that is what made every install
        // write into one another's ledger.
        const firebaseSiteId = document.getElementById('firebaseSiteIdInput')?.value.trim() || current.firebaseSiteId;
        const firebaseAutoSync = document.getElementById('firebaseAutoSyncToggle') ? document.getElementById('firebaseAutoSyncToggle').checked : false;
        const otHoursPerDay = Number(document.getElementById('settingOtHours')?.value) || current.otHoursPerDay || 8;

        const siteChanged = firebaseSiteId !== current.firebaseSiteId;

        this.store.updateSettings({
          eveningReminderTime: time,
          reminderEnabled,
          soundEnabled,
          firebaseSiteId,
          firebaseAutoSync,
          otHoursPerDay
        });

        // Pointing at a different site document means re-subscribing, otherwise
        // this phone keeps listening to (and overwriting) the previous one.
        if (siteChanged || firebaseAutoSync !== current.firebaseAutoSync) {
          this.lastKnownRemoteStamp = 0;
          this.initFirebaseIntegration();
        }

        // A new reminder time or an off switch has to reach the OS alarms too,
        // otherwise the APK keeps buzzing at the old time.
        this.reminderManager.syncScheduledReminders();

        this.closeModals();
        this.renderAll();
        alert('सेटिंग्स सुरक्षित कर दी गई हैं!');
      });
    }

    // Request Notification Permission Button
    const btnReqNotif = document.getElementById('btnRequestNotifPerm');
    if (btnReqNotif) {
      btnReqNotif.addEventListener('click', async () => {
        const res = await this.reminderManager.requestPermission();
        if (res === 'granted') {
          const info = await this.reminderManager.syncScheduledReminders();
          alert(info && info.supported
            ? `✅ रिमाइंडर चालू हो गया!\n\nअगले ${info.scheduled} दिन का अलार्म सेट कर दिया गया है — ऐप बंद हो तब भी बजेगा।`
            : '✅ नोटिफिकेशन चालू हो गया!');
        } else if (res === 'unsupported') {
          alert('इस डिवाइस पर नोटिफिकेशन उपलब्ध नहीं है।');
        } else {
          alert('नोटिफिकेशन की अनुमति नहीं मिली।\n\nफ़ोन की Settings → Apps → श्रम व साइट डायरी → Notifications में जाकर चालू करें।');
        }
      });
    }

    // Test Reminder Chime & Notification Button
    const btnTestReminder = document.getElementById('btnTestReminderNow');
    if (btnTestReminder) {
      btnTestReminder.addEventListener('click', () => {
        this.reminderManager.triggerReminder(true);
      });
    }

    // Data Export & Import
    const btnExport = document.getElementById('btnExportData');
    if (btnExport) {
      btnExport.addEventListener('click', () => this.downloadBackup());
    }

    const btnImport = document.getElementById('btnImportData');
    const fileImport = document.getElementById('fileImportInput');
    if (btnImport && fileImport) {
      btnImport.addEventListener('click', () => fileImport.click());
      fileImport.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        // Restoring replaces the whole ledger. It used to do so without asking.
        if (!confirm('चेतावनी: बैकअप फ़ाइल से डेटा लाने पर इस फ़ोन का मौजूदा पूरा हिसाब बदल जाएगा।\n\nजारी रखें?')) {
          fileImport.value = '';
          return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
          const success = this.store.importData(event.target.result);
          if (success) {
            alert('डेटा सफलतापूर्वक रीस्टोर हो गया!');
            location.reload();
          } else {
            alert('यह फ़ाइल साइट डायरी का बैकअप नहीं लगती।');
          }
        };
        reader.readAsText(file);
        fileImport.value = '';
      });
    }

    /* Erase everything. Irreversible, so: offer the backup first, state the exact
       counts being destroyed, and confirm twice. */
    const btnErase = document.getElementById('btnEraseEverything');
    if (btnErase) {
      btnErase.addEventListener('click', async () => {
        const workers = this.store.getWorkers().length;
        const txs = this.store.getTransactions().length;
        const days = Object.keys(this.store.data.haziri || {}).length;

        if (workers === 0 && txs === 0 && days === 0) {
          alert('मिटाने के लिए कुछ है ही नहीं — हिसाब पहले से खाली है।');
          return;
        }

        if (!confirm(
          `मिटाया जाएगा:\n\n` +
          `• ${workers} कारीगर\n` +
          `• ${txs} लेन-देन\n` +
          `• ${days} दिन की हाजिरी\n\n` +
          `यह फ़ोन और क्लाउड, दोनों से हट जाएगा और वापस नहीं आएगा।\n\n` +
          `आगे बढ़ें?`
        )) return;

        if (confirm('पहले एक बैकअप फ़ाइल सेव कर लें?\n\nOK = बैकअप सेव करें (सुझाव)\nCancel = बिना बैकअप के आगे बढ़ें')) {
          if (!await this.downloadBackup()) return;
          // Give the download a moment before the data it points at disappears.
          await new Promise(r => setTimeout(r, 1200));
        }

        if (!confirm('आख़िरी पुष्टि — सारा हिसाब अभी मिट जाएगा।\n\nमिटाएँ?')) return;

        this.store.eraseAll({ keepTrades: true });

        // Push the empty ledger up, otherwise the cloud keeps the old copy and
        // the next device to sync pulls all of it straight back.
        if (isFirebaseReady()) {
          try {
            await saveToFirebase(this.store.getSettings().firebaseSiteId, this.store.data, this.deviceId);
          } catch (err) {
            alert('फ़ोन से सब हट गया, पर क्लाउड साफ़ नहीं हो सका:\n' + err.message +
                  '\n\nइंटरनेट आने पर ऐप खोलिए, तब अपने आप साफ़ हो जाएगा।');
          }
        }

        this.closeModals();
        this.populateSelects();
        this.commit();
        alert('सब मिटा दिया गया। अब अपने असली कारीगर जोड़ना शुरू कीजिए।');
      });
    }

    // Quick Text Entry (typed input fallback for voice)
    const quickEntryInput = document.getElementById('quickEntryInput');
    const btnQuickEntrySubmit = document.getElementById('btnQuickEntrySubmit');
    if (btnQuickEntrySubmit && quickEntryInput) {
      const submitQuickEntry = () => {
        const text = (quickEntryInput.value || '').trim();
        if (!text) {
          alert('कृपया पहले कुछ लिखें, जैसे: "रमेश 500 नकद" या "10 किलो आटा बढ़ई"');
          return;
        }
        const parsed = this.voiceManager.parseTranscript(text);
        if (parsed) {
          this.openAddTransactionModal(parsed);
          quickEntryInput.value = '';
        } else {
          // If parser can't extract, just open add transaction modal
          this.openAddTransactionModal({});
        }
      };
      btnQuickEntrySubmit.addEventListener('click', submitQuickEntry);
      quickEntryInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitQuickEntry();
        }
      });
    }

    // Voice Dictation Mic Button
    const btnMic = document.getElementById('btnVoiceMic');
    const voiceStatus = document.getElementById('voiceStatusText');
    const voiceTranscriptBox = document.getElementById('voiceTranscriptBox');

    if (btnMic) {
      btnMic.addEventListener('click', () => {
        if (!this.voiceManager.isSupported()) {
          alert('इस ब्राउज़र में बोलकर लिखना उपलब्ध नहीं है।\n\nआप ऊपर दिए गए टेक्स्ट बॉक्स में लिखकर भी जोड़ सकते हैं, जैसे:\n"रमेश 500 नकद" या "10 किलो आटा"');
          return;
        }
        if (this.voiceManager.isListening) {
          this.voiceManager.stopListening();
          btnMic.classList.remove('recording');
          btnMic.textContent = '🎙️';
        } else {
          btnMic.classList.add('recording');
          btnMic.textContent = '⏹️';
          if (voiceTranscriptBox) {
            voiceTranscriptBox.style.display = 'block';
            voiceTranscriptBox.textContent = 'सुन रहा हूँ... बोलिए...';
          }

          this.voiceManager.startListening(
            // On result
            (transcript, isFinal, parsedData, audioDataUrl) => {
              if (voiceTranscriptBox) voiceTranscriptBox.textContent = `"${transcript}"`;
              if (quickEntryInput) quickEntryInput.value = transcript;
              if (isFinal) {
                btnMic.classList.remove('recording');
                btnMic.textContent = '🎙️';
                if (parsedData) {
                  parsedData.audioDataUrl = audioDataUrl;
                  this.openAddTransactionModal(parsedData);
                }
              }
            },
            // On status change
            (isListening, msg) => {
              if (voiceStatus) voiceStatus.textContent = msg;
              if (!isListening) {
                btnMic.classList.remove('recording');
                btnMic.textContent = '🎙️';
              }
            }
          );
        }
      });
    }

    const btnCopySiteId = document.getElementById('btnCopySiteId');
    if (btnCopySiteId) {
      btnCopySiteId.addEventListener('click', async () => {
        const id = this.store.getSettings().firebaseSiteId || '';
        if (!id) return;
        try {
          await navigator.clipboard.writeText(id);
          const original = btnCopySiteId.textContent;
          btnCopySiteId.textContent = '✓ कॉपी हो गई';
          setTimeout(() => { btnCopySiteId.textContent = original; }, 1800);
        } catch {
          // Clipboard is blocked in some WebViews; showing the id is still useful.
          prompt('साइट आईडी कॉपी करें:', id);
        }
      });
    }

    // Firebase Dev Config Toggle (5 taps on Firebase title to reveal API config)
    let fbDevTapCount = 0;
    let fbDevTapTimer = null;
    const fbStatusBadge = document.getElementById('firebaseStatusBadge');
    const fbDevConfig = document.getElementById('firebaseDevConfig');
    if (fbStatusBadge && fbDevConfig) {
      fbStatusBadge.addEventListener('click', () => {
        fbDevTapCount++;
        if (fbDevTapTimer) clearTimeout(fbDevTapTimer);
        fbDevTapTimer = setTimeout(() => { fbDevTapCount = 0; }, 2000);
        if (fbDevTapCount >= 5) {
          fbDevConfig.style.display = fbDevConfig.style.display === 'none' ? 'block' : 'none';
          fbDevTapCount = 0;
        }
      });
    }

    // Auto-hide Clear Demo Section if data is already clean

  }

  /* The add form is one form for two different things. For a trade of workers
     it asks for a role and a daily wage; for a tractor or a JCB neither exists —
     that man owns or drives the vehicle, and what is owed is counted by the
     trolley. Asking a tractor owner for his dihadi is how the form read until
     now, and it made no sense on the one screen where it mattered most. */
  syncWorkerFormToTrade() {
    const tradeId = document.getElementById('workerTradeSelect')?.value;
    const isSupplier = tradeId ? this.store.isSupplierTrade(tradeId) : false;
    const kind = isSupplier ? this.store.getSupplierKind(tradeId) : null;

    const show = (id, on) => {
      const el = document.getElementById(id);
      if (el) el.style.display = on ? '' : 'none';
    };

    show('workerRoleGroup', !isSupplier);
    show('supplierRoleGroup', isSupplier);
    show('dihadiRateGroup', !isSupplier);
    show('supplierTrolleyRatesGroup', isSupplier && kind === 'trolley');
    if (isSupplier) show('thekaDetailsGroup', false);

    // A hidden required field blocks a submit the user cannot see the cause of.
    const rate = document.getElementById('workerDailyRate');
    if (rate) {
      if (isSupplier) rate.removeAttribute('required');
      else rate.setAttribute('required', 'true');
    }

    if (isSupplier) {
      this.modalWorkerRole = this.modalSupplierRole || 'malik';
      this.modalContractType = 'dihadi';
      this.modalIsThekedar = false;
    }

    /* The form still called him a mistri in its own title, its name label and
       its button — the exact words that make no sense on a tractor. */
    const text = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    const trolley = kind === 'trolley';
    text('addWorkerTitle', isSupplier
      ? (trolley ? 'ट्रैक्टर वाला जोड़ें' : 'मशीन वाला जोड़ें')
      : 'नया कारीगर / हेल्पर जोड़ें');
    text('workerNameLabel', isSupplier
      ? 'नाम (Name):'
      : 'कारीगर का नाम (Worker Name):');
    text('btnSubmitAddWorker', isSupplier
      ? (trolley ? 'ट्रैक्टर वाला जोड़ें' : 'मशीन वाला जोड़ें')
      : 'कारीगर जोड़ें (Add Worker)');

    const nameInput = document.getElementById('workerNameInput');
    if (nameInput) {
      nameInput.placeholder = isSupplier
        ? 'जैसे: राम सिंह'
        : 'जैसे: रमेश शर्मा';
    }

    if (isSupplier && trolley) this.renderSupplierRateInputs();
  }

  /** One rate box per material, because reta is not priced like bajri. */
  renderSupplierRateInputs(worker = null) {
    const box = document.getElementById('supplierTrolleyRates');
    if (!box) return;
    box.innerHTML = TROLLEY_MATERIALS.map(mat => `
      <label class="supplier-rate-row">
        <span>${esc(mat.hi)}</span>
        <input type="number" min="0" inputmode="numeric" class="form-input"
               data-supplier-rate="${esc(mat.id)}"
               value="${worker ? (this.store.getTrolleyRate(worker.id, mat.id) || '') : ''}"
               placeholder="₹ / ट्रॉली" />
      </label>
    `).join('');
  }

  /** What was typed into those boxes, as { materialId: rate }. */
  readSupplierRateInputs() {
    const rates = {};
    document.querySelectorAll('[data-supplier-rate]').forEach(input => {
      const value = Number(input.value);
      if (value > 0) rates[input.getAttribute('data-supplier-rate')] = value;
    });
    return rates;
  }

  openAddWorkerModal(tradeId = null) {
    const modal = document.getElementById('modalAddWorker');
    if (!modal) return;
    const select = document.getElementById('workerTradeSelect');
    if (select && tradeId) {
      select.value = tradeId;
    }

    // Reset photo preview
    this.newWorkerPhotoDataUrl = null;
    const workerPhotoInput = document.getElementById('workerPhotoInput');
    const workerPhotoImg = document.getElementById('workerPhotoImg');
    const workerPhotoPlaceholder = document.getElementById('workerPhotoPlaceholder');
    const btnRemovePhoto = document.getElementById('btnRemovePhoto');

    if (workerPhotoInput) workerPhotoInput.value = '';
    if (workerPhotoImg) {
      workerPhotoImg.src = '';
      workerPhotoImg.style.display = 'none';
    }
    if (workerPhotoPlaceholder) workerPhotoPlaceholder.style.display = 'block';
    // Reset contract switcher
    this.modalWorksHimself = true;
    this.modalContractType = 'dihadi';
    document.querySelectorAll('#workerContractSwitcher .segment-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-contract') === 'dihadi');
    });
    const dihadiGroup = document.getElementById('dihadiRateGroup');
    const thekaGroup = document.getElementById('thekaDetailsGroup');
    const dailyRateInput = document.getElementById('workerDailyRate');
    const thekaAmtInput = document.getElementById('workerThekaAmount');
    if (dihadiGroup) dihadiGroup.style.display = 'block';
    if (thekaGroup) thekaGroup.style.display = 'none';
    if (dailyRateInput) dailyRateInput.setAttribute('required', 'true');
    if (thekaAmtInput) thekaAmtInput.removeAttribute('required');

    // A tractor owner gets the tractor's form, not a craftsman's.
    this.modalSupplierRole = 'malik';
    document.querySelectorAll('#workerSupplierRoleSwitcher .segment-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-supplier-role') === 'malik');
    });
    this.syncWorkerFormToTrade();

    modal.classList.add('open');
  }

  copyDiaryFormattedText() {
    const today = getTodayString();
    const txs = this.store.getTransactions(today);
    const haziri = this.store.getHaziri(today);
    const trades = this.store.getTrades();

    let text = `==============================\n`;
    text += `📖 दैनिक साइट डायरी: ${today}\n`;
    text += `==============================\n\n`;

    text += `👷 1. आज की हाजिरी (ATTENDANCE):\n`;
    trades.forEach(t => {
      const workers = this.store.getWorkers(t.id);
      let mCount = 0;
      let hCount = 0;
      workers.forEach(w => {
        const rec = haziri[w.id];
        if (rec && rec.status > 0) {
          if (w.role === 'mistri') mCount += rec.status;
          else hCount += rec.status;
        }
      });
      if (workers.length > 0) {
        text += `- ${t.name}: ${mCount} मिस्त्री, ${hCount} हेल्पर\n`;
      }
    });

    text += `\n💵 2. नकद पेशगी व व्यक्तिगत खर्च:\n`;
    const cashTxs = txs.filter(t => t.type === 'cash' || t.type === 'recharge');
    if (cashTxs.length === 0) {
      text += `- कोई नकद नहीं दिया गया\n`;
    } else {
      cashTxs.forEach(t => {
        const w = this.store.getWorker(t.workerId);
        const wName = w ? `${w.name} (${w.role})` : 'कारीगर';
        const type = t.type === 'recharge' ? 'रिचार्ज' : 'नकद';
        text += `- ${wName}: ₹${t.amount} (${type}${t.note ? ' - ' + t.note : ''})\n`;
      });
    }

    text += `\n🍚 3. ग्रुप राशन व चूल्हा खर्च:\n`;
    const rationTxs = txs.filter(t => t.type === 'ration');
    if (rationTxs.length === 0) {
      text += `- कोई सांझा राशन नहीं\n`;
    } else {
      rationTxs.forEach(t => {
        const tr = this.store.getTrade(t.tradeId);
        text += `- ${tr.name} ग्रुप: ${t.rationItem} ${t.quantity ? '(' + t.quantity + ')' : ''} - ₹${t.amount}\n`;
      });
    }

    // Anything that is neither a worker payment nor ration — diesel, cylinder,
    // material, custom types. These were omitted from the slip's line items while
    // still being added into the total, so the diary never tallied.
    const listedIds = new Set([...cashTxs, ...rationTxs].map(t => t.id));
    const siteTxs = txs.filter(t => !listedIds.has(t.id));
    if (siteTxs.length > 0) {
      text += `\n🧱 4. साइट का अन्य खर्च:\n`;
      siteTxs.forEach(t => {
        const meta = getTxTypeMeta(t.type);
        const where = t.targetType === 'group' ? `${this.store.getTrade(t.tradeId).name} ग्रुप` : (this.store.getWorker(t.workerId)?.name || 'साइट');
        text += `- ${meta.icon} ${meta.hi}${t.quantity ? ' (' + t.quantity + ')' : ''} (${where}): ₹${t.amount}${t.note ? ' - ' + t.note : ''}\n`;
      });
    }

    // Notes last, just above the total: they are read as the day's postscript.
    const notes = this.store.getSiteNotes(today);
    if (notes.length > 0) {
      text += `\n📝 नोट (SITE NOTES):\n`;
      notes.forEach(n => {
        const who = n.workerId ? this.store.getWorker(n.workerId)?.name : null;
        const tag = who ? ` [${who}]` : (n.tradeId ? ` [${this.store.getTrade(n.tradeId).name}]` : '');
        text += `- ${n.time ? n.time + ' ' : ''}${n.text}${tag}\n`;
      });
    }

    const grandTotal = txs.reduce((sum, t) => sum + (t.amount || 0), 0);
    text += `\n------------------------------\n`;
    text += `कुल खर्च (TOTAL): ₹${grandTotal.toLocaleString('en-IN')}\n`;
    text += `==============================\n`;

    navigator.clipboard.writeText(text).then(() => {
      alert('डायरी का हिसाब कॉपी हो गया है! आप इसे व्हाट्सएप या नोट्स में पेस्ट कर सकते हैं।');
    }).catch(() => {
      prompt('कॉपी करने के लिए Ctrl+C दबाएं:', text);
    });
  }

  exportMonthlyMusterRollCsv() {
    const data = this.store.getMonthlyHaziri(this.monthlyYear, this.monthlyMonth);
    let csv = `मासिक मस्टर रोल - ${this.monthlyYear}-${this.monthlyMonth}\n`;
    
    // Header
    const dayHeaders = data.days.map(d => `${d.day} (${d.dayOfWeek})`).join(',');
    csv += `कारीगर,ट्रेड,पद,अनुबंध,${dayHeaders},उपस्थिति (P),गैरहाजिर (A),OT (घंटे),कुल देय (Earned),कुल भुगतान (Paid),शुद्ध बाकी (Due)\n`;

    let grandP = 0;
    let grandA = 0;
    let grandOt = 0;
    let grandEarned = 0;
    let grandPaid = 0;
    let grandDue = 0;

    data.rows.forEach(r => {
      grandP += r.totalPresent;
      grandA += r.totalAbsent;
      grandOt += r.totalOtHours;
      grandEarned += r.totalEarnedMonth;
      grandPaid += r.totalPaidMonth;
      grandDue += r.netBalance;

      const dayValues = data.days.map(d => {
        const rec = r.dailyStatuses[d.dateStr];
        if (!rec) return '';
        if (rec.status === 1.0) return rec.otHours > 0 ? `1+${rec.otHours}h` : '1.0';
        if (rec.status === 0.5) return '0.5';
        if (rec.status === 0) {
          if (!rec.reason) return 'A';
          // A typed reason can hold a comma or a quote, so the cell is quoted
          // and its own quotes doubled — otherwise one reason shifts the row.
          const why = absenceReasonLabel(rec.reason, this.currentLang).replace(/"/g, '""');
          return `"A (${why})"`;
        }
        return '';
      }).join(',');

      const contractStr = r.isTheka ? 'ठेका' : 'दिहाड़ी';
      const roleStr = r.worker.role === 'mistri' ? 'मिस्त्री' : 'हेल्पर';
      csv += `"${r.worker.name}","${r.trade.name}","${roleStr}","${contractStr}",${dayValues},${r.totalPresent},${r.totalAbsent},${r.totalOtHours},${r.totalEarnedMonth},${r.totalPaidMonth},${r.netBalance}\n`;
    });

    // Monthly grand total row
    const dayTotalsCsv = data.days.map(d => {
      let dSum = 0;
      data.rows.forEach(r => {
        const rec = r.dailyStatuses[d.dateStr];
        if (rec && rec.status > 0) dSum += rec.status;
      });
      return dSum;
    }).join(',');

    csv += `"कुल योग (Grand Total)","","","",${dayTotalsCsv},${grandP},${grandA},${grandOt},${grandEarned},${grandPaid},${grandDue}\n`;

    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `muster_roll_${this.monthlyYear}_${String(this.monthlyMonth).padStart(2, '0')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // --- WORKER STATEMENT / PASSBOOK ---
  openWorkerStatementModal(workerId) {
    const worker = this.store.getWorker(workerId);
    if (!worker) return;
    this.activeStatementWorkerId = workerId;

    const modal = document.getElementById('modalWorkerStatement');
    if (!modal) return;

    const trade = this.store.getTrade(worker.tradeId);
    const ledger = this.store.getWorkerLedger(workerId);
    const txs = this.store.getWorkerTransactions(workerId);
    const haziriHistory = this.store.getWorkerHaziriHistory(workerId);

    // Populate Header
    const avatarEl = document.getElementById('statementWorkerAvatar');
    const initials = worker.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    if (avatarEl) {
      if (worker.photoUrl) {
        avatarEl.innerHTML = `<img src="${esc(worker.photoUrl)}" alt="${esc(worker.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />`;
      } else {
        avatarEl.innerHTML = initials;
      }
    }

    const nameEl = document.getElementById('statementWorkerName');
    if (nameEl) nameEl.textContent = `${worker.name} का खाता`;

    const tradeRoleEl = document.getElementById('statementWorkerTradeRole');
    if (tradeRoleEl) {
      tradeRoleEl.textContent = `${trade.name} (${worker.role === 'mistri' ? 'मिस्त्री' : 'हेल्पर'})`;
      tradeRoleEl.className = `tag-badge ${worker.role === 'mistri' ? 'tag-mistri' : 'tag-helper'}`;
    }

    const contractEl = document.getElementById('statementWorkerContract');
    if (contractEl) {
      // "ठेका" alone did not say whether this person holds the contract or works
      // under someone who does — the difference decides whose money this is.
      if (!ledger.isTheka) {
        contractEl.textContent = `👷 दिहाड़ी ₹${worker.dailyRate || 0}/दिन`;
        contractEl.className = 'tag-badge tag-dihadi';
      } else if (worker.isThekedar) {
        contractEl.textContent = `📜 ठेकेदार · ${describeTheka(worker)}`;
        contractEl.className = 'tag-badge tag-thekedar';
      } else {
        contractEl.textContent = '👷 ठेके के अधीन (मजदूरी ठेकेदार देंगे)';
        contractEl.className = 'tag-badge tag-under-theka';
      }
    }

    const phoneEl = document.getElementById('statementWorkerPhone');
    if (phoneEl) {
      phoneEl.textContent = worker.phone ? `📞 ${worker.phone}` : 'फोन नंबर नहीं जुड़ा';
    }

    // Populate KPIs
    const kpiPresent = document.getElementById('statementKpiPresent');
    if (kpiPresent) kpiPresent.textContent = `${ledger.totalHaziriDays} दिन`;

    const kpiAbsent = document.getElementById('statementKpiAbsent');
    if (kpiAbsent) kpiAbsent.textContent = `${ledger.totalAbsentDays} दिन गैरहाजिर`;

    const kpiEarned = document.getElementById('statementKpiEarned');
    if (kpiEarned) kpiEarned.textContent = `₹${ledger.totalEarned.toLocaleString('en-IN')}`;

    const kpiRate = document.getElementById('statementKpiRate');
    if (kpiRate) {
      kpiRate.textContent = ledger.isTheka
        ? `कुल ठेका: ₹${(worker.thekaAmount || 0).toLocaleString('en-IN')}`
        : `दर: ₹${worker.dailyRate}/दिन`;
    }

    const kpiPaid = document.getElementById('statementKpiPaid');
    if (kpiPaid) kpiPaid.textContent = `₹${ledger.totalIndividualGiven.toLocaleString('en-IN')}`;

    const kpiTxCount = document.getElementById('statementKpiTxCount');
    if (kpiTxCount) kpiTxCount.textContent = `${txs.length} बार भुगतान दर्ज`;

    const kpiDue = document.getElementById('statementKpiDue');
    if (kpiDue) {
      kpiDue.textContent = `₹${ledger.balanceDue.toLocaleString('en-IN')}`;
      kpiDue.style.color = ledger.balanceDue >= 0 ? '#10b981' : '#f87171';
    }

    // Payments Table
    const pTableBody = document.getElementById('statementPaymentsTableBody');
    if (pTableBody) {
      if (txs.length === 0) {
        pTableBody.innerHTML = `
          <tr>
            <td colspan="5" style="text-align: center; color: var(--text-dim); padding: 24px;">
              अभी कोई नकद या पेशगी दर्ज नहीं है।
            </td>
          </tr>
        `;
      } else {
        pTableBody.innerHTML = txs.map(t => `
          <tr>
            <td style="white-space: nowrap;">📅 ${t.date} <small style="color:var(--text-dim);">${t.time || ''}</small></td>
            <td>
              <span class="tag-badge ${t.type === 'cash' ? 'tag-dihadi' : 'tag-helper'}">
                ${t.type === 'cash' ? '💵 नकद' : (t.type === 'recharge' ? '📱 रिचार्ज' : t.type)}
              </span>
            </td>
            <td>${t.note || '-'}</td>
            <td style="text-align: right; font-weight: 700; color: #38bdf8;">₹${(t.amount || 0).toLocaleString('en-IN')}</td>
            <td style="text-align: center; white-space: nowrap;">
              <button class="btn-icon-action btn-edit-tx" data-edit-tx="${t.id}" title="सुधारें">✏️</button>
              <button class="btn-icon-action btn-del-tx" data-delete-tx="${t.id}" title="हटाएं">🗑️</button>
            </td>
          </tr>
        `).join('');
      }
    }

    // Haziri Table
    const hTableBody = document.getElementById('statementHaziriTableBody');
    if (hTableBody) {
      if (haziriHistory.length === 0) {
        hTableBody.innerHTML = `
          <tr>
            <td colspan="5" style="text-align: center; color: var(--text-dim); padding: 24px;">
              अभी कोई हाजिरी रिकॉर्ड दर्ज नहीं है।
            </td>
          </tr>
        `;
      } else {
        const hindiDayNames = ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि'];
        hTableBody.innerHTML = haziriHistory.map(h => {
          const d = new Date(h.date);
          const dayName = isNaN(d.getTime()) ? '' : hindiDayNames[d.getDay()];
          let statusBadge = '<span class="tag-badge" style="background:rgba(239,68,68,0.2);color:#f87171;">🔴 गैरहाजिर (A)</span>';
          let dayEarned = 0;
          if (h.status === 1.0) {
            statusBadge = '<span class="tag-badge" style="background:rgba(16,185,129,0.2);color:#34d399;">🟢 पूरा दिन (1.0)</span>';
            dayEarned = worker.dailyRate || 0;
          } else if (h.status === 0.5) {
            statusBadge = '<span class="tag-badge" style="background:rgba(245,158,11,0.2);color:#fbbf24;">🟡 आधा दिन (0.5)</span>';
            dayEarned = (worker.dailyRate || 0) * 0.5;
          }
          if (h.otHours > 0) {
            dayEarned += (h.otHours * ((worker.dailyRate || 0) / 8));
          }

          const earnedDisplay = ledger.isTheka ? 'ठेके में शामिल' : `₹${Math.round(dayEarned).toLocaleString('en-IN')}`;

          return `
            <tr>
              <td style="white-space: nowrap;">📅 ${h.date}</td>
              <td style="color: var(--text-dim);">${dayName}</td>
              <td>${statusBadge}</td>
              <td>${h.otHours > 0 ? `<span style="color:#c084fc; font-weight:600;">+${h.otHours} घंटे</span>` : '-'}</td>
              <td style="text-align: right; font-weight: 700; color: #fbbf24;">${earnedDisplay}</td>
            </tr>
          `;
        }).join('');
      }
    }

    modal.classList.add('open');
  }

  shareWorkerStatementWhatsApp(workerId) {
    const worker = this.store.getWorker(workerId);
    if (!worker) return;

    const ledger = this.store.getWorkerLedger(workerId);
    const trade = this.store.getTrade(worker.tradeId);
    const txs = this.store.getWorkerTransactions(workerId);

    let msg = `*श्रम व साइट डायरी - हिसाब पर्ची*\n`;
    msg += `------------------------------------\n`;
    msg += `👤 *कारीगर:* ${worker.name} (${trade.name})\n`;
    msg += `📋 *पद / अनुबंध:* ${worker.role === 'mistri' ? 'मिस्त्री' : 'हेल्पर'} (${ledger.isTheka ? 'ठेका' : 'दिहाड़ी'})\n`;
    if (ledger.isTheka) {
      msg += `📜 *तय ठेका राशि:* ₹${(worker.thekaAmount || 0).toLocaleString('en-IN')}\n`;
    } else {
      msg += `💵 *दैनिक दिहाड़ी दर:* ₹${worker.dailyRate}/दिन\n`;
    }
    msg += `------------------------------------\n`;
    msg += `✅ *कुल उपस्थिति:* ${ledger.totalHaziriDays} दिन\n`;
    if (ledger.totalAbsentDays > 0) {
      msg += `⚠️ *कुल गैरहाजिरी:* ${ledger.totalAbsentDays} दिन\n`;
    }
    msg += `💰 *कुल देय / तय कमाई:* ₹${ledger.totalEarned.toLocaleString('en-IN')}\n`;
    msg += `💸 *अब तक दिया गया (नकद/पेशगी):* ₹${ledger.totalIndividualGiven.toLocaleString('en-IN')}\n`;
    msg += `------------------------------------\n`;
    msg += `⭐ *शुद्ध बाकी (Balance Due):* ₹${ledger.balanceDue.toLocaleString('en-IN')}\n`;
    msg += `------------------------------------\n`;

    if (txs.length > 0) {
      msg += `\n*हाल ही के भुगतान (Last Payments):*\n`;
      txs.slice(0, 5).forEach(t => {
        msg += `• ${t.date}: ₹${t.amount} (${t.note || (t.type === 'recharge' ? 'रिचार्ज' : 'नकद')})\n`;
      });
    }

    msg += `\n_यह हिसाब 'श्रम व साइट डायरी' ऐप से जारी किया गया है।_\n`;

    const cleanPhone = (worker.phone || '').replace(/[^0-9]/g, '');
    const waUrl = getWhatsAppUrl(worker.phone, msg);
    if (cleanPhone && cleanPhone.length >= 10) {
      window.open(waUrl, '_blank');
    } else {
      navigator.clipboard.writeText(msg).then(() => {
        alert('कारीगर का मोबाइल नंबर नहीं है, इसलिए पूरा हिसाब क्लिपबोर्ड पर कॉपी कर लिया गया है!\n\nआप इसे किसी भी व्हाट्सएप चैट में पेस्ट कर सकते हैं।');
      }).catch(() => {
        prompt('हिसाब कॉपी करने के लिए Ctrl+C दबाएं:', msg);
      });
    }
  }

  openEditWorkerModal(workerId) {
    const worker = this.store.getWorker(workerId);
    if (!worker) return;

    const modal = document.getElementById('modalEditWorker');
    if (!modal) return;

    document.getElementById('editWorkerId').value = worker.id;
    document.getElementById('editWorkerName').value = worker.name;
    document.getElementById('editWorkerPhone').value = worker.phone || '';

    // Populate trade select
    const tradeSelect = document.getElementById('editWorkerTrade');
    if (tradeSelect) {
      tradeSelect.innerHTML = this.store.getTrades().map(t => `
        <option value="${esc(t.id)}" ${t.id === worker.tradeId ? 'selected' : ''}>${esc(t.name)}</option>
      `).join('');
    }

    // Role
    this.editWorkerRole = worker.role || 'mistri';
    document.querySelectorAll('#editWorkerRoleSwitcher .segment-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-role') === this.editWorkerRole);
    });

    // Contract
    this.editWorkerContract = worker.contractType || 'dihadi';
    document.querySelectorAll('#editWorkerContractSwitcher .segment-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-contract') === this.editWorkerContract);
    });

    const dihadiGroup = document.getElementById('editDihadiGroup');
    const thekaGroup = document.getElementById('editThekaGroup');
    const rateInput = document.getElementById('editWorkerDailyRate');
    const thekaAmtInput = document.getElementById('editWorkerThekaAmount');
    const thekaDescInput = document.getElementById('editWorkerThekaDesc');

    if (this.editWorkerContract === 'theka') {
      if (dihadiGroup) dihadiGroup.style.display = 'none';
      if (thekaGroup) thekaGroup.style.display = 'block';
      if (rateInput) rateInput.value = '0';
      if (thekaAmtInput) thekaAmtInput.value = worker.thekaAmount || '';
      if (thekaDescInput) thekaDescInput.value = worker.thekaDescription || '';
    } else {
      if (dihadiGroup) dihadiGroup.style.display = 'block';
      if (thekaGroup) thekaGroup.style.display = 'none';
      if (rateInput) rateInput.value = worker.dailyRate || '';
      if (thekaAmtInput) thekaAmtInput.value = '';
      if (thekaDescInput) thekaDescInput.value = '';
    }

    // Photo
    this.editWorkerPhotoDataUrl = worker.photoUrl || null;
    const photoImg = document.getElementById('editWorkerPhotoImg');
    const placeholder = document.getElementById('editWorkerPhotoPlaceholder');
    const btnRemove = document.getElementById('btnEditRemovePhoto');
    const fileInput = document.getElementById('editWorkerPhotoInput');
    if (fileInput) fileInput.value = '';

    if (this.editWorkerPhotoDataUrl) {
      if (photoImg) {
        photoImg.src = this.editWorkerPhotoDataUrl;
        photoImg.style.display = 'block';
      }
      if (placeholder) placeholder.style.display = 'none';
      if (btnRemove) btnRemove.style.display = 'inline-block';
    } else {
      if (photoImg) {
        photoImg.src = '';
        photoImg.style.display = 'none';
      }
      if (placeholder) placeholder.style.display = 'block';
      if (btnRemove) btnRemove.style.display = 'none';
    }

    modal.classList.add('open');
  }

  openEditTransactionModal(txId) {
    const tx = this.store.getTransaction(txId);
    if (!tx) return;

    const modal = document.getElementById('modalEditTransaction');
    if (!modal) return;

    document.getElementById('editTxId').value = tx.id;
    this.editTxType = tx.type || 'cash';
    this.updateCylinderFields(true);
    document.getElementById('editTxCylinderCount').value = parseInt(tx.quantity, 10) || '';
    document.querySelectorAll('#editTxTypeSwitcher .segment-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-type') === this.editTxType);
    });

    this.editTxTarget = tx.targetType || 'individual';
    document.querySelectorAll('#editTxTargetTypeSwitcher .segment-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-target') === this.editTxTarget);
    });

    // Populate Trade
    const tradeSelect = document.getElementById('editTxTradeSelect');
    if (tradeSelect) {
      tradeSelect.innerHTML = this.store.getTrades().map(t => `
        <option value="${esc(t.id)}" ${t.id === tx.tradeId ? 'selected' : ''}>${esc(t.name)}</option>
      `).join('');
    }

    // Populate Worker
    const populateWorkerSelect = (tradeId, selectedWorkerId) => {
      const workerSelect = document.getElementById('editTxWorkerSelect');
      if (workerSelect) {
        const workers = this.store.getWorkers(tradeId);
        workerSelect.innerHTML = workers.map(w => `
          <option value="${w.id}" ${w.id === selectedWorkerId ? 'selected' : ''}>
            ${esc(w.name)} (${w.role === 'mistri' ? 'मिस्त्री' : 'हेल्पर'})
          </option>
        `).join('');
      }
    };
    populateWorkerSelect(tx.tradeId, tx.workerId);

    const workerSelectGroup = document.getElementById('editTxWorkerSelectGroup');
    if (workerSelectGroup) {
      workerSelectGroup.style.display = this.editTxTarget === 'individual' ? 'block' : 'none';
    }

    // Ration Fields
    const rationFields = document.getElementById('editRationFields');
    if (rationFields) {
      rationFields.style.display = this.editTxType === 'ration' ? 'block' : 'none';
    }
    const rationItemInput = document.getElementById('editTxRationItem');
    if (rationItemInput) rationItemInput.value = tx.rationItem || '';
    const quantityInput = document.getElementById('editTxQuantity');
    if (quantityInput) quantityInput.value = tx.quantity || '';

    // Date & Time
    const dateInput = document.getElementById('editTxDate');
    if (dateInput) dateInput.value = tx.date || getTodayString();
    const timeInput = document.getElementById('editTxTime');
    if (timeInput) timeInput.value = tx.time || '';

    // Amount & Note
    const amtInput = document.getElementById('editTxAmount');
    if (amtInput) amtInput.value = tx.amount || 0;
    const noteInput = document.getElementById('editTxNote');
    if (noteInput) noteInput.value = tx.note || '';

    modal.classList.add('open');
  }
}

// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  // Reachable from the console on the dev server only, so sync behaviour can be
  // exercised by hand. Stripped from the built app.
  if (import.meta.env?.DEV) window.__app = app;

  // Clear any pattern attributes globally to prevent any browser format errors
  const clearPatterns = () => {
    document.querySelectorAll('input[pattern]').forEach(el => el.removeAttribute('pattern'));
    const p1 = document.getElementById('workerPhone');
    if (p1) p1.removeAttribute('pattern');
    const p2 = document.getElementById('editWorkerPhone');
    if (p2) p2.removeAttribute('pattern');
  };
  clearPatterns();
  setInterval(clearPatterns, 1000);

  // Register Service Worker for Offline & PWA support with auto-update
  // Only in a real build. In dev the worker's cache-first asset strategy serves
  // stale CSS/JS after every edit, which looks exactly like a broken change.
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('./sw.js?v=5').then((reg) => {
      console.log('Site Diary Service Worker registered:', reg.scope);
      reg.update();
    }).catch((err) => {
      console.log('Service Worker registration failed:', err);
    });
  } else if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
  }

  // Handle PWA Install Prompt
  let deferredPrompt;
  const btnInstall = document.getElementById('btnInstallApp');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (btnInstall) {
      btnInstall.style.display = 'inline-flex';
      btnInstall.onclick = async () => {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          const choice = await deferredPrompt.userChoice;
          if (choice.outcome === 'accepted') {
            btnInstall.style.display = 'none';
          }
          deferredPrompt = null;
        }
      };
    }
  });

  window.addEventListener('appinstalled', () => {
    if (btnInstall) btnInstall.style.display = 'none';
    console.log('Site Diary installed successfully!');
  });
});

