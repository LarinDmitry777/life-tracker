export function enableTaskDrag(list, { onDrop, onCancel }) {
  let drag;

  function placeRow() {
    const { row, y, grabOffset, offset } = drag;
    const next = [...list.children].find((candidate) => {
      if (candidate === row) return false;
      const rect = candidate.getBoundingClientRect();
      return y < rect.top + rect.height / 2;
    }) ?? null;
    if (row.nextElementSibling !== next) list.insertBefore(row, next);

    const top = row.getBoundingClientRect().top - offset;
    drag.offset = y - grabOffset - top;
    row.style.transform = `translateY(${drag.offset}px)`;
  }

  function dragFrame() {
    const edge = 64;
    const height = window.visualViewport?.height ?? window.innerHeight;
    const above = Math.max(0, edge - drag.y);
    const below = Math.max(0, drag.y - (height - edge));
    const scroll = Math.max(-18, Math.min(18, (below - above) / 4));
    if (scroll) window.scrollBy(0, scroll);
    placeRow();
    drag.frame = requestAnimationFrame(dragFrame);
  }

  function finish(commit) {
    const current = drag;
    drag = undefined;
    if (!current?.started) return;

    cancelAnimationFrame(current.frame);
    current.row.classList.remove('is-dragging');
    current.row.style.removeProperty('transform');
    if (commit) {
      const id = current.row.dataset.taskId;
      onDrop(id, [...list.children].map((row) => row.dataset.taskId));
    } else {
      onCancel();
    }
    if (current.restoreFocus && current.handle.isConnected) current.handle.focus({ preventScroll: true });
  }

  list.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('.drag-handle');
    if (!handle || drag || !event.isPrimary || event.button !== 0) return;
    const row = handle.closest('.task-item');
    drag = {
      pointerId: event.pointerId,
      handle,
      row,
      startX: event.clientX,
      startY: event.clientY,
      grabOffset: event.clientY - row.getBoundingClientRect().top,
      offset: 0,
    };
  });

  window.addEventListener('pointermove', (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    drag.y = event.clientY;
    if (!drag.started) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
      if (!drag.row.isConnected || drag.handle.closest('details').hidden) {
        finish(false);
        return;
      }
      drag.started = true;
      drag.restoreFocus = document.activeElement === drag.handle;
      list.setPointerCapture(event.pointerId);
      for (const menu of list.querySelectorAll('.task-order[open]')) menu.open = false;
      drag.row.classList.add('is-dragging');
      dragFrame();
    }
    if (event.cancelable) event.preventDefault();
  }, { passive: false });

  window.addEventListener('pointerup', (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    if (drag.started) {
      drag.y = event.clientY;
      placeRow();
    }
    finish(true);
  });

  window.addEventListener('pointercancel', (event) => {
    if (drag?.pointerId === event.pointerId) finish(false);
  });
  list.addEventListener('lostpointercapture', (event) => {
    if (event.target === list && drag?.pointerId === event.pointerId) finish(false);
  });
  window.addEventListener('blur', () => finish(false));

  return {
    active: () => Boolean(drag?.started),
    cancel: () => finish(false),
  };
}
