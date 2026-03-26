import { useState } from 'react'
import { useLanguage } from '../../i18n/LanguageContext'
import type { ApiConfig } from '../../types/api-config'
import { apiConfigsApi } from '../../lib/apiConfigsApi'
import { PROVIDER_PRESETS } from './providerPresets'
import ApiConfigForm from './ApiConfigForm'

interface Props {
  config: ApiConfig
  isActive: boolean
  onActivated: (id: string) => void
  onUpdated: (cfg: ApiConfig) => void
  onDeleted: (id: string) => void
}

function providerLabel(provider: string): string {
  const p = PROVIDER_PRESETS.find((pr) => pr.provider === provider)
  return p?.label ?? provider
}

export default function ApiConfigCard({ config, isActive, onActivated, onUpdated, onDeleted }: Props) {
  const { t } = useLanguage()
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [activating, setActivating] = useState(false)

  const handleActivate = async () => {
    setActivating(true)
    try {
      await apiConfigsApi.setActive(config.id)
      onActivated(config.id)
    } finally {
      setActivating(false)
    }
  }

  const handleDelete = async () => {
    await apiConfigsApi.delete(config.id)
    onDeleted(config.id)
  }

  return (
    <div className={`rounded-xl border transition-colors ${isActive ? 'border-accent/60 bg-surface-raised' : 'border-border-subtle bg-surface-raised'}`}>
      {/* Card header */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Active radio */}
        <button
          type="button"
          onClick={isActive ? undefined : handleActivate}
          disabled={activating}
          className={`w-4 h-4 rounded-full border-2 flex-shrink-0 transition-colors ${
            isActive
              ? 'border-accent bg-accent'
              : 'border-border-subtle hover:border-accent/60 bg-transparent'
          } disabled:opacity-50`}
          title={isActive ? t('api_config_active_badge') : t('api_config_activate')}
        />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary truncate">{config.name}</span>
            {isActive && (
              <span className="text-[10px] font-semibold bg-accent/20 text-accent px-1.5 py-0.5 rounded">
                {t('api_config_active_badge')}
              </span>
            )}
          </div>
          <div className="text-xs text-text-muted mt-0.5">
            {providerLabel(config.provider)} · {config.model_name}
            {config.base_url && (
              <span className="ml-1 text-text-muted/60">({config.base_url.replace(/https?:\/\//, '').slice(0, 40)})</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {!isActive && (
            <button
              type="button"
              onClick={handleActivate}
              disabled={activating}
              className="px-2.5 py-1 text-xs rounded-lg bg-surface-overlay hover:bg-surface-hover text-text-secondary transition-colors disabled:opacity-50"
            >
              {t('api_config_activate')}
            </button>
          )}
          <button
            type="button"
            onClick={() => { setEditing((v) => !v); setConfirming(false) }}
            className="px-2.5 py-1 text-xs rounded-lg bg-surface-overlay hover:bg-surface-hover text-text-secondary transition-colors"
          >
            {t('api_config_edit')}
          </button>
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="px-2.5 py-1 text-xs rounded-lg bg-surface-overlay hover:bg-red-500/20 text-text-muted hover:text-red-400 transition-colors"
            >
              {t('api_config_delete')}
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <span className="text-xs text-text-muted">{t('api_config_delete_confirm')}</span>
              <button
                type="button"
                onClick={handleDelete}
                className="px-2.5 py-1 text-xs rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors"
              >
                {t('api_config_delete')}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="px-2.5 py-1 text-xs rounded-lg bg-surface-overlay text-text-muted transition-colors"
              >
                {t('api_config_cancel')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Inline edit form */}
      {editing && (
        <div className="px-4 pb-4">
          <ApiConfigForm
            existing={config}
            onSaved={(updated) => {
              onUpdated(updated)
              setEditing(false)
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      )}
    </div>
  )
}
