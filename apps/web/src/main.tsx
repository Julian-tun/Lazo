import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { applyTheme, loadTheme } from './features/fiesta/tema';
import './index.css';

// Tema elegido la última vez (normal o rosita), desde la primera pantalla
applyTheme(loadTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
