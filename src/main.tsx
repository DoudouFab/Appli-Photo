import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

let lastUpdateCheck = 0;

registerSW({
  immediate: true,
  onRegisteredSW(swUrl, registration) {
    if (!registration) return;

    const checkForUpdates = async () => {
      const now = Date.now();
      if (now - lastUpdateCheck < 15_000) return;
      lastUpdateCheck = now;
      if (!navigator.onLine) return;

      try {
        await fetch(swUrl, {
          cache: 'no-cache',
          headers: {
            'cache-control': 'no-cache',
          },
        });
      } catch {
        // Ignore network revalidation error
      }

      registration.update().catch(() => {});
    };

    setTimeout(checkForUpdates, 2500);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        checkForUpdates();
      }
    });
    window.addEventListener('online', checkForUpdates);
  },
});

createRoot(document.getElementById('root')!).render(<App />);
