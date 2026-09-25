import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from './sw-register'
import './install' // capture the install prompt as early as possible

const root = createRoot(document.getElementById('root')!)
// Clickjacking defense: GitHub Pages can't send frame-blocking headers, so
// refuse to run inside someone else's frame.
if (window.top !== window.self) {
  root.render(<p style={{ padding: 16 }}>Horizon Tasks can't be embedded. Open it directly.</p>)
} else {
  registerServiceWorker()
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
