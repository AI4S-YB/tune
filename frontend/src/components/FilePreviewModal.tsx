import { useEffect } from 'react'
import { useLanguage } from '../i18n/LanguageContext'

export interface FilePreviewResponse {
  success: boolean
  file_name: string
  file_path: string
  file_type?: string | null
  file_size?: number | null
  preview_type: 'text' | 'unsupported'
  content?: string | null
  line_count?: number | null
  shown_line_count?: number | null
  truncated?: boolean | null
  message?: string | null
}

export interface FilePreviewMeta {
  name: string
  path: string
  size_bytes?: number
  file_type?: string | null
}

interface Props {
  visible: boolean
  loading: boolean
  error: string | null
  fileMeta: FilePreviewMeta | null
  content: string | null
  truncated: boolean
  unsupported: boolean
  unsupportedMessage: string | null
  onClose: () => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

export default function FilePreviewModal({
  visible,
  loading,
  error,
  fileMeta,
  content,
  truncated,
  unsupported,
  unsupportedMessage,
  onClose,
}: Props) {
  const { t } = useLanguage()

  // Escape key handler
  useEffect(() => {
    if (!visible) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [visible, onClose])

  if (!visible) return null

  return (
    // Backdrop — click to close
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Modal panel — stop propagation so clicks inside don't close */}
      <div
        className="bg-surface-overlay border border-border-subtle rounded-lg shadow-xl flex flex-col w-full max-w-3xl max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-start gap-3 px-4 py-3 border-b border-border-subtle">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-text-primary truncate">
              {fileMeta?.name ?? ''}
            </p>
            <p className="font-mono text-[10px] text-text-muted truncate mt-0.5">
              {fileMeta?.path ?? ''}
            </p>
            <div className="flex items-center gap-2 mt-1">
              {fileMeta?.file_type && (
                <span className="text-[10px] text-text-muted">{fileMeta.file_type}</span>
              )}
              {fileMeta?.size_bytes !== undefined && (
                <span className="text-[10px] text-text-muted">{formatSize(fileMeta.size_bytes)}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-text-muted hover:text-text-primary text-sm px-1"
            title={t('file_preview_close')}
          >
            ✕
          </button>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto relative">
          {loading && (
            <div className="flex items-center justify-center h-full min-h-[160px]">
              <span className="text-text-muted text-sm">{t('file_preview_loading')}</span>
            </div>
          )}

          {!loading && error && (
            <div className="flex items-center justify-center h-full min-h-[160px]">
              <span className="text-red-400 text-sm">{t('file_preview_error')}: {error}</span>
            </div>
          )}

          {!loading && !error && unsupported && (
            <div className="flex flex-col items-center justify-center h-full min-h-[160px] gap-2">
              <span className="text-text-muted text-base">⚠ {t('file_preview_unsupported')}</span>
              {unsupportedMessage && (
                <span className="text-text-muted text-xs text-center max-w-xs">{unsupportedMessage}</span>
              )}
            </div>
          )}

          {!loading && !error && !unsupported && content !== null && (
            <pre className="font-mono text-xs whitespace-pre overflow-x-auto p-4 text-text-primary leading-relaxed">
              <code>{content}</code>
            </pre>
          )}
        </div>

        {/* Truncation footer */}
        {!loading && !error && truncated && (
          <div className="shrink-0 border-t border-border-subtle px-4 py-2 text-center">
            <span className="text-[11px] text-text-muted">{t('file_preview_truncated_notice')}</span>
          </div>
        )}
      </div>
    </div>
  )
}
