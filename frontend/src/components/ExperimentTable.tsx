import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'
import {
  INSTRUMENT_MODELS,
  LIBRARY_LAYOUT,
  LIBRARY_SELECTION,
  LIBRARY_SOURCE,
  LIBRARY_STRATEGY,
  NULL_TERMS,
  PLATFORM,
  isNullTerm,
} from '../constants/sra'
import FilePickerModal from './FilePickerModal'

interface Experiment {
  id: string
  project_id: string
  sample_id: string
  sample_name?: string
  library_strategy: string | null
  library_source: string | null
  library_selection: string | null
  library_layout: string | null
  platform: string | null
  instrument_model: string | null
  attrs: Record<string, unknown>
  created_at: string
}

interface FileRun {
  id: string
  experiment_id: string
  file_id: string
  read_number: number | null
  filename: string | null
  attrs: Record<string, unknown>
}

interface Sample {
  id: string
  sample_name: string
}

interface SchemaField {
  key: string
  label: string
  required?: boolean
}

const EXTRA_ATTRS_FIELDS = [
  { key: 'library_name', label: 'Library Name' },
  { key: 'design_description', label: 'Design Description' },
  { key: 'library_construction_protocol', label: 'Library Construction Protocol' },
  { key: 'insert_size', label: 'Insert Size (bp)' },
  { key: 'center_name', label: 'Center Name' },
]

interface Props {
  projectId: string
  customFields?: SchemaField[]
  onExperimentCountChange?: (n: number) => void
  refreshKey?: number
}

// Dropdown with null terms appended
function SraSelect({
  value,
  options,
  onChange,
  placeholder = '—',
}: {
  value: string | null
  options: readonly string[]
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      className={`w-full bg-surface-overlay rounded px-1 py-0.5 text-xs outline-none border border-transparent focus:border-blue-500 cursor-pointer ${isNullTerm(value ?? '') ? 'italic text-text-muted' : value ? 'text-text-primary' : 'text-text-muted italic'}`}
    >
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
      <optgroup label="Missing value">
        {NULL_TERMS.map(nt => <option key={nt} value={nt} className="italic">{nt}</option>)}
      </optgroup>
    </select>
  )
}

function FileRunChip({
  run,
  onRemove,
}: {
  run: FileRun
  onRemove: (id: string) => void
}) {
  const label = run.read_number ? `R${run.read_number}: ${run.filename ?? run.file_id.slice(0, 8)}` : (run.filename ?? run.file_id.slice(0, 8))
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-surface-overlay border border-border-subtle text-text-primary max-w-[180px]">
      <span className="truncate">{label}</span>
      <button
        onClick={e => { e.stopPropagation(); onRemove(run.id) }}
        className="shrink-0 text-text-muted hover:text-red-400 transition-colors"
      >
        <X size={10} />
      </button>
    </span>
  )
}

