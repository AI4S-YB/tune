import { useState } from 'react'
import { PROVIDER_PRESETS } from './providerPresets'
import { useLanguage } from '../../i18n/LanguageContext'

export interface ModelFormValue {
  provider: string
  model: string
  api_key: string      // empty = unchanged
  base_url: string | null
}

interface Props {
  label: string
  initial: { provider: string; model: string; api_key?: string; base_url?: string | null }
  onChange: (value: ModelFormValue) => void
}

export default function ModelForm({ label, initial, onChange }: Props) {
  const { t } = useLanguage()

  const findPresetIdx = () => {
    const idx = PROVIDER_PRESETS.findIndex(
      (p) => p.provider === initial.provider && (p.hideBaseUrl || p.baseUrl === (initial.base_url ?? ''))
    )
    return idx >= 0 ? idx : PROVIDER_PRESETS.length - 1
  }

  const [presetIdx, setPresetIdx] = useState(findPresetIdx)
  const [model, setModel] = useState(initial.model)
  const [apiKey, setApiKey] = useState(initial.api_key ?? '')
  const [showKey, setShowKey] = useState(false)
  const [baseUrl, setBaseUrl] = useState(initial.base_url ?? '')
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [testing, setTesting] = useState(false)

  const preset = PROVIDER_PRESETS[presetIdx]

  const emit = (overrides: Partial<ModelFormValue> = {}) => {
    onChange({
      provider: preset.provider,
      model,
      api_key: apiKey,
      base_url: preset.hideBaseUrl ? null : (baseUrl || null),
      ...overrides,
    })
  }

  const handlePresetChange = (idx: number) => {
    const p = PROVIDER_PRESETS[idx]
    setPresetIdx(idx)
    if (p.baseUrl !== undefined) setBaseUrl(p.baseUrl)
    if (p.modelSuggestion && !model) setModel(p.modelSuggestion)
    emit({ provider: p.provider, base_url: p.hideBaseUrl ? null : (p.baseUrl ?? null) })
  }

  const testConnection = async () => {
    if (!apiKey && !model) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/config/test-llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: preset.provider,
          model,
          api_key: apiKey,
          base_url: preset.hideBaseUrl ? undefined : (baseUrl || undefined),
        }),
      }).then((r) => r.json())
      setTestResult({ ok: res.ok, msg: res.ok ? t('model_test_ok') : `${t('model_test_fail')}: ${res.error}` })
    } catch {
      setTestResult({ ok: false, msg: t('model_test_fail') })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="bg-surface-overlay rounded-lg p-4 space-y-3">
      <div className="text-xs font-semibold text-text-muted uppercase">{label}</div>

      {/* Provider selector */}
      <div>
        <label className="text-xs text-text-muted mb-1 block">{t('model_provider')}</label>
        <select
          value={presetIdx}
          onChange={(e) => handlePresetChange(Number(e.target.value))}
          className="w-full bg-surface-raised border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {PROVIDER_PRESETS.map((p, i) => (
            <option key={i} value={i}>{p.label}</option>
          ))}
        </select>
      </div>

      {/* Model name */}
      <div>
        <label className="text-xs text-text-muted mb-1 block">{t('model_name')}</label>
        <input
          type="text"
          value={model}
          onChange={(e) => { setModel(e.target.value); emit({ model: e.target.value }) }}
          placeholder={preset.modelSuggestion}
          className="w-full bg-surface-raised border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* API key with show/hide toggle */}
      <div>
        <label className="text-xs text-text-muted mb-1 block">{t('model_api_key')}</label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); emit({ api_key: e.target.value }) }}
            placeholder={t('model_api_key_placeholder')}
            className="w-full bg-surface-raised border border-gray-700 rounded px-3 py-1.5 pr-9 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            className="absolute inset-y-0 right-0 px-2.5 text-text-muted hover:text-text-primary"
            tabIndex={-1}
          >
            {showKey ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Base URL (hidden for anthropic/openai) */}
      {!preset.hideBaseUrl && (
        <div>
          <label className="text-xs text-text-muted mb-1 block">{t('model_base_url')}</label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => { setBaseUrl(e.target.value); emit({ base_url: e.target.value || null }) }}
            placeholder="https://api.example.com/v1"
            className="w-full bg-surface-raised border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      )}

      {/* Test connection */}
      <div className="flex items-center gap-3">
        <button
          onClick={testConnection}
          disabled={testing || !apiKey}
          className="px-3 py-1.5 bg-surface-hover hover:bg-gray-600 rounded text-xs disabled:opacity-50"
        >
          {testing ? t('model_testing') : t('model_test')}
        </button>
        {testResult && (
          <span className={`text-xs ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
            {testResult.msg}
          </span>
        )}
      </div>
    </div>
  )
}
