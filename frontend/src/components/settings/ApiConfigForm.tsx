import { useState } from 'react'
import { PROVIDER_PRESETS } from './providerPresets'
import { useLanguage } from '../../i18n/LanguageContext'
import type { ApiConfig, ApiConfigDraft } from '../../types/api-config'
import { apiConfigsApi } from '../../lib/apiConfigsApi'

const inputCls = 'w-full bg-surface-overlay border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent placeholder-text-muted'
const selectCls = 'w-full bg-surface-overlay border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent'
const labelCls = 'text-xs text-text-muted mb-1 block'

function KVEditor({
  label,
  addLabel,
  value,
  onChange,
}: {
  label: string
  addLabel: string
  value: Record<string, string>
  onChange: (v: Record<string, string>) => void
}) {
  const entries = Object.entries(value)
  const update = (idx: number, k: string, v: string) => {
    const next = [...entries]
    next[idx] = [k, v]
    onChange(Object.fromEntries(next.filter(([key]) => key)))
  }
  const remove = (idx: number) => {
    const next = entries.filter((_, i) => i !== idx)
    onChange(Object.fromEntries(next))
  }
  const add = () => onChange({ ...value, '': '' })

  return (
    <div className="space-y-1.5">
      <label className={labelCls}>{label}</label>
      {entries.map(([k, v], i) => (
        <div key={i} className="flex gap-2">
          <input
            className={`${inputCls} flex-1`}
            value={k}
            placeholder="key"
            onChange={(e) => update(i, e.target.value, v)}
          />
          <input
            className={`${inputCls} flex-1`}
            value={v}
            placeholder="value"
            onChange={(e) => update(i, k, e.target.value)}
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="text-text-muted hover:text-red-400 text-sm px-1"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="text-xs text-accent hover:text-accent-hover transition-colors"
      >
        {addLabel}
      </button>
    </div>
  )
}

interface Props {
  /** Existing config to edit; undefined = create mode */
  existing?: ApiConfig
  onSaved: (cfg: ApiConfig) => void
  onCancel: () => void
}

function buildDraft(existing?: ApiConfig): ApiConfigDraft {
  if (existing) {
    return {
      name: existing.name,
      provider: existing.provider,
      api_style: existing.api_style,
      base_url: existing.base_url,
      model_name: existing.model_name,
      api_key: '',  // masked — leave blank to keep
      enabled: existing.enabled,
      timeout: existing.timeout,
      max_retries: existing.max_retries,
      endpoint_path: existing.endpoint_path,
      extra_headers: existing.extra_headers ?? {},
      extra_params: existing.extra_params ?? {},
      remark: existing.remark,
    }
  }
  return {
    name: '',
    provider: 'anthropic',
    api_style: 'anthropic',
    base_url: null,
    model_name: 'claude-sonnet-4-6',
    api_key: '',
    enabled: true,
    timeout: 120,
    max_retries: 2,
    endpoint_path: null,
    extra_headers: {},
    extra_params: {},
    remark: null,
  }
}

export default function ApiConfigForm({ existing, onSaved, onCancel }: Props) {
  const { t } = useLanguage()

  // Find initial preset index from existing config or default to first preset
  const findPresetIdx = (draft: ApiConfigDraft) => {
    const idx = PROVIDER_PRESETS.findIndex(
      (p) =>
        p.provider === draft.provider &&
        (p.hideBaseUrl || p.baseUrl === (draft.base_url ?? ''))
    )
    return idx >= 0 ? idx : PROVIDER_PRESETS.length - 1
  }

  const [draft, setDraft] = useState<ApiConfigDraft>(() => buildDraft(existing))
  const [presetIdx, setPresetIdx] = useState(() => findPresetIdx(buildDraft(existing)))
  const [showKey, setShowKey] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  const preset = PROVIDER_PRESETS[presetIdx]

  const set = <K extends keyof ApiConfigDraft>(key: K, value: ApiConfigDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  const handlePresetChange = (idx: number) => {
    const p = PROVIDER_PRESETS[idx]
    setPresetIdx(idx)
    setDraft((d) => ({
      ...d,
      provider: p.provider,
      api_style: p.apiStyle,
      base_url: p.hideBaseUrl ? null : (p.baseUrl ?? null),
      model_name: d.model_name || p.modelSuggestion,
    }))
  }

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = existing
        ? await apiConfigsApi.testSaved(existing.id)
        : await apiConfigsApi.testUnsaved(draft)
      setTestResult({
        ok: result.ok,
        msg: result.ok
          ? t('api_config_test_ok')
          : `${t('api_config_test_fail')}: ${result.error ?? ''}`,
      })
    } catch (e) {
      setTestResult({ ok: false, msg: `${t('api_config_test_fail')}: ${String(e)}` })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    setSaveState('saving')
    setSaveError(null)
    try {
      const saved = existing
        ? await apiConfigsApi.update(existing.id, draft)
        : await apiConfigsApi.create(draft)
      onSaved(saved)
    } catch (e) {
      setSaveError(String(e))
      setSaveState('error')
    }
  }

  return (
    <div className="bg-surface-overlay border border-border-subtle rounded-xl p-5 space-y-4">
      {/* Config Name */}
      <div>
        <label className={labelCls}>{t('api_config_name_label')}</label>
        <input
          className={inputCls}
          value={draft.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder={t('api_config_name_placeholder')}
        />
      </div>

      {/* Provider preset */}
      <div>
        <label className={labelCls}>{t('model_provider')}</label>
        <select
          value={presetIdx}
          onChange={(e) => handlePresetChange(Number(e.target.value))}
          className={selectCls}
        >
          {PROVIDER_PRESETS.map((p, i) => (
            <option key={i} value={i}>{p.label}</option>
          ))}
        </select>
      </div>

      {/* Model name */}
      <div>
        <label className={labelCls}>{t('model_name')}</label>
        <input
          className={inputCls}
          value={draft.model_name}
          onChange={(e) => set('model_name', e.target.value)}
          placeholder={preset.modelSuggestion}
        />
      </div>

      {/* API Key */}
      <div>
        <label className={labelCls}>{t('model_api_key')}</label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            className={`${inputCls} pr-9`}
            value={draft.api_key}
            onChange={(e) => set('api_key', e.target.value)}
            placeholder={existing ? t('model_api_key_placeholder') : ''}
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

      {/* Base URL (hidden for anthropic/openai with hideBaseUrl) */}
      {!preset.hideBaseUrl && (
        <div>
          <label className={labelCls}>{t('model_base_url')}</label>
          <input
            className={inputCls}
            value={draft.base_url ?? ''}
            onChange={(e) => set('base_url', e.target.value || null)}
            placeholder="https://api.example.com/v1"
          />
        </div>
      )}

      {/* Advanced toggle */}
      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1 transition-colors"
      >
        <span className={`transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>▶</span>
        {t('api_config_advanced')}
      </button>

      {showAdvanced && (
        <div className="space-y-4 pl-3 border-l border-border-subtle">
          {/* Endpoint path */}
          <div>
            <label className={labelCls}>{t('api_config_endpoint_path')}</label>
            <input
              className={inputCls}
              value={draft.endpoint_path ?? ''}
              onChange={(e) => set('endpoint_path', e.target.value || null)}
              placeholder={t('api_config_endpoint_path_placeholder')}
            />
          </div>

          {/* Timeout and Max Retries */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t('api_config_timeout')}</label>
              <input
                type="number"
                className={inputCls}
                value={draft.timeout}
                min={5}
                max={600}
                onChange={(e) => set('timeout', Number(e.target.value))}
              />
            </div>
            <div>
              <label className={labelCls}>{t('api_config_max_retries')}</label>
              <input
                type="number"
                className={inputCls}
                value={draft.max_retries}
                min={0}
                max={10}
                onChange={(e) => set('max_retries', Number(e.target.value))}
              />
            </div>
          </div>

          {/* Extra Headers */}
          <KVEditor
            label={t('api_config_extra_headers')}
            addLabel={t('api_config_add_header')}
            value={draft.extra_headers as Record<string, string>}
            onChange={(v) => set('extra_headers', v)}
          />

          {/* Extra Params */}
          <KVEditor
            label={t('api_config_extra_params')}
            addLabel={t('api_config_add_param')}
            value={Object.fromEntries(
              Object.entries(draft.extra_params ?? {}).map(([k, v]) => [k, String(v)])
            )}
            onChange={(v) => set('extra_params', v)}
          />

          {/* Remark */}
          <div>
            <label className={labelCls}>{t('api_config_remark_label')}</label>
            <textarea
              className={`${inputCls} resize-none`}
              rows={2}
              value={draft.remark ?? ''}
              onChange={(e) => set('remark', e.target.value || null)}
              placeholder={t('api_config_remark_placeholder')}
            />
          </div>
        </div>
      )}

      {/* Actions row */}
      <div className="flex items-center gap-3 pt-1">
        {/* Test */}
        <button
          type="button"
          onClick={testConnection}
          disabled={testing}
          className="px-3 py-1.5 bg-surface-hover hover:bg-surface-raised rounded-lg text-xs text-text-secondary disabled:opacity-50 transition-colors"
        >
          {testing ? t('api_config_testing') : t('api_config_test')}
        </button>
        {testResult && (
          <span className={`text-xs ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
            {testResult.msg}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            {t('api_config_cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saveState === 'saving'}
            className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-lg text-xs font-medium disabled:opacity-50 transition-colors"
          >
            {saveState === 'saving' ? t('api_config_saving') : t('api_config_save')}
          </button>
        </div>
      </div>

      {saveState === 'error' && saveError && (
        <div className="text-xs text-red-400">{saveError}</div>
      )}
    </div>
  )
}
