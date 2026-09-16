// Device-local screen privacy. The ledger/cloud backup itself is not encrypted.
const KEY = 'site_diary_lending_lock_v1';
const ATTEMPTS_KEY = `${KEY}_attempts`;
const ITERATIONS = 210000;

export async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations: ITERATIONS }, key, 256);
  return Array.from(new Uint8Array(bits), n => n.toString(16).padStart(2, '0')).join('');
}

export class LendingLock {
  constructor(onLock) {
    this.onLock = onLock;
    this.unlocked = false;
    this.generation = 0;
  }

  lock() {
    this.generation++;
    this.unlocked = false;
    clearTimeout(this.timer);
    this.dialog?.close();
    this.onLock();
  }

  touch() {
    clearTimeout(this.timer);
    if (this.unlocked) this.timer = setTimeout(() => this.lock(), 120000);
  }

  async request({ change = false } = {}) {
    if (this.dialog?.open) return false;
    if (this.unlocked && !change) return true;
    const generation = this.generation;
    let existing;
    try {
      const raw = localStorage.getItem(KEY);
      existing = raw === null ? null : JSON.parse(raw);
      if (raw !== null && (!existing || !Array.isArray(existing.salt) || existing.salt.length !== 16 || !/^[a-f0-9]{64}$/.test(existing.hash))) throw new Error();
    } catch {
      alert('पासवर्ड की जानकारी पढ़ी नहीं जा सकी। उधार अभी बंद रहेगा।');
      return false;
    }
    const setup = !existing;
    const dialog = document.createElement('dialog');
    dialog.className = 'lending-password-dialog';
    dialog.setAttribute('aria-labelledby', 'lendingPasswordTitle');
    dialog.innerHTML = `
      <form>
        <h3 id="lendingPasswordTitle">🔒 ${setup ? 'उधार का पासवर्ड बनाएँ' : change ? 'पासवर्ड बदलें' : 'उधार खोलें'}</h3>
        <p>${setup ? 'इस फ़ोन पर उधार देखने के लिए यह पासवर्ड लगेगा। इसे याद रखें — पासवर्ड भूलने पर इसे वापस नहीं पाया जा सकता।' : 'अपना पासवर्ड भरें।'}</p>
        ${!setup ? '<label class="form-label" for="lendingCurrentPassword">मौजूदा पासवर्ड</label><input id="lendingCurrentPassword" class="form-input" type="password" autocomplete="current-password" required />' : ''}
        ${setup || change ? '<label class="form-label" for="lendingNewPassword">नया पासवर्ड (कम से कम 6 अक्षर या अंक)</label><input id="lendingNewPassword" class="form-input" type="password" minlength="6" autocomplete="new-password" required /><label class="form-label" for="lendingConfirmPassword">पासवर्ड दोबारा भरें</label><input id="lendingConfirmPassword" class="form-input" type="password" minlength="6" autocomplete="new-password" required />' : ''}
        <p class="lending-password-error" role="alert"></p>
        <div class="lending-lock-actions"><button class="btn-secondary" type="button">रद्द करें</button><button class="btn-primary" type="submit">${setup || change ? 'पासवर्ड सेव करें' : 'खोलें'}</button></div>
      </form>`;
    document.body.append(dialog);
    this.dialog = dialog;
    return new Promise(resolve => {
      let success = false;
      dialog.addEventListener('close', () => {
        dialog.querySelector('form').reset();
        dialog.remove();
        if (this.dialog === dialog) this.dialog = null;
        resolve(success);
      }, { once: true });
      dialog.querySelector('[type="button"]').onclick = () => dialog.close();
      dialog.querySelector('form').onsubmit = async event => {
        event.preventDefault();
        const submit = dialog.querySelector('[type="submit"]');
        if (submit.disabled) return;
        submit.disabled = true;
        const error = dialog.querySelector('[role="alert"]');
        error.textContent = '';
        try {
          const attempts = JSON.parse(localStorage.getItem(ATTEMPTS_KEY) || '{}');
          if (attempts.until > Date.now()) throw new Error('कई बार गलत पासवर्ड डाला गया है। एक मिनट बाद कोशिश करें।');
          const newPassword = dialog.querySelector('#lendingNewPassword')?.value;
          if ((setup || change) && (newPassword.length < 6 || newPassword !== dialog.querySelector('#lendingConfirmPassword').value)) {
            throw new Error('दोनों पासवर्ड एक जैसे और कम से कम 6 अक्षर या अंक के होने चाहिए।');
          }
          if (existing) {
            const hash = await passwordHash(dialog.querySelector('#lendingCurrentPassword').value, existing.salt);
            if (!dialog.open || generation !== this.generation) return;
            if (hash !== existing.hash) {
              const count = (attempts.count || 0) + 1;
              localStorage.setItem(ATTEMPTS_KEY, JSON.stringify({ count: count >= 5 ? 0 : count, until: count >= 5 ? Date.now() + 60000 : 0 }));
              throw new Error(count >= 5 ? 'कई बार गलत पासवर्ड डाला गया है। एक मिनट बाद कोशिश करें।' : 'पासवर्ड सही नहीं है। दोबारा कोशिश करें।');
            }
          }
          if (setup || change) {
            const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)));
            const hash = await passwordHash(newPassword, salt);
            if (!dialog.open || generation !== this.generation) return;
            localStorage.setItem(KEY, JSON.stringify({ salt, hash }));
          }
          if (!dialog.open || generation !== this.generation) return;
          localStorage.removeItem(ATTEMPTS_KEY);
          this.unlocked = true;
          this.touch();
          success = true;
          dialog.close();
        } catch (err) {
          error.textContent = err instanceof TypeError || err instanceof DOMException ? 'पासवर्ड सेव या जाँच नहीं हो सकी। दोबारा कोशिश करें।' : err.message;
        } finally {
          submit.disabled = false;
        }
      };
      dialog.showModal();
    });
  }
}
