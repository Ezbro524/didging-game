if (typeof (window as any).global === 'undefined') {
  const proxyTarget = {} as any;
  (window as any).global = new Proxy(proxyTarget, {
    get(target, prop) {
      if (prop in target) {
        return target[prop];
      }
      const val = (window as any)[prop];
      if (typeof val === 'function') {
        return val.bind(window);
      }
      return val;
    }
  });
}

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
