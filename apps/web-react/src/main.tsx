import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@marginline/react/style.css';
import '@marginline/web-shared/app.css';
import { App } from './App';
import { registerServiceWorker } from '@marginline/web-shared/shell';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD) registerServiceWorker();
