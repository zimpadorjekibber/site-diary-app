import { getTodayString } from './storage.js';
import { attendanceSummary, attendanceWorkers, validatePayment } from './workflow-model.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const icon = (name) => {
  const paths = { home:'<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>', arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>', check:'<path d="m5 12 4 4L19 6"/>', team:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v2"/>', plus:'<path d="M12 5v14M5 12h14"/>' };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.arrow}</svg>`;
};

export class Workflow {
  constructor(app) {
    this.app = app;
    this.store = app.store;
    this.query = '';
    this.status = 'all';
    this.accountQuery = '';
    this.accountFilter = 'all';
    this.installShell();
    this.bind();
  }
  t(hi, en) { return this.app.currentLang === 'en' ? en : hi; }
  workers() { return attendanceWorkers(this.store.getWorkers(), this.store.getTrades()); }
  summary(date = getTodayString()) { return attendanceSummary(this.workers(), this.store.getHaziri(date)); }
  installShell() {
    document.body.classList.add('workflow-app');
    const home = document.createElement('section');
    home.id = 'tab-home'; home.className = 'tab-view active';
    const intro = document.querySelector('.workspace-intro');
    intro.before(home);
    home.append(intro);
    home.append(document.getElementById('eveningAlertBanner'));
    home.insertAdjacentHTML('beforeend', '<div id="dayJourney"></div>');
    home.append(document.querySelector('.daily-overview-layout'));
    home.insertAdjacentHTML('beforeend', '<div class="home-columns"><section class="flow-panel" id="homeActivity"></section><section class="flow-panel" id="homeTeam"></section></div>');
    document.querySelector('#tab-haziri').classList.remove('active');
    const nav = document.querySelector('.nav-tabs-wrapper');
    nav.querySelector('.active')?.classList.remove('active');
    nav.querySelector('[aria-current]')?.removeAttribute('aria-current');
    const homeButton = document.createElement('button');
    homeButton.className = 'nav-tab-btn active'; homeButton.dataset.tab = 'tab-home';
    homeButton.setAttribute('aria-current', 'page');
    homeButton.innerHTML = `<span class="nav-tab-icon">${icon('home')}</span><span class="nav-tab-label" data-flow-label="home"></span>`;
    nav.querySelector('.nav-tab-btn').before(homeButton);
    nav.querySelector('[data-tab="tab-monthly"]').remove();
    document.querySelector('.app-header').insertAdjacentHTML('beforeend', '<button type="button" class="flow-header-add" data-flow="payment" aria-label="नई एंट्री / New entry">+ <span data-flow-label="entry"></span></button>');
    document.querySelector('#tab-haziri .screen-heading').insertAdjacentHTML('beforebegin', '<div class="screen-tools"><button class="btn-secondary" data-flow="monthly" data-flow-label="monthly"></button><button class="btn-primary" data-flow="worker" data-flow-label="addWorker"></button></div>');
    document.querySelector('#tab-haziri .attendance-top-bar').insertAdjacentHTML('beforebegin', '<div class="roster-controls"><label class="flow-search"><span aria-hidden="true">⌕</span><input type="search" id="rosterSearch" /></label><div id="rosterFilters" class="flow-filter-row"></div></div>');
    document.querySelector('#tab-timeline .screen-heading').insertAdjacentHTML('beforebegin', '<div class="screen-tools"><button class="btn-secondary" data-flow="advanced" data-flow-label="advanced"></button><button class="btn-primary" data-flow="payment" data-flow-label="entry"></button></div>');
    document.querySelector('#tab-monthly .screen-heading').insertAdjacentHTML('beforebegin', '<button class="flow-link" data-flow="attendance" data-flow-label="backAttendance"></button>');
    const groups = document.querySelector('#tab-groups');
    const details = document.createElement('details'); details.className = 'group-ledger-details';
    details.innerHTML = '<summary data-flow-label="groupDetails"></summary>';
    details.append(document.querySelector('#groupsLedgerContainer'));
    groups.append(details);
    groups.insertAdjacentHTML('afterbegin', '<div id="accountOverview"></div><div class="roster-controls"><label class="flow-search"><span aria-hidden="true">⌕</span><input type="search" id="accountSearch" /></label><div id="accountFilters" class="flow-filter-row"></div></div><div id="accountList"></div>');
    // The searchable directory replaces the duplicated introductory block.
    const oldHeading = groups.querySelector('.screen-heading');
    oldHeading.nextElementSibling.style.display = 'none';
    oldHeading.hidden = true;
    document.querySelector('#tab-diary').insertAdjacentHTML('afterbegin', '<div id="dayReview"></div>');
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="modalFlowPayment"><div class="modal-card flow-payment-card"><div class="modal-header"><h3 class="modal-title" id="flowPaymentTitle"></h3><button type="button" class="btn-close-modal" data-close-modal>×</button></div><div id="paymentSteps"></div><div id="paymentBody"></div></div></div>`);
    // Move optional photo and phone fields behind disclosure; core worker details stay first.
    const workerForm = document.querySelector('#formAddWorker');
    const photo = workerForm?.querySelector('.worker-photo-upload-wrap');
    const phone = document.querySelector('#workerPhone');
    const extras = document.createElement('details'); extras.className = 'worker-extra-fields';
    extras.innerHTML = '<summary data-flow-label="workerExtras"></summary>';
    if (photo) extras.append(photo.closest('.form-group') || photo);
    if (phone) extras.append(phone.closest('.form-group') || phone);
    workerForm?.querySelector('.modal-actions')?.before(extras);
  }
  render() {
    const labels = {
      home:this.t('आज','Today'), entry:this.t('नई एंट्री','New entry'), monthly:this.t('महीने का रजिस्टर ↗','Monthly register ↗'),
      addWorker:this.t('+ कारीगर जोड़ें','+ Add worker'), advanced:this.t('विस्तृत एंट्री','Detailed entry'),
      backAttendance:this.t('← दैनिक हाजिरी','← Daily attendance'), groupDetails:this.t('ट्रेड और सांझे राशन का विस्तृत खाता','Detailed trade & shared kitchen accounts'),
      workerExtras:this.t('फ़ोटो और मोबाइल नंबर (वैकल्पिक)','Photo & phone number (optional)')
    };
    document.querySelectorAll('[data-flow-label]').forEach(el => el.textContent = labels[el.dataset.flowLabel] || '');
    for (const id of ['rosterSearch','accountSearch']) {
      const input = document.getElementById(id);
      input.placeholder = this.t('नाम या ट्रेड से खोजें…','Search by name or trade…'); input.setAttribute('aria-label', input.placeholder);
    }
    this.renderHome(); this.renderAccounts(); this.renderReview();
  }
  renderHome() {
    const s = this.summary();
    const txs = this.store.getTransactions(getTodayString());
    const closed = this.store.isDateMarkedInDiary(getTodayString());
    const progress = s.total ? Math.round(s.marked / s.total * 100) : 0;
    const next = !s.total ? 'worker' : s.pending ? 'attendance' : 'diary';
    const title = !s.total ? this.t('पहले अपनी टीम जोड़ें।','Let’s bring your team together.') : s.pending ? this.t(`${s.pending} कारीगरों की हाजिरी बाकी है।`,`${s.pending} workers still need attendance.`) : closed ? this.t('आज का हिसाब डायरी में दर्ज है।','Today’s diary is complete.') : this.t('हाजिरी तैयार। अब हिसाब देख लें।','Attendance is ready. Review your day.');
    document.getElementById('dayJourney').innerHTML = `<div class="next-action-card"><div class="next-action-copy"><span class="flow-eyebrow">${this.t('आपका अगला कदम','YOUR NEXT STEP')}</span><h2>${title}</h2><p>${!s.total ? this.t('नाम, ट्रेड और दिहाड़ी जोड़ें। हाजिरी आप खुद तय करेंगे।','Add a name, trade and daily rate. You decide attendance.') : this.t('छोटी-छोटी एंट्री। पूरा और साफ़ हिसाब।','Small entries. A complete picture of your day.')}</p><button class="btn-primary" data-flow="${next}">${!s.total ? this.t('+ पहला कारीगर जोड़ें','+ Add your first worker') : s.pending ? this.t('हाजिरी पूरी करें','Finish attendance') : this.t('दिन का हिसाब देखें','Review the day')} ${icon('arrow')}</button></div><div class="day-progress"><div class="progress-ring" style="--progress:${progress}%"><strong>${s.marked}<small>/ ${s.total}</small></strong></div><span>${this.t('हाजिरी दर्ज','attendance recorded')}</span></div></div><div class="day-journey">${[
      ['01',this.t('टीम की हाजिरी','Team attendance'),this.t(`${s.marked}/${s.total} दर्ज`,`${s.marked}/${s.total} recorded`),'attendance',s.total > 0 && !s.pending],
      ['02',this.t('खर्च और भुगतान','Expenses & payments'),this.t(`${txs.length} एंट्री`,`${txs.length} entries`),'payment',txs.length > 0],
      ['03',this.t('दिन का हिसाब','Daily review'),closed ? this.t('डायरी में दर्ज','Diary complete') : this.t('जाँचें और दर्ज करें','Review & record'),'diary',closed]
    ].map(([n,label,sub,action,done]) => `<button class="journey-step ${done ? 'is-done' : ''}" data-flow="${action}"><span class="journey-number">${done ? '✓' : n}</span><span><strong>${label}</strong><small>${sub}</small></span>${icon('arrow')}</button>`).join('')}</div>`;
    document.getElementById('homeActivity').innerHTML = `<div class="panel-heading"><h3>${this.t('आज की गतिविधि','Today’s activity')}</h3><button class="flow-link" data-flow="transactions">${this.t('सभी देखें','View all')} →</button></div>${txs.length ? txs.slice(0,4).map(tx => `<div class="activity-row"><span class="activity-icon">${tx.type === 'cash' ? '₹' : '↗'}</span><div><strong>${esc(this.store.getWorker(tx.workerId)?.name || tx.workerName || this.store.getTrade(tx.tradeId)?.name)}</strong><small>${esc(tx.note || tx.rationItem || this.t('खर्च दर्ज','Expense recorded'))} · ${esc(tx.time)}</small></div><b>${money(tx.amount)}</b></div>`).join('') : `<div class="flow-empty"><span>↗</span><h4>${this.t('आज की पहली एंट्री का इंतज़ार','A fresh page for today')}</h4><p>${this.t('भुगतान और साइट खर्च यहाँ क्रम से दिखेंगे।','Payments and site expenses will appear here.')}</p><button class="flow-link" data-flow="payment">${this.t('+ खर्च दर्ज करें','+ Record an expense')}</button></div>`}`;
    const dues = this.store.getWorkers().map(w => this.store.getWorkerLedger(w.id)).filter(l => l.balanceDue > 0).sort((a,b) => b.balanceDue-a.balanceDue);
    document.getElementById('homeTeam').innerHTML = `<div class="panel-heading"><h3>${this.t('भुगतान बाकी','Outstanding balances')}</h3><button class="flow-link" data-flow="accounts">${this.t('खाते देखें','View accounts')} →</button></div><p class="panel-caption">${this.t('अब तक की दर्ज कमाई और दिए गए भुगतान के आधार पर','Based on all recorded earnings and payments')}</p>${dues.length ? dues.slice(0,3).map(l=>`<button class="due-row" data-flow-pay="${esc(l.worker.id)}"><span class="person-initial">${esc(l.worker.name.slice(0,1))}</span><span>${esc(l.worker.name)}</span><b>${money(l.balanceDue)}</b>${icon('arrow')}</button>`).join('') : `<div class="flow-empty"><span>${icon('team')}</span><h4>${this.t('कोई दर्ज बकाया नहीं','No recorded balance due')}</h4><p>${this.t('हाजिरी और भुगतान भरने पर हिसाब अपने आप बनेगा।','Balances update as you record attendance and payments.')}</p><button class="flow-link" data-flow="worker">${this.t('+ टीम में कारीगर जोड़ें','+ Add a team member')}</button></div>`}`;
  }
  renderAttendance() {
    const app = this.app, date = app.selectedHaziriDate, records = this.store.getHaziri(date);
    const workers = this.workers(), s = attendanceSummary(workers, records);
    document.getElementById('haziriDatePicker').value = date;
    document.getElementById('haziriDateDisplay').textContent = new Date(`${date}T12:00:00`).toLocaleDateString(app.currentLang === 'en' ? 'en-IN' : 'hi-IN',{day:'numeric',month:'short'});
    app.activeHaziriTradeId ||= 'all';
    const trades = this.store.getTrades().filter(t=>workers.some(w=>w.tradeId === t.id));
    if (app.activeHaziriTradeId !== 'all' && !trades.some(t=>t.id === app.activeHaziriTradeId)) app.activeHaziriTradeId = 'all';
    document.getElementById('haziriActiveGroupCount').textContent = s.total;
    document.getElementById('haziriGroupTabs').innerHTML = [{id:'all',name:this.t('सभी ट्रेड','All trades')},...trades].map(t=>`<button class="attendance-trade-tab ${app.activeHaziriTradeId===t.id?'active':''}" data-trade-id="${esc(t.id)}">${esc(t.name)}</button>`).join('');
    document.getElementById('rosterFilters').innerHTML = [['all',this.t('सभी','All'),s.total],['pending',this.t('बाकी','Pending'),s.pending],['present',this.t('उपस्थित','Present'),s.full+s.half],['absent',this.t('गैरहाजिर','Absent'),s.absent]].map(([value,label,count])=>`<button class="flow-filter ${this.status===value?'active':''}" aria-pressed="${this.status===value}" data-roster-filter="${value}">${label} <span>${count}</span></button>`).join('');
    const query = this.query.trim().toLocaleLowerCase();
    const visible = workers.filter(w => {
      const r = records[w.id];
      return (app.activeHaziriTradeId==='all'||w.tradeId===app.activeHaziriTradeId) && `${w.name} ${this.store.getTrade(w.tradeId).name}`.toLocaleLowerCase().includes(query) && (this.status==='all'||this.status==='pending'&&!r||this.status==='present'&&r?.status>0||this.status==='absent'&&r?.status===0);
    });
    this.visibleWorkers = visible;
    const container = document.getElementById('haziriTradesContainer');
    if (!workers.length) {
      container.innerHTML = `<div class="onboarding-empty"><div class="onboarding-icon">${icon('team')}</div><h3>${this.t('हाजिरी के लिए टीम जोड़ें','Add your attendance team')}</h3><p>${this.t('ट्रैक्टर और मशीन सप्लायर का हिसाब अलग है। यहाँ काम करने वाले कारीगर आएंगे।','Tractor and machine suppliers are tracked separately. Your working crew appears here.')}</p><button class="btn-primary" data-flow="worker">${this.t('+ पहला कारीगर जोड़ें','+ Add your first worker')}</button></div>`;
      return;
    }
    const saved = this.store.getHaziriSavedAt(date);
    const groupLabel = this.visibleGroupLabel();
    container.innerHTML = `<div class="roster-summary"><div><strong>${s.marked} / ${s.total}</strong> ${this.t('हाजिरी दर्ज','recorded')} <span>· ${s.pending} ${this.t('बाकी','pending')}</span></div><span class="autosave-label">${this.store.hasUnsavedChanges() ? this.t('सेव नहीं हुआ — बैकअप लें','Not saved — take a backup') : saved ? this.t('✓ बदलाव अपने आप सेव हैं','✓ Changes saved automatically') : this.t('चुनते ही सेव होगा','Saved when you choose')}</span></div><div class="roster-list"><div class="roster-list-heading"><span>${this.t('कारीगर / दिहाड़ी','WORKER / DAILY RATE')}</span><div class="roster-bulk"><button class="flow-link" data-flow="markVisible" ${visible.some(w=>!records[w.id])?'':'disabled'}>${this.t('बाकी: सब उपस्थित','Pending: all present')}</button><button class="flow-link flow-link-warn" data-flow="absentVisible" ${visible.length?'':'disabled'}>${esc(this.t(groupLabel+': सब गैरहाजिर',groupLabel+': all absent'))}</button></div></div>${visible.length ? visible.map(w => {
      const r = records[w.id];
      return `<div class="flow-attendance-row ${!r?'is-pending':''}" data-worker-id="${esc(w.id)}"><div class="roster-person"><span class="person-initial">${esc(w.name.slice(0,1))}</span><div><button class="flow-worker-name" data-open-statement="${esc(w.id)}">${esc(w.name)}</button><small>${esc(this.store.getTrade(w.tradeId).name)} · ${w.contractType==='theka' ? this.t('ठेका','Contract') : money(w.dailyRate)+this.t(' / दिन',' / day')}</small></div></div><div class="roster-choice-wrap"><span class="pending-label">${!r ? this.t('अभी दर्ज नहीं','Not recorded yet') : r.status===1?this.t('पूरा दिन','Full day'):r.status===.5?this.t('आधा दिन','Half day'):this.t('गैरहाजिर','Absent')}</span><div class="attendance-choices" role="group" aria-label="${esc(w.name)}">${[[1,this.t('पूरा','Full')],[.5,this.t('आधा','Half')],[0,this.t('गैरहाजिर','Absent')]].map(([value,label])=>`<button data-flow-attendance="${esc(w.id)}" data-value="${value}" class="${r?.status===value?'selected':''}" aria-pressed="${r?.status===value}">${label}</button>`).join('')}</div></div><div class="roster-more">${r?.status>0?`<button class="flow-link" data-hz-ot="${esc(w.id)}">${r.otHours?`+${r.otHours}h OT`:'+ OT'}</button>`:''}${r?.status===0?app.renderAbsenceReasonPicker(w,r):''}<button class="flow-link" data-hz-note="${esc(w.id)}">${this.t('+ नोट','+ Note')}</button></div>${this.renderWorkerNotes(w)}</div>`;
    }).join('') : `<div class="flow-empty"><h4>${this.status==='pending' && !s.pending ? this.t('✓ सभी कारीगरों की हाजिरी दर्ज है','✓ Everyone’s attendance is recorded') : this.t('इस खोज में कोई कारीगर नहीं','No matching workers')}</h4><button class="flow-link" data-flow="clearRoster">${this.t('सभी कारीगर दिखाएं','Show all workers')}</button></div>`}</div><div class="roster-footer"><button class="btn-secondary" data-flow="worker">${this.t('+ कारीगर','+ Worker')}</button><span>${this.t('गैरहाजिर','Absent')}: ${s.absent} · ${this.t('आधा दिन','Half')}: ${s.half}</span><button class="btn-primary" data-flow="home">${this.t('आज पर लौटें','Back to today')} →</button></div>${this.renderHaziriSubmit(date, s)}`;
  }
  /* A group tab is the name the contractor thinks in: on the Welder tab, "all
     absent" means the welders, not the site. With no tab chosen it can only
     honestly say "everyone on screen". */
  visibleGroupLabel() {
    const trade = this.app.activeHaziriTradeId !== 'all' ? this.store.getTrade(this.app.activeHaziriTradeId) : null;
    return trade
      ? `${trade.name} ${this.t('ग्रुप','group')}`
      : this.t('दिख रहे सब','Everyone shown');
  }
  isEvening() {
    const [h,m] = (this.store.getSettings().eveningReminderTime || '19:30').split(':').map(Number);
    const now = new Date();
    return now.getHours()*60 + now.getMinutes() >= h*60 + m;
  }
  /* The end of the day, at the end of the screen. Until it is pressed the marks
     are only pencil — that is the whole point, so the line above the button
     says so rather than leaving the contractor to guess. */
  renderHaziriSubmit(date, s) {
    const done = this.store.getHaziriSubmission(date);
    const evening = date === getTodayString() && this.isEvening();
    const pending = s.pending ? ` · ${this.t(`${s.pending} बाकी`,`${s.pending} pending`)}` : '';
    const heading = done
      ? `${this.t('✓ हाजिरी पक्की हो गई','✓ Attendance submitted')} (${done.timeLabel})`
      : evening
        ? this.t('📖 शाम हो गई — आज की हाजिरी पक्की करें','📖 Evening — submit today’s attendance')
        : this.t('हाजिरी अभी बदली जा सकती है','Attendance is still open');
    const detail = done
      ? this.t('अब इसे डायरी में लिख लें। कुछ भी बदला तो दोबारा पक्की करनी होगी।','Now copy it into your diary. Any change reopens the day.')
      : this.t('सुबह उपस्थित, दोपहर बाद बीमार तो आधा — दिन भर बदलिए, शाम को आख़िर में पक्की कीजिए।','Present in the morning, half if someone falls ill after lunch — change it all day, submit at the end.');
    const button = done
      ? `<button class="btn-secondary" data-flow="diary">${this.t('📖 डायरी खोलें','📖 Open diary')} →</button>`
      : `<button class="btn-primary" data-flow="submitHaziri" ${s.marked?'':'disabled'}>${this.t('✓ हाजिरी पक्की करें','✓ Submit attendance')}</button>`;
    return `<div class="roster-submit${done?' is-submitted':evening?' is-evening':''}"><div><strong>${esc(heading)}</strong><small>${esc(detail+pending)}</small></div>${button}</div>`;
  }
  /* What was written about this man on this day, under his own row. Kept
     closed until asked for: twenty-one rows each carrying an open text box is
     a wall, and most rows never need one. */
  renderWorkerNotes(w) {
    const date = this.app.selectedHaziriDate;
    const notes = this.store.getWorkerSiteNotes(date, w.id);
    const open = this.noteOpenFor === w.id;
    if (!notes.length && !open) return '';

    const written = notes.map(n =>
      `<div class="worker-note-row"><span class="worker-note-time">${esc(n.time || '')}</span>` +
      `<span class="worker-note-text">${esc(n.text)}</span>` +
      `<button class="worker-note-delete" data-delete-note="${esc(n.id)}" aria-label="${this.t('नोट हटाएँ','Remove note')}">✕</button></div>`
    ).join('');

    const box = open
      ? `<div class="worker-note-form"><input type="text" id="workerNoteInput" class="worker-note-input" maxlength="500" ` +
        `value="${esc(this.noteDraft || '')}" placeholder="${this.t('जैसे: 2 बजे चला गया','e.g. left at 2 pm')}" ` +
        `aria-label="${esc(w.name)} — ${this.t('नोट','note')}" />` +
        `<button class="btn-primary" data-hz-note-save="${esc(w.id)}">${this.t('सेव','Save')}</button></div>`
      : '';

    return `<div class="worker-notes">${written}${box}</div>`;
  }

  renderAccounts() {
    const ledgers = this.store.getWorkers().map(w=>this.store.getWorkerLedger(w.id));
    const due = ledgers.reduce((n,l)=>n+Math.max(0,l.balanceDue),0);
    const advance = ledgers.reduce((n,l)=>n+Math.max(0,-l.balanceDue),0);
    document.getElementById('accountOverview').innerHTML = `<div class="flow-page-heading"><div><span class="flow-eyebrow">${this.t('टीम का पूरा हिसाब','YOUR TEAM’S ACCOUNTS')}</span><h2>${this.t('कारीगर खाता','Worker accounts')}</h2><p>${this.t('नाम खोजें। बकाया देखें। यहीं से भुगतान लिखें।','Find a person. See their balance. Record a payment.')}</p></div><button class="btn-primary" data-flow="worker">${this.t('+ कारीगर जोड़ें','+ Add worker')}</button></div><div class="account-metrics"><div><small>${this.t('कुल कारीगर / सप्लायर','Workers / suppliers')}</small><strong>${ledgers.length}</strong></div><div><small>${this.t('देना बाकी','Balance due')}</small><strong>${money(due)}</strong></div><div><small>${this.t('दिया हुआ अतिरिक्त / एडवांस','Extra paid / advance')}</small><strong>${money(advance)}</strong></div></div>`;
    document.getElementById('accountFilters').innerHTML = [['all',this.t('सभी','All')],['due',this.t('बकाया','Due')],['advance',this.t('एडवांस','Advance')]].map(([v,l])=>`<button class="flow-filter ${this.accountFilter===v?'active':''}" data-account-filter="${v}" aria-pressed="${this.accountFilter===v}">${l}</button>`).join('');
    const shown = ledgers.filter(l=>`${l.worker.name} ${this.store.getTrade(l.worker.tradeId).name}`.toLocaleLowerCase().includes(this.accountQuery.toLocaleLowerCase()) && (this.accountFilter==='all'||this.accountFilter==='due'&&l.balanceDue>0||this.accountFilter==='advance'&&l.balanceDue<0));
    document.getElementById('accountList').innerHTML = shown.length ? shown.map(l=>`<article class="account-row"><span class="person-initial">${esc(l.worker.name.slice(0,1))}</span><div class="account-person"><button class="flow-worker-name" data-open-statement="${esc(l.worker.id)}">${esc(l.worker.name)}</button><small>${esc(this.store.getTrade(l.worker.tradeId).name)}</small></div><div class="account-balance"><strong>${money(Math.abs(l.balanceDue))}</strong><small>${l.balanceDue<0?this.t('एडवांस दिया','Advance paid'):this.t('देना बाकी','Due')}</small></div><button class="btn-secondary" data-flow-pay="${esc(l.worker.id)}">${this.t('भुगतान','Pay')}</button></article>`).join('') : `<div class="onboarding-empty"><h3>${this.t('कोई खाता नहीं मिला','No accounts found')}</h3><p>${this.t('खोज बदलें या टीम में नया कारीगर जोड़ें।','Change your search or add a worker to your team.')}</p><button class="btn-primary" data-flow="worker">${this.t('+ कारीगर जोड़ें','+ Add worker')}</button></div>`;
  }
  renderReview() {
    const s = this.summary(), txs = this.store.getTransactions(getTodayString());
    const total = txs.reduce((n,t)=>n+Number(t.amount||0),0);
    document.getElementById('dayReview').innerHTML = `<div class="flow-page-heading"><div><span class="flow-eyebrow">${this.t('दिन पूरा करने से पहले','BEFORE YOU FINISH')}</span><h2>${this.t('एक बार हिसाब देख लें।','Let’s wrap up the day.')}</h2><p>${this.t('हाजिरी जाँचें, खर्च मिलाएं और नीचे की पर्ची डायरी में लिख लें।','Check attendance, review expenses, then copy the slip into your diary.')}</p></div></div><div class="review-grid"><button data-flow="attendance" class="review-item ${s.pending?'needs-attention':''}"><span>${s.pending?'○':'✓'}</span><div><strong>${this.t('हाजिरी की जाँच','Attendance check')}</strong><small>${s.pending?this.t(`${s.pending} कारीगर बाकी — पूरा करें`,`${s.pending} workers pending — complete them`):this.t(`${s.marked} कारीगर दर्ज`,`${s.marked} workers recorded`)}</small></div>→</button><button data-flow="transactions" class="review-item"><span>₹</span><div><strong>${money(total)}</strong><small>${this.t(`${txs.length} खर्च / भुगतान एंट्री — देखें`,`${txs.length} expense / payment entries — review`)}</small></div>→</button></div>`;
  }
  openPayment(workerId = '') {
    this.draft = {targetType:'individual',workerId,tradeId:'',type:'cash',amount:'',date:getTodayString(),note:''};
    this.paymentStep = workerId ? 1 : 0;
    this.renderPayment(); document.getElementById('modalFlowPayment').classList.add('open');
  }
  renderPayment() {
    const d = this.draft, step = this.paymentStep;
    document.getElementById('flowPaymentTitle').textContent = this.t('खर्च / भुगतान दर्ज करें','Record an expense / payment');
    document.getElementById('paymentSteps').innerHTML = `<ol class="payment-steps">${[this.t('किसके लिए','Recipient'),this.t('कितना','Amount'),this.t('जाँच और सेव','Review & save')].map((t,i)=>`<li class="${i===step?'active':i<step?'done':''}" ${i===step?'aria-current="step"':''}><span>${i<step?'✓':i+1}</span>${t}</li>`).join('')}</ol>`;
    const box = document.getElementById('paymentBody');
    if (step===0) {
      box.innerHTML = `<h4>${this.t('यह खर्च किसके नाम लिखना है?','Who is this payment for?')}</h4><div class="payment-targets"><button class="${d.targetType==='individual'?'selected':''}" data-payment-target="individual">${icon('team')}<strong>${this.t('एक कारीगर','A worker')}</strong><small>${this.t('नकद, एडवांस या निजी खर्च','Cash, advance or personal expense')}</small></button><button class="${d.targetType==='group'?'selected':''}" data-payment-target="group"><span>▦</span><strong>${this.t('साइट / पूरा ग्रुप','Site / trade group')}</strong><small>${this.t('राशन, सामान या साइट खर्च','Kitchen, material or site expense')}</small></button></div><label class="form-label" for="flowRecipient">${d.targetType==='individual'?this.t('कारीगर चुनें','Choose a worker'):this.t('ट्रेड / ग्रुप चुनें','Choose a trade / group')}</label><select class="form-select" id="flowRecipient"><option value="">${this.t('चुनें…','Choose…')}</option>${(d.targetType==='individual'?this.store.getWorkers():this.store.getTrades()).map(w=>`<option value="${esc(w.id)}" ${(d.targetType==='individual'?d.workerId:d.tradeId)===w.id?'selected':''}>${esc(w.name)}</option>`).join('')}</select>${d.targetType==='individual'?`<label class="form-label payment-search-label" for="paymentWorkerSearch">${this.t('नाम से जल्दी ढूँढें','Find a worker by name')}</label><input id="paymentWorkerSearch" class="form-input" type="search" placeholder="${this.t('कारीगर का नाम','Worker name')}" />`:''}<div class="payment-help">${this.t('नाम नहीं है? पहले टीम में कारीगर जोड़ें।','Name missing? Add the worker to your team first.')} <button class="flow-link" data-flow="paymentAddWorker">${this.t('+ जोड़ें','+ Add')}</button></div><p class="flow-error" id="paymentError" role="alert"></p><div class="modal-actions"><button class="btn-primary" data-payment-next>${this.t('आगे बढ़ें','Continue')} →</button></div>`;
    } else if (step===1) {
      const recipient = d.targetType==='individual'?this.store.getWorker(d.workerId):this.store.getTrade(d.tradeId);
      box.innerHTML = `<div class="payment-recipient"><span class="person-initial">${esc(recipient?.name?.slice(0,1))}</span><div><small>${this.t('इनके नाम दर्ज होगा','Recording against')}</small><strong>${esc(recipient?.name)}</strong></div><button class="flow-link" data-payment-back>${this.t('बदलें','Change')}</button></div><form id="flowAmountForm"><label class="form-label" for="flowAmount">${this.t('कुल रकम (₹)','Total amount (₹)')}</label><input class="form-input flow-amount" id="flowAmount" type="number" inputmode="decimal" min="0.01" step="0.01" required value="${esc(d.amount)}" placeholder="0" /><div class="amount-presets">${[100,500,1000,2000].map(n=>`<button type="button" data-payment-amount="${n}">${money(n)}</button>`).join('')}</div><div class="payment-fields"><div><label class="form-label" for="flowType">${this.t('खर्च का प्रकार','Expense type')}</label><select id="flowType" class="form-select">${[['cash',this.t('नकद / पेशगी','Cash / advance')],['ration',this.t('राशन','Kitchen / ration')],['material',this.t('सामान','Material')],['diesel',this.t('डीजल','Diesel')],['recharge',this.t('रिचार्ज','Recharge')],['other',this.t('अन्य','Other')]].map(([v,l])=>`<option value="${v}" ${d.type===v?'selected':''}>${l}</option>`).join('')}</select></div><div><label class="form-label" for="flowDate">${this.t('तारीख','Date')}</label><input class="form-input" id="flowDate" type="date" required max="${getTodayString()}" value="${esc(d.date)}" /></div></div><label class="form-label" for="flowNote">${this.t('विवरण / सामान (वैकल्पिक)','Note / item (optional)')}</label><input class="form-input" id="flowNote" value="${esc(d.note)}" placeholder="${this.t('जैसे: चावल 10 किलो','e.g. Rice, 10 kg')}" /><p class="flow-error" id="paymentError" role="alert"></p><div class="modal-actions"><button type="button" class="btn-secondary" data-payment-back>${this.t('पीछे','Back')}</button><button type="submit" class="btn-primary">${this.t('जाँचें','Review')} →</button></div></form>`;
    } else {
      const worker = this.store.getWorker(d.workerId), recipient = d.targetType==='individual'?worker:this.store.getTrade(d.tradeId);
      const ledger = worker && d.targetType==='individual' ? this.store.getWorkerLedger(worker.id) : null;
      box.innerHTML = `<div class="payment-review"><span class="flow-eyebrow">${this.t('सेव करने से पहले जाँच लें','CHECK BEFORE SAVING')}</span><h2>${money(d.amount)}</h2><strong>${esc(recipient?.name)}</strong><dl><div><dt>${this.t('तारीख','Date')}</dt><dd>${esc(d.date)}</dd></div><div><dt>${this.t('प्रकार','Type')}</dt><dd>${esc(this.paymentTypeLabel)}</dd></div><div><dt>${this.t('विवरण','Note')}</dt><dd>${esc(d.note || '—')}</dd></div>${ledger?`<div><dt>${this.t('इसके बाद शुद्ध बकाया','Balance after this entry')}</dt><dd>${money(ledger.balanceDue-Number(d.amount))}</dd></div>`:''}</dl><p>${this.t('यह हिसाब की एंट्री है। इससे बैंक से पैसा नहीं भेजा जाएगा।','This records a ledger entry. It does not transfer money.')}</p></div><p class="flow-error" id="paymentError" role="alert"></p><div class="modal-actions"><button class="btn-secondary" data-payment-back>${this.t('सुधारें','Edit')}</button><button class="btn-primary" data-payment-save>${this.t('✓ एंट्री सेव करें','✓ Save entry')}</button></div>`;
    }
    const card = document.querySelector('#modalFlowPayment .modal-card');
    card.scrollTop = 0;
    if (document.getElementById('modalFlowPayment').classList.contains('open')) card.focus({preventScroll:true});
  }
  captureAmount() {
    for (const [key,id] of [['amount','flowAmount'],['date','flowDate'],['note','flowNote'],['type','flowType']]) this.draft[key] = document.getElementById(id).value;
    this.paymentTypeLabel = document.getElementById('flowType').selectedOptions[0].textContent;
  }
  paymentError(message) { document.getElementById('paymentError').textContent = message; }
  bind() {
    // Enter saves the note: the keyboard is open and the thumb is already there.
    document.addEventListener('keydown', e => {
      if(e.target.id!=='workerNoteInput' || e.key!=='Enter') return;
      e.preventDefault();
      document.querySelector('[data-hz-note-save]')?.click();
    });
    document.addEventListener('input', e => {
      if (e.target.id==='rosterSearch') { this.query=e.target.value; this.renderAttendance(); }
      if (e.target.id==='accountSearch') { this.accountQuery=e.target.value; this.renderAccounts(); }
      if (e.target.id==='paymentWorkerSearch') {
        const select=document.getElementById('flowRecipient'), query=e.target.value.toLocaleLowerCase();
        select.innerHTML=`<option value="">${this.t('चुनें…','Choose…')}</option>`+this.store.getWorkers().filter(w=>w.name.toLocaleLowerCase().includes(query)).map(w=>`<option value="${esc(w.id)}" ${this.draft.workerId===w.id?'selected':''}>${esc(w.name)}</option>`).join('');
      }
    });
    document.addEventListener('change',e=>{
      if(e.target.id==='flowRecipient') this.draft[this.draft.targetType==='individual'?'workerId':'tradeId']=e.target.value;
    });
    document.addEventListener('submit',e=>{
      if(e.target.id!=='flowAmountForm') return;
      e.preventDefault(); this.captureAmount();
      if(validatePayment(this.draft,this.store.getWorkers(),this.store.getTrades(),getTodayString())) return this.paymentError(this.t('सही नाम, रकम और तारीख भरें।','Check recipient, amount and date.'));
      this.paymentStep=2; this.renderPayment();
    });
    document.addEventListener('click', e => {
      const btn=e.target.closest('button'); if(!btn) return;
      const data=btn.dataset;
      if(data.flowPay) this.openPayment(data.flowPay);
      if(data.rosterFilter) { this.status=data.rosterFilter; this.renderAttendance(); }
      if(data.accountFilter) { this.accountFilter=data.accountFilter; this.renderAccounts(); }
      if(data.hzNote) {
        // Keep whatever is half-typed in the box that is open, so opening a
        // second row does not silently throw the first one away.
        const live=document.getElementById('workerNoteInput');
        if(live) this.noteDraft=live.value;
        this.noteOpenFor = this.noteOpenFor===data.hzNote ? null : data.hzNote;
        if(this.noteOpenFor!==data.hzNote) this.noteDraft='';
        this.renderAttendance();
        document.getElementById('workerNoteInput')?.focus();
      }
      if(data.hzNoteSave) {
        const input=document.getElementById('workerNoteInput'), text=(input?.value||'').trim();
        if(!text) { input?.focus(); return; }
        this.store.addSiteNote({date:this.app.selectedHaziriDate, text, workerId:data.hzNoteSave, tradeId:this.store.getWorker(data.hzNoteSave)?.tradeId||null});
        this.noteOpenFor=null; this.noteDraft='';
        this.app.commit('site-note');
      }
      if(data.flowAttendance) {
        const date=this.app.selectedHaziriDate, r=this.store.getHaziri(date)[data.flowAttendance];
        this.store.setWorkerHaziri(date,data.flowAttendance,Number(data.value),Number(data.value)>0?r?.otHours||0:0,r?.reason||'');
        this.app.commit('haziri');
      }
      if(data.paymentTarget) { this.draft.targetType=data.paymentTarget; this.draft.type=data.paymentTarget==='group'?'ration':'cash'; this.renderPayment(); }
      if(data.paymentNext!==undefined) {
        this.draft[this.draft.targetType==='individual'?'workerId':'tradeId']=document.getElementById('flowRecipient').value;
        if(!document.getElementById('flowRecipient').value) return this.paymentError(this.t('पहले नाम चुनें।','Choose a recipient first.'));
        this.paymentStep=1; this.renderPayment();
      }
      if(data.paymentBack!==undefined) { if(this.paymentStep===1) this.captureAmount(); this.paymentStep--; this.renderPayment(); }
      if(data.paymentAmount) document.getElementById('flowAmount').value=data.paymentAmount;
      if(data.paymentSave!==undefined && !this.saving) {
        const d=this.draft;
        if(validatePayment(d,this.store.getWorkers(),this.store.getTrades(),getTodayString())) return this.paymentError(this.t('जानकारी बदल गई है। पीछे जाकर फिर जाँचें।','Details have changed. Go back and review.'));
        this.saving=true; btn.disabled=true;
        try {
          const savedTx=this.store.addTransaction({...d,amount:Number(d.amount),tradeId:d.targetType==='individual'?this.store.getWorker(d.workerId).tradeId:d.tradeId,workerId:d.targetType==='individual'?d.workerId:null});
          if(this.store.hasUnsavedChanges()) {
            // Remove only this failed, unpersisted insert; keep the form for retry.
            const transactions=this.store.getTransactions();
            const index=transactions.findIndex(t=>t.id===savedTx.id);
            if(index>=0) transactions.splice(index,1);
            this.paymentError(this.t('सेव नहीं हुआ। जगह खाली करें और फिर सेव दबाएं।','Could not save. Free storage and try Save again.')); return;
          }
          this.app.closeModals(); this.app.commit(); this.app.timelineDateMode=d.date===getTodayString()?'today':'custom'; this.app.timelineCustomDate=d.date;
          document.getElementById('timelineDatePreset').value=this.app.timelineDateMode;
          const picker=document.getElementById('timelineDatePicker'); picker.value=d.date; picker.style.display=this.app.timelineDateMode==='custom'?'':'none';
          this.app.activeFilterType='all'; this.app.timelineSearchQuery=''; document.getElementById('timelineSearchInput').value='';
          document.querySelectorAll('[data-filter-type]').forEach(b=>b.classList.toggle('active',b.dataset.filterType==='all'));
          this.app.renderTimeline(); this.app.goToTab('tab-timeline'); this.app.showToast(this.t('✓ एंट्री सेव हुई — लेन-देन में दिख रही है','✓ Entry saved — shown in transactions'));
        } finally { this.saving=false; btn.disabled=false; }
      }
      const action=data.flow;
      const routes={home:'tab-home',attendance:'tab-haziri',monthly:'tab-monthly',transactions:'tab-timeline',accounts:'tab-groups',diary:'tab-diary'};
      if(routes[action]) this.app.goToTab(routes[action]);
      if(action==='worker') this.app.openAddWorkerModal();
      if(action==='payment') this.openPayment();
      if(action==='advanced') this.app.openAddTransactionModal({});
      if(action==='paymentAddWorker') { this.app.closeModals(); this.app.openAddWorkerModal(); }
      if(action==='clearRoster') { this.query=''; this.status='all'; this.app.activeHaziriTradeId='all'; document.getElementById('rosterSearch').value=''; this.renderAttendance(); }
      if(action==='markVisible') {
        const date=this.app.selectedHaziriDate, records=this.store.getHaziri(date);
        this.visibleWorkers.filter(w=>!records[w.id]).forEach(w=>this.store.setWorkerHaziri(date,w.id,1));
        this.app.commit('haziri');
      }
      /* When the power stays off, a whole trade loses the day at once. Marking
         it man by man is eleven taps and no record of why — so the reason is
         asked once, written onto every row, and kept as one note under that
         group's name, which is what the diary needs to read back. */
      if(action==='absentVisible') {
        if(!this.visibleWorkers.length) return;
        const label=this.visibleGroupLabel();
        const reason=prompt(this.t(`${label}: गैरहाजिरी का कारण (जैसे: लाइट नहीं आई)`,`${label}: reason for absence (e.g. no power)`),'');
        if(reason===null) return;                     // cancelled — nothing touched
        const date=this.app.selectedHaziriDate, records=this.store.getHaziri(date);
        const why=reason.trim();
        this.visibleWorkers.forEach(w=>this.store.setWorkerHaziri(date,w.id,0,0,why));
        const tradeId=this.app.activeHaziriTradeId!=='all'?this.app.activeHaziriTradeId:null;
        if(why) this.store.addSiteNote({date,tradeId,text:this.t(`${label} गैरहाजिर — ${why}`,`${label} absent — ${why}`)});
        this.app.commit('haziri');
        this.app.showToast(this.t(`${label}: ${this.visibleWorkers.length} कारीगर गैरहाजिर`,`${label}: ${this.visibleWorkers.length} marked absent`));
      }
      if(action==='submitHaziri') {
        const date=this.app.selectedHaziriDate, s=this.summary(date);
        if(s.pending && !confirm(this.t(`${s.pending} कारीगर की हाजिरी अभी बाकी है। फिर भी दिन पक्का करें?`,`${s.pending} workers are still unmarked. Submit the day anyway?`))) return;
        if(!this.store.submitHaziri(date)) return;
        this.app.commit('haziri');
        this.app.showToast(this.t('✓ आज की हाजिरी पक्की — अब डायरी में लिख लें','✓ Attendance submitted — now write it in your diary'),3200);
      }
    });
  }
}
