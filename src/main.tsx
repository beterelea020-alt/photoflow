import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import '@fontsource-variable/noto-sans-arabic/wght.css';
import App from './App';
import './styles.css';
import './mobile.css';

const AdminApp = lazy(() => import('./admin/AdminApp'));
const PublicBookingPage = lazy(() => import('./pages/PublicBookingPage'));
const ClientStatusPage = lazy(() => import('./pages/ClientStatusPage'));
const LegalPage = lazy(() => import('./pages/LegalPage'));

// Ask the browser not to evict our data when storage is low.
void navigator.storage?.persist?.();

registerSW({
  immediate: true,
  onOfflineReady() {
    window.dispatchEvent(new Event('photoflow-offline-ready'));
  },
  onRegisteredSW(_swUrl, registration) {
    if (registration) {
      window.setInterval(() => {
        if (navigator.onLine) void registration.update();
      }, 30 * 60 * 1000);
    }
  }
});

/** Which page this address is: the admin panel (secret path), a public booking page, a client status link, or the app. */
function Root() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const adminPath = import.meta.env.VITE_ADMIN_PATH;
  let page = <App />;
  if (adminPath && path === `/${adminPath}`) page = <AdminApp />;
  else if (path.startsWith('/b/')) page = <PublicBookingPage slug={decodeURIComponent(path.slice(3)).toLowerCase()} />;
  else if (path === '/terms') page = <LegalPage kind="terms" />;
  else if (path === '/privacy') page = <LegalPage kind="privacy" />;
  else if (path.startsWith('/s/')) page = <ClientStatusPage token={path.slice(3)} />;
  return <Suspense fallback={<div className="app-loading"><strong>PhotoFlow</strong></div>}>{page}</Suspense>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
