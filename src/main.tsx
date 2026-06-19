import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Prevent noisy benign development WebSocket/Vite HMR connection errors in sandboxed browser previews
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const errorMsg = event.reason?.message || String(event.reason || '');
    if (errorMsg.toLowerCase().includes('websocket') || errorMsg.toLowerCase().includes('vite')) {
      event.preventDefault();
      console.warn('[Vite HMR Bypass] Ignored expected dev-server HMR connection failure:', errorMsg);
    }
  });

  window.addEventListener('error', (event) => {
    const errorMsg = event.message || '';
    if (errorMsg.toLowerCase().includes('websocket') || errorMsg.toLowerCase().includes('vite')) {
      event.preventDefault();
      console.warn('[Vite HMR Bypass] Ignored expected dev-server HMR error:', errorMsg);
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
