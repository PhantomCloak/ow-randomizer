import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { PasswordGate } from './PasswordGate.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PasswordGate>
      {(gate) => <App isAdmin={gate.isAdmin} password={gate.password} />}
    </PasswordGate>
  </StrictMode>,
)
