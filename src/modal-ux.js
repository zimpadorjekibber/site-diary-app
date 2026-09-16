// Keep existing modal entry points, while giving every form the same focus,
// keyboard and background-scroll behavior.
export function initModalUX() {
  const overlays = [...document.querySelectorAll('.modal-overlay')];
  let stack = [];
  let returnFocus = null;
  const background = new Map();
  const restoreBackground = () => {
    for (const [element, inert] of background) element.inert = inert;
    background.clear();
  };
  const focusable = modal => [...modal.querySelectorAll(
    'button, input, select, textarea, a[href], [tabindex]'
  )].filter(el => !el.disabled && el.tabIndex >= 0 && !el.closest('[inert]') && el.getClientRects().length);

  const sync = () => {
    restoreBackground();
    const previous = stack.at(-1);
    const open = overlays.filter(el => el.classList.contains('open'));
    stack = [...stack.filter(el => open.includes(el)), ...open.filter(el => !stack.includes(el))];
    const top = stack.at(-1);
    for (const modal of overlays) {
      modal.inert = modal !== top;
      modal.setAttribute('aria-hidden', String(modal !== top));
    }
    document.body.classList.toggle('has-open-modal', Boolean(top));
    if (!top) {
      if (previous && returnFocus?.isConnected && !returnFocus.closest('[inert]')) returnFocus.focus({ preventScroll: true });
      returnFocus = null;
      return;
    }
    if (!previous) returnFocus = document.activeElement;
    // A modal can live inside the app wrapper. Inert only its siblings at
    // each ancestor level, never an ancestor containing the active form.
    let branch = top;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling === branch || ['SCRIPT', 'STYLE', 'LINK', 'DIALOG'].includes(sibling.tagName)) continue;
        background.set(sibling, sibling.inert);
        sibling.inert = true;
      }
      if (branch.parentElement === document.body) break;
      branch = branch.parentElement;
    }
    if (previous !== top) {
      const card = top.querySelector('.modal-card');
      card.scrollTop = 0;
      // Focus the heading/card instead of opening the phone keyboard at once.
      card.focus({ preventScroll: true });
    }
  };

  overlays.forEach((modal, index) => {
    const card = modal.querySelector('.modal-card');
    if (!card) return;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.tabIndex = -1;
    const title = card.querySelector('.modal-title');
    if (title) {
      title.id ||= `modal-heading-${index}`;
      card.setAttribute('aria-labelledby', title.id);
    }
    modal.querySelectorAll('.btn-close-modal').forEach(button => button.setAttribute('aria-label', 'बंद करें / Close'));
    new MutationObserver(sync).observe(modal, { attributes: true, attributeFilter: ['class'] });
  });
  document.addEventListener('keydown', event => {
    const top = stack.at(-1);
    if (!top || document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      top.classList.remove('open');
    }
    if (event.key === 'Tab') {
      const items = focusable(top);
      const first = items[0];
      const last = items.at(-1);
      if (!first) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !items.includes(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  sync();
}