function ExpandedExperimentRow({
  exp,
  customFields,
  onUpdate,
  onPatch,
}: {
  exp: Experiment
  customFields: SchemaField[]
  onUpdate: () => void
  onPatch: (body: Record<string, unknown>) => void
}) {
  const [editValues, setEditValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {}
    EXTRA_ATTRS_FIELDS.forEach(f => { v[f.key] = String(exp.attrs?.[f.key] ?? '') })
    customFields.forEach(f => { v[f.key] = String(exp.attrs?.[f.key] ?? '') })
    return v
  })
  const [dirty, setDirty] = useState(false)

  const set = (key: string, val: string) => { setEditValues(p => ({ ...p, [key]: val })); setDirty(true) }

  const save = async () => {
    const attrsUpdate: Record<string, unknown> = {}
    EXTRA_ATTRS_FIELDS.forEach(f => { attrsUpdate[f.key] = editValues[f.key] || null })
    customFields.forEach(f => { attrsUpdate[f.key] = editValues[f.key] || null })
    await fetch(`/api/experiments/${exp.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attrs: attrsUpdate }),
    })
    setDirty(false)
    onUpdate()
  }

  return (
    <div className="px-4 py-3 bg-surface-base border-b border-border-subtle/40 space-y-2">
      {/* library_selection — dedicated column, rendered here since table is already wide */}
      <div className="flex items-center gap-2 pb-2 border-b border-border-subtle/30">
        <span className="text-text-muted w-40 shrink-0 text-xs">Library Selection</span>
        <div className="w-48">
          <SraSelect
            value={exp.library_selection}
            options={LIBRARY_SELECTION}
            onChange={v => onPatch({ library_selection: v || null })}
          />
        </div>
      </div>
      <div className="text-xs font-medium text-text-muted uppercase tracking-wide mb-1">Additional SRA Fields</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {[...EXTRA_ATTRS_FIELDS, ...customFields].map(f => (
          <div key={f.key} className="flex items-center gap-2">
            <span className="text-text-muted w-40 shrink-0 text-xs">{f.label}</span>
            <input
              value={editValues[f.key] ?? ''}
              onChange={e => set(f.key, e.target.value)}
              className="flex-1 bg-surface-overlay text-text-primary rounded px-1.5 py-0.5 outline-none border border-border-subtle focus:border-blue-500 text-xs"
            />
          </div>
        ))}
      </div>
      {dirty && (
        <button
          onClick={save}
          className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-white mt-1"
        >
          Save
        </button>
      )}
    </div>
  )
}

export default function ExperimentTable({ projectId, customFields = [], onExperimentCountChange, refreshKey }: Props) {
  const { t } = useLanguage()
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [samples, setSamples] = useState<Sample[]>([])
  const [fileRunsMap, setFileRunsMap] = useState<Record<string, FileRun[]>>({})
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [pickerExpId, setPickerExpId] = useState<string | null>(null)

  const load = async () => {
    const [exps, samps] = await Promise.all([
      fetch(`/api/experiments/?project_id=${projectId}`).then(r => r.json()).catch(() => []),
      fetch(`/api/samples/?project_id=${projectId}`).then(r => r.json()).catch(() => []),
    ])
    const sampleMap: Record<string, string> = {}
    for (const s of samps) sampleMap[s.id] = s.sample_name
    const enriched = exps.map((e: Experiment) => ({ ...e, sample_name: sampleMap[e.sample_id] ?? e.sample_id }))
    setExperiments(enriched)
    setSamples(samps)
    onExperimentCountChange?.(enriched.length)

    // Load file runs for all experiments
    const frMap: Record<string, FileRun[]> = {}
    await Promise.all(enriched.map(async (e: Experiment) => {
      const runs = await fetch(`/api/file-runs/?experiment_id=${e.id}`).then(r => r.json()).catch(() => [])
      frMap[e.id] = runs
    }))
    setFileRunsMap(frMap)
  }

  useEffect(() => { load() }, [projectId, refreshKey])

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const patchExperiment = async (id: string, body: Record<string, unknown>) => {
    await fetch(`/api/experiments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    await load()
  }

  const handlePlatformChange = (exp: Experiment, newPlatform: string) => {
    const body: Record<string, unknown> = { platform: newPlatform || null }
    // Clear instrument_model if incompatible
    const validModels = INSTRUMENT_MODELS[newPlatform] ?? []
    if (exp.instrument_model && !validModels.includes(exp.instrument_model)) {
      body.instrument_model = null
    }
    patchExperiment(exp.id, body)
  }

  const removeFileRun = async (runId: string) => {
    await fetch(`/api/file-runs/${runId}`, { method: 'DELETE' })
    await load()
  }

  const handleFilePicked = async (expId: string, selections: { fileId: string; filename: string; readNumber: number | null }[]) => {
    setPickerExpId(null)
    if (selections.length === 0) return

    // Remove existing runs first, then create new batch
    const existing = fileRunsMap[expId] ?? []
    await Promise.all(existing.map(r => fetch(`/api/file-runs/${r.id}`, { method: 'DELETE' })))

    await fetch('/api/file-runs/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runs: selections.map(s => ({
          experiment_id: expId,
          file_id: s.fileId,
          filename: s.filename,
          read_number: s.readNumber,
        })),
      }),
    })
    await load()
  }

  const addExperiment = async () => {
    if (samples.length === 0) return
    await fetch('/api/experiments/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, sample_id: samples[0].id }),
    })
    await load()
  }

  const deleteExperiment = async (id: string) => {
    await fetch(`/api/experiments/${id}`, { method: 'DELETE' })
    await load()
  }

  const pickerExp = pickerExpId ? experiments.find(e => e.id === pickerExpId) : null

  if (experiments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-3 text-text-muted text-xs">
        <p>{t('experiment_empty')}</p>
        {samples.length > 0 && (
          <button onClick={addExperiment} className="text-xs px-3 py-1 bg-accent hover:bg-accent-hover rounded text-white">
            {t('experiment_add')}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-auto">
        <table className="text-xs w-full border-collapse">
          <thead className="sticky top-0 bg-surface-raised z-10">
            <tr>
              <th className="w-6 px-1 py-1.5 border-b border-border-subtle" />
              <th className="text-left px-2 py-1.5 border-b border-border-subtle text-text-muted whitespace-nowrap">{t('experiment_col_sample')}</th>
              <th className="text-left px-2 py-1.5 border-b border-border-subtle text-text-muted whitespace-nowrap">{t('experiment_col_library_strategy')}<span className="text-red-400 ml-0.5">*</span></th>
              <th className="text-left px-2 py-1.5 border-b border-border-subtle text-text-muted whitespace-nowrap">{t('experiment_col_library_source')}</th>
              <th className="text-left px-2 py-1.5 border-b border-border-subtle text-text-muted whitespace-nowrap">{t('experiment_col_library_layout')}</th>
              <th className="text-left px-2 py-1.5 border-b border-border-subtle text-text-muted whitespace-nowrap">{t('experiment_col_platform')}</th>
              <th className="text-left px-2 py-1.5 border-b border-border-subtle text-text-muted whitespace-nowrap">{t('experiment_col_instrument_model')}</th>
              <th className="text-left px-2 py-1.5 border-b border-border-subtle text-text-muted whitespace-nowrap">Files</th>
              <th className="w-6 px-1 py-1.5 border-b border-border-subtle" />
            </tr>
          </thead>
          <tbody>
            {experiments.map(exp => {
              const isExpanded = expandedIds.has(exp.id)
              const runs = fileRunsMap[exp.id] ?? []
              const instrumentOptions = INSTRUMENT_MODELS[exp.platform ?? ''] ?? []

              return (
                <>
                  <tr key={exp.id} className="group hover:bg-surface-hover">
                    {/* Expand toggle */}
                    <td className="px-1 border-b border-border-subtle/40 text-center">
                      <button onClick={() => toggleExpand(exp.id)} className="text-text-muted hover:text-text-primary p-0.5">
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </button>
                    </td>

                    {/* Sample (editable dropdown) */}
                    <td className="px-1 py-0.5 border-b border-border-subtle/40 min-w-[80px] max-w-[140px]">
                      <select
                        value={exp.sample_id}
                        onChange={e => patchExperiment(exp.id, { sample_id: e.target.value })}
                        className="w-full bg-surface-overlay rounded px-1 py-0.5 text-xs outline-none border border-transparent focus:border-blue-500 cursor-pointer text-text-primary"
                      >
                        {samples.map(s => (
                          <option key={s.id} value={s.id}>{s.sample_name}</option>
                        ))}
                      </select>
                    </td>

                    {/* library_strategy */}
                    <td className="px-1 py-0.5 border-b border-border-subtle/40 min-w-[100px]">
                      <SraSelect value={exp.library_strategy} options={LIBRARY_STRATEGY} onChange={v => patchExperiment(exp.id, { library_strategy: v || null })} />
                    </td>

                    {/* library_source */}
                    <td className="px-1 py-0.5 border-b border-border-subtle/40 min-w-[100px]">
                      <SraSelect value={exp.library_source} options={LIBRARY_SOURCE} onChange={v => patchExperiment(exp.id, { library_source: v || null })} />
                    </td>

                    {/* library_layout */}
                    <td className="px-1 py-0.5 border-b border-border-subtle/40 min-w-[80px]">
                      <SraSelect value={exp.library_layout} options={LIBRARY_LAYOUT} onChange={v => patchExperiment(exp.id, { library_layout: v || null })} />
                    </td>

                    {/* platform */}
                    <td className="px-1 py-0.5 border-b border-border-subtle/40 min-w-[100px]">
                      <SraSelect value={exp.platform} options={PLATFORM} onChange={v => handlePlatformChange(exp, v)} />
                    </td>

                    {/* instrument_model — filtered by platform */}
                    <td className="px-1 py-0.5 border-b border-border-subtle/40 min-w-[120px]">
                      <SraSelect
                        value={exp.instrument_model}
                        options={instrumentOptions}
                        onChange={v => patchExperiment(exp.id, { instrument_model: v || null })}
                        placeholder={exp.platform ? '—' : '(select platform first)'}
                      />
                    </td>

                    {/* Files (FileRun chips) */}
                    <td
                      className="px-2 py-1 border-b border-border-subtle/40 min-w-[150px] cursor-pointer"
                      onClick={() => setPickerExpId(exp.id)}
                    >
                      <div className="flex flex-wrap gap-1 items-center">
                        {runs.map(run => (
                          <FileRunChip key={run.id} run={run} onRemove={removeFileRun} />
                        ))}
                        <span className="text-xs text-text-muted hover:text-accent transition-colors px-1">
                          {runs.length === 0 ? '+ Add files' : '+'}
                        </span>
                      </div>
                    </td>

                    {/* Delete */}
                    <td className="px-1 border-b border-border-subtle/40">
                      <button
                        onClick={() => deleteExperiment(exp.id)}
                        className="opacity-0 group-hover:opacity-30 hover:!opacity-100 hover:text-red-400 transition-opacity"
                      >
                        🗑
                      </button>
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr key={`${exp.id}-expanded`}>
                      <td colSpan={9} className="p-0">
                        <ExpandedExperimentRow exp={exp} customFields={customFields} onUpdate={load} onPatch={body => patchExperiment(exp.id, body)} />
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
        <button
          onClick={addExperiment}
          disabled={samples.length === 0}
          className="text-xs text-text-muted hover:text-text-primary disabled:opacity-40"
        >
          {t('experiment_add')}
        </button>
      </div>

      {pickerExp && (
        <FilePickerModal
          projectId={projectId}
          experimentId={pickerExp.id}
          libraryLayout={pickerExp.library_layout}
          existingFileIds={new Set((fileRunsMap[pickerExp.id] ?? []).map(r => r.file_id))}
          onConfirm={sels => handleFilePicked(pickerExp.id, sels)}
          onClose={() => setPickerExpId(null)}
        />
      )}
    </div>
  )
}
