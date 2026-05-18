import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Fix for environments where window.fetch is read-only but a library (e.g. Firebase) tries to overwrite it
try {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'fetch');
  if (descriptor && !descriptor.set && descriptor.configurable) {
    const originalFetch = window.fetch.bind(window);
    Object.defineProperty(window, 'fetch', {
      get: () => originalFetch,
      set: () => {
        console.warn('Prevented attempt to overwrite window.fetch');
      },
      configurable: true,
      enumerable: true
    });
  }
} catch (e) {
  console.error('Error while patching window.fetch:', e);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
