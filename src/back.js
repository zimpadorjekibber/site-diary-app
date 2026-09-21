/* Going back.

   The app had no way back. On Android the hardware button and the swipe
   gesture went straight past it and closed the whole app — with a modal open,
   mid-entry, whatever was on screen. A contractor's reflex after opening the
   monthly register is to swipe back, and the reflex was punished.

   There is no Capacitor back-button plugin here, and adding one would mean a
   new native dependency for something the WebView already does: Capacitor's
   activity sends the hardware back to the WebView's own history when there is
   history to walk. So the fix is to give it history.

   The pattern is a re-armed trap. While there is somewhere to go back to, one
   spare history entry is kept on the stack. Pressing back consumes it, we undo
   one step of navigation ourselves, and if there is still somewhere to go, we
   arm another. On the home screen with nothing open, no entry is armed, so the
   next press leaves the app — which is what it should do.

   Keeping a real mirror of the navigation stack was the other option, and it
   drifts: a modal closed by its own × button, or by the backdrop, silently
   puts the stack one ahead of the screen. Reading the screen at the moment
   back is pressed cannot drift, because the screen is the truth. */

const HOME = 'tab-home';

export class BackNav {
  constructor(app) {
    this.app = app;
    this.armed = false;
    this.restoring = false;
    /* Where back should land, per screen. Two tabs are reached from inside
       another screen rather than from the bottom bar, so for them "back" means
       the screen that opened them, not home. */
    this.parents = { 'tab-monthly': 'tab-haziri', 'tab-lending': HOME };

    this.installButton();
    this.hookTabs();
    this.watchModals();
    window.addEventListener('popstate', () => this.onPop());
    this.update();
  }

  t(hi, en) { return this.app.currentLang === 'en' ? en : hi; }

  installButton() {
    const header = document.querySelector('.app-header');
    if (!header) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'btnAppBack';
    btn.className = 'btn-app-back';
    btn.hidden = true;
    btn.innerHTML = '<span aria-hidden="true">←</span>';
    // Same road as the hardware button, so there is only one behaviour to trust.
    btn.addEventListener('click', () => this.back());
    header.prepend(btn);
    this.button = btn;
  }

  /* Every tab change goes through the app's own goToTab, so wrapping it once
     catches the bottom bar, the shortcut cards and the flow buttons alike. */
  hookTabs() {
    const original = this.app.goToTab.bind(this.app);
    this.app.goToTab = (tabId) => {
      original(tabId);
      this.update();
    };
  }

  /* Modals are opened from fourteen places by adding one class. Watching the
     class is one hook instead of fourteen, and it cannot be forgotten by the
     fifteenth. */
  watchModals() {
    const observer = new MutationObserver(() => this.update());
    document.querySelectorAll('.modal-overlay').forEach(m =>
      observer.observe(m, { attributes: true, attributeFilter: ['class'] }));
    this.observer = observer;
  }

  openModal() { return document.querySelector('.modal-overlay.open'); }

  canGoBack() { return !!this.openModal() || this.app.currentTab !== HOME; }

  /** One step back. Returns false when there is nowhere left to go. */
  step() {
    if (this.openModal()) { this.app.closeModals(); return true; }
    const tab = this.app.currentTab;
    if (tab !== HOME) {
      this.restoring = true;
      try { this.app.goToTab(this.parents[tab] || HOME); } finally { this.restoring = false; }
      return true;
    }
    return false;
  }

  /** The on-screen button: walk the real history so both paths behave alike. */
  back() {
    if (this.armed) {
      history.back();      // popstate does the rest, exactly as the hardware key does
      return;
    }
    // Only reachable if the entry was spent elsewhere; undo directly.
    if (this.step()) this.update();
  }

  onPop() {
    this.armed = false;          // the spare entry has just been consumed
    if (this.step()) this.update();
    // Nothing to undo: the entry is spent and the next press closes the app.
  }

  update() {
    if (this.restoring) return;
    const can = this.canGoBack();
    if (can && !this.armed) {
      history.pushState({ sdBack: true }, '');
      this.armed = true;
    } else if (!can && this.armed) {
      /* A modal closed by its own ×, or by the backdrop, leaves the spare
         entry unspent. Left there it eats the next back press in silence —
         the contractor presses back on the home screen and nothing happens.
         Spend it now: onPop finds nothing to undo and stops, so the press
         after this one leaves the app, as it should. */
      this.armed = false;
      history.back();
    }
    if (this.button) {
      this.button.hidden = !can;
      const label = this.openModal()
        ? this.t('बंद करें', 'Close')
        : this.t('पीछे जाएँ', 'Go back');
      this.button.title = label;
      this.button.setAttribute('aria-label', label);
    }
  }
}
