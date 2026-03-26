import { useEffect, useRef, useState, useCallback } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'
import {
  BASE_SAMPLE_FIELDS,
  NULL_TERMS,
  PACKAGE_NAMES,
  SAMPLE_PACKAGES,
  isNullTerm,
  type PackageName,
} from '../constants/sra'

interface Sample {
  id: string
  project_id: string
  sample_name: string
  organism: string | null
  attrs: Record<string, unknown>
  created_at: string
}

interface SchemaField {
  key: string
  label: string
  required?: boolean
}

interface Props {
  projectId: string
  customFields?: SchemaField[]
  onSampleCountChange?: (n: number) => void
  refreshKey?: number
}

// Keys that have changed name: read old key, always write new key
const KEY_ALIASES: Record<string, string> = { dev_stage: 'developmental_stage' }

function readAttrKey(attrs: Record<string, unknown>, key: string): string {
  if (attrs[key] !== undefined) return String(attrs[key] ?? '')
  // Check alias (e.g. dev_stage → developmental_stage)
  const aliasKey = Object.entries(KEY_ALIASES).find(([, v]) => v === key)?.[0]
  if (aliasKey && attrs[aliasKey] !== undefined) return String(attrs[aliasKey] ?? '')
  return ''
}

function PackagePickerDropdown({
  currentPkg,
  onSelect,
  onClose,
}: {
  currentPkg: PackageName | null
  onSelect: (p: PackageName | null) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', keyHandler) }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-0.5 z-30 bg-surface-raised border border-border-subtle rounded shadow-lg py-0.5 min-w-[130px]"
    >
      <button
        className={`block w-full text-left px-3 py-1 text-xs hover:bg-surface-hover ${!currentPkg ? 'text-accent font-medium' : 'text-text-muted'}`}
        onMouseDown={() => { onSelect(null); onClose() }}
      >
        None
      </button>
      {PACKAGE_NAMES.map(p => (
        <button
          key={p}
          className={`block w-full text-left px-3 py-1 text-xs hover:bg-surface-hover ${currentPkg === p ? 'text-accent font-medium' : 'text-text-primary'}`}
          onMouseDown={() => { onSelect(p); onClose() }}
        >
          {p}
        </button>
      ))}
    </div>
  )
}

