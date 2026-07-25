import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { AuthProvider } from './lib/AuthContext.tsx';
import { installChunkRecovery } from './lib/chunkRecovery.ts';
import '@fontsource/noto-sans/latin-400.css';
import '@fontsource/noto-sans/vietnamese-400.css';
import '@fontsource/noto-sans/latin-500.css';
import '@fontsource/noto-sans/vietnamese-500.css';
import '@fontsource/noto-sans/latin-600.css';
import '@fontsource/noto-sans/vietnamese-600.css';
import '@fontsource/noto-sans/latin-700.css';
import '@fontsource/noto-sans/vietnamese-700.css';
import './index.css';
import './brand-v2.css';
import './brand-v3.css';

installChunkRecovery();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// The service worker caches only same-origin static assets. Authentication and
// business API responses are intentionally excluded from its cache.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/service-worker.js');
  });
}
