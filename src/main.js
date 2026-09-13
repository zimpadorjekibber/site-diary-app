// src/main.js
// Main Application Controller for Shram & Site Diary

import { store, getTodayString } from './storage.js';
import { VoiceManager } from './speech.js';
import { ReminderManager } from './reminder.js';
import confetti from 'canvas-confetti';

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
    this.renderAll();
    this.startClock();
    this.checkEveningBanner();
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
        statDiaryEl.innerHTML = 'नोट किया गया ✓';
        statDiaryEl.style.color = '#10b981';
      } else {
        statDiaryEl.innerHTML = 'बाकी है ⏳';
        statDiaryEl.style.color = '#f59e0b';
      }
    }
  }

  // --- TAB 1: TIMELINE ---
  renderTimeline() {
    const container = document.getElementById('timelineListContainer');
    if (!container) return;

    const today = getTodayString();
    let txs = this.store.getTransactions(today);

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
          <div style="font-weight: 600; color: var(--text-main); margin-bottom: 6px;">आज कोई लेन-देन दर्ज नहीं है</div>
          <div style="font-size: 0.84rem; color: var(--text-muted);">
            ऊपर माइक दबाकर बोलें या "+ नकद / राशन" बटन दबाकर पहला लेन-देन जोड़ें।
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
                <span>🕒 ${tx.time}</span>
                ${tx.audioDataUrl ? `<span>• <button class="btn-audio-play" data-audio="${tx.audioDataUrl}" style="background:none;border:none;color:var(--amber-primary);cursor:pointer;font-size:0.76rem;">▶ आवाज सुनें</button></span>` : ''}
              </div>
            </div>
          </div>
          <div class="tx-right">
            <div class="tx-amount ${amountClass}">₹${(tx.amount || 0).toLocaleString('en-IN')}</div>
            ${tx.quantity && tx.type === 'ration' ? `<span class="tx-item-qty">${tx.quantity}</span>` : ''}
            <button class="btn-del-tx" data-delete-tx="${tx.id}" title="हटाएं">
              🗑️
            </button>
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
              <a href="tel:${worker.phone}" class="btn-contact-pill btn-pill-call" title="कॉल करें">📞 ${worker.phone}</a>
              <a href="https://wa.me/91${worker.phone.replace(/[^0-9]/g, '')}" target="_blank" class="btn-contact-pill btn-pill-wa" title="व्हाट्सएप">💬 चैट</a>
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
              <span>🔨</span>
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
                <div style="font-weight: 700; color: #fff; font-size: 0.82rem; white-space: nowrap;">
                  ${w.name} ${contractBadge}
                </div>
                <div style="font-size: 0.72rem; color: var(--text-dim);">
                  ${row.trade.name} (${w.role === 'mistri' ? 'मिस्त्री' : 'हेल्पर'})
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
          ? `<a href="tel:${w.phone}" style="text-decoration:none; margin-left: 4px;" title="कॉल करें">📞</a> <a href="https://wa.me/91${w.phone.replace(/[^0-9]/g, '')}" target="_blank" style="text-decoration:none; margin-left: 2px;" title="व्हाट्सएप">💬</a>`
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
          <div class="worker-ledger-item" style="flex-direction: column; align-items: stretch; gap: 8px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 10px;">
                ${avatarThumb}
                <div>
                  <div class="worker-name-line">
                    ${w.name}
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
          </div>
        `;
      }).join('');

      return `
        <div class="group-card">
          <div class="group-card-header">
            <div class="group-card-title">
              <span>🔨</span>
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

    const optionsHtml = trades.map(t => `<option value="${t.id}">${t.name}</option>`).join('');

    if (tradeSelect) tradeSelect.innerHTML = optionsHtml;
    if (workerTradeSelect) workerTradeSelect.innerHTML = optionsHtml;

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

    const btnRation = document.getElementById('btnQuickRation');
    if (btnRation) btnRation.addEventListener('click', () => this.openAddTransactionModal({ type: 'ration', targetType: 'group' }));

    const btnRecharge = document.getElementById('btnQuickRecharge');
    if (btnRecharge) btnRecharge.addEventListener('click', () => this.openAddTransactionModal({ type: 'recharge', targetType: 'individual' }));

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
    document.querySelectorAll('#timelineFilters .filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#timelineFilters .filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        if (chip.hasAttribute('data-filter-type')) {
          this.activeFilterType = chip.getAttribute('data-filter-type');
          this.activeFilterTrade = null;
        } else if (chip.hasAttribute('data-filter-trade')) {
          this.activeFilterType = 'all';
          this.activeFilterTrade = chip.getAttribute('data-filter-trade');
        }
        this.renderTimeline();
      });
    });

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

    const btnAddWorkerFromHz = document.getElementById('btnAddWorkerFromHaziri');
    if (btnAddWorkerFromHz) btnAddWorkerFromHz.addEventListener('click', () => this.openAddWorkerModal());

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
      formWorker.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('workerNameInput').value;
        const tradeId = document.getElementById('workerTradeSelect').value;
        const dailyRate = this.modalContractType === 'dihadi' ? (Number(document.getElementById('workerDailyRate').value) || 0) : 0;
        const thekaAmount = this.modalContractType === 'theka' ? (Number(document.getElementById('workerThekaAmount').value) || 0) : 0;
        const thekaDescription = document.getElementById('workerThekaDesc') ? document.getElementById('workerThekaDesc').value : '';
        const phone = document.getElementById('workerPhone').value;

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

    // Add Trade Modal
    const btnAddTrade = document.getElementById('btnAddTradeBtn');
    if (btnAddTrade) {
      btnAddTrade.addEventListener('click', () => {
        document.getElementById('modalAddTrade').classList.add('open');
      });
    }

    const formTrade = document.getElementById('formAddTrade');
    if (formTrade) {
      formTrade.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('tradeNameInput').value;
        if (name.trim()) {
          this.store.addTrade(name.trim());
          formTrade.reset();
          this.closeModals();
          this.populateSelects();
          this.renderAll();
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
      modalSettings.classList.add('open');
    };

    if (btnOpenSettings) btnOpenSettings.addEventListener('click', openSettings);
    if (btnOpenReminder) btnOpenReminder.addEventListener('click', openSettings);

    const formSettings = document.getElementById('formSettings');
    if (formSettings) {
      formSettings.addEventListener('submit', (e) => {
        e.preventDefault();
        const time = document.getElementById('settingReminderTime').value;
        const reminderEnabled = document.getElementById('settingNotifToggle').checked;
        const soundEnabled = document.getElementById('settingSoundToggle').checked;

        this.store.updateSettings({
          eveningReminderTime: time,
          reminderEnabled,
          soundEnabled
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

    // Voice Dictation Mic Button
    const btnMic = document.getElementById('btnVoiceMic');
    const voiceStatus = document.getElementById('voiceStatusText');
    const voiceTranscriptBox = document.getElementById('voiceTranscriptBox');

    if (btnMic) {
      btnMic.addEventListener('click', () => {
        if (this.voiceManager.isListening) {
          this.voiceManager.stopListening();
          btnMic.classList.remove('recording');
        } else {
          btnMic.classList.add('recording');
          voiceTranscriptBox.style.display = 'block';
          voiceTranscriptBox.textContent = 'सुन रहा हूँ... बोलिए...';

          this.voiceManager.startListening(
            // On result
            (transcript, isFinal, parsedData, audioDataUrl) => {
              voiceTranscriptBox.textContent = `"${transcript}"`;
              if (isFinal) {
                btnMic.classList.remove('recording');
                if (parsedData) {
                  // Pre-fill modal with extracted information
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
              }
            }
          );
        }
      });
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
}

// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
  new App();

  // Register Service Worker for Offline & PWA support
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      console.log('Site Diary Service Worker registered:', reg.scope);
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

