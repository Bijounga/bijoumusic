import { useEffect, useState } from 'react'

export function usePremiereStatus(): boolean {
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    void window.api.premiereGetStatus().then(setConnected)
    return window.api.onPremiereStatusChanged(setConnected)
  }, [])

  return connected
}