function SampleField({
  label,
  value,
  onSave,
}: {
  label: string
  value: string
  onSave: (v: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [showNull, setShowNull] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const start = () => { setDraft(value); setEditing(true); setShowNull(false) }
  const commit = () => { setEditing(false); setShowNull(false); onSave(draft) }
  const cancel = () => { setEditing(false); setShowNull(false) }

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  const isNull = isNullTerm(value)

  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className="text-text-muted w-36 shrink-0 text-xs pt-0.5">{label}</span>
      <div className="flex-1 relative">
        {editing ? (
          <div className="flex gap-1">
            <input
              ref={inputRef}
              className="flex-1 bg-surface-overlay text-text-primary rounded px-1.5 py-0.5 outline-none border border-blue-500 text-xs"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={() => { if (!showNull) commit() }}
              onKeyDown={e => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') cancel()
              }}
            />
            <button
              onMouseDown={e => { e.preventDefault(); setShowNull(s => !s) }}
              className="text-xs text-text-muted hover:text-text-primary px-1"
              title="Insert null term"
            >
              ∅
            </button>
            {showNull && (
              <div className="absolute top-6 right-0 z-20 bg-surface-raised border border-border-subtle rounded shadow-lg min-w-[160px]">
                {NULL_TERMS.map(nt => (
                  <button
                    key={nt}
                    className="block w-full text-left px-3 py-1 text-xs text-text-muted hover:bg-surface-hover italic"
                    onMouseDown={() => { onSave(nt); setEditing(false); setShowNull(false) }}
                  >
                    {nt}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <span
            className={`text-xs cursor-text block ${isNull ? 'text-text-muted italic' : value ? 'text-text-primary' : 'text-text-muted italic'}`}
            onClick={start}
          >
            {value || '—'}
          </span>
        )}
      </div>
    </div>
  )
}

function ExpandedSampleRow({
  sample,
  customFields,
  onUpdate,
}: {
  sample: Sample
  customFields: SchemaField[]
  onUpdate: () => void
}) {
  const pkg = (sample.attrs?.package as PackageName) || null
  const [confirmPkg, setConfirmPkg] = useState<PackageName | null>(null)

  const save = async (body: Record<string, unknown>) => {
    await fetch(`/api/samples/${sample.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    onUpdate()
  }

  const saveAttr = (key: string) => (value: string) => {
    save({ attrs: { [key]: value } })
  }

  const handlePackageChange = (newPkg: PackageName) => {
    if (pkg && newPkg !== pkg) {
      const pkgFields = SAMPLE_PACKAGES[pkg].fields.map(f => f.key)
      const hasData = pkgFields.some(k => sample.attrs?.[k])
      if (hasData) {
        setConfirmPkg(newPkg)
        return
      }
    }
    save({ attrs: { package: newPkg } })
  }

  const confirmPackageChange = () => {
    if (confirmPkg) save({ attrs: { package: confirmPkg } })
    setConfirmPkg(null)
  }

  const packageFields = pkg ? SAMPLE_PACKAGES[pkg].fields : []

  return (
    <div className="px-4 py-3 bg-surface-base border-b border-border-subtle/40 space-y-2">
      {/* Package selector */}
      <div className="flex items-center gap-2 pb-1 border-b border-border-subtle/30">
        <span className="text-xs text-text-muted w-36 shrink-0">BioSample Package</span>
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => save({ attrs: { package: null } })}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${!pkg ? 'border-accent bg-accent/15 text-accent' : 'border-border-subtle text-text-muted hover:border-text-muted'}`}
          >
            None
          </button>
          {PACKAGE_NAMES.map(p => (
            <button
              key={p}
              onClick={() => handlePackageChange(p)}
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${pkg === p ? 'border-accent bg-accent/15 text-accent' : 'border-border-subtle text-text-muted hover:border-text-muted'}`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Base fields */}
      <div>
        <div className="text-xs font-medium text-text-muted mb-1 uppercase tracking-wide">Base Fields</div>
        <SampleField label="Sample Name" value={sample.sample_name} onSave={v => save({ sample_name: v })} />
        <SampleField label="Organism" value={sample.organism ?? ''} onSave={v => save({ organism: v })} />
        {BASE_SAMPLE_FIELDS.map(f => (
          <SampleField key={f.key} label={f.label} value={readAttrKey(sample.attrs ?? {}, f.key)} onSave={saveAttr(f.key)} />
        ))}
      </div>

      {/* Package-specific fields */}
      {packageFields.length > 0 && (
        <div>
          <div className="text-xs font-medium text-text-muted mb-1 uppercase tracking-wide">{pkg} Fields</div>
          {packageFields.map(f => (
            <SampleField key={f.key} label={f.label} value={readAttrKey(sample.attrs ?? {}, f.key)} onSave={saveAttr(f.key)} />
          ))}
        </div>
      )}

      {/* Custom fields */}
      {customFields.length > 0 && (
        <div>
          <div className="text-xs font-medium text-text-muted mb-1 uppercase tracking-wide">Custom Fields</div>
          {customFields.map(f => (
            <SampleField key={f.key} label={f.label} value={readAttrKey(sample.attrs ?? {}, f.key)} onSave={saveAttr(f.key)} />
          ))}
        </div>
      )}

      {/* Package change confirm dialog */}
      {confirmPkg && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-surface-raised border border-border-subtle rounded-lg p-5 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-sm font-semibold text-white mb-2">Change Package?</h3>
            <p className="text-xs text-text-primary mb-4">
              Some package-specific fields are already filled. Changing to <strong>{confirmPkg}</strong> will keep those values but show different fields.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmPkg(null)}
                className="text-xs px-3 py-1.5 rounded border border-border-subtle text-text-muted hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                onClick={confirmPackageChange}
                className="text-xs px-3 py-1.5 rounded bg-accent hover:bg-accent-hover text-white"
              >
                Change to {confirmPkg}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SampleTable({ projectId, customFields = [], onSampleCountChange, refreshKey }: Props) {
  const { t } = useLanguage()
  const [samples, setSamples] = useState<Sample[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [openPickerId, setOpenPickerId] = useState<string | null>(null)
  const [bulkPickerOpen, setBulkPickerOpen] = useState(false)

  const load = async () => {
    const data = await fetch(`/api/samples/?project_id=${projectId}`).then(r => r.json()).catch(() => [])
    setSamples(data)
    onSampleCountChange?.(data.length)
  }

  useEffect(() => { load() }, [projectId, refreshKey])

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const addSample = async () => {
    await fetch('/api/samples/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, sample_name: t('sample_default_name') }),
    })
    await load()
  }

  const deleteSample = async (id: string) => {
    await fetch(`/api/samples/${id}`, { method: 'DELETE' })
    await load()
  }

  const savePkg = useCallback(async (sampleId: string, pkg: PackageName | null) => {
    await fetch(`/api/samples/${sampleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attrs: { package: pkg } }),
    })
    await load()
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const bulkSetPackage = async (pkg: PackageName) => {
    await Promise.all(
      samples.map(s =>
        fetch(`/api/samples/${s.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attrs: { package: pkg } }),
        })
      )
    )
    await load()
  }

  if (samples.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-3 text-text-muted text-xs">
        <p>{t('sample_empty')}</p>
        <button onClick={addSample} className="text-xs px-3 py-1 bg-accent hover:bg-accent-hover rounded text-white">
          {t('sample_add')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-auto">
        <table className="text-xs w-full border-collapse">
          <thead className="sticky top-0 bg-surface-raised z-10">
            <tr>
              <th className="w-6 px-2 py-1.5 border-b border-border-subtle" />
              <th className="text-left px-2 py-1.5 border-b border-border-subtle text-text-muted whitespace-nowrap">
                {t('sample_col_sample_name')}<span className="text-red-400 ml-0.5">*</span>
              </th>
              <th className="text-left px-2 py-1.5 border-b border-border-subtle text-text-muted whitespace-nowrap">
                {t('sample_col_organism')}
              </th>
              <th className="text-left px-2 py-1.5 border-b border-border-subtle text-text-muted whitespace-nowrap">
                <div className="relative flex items-center gap-1">
                  Package
                  <button
                    onClick={() => setBulkPickerOpen(o => !o)}
                    className="text-text-muted hover:text-text-primary text-[10px] opacity-50 hover:opacity-100 ml-1"
                    title="Set package for all samples"
                  >
                    ⋯
                  </button>
                  {bulkPickerOpen && (
                    <PackagePickerDropdown
                      currentPkg={null}
                      onSelect={async p => { if (p) await bulkSetPackage(p) }}
                      onClose={() => setBulkPickerOpen(false)}
                    />
                  )}
                </div>
              </th>
              <th className="w-6 px-2 py-1.5 border-b border-border-subtle" />
            </tr>
          </thead>
          <tbody>
            {samples.map(s => {
              const isExpanded = expandedIds.has(s.id)
              const pkg = s.attrs?.package as string | undefined
              return (
                <>
                  <tr key={s.id} className="group hover:bg-surface-hover">
                    <td className="px-1 border-b border-border-subtle/40 text-center">
                      <button
                        onClick={() => toggleExpand(s.id)}
                        className="text-text-muted hover:text-text-primary p-0.5"
                      >
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </button>
                    </td>
                    <td className="px-2 py-1 border-b border-border-subtle/40 min-w-[100px] max-w-[180px]">
                      <span className="truncate block text-text-primary cursor-text" onClick={() => toggleExpand(s.id)}>
                        {s.sample_name}
                      </span>
                    </td>
                    <td className="px-2 py-1 border-b border-border-subtle/40 min-w-[80px] max-w-[150px]">
                      <span className={`truncate block cursor-text ${!s.organism ? 'text-text-muted italic' : isNullTerm(s.organism ?? '') ? 'text-text-muted italic' : ''}`}>
                        {s.organism || '—'}
                      </span>
                    </td>
                    <td className="px-2 py-1 border-b border-border-subtle/40 relative">
                      <button
                        onClick={() => setOpenPickerId(id => id === s.id ? null : s.id)}
                        className="flex items-center gap-1 hover:opacity-80"
                      >
                        {pkg ? (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent">{pkg}</span>
                        ) : (
                          <span className="text-text-muted italic text-xs">— pick</span>
                        )}
                      </button>
                      {openPickerId === s.id && (
                        <PackagePickerDropdown
                          currentPkg={pkg as PackageName | null}
                          onSelect={p => savePkg(s.id, p)}
                          onClose={() => setOpenPickerId(null)}
                        />
                      )}
                    </td>
                    <td className="px-1 border-b border-border-subtle/40">
                      <button
                        onClick={() => deleteSample(s.id)}
                        className="opacity-0 group-hover:opacity-30 hover:!opacity-100 hover:text-red-400 transition-opacity"
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${s.id}-expanded`}>
                      <td colSpan={5} className="p-0">
                        <ExpandedSampleRow sample={s} customFields={customFields} onUpdate={load} />
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border-subtle px-3 py-2 shrink-0">
        <button onClick={addSample} className="text-xs text-text-muted hover:text-text-primary">
          {t('sample_add')}
        </button>
      </div>
    </div>
  )
}
