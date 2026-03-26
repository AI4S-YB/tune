import { useState } from 'react'
import { useLanguage } from '../../i18n/LanguageContext'

interface Props {
  label: string
  value: string
  onChange: (path: string) => void
}

export default function DirectoryPicker({ label, value, onChange }: Props) {
  const { t } = useLanguage()
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pick = async () => {
    setPicking(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/fs/pick-directory?initial_dir=${encodeURIComponent(value || '')}`,
        { method: 'POST' },
      )
      const data = await res.json()
      if (!data.cancelled && data.path) {
        onChange(data.path)
      }
    } catch {
      setError(t('dir_picker_open_error'))
    } finally {
      setPicking(false)
    }
  }

  return (
    <div className="bg-surface-overlay rounded p-3">
      <div className="text-xs text-text-muted mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm text-white font-mono truncate">
          {value || <span className="text-text-muted">—</span>}
        </span>
        <button
          onClick={pick}
          disabled={picking}
          className="shrink-0 px-3 py-1 bg-surface-hover hover:bg-gray-600 rounded text-xs disabled:opacity-50"
        >
          {picking ? t('dir_picker_loading') : t('dir_picker_open')}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  )
}
