import { useEffect, useRef, useState } from 'react'
import { X, Sparkles, ChevronDown, ChevronUp, Check, Trash2 } from 'lucide-react'

interface HealthData {
  sample_count: number
  sample_complete: number
  sample_partial: number
  sample_missing: number
  experiment_count: number
  experiment_complete: number
  experiment_partial: number
  files_linked: number
  files_total_fastq: number
  files_unlinked: number
}

interface ProposalPayloadItem {
  key: string
  [k: string]: unknown
}

interface ProposalPayload {
  samples_to_create?: ProposalPayloadItem[]
  samples_to_update?: ProposalPayloadItem[]
  experiments_to_update?: ProposalPayloadItem[]
  file_links_to_create?: ProposalPayloadItem[]
  custom_fields_to_register?: ProposalPayloadItem[]
  gap_report?: {
    sample_count: number
    sample_complete: number
    sample_partial: number
    experiment_count: number
    experiment_complete: number
    files_linked: number
    files_unlinked: number
    files_total_fastq: number
    suggested_actions?: { task_type: string; label: string }[]
  }
  error?: string
  truncated?: boolean
}

interface Proposal {
  id: string
  project_id: string
  task_type: string
  status: 'running' | 'pending' | 'applied' | 'discarded' | 'failed'
  instruction: string | null
  payload: ProposalPayload | null
  created_at: string
  applied_at: string | null
}

const TASK_TYPES = [
  { type: 'infer-samples', label: 'Infer Samples', labelZh: '推断样本', icon: '🔍' },
  { type: 'fill-samples', label: 'Fill Samples', labelZh: '补全样本', icon: '🧬' },
  { type: 'fill-experiments', label: 'Fill Experiments', labelZh: '补全实验', icon: '🔬' },
  { type: 'link-files', label: 'Link Files', labelZh: '关联文件', icon: '🔗' },
  { type: 'check-gaps', label: 'Check Gaps', labelZh: '检查缺口', icon: '📋' },
]

