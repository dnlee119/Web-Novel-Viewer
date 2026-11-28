export function createSceneMenu(root, signal) {
  const document = root.ownerDocument;
  const window = document.defaultView;
  const menu = document.createElement('div');
  menu.className = 'wne-scene-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  root.append(menu);
  let trigger;
  let anchorOffset;

  function focusItem(item) {
    if (!item) return;
    item.focus({ preventScroll: true });
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < menu.scrollTop) menu.scrollTop = top;
    else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight;
  }

  function close(restoreFocus = false) {
    if (!trigger) return;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus({ preventScroll: true });
    trigger = undefined;
  }

  function positionMenu() {
    if (!trigger) return;
    const rootBox = root.getBoundingClientRect();
    const anchor = trigger.getBoundingClientRect();
    const x = anchor.left + (anchorOffset?.x ?? 0);
    const y = anchor.top + (anchorOffset?.y ?? anchor.height);
    const left = Math.max(4, Math.min(x, window.innerWidth - menu.offsetWidth - 4));
    const top = Math.max(4, Math.min(y, window.innerHeight - menu.offsetHeight - 4));
    menu.style.left = (left - rootBox.left - root.clientLeft) + 'px';
    menu.style.top = (top - rootBox.top - root.clientTop) + 'px';
  }

  function toggle(button, label, commands, point) {
    if (trigger === button && !point) {
      close(true);
      return;
    }
    close();
    trigger = button;
    const anchor = button.getBoundingClientRect();
    anchorOffset = point ? { x: point.x - anchor.left, y: point.y - anchor.top } : undefined;
    menu.setAttribute('aria-label', label);
    menu.replaceChildren();
    for (const command of commands) {
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.textContent = command.label;
      item.tabIndex = -1;
      item.disabled = Boolean(command.disabled);
      item.addEventListener('click', () => {
        close(true);
        command.run();
      });
      menu.append(item);
    }
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    positionMenu();
    focusItem(menu.querySelector('button:not(:disabled)'));
  }

  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Tab' || event.key === 'Escape') {
      if (event.key === 'Escape') event.preventDefault();
      close(true);
      return;
    }
    const items = [...menu.querySelectorAll('button:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    const destination = {
      ArrowDown: (index + 1) % items.length,
      ArrowUp: (index + items.length - 1) % items.length,
      Home: 0,
      End: items.length - 1,
    }[event.key];
    if (!Number.isInteger(destination)) return;
    event.preventDefault();
    focusItem(items[destination]);
  });

  document.addEventListener('pointerdown', (event) => {
    if (trigger && !trigger.contains(event.target) && !menu.contains(event.target)) close();
  }, { signal });
  document.addEventListener('focusin', (event) => {
    if (trigger && !trigger.contains(event.target) && !menu.contains(event.target)) close();
  }, { signal });
  document.addEventListener('scroll', (event) => {
    if (!menu.contains(event.target)) positionMenu();
  }, { capture: true, signal });
  window.addEventListener('resize', positionMenu, { signal });
  return { toggle, close };
}
