import { getTodayString } from './storage.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => `₹${Number(value || 0).toLocaleString('en-IN')}`;
const paths = {
  money: '<path d="M6 4h12M6 8h12M7 4c7 0 7 8 0 8l9 8"/>',
  bag: '<path d="M4 7h16l-1 14H5Z"/><path d="M8 7V5a4 4 0 0 1 8 0v2"/>',
  book: '<path d="M12 5C8 2 4 3 2 4v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-4-2-7-1-10 1Z"/><path d="M12 5v16"/>',
  check: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',
  truck: '<path d="M3 6h12v11H3ZM15 10h4l3 4v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  machine: '<path d="M3 19h10M5 15h7v4H5ZM7 15V8h6v7M13 8l5-5 3 9M21 12l-4 3"/>',
};
const glyph = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.book}</svg>`;

export function installExperience(flow) {
  document.body.classList.add('experience-app');
  const home = document.getElementById('tab-home');
  const capture = document.createElement('section');
  capture.className = 'experience-capture flow-panel';
  capture.innerHTML = '<div class="panel-heading"><h3 data-experience-label="capture"></h3></div>';
  capture.append(document.getElementById('quickEntryInput').closest('.voice-search-bar'));
  capture.append(document.getElementById('voiceTranscriptBox'));
  capture.append(document.getElementById('voiceStatusText'));
  home.querySelector('.home-columns').before(capture);
  const timeline = document.getElementById('tab-timeline');
  const filterCard = document.createElement('section');
  filterCard.className = 'record-filter-card';
  timeline.querySelector('.screen-heading').after(filterCard);
  filterCard.append(document.getElementById('timelineRecipientFilters'), timeline.querySelector('.timeline-controls-bar'), document.getElementById('timelineFilters'));
  timeline.querySelector('#timelineListContainer').before(document.getElementById('timelineFilteredTotal'));
  filterCard.insertAdjacentHTML('beforeend', '<div class="record-filter-footer"><button type="button" class="flow-link" data-experience="reset" data-experience-label="reset"></button><button type="button" class="flow-link" data-experience="recovery" data-experience-label="recovery"></button></div>');
  document.body.insertAdjacentHTML('beforeend', '<div class="modal-overlay" id="modalRecovery"><div class="modal-card"><div class="modal-header"><h3 class="modal-title" id="recoveryTitle"></h3><button type="button" class="btn-close-modal" data-close-modal>×</button></div><p class="recovery-intro" id="recoveryIntro"></p><div id="recoveryList"></div></div></div>');
  // Dynamic buttons are handled once; standard modal handlers register after this shell.
  document.addEventListener('click', e => {
    const button = e.target.closest('button');
    if (!button) return;
    const data = button.dataset;
    if (data.experienceNative) document.getElementById(data.experienceNative)?.click();
    if (data.experience === 'supply') {
      flow.openPayment(); flow.draft.targetType = 'group'; flow.draft.type = 'ration'; flow.renderPayment();
    }
    if (data.experience === 'reset') {
      flow.recipientMode = 'all'; flow.recipientId = '';
      flow.app.activeFilterTrade = null; flow.app.activeFilterType = 'all';
      flow.app.timelineSearchQuery = ''; flow.app.timelineDateMode = 'all';
      document.getElementById('timelineSearchInput').value = '';
      document.getElementById('timelineDatePreset').value = 'all';
      document.getElementById('timelineDatePicker').style.display = 'none';
      document.querySelectorAll('[data-filter-type]').forEach(b => b.classList.toggle('active', b.dataset.filterType === 'all'));
      flow.app.renderTimeline();
    }
    if (data.experience === 'recovery') {
      renderRecovery(flow); document.getElementById('modalRecovery').classList.add('open');
    }
    if (data.restoreTransaction || data.restoreWorker) {
      const ok = data.restoreTransaction ? flow.store.restoreTransaction(data.restoreTransaction) : flow.store.restoreWorker(data.restoreWorker);
      if (ok) { flow.app.populateSelects(); flow.app.commit(); renderRecovery(flow); flow.app.showToast(flow.t('रिकॉर्ड वापस आ गया','Record restored')); }
    }
  });
}

export function renderRecovery(flow) {
  const {store} = flow;
  document.getElementById('recoveryTitle').textContent = flow.t('हटाए हुए रिकॉर्ड वापस लाएँ','Restore records');
  document.getElementById('recoveryIntro').textContent = flow.t('एंट्री वापस लाने पर वह फिर हिसाब में जुड़ेगी। पुराने कारीगर का खाता और हाजिरी सुरक्षित हैं।','Restored entries count towards your balance again. Archived workers keep their accounts and attendance.');
  const txs = store.getDeletedTransactions();
  const workers = store.getWorkers(null, true).filter(w => w.archivedAt);
  document.getElementById('recoveryList').innerHTML = `<h4>${flow.t('हटाई गई एंट्री','Deleted entries')} · ${txs.length}</h4>${txs.map(tx => `<article class="recovery-row"><div><strong>${esc(store.getWorker(tx.workerId)?.name || tx.workerName || store.getTrade(tx.tradeId)?.name)}</strong><small>${esc(tx.date)} · ${money(tx.amount)}</small><p>${esc(tx.note || tx.rationItem || '')}</p></div><button type="button" class="btn-secondary" data-restore-transaction="${esc(tx.id)}">${flow.t('वापस लाएँ','Restore')}</button></article>`).join('') || `<p class="quiet-empty">${flow.t('कोई हटाई हुई एंट्री नहीं','No deleted entries')}</p>`}<h4>${flow.t('काम छोड़ चुके कारीगर','Archived workers')} · ${workers.length}</h4>${workers.map(w => `<article class="recovery-row"><div><strong>${esc(w.name)}</strong><small>${esc(store.getTrade(w.tradeId)?.name)}</small><button type="button" class="flow-link" data-open-statement="${esc(w.id)}">${flow.t('पुराना खाता देखें','View account')}</button></div><button type="button" class="btn-secondary" data-restore-worker="${esc(w.id)}">${flow.t('टीम में वापस','Restore to team')}</button></article>`).join('') || `<p class="quiet-empty">${flow.t('कोई पुराना कारीगर नहीं','No archived workers')}</p>`}`;
}

export function renderExperience(flow) {
  const {store} = flow, t = flow.t.bind(flow), today = getTodayString();
  const summary = flow.summary(today), txs = store.getTransactions(today);
  const total = txs.reduce((n, tx) => n + Number(tx.amount || 0), 0);
  const individual = txs.filter(tx => tx.targetType !== 'group' && tx.workerId).reduce((n, tx) => n + Number(tx.amount || 0), 0);
  const ledgers = store.getWorkers(null, true).map(w => store.getWorkerLedger(w.id));
  const due = ledgers.reduce((n, l) => n + Math.max(0, l.balanceDue), 0);
  const percent = summary.total ? Math.round(summary.marked / summary.total * 100) : 0;
  const actions = [
    ['money',t('पैसा दिया','Pay a worker'),t('नकद या पेशगी','Cash or advance'),'data-flow="payment"'],
    ['bag',t('राशन / सामान','Supplies'),t('चावल, सिलेंडर और खर्च','Rice, gas and expenses'),'data-experience="supply"'],
    ['book',t('पुराना हिसाब','Past records'),t('कारीगर और ट्रेड का रिकॉर्ड','Worker and trade history'),'data-flow="accounts"'],
    ['check',t('हाजिरी लगाएँ','Attendance'),t('पूरा, आधा या गैरहाजिर','Full, half or absent'),'data-flow="attendance"'],
    ['truck',t('ट्रॉली दर्ज करें','Trolley delivery'),t('रेता, बजरी और रेट','Loads and rates'),'data-experience-native="btnOpenTrolley"'],
    ['machine',t('JCB का काम','JCB work'),t('समय और घंटे का हिसाब','Time and hours'),'data-experience-native="btnOpenJcb"'],
  ];
  document.getElementById('dayJourney').innerHTML = `<div class="experience-heading"><div><p class="flow-eyebrow">${esc(store.activeProject().name)}</p><h2>${t('आज का हिसाब','Your day, at a glance')}</h2><p>${new Date(`${today}T12:00:00`).toLocaleDateString(flow.app.currentLang === 'en' ? 'en-IN' : 'hi-IN', {weekday:'long', day:'numeric', month:'long'})}</p></div><span class="experience-day-badge">${store.isDateMarkedInDiary(today) ? t('✓ दिन पूरा','✓ Day complete') : t('डायरी बाकी','Diary pending')}</span></div><section class="experience-total"><span>${t('आज कुल दिया / खर्च किया','Total recorded today')}</span><strong>${money(total)}</strong><div class="experience-total-split"><div><small>${t('कारीगर को दिया','Given to workers')}</small><b>${money(individual)}</b></div><div><small>${t('साइट / सांझा खर्च','Site / shared expenses')}</small><b>${money(total - individual)}</b></div></div></section><div class="experience-overview"><button type="button" data-flow="accounts"><small>${t('कुल देना बाकी','Total balance due')}</small><strong>${money(due)}</strong><span>${t('खाते देखें','View accounts')} →</span></button><button type="button" data-flow="attendance"><small>${t('आज की हाजिरी','Today’s attendance')}</small><strong>${summary.marked}<em> / ${summary.total}</em></strong><span>${summary.pending ? t(`${summary.pending} की हाजिरी बाकी`,`${summary.pending} pending`) : t('सब दर्ज हैं','All recorded')}</span></button></div><section class="experience-actions"><div class="panel-heading"><h3>${t('क्या दर्ज करना है?','What would you like to record?')}</h3></div><div class="experience-action-grid">${actions.map(([name,title,sub,attr]) => `<button type="button" ${attr}><span>${glyph(name)}</span><div><strong>${title}</strong><small>${sub}</small></div><b aria-hidden="true">↗</b></button>`).join('')}</div></section><button type="button" class="experience-progress" data-flow="${summary.total ? 'attendance' : 'worker'}"><div><strong>${summary.total ? t('हाजिरी पूरी करें','Finish attendance') : t('अपनी टीम जोड़ें','Add your team')}</strong><span>${summary.total ? t(`${summary.marked} दर्ज · ${summary.pending} बाकी`,`${summary.marked} recorded · ${summary.pending} pending`) : t('पहला कारीगर जोड़कर शुरू करें','Start by adding your first worker')}</span></div><div class="experience-progress-track"><i style="width:${percent}%"></i></div><b>→</b></button>`;
  const labels = {capture:t('बोलकर या लिखकर एंट्री','Speak or type an entry'),reset:t('सभी रिकॉर्ड दिखाएँ','Clear filters · show all'),recovery:t('हटाए हुए रिकॉर्ड','Restore deleted records')};
  document.querySelectorAll('[data-experience-label]').forEach(el => el.textContent = labels[el.dataset.experienceLabel]);
}
