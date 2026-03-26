import { useCallback, useEffect, useState } from 'react'

export interface SystemHealth {
  llm_reachable: boolean
  llm_error: string | null
  data_scanned: boolean
  projects_exist: boolean
  files_assigned: boolean
  user_profile_initialized: boolean
}

const DEFAULT_HEALTH: SystemHealth = {
  llm_reachable: true,
  llm_error: null,
  data_scanned: true,
  projects_exist: true,
  files_assigned: true,
  user_profile_initialized: true,
}

export function useSystemHealth() {
  const [health, setHealth] = useState<SystemHealth>(DEFAULT_HEALTH)

  const refresh = useCallback(() => {
    fetch('/api/system/health')
      .then((r) => r.json())
      .then((h: SystemHealth) => setHealth(h))
      .catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { health, refresh }
}
