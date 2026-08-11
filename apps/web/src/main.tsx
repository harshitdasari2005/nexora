/**
 * @nexora/app-web — entry point.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GlobalStyles } from '@nexora/design-system';

import { App } from './App.js';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Missing #root element');
}

createRoot(container).render(
  <StrictMode>
    <GlobalStyles />
    <App />
  </StrictMode>,
);
