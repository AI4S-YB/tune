import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

interface FileNode {
  id: string
  filename: string
  path: string
  file_type: string
  size_bytes: number
}

interface FileSelection {
  fileId: string
  filename: string
  readNumber: number | null
}

interface Props {
  projectId: string
  experimentId: string
  libraryLayout: string | null
  existingFileIds: Set<string>
  onConfirm: (selections: FileSelection[]) => void
  onClose: () => void
}

// Auto-detect read number from filename
function detectReadNumber(filename: string): number | null {
  const lower = filename.toLowerCase()
  if (/_r1[._\b]|_1\.f|\.r1\./i.test(filename) || lower.endsWith('_r1.fastq.gz') || lower.endsWith('_r1.fastq') || lower.includes('_r1_')) return 1
  if (/_r2[._\b]|_2\.f|\.r2\./i.test(filename) || lower.endsWith('_r2.fastq.gz') || lower.endsWith('_r2.fastq') || lower.includes('_r2_')) return 2
  // _1.fastq / _2.fastq patterns
  if (/_1\.(fastq|fq)(\.gz)?$/.test(lower)) return 1
  if (/_2\.(fastq|fq)(\.gz)?$/.test(lower)) return 2
  return null
}

function formatSize(bytes: number): string {
  if (bytes > 1e9) return (bytes / 1e9).toFixed(1) + ' GB'
  if (bytes > 1e6) return (bytes / 1e6).toFixed(1) + ' MB'
  if (bytes > 1e3) return (bytes / 1e3).toFixed(1) + ' KB'
  return bytes + ' B'
}

export default function FilePickerModal({ projectId, libraryLayout, existingFileIds, onConfirm, onClose }: Props) {
  const [files, setFiles] = useState<FileNode[]>([])
  const [selected, setSelected] = useState<Map<string, FileSelection>>(new Map())
  const [search, setSearch] = useState('')

  useEffect(() => {
    // Pre-select already-linked files
    const initial = new Map<string, FileSelection>()
    existingFileIds.forEach(id => {
      // We'll update filenames once files load
      initial.set(id, { fileId: id, filename: '', readNumber: null })
    })
    setSelected(initial)

    fetch(`/api/files/?project_id=${projectId}`)
      .then(r => r.json())
      .then((data: FileNode[]) => {
        const fastqFiles = data.filter(f => ['fastq', 'fq'].includes(f.file_type))
        setFiles(fastqFiles)
        // Update filenames for pre-selected
        if (initial.size > 0) {
          setSelected(prev => {
            const next = new Map(prev)
            fastqFiles.forEach(f => {
              if (next.has(f.id)) {
                const existing = next.get(f.id)!
                next.set(f.id, { ...existing, filename: f.filename, readNumber: existing.readNumber ?? detectReadNumber(f.filename) })
              }
            })
            return next
          })
        }
      })
      .catch(() => {})
  }, [projectId])

  const isPaired = libraryLayout === 'PAIRED'

  const toggleFile = (file: FileNode) => {
    setSelected(prev => {
      const next = new Map(prev)
      if (next.has(file.id)) {
        next.delete(file.id)
      } else {
        const rn = isPaired ? detectReadNumber(file.filename) : null
        next.set(file.id, { fileId: file.id, filename: file.filename, readNumber: rn })
      }
      return next
    })
  }

  const setReadNumber = (fileId: string, rn: number | null) => {
    setSelected(prev => {
      const next = new Map(prev)
      const item = next.get(fileId)
      if (item) next.set(fileId, { ...item, readNumber: rn })
      return next
    })
  }

  const filtered = files.filter(f =>
    !search || f.filename.toLowerCase().includes(search.toLowerCase())
  )

  const handleConfirm = () => {
    onConfirm(Array.from(selected.values()).filter(s => s.filename))
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-surface-raised border border-border-subtle rounded-xl p-5 w-[520px] max-h-[80vh] flex flex-col shadow-xl mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3 shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-white">Select FASTQ Files</h3>
            {libraryLayout && (
              <p className="text-xs text-text-muted mt-0.5">
                Layout: <span className="font-medium text-text-primary">{libraryLayout}</span>
                {isPaired && ' — select R1 and R2'}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Filter by filename…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="mb-3 shrink-0 bg-surface-overlay text-text-primary rounded px-3 py-1.5 text-xs border border-border-subtle outline-none focus:border-blue-500"
        />

        {/* File list */}
        <div className="flex-1 overflow-y-auto space-y-1">
          {filtered.length === 0 && (
            <p className="text-xs text-text-muted text-center py-8">No FASTQ files found for this project.</p>
          )}
          {filtered.map(file => {
            const sel = selected.get(file.id)
            const isSelected = !!sel
            const isExisting = existingFileIds.has(file.id)
            return (
              <div
                key={file.id}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-accent/10 border border-accent/30' : 'hover:bg-surface-hover border border-transparent'}`}
                onClick={() => toggleFile(file)}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleFile(file)}
                  onClick={e => e.stopPropagation()}
                  className="shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-text-primary truncate">{file.filename}</div>
                  <div className="text-xs text-text-muted">{formatSize(file.size_bytes)}{isExisting && ' · already linked'}</div>
                </div>
                {isSelected && isPaired && (
                  <select
                    value={sel.readNumber ?? ''}
                    onChange={e => { e.stopPropagation(); setReadNumber(file.id, e.target.value ? Number(e.target.value) : null) }}
                    onClick={e => e.stopPropagation()}
                    className="text-xs bg-surface-overlay border border-border-subtle rounded px-1.5 py-0.5 text-text-primary shrink-0"
                  >
                    <option value="">R?</option>
                    <option value="1">R1</option>
                    <option value="2">R2</option>
                  </select>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 mt-3 border-t border-border-subtle shrink-0">
          <span className="text-xs text-text-muted">{selected.size} file{selected.size !== 1 ? 's' : ''} selected</span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded-lg border border-border-subtle text-text-muted hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="px-3 py-1.5 text-xs rounded-lg bg-accent hover:bg-accent-hover text-white"
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
