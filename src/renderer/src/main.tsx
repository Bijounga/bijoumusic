import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/theme.css'
import { bootstrapSettings } from './lib/settingsSync'

async function main(): Promise<void> {
  // Reconciling settings has to finish before App's module graph (and the zustand
  // stores inside it that read localStorage synchronously at import time) ever
  // loads — hence the dynamic import instead of a static one.
  await bootstrapSettings()
  const { default: App } = await import('./App')

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void main()
