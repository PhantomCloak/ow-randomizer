import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { PasswordGate } from './PasswordGate.tsx'
import { I18nProvider } from './i18n.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <PasswordGate>
        {(gate) => <App gate={gate} />}
      </PasswordGate>
    </I18nProvider>
  </StrictMode>,
)
