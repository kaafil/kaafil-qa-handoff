/**
 * Browser entry point.
 *
 * `crm.css` is imported here rather than from a component so the house style
 * is in the document before anything renders, and so that a stylesheet you add
 * later lands after it in source order — which is what decides the winner
 * between two rules of equal specificity.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './crm/App';
import './styles/crm.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('index.html is missing its #root element.');
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// The app shell — see app/public/sw.js for what it does and why it is the
// CRM's job rather than Kaafil's. Without it, milestone 10's "reload the page,
// still offline" step gets the browser's offline error page every time, and
// the durable outbox you are trying to observe is stranded behind a document
// that will not open.
//
// Registered after load so it never delays first paint, and guarded because a
// service worker needs a secure context: localhost qualifies, a plain-http LAN
// address does not.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      // Not fatal — everything except an offline reload still works. Logged
      // rather than swallowed so a QA who cannot complete milestone 10 can see
      // why at a glance.
      console.warn('App shell unavailable; an offline reload will not work.', error);
    });
  });
}
