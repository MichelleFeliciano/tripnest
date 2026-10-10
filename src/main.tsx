import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import { routerBasename } from './lib/appUrl';
import './styles.css';

// A new version replaces old files on the server. If a screen's file is gone, reload once to pick up the new version.
const RELOAD_FLAG = 'tripnest:reloaded-for-update';
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (!sessionStorage.getItem(RELOAD_FLAG)) {
      sessionStorage.setItem(RELOAD_FLAG, '1');
      event.preventDefault();
      window.location.reload();
    }
  } catch { /* storage unavailable: fall through to the error page */ }
});
window.addEventListener('load', () => setTimeout(() => { try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* ignore */ } }, 5000));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <BrowserRouter basename={routerBasename()}>
          <App />
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// Offline support: after the first visit the whole app is cached, so it opens without a connection.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  });
}
