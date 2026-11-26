// This entry point is used by HTML cached before the application had release-specific URLs.
const url = new URL(location.href);
const recoveryParam = 'life-tracker-update';

function waitForActivation(worker) {
  if (!worker || ['activated', 'redundant'].includes(worker.state)) return;

  return new Promise((resolve) => {
    const timer = setTimeout(finish, 8000);
    worker.addEventListener('statechange', checkState);
    checkState();

    function checkState() {
      if (['activated', 'redundant'].includes(worker.state)) finish();
    }

    function finish() {
      clearTimeout(timer);
      worker.removeEventListener('statechange', checkState);
      resolve();
    }
  });
}

if (url.searchParams.has(recoveryParam)) {
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.textContent = 'Не удалось загрузить обновление Life Tracker. Откройте главную страницу снова при подключении к сети.';
  document.body.prepend(message);
} else {
  if ('serviceWorker' in navigator) {
    try {
      const workerUrl = new URL('./sw.js', import.meta.url);
      const registration = await navigator.serviceWorker.register(workerUrl, { updateViaCache: 'none' });
      if (!registration.installing && !registration.waiting) await registration.update();
      await waitForActivation(registration.installing ?? registration.waiting ?? registration.active);
    } catch (error) {
      console.warn('Life Tracker: не удалось обновить автономную версию.', error);
    }
  }

  url.searchParams.set(recoveryParam, String(Date.now()));
  location.replace(url);
}
