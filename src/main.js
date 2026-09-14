// src/main.js
// Main Application Controller for Shram & Site Diary

import { store, getTodayString } from './storage.js';
import { VoiceManager } from './speech.js';
import { ReminderManager } from './reminder.js';
import confetti from 'canvas-confetti';
import { initFirebase, isFirebaseReady, saveToFirebase, loadFromFirebase, enableRealtimeSync, parseFirebaseConfig } from './firebase.js';
import { translations } from './i18n.js';

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

class App {
  constructor() {
    this.store = store;
    this.currentTab = 'tab-timeline';
    this.activeFilterType = 'all';
    this.activeFilterTrade = null;
    this.selectedHaziriDate = getTodayString();

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

    this.init();
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
    this.bindEvents();
    this.populateSelects();
    this.applyLanguage(this.currentLang, false);
    this.renderAll();
    this.startClock();
    this.checkEveningBanner();
    this.initFirebaseIntegration();
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

  initFirebaseIntegration() {
    const s = this.store.getSettings();
    if (s.firebaseConfig) {
      try {
        const ok = initFirebase(s.firebaseConfig);
        if (ok && s.firebaseAutoSync) {
          enableRealtimeSync(s.firebaseSiteId || 'khalen-dairy', (remoteData) => {
            console.log('Realtime sync from Firebase received');
          });
        }
      } catch (err) {
        console.warn('Firebase init on start failed:', err);
      }
    }
  }

  triggerFirebaseAutoSync() {
    const s = this.store.getSettings();
    if (s.firebaseAutoSync && isFirebaseReady()) {
      const siteId = s.firebaseSiteId || 'khalen-dairy';
      saveToFirebase(siteId, this.store.data).catch(e => console.warn('AutoSync error:', e));
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
    this.checkEveningBanner();
    this.triggerFirebaseAutoSync();
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

    // Cash
    const cashTotal = txs
      .filter(t => t.type === 'cash')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    const statCashEl = document.getElementById('statTodayCash');
    if (statCashEl) statCashEl.textContent = `₹${cashTotal.toLocaleString('en-IN')}`;

    // Ration
    const rationTotal = txs
      .filter(t => t.type === 'ration')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    const statRationEl = document.getElementById('statTodayRation');
    if (statRationEl) statRationEl.textContent = `₹${rationTotal.toLocaleString('en-IN')}`;

    // Overview Today Total
    const todayTotal = cashTotal + rationTotal;
    const overviewTotalEl = document.getElementById('overviewTodayTotalDisplay');
    if (overviewTotalEl) overviewTotalEl.textContent = `₹${todayTotal.toLocaleString('en-IN')}`;

    // Haziri count
    let workerCount = 0;
    Object.values(haziri).forEach(h => {
      if (h.status > 0) workerCount += 1;
    });
    const statHaziriEl = document.getElementById('statTodayHaziri');
    if (statHaziriEl) statHaziriEl.textContent = `${workerCount} लोग`;

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

      let icon = '💵';
      let iconBg = 'rgba(16, 185, 129, 0.15)';
      let amountClass = 'cash';

      if (tx.type === 'ration') {
        icon = '🍚';
        iconBg = 'rgba(245, 158, 11, 0.15)';
        amountClass = 'ration';
      } else if (tx.type === 'recharge') {
        icon = '📱';
        iconBg = 'rgba(56, 189, 248, 0.15)';
        amountClass = 'recharge';
      }

      const roleBadge = worker
        ? `<span class="tag-badge ${worker.role === 'mistri' ? 'tag-mistri' : 'tag-helper'}">${worker.role === 'mistri' ? 'मिस्त्री' : 'हेल्पर'}</span>`
        : `<span class="tag-badge tag-group">ग्रुप (सांझा)</span>`;

      const targetDisplayName = isGroup
        ? `${trade.name} (सांझा ग्रुप)`
        : (worker ? worker.name : 'Unknown Worker');

      return `
        <div class="tx-card" data-tx-id="${tx.id}">
          <div class="tx-left">
            <div class="tx-icon-badge" style="background: ${iconBg};">
              ${icon}
            </div>
            <div class="tx-info">
              <div class="tx-target-row">
                <span class="tx-target-name">${targetDisplayName}</span>
                ${roleBadge}
                <span style="font-size: 0.76rem; color: var(--text-dim);">${trade.name}</span>
              </div>
              ${tx.rationItem ? `<div style="font-size: 0.85rem; font-weight: 600; color: var(--amber-light);">${tx.rationItem} ${tx.quantity ? `(${tx.quantity})` : ''}</div>` : ''}
              ${tx.note ? `<div class="tx-note">${tx.note}</div>` : ''}
              <div class="tx-meta">
                <span>📅 ${tx.date}</span>
                <span>🕒 ${tx.time}</span>
                ${tx.audioDataUrl ? `<span>• <button class="btn-audio-play" data-audio="${tx.audioDataUrl}" style="background:none;border:none;color:var(--amber-primary);cursor:pointer;font-size:0.76rem;">▶ आवाज सुनें</button></span>` : ''}
              </div>
            </div>
          </div>
          <div class="tx-right">
            <div class="tx-amount ${amountClass}">₹${(tx.amount || 0).toLocaleString('en-IN')}</div>
            ${tx.quantity && tx.type === 'ration' ? `<span class="tx-item-qty">${tx.quantity}</span>` : ''}
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
    const container = document.getElementById('haziriTradesContainer');
    if (!container) return;

    const date = this.selectedHaziriDate || getTodayString();
    const trades = this.store.getTrades();
    const haziriRecord = this.store.getHaziri(date);

    const datePicker = document.getElementById('haziriDatePicker');
    if (datePicker && !datePicker.value) {
      datePicker.value = date;
    }

    const allWorkers = this.store.getWorkers();
    if (allWorkers.length === 0) {
      container.innerHTML = `
        <div style="background: rgba(245, 158, 11, 0.08); border: 2px dashed rgba(245, 158, 11, 0.35); border-radius: 14px; padding: 40px 20px; text-align: center; margin: 20px 0;">
          <div style="font-size: 3rem; margin-bottom: 12px;">👷‍♂️</div>
          <h3 style="font-size: 1.25rem; font-weight: 700; color: #fff; margin-bottom: 8px;">अभी आपकी साइट पर कोई कारीगर नहीं जुड़ा है</h3>
          <p style="font-size: 0.88rem; color: var(--text-muted); max-width: 480px; margin: 0 auto 20px;">
            हाजिरी और हिसाब शुरू करने के लिए नीचे दिए गए बटन पर टैप करके अपने मिस्त्री, हेल्पर या ठेकेदार को जोड़ें।
          </p>
          <button class="btn-primary btn-add-first-worker" style="font-size: 0.95rem; padding: 12px 28px;">
            👷 + पहला कारीगर जोड़ें (Add Worker)
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = trades.map(trade => {
      const workers = this.store.getWorkers(trade.id);
      if (workers.length === 0) return '';

      const mistris = workers.filter(w => w.role === 'mistri');
      const helpers = workers.filter(w => w.role === 'helper');

      const renderWorkerRow = (worker) => {
        const record = haziriRecord[worker.id] || { status: 0, otHours: 0 };
        const status = record.status;
        const initials = worker.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

        const avatarHtml = worker.photoUrl
          ? `<div class="worker-avatar"><img src="${worker.photoUrl}" alt="${worker.name}" /></div>`
          : `<div class="worker-avatar">${initials}</div>`;

        const contactPills = worker.phone
          ? `
            <span class="contact-quick-pills">
              <a href="${getPhoneDialerHref(worker.phone)}" class="btn-contact-pill btn-pill-call" title="कॉल करें">📞 ${worker.phone}</a>
              <a href="${getWhatsAppUrl(worker.phone)}" target="_blank" class="btn-contact-pill btn-pill-wa" title="व्हाट्सएप">💬 चैट</a>
            </span>
          `
          : '';

        const contractBadge = worker.contractType === 'theka'
          ? `<span class="tag-badge tag-theka">📜 ठेका</span>`
          : `<span class="tag-badge tag-dihadi">👷 दिहाड़ी</span>`;

        const rateOrThekaLine = worker.contractType === 'theka'
          ? `<span>📜 ठेका: ₹${(worker.thekaAmount || 0).toLocaleString('en-IN')} ${worker.thekaDescription ? `(${worker.thekaDescription})` : ''} • <strong style="color:#d8b4fe;">उपस्थिति रिकॉर्ड</strong></span>`
          : `<span>दर: ₹${worker.dailyRate}/दिन</span>`;

        return `
          <div class="worker-haziri-row" data-worker-id="${worker.id}">
            <div class="worker-identity">
              ${avatarHtml}
              <div>
                <div class="worker-name-line">
                  ${worker.name}
                  <span class="tag-badge ${worker.role === 'mistri' ? 'tag-mistri' : 'tag-helper'}">
                    ${worker.role === 'mistri' ? 'मिस्त्री' : 'हेल्पर'}
                  </span>
                  ${contractBadge}
                  <button type="button" class="btn-worker-mini-edit" data-open-edit-worker="${worker.id}" title="कारीगर में सुधार करें (ट्रेड, नाम, दर बदलें)" style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 4px; color: var(--amber-light); font-size: 0.74rem; font-weight: 600; padding: 2px 7px; cursor: pointer; margin-left: 6px; display: inline-flex; align-items: center; gap: 2px;">
                    ✏️ सुधारें
                  </button>
                </div>
                <div class="worker-rate-line">
                  ${rateOrThekaLine}
                  ${contactPills}
                </div>
              </div>
            </div>
            <div class="haziri-buttons-group">
              <button type="button" class="btn-hz-toggle ${status === 1.0 ? 'active-full' : ''}" data-hz-val="1.0" data-worker="${worker.id}" title="पूरी हाजिरी">
                1.0 Full
              </button>
              <button type="button" class="btn-hz-toggle ${status === 0.5 ? 'active-half' : ''}" data-hz-val="0.5" data-worker="${worker.id}" title="आधी हाजिरी">
                0.5 Half
              </button>
              <button type="button" class="btn-hz-toggle ${status === 0 ? 'active-absent' : ''}" data-hz-val="0" data-worker="${worker.id}" title="गैरहाजिर">
                0 Absent
              </button>
              <button type="button" class="btn-hz-toggle ${record.otHours > 0 ? 'active-ot' : ''}" data-hz-ot="${worker.id}" title="ओवरटाइम दर्ज करें">
                ${record.otHours > 0 ? `+${record.otHours}h OT` : '+OT'}
              </button>
            </div>
          </div>
        `;
      };

      return `
        <div class="haziri-trade-section">
          <div class="trade-header-row">
            <div class="trade-title">
              <span>${getTradeIcon(trade.icon)}</span>
              <span>${trade.name}</span>
            </div>
            <span style="font-size: 0.82rem; color: var(--text-muted);">
              कुल ${workers.length} (मिस्त्री: ${mistris.length}, हेल्पर: ${helpers.length})
            </span>
          </div>

          ${mistris.length > 0 ? `
            <div class="role-subgroup">
              <div class="role-subgroup-title">
                <span>👑 मिस्त्री (Masters / Mistris)</span>
              </div>
              ${mistris.map(renderWorkerRow).join('')}
            </div>
          ` : ''}

          ${helpers.length > 0 ? `
            <div class="role-subgroup">
              <div class="role-subgroup-title">
                <span>🤝 हेल्पर (Helpers / Mazdoors)</span>
              </div>
              ${helpers.map(renderWorkerRow).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
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
          <h3 style="font-size: 1.25rem; font-weight: 700; color: #fff; margin-bottom: 8px;">मस्टर रोल अभी खाली है</h3>
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
        ? `<div class="worker-avatar" style="width: 26px; height: 26px; border-radius: 6px;"><img src="${w.photoUrl}" alt="${w.name}" /></div>`
        : `<div class="worker-avatar" style="width: 26px; height: 26px; border-radius: 6px; font-size: 0.7rem;">${initials}</div>`;

      const contractBadge = row.isTheka
        ? `<span class="tag-badge tag-theka" style="font-size:0.65rem;padding:1px 5px;">📜 ठेका</span>`
        : `<span class="tag-badge tag-dihadi" style="font-size:0.65rem;padding:1px 5px;">👷 दिहाड़ी</span>`;

      const daysCellsHtml = data.days.map(d => {
        const record = row.dailyStatuses[d.dateStr];
        let cellContent = '·';
        let cellClass = 'cell-hz-empty';

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
          }
        }

        const tdClass = d.isSunday ? 'td-sunday' : '';
        return `
          <td class="${tdClass}">
            <span class="muster-cell ${cellClass}" data-matrix-worker="${w.id}" data-matrix-date="${d.dateStr}" title="${w.name} (${d.dateStr}): क्लिक करके हाजिरी बदलें">
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
                <div style="font-weight: 700; color: #fff; font-size: 0.82rem; white-space: nowrap; display: flex; align-items: center; gap: 4px;">
                  <span>${w.name}</span>
                  ${contractBadge}
                  <button type="button" data-open-edit-worker="${w.id}" title="कारीगर में सुधार करें (ट्रेड, नाम बदलें)" style="background: none; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; color: var(--amber-light); cursor: pointer; font-size: 0.72rem; padding: 1px 4px;">✏️</button>
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
          ? `<div class="worker-avatar" style="width: 32px; height: 32px; border-radius: 8px;"><img src="${w.photoUrl}" alt="${w.name}" /></div>`
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
                    <strong style="color: #fff; text-decoration: underline dotted var(--amber-primary);">${w.name}</strong>
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
              <span>${trade.name}</span>
            </div>
            <span style="font-size: 0.8rem; color: var(--text-muted);">
              ${workers.length} कारीगर
            </span>
          </div>

          <!-- Group Ration Box -->
          <div class="group-ration-summary">
            <div class="group-ration-title">
              <span>🍚 ग्रुप राशन व सामान खर्च:</span>
              <strong style="color: #fff; margin-left: auto;">₹${groupData.totalGroupRationCost.toLocaleString('en-IN')}</strong>
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
            <span><strong>${trade.name}:</strong></span>
            <span>${attendanceStr}</span>
          </div>
        `;
      }).join('');
    }

    // 3. Cash & Recharge Table
    const cashTxs = txs.filter(t => t.type === 'cash' || t.type === 'recharge');
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
          const typeName = t.type === 'recharge' ? 'मोबाइल रिचार्ज' : 'नकद पेशगी';
          const noteText = t.note ? ` - ${t.note}` : '';

          return `
            <tr>
              <td><strong>${worker ? worker.name : 'Unknown'}</strong></td>
              <td>${trade.name} (${roleText})${contractText}</td>
              <td>${typeName}${noteText}</td>
              <td style="text-align: right; font-weight: 700; color: #047857;">₹${(t.amount || 0).toLocaleString('en-IN')}</td>
            </tr>
          `;
        }).join('');
      }
    }

    // 4. Ration Table
    const rationTxs = txs.filter(t => t.type === 'ration');
    const rationBody = document.getElementById('diaryRationTableBody');
    if (rationBody) {
      if (rationTxs.length === 0) {
        rationBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #94a3b8; font-style: italic;">आज कोई सांझा राशन नहीं मंगाया गया</td></tr>`;
      } else {
        rationBody.innerHTML = rationTxs.map(t => {
          const trade = this.store.getTrade(t.tradeId);
          return `
            <tr>
              <td><strong>${trade.name} ग्रुप</strong></td>
              <td>${t.rationItem || 'राशन'} ${t.quantity ? `(${t.quantity})` : ''}</td>
              <td>${t.note || '-'}</td>
              <td style="text-align: right; font-weight: 700; color: #b45309;">₹${(t.amount || 0).toLocaleString('en-IN')}</td>
            </tr>
          `;
        }).join('');
      }
    }

    // 5. Grand Total
    const grandTotal = txs.reduce((sum, t) => sum + (t.amount || 0), 0);
    const grandTotalEl = document.getElementById('diaryGrandTotalVal');
    if (grandTotalEl) {
      grandTotalEl.textContent = `₹${grandTotal.toLocaleString('en-IN')}`;
    }

    // 6. Marked button status
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

  // --- FORM HELPERS & POPULATION ---
  populateSelects() {
    const trades = this.store.getTrades();
    const tradeSelect = document.getElementById('txTradeSelect');
    const workerTradeSelect = document.getElementById('workerTradeSelect');
    const editWorkerTrade = document.getElementById('editWorkerTrade');
    const editTxTradeSelect = document.getElementById('editTxTradeSelect');

    const optionsHtml = trades.map(t => `<option value="${t.id}">${getTradeIcon(t.icon)} ${t.name}</option>`).join('');

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
      return `<option value="${w.id}">${w.name} (${roleText}) - दर: ₹${w.dailyRate}</option>`;
    }).join('');
  }

  openAddTransactionModal(preset = {}) {
    const modal = document.getElementById('modalAddTransaction');
    if (!modal) return;

    // Reset or preset
    this.modalTxType = preset.type || 'cash';
    this.modalTargetType = preset.targetType || (preset.type === 'ration' ? 'group' : 'individual');

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
          <span>${getTradeIcon(t.icon)} ${t.name}</span>
          <span class="worker-badge-count">${workerCount} कारीगर</span>
          ${workerCount === 0 ? `<button type="button" class="btn-del-custom-trade" data-del-trade-id="${t.id}" title="ट्रेड हटाएं">✕</button>` : ''}
        </div>
      `;
    }).join('');
  }

  // --- EVENT BINDINGS ---
  bindEvents() {
    // Navigation Tabs
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-tab');
        document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));
        btn.classList.add('active');
        const targetView = document.getElementById(tabId);
        if (targetView) targetView.classList.add('active');
        this.currentTab = tabId;

        if (tabId === 'tab-monthly') {
          this.renderMonthlyHaziri();
        }
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
        const haziriTab = document.querySelector('.nav-tab-btn[data-tab="tab-haziri"]');
        if (haziriTab) haziriTab.click();
      });
    }

    const pillDiary = document.getElementById('statTodayDiaryStatus');
    if (pillDiary) {
      pillDiary.addEventListener('click', () => {
        const diaryTab = document.querySelector('.nav-tab-btn[data-tab="tab-diary"]');
        if (diaryTab) diaryTab.click();
      });
    }

    const btnQuickHaziri = document.getElementById('btnQuickHaziri');
    if (btnQuickHaziri) {
      btnQuickHaziri.addEventListener('click', () => {
        document.querySelector('.nav-tab-btn[data-tab="tab-haziri"]').click();
      });
    }

    const btnQuickMonthly = document.getElementById('btnQuickMonthly');
    if (btnQuickMonthly) {
      btnQuickMonthly.addEventListener('click', () => {
        document.querySelector('.nav-tab-btn[data-tab="tab-monthly"]').click();
      });
    }

    const btnSwitchToMonthlyTab = document.getElementById('btnSwitchToMonthlyTab');
    if (btnSwitchToMonthlyTab) {
      btnSwitchToMonthlyTab.addEventListener('click', () => {
        document.querySelector('.nav-tab-btn[data-tab="tab-monthly"]').click();
      });
    }

    const btnFillDemoMonth = document.getElementById('btnFillDemoMonth');
    if (btnFillDemoMonth) {
      btnFillDemoMonth.addEventListener('click', () => {
        // Populate September days
        const d = new Date();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const workers = this.store.getWorkers();

        for (let day = 1; day <= 30; day++) {
          const dayStr = String(day).padStart(2, '0');
          const dateKey = `${year}-${month}-${dayStr}`;
          const dayOfWeek = new Date(year, d.getMonth(), day).getDay();

          if (!this.store.data.haziri[dateKey]) {
            this.store.data.haziri[dateKey] = {};
          }

          workers.forEach((w, idx) => {
            if (dayOfWeek === 0) {
              this.store.data.haziri[dateKey][w.id] = { status: 0, otHours: 0 };
            } else {
              const isHalf = (day + idx) % 7 === 0;
              const isAbsent = (day + idx) % 9 === 0;
              const ot = (day + idx) % 5 === 0 ? 1 : 0;
              const status = isAbsent ? 0 : (isHalf ? 0.5 : 1.0);
              this.store.data.haziri[dateKey][w.id] = { status, otHours: ot };
            }
          });
        }
        this.store.save();
        this.renderAll();
        alert('पूरे सितम्बर महीने की 1 से 30 तारीख की हाजिरी सफलतापूर्वक भर दी गई है!');
      });
    }

    const btnQuickDiary = document.getElementById('btnQuickDiary');
    if (btnQuickDiary) {
      btnQuickDiary.addEventListener('click', () => {
        document.querySelector('.nav-tab-btn[data-tab="tab-diary"]').click();
      });
    }

    const btnBannerOpen = document.getElementById('btnEveningBannerOpen');
    if (btnBannerOpen) {
      btnBannerOpen.addEventListener('click', () => {
        document.querySelector('.nav-tab-btn[data-tab="tab-diary"]').click();
      });
    }

    // Modal Transaction Type Switcher
    document.querySelectorAll('#txTypeSwitcher .segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#txTypeSwitcher .segment-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.modalTxType = btn.getAttribute('data-type');

        const rationFields = document.getElementById('rationFields');
        const targetTypeGroup = document.getElementById('targetTypeGroup');
        const workerSelectGroup = document.getElementById('workerSelectGroup');

        if (this.modalTxType === 'ration') {
          rationFields.style.display = 'block';
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
        this.renderAll();
      });
    }

    // Delete Transaction
    document.addEventListener('click', (e) => {
      const delBtn = e.target.closest('[data-delete-tx]');
      if (delBtn) {
        const txId = delBtn.getAttribute('data-delete-tx');
        if (confirm('क्या आप इस लेन-देन को हटाना चाहते हैं?')) {
          this.store.deleteTransaction(txId);
          this.renderAll();
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
        this.renderTimeline();
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
          this.renderAll();
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
        this.renderAll();
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
          this.renderAll();
        }
      });
    }

    // Edit Transaction Type & Target Switchers
    document.querySelectorAll('#editTxTypeSwitcher .segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#editTxTypeSwitcher .segment-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.editTxType = btn.getAttribute('data-type');
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
            <option value="${w.id}">${w.name} (${w.role === 'mistri' ? 'मिस्त्री' : 'हेल्पर'})</option>
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
        const quantity = this.editTxType === 'ration' ? document.getElementById('editTxQuantity').value : '';

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
        this.renderAll();
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
          this.renderAll();
          if (this.activeStatementWorkerId) {
            this.openWorkerStatementModal(this.activeStatementWorkerId);
          }
        }
      });
    }

    // Cloud Sync Buttons in Settings
    const btnGenKey = document.getElementById('btnGenerateSyncKey');
    if (btnGenKey) {
      btnGenKey.addEventListener('click', () => {
        const newKey = this.store.generateSyncKey();
        const keyInput = document.getElementById('settingCloudSyncKey');
        if (keyInput) keyInput.value = newKey;
      });
    }

    const btnPushCloud = document.getElementById('btnPushToCloud');
    if (btnPushCloud) {
      btnPushCloud.addEventListener('click', async () => {
        const keyInput = document.getElementById('settingCloudSyncKey');
        let key = keyInput ? keyInput.value.trim() : '';
        if (!key) {
          key = this.store.generateSyncKey();
          if (keyInput) keyInput.value = key;
        }
        btnPushCloud.disabled = true;
        btnPushCloud.textContent = '⏳ सेव हो रहा है...';
        try {
          await this.store.pushToCloud(key);
          alert(`✅ डेटा क्लाउड पर सफलतापूर्वक सुरक्षित हो गया!\n\nआपकी सिंक की (Sync Key): ${key}\n\nइसे संभाल कर रखें, दूसरे फोन में यही की डालकर अपना खाता पा सकते हैं।`);
          const badge = document.getElementById('cloudSyncStatusBadge');
          if (badge) {
            badge.textContent = `सिंक: अभी`;
            badge.style.background = 'rgba(16, 185, 129, 0.15)';
            badge.style.color = '#34d399';
          }
        } catch (err) {
          alert('क्लाउड सेव विफल: ' + err.message);
        } finally {
          btnPushCloud.disabled = false;
          btnPushCloud.textContent = '📤 क्लाउड पर सेव करें';
        }
      });
    }

    const btnPullCloud = document.getElementById('btnPullFromCloud');
    if (btnPullCloud) {
      btnPullCloud.addEventListener('click', async () => {
        const keyInput = document.getElementById('settingCloudSyncKey');
        const key = keyInput ? keyInput.value.trim() : '';
        if (!key) {
          alert('कृपया अपनी सिंक की (Sync Key) दर्ज करें!');
          return;
        }
        if (!confirm('चेतावनी: क्लाउड से डेटा लाने पर मौजूदा लोकल डेटा बदल जाएगा। क्या आप जारी रखना चाहते हैं?')) {
          return;
        }
        btnPullCloud.disabled = true;
        btnPullCloud.textContent = '⏳ लोड हो रहा है...';
        try {
          await this.store.pullFromCloud(key);
          alert('✅ क्लाउड से डेटा सफलतापूर्वक आ गया!');
          location.reload();
        } catch (err) {
          alert('क्लाउड से डेटा लाना विफल: ' + err.message);
        } finally {
          btnPullCloud.disabled = false;
          btnPullCloud.textContent = '📥 क्लाउड से लाएं';
        }
      });
    }

    // Haziri Date Picker
    const haziriDate = document.getElementById('haziriDatePicker');
    if (haziriDate) {
      haziriDate.value = this.selectedHaziriDate;
      haziriDate.addEventListener('change', (e) => {
        this.selectedHaziriDate = e.target.value;
        this.renderHaziri();
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

          this.store.setWorkerHaziri(dateStr, workerId, nextVal, 0);
          this.renderMonthlyHaziri();
          this.renderHaziri();
          this.renderStats();
          this.renderDiarySheet();
        }
      });

      // Daily Haziri Attendance Toggle Buttons (1.0, 0.5, 0, OT)
      document.addEventListener('click', (e) => {
        const hzBtn = e.target.closest('.btn-hz-toggle');
        if (hzBtn && hzBtn.hasAttribute('data-hz-val')) {
          const workerId = hzBtn.getAttribute('data-worker');
          const val = Number(hzBtn.getAttribute('data-hz-val'));
          const date = this.selectedHaziriDate || getTodayString();
          const currentRecord = this.store.getHaziri(date)[workerId] || { status: 0, otHours: 0 };

          this.store.setWorkerHaziri(date, workerId, val, currentRecord.otHours);
          this.renderHaziri();
          this.renderMonthlyHaziri();
          this.renderStats();
          this.renderDiarySheet();
        }

        // Overtime Prompt
        if (hzBtn && hzBtn.hasAttribute('data-hz-ot')) {
          const workerId = hzBtn.getAttribute('data-hz-ot');
          const date = this.selectedHaziriDate || getTodayString();
          const currentRecord = this.store.getHaziri(date)[workerId] || { status: 1.0, otHours: 0 };
          const otInput = prompt('ओवरटाइम घंटे (Overtime Hours) दर्ज करें:', currentRecord.otHours || '1');
          if (otInput !== null) {
            const ot = parseFloat(otInput) || 0;
            this.store.setWorkerHaziri(date, workerId, currentRecord.status || 1.0, ot);
            this.renderHaziri();
            this.renderMonthlyHaziri();
            this.renderStats();
            this.renderDiarySheet();
          }
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

    const btnAddWorkerFromHz = document.getElementById('btnAddWorkerFromHaziri');
    if (btnAddWorkerFromHz) btnAddWorkerFromHz.addEventListener('click', () => this.openAddWorkerModal());

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
          if (thekaAmtInput) thekaAmtInput.setAttribute('required', 'true');
        } else {
          if (dihadiGroup) dihadiGroup.style.display = 'block';
          if (thekaGroup) thekaGroup.style.display = 'none';
          if (dailyRateInput) dailyRateInput.setAttribute('required', 'true');
          if (thekaAmtInput) thekaAmtInput.removeAttribute('required');
        }
      });
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
        const dailyRate = this.modalContractType === 'dihadi' ? (Number(document.getElementById('workerDailyRate').value) || 0) : 0;
        const thekaAmount = this.modalContractType === 'theka' ? (Number(document.getElementById('workerThekaAmount').value) || 0) : 0;
        const thekaDescription = document.getElementById('workerThekaDesc') ? document.getElementById('workerThekaDesc').value : '';
        const phone = (document.getElementById('workerPhone').value || '').trim();

        this.store.addWorker({
          name,
          tradeId,
          role: this.modalWorkerRole,
          contractType: this.modalContractType,
          dailyRate,
          thekaAmount,
          thekaDescription,
          phone,
          photoUrl: this.newWorkerPhotoDataUrl
        });

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

        this.closeModals();
        this.populateSelects();
        this.renderAll();
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
            this.renderAll();
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
          this.renderAll();

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
        this.checkEveningBanner();

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
      const s = this.store.getSettings();
      document.getElementById('settingReminderTime').value = s.eveningReminderTime || '19:30';
      document.getElementById('settingNotifToggle').checked = s.reminderEnabled !== false;
      document.getElementById('settingSoundToggle').checked = s.soundEnabled !== false;

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
            return `<option value="${w.id}">${w.name} — ${getTradeIcon(tr.icon)} ${tr.name} (${roleText})</option>`;
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
            <span class="filter-chip" style="cursor: default; background: rgba(255,255,255,0.06); font-size: 0.8rem; border-color: rgba(255,255,255,0.15); display: inline-flex; align-items: center; gap: 4px;">
              ${getTradeIcon(t.icon)} ${t.name} <strong style="color: var(--amber-light); margin-left: 2px;">(${count})</strong>
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
          <span class="filter-chip" style="cursor: default; background: rgba(255,255,255,0.06); font-size: 0.8rem; border-color: rgba(255,255,255,0.15);">
            ${t.label}
          </span>
        `).join('');
      }

      const syncKeyInput = document.getElementById('settingCloudSyncKey');
      if (syncKeyInput) syncKeyInput.value = s.cloudSyncKey || '';
      const badge = document.getElementById('cloudSyncStatusBadge');
      const note = document.getElementById('cloudSyncLastTimeNote');
      if (badge) {
        if (s.lastCloudSync) {
          const syncDateStr = new Date(s.lastCloudSync).toLocaleDateString('hi-IN', { day: 'numeric', month: 'short' });
          const syncTimeStr = new Date(s.lastCloudSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          badge.textContent = `सिंक: ${syncDateStr}, ${syncTimeStr}`;
          badge.style.background = 'rgba(16, 185, 129, 0.15)';
          badge.style.color = '#34d399';
          if (note) note.textContent = `अंतिम क्लाउड सिंक: ${syncDateStr} ${syncTimeStr} पर सुरक्षित किया गया।`;
        } else {
          badge.textContent = 'ऑफलाइन / लोकल';
          badge.style.background = 'rgba(245, 158, 11, 0.15)';
          badge.style.color = 'var(--amber-light)';
        }
      }

      // Populate Firebase Settings UI
      const fbSiteIdInput = document.getElementById('firebaseSiteIdInput');
      if (fbSiteIdInput) fbSiteIdInput.value = s.firebaseSiteId || 'khalen-dairy';

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
          fbBadge.style.background = 'rgba(255, 255, 255, 0.08)';
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
        const siteId = document.getElementById('firebaseSiteIdInput')?.value.trim() || 'khalen-dairy';
        if (!cfgStr) {
          alert('कृपया पहले अपना Firebase Web Config JSON पेस्ट करें।\n\nउदा: {"apiKey": "...", "projectId": "...", "appId": "..."}');
          return;
        }
        try {
          let cfg;
          try {
            cfg = parseFirebaseConfig(cfgStr);
          } catch (e) {
            throw new Error(e.message || 'अमान्य Firebase Config! कृपया Firebase से कॉपी किया गया पूरा कोड पेस्ट करें।');
          }
          btnConnectFb.disabled = true;
          btnConnectFb.textContent = '⏳ कनेक्ट हो रहा है...';

          const ok = initFirebase(cfg);
          if (!ok) throw new Error('Firebase प्रारंभ करने में त्रुटि आई। कृपया apiKey और projectId जांचें।');

          // Write back clean formatted JSON to input
          const configInput = document.getElementById('firebaseConfigInput');
          if (configInput) configInput.value = JSON.stringify(cfg, null, 2);

          // Save test snapshot
          await saveToFirebase(siteId, this.store.data);
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
        const siteId = document.getElementById('firebaseSiteIdInput')?.value.trim() || this.store.getSettings().firebaseSiteId || 'khalen-dairy';
        if (!isFirebaseReady()) {
          const cfg = this.store.getSettings().firebaseConfig;
          if (cfg) initFirebase(cfg);
          else {
            alert('कृपया पहले Firebase Config दर्ज करके "टेस्ट व कनेक्ट करें" दबाएं।');
            return;
          }
        }
        btnPushFb.disabled = true;
        btnPushFb.textContent = '⏳ सेव हो रहा है...';
        try {
          await saveToFirebase(siteId, this.store.data);
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
        const siteId = document.getElementById('firebaseSiteIdInput')?.value.trim() || this.store.getSettings().firebaseSiteId || 'khalen-dairy';
        if (!isFirebaseReady()) {
          const cfg = this.store.getSettings().firebaseConfig;
          if (cfg) initFirebase(cfg);
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
          if (remoteData && remoteData.workers && remoteData.trades) {
            this.store.data = {
              trades: remoteData.trades,
              workers: remoteData.workers,
              transactions: remoteData.transactions || [],
              haziri: remoteData.haziri || {},
              diaryNotedDates: remoteData.diaryNotedDates || {},
              settings: { ...this.store.getSettings(), ...(remoteData.settings || {}) }
            };
            this.store.save();
            alert('✅ Google Firebase से डेटा सफलतापूर्वक आ गया!');
            location.reload();
          } else {
            throw new Error('अमान्य डेटा संरचना');
          }
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
        const cloudSyncKey = document.getElementById('settingCloudSyncKey') ? document.getElementById('settingCloudSyncKey').value.trim() : '';
        const firebaseSiteId = document.getElementById('firebaseSiteIdInput') ? document.getElementById('firebaseSiteIdInput').value.trim() : 'khalen-dairy';
        const firebaseAutoSync = document.getElementById('firebaseAutoSyncToggle') ? document.getElementById('firebaseAutoSyncToggle').checked : false;

        this.store.updateSettings({
          eveningReminderTime: time,
          reminderEnabled,
          soundEnabled,
          cloudSyncKey,
          firebaseSiteId,
          firebaseAutoSync
        });

        this.closeModals();
        this.renderHeaderInfo();
        this.checkEveningBanner();
        alert('सेटिंग्स सुरक्षित कर दी गई हैं!');
      });
    }

    // Request Notification Permission Button
    const btnReqNotif = document.getElementById('btnRequestNotifPerm');
    if (btnReqNotif) {
      btnReqNotif.addEventListener('click', async () => {
        const res = await this.reminderManager.requestPermission();
        if (res === 'granted') {
          alert('सूचना: ब्राउज़र पुश नोटिफिकेशन सक्षम हो गया है!');
        } else {
          alert('ब्राउज़र नोटिफिकेशन अनुमति नहीं मिली या ब्लॉक की गई है।');
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
      btnExport.addEventListener('click', () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(this.store.exportData());
        const dlAnchor = document.createElement('a');
        dlAnchor.setAttribute("href", dataStr);
        dlAnchor.setAttribute("download", `site_diary_backup_${getTodayString()}.json`);
        dlAnchor.click();
      });
    }

    const btnImport = document.getElementById('btnImportData');
    const fileImport = document.getElementById('fileImportInput');
    if (btnImport && fileImport) {
      btnImport.addEventListener('click', () => fileImport.click());
      fileImport.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
          const success = this.store.importData(event.target.result);
          if (success) {
            alert('डेटा सफलतापूर्वक रीस्टोर हो गया!');
            location.reload();
          } else {
            alert('अमान्य बैकअप फ़ाइल!');
          }
        };
        reader.readAsText(file);
      });
    }

    // Clear Demo Data & Start Fresh with Real Site Data
    const btnClearDemo = document.getElementById('btnClearDemoData');
    if (btnClearDemo) {
      btnClearDemo.addEventListener('click', async () => {
        if (confirm('क्या आप डमी/सैंपल डेटा हटाकर अपनी साइट का असली हिसाब शुरू करना चाहते हैं?\n\nट्रेड श्रेणियां (बढ़ई, राजमिस्त्री, ब्लॉक ठेका मिस्त्री आदि) सुरक्षित रहेंगी और आप अपने असली कारीगर व खर्चे जोड़ सकेंगे।')) {
          this.store.resetToClean();
          if (isFirebaseReady()) {
            try {
              await saveToFirebase(this.store.getData());
            } catch (err) {
              console.error('Firebase clean sync failed:', err);
            }
          }
          this.closeModals();
          this.populateSelects();
          this.renderAll();
          alert('डमी डेटा सफलतापूर्वक साफ़ कर दिया गया है!\n\nअब आपका खाता पूरी तरह खाली व साफ़ है। आप "+ नया कारीगर" से अपने असली कारीगर जोड़ सकते हैं।');
        }
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
    const clearDemoSection = document.getElementById('clearDemoSection');
    if (clearDemoSection && this.store.data.isCleanStarted) {
      clearDemoSection.style.display = 'none';
    }
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
        if (rec.status === 0) return 'A';
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
        avatarEl.innerHTML = `<img src="${worker.photoUrl}" alt="${worker.name}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />`;
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
      contractEl.textContent = ledger.isTheka ? '📜 ठेका' : '👷 दिहाड़ी';
      contractEl.className = `tag-badge ${ledger.isTheka ? 'tag-theka' : 'tag-dihadi'}`;
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
        <option value="${t.id}" ${t.id === worker.tradeId ? 'selected' : ''}>${t.name}</option>
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
        <option value="${t.id}" ${t.id === tx.tradeId ? 'selected' : ''}>${t.name}</option>
      `).join('');
    }

    // Populate Worker
    const populateWorkerSelect = (tradeId, selectedWorkerId) => {
      const workerSelect = document.getElementById('editTxWorkerSelect');
      if (workerSelect) {
        const workers = this.store.getWorkers(tradeId);
        workerSelect.innerHTML = workers.map(w => `
          <option value="${w.id}" ${w.id === selectedWorkerId ? 'selected' : ''}>
            ${w.name} (${w.role === 'mistri' ? 'मिस्त्री' : 'हेल्पर'})
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
  new App();

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
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js?v=4').then((reg) => {
      console.log('Site Diary Service Worker registered:', reg.scope);
      reg.update();
    }).catch((err) => {
      console.log('Service Worker registration failed:', err);
    });
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

