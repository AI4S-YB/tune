import { useEffect, useState } from 'react'
import { useLanguage } from '../i18n/LanguageContext'
import type { WSMessage } from '../hooks/useWebSocket'
import FilePreviewModal, { FilePreviewMeta, FilePreviewResponse } from './FilePreviewModal'
import FileMetaPanel from './FileMetaPanel'

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size_bytes?: number
  mtime?: number
  db_id?: string | null
  children?: TreeNode[]
  read_only?: boolean
}

interface TreeResponse {
  exists: boolean
  root: string
  read_only: boolean
  children: TreeNode[]
}

interface FileNode {
  id: string
  filename: string
  path: string
  file_type: string
  size_bytes: number
  metadata_status: 'complete' | 'partial' | 'missing'
  project_id: string | null
}

// 3.7 — added ws prop to interface
interface Props {
  projectId: string
  /**
   * Retained for API compatibility with DataBrowser → FileDetail path used by
   * Samples / Experiments tabs. Files-tab single-click no longer calls this;
   * the metadata panel is self-contained within DirectoryTreePanel + FileMetaPanel.
   */
  onFileSelect: (file: FileNode) => void
  ws?: { send: (msg: WSMessage) => void }
  onOpenMetadataAssistant?: () => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

async function fetchFilePreview(projectId: string, path: string): Promise<FilePreviewResponse> {
  const resp = await fetch(
    `/api/projects/${projectId}/files/preview?path=${encodeURIComponent(path)}`
  )
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`${resp.status} ${resp.statusText}${text ? ': ' + text : ''}`)
  }
  return resp.json() as Promise<FilePreviewResponse>
}

