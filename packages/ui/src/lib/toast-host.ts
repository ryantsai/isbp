/**
 * Native modal dialogs make everything outside them inert, including top-layer popovers. Keep the single toast
 * portal inside the most recently opened modal, and return it to the body when that modal closes. Moving the host
 * (not replacing the React portal) preserves toast timers, actions and dismiss state across nested dialogs.
 */
export function attachToastHost(host: HTMLElement) {
  const doc = host.ownerDocument;
  let dialogs = Array.from(doc.querySelectorAll<HTMLDialogElement>('dialog:modal'));

  const sync = () => {
    dialogs = dialogs.filter((dialog) => dialog.isConnected && dialog.matches(':modal'));
    const parent = dialogs.at(-1) ?? doc.body;
    if (host.parentElement === parent) return;
    const viewport = host.querySelector<HTMLElement>(':scope > [popover]');
    const focused =
      doc.activeElement instanceof HTMLElement && host.contains(doc.activeElement) ? doc.activeElement : null;
    // Top-layer order is insertion order, not z-index. Re-open above the newly opened dialog after moving it.
    if (viewport?.matches(':popover-open')) viewport.hidePopover();
    parent.appendChild(host);
    viewport?.showPopover();
    focused?.focus({ preventScroll: true });
  };

  sync();
  const observer = new MutationObserver((records) => {
    let changed = dialogs.some((dialog) => !dialog.isConnected);
    for (const record of records) {
      if (record.type !== 'attributes' || !(record.target instanceof HTMLDialogElement)) continue;
      const dialog = record.target;
      dialogs = dialogs.filter((entry) => entry !== dialog);
      if (dialog.isConnected && dialog.matches(':modal')) dialogs.push(dialog);
      changed = true;
    }
    // Child-list changes only matter when an active modal was removed. Do not scan the page on every render.
    if (changed) sync();
  });
  observer.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
  return () => {
    observer.disconnect();
    host.remove();
  };
}