function HealthDashboard({ health, onQuickFix }: {
  health: HealthData | null
  onQuickFix: (taskType: string) => void
}) {
  if (!health) return null

  const items: { label: string; value: string; warn: boolean; taskType?: string }[] = [
    {
      label: 'Samples',
      value: `${health.sample_complete}/${health.sample_count} complete`,
      warn: health.sample_missing > 0 || health.sample_partial > 0,
      taskType: health.sample_missing > 0 ? 'fill-samples' : undefined,
    },
    {
      label: 'Experiments',
      value: `${health.experiment_complete}/${health.experiment_count} complete`,
      warn: health.experiment_partial > 0,
      taskType: health.experiment_partial > 0 ? 'fill-experiments' : undefined,
    },
    {
      label: 'Files linked',
      value: `${health.files_linked}/${health.files_total_fastq}`,
      warn: health.files_unlinked > 0,
      taskType: health.files_unlinked > 0 ? 'link-files' : undefined,
    },
  ]

  const noSamples = health.sample_count === 0 && health.files_total_fastq > 0

  return (
    <div className="border border-border-subtle rounded-lg p-2.5 mb-3 bg-surface-overlay">
      <div className="text-xs font-medium text-text-muted mb-2 uppercase tracking-wide">Health</div>
      {noSamples && (
        <div className="flex items-center justify-between mb-1.5 text-xs">
          <span className="text-amber-400">{health.files_total_fastq} FASTQ files, no samples</span>
          <button
            onClick={() => onQuickFix('infer-samples')}
            className="text-xs px-2 py-0.5 rounded bg-accent/20 text-accent hover:bg-accent/30"
          >
            Infer
          </button>
        </div>
      )}
      {items.map(item => (
        <div key={item.label} className="flex items-center justify-between py-0.5">
          <span className="text-xs text-text-muted">{item.label}</span>
          <div className="flex items-center gap-1.5">
            <span className={`text-xs ${item.warn ? 'text-amber-400' : 'text-text-primary'}`}>
              {item.value}
            </span>
            {item.warn && item.taskType && (
              <button
                onClick={() => onQuickFix(item.taskType!)}
                className="text-xs px-1.5 py-0.5 rounded bg-accent/20 text-accent hover:bg-accent/30"
              >
                Fix
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ProposalCard
// ---------------------------------------------------------------------------

function ItemList({ items, checkedKeys, onToggle, renderItem }: {
  items: ProposalPayloadItem[]
  checkedKeys: Set<string>
  onToggle: (key: string) => void
  renderItem: (item: ProposalPayloadItem) => React.ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? items : items.slice(0, 3)

  return (
    <div className="space-y-1">
      {visible.map(item => (
        <div key={item.key} className="flex items-start gap-2 py-0.5">
          <input
            type="checkbox"
            checked={checkedKeys.has(item.key)}
            onChange={() => onToggle(item.key)}
            className="mt-0.5 shrink-0"
          />
          <div className="flex-1 text-xs text-text-primary">{renderItem(item)}</div>
        </div>
      ))}
      {items.length > 3 && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1 mt-1"
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? 'Show less' : `Show ${items.length - 3} more`}
        </button>
      )}
    </div>
  )
}

function ProposalCard({ proposal, onApply, onDiscard }: {
  proposal: Proposal
  onApply: (id: string, acceptedKeys: string[] | null) => void
  onDiscard: (id: string) => void
}) {
  const payload = proposal.payload || {}
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(() => {
    const all = new Set<string>()
    ;[
      ...(payload.samples_to_create || []),
      ...(payload.samples_to_update || []),
      ...(payload.experiments_to_update || []),
      ...(payload.file_links_to_create || []),
      ...(payload.custom_fields_to_register || []),
    ].forEach(i => all.add(i.key))
    return all
  })

  const toggle = (key: string) => setCheckedKeys(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const allKeys = [
    ...(payload.samples_to_create || []),
    ...(payload.samples_to_update || []),
    ...(payload.experiments_to_update || []),
    ...(payload.file_links_to_create || []),
    ...(payload.custom_fields_to_register || []),
  ].map(i => i.key)

  const allChecked = allKeys.every(k => checkedKeys.has(k))
  const hasItems = allKeys.length > 0

  const taskLabel = TASK_TYPES.find(t => t.type === proposal.task_type)?.label ?? proposal.task_type

  return (
    <div className="border border-border-subtle rounded-lg bg-surface-overlay mb-3">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle/50">
        <span className="text-xs font-medium text-text-primary">{taskLabel}</span>
        <button onClick={() => onDiscard(proposal.id)} className="text-text-muted hover:text-red-400">
          <Trash2 size={12} />
        </button>
      </div>

      {/* Error */}
      {payload.error && (
        <p className="px-3 py-2 text-xs text-red-400">{payload.error}</p>
      )}

      {/* Gap report (check-gaps task) */}
      {payload.gap_report && (
        <div className="px-3 py-2 space-y-1">
          {(payload.gap_report.suggested_actions || []).map((a, i) => (
            <div key={i} className="text-xs text-text-muted">• {a.label}</div>
          ))}
          {(payload.gap_report.suggested_actions || []).length === 0 && (
            <p className="text-xs text-green-400">No gaps detected.</p>
          )}
        </div>
      )}

      {/* samples_to_create */}
      {(payload.samples_to_create || []).length > 0 && (
        <div className="px-3 py-2 border-t border-border-subtle/30">
          <div className="text-xs text-text-muted mb-1">Samples to create ({payload.samples_to_create!.length})</div>
          <ItemList
            items={payload.samples_to_create!}
            checkedKeys={checkedKeys}
            onToggle={toggle}
            renderItem={item => <span>{item.sample_name as string}{item.organism ? ` — ${item.organism as string}` : ''}</span>}
          />
        </div>
      )}

      {/* samples_to_update */}
      {(payload.samples_to_update || []).length > 0 && (
        <div className="px-3 py-2 border-t border-border-subtle/30">
          <div className="text-xs text-text-muted mb-1">Samples to update ({payload.samples_to_update!.length})</div>
          <ItemList
            items={payload.samples_to_update!}
            checkedKeys={checkedKeys}
            onToggle={toggle}
            renderItem={item => {
              const changes = item.changes as Record<string, unknown>
              const changeStr = Object.entries(changes).map(([k, v]) => `${k}: ${v}`).join(', ')
              return <span><strong>{item.sample_name as string}</strong> → {changeStr}</span>
            }}
          />
        </div>
      )}

      {/* experiments_to_update */}
      {(payload.experiments_to_update || []).length > 0 && (
        <div className="px-3 py-2 border-t border-border-subtle/30">
          <div className="text-xs text-text-muted mb-1">Experiments to update ({payload.experiments_to_update!.length})</div>
          <ItemList
            items={payload.experiments_to_update!}
            checkedKeys={checkedKeys}
            onToggle={toggle}
            renderItem={item => {
              const changes = item.changes as Record<string, unknown>
              const attrsChanges = (changes.attrs || {}) as Record<string, unknown>
              const parts = [
                ...Object.entries(changes).filter(([k]) => k !== 'attrs').map(([k, v]) => `${k}: ${v}`),
                ...Object.entries(attrsChanges).map(([k, v]) => `${k}: ${v}`),
              ]
              return (
                <span>
                  <strong>{item.sample_name as string}</strong>
                  {parts.length > 0 ? ` → ${parts.join(', ')}` : ''}
                </span>
              )
            }}
          />
        </div>
      )}

      {/* file_links_to_create */}
      {(payload.file_links_to_create || []).length > 0 && (
        <div className="px-3 py-2 border-t border-border-subtle/30">
          <div className="text-xs text-text-muted mb-1">File links to create ({payload.file_links_to_create!.length})</div>
          <ItemList
            items={payload.file_links_to_create!}
            checkedKeys={checkedKeys}
            onToggle={toggle}
            renderItem={item => (
              <span>
                {item.filename as string}
                {item.read_number != null ? ` (R${item.read_number})` : ''}
                {' → '}
                {item.inferred_sample_name as string}
                <span className="ml-1 text-text-muted">
                  {Math.round((item.confidence as number) * 100)}%
                </span>
              </span>
            )}
          />
        </div>
      )}

      {/* custom_fields_to_register */}
      {(payload.custom_fields_to_register || []).length > 0 && (
        <div className="px-3 py-2 border-t border-border-subtle/30">
          <div className="text-xs text-text-muted mb-1">Custom fields to register</div>
          <ItemList
            items={payload.custom_fields_to_register!}
            checkedKeys={checkedKeys}
            onToggle={toggle}
            renderItem={item => (
              <span>
                <strong>{item.field_name as string}</strong>
                {' '}({item.object_type as string}, {item.inferred_type as string})
                {item.example_value ? ` e.g. "${item.example_value}"` : ''}
              </span>
            )}
          />
        </div>
      )}

      {/* Footer */}
      {hasItems && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-border-subtle/50">
          <span className="text-xs text-text-muted">{checkedKeys.size}/{allKeys.length} selected</span>
          <div className="flex gap-2">
            <button
              onClick={() => onApply(proposal.id, allChecked ? null : Array.from(checkedKeys))}
              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-accent hover:bg-accent-hover text-white"
            >
              <Check size={11} />
              {allChecked ? 'Apply All' : 'Apply Selected'}
            </button>
          </div>
        </div>
      )}
      {!hasItems && !payload.error && !payload.gap_report && (
        <p className="px-3 py-2 text-xs text-text-muted">No changes suggested.</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main MetadataAssistant
// ---------------------------------------------------------------------------

export default function MetadataAssistant({ projectId, onRefresh, onClose }: {
  projectId: string
  onRefresh: () => void
  onClose: () => void
}) {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [instruction, setInstruction] = useState('')
  const [selectedTask, setSelectedTask] = useState<string>('')
  const [running, setRunning] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadHealth = async () => {
    try {
      const r = await fetch(`/api/projects/${projectId}/health`)
      if (r.ok) setHealth(await r.json())
    } catch { /* ignore */ }
  }

  const loadProposals = async () => {
    try {
      const r = await fetch(`/api/metadata-assistant/proposals?project_id=${projectId}&status=pending`)
      if (r.ok) setProposals(await r.json())
    } catch { /* ignore */ }
  }

  useEffect(() => {
    loadHealth()
    loadProposals()
  }, [projectId])

  const submitTask = async (taskType: string, inst: string) => {
    setRunning(true)
    try {
      const r = await fetch('/api/metadata-assistant/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          task_type: taskType,
          instruction: inst || null,
        }),
      })
      if (!r.ok) return
      const { proposal_id } = await r.json()

      // Poll until status != running
      let attempts = 0
      pollingRef.current = setInterval(async () => {
        attempts++
        if (attempts > 60) {
          clearInterval(pollingRef.current!)
          setRunning(false)
          return
        }
        try {
          const pr = await fetch(`/api/metadata-assistant/proposals/${proposal_id}`)
          if (!pr.ok) return
          const p: Proposal = await pr.json()
          if (p.status !== 'running') {
            clearInterval(pollingRef.current!)
            setRunning(false)
            if (p.status === 'pending') {
              setProposals(prev => [p, ...prev])
            }
            loadHealth()
          }
        } catch { /* ignore */ }
      }, 1000)
    } catch {
      setRunning(false)
    }
  }

  const handleSubmit = () => {
    const taskType = selectedTask || 'fill-samples'
    submitTask(taskType, instruction)
    setInstruction('')
  }

  const handleQuickFix = (taskType: string) => {
    setSelectedTask(taskType)
    submitTask(taskType, '')
  }

  const applyProposal = async (id: string, acceptedKeys: string[] | null) => {
    const body: Record<string, unknown> = {}
    if (acceptedKeys) body.accepted_keys = acceptedKeys
    const r = await fetch(`/api/metadata-assistant/proposals/${id}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (r.ok) {
      setProposals(prev => prev.filter(p => p.id !== id))
      loadHealth()
      onRefresh()
    }
  }

  const discardProposal = async (id: string) => {
    const r = await fetch(`/api/metadata-assistant/proposals/${id}/discard`, { method: 'POST' })
    if (r.ok) setProposals(prev => prev.filter(p => p.id !== id))
  }

  useEffect(() => () => { if (pollingRef.current) clearInterval(pollingRef.current) }, [])

  return (
    <div className="w-[360px] shrink-0 flex flex-col border-l border-border-subtle bg-surface-raised overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle shrink-0">
        <div className="flex items-center gap-1.5">
          <Sparkles size={13} className="text-accent" />
          <span className="text-xs font-semibold text-text-primary">Metadata Assistant</span>
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary">
          <X size={14} />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {/* Health dashboard */}
        <HealthDashboard health={health} onQuickFix={handleQuickFix} />

        {/* Task picker */}
        <div className="flex flex-wrap gap-1 mb-3">
          {TASK_TYPES.map(tt => (
            <button
              key={tt.type}
              onClick={() => setSelectedTask(tt.type === selectedTask ? '' : tt.type)}
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                selectedTask === tt.type
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-border-subtle text-text-muted hover:border-text-muted'
              }`}
            >
              {tt.icon} {tt.label}
            </button>
          ))}
        </div>

        {/* Instruction input */}
        <div className="mb-3">
          <textarea
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            placeholder={selectedTask
              ? `Additional instruction for ${TASK_TYPES.find(t => t.type === selectedTask)?.label ?? selectedTask}…`
              : 'Describe what to fill in (or pick a task above)…'
            }
            rows={2}
            disabled={running}
            className="w-full bg-surface-overlay text-text-primary text-xs rounded border border-border-subtle px-2.5 py-1.5 outline-none focus:border-blue-500 resize-none disabled:opacity-50"
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={running}
            className="mt-1.5 w-full text-xs py-1.5 rounded bg-accent hover:bg-accent-hover text-white disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {running ? (
              <>
                <span className="animate-spin inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full" />
                Running…
              </>
            ) : (
              <>
                <Sparkles size={12} />
                {selectedTask ? `Run: ${TASK_TYPES.find(t => t.type === selectedTask)?.label}` : 'Run Task'}
              </>
            )}
          </button>
        </div>

        {/* Pending proposals */}
        {proposals.length > 0 && (
          <>
            <div className="text-xs font-medium text-text-muted mb-2 uppercase tracking-wide">
              Pending ({proposals.length})
            </div>
            {proposals.map(p => (
              <ProposalCard key={p.id} proposal={p} onApply={applyProposal} onDiscard={discardProposal} />
            ))}
          </>
        )}

        {proposals.length === 0 && !running && (
          <p className="text-xs text-text-muted text-center py-4 italic">
            No pending proposals. Pick a task above to get started.
          </p>
        )}
      </div>
    </div>
  )
}