function TreeNodeRow({
  node,
  depth,
  defaultExpanded,
  selectedPath,
  onFileClick,
  onFileDoubleClick,
}: {
  node: TreeNode
  depth: number
  defaultExpanded: boolean
  selectedPath?: string | null
  onFileClick: (node: TreeNode) => void
  onFileDoubleClick?: (node: TreeNode) => void
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(defaultExpanded)
  const indent = { paddingLeft: `${depth * 14 + 8}px` }
  const isSelected = node.type === 'file' && node.path === selectedPath

  if (node.type === 'file') {
    return (
      <div
        className={`flex items-center group text-xs text-text-primary rounded ${
          isSelected ? 'bg-blue-600/20 ring-1 ring-blue-500/40' : 'hover:bg-surface-hover'
        }`}
        style={indent}
      >
        <button
          onClick={() => onFileClick(node)}
          onDoubleClick={() => onFileDoubleClick?.(node)}
          className="flex-1 flex items-center gap-1.5 text-left py-0.5 cursor-pointer"
          title={node.path}
        >
          <span className="shrink-0 text-text-muted text-[10px]">📄</span>
          <span className="truncate flex-1">{node.name}</span>
          {node.size_bytes !== undefined && (
            <span className="shrink-0 text-text-muted ml-1 text-[10px]">{formatSize(node.size_bytes)}</span>
          )}
          {node.db_id ? (
            <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-green-500 mr-1" title={t('dir_tree_tracked_tooltip')} />
          ) : (
            <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-gray-600 mr-1" title={t('dir_tree_not_tracked_tooltip')} />
          )}
        </button>
      </div>
    )
  }

  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1.5 text-left py-0.5 rounded hover:bg-surface-hover text-xs text-text-primary"
        style={indent}
      >
        <span className="shrink-0 text-text-muted text-[10px]">{open ? '▾' : '▸'}</span>
        <span className="shrink-0 text-[10px]">{open ? '📂' : '📁'}</span>
        <span className="truncate flex-1 font-medium">{node.name}</span>
      </button>
      {open && node.children && node.children.length > 0 && (
        <div>
          {node.children.map((child, i) => (
            <TreeNodeRow
              key={`${child.name}-${i}`}
              node={child}
              depth={depth + 1}
              defaultExpanded={depth < 1}
              selectedPath={selectedPath}
              onFileClick={onFileClick}
              onFileDoubleClick={onFileDoubleClick}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TreePanel({
  projectId,
  source,
  title,
  readOnly,
  selectedPath,
  onFileClick,
  onFileDoubleClick,
}: {
  projectId: string
  source: 'data' | 'analysis'
  title: string
  readOnly: boolean
  selectedPath?: string | null
  onFileClick: (node: TreeNode) => void
  onFileDoubleClick?: (node: TreeNode) => void
}) {
  const { t } = useLanguage()
  const [tree, setTree] = useState<TreeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [expectedPath, setExpectedPath] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    setLoading(true)
    setNotFound(false)
    setError(false)
    fetch(`/api/projects/${projectId}/files/tree?source=${source}`)
      .then(async r => {
        if (!r.ok) { setError(true); return null }
        return r.json() as Promise<TreeResponse>
      })
      .then(data => {
        if (!data) return
        if (!data.exists) {
          setExpectedPath(data.root ?? null)
          setNotFound(true)
          return
        }
        setTree(data)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [projectId, source])

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
        <span className="text-xs font-semibold text-text-primary">{title}</span>
        {readOnly && (
          <span className="text-[10px] px-1.5 py-0.5 bg-yellow-900/30 text-yellow-400 rounded border border-yellow-700/30">
            {t('readonly_badge')}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {loading && (
          <p className="px-4 py-3 text-xs text-text-muted">{t('dir_tree_loading')}</p>
        )}
        {!loading && notFound && (
          <div className="px-4 py-3 space-y-1">
            <p className="text-xs text-text-muted">{t('dir_tree_not_found')}</p>
            {expectedPath && (
              <p className="text-[10px] font-mono text-text-muted/60 break-all">
                {t('dir_tree_expected_path').replace('{path}', expectedPath)}
              </p>
            )}
          </div>
        )}
        {!loading && error && (
          <p className="px-4 py-3 text-xs text-red-400">{t('dir_tree_error')}</p>
        )}
        {!loading && !notFound && !error && tree && (
          tree.children.length > 0 ? (
            <div className="px-1 py-1">
              {tree.children.map((child, i) => (
                <TreeNodeRow
                  key={`${child.name}-${i}`}
                  node={child}
                  depth={0}
                  defaultExpanded={true}
                  selectedPath={selectedPath}
                  onFileClick={onFileClick}
                  onFileDoubleClick={onFileDoubleClick}
                />
              ))}
            </div>
          ) : (
            <p className="px-4 py-3 text-xs text-text-muted">{t('dir_tree_empty')}</p>
          )
        )}
      </div>
    </div>
  )
}

export default function DirectoryTreePanel({ projectId, onFileSelect: _onFileSelect, ws, onOpenMetadataAssistant }: Props) {
  const { t } = useLanguage()

  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null)
  // Preview state
  const [previewVisible, setPreviewVisible] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewFileMeta, setPreviewFileMeta] = useState<FilePreviewMeta | null>(null)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  const [previewTruncated, setPreviewTruncated] = useState(false)
  const [previewUnsupported, setPreviewUnsupported] = useState(false)
  const [previewUnsupportedMessage, setPreviewUnsupportedMessage] = useState<string | null>(null)

  const handleFileClick = (node: TreeNode) => {
    setSelectedNode(prev => prev?.path === node.path ? null : node)
  }

  const handleFileDoubleClick = async (node: TreeNode) => {
    setSelectedNode(node)
    setPreviewError(null)
    setPreviewContent(null)
    setPreviewTruncated(false)
    setPreviewUnsupported(false)
    setPreviewUnsupportedMessage(null)
    setPreviewFileMeta({
      name: node.name,
      path: node.path,
      size_bytes: node.size_bytes,
      file_type: null,
    })
    setPreviewLoading(true)
    setPreviewVisible(true)

    try {
      const data = await fetchFilePreview(projectId, node.path)
      setPreviewFileMeta({
        name: data.file_name,
        path: data.file_path,
        size_bytes: data.file_size ?? node.size_bytes,
        file_type: data.file_type ?? null,
      })
      if (data.preview_type === 'unsupported') {
        setPreviewUnsupported(true)
        setPreviewUnsupportedMessage(data.message ?? null)
      } else {
        setPreviewContent(data.content ?? '')
        setPreviewTruncated(data.truncated ?? false)
      }
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err))
    } finally {
      setPreviewLoading(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        {/* Dual tree section */}
        <div className="flex flex-1 min-w-0 overflow-hidden">
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <TreePanel
              projectId={projectId}
              source="data"
              title={t('dir_tree_raw_data')}
              readOnly={true}
              selectedPath={selectedNode?.path}
              onFileClick={handleFileClick}
              onFileDoubleClick={handleFileDoubleClick}
            />
          </div>
          <div className="w-px bg-border-subtle shrink-0" />
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <TreePanel
              projectId={projectId}
              source="analysis"
              title={t('dir_tree_analysis')}
              readOnly={false}
              selectedPath={selectedNode?.path}
              onFileClick={handleFileClick}
              onFileDoubleClick={handleFileDoubleClick}
            />
          </div>
        </div>

        {/* FileMetaPanel on right when a file is selected */}
        <FileMetaPanel
          node={selectedNode}
          projectId={projectId}
          onClose={() => setSelectedNode(null)}
          ws={ws}
          onOpenMetadataAssistant={onOpenMetadataAssistant}
        />

        {/* File preview modal (double-click) */}
        <FilePreviewModal
          visible={previewVisible}
          loading={previewLoading}
          error={previewError}
          fileMeta={previewFileMeta}
          content={previewContent}
          truncated={previewTruncated}
          unsupported={previewUnsupported}
          unsupportedMessage={previewUnsupportedMessage}
          onClose={() => setPreviewVisible(false)}
        />
      </div>
    </div>
  )
}
