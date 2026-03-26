import { useEffect, useState } from 'react'
import { useLanguage } from '../i18n/LanguageContext'
import type { WSMessage } from '../hooks/useWebSocket'

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size_bytes?: number
  mtime?: number
  db_id?: string | null
  children?: TreeNode[]
}

interface FileDetailFull {
  id: string
  filename: string
  path: string
  file_type: string
  size_bytes: number
  md5: string | null
  mtime: string | null
  metadata_status: string
  enhanced_metadata: Array<{ key: string; value: string | null; source: string }>
}

interface Props {
  node: TreeNode | null
  projectId: string
  onClose: () => void
  ws?: { send: (msg: WSMessage) => void }
  onOpenMetadataAssistant?: () => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

function formatMtime(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
}

const STATUS_COLOR: Record<string, string> = {
  complete: 'text-green-400 bg-green-900/20 border-green-700/40',
  partial: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/40',
  missing: 'text-red-400 bg-red-900/20 border-red-700/40',
}

export default function FileMetaPanel({ node, projectId: _projectId, onClose, ws: _ws, onOpenMetadataAssistant }: Props) {
  const { t } = useLanguage()
  const [detail, setDetail] = useState<FileDetailFull | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!node?.db_id) {
      setDetail(null)
      setLoading(false)
      setError(null)
      setEditMode(false)
      return
    }
    setLoading(true)
    setError(null)
    setDetail(null)
    setEditMode(false)
    fetch(`/api/files/${node.db_id}`)
      .then(r => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return r.json() as Promise<FileDetailFull>
      })
      .then(setDetail)
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [node?.db_id])

  if (!node) return null

  const isTracked = !!node.db_id

  const enterEdit = () => {
    if (!detail) return
    const vals: Record<string, string> = {}
    for (const m of detail.enhanced_metadata) vals[m.key] = m.value ?? ''
    setEditValues(vals)
    setEditMode(true)
  }

  const saveMetadata = async () => {
    if (!node.db_id) return
    setSaving(true)
    try {
      await fetch(`/api/metadata/files/${node.db_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: editValues }),
      })
      const updated = await fetch(`/api/files/${node.db_id}`).then(r => r.json()) as FileDetailFull
      setDetail(updated)
      setEditMode(false)
    } finally {
      setSaving(false)
    }
  }

  const fillWithAI = () => {
    onOpenMetadataAssistant?.()
    onClose()
  }

  return (
    <div className="w-72 shrink-0 flex flex-col border-l border-border-subtle bg-surface-raised overflow-hidden">
      {/* Panel header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
        <span className="text-xs font-semibold text-text-primary truncate flex-1" title={node.name}>
          {node.name}
        </span>
        <button
          onClick={onClose}
          className="shrink-0 text-text-muted hover:text-text-primary text-sm leading-none"
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Panel body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
        {/* File path */}
        <p className="font-mono text-[10px] text-text-muted break-all" title={node.path}>{node.path}</p>

        {!isTracked ? (
          /* Untracked branch — 2.2 */
          <>
            <div className="flex flex-wrap gap-2">
              {node.size_bytes !== undefined && (
                <div className="bg-surface-overlay rounded px-2 py-1">
                  <div className="text-[10px] text-text-muted">Size</div>
                  <div className="text-text-primary">{formatSize(node.size_bytes)}</div>
                </div>
              )}
              {node.mtime !== undefined && (
                <div className="bg-surface-overlay rounded px-2 py-1">
                  <div className="text-[10px] text-text-muted">Modified</div>
                  <div className="text-text-primary">{formatMtime(node.mtime)}</div>
                </div>
              )}
            </div>
            <span className="inline-block text-[10px] px-1.5 py-0.5 bg-surface-overlay rounded text-text-muted border border-border-subtle">
              {t('file_meta_not_tracked')}
            </span>
          </>
        ) : (
          /* Tracked branch — 2.3 */
          <>
            {loading && (
              <p className="text-text-muted">{t('file_meta_loading')}</p>
            )}
            {error && (
              <p className="text-red-400">{t('file_meta_error')}: {error}</p>
            )}
            {detail && (
              <>
                {/* 2.4 — header: file name, size, file type chip, metadata-status badge */}
                <div className="flex flex-wrap gap-2">
                  <div className="bg-surface-overlay rounded px-2 py-1">
                    <div className="text-[10px] text-text-muted">{t('data_field_type')}</div>
                    <div className="font-mono text-text-primary">{detail.file_type}</div>
                  </div>
                  <div className="bg-surface-overlay rounded px-2 py-1">
                    <div className="text-[10px] text-text-muted">Size</div>
                    <div className="text-text-primary">{formatSize(detail.size_bytes)}</div>
                  </div>
                  <div className={`rounded px-2 py-1 border ${STATUS_COLOR[detail.metadata_status] ?? STATUS_COLOR.missing}`}>
                    <div className="text-[10px] opacity-70">{t('data_field_metadata')}</div>
                    <div className="capitalize">{detail.metadata_status}</div>
                  </div>
                </div>

                {/* 2.5 — Enhanced Metadata section */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">
                      {t('data_enhanced_metadata')}
                    </span>
                    {/* 2.6 — Edit button */}
                    {!editMode ? (
                      <button
                        onClick={enterEdit}
                        className="text-[10px] px-2 py-0.5 bg-surface-hover hover:bg-gray-600 rounded text-text-primary"
                      >
                        {t('data_edit_metadata')}
                      </button>
                    ) : (
                      <div className="flex gap-1">
                        {/* 2.8 — Fill with AI */}
                        <button
                          onClick={fillWithAI}
                          className="text-[10px] px-1.5 py-0.5 bg-purple-700 hover:bg-purple-600 rounded text-white"
                        >
                          {t('data_fill_with_ai')}
                        </button>
                        {/* 2.7 — Save */}
                        <button
                          onClick={saveMetadata}
                          disabled={saving}
                          className="text-[10px] px-1.5 py-0.5 bg-blue-600 hover:bg-blue-500 rounded text-white disabled:opacity-50"
                        >
                          {saving ? '…' : t('data_save_metadata')}
                        </button>
                        <button
                          onClick={() => setEditMode(false)}
                          className="text-[10px] px-1.5 py-0.5 bg-surface-hover hover:bg-gray-600 rounded text-text-primary"
                        >
                          {t('data_cancel_edit')}
                        </button>
                      </div>
                    )}
                  </div>

                  {editMode ? (
                    <div className="space-y-1.5">
                      {Object.entries(editValues).map(([key, val]) => (
                        <div key={key} className="space-y-0.5">
                          <div className="text-[10px] text-text-muted">{key}</div>
                          <input
                            value={val}
                            onChange={e => setEditValues(prev => ({ ...prev, [key]: e.target.value }))}
                            placeholder={t('data_field_value_placeholder')}
                            className="w-full bg-surface-raised border border-gray-700 rounded px-2 py-1 text-white text-[10px] focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {detail.enhanced_metadata.map(m => (
                        <div key={m.key} className="flex items-start gap-2">
                          <span className="text-text-muted text-[10px] w-24 shrink-0 break-all">{m.key}</span>
                          <span className="text-text-primary text-[10px] flex-1 break-words">
                            {m.value ?? <em className="text-text-muted">—</em>}
                          </span>
                          <span className="text-text-muted text-[10px] shrink-0">{m.source}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
