import { useEffect, useState } from 'react'
import { useLanguage } from '../../i18n/LanguageContext'
import type { ApiConfig } from '../../types/api-config'
import { apiConfigsApi } from '../../lib/apiConfigsApi'
import ApiConfigCard from './ApiConfigCard'
import ApiConfigForm from './ApiConfigForm'

interface Props {
  activeConfigId: string | null
  onActiveChanged: (id: string | null) => void
}

export default function ApiConfigList({ activeConfigId, onActiveChanged }: Props) {
  const { t } = useLanguage()
  const [configs, setConfigs] = useState<ApiConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)

  useEffect(() => {
    apiConfigsApi.list()
      .then(setConfigs)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleActivated = (id: string) => {
    onActiveChanged(id)
  }

  const handleUpdated = (updated: ApiConfig) => {
    setConfigs((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
  }

  const handleDeleted = (id: string) => {
    setConfigs((prev) => prev.filter((c) => c.id !== id))
    if (activeConfigId === id) onActiveChanged(null)
  }

  const handleCreated = (created: ApiConfig) => {
    setConfigs((prev) => [...prev, created])
    setShowAddForm(false)
  }

  if (loading) {
    return <div className="text-text-muted text-sm py-4">{t('settings_loading')}</div>
  }

  return (
    <div className="space-y-3">
      {configs.length === 0 && !showAddForm ? (
        <div className="text-text-muted text-sm py-4 text-center">
          {t('api_config_empty')}
        </div>
      ) : (
        configs.map((cfg) => (
          <ApiConfigCard
            key={cfg.id}
            config={cfg}
            isActive={cfg.id === activeConfigId}
            onActivated={handleActivated}
            onUpdated={handleUpdated}
            onDeleted={handleDeleted}
          />
        ))
      )}

      {showAddForm ? (
        <ApiConfigForm
          onSaved={handleCreated}
          onCancel={() => setShowAddForm(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className="text-sm text-accent hover:text-accent-hover transition-colors"
        >
          {t('api_config_add')}
        </button>
      )}
    </div>
  )
}
