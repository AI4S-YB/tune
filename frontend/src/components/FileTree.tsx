import { useState } from 'react'
import { useLanguage } from '../i18n/LanguageContext'

interface FileNode {
  id: string
  filename: string
  path: string
  file_type: string
  size_bytes: number
  metadata_status: 'complete' | 'partial' | 'missing'
  project_id: string | null
}

interface DirNode {
  name: string
  fullPath: string
  children: DirNode[]
  files: FileNode[]
}

const STATUS_COLORS = {
  complete: 'bg-green-500',
  partial: 'bg-yellow-500',
  missing: 'bg-red-500',
}

function buildTree(
  files: FileNode[],
  dirPath: string,
): { tree: DirNode; orphans: FileNode[] } {
  const normalizedDir = dirPath.endsWith('/') ? dirPath.slice(0, -1) : dirPath
  const root: DirNode = { name: '', fullPath: normalizedDir, children: [], files: [] }
  const orphans: FileNode[] = []

  for (const file of files) {
    if (!file.path.startsWith(normalizedDir + '/')) {
      orphans.push(file)
      continue
    }
    const relative = file.path.slice(normalizedDir.length + 1)
    const parts = relative.split('/')
    // If no intermediate dirs, goes directly under root
    if (parts.length === 1) {
      root.files.push(file)
      continue
    }
    // Traverse/create dir nodes
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      let child = node.children.find((c) => c.name === part)
      if (!child) {
        child = {
          name: part,
          fullPath: normalizedDir + '/' + parts.slice(0, i + 1).join('/'),
          children: [],
          files: [],
        }
        node.children.push(child)
      }
      node = child
    }
    node.files.push(file)
  }

  return { tree: root, orphans }
}

function DirNodeView({
  node,
  depth,
  selectedId,
  selectedFileIds,
  onSelect,
  onCheck,
}: {
  node: DirNode
  depth: number
  selectedId?: string
  selectedFileIds: Set<string>
  onSelect: (f: FileNode) => void
  onCheck: (id: string, e: React.MouseEvent) => void
}) {
  const [expanded, setExpanded] = useState(depth <= 1)
  const indent = depth * 12

  return (
    <div>
      {/* Only render dir header for non-root nodes */}
      {depth > 0 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 w-full text-left text-xs text-text-secondary hover:text-text-primary py-0.5 rounded hover:bg-surface-hover"
          style={{ paddingLeft: indent }}
        >
          <span className="shrink-0">{expanded ? '▾' : '▸'}</span>
          <span className="truncate">{node.name}/</span>
          <span className="text-text-secondary ml-auto pr-1">
            {node.files.length + node.children.reduce((a, c) => a + countFiles(c), 0)}
          </span>
        </button>
      )}
      {(depth === 0 || expanded) && (
        <>
          {node.children.map((child) => (
            <DirNodeView
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              selectedFileIds={selectedFileIds}
              onSelect={onSelect}
              onCheck={onCheck}
            />
          ))}
          {node.files.map((f) => (
            <FileRowTree
              key={f.id}
              file={f}
              indent={(depth + 1) * 12}
              selected={selectedId === f.id}
              checked={selectedFileIds.has(f.id)}
              onSelect={() => onSelect(f)}
              onCheck={(e) => onCheck(f.id, e)}
            />
          ))}
        </>
      )}
    </div>
  )
}

function countFiles(node: DirNode): number {
  return node.files.length + node.children.reduce((a, c) => a + countFiles(c), 0)
}

function FileRowTree({
  file,
  indent,
  selected,
  checked,
  onSelect,
  onCheck,
}: {
  file: FileNode
  indent: number
  selected: boolean
  checked: boolean
  onSelect: () => void
  onCheck: (e: React.MouseEvent) => void
}) {
  return (
    <div
      className={`flex items-center gap-1.5 py-0.5 text-xs rounded hover:bg-surface-hover cursor-pointer ${
        selected ? 'bg-surface-hover' : ''
      }`}
      style={{ paddingLeft: indent, paddingRight: 4 }}
      onClick={onSelect}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => {}}
        onClick={onCheck}
        className="w-3 h-3 shrink-0 accent-blue-500"
      />
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLORS[file.metadata_status]}`} />
      <span className="truncate text-text-primary">{file.filename}</span>
    </div>
  )
}

export default function FileTree({
  files,
  dirPath,
  selectedId,
  selectedFileIds,
  onSelect,
  onCheck,
}: {
  files: FileNode[]
  dirPath: string
  selectedId?: string
  selectedFileIds: Set<string>
  onSelect: (f: FileNode) => void
  onCheck: (id: string, e: React.MouseEvent) => void
}) {
  const { t } = useLanguage()
  const { tree, orphans } = buildTree(files, dirPath)

  return (
    <div>
      <DirNodeView
        node={tree}
        depth={0}
        selectedId={selectedId}
        selectedFileIds={selectedFileIds}
        onSelect={onSelect}
        onCheck={onCheck}
      />
      {orphans.length > 0 && (
        <div className="mt-2">
          <div className="text-xs text-yellow-600 px-2 mb-1">
            {t('data_files_outside_dir')}
          </div>
          {orphans.map((f) => (
            <FileRowTree
              key={f.id}
              file={f}
              indent={8}
              selected={selectedId === f.id}
              checked={selectedFileIds.has(f.id)}
              onSelect={() => onSelect(f)}
              onCheck={(e) => onCheck(f.id, e)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
