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
