import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '../i18n/LanguageContext'
import type { WSMessage } from '../hooks/useWebSocket'
import SampleTable from './SampleTable'
import ExperimentTable from './ExperimentTable'
import DataGlobalView from './DataGlobalView'
import DirectoryTreePanel from './DirectoryTreePanel'
import LineageDAG from './LineageDAG'
import MetadataAssistant from './MetadataAssistant'

interface FileNode {
  id: string
  filename: string
  path: string
  file_type: string
  size_bytes: number
  metadata_status: 'complete' | 'partial' | 'missing'
  project_id: string | null
}

interface ProjectHealth {
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

interface Project {
  id: string
  name: string
  project_dir: string
  description: string | null
  dir_path: string | null
  file_count: number
  metadata_complete: number
  metadata_partial: number
  metadata_missing: number
  project_info: Record<string, string>
  project_goal: string | null
  schema_extensions: {
    project_fields?: Record<string, { label: string; type: string }>
    sample_fields?: Record<string, { label: string; type: string }>
    experiment_fields?: Record<string, { label: string; type: string }>
  }
  health: ProjectHealth | undefined
  data_path?: string | null
  analysis_path?: string | null
  resource_entity_summary?: {
    total: number
    reference_count: number
    annotation_count: number
    index_count: number
  }
}

type KnownPathClassification = 'primary_resource' | 'legacy_index_override' | 'custom'

interface KnownPathEntry {
  id: string
  project_id: string
  key: string
  path: string
  description: string | null
  created_at?: string | null
  policy: {
    classification: KnownPathClassification
    note?: string
  }
}

interface ResourceEntityComponent {
  file_id: string
  path: string | null
  file_role: string
  is_primary: boolean
}

interface ResourceEntityDecisionRecord {
  decision?: string
  recognized_path?: string | null
  registered_path?: string | null
  updated_at?: string | null
}

interface ResourceEntityEntry {
  id: string
  resource_role: string
  display_name: string
  organism?: string | null
  genome_build?: string | null
  status?: string | null
  source_type?: string | null
  source_uri?: string | null
  metadata_json?: {
    known_path_decisions?: Record<string, ResourceEntityDecisionRecord>
  } | null
  components: ResourceEntityComponent[]
}

interface RegistryFocusRequest {
  nonce: number
  key: string
  path?: string
  description?: string
}

export interface ResourceWorkspaceRequest {
  nonce: number
  tab?: ProjectTab
  focusSection?: 'recognized' | 'registry'
  key?: string
  path?: string
  description?: string
}

const RECOGNIZED_RESOURCE_TARGETS = {
  reference: { key: 'reference_fasta', fileRole: 'reference_fasta' },
  reference_bundle: { key: 'reference_fasta', fileRole: 'reference_fasta' },
  reference_fasta: { key: 'reference_fasta', fileRole: 'reference_fasta' },
  annotation: { key: 'annotation_gtf', fileRole: 'annotation_gtf' },
  annotation_bundle: { key: 'annotation_gtf', fileRole: 'annotation_gtf' },
  annotation_gtf: { key: 'annotation_gtf', fileRole: 'annotation_gtf' },
} as const

function formatDecisionTimestamp(value: string | null | undefined, lang: 'en' | 'zh'): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getRecognizedResourceTarget(entity: ResourceEntityEntry) {
  const direct = RECOGNIZED_RESOURCE_TARGETS[entity.resource_role as keyof typeof RECOGNIZED_RESOURCE_TARGETS]
  if (direct) return direct
  if (entity.components.some((component) => component.file_role === 'reference_fasta')) {
    return RECOGNIZED_RESOURCE_TARGETS.reference_fasta
  }
  if (entity.components.some((component) => component.file_role === 'annotation_gtf')) {
    return RECOGNIZED_RESOURCE_TARGETS.annotation_gtf
  }
  return null
}

function getRecognizedPrimaryPath(
  entity: ResourceEntityEntry,
  fileRole: string,
): string | null {
  const matchingComponents = entity.components.filter((component) => (
    component.file_role === fileRole && component.path
  ))
  return matchingComponents.find((component) => component.is_primary)?.path
    ?? matchingComponents[0]?.path
    ?? null
}

const PROJECT_DIR_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

function sanitizeDir(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

interface Props {
  selectedProject: string | null
  ws?: { send: (msg: WSMessage) => void }
  onHealthChange?: () => void
  onProjectDeselect?: () => void
  onProjectSelect?: (id: string, name: string) => void
  workspaceRequest?: ResourceWorkspaceRequest | null
  onWorkspaceRequestHandled?: () => void
}

type ProjectTab = 'project-info' | 'samples' | 'experiments' | 'files' | 'lineage'

export default function DataBrowser({
  selectedProject,
  ws,
  onHealthChange,
  onProjectDeselect,
  onProjectSelect,
  workspaceRequest,
  onWorkspaceRequestHandled,
}: Props) {
  const { t } = useLanguage()
  const [files, setFiles] = useState<FileNode[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [selected, setSelected] = useState<FileNode | null>(null)
  const [scanStatus, setScanStatus] = useState<Record<string, unknown>>({})
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set())
  const [showAssignDialog, setShowAssignDialog] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ projectId: string; projectName: string; fileCount: number } | null>(null)
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ProjectTab>('samples')
  const [sampleCount, setSampleCount] = useState(0)
  const [experimentCount, setExperimentCount] = useState(0)
  const [showNewProject, setShowNewProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDir, setNewProjectDir] = useState('')
  const [newDataDir, setNewDataDir] = useState('')
  const [dataDirManuallyEdited, setDataDirManuallyEdited] = useState(false)
  const [dirManuallyEdited, setDirManuallyEdited] = useState(false)
  const [pickingDataDir, setPickingDataDir] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [tableRefreshKey, setTableRefreshKey] = useState(0)

  const refresh = async () => {
    const [f, p, s] = await Promise.all([
      fetch('/api/files/').then((r) => r.json()).catch(() => []),
      fetch('/api/projects/').then((r) => r.json()).catch(() => []),
      fetch('/api/files/scan/status').then((r) => r.json()).catch(() => ({})),
    ])
    setFiles(f)
    setProjects(p)
    setScanStatus(s)
    setTableRefreshKey(k => k + 1)
  }

  useEffect(() => { refresh() }, [])

  // Auto-suggest project_dir (analysis dir) from project name, unless manually edited or data dir was picked
  useEffect(() => {
    if (!dirManuallyEdited && !dataDirManuallyEdited) setNewProjectDir(sanitizeDir(newProjectName))
  }, [newProjectName, dirManuallyEdited, dataDirManuallyEdited])

  const pickNewDataDir = async () => {
    setPickingDataDir(true)
    try {
      const cfgRes = await fetch('/api/config/')
      const cfg = await cfgRes.json()
      const dataDir: string = cfg.data_dir || ''

      const pickRes = await fetch(
        `/api/fs/pick-directory?initial_dir=${encodeURIComponent(dataDir)}`,
        { method: 'POST' }
      )
      const picked = await pickRes.json()
      if (picked.cancelled || !picked.path) return

      // Compute relative path (strip data_dir prefix)
      let rel: string = picked.path
      if (dataDir && picked.path.startsWith(dataDir + '/')) {
        rel = picked.path.slice(dataDir.length + 1)
      }

      setNewDataDir(rel)
      setDataDirManuallyEdited(true)

      // Auto-fill analysis dir from last component of picked data dir, unless manually edited
      if (!dirManuallyEdited) {
        const lastName = rel.split('/').pop() || rel
        setNewProjectDir(sanitizeDir(lastName))
      }
    } catch {
      // silently ignore picker errors
    } finally {
      setPickingDataDir(false)
    }
  }

  const createProject = async () => {
    if (!newProjectName.trim() || !newDataDir.trim() || !PROJECT_DIR_RE.test(newProjectDir)) return
    setCreating(true)
    setCreateError(null)
    try {
      const resp = await fetch('/api/projects/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProjectName.trim(),
          project_dir: newProjectDir.trim(),
          dir_path: newDataDir.trim(),
        }),
      })
      if (resp.ok) {
        setShowNewProject(false)
        setNewProjectName('')
        setNewProjectDir('')
        setNewDataDir('')
        setDirManuallyEdited(false)
        setDataDirManuallyEdited(false)
        await refresh()
        onHealthChange?.()
      } else {
        const data = await resp.json().catch(() => ({})) as { detail?: string }
        setCreateError(resp.status === 409 ? t('project_dir_duplicate') : (data.detail ?? t('project_dir_invalid')))
      }
    } finally {
      setCreating(false)
    }
  }

  // Reset file selection when project changes
  useEffect(() => {
    setSelected(null)
    setSelectedFileIds(new Set())
    setActiveTab('samples')
  }, [selectedProject])

  useEffect(() => {
    if (!workspaceRequest) return
    if (workspaceRequest.tab) {
      setActiveTab(workspaceRequest.tab)
    }
    if (workspaceRequest.focusSection) {
      setActiveTab('project-info')
    } else {
      onWorkspaceRequestHandled?.()
    }
  }, [workspaceRequest, onWorkspaceRequestHandled])

  const projectFiles = (pid: string) => files.filter((f) => f.project_id === pid)

  const selectedProjectData = projects.find(p => p.id === selectedProject) ?? null

  const deleteProject = async (projectId: string, projectName: string) => {
    const resp = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' })
    if (resp.ok) {
      setDeleteConfirm(null)
      let fileCount: number | null = null
      try {
        const data = await resp.json()
        fileCount = data.deleted_files
      } catch { /* ignore */ }
      setDeleteSuccess(
        fileCount !== null
          ? t('data_delete_success_with_count').replace('{name}', projectName).replace('{count}', String(fileCount))
          : t('data_delete_success').replace('{name}', projectName)
      )
      setTimeout(() => setDeleteSuccess(null), 4000)
      if (selectedProject === projectId) onProjectDeselect?.()
      await refresh()
      onHealthChange?.()
    }
  }

  const assignToProject = async (projectId: string) => {
    if (selectedFileIds.size === 0) return
    await fetch(`/api/projects/${projectId}/assign-files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_ids: [...selectedFileIds] }),
    })
    setSelectedFileIds(new Set())
    setShowAssignDialog(false)
    await refresh()
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border-subtle">
        <span className="text-xs font-semibold text-text-muted uppercase flex-1">{t('data_heading')}</span>
        {scanStatus.status === 'running' && (
          <span className="text-xs text-blue-400">
            {t('data_scanning')
              .replace('{processed}', String(scanStatus.total_processed as number))
              .replace('{discovered}', String(scanStatus.total_discovered as number))}
          </span>
        )}
        {selectedFileIds.size > 0 && (
          <button
            onClick={() => setShowAssignDialog(true)}
            className="text-xs px-2 py-0.5 bg-blue-700 hover:bg-blue-600 rounded"
          >
            {t('data_assign_to_project')} ({selectedFileIds.size})
          </button>
        )}
        <button
          onClick={() => setShowNewProject(true)}
          className="text-xs px-2 py-0.5 bg-blue-700 hover:bg-blue-600 rounded"
        >
          {t('data_new_project')}
        </button>
        <button
          onClick={() => fetch('/api/files/scan/start', { method: 'POST' }).then(refresh).then(() => onHealthChange?.())}
          className="text-xs px-2 py-0.5 bg-surface-hover hover:bg-gray-600 rounded"
        >
          {t('data_rescan')}
        </button>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {selected ? (
          <FileDetail
            file={selected}
            onClose={() => setSelected(null)}
            onMetadataSaved={refresh}
            onOpenMetadataAssistant={() => {
              setSelected(null)
              setAssistantOpen(true)
            }}
          />
        ) : selectedProjectData ? (
          <div className="flex flex-1 overflow-hidden">
            <ProjectDetail
              project={selectedProjectData}
              files={projectFiles(selectedProjectData.id)}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              onFileSelect={setSelected}
              onRefresh={refresh}
              sampleCount={sampleCount}
              onSampleCountChange={setSampleCount}
              experimentCount={experimentCount}
              onExperimentCountChange={setExperimentCount}
              onDeleteProject={(count) =>
                setDeleteConfirm({ projectId: selectedProjectData.id, projectName: selectedProjectData.name, fileCount: count })
              }
              assistantOpen={assistantOpen}
              onToggleAssistant={() => setAssistantOpen(o => !o)}
              tableRefreshKey={tableRefreshKey}
              ws={ws}
              workspaceRequest={workspaceRequest}
              onWorkspaceRequestHandled={onWorkspaceRequestHandled}
            />
            {assistantOpen && (
              <MetadataAssistant
                projectId={selectedProjectData.id}
                onRefresh={refresh}
                onClose={() => setAssistantOpen(false)}
              />
            )}
          </div>
        ) : (
          <DataGlobalView
            projects={projects}
            onProjectSelect={(id, name) => onProjectSelect?.(id, name)}
          />
        )}
      </div>

      {/* Assign to project dialog */}
      {showAssignDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-surface-raised border border-gray-700 rounded-lg p-6 w-72 space-y-3">
            <h3 className="text-sm font-semibold text-white">{t('data_assign_to_project')}</h3>
            <div className="space-y-1">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => assignToProject(p.id)}
                  className="w-full text-left text-xs px-3 py-2 bg-surface-overlay hover:bg-surface-hover rounded text-white"
                >
                  {p.name} ({t('data_file_count').replace('{count}', String(p.file_count))})
                </button>
              ))}
            </div>
            <button onClick={() => setShowAssignDialog(false)} className="text-xs text-text-muted hover:text-text-primary">{t('data_cancel_btn')}</button>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-surface-raised border border-border-subtle rounded-lg p-5 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-sm font-semibold text-white mb-2">{t('data_delete_project_title')}</h3>
            <p className="text-xs text-text-primary mb-1">
              <span className="font-medium text-white">{deleteConfirm.projectName}</span>
              {' '}({t('data_delete_project_file_count').replace('{count}', String(deleteConfirm.fileCount))})
            </p>
            <p className="text-xs text-yellow-400 mb-4">
              {t('data_delete_project_warning')}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="text-xs px-3 py-1.5 rounded border border-border-subtle text-text-muted hover:text-text-primary"
              >
                {t('data_cancel_btn')}
              </button>
              <button
                onClick={() => deleteProject(deleteConfirm.projectId, deleteConfirm.projectName)}
                className="text-xs px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white font-medium"
              >
                {t('data_delete_btn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete success toast */}
      {deleteSuccess && (
        <div className="fixed bottom-4 right-4 bg-green-700 text-white text-xs px-4 py-2 rounded shadow-lg z-50">
          {deleteSuccess}
        </div>
      )}

      {/* New project dialog */}
      {showNewProject && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-surface-raised border border-border-subtle rounded-lg p-5 w-80 space-y-4 shadow-xl">
            <h3 className="text-sm font-semibold text-white">{t('data_new_project')}</h3>

            {/* Project name */}
            <div className="space-y-1">
              <label className="text-xs text-text-muted block">{t('data_project_name_label')}</label>
              <input
                autoFocus
                value={newProjectName}
                onChange={e => setNewProjectName(e.target.value)}
                placeholder={t('data_project_name_placeholder')}
                className="w-full bg-surface-overlay text-text-primary rounded px-2.5 py-1.5 text-xs outline-none border border-border-subtle focus:border-blue-500"
              />
            </div>

            {/* Data Directory (required) */}
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-text-muted">{t('data_path_label')}</label>
                <span className="text-xs text-text-muted cursor-help" title={t('data_dir_input_tooltip')}>ⓘ</span>
              </div>
              <div className="flex gap-1.5">
                <input
                  value={newDataDir}
                  onChange={e => {
                    setNewDataDir(e.target.value)
                    setDataDirManuallyEdited(true)
                    if (!dirManuallyEdited) {
                      const lastName = e.target.value.split('/').pop() || e.target.value
                      setNewProjectDir(sanitizeDir(lastName))
                    }
                  }}
                  placeholder={t('data_dir_input_placeholder')}
                  className="flex-1 bg-surface-overlay text-text-primary rounded px-2.5 py-1.5 text-xs outline-none border border-border-subtle focus:border-blue-500 font-mono"
                />
                <button
                  onClick={pickNewDataDir}
                  disabled={pickingDataDir}
                  className="shrink-0 px-2.5 py-1.5 bg-surface-hover hover:bg-gray-600 rounded text-xs disabled:opacity-50"
                >
                  {pickingDataDir ? '…' : t('dir_picker_open')}
                </button>
              </div>
            </div>

            {/* Analysis Directory (required, auto-fills from data dir) */}
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-text-muted">{t('analysis_path_label')}</label>
                <span className="text-xs text-text-muted cursor-help" title={t('project_dir_tooltip')}>ⓘ</span>
              </div>
              <input
                value={newProjectDir}
                onChange={e => { setNewProjectDir(e.target.value); setDirManuallyEdited(true) }}
                placeholder={t('project_dir_input_placeholder')}
                className={`w-full bg-surface-overlay text-text-primary rounded px-2.5 py-1.5 text-xs outline-none border font-mono focus:border-blue-500 ${
                  newProjectDir && !PROJECT_DIR_RE.test(newProjectDir)
                    ? 'border-red-500'
                    : newProjectDir && PROJECT_DIR_RE.test(newProjectDir)
                      ? 'border-green-600'
                      : 'border-border-subtle'
                }`}
              />
              {newProjectDir && !PROJECT_DIR_RE.test(newProjectDir) && (
                <p className="text-xs text-red-400">{t('project_dir_invalid')}</p>
              )}
              {createError && <p className="text-xs text-red-400">{createError}</p>}
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowNewProject(false)
                  setNewProjectName('')
                  setNewProjectDir('')
                  setNewDataDir('')
                  setDirManuallyEdited(false)
                  setDataDirManuallyEdited(false)
                  setCreateError(null)
                }}
                className="text-xs px-3 py-1.5 rounded border border-border-subtle text-text-muted hover:text-text-primary"
              >
                {t('data_cancel_btn')}
              </button>
              <button
                onClick={createProject}
                disabled={creating || !newProjectName.trim() || !newDataDir.trim() || !newProjectDir || !PROJECT_DIR_RE.test(newProjectDir)}
                className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50"
              >
                {creating ? '…' : t('data_create_project')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Project detail panel with 5 tabs
// ---------------------------------------------------------------------------

function ProjectDetail({
  project,
  files,
  activeTab,
  onTabChange,
  onFileSelect,
  onRefresh,
  sampleCount,
  onSampleCountChange,
  experimentCount,
  onExperimentCountChange,
  onDeleteProject,
  assistantOpen,
  onToggleAssistant,
  tableRefreshKey,
  ws,
  workspaceRequest,
  onWorkspaceRequestHandled,
}: {
  project: Project
  files: FileNode[]
  activeTab: ProjectTab
  onTabChange: (t: ProjectTab) => void
  onFileSelect: (f: FileNode) => void
  onRefresh: () => void
  sampleCount: number
  onSampleCountChange: (n: number) => void
  experimentCount: number
  onExperimentCountChange: (n: number) => void
  onDeleteProject: (fileCount: number) => void
  assistantOpen: boolean
  onToggleAssistant: () => void
  tableRefreshKey: number
  ws?: { send: (msg: WSMessage) => void }
  workspaceRequest?: ResourceWorkspaceRequest | null
  onWorkspaceRequestHandled?: () => void
}) {
  const { t } = useLanguage()

  const sampleFields = Object.entries(project.schema_extensions?.sample_fields || {})
    .map(([key, v]) => ({ key, label: v.label ?? key }))
  const experimentFields = Object.entries(project.schema_extensions?.experiment_fields || {})
    .map(([key, v]) => ({ key, label: v.label ?? key }))

  const TABS: { id: ProjectTab; label: string; count?: number }[] = [
    { id: 'project-info', label: t('tab_project_info') },
    { id: 'samples', label: t('sample_tab_samples'), count: sampleCount },
    { id: 'experiments', label: t('sample_tab_experiments'), count: experimentCount },
    { id: 'files', label: t('sample_tab_files'), count: files.length },
    { id: 'lineage', label: t('tab_lineage') },
  ]

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Project header */}
      <div className="border-b border-border-subtle px-4 pt-3 pb-0">
        <div className="flex items-start justify-between mb-1">
          <div>
            <h2 className="font-semibold text-white text-sm">📁 {project.name}</h2>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-xs text-text-muted font-mono">{project.project_dir}</span>
              {project.data_path && (
                <span className="text-xs text-text-muted truncate max-w-[180px]" title={project.data_path}>
                  {t('data_path_label')}: <span className="font-mono">{project.data_path}</span>
                </span>
              )}
              {project.analysis_path && (
                <span className="text-xs text-text-muted truncate max-w-[180px]" title={project.analysis_path}>
                  {t('analysis_path_label')}: <span className="font-mono">{project.analysis_path}</span>
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onToggleAssistant}
              className={`text-xs px-2 py-0.5 rounded border transition-colors flex items-center gap-1 ${
                assistantOpen
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-border-subtle text-text-muted hover:border-text-muted'
              }`}
              title="Metadata Assistant"
            >
              ✨ Assistant
            </button>
            <button
              onClick={() => onDeleteProject(project.file_count)}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
              title={t('data_delete_project_title')}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`text-xs px-3 py-1.5 border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-white'
                  : 'border-transparent text-text-muted hover:text-text-primary'
              }`}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="ml-1 text-text-muted text-xs">{tab.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === 'project-info' && (
          <ProjectInfoTab
            project={project}
            onRefresh={onRefresh}
            workspaceRequest={workspaceRequest}
            onWorkspaceRequestHandled={onWorkspaceRequestHandled}
          />
        )}
        {activeTab === 'samples' && (
          <div className="flex-1 overflow-hidden flex flex-col">
            <SampleTable
              projectId={project.id}
              customFields={sampleFields}
              onSampleCountChange={onSampleCountChange}
              refreshKey={tableRefreshKey}
            />
            <SampleFieldsManager
              project={project}
              fieldType="sample_fields"
              onRefresh={onRefresh}
            />
          </div>
        )}
        {activeTab === 'experiments' && (
          <div className="flex-1 overflow-hidden flex flex-col">
            <ExperimentTable
              projectId={project.id}
              customFields={experimentFields}
              onExperimentCountChange={onExperimentCountChange}
              refreshKey={tableRefreshKey}
            />
            <SampleFieldsManager
              project={project}
              fieldType="experiment_fields"
              onRefresh={onRefresh}
            />
          </div>
        )}
        {activeTab === 'files' && (
          <DirectoryTreePanel
            projectId={project.id}
            onFileSelect={onFileSelect}
            ws={ws}
            onOpenMetadataAssistant={() => { if (!assistantOpen) onToggleAssistant() }}
          />
        )}
        {activeTab === 'lineage' && (
          <LineageDAG projectId={project.id} />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Project Info tab
// ---------------------------------------------------------------------------

const PROJECT_INFO_FIELD_KEYS = [
  { key: 'project_title', labelKey: 'project_info_project_title', placeholderKey: 'project_info_project_title_placeholder' },
  { key: 'project_type', labelKey: 'project_info_project_type', placeholderKey: 'project_info_project_type_placeholder' },
  { key: 'PI', labelKey: 'project_info_pi', placeholderKey: 'project_info_pi_placeholder' },
  { key: 'institution', labelKey: 'project_info_institution', placeholderKey: 'project_info_institution_placeholder' },
  { key: 'organism', labelKey: 'project_info_organism', placeholderKey: 'project_info_organism_placeholder' },
  { key: 'project_date', labelKey: 'project_info_date', placeholderKey: 'project_info_date_placeholder' },
] as const

function ProjectInfoTab({
  project,
  onRefresh,
  workspaceRequest,
  onWorkspaceRequestHandled,
}: {
  project: Project
  onRefresh: () => void
  workspaceRequest?: ResourceWorkspaceRequest | null
  onWorkspaceRequestHandled?: () => void
}) {
  const { t, lang } = useLanguage()
  const [editingInfo, setEditingInfo] = useState(false)
  const [infoValues, setInfoValues] = useState<Record<string, string>>({})
  const [goalValue, setGoalValue] = useState('')
  const [editingGoal, setEditingGoal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [knownPaths, setKnownPaths] = useState<KnownPathEntry[]>([])
  const [loadingKnownPaths, setLoadingKnownPaths] = useState(false)
  const [knownPathsError, setKnownPathsError] = useState<string | null>(null)
  const [resourceEntities, setResourceEntities] = useState<ResourceEntityEntry[]>([])
  const [loadingResourceEntities, setLoadingResourceEntities] = useState(false)
  const [resourceEntitiesError, setResourceEntitiesError] = useState<string | null>(null)
  const [syncingResourceEntities, setSyncingResourceEntities] = useState(false)
  const [registryFocusRequest, setRegistryFocusRequest] = useState<RegistryFocusRequest | null>(null)
  const [recognizedFocusRequest, setRecognizedFocusRequest] = useState<ResourceWorkspaceRequest | null>(null)

  const PROJECT_INFO_FIELDS = PROJECT_INFO_FIELD_KEYS.map(({ key, labelKey, placeholderKey }) => ({
    key,
    label: t(labelKey),
    placeholder: t(placeholderKey),
  }))

  const displayName = project.project_info?.project_title || project.name

  const loadKnownPaths = async () => {
    setLoadingKnownPaths(true)
    setKnownPathsError(null)
    try {
      const resp = await fetch(`/api/known-paths/?project_id=${project.id}&language=${lang}`)
      if (!resp.ok) throw new Error('load_failed')
      const data = await resp.json()
      setKnownPaths(Array.isArray(data) ? data : [])
    } catch {
      setKnownPaths([])
      setKnownPathsError(t('known_paths_load_failed'))
    } finally {
      setLoadingKnownPaths(false)
    }
  }

  const loadResourceEntities = async () => {
    setLoadingResourceEntities(true)
    setResourceEntitiesError(null)
    try {
      const resp = await fetch(`/api/projects/${project.id}/resource-entities`)
      if (!resp.ok) throw new Error('load_failed')
      const data = await resp.json()
      setResourceEntities(Array.isArray(data) ? data : [])
    } catch {
      setResourceEntities([])
      setResourceEntitiesError(t('recognized_resources_load_failed'))
    } finally {
      setLoadingResourceEntities(false)
    }
  }

  const refreshResourceState = async () => {
    await Promise.all([loadKnownPaths(), loadResourceEntities()])
    onRefresh()
  }

  const syncResourceEntities = async () => {
    setSyncingResourceEntities(true)
    try {
      await fetch(`/api/projects/${project.id}/resource-entities/sync`, { method: 'POST' })
      await refreshResourceState()
    } finally {
      setSyncingResourceEntities(false)
    }
  }

  useEffect(() => {
    void loadKnownPaths()
    void loadResourceEntities()
  }, [project.id, lang])

  useEffect(() => {
    if (!workspaceRequest) return
    if (workspaceRequest.focusSection === 'registry') {
      setRegistryFocusRequest({
        nonce: workspaceRequest.nonce,
        key: workspaceRequest.key || 'reference_fasta',
        path: workspaceRequest.path,
        description: workspaceRequest.description,
      })
    } else if (workspaceRequest.focusSection === 'recognized') {
      setRecognizedFocusRequest(workspaceRequest)
    }
    onWorkspaceRequestHandled?.()
  }, [workspaceRequest, onWorkspaceRequestHandled])

  const startEditInfo = () => {
    setInfoValues({ ...project.project_info })
    setEditingInfo(true)
  }

  const saveInfo = async () => {
    setSaving(true)
    try {
      await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_info: infoValues }),
      })
      setEditingInfo(false)
      onRefresh()
    } finally {
      setSaving(false)
    }
  }

  const saveGoal = async () => {
    await fetch(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_goal: goalValue }),
    })
    setEditingGoal(false)
    onRefresh()
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
      {/* Display name (project_title or fallback to name) */}
      {displayName !== project.name && (
        <div className="text-sm font-semibold text-text-primary">{displayName}</div>
      )}

      {/* Directory settings — read-only */}
      <div className="bg-surface-overlay rounded-lg p-3 space-y-2">
        <h3 className="text-xs font-semibold text-text-muted uppercase">{t('project_dir_section')}</h3>
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <span className="text-text-muted w-28 shrink-0 pt-0.5">{t('data_path_label')}</span>
            {project.data_path ? (
              <>
                <span className="font-mono text-text-primary break-all flex-1">{project.data_path}</span>
                <span className="text-xs px-1.5 py-0.5 bg-yellow-900/40 text-yellow-400 rounded shrink-0">{t('readonly_badge')}</span>
              </>
            ) : (
              <span className="text-text-muted">—</span>
            )}
          </div>
          <div className="flex items-start gap-2">
            <span className="text-text-muted w-28 shrink-0 pt-0.5">{t('analysis_path_label')}</span>
            {project.analysis_path ? (
              <span className="font-mono text-text-primary break-all flex-1">{project.analysis_path}</span>
            ) : (
              <span className="text-text-muted">—</span>
            )}
          </div>
        </div>
      </div>

      {/* Analysis Goal */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-xs font-semibold text-text-muted uppercase">Analysis Goal</h3>
          {!editingGoal && (
            <button
              onClick={() => { setGoalValue(project.project_goal ?? ''); setEditingGoal(true) }}
              className="text-blue-400 hover:text-blue-300"
            >
              {t('data_edit_btn')}
            </button>
          )}
        </div>
        {editingGoal ? (
          <div className="space-y-2">
            <textarea
              value={goalValue}
              onChange={e => setGoalValue(e.target.value)}
              onBlur={saveGoal}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveGoal() } if (e.key === 'Escape') setEditingGoal(false) }}
              placeholder="Describe the scientific objective of this project…"
              rows={3}
              className="w-full bg-surface-overlay text-text-primary rounded px-2 py-1.5 outline-none border border-border-subtle focus:border-blue-500 resize-none text-xs"
            />
            <div className="flex gap-2">
              <button
                onClick={saveGoal}
                className="px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-white"
              >
                {t('data_save_metadata')}
              </button>
              <button
                onClick={() => setEditingGoal(false)}
                className="px-2 py-1 bg-surface-hover hover:bg-gray-600 rounded text-text-primary"
              >
                {t('data_cancel_edit')}
              </button>
            </div>
          </div>
        ) : (
          <p className={`leading-relaxed ${project.project_goal ? 'text-text-primary' : 'text-text-muted italic'}`}>
            {project.project_goal || '—'}
          </p>
        )}
      </div>

      {/* Project info fields */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-text-muted uppercase">{t('project_info_section')}</h3>
          {!editingInfo && (
            <button onClick={startEditInfo} className="text-blue-400 hover:text-blue-300">
              {t('data_edit_btn')}
            </button>
          )}
        </div>
        {editingInfo ? (
          <div className="space-y-2">
            {PROJECT_INFO_FIELDS.map(f => (
              <div key={f.key} className="flex items-center gap-2">
                <span className="text-text-muted w-24 shrink-0">{f.label}</span>
                <input
                  value={infoValues[f.key] ?? ''}
                  onChange={e => setInfoValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="flex-1 bg-surface-overlay text-text-primary rounded px-2 py-0.5 outline-none border border-border-subtle focus:border-blue-500"
                />
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <button
                onClick={saveInfo}
                disabled={saving}
                className="px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-white disabled:opacity-50"
              >
                {saving ? '…' : t('data_save_metadata')}
              </button>
              <button
                onClick={() => setEditingInfo(false)}
                className="px-2 py-1 bg-surface-hover hover:bg-gray-600 rounded text-text-primary"
              >
                {t('data_cancel_edit')}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {PROJECT_INFO_FIELDS.map(f => (
              <div key={f.key} className="flex items-center gap-2">
                <span className="text-text-muted w-24 shrink-0">{f.label}</span>
                <span className={project.project_info?.[f.key] ? 'text-text-primary' : 'text-text-muted italic'}>
                  {project.project_info?.[f.key] || '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <RecognizedResourcesSection
        projectId={project.id}
        resourceEntities={resourceEntities}
        knownPaths={knownPaths}
        loading={loadingResourceEntities}
        syncing={syncingResourceEntities}
        error={resourceEntitiesError}
        onSync={syncResourceEntities}
        onChanged={refreshResourceState}
        onRequestRegistryFocus={(key, path, description) => {
          setRegistryFocusRequest({
            nonce: Date.now(),
            key,
            path,
            description,
          })
        }}
        focusRequest={recognizedFocusRequest}
        onFocusHandled={() => setRecognizedFocusRequest(null)}
      />

      <KnownPathRegistry
        projectId={project.id}
        entries={knownPaths}
        loading={loadingKnownPaths}
        error={knownPathsError}
        focusRequest={registryFocusRequest}
        onFocusHandled={() => setRegistryFocusRequest(null)}
        onChanged={refreshResourceState}
      />

      {/* Project custom fields */}
      <SampleFieldsManager project={project} fieldType="project_fields" onRefresh={onRefresh} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recognized resources
// ---------------------------------------------------------------------------

function RecognizedResourcesSection({
  projectId,
  resourceEntities,
  knownPaths,
  loading,
  syncing,
  error,
  onSync,
  onChanged,
  onRequestRegistryFocus,
  focusRequest,
  onFocusHandled,
}: {
  projectId: string
  resourceEntities: ResourceEntityEntry[]
  knownPaths: KnownPathEntry[]
  loading: boolean
  syncing: boolean
  error: string | null
  onSync: () => Promise<void>
  onChanged: () => Promise<void>
  onRequestRegistryFocus: (key: string, path: string, description: string) => void
  focusRequest?: ResourceWorkspaceRequest | null
  onFocusHandled?: () => void
}) {
  const { t, lang } = useLanguage()
  const [actionError, setActionError] = useState<string | null>(null)
  const [savingActionKey, setSavingActionKey] = useState<string | null>(null)
  const [highlightedTargetKey, setHighlightedTargetKey] = useState<string | null>(null)
  const sectionRef = useRef<HTMLDivElement | null>(null)
  const knownPathByKey = Object.fromEntries(knownPaths.map((entry) => [entry.key, entry]))

  useEffect(() => {
    if (!focusRequest) return
    const targetKey = focusRequest.key?.trim() || null
    if (targetKey) {
      const element = sectionRef.current?.querySelector<HTMLElement>(`[data-recognized-target="${targetKey}"]`)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setHighlightedTargetKey(targetKey)
      } else {
        sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        setHighlightedTargetKey(targetKey)
      }
    } else {
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      setHighlightedTargetKey(null)
    }
    onFocusHandled?.()
  }, [focusRequest, onFocusHandled])

  useEffect(() => {
    if (!highlightedTargetKey) return
    const timer = window.setTimeout(() => setHighlightedTargetKey(null), 2200)
    return () => window.clearTimeout(timer)
  }, [highlightedTargetKey])

  const formatActionError = (err: unknown) => {
    if (err instanceof Error && err.message && !['save_failed', 'decision_failed'].includes(err.message)) {
      return err.message
    }
    return t('settings_save_failed')
  }

  const upsertKnownPath = async (
    actionKey: string,
    key: string,
    path: string,
    description: string | null,
  ) => {
    setSavingActionKey(actionKey)
    setActionError(null)
    try {
      const resp = await fetch('/api/known-paths/upsert', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          key,
          path,
          description,
        }),
      })
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({})) as { detail?: string }
        throw new Error(data.detail || 'save_failed')
      }
      await onChanged()
    } catch (err) {
      setActionError(formatActionError(err))
    } finally {
      setSavingActionKey(null)
    }
  }

  const keepCurrentRegistration = async (
    actionKey: string,
    entityId: string,
    key: string,
    recognizedPath: string,
    registeredPath: string,
  ) => {
    setSavingActionKey(actionKey)
    setActionError(null)
    try {
      const resp = await fetch(`/api/projects/${projectId}/resource-entities/${entityId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          known_path_key: key,
          decision: 'keep_registered',
          recognized_path: recognizedPath,
          registered_path: registeredPath,
        }),
      })
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({})) as { detail?: string }
        throw new Error(data.detail || 'decision_failed')
      }
      await onChanged()
    } catch (err) {
      setActionError(formatActionError(err))
    } finally {
      setSavingActionKey(null)
    }
  }

  return (
    <div ref={sectionRef} className="bg-surface-overlay rounded-lg p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-xs font-semibold text-text-muted uppercase">{t('recognized_resources_section')}</h3>
          <p className="text-xs text-text-muted leading-relaxed">{t('recognized_resources_section_desc')}</p>
        </div>
        <button
          onClick={() => void onSync()}
          disabled={syncing}
          className="text-xs px-2 py-1 rounded bg-surface-hover hover:bg-gray-600 text-text-primary disabled:opacity-50"
        >
          {syncing ? t('recognized_resources_syncing') : t('recognized_resources_sync')}
        </button>
      </div>

      {loading && (
        <div className="text-xs text-text-muted">{t('settings_loading')}</div>
      )}
      {error && (
        <div className="text-xs text-red-400">{error}</div>
      )}
      {actionError && (
        <div className="text-xs text-red-400">{actionError}</div>
      )}
      {!loading && !error && resourceEntities.length === 0 && (
        <div className="text-xs text-text-muted italic">{t('recognized_resources_empty')}</div>
      )}

      {!loading && !error && resourceEntities.length > 0 && (
        <div className="space-y-3">
          {resourceEntities.map((entity) => {
            const target = getRecognizedResourceTarget(entity)
            const recognizedPath = target ? getRecognizedPrimaryPath(entity, target.fileRole) : null
            const knownPath = target ? knownPathByKey[target.key] : undefined
            const registeredPath = knownPath?.path ?? null
            const decision = target
              ? entity.metadata_json?.known_path_decisions?.[target.key]
              : undefined
            const decisionStale = Boolean(
              decision?.decision === 'keep_registered'
              && (
                decision.recognized_path !== recognizedPath
                || decision.registered_path !== registeredPath
              ),
            )
            const keepRegisteredActive = Boolean(
              target
                && recognizedPath
                && registeredPath
                && decision?.decision === 'keep_registered'
                && decision.recognized_path === recognizedPath
                && decision.registered_path === registeredPath,
            )

            let statusLabel = t('recognized_resources_status_info')
            let statusClass = 'bg-slate-500/15 text-slate-300 border-slate-400/30'
            if (target && recognizedPath) {
              if (!registeredPath) {
                statusLabel = t('recognized_resources_status_unregistered')
                statusClass = 'bg-amber-500/15 text-amber-300 border-amber-500/30'
              } else if (registeredPath === recognizedPath) {
                statusLabel = t('recognized_resources_status_registered')
                statusClass = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
              } else if (keepRegisteredActive) {
                statusLabel = t('recognized_resources_status_keep_registered')
                statusClass = 'bg-sky-500/15 text-sky-300 border-sky-500/30'
              } else {
                statusLabel = t('recognized_resources_status_mismatch')
                statusClass = 'bg-red-500/15 text-red-300 border-red-500/30'
              }
            }

            const confirmActionKey = `confirm:${entity.id}`
            const keepActionKey = `keep:${entity.id}`

            return (
              <div
                key={entity.id}
                data-recognized-target={target?.key ?? ''}
                className={`rounded-lg border bg-surface-overlay/70 p-3 space-y-3 transition-colors ${
                  highlightedTargetKey && target?.key === highlightedTargetKey
                    ? 'border-sky-400/70 ring-1 ring-sky-400/40'
                    : 'border-border-subtle'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-xs font-semibold text-text-primary">{entity.display_name}</h4>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${statusClass}`}>
                        {statusLabel}
                      </span>
                      <code className="text-[10px] text-text-muted">{entity.resource_role}</code>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                      <span>{t('recognized_resources_role_label')}: {entity.resource_role}</span>
                      <span>{t('recognized_resources_organism_label')}: {entity.organism || '—'}</span>
                      <span>{t('recognized_resources_build_label')}: {entity.genome_build || '—'}</span>
                    </div>
                    {target && (
                      <div className="text-xs text-text-muted">
                        {t('recognized_resources_target_label')}: <code>{target.key}</code>
                      </div>
                    )}
                    {recognizedPath && (
                      <div className="text-xs">
                        <span className="text-text-muted">{t('recognized_resources_detected_path_label')}: </span>
                        <span className="font-mono text-text-primary break-all">{recognizedPath}</span>
                      </div>
                    )}
                    {registeredPath && registeredPath !== recognizedPath && (
                      <div className="text-xs">
                        <span className="text-text-muted">{t('recognized_resources_registered_path_label')}: </span>
                        <span className="font-mono text-text-primary break-all">{registeredPath}</span>
                      </div>
                    )}
                    {decision?.decision && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                        <span>
                          {t('recognized_resources_decision_label')}: {decision.decision}
                        </span>
                        <span>
                          {t('recognized_resources_decision_updated_label')}: {formatDecisionTimestamp(decision.updated_at, lang)}
                        </span>
                        {decisionStale && (
                          <span className="text-amber-300">
                            {t('recognized_resources_decision_stale')}
                          </span>
                        )}
                      </div>
                    )}
                    {decisionStale && (
                      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                        <div>{t('recognized_resources_decision_stale')}</div>
                        <div className="mt-1 text-amber-200/90">
                          {t('recognized_resources_decision_stale_next')}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {target && recognizedPath && (
                  <div className="flex flex-wrap gap-2">
                    {!registeredPath && (
                      <button
                        onClick={() => void upsertKnownPath(confirmActionKey, target.key, recognizedPath, entity.display_name)}
                        disabled={savingActionKey !== null}
                        className="text-xs px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
                      >
                        {savingActionKey === confirmActionKey ? '…' : t('recognized_resources_confirm_detected')}
                      </button>
                    )}
                    {registeredPath && registeredPath !== recognizedPath && !keepRegisteredActive && (
                      <>
                        <button
                          onClick={() => void upsertKnownPath(confirmActionKey, target.key, recognizedPath, entity.display_name)}
                          disabled={savingActionKey !== null}
                          className="text-xs px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
                        >
                          {savingActionKey === confirmActionKey ? '…' : t('recognized_resources_use_recognized')}
                        </button>
                        <button
                          onClick={() => void keepCurrentRegistration(keepActionKey, entity.id, target.key, recognizedPath, registeredPath)}
                          disabled={savingActionKey !== null}
                          className="text-xs px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50"
                        >
                          {savingActionKey === keepActionKey ? '…' : t('recognized_resources_keep_registered')}
                        </button>
                      </>
                    )}
                    {registeredPath && registeredPath !== recognizedPath && keepRegisteredActive && (
                      <button
                        onClick={() => void upsertKnownPath(confirmActionKey, target.key, recognizedPath, entity.display_name)}
                        disabled={savingActionKey !== null}
                        className="text-xs px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
                      >
                        {savingActionKey === confirmActionKey ? '…' : t('recognized_resources_use_recognized')}
                      </button>
                    )}
                    <button
                      onClick={() => onRequestRegistryFocus(
                        target.key,
                        recognizedPath,
                        knownPath?.description ?? entity.display_name,
                      )}
                      className="text-xs px-2 py-1 rounded bg-surface-hover hover:bg-gray-600 text-text-primary"
                    >
                      {t('recognized_resources_open_registry')}
                    </button>
                  </div>
                )}

                {!target && (
                  <div className="text-xs text-text-muted">
                    {t('recognized_resources_no_registration_target')}
                  </div>
                )}

                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    {t('recognized_resources_components_heading')}
                  </div>
                  <div className="space-y-2">
                    {entity.components.map((component) => (
                      <div key={`${entity.id}:${component.file_id}:${component.file_role}`} className="rounded-md border border-border-subtle/70 bg-surface-raised/70 p-2 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="text-[10px] text-text-muted">{component.file_role}</code>
                          {component.is_primary && (
                            <span className="rounded-full px-2 py-0.5 text-[10px] bg-emerald-500/15 text-emerald-300">
                              {t('recognized_resources_primary_badge')}
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-mono text-text-primary break-all">
                          {component.path || '—'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// KnownPath registry
// ---------------------------------------------------------------------------

function KnownPathRegistry({
  projectId,
  entries,
  loading,
  error,
  focusRequest,
  onFocusHandled,
  onChanged,
}: {
  projectId: string
  entries: KnownPathEntry[]
  loading: boolean
  error: string | null
  focusRequest: RegistryFocusRequest | null
  onFocusHandled: () => void
  onChanged: () => Promise<void>
}) {
  const { t } = useLanguage()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, { path: string; description: string }>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [legacyExpanded, setLegacyExpanded] = useState(false)
  const [customExpanded, setCustomExpanded] = useState(false)

  const primaryDefs = [
    { key: 'reference_fasta', label: t('known_paths_reference_fasta'), description: t('known_paths_reference_fasta_desc'), classification: 'primary_resource' as const },
    { key: 'annotation_gtf', label: t('known_paths_annotation_gtf'), description: t('known_paths_annotation_gtf_desc'), classification: 'primary_resource' as const },
    { key: 'annotation_bed', label: t('known_paths_annotation_bed'), description: t('known_paths_annotation_bed_desc'), classification: 'primary_resource' as const },
  ]
  const legacyDefs = [
    { key: 'hisat2_index', label: t('known_paths_hisat2_index'), description: t('known_paths_hisat2_index_desc'), classification: 'legacy_index_override' as const },
    { key: 'star_genome_dir', label: t('known_paths_star_genome_dir'), description: t('known_paths_star_genome_dir_desc'), classification: 'legacy_index_override' as const },
    { key: 'bwa_index', label: t('known_paths_bwa_index'), description: t('known_paths_bwa_index_desc'), classification: 'legacy_index_override' as const },
    { key: 'bowtie2_index', label: t('known_paths_bowtie2_index'), description: t('known_paths_bowtie2_index_desc'), classification: 'legacy_index_override' as const },
  ]

  const entryByKey = Object.fromEntries(entries.map((entry) => [entry.key, entry]))
  const customEntries = entries.filter((entry) => (
    entry.policy.classification === 'custom'
    && !primaryDefs.some((def) => def.key === entry.key)
    && !legacyDefs.some((def) => def.key === entry.key)
  ))

  const formatActionError = (err: unknown) => {
    if (err instanceof Error && err.message && !['save_failed', 'delete_failed'].includes(err.message)) {
      return err.message
    }
    return t('settings_save_failed')
  }

  const startEdit = (
    key: string,
    entry?: KnownPathEntry,
    draftOverride?: { path?: string; description?: string },
  ) => {
    setActionError(null)
    setDrafts((prev) => ({
      ...prev,
      [key]: {
        path: draftOverride?.path ?? entry?.path ?? '',
        description: draftOverride?.description ?? entry?.description ?? '',
      },
    }))
    setEditingKey(key)
  }

  const cancelEdit = () => {
    setEditingKey(null)
    setActionError(null)
  }

  const updateDraft = (key: string, field: 'path' | 'description', value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [key]: {
        path: prev[key]?.path ?? '',
        description: prev[key]?.description ?? '',
        [field]: value,
      },
    }))
  }

  const saveKey = async (key: string) => {
    const draft = drafts[key]
    if (!draft?.path.trim()) return
    setSavingKey(key)
    setActionError(null)
    try {
      const resp = await fetch('/api/known-paths/upsert', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          key,
          path: draft.path.trim(),
          description: draft.description.trim() || null,
        }),
      })
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({})) as { detail?: string }
        throw new Error(data.detail || 'save_failed')
      }
      setEditingKey(null)
      await onChanged()
    } catch (err) {
      setActionError(formatActionError(err))
    } finally {
      setSavingKey(null)
    }
  }

  const removeKey = async (entry: KnownPathEntry) => {
    setSavingKey(entry.key)
    setActionError(null)
    try {
      const resp = await fetch(`/api/known-paths/${entry.id}`, { method: 'DELETE' })
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({})) as { detail?: string }
        throw new Error(data.detail || 'delete_failed')
      }
      if (editingKey === entry.key) setEditingKey(null)
      await onChanged()
    } catch (err) {
      setActionError(formatActionError(err))
    } finally {
      setSavingKey(null)
    }
  }

  useEffect(() => {
    if (!focusRequest) return
    const entry = entryByKey[focusRequest.key]
    startEdit(
      focusRequest.key,
      entry,
      {
        path: focusRequest.path ?? entry?.path ?? '',
        description: focusRequest.description ?? entry?.description ?? '',
      },
    )
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    onFocusHandled()
  }, [focusRequest, entryByKey, onFocusHandled])

  const renderRow = ({
    key,
    label,
    description,
    classification,
    entry,
  }: {
    key: string
    label: string
    description: string
    classification: KnownPathClassification
    entry?: KnownPathEntry
  }) => {
    const draft = drafts[key] ?? { path: entry?.path ?? '', description: entry?.description ?? '' }
    const isEditing = editingKey === key
    const isSaving = savingKey === key
    const badgeLabel = classification === 'primary_resource'
      ? t('known_paths_badge_primary')
      : classification === 'legacy_index_override'
        ? t('known_paths_badge_legacy')
        : t('known_paths_badge_custom')
    const badgeClass = classification === 'primary_resource'
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      : classification === 'legacy_index_override'
        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
        : 'bg-slate-500/15 text-slate-300 border-slate-400/30'

    return (
      <div key={key} className="rounded-lg border border-border-subtle bg-surface-overlay/70 p-3 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-xs font-semibold text-text-primary">{label}</h4>
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${badgeClass}`}>
                {badgeLabel}
              </span>
              <code className="text-[10px] text-text-muted">{key}</code>
            </div>
            <p className="text-xs text-text-muted leading-relaxed">{description}</p>
            {entry?.policy.note && (
              <p className="text-xs text-amber-300/90 leading-relaxed">{entry.policy.note}</p>
            )}
          </div>
          {!isEditing && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => startEdit(key, entry)}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                {entry ? t('known_paths_edit') : t('known_paths_add')}
              </button>
              {entry && (
                <button
                  onClick={() => void removeKey(entry)}
                  disabled={isSaving}
                  className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                >
                  {t('known_paths_remove')}
                </button>
              )}
            </div>
          )}
        </div>

        {isEditing ? (
          <div className="space-y-2">
            <div className="space-y-1">
              <label className="block text-xs text-text-muted">{t('known_paths_path_label')}</label>
              <input
                autoFocus
                value={draft.path}
                onChange={(e) => updateDraft(key, 'path', e.target.value)}
                placeholder={t('known_paths_path_placeholder')}
                className="w-full bg-surface-raised text-text-primary rounded px-2 py-1.5 outline-none border border-border-subtle focus:border-blue-500 font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-text-muted">{t('known_paths_description_label')}</label>
              <input
                value={draft.description}
                onChange={(e) => updateDraft(key, 'description', e.target.value)}
                placeholder={t('known_paths_description_placeholder')}
                className="w-full bg-surface-raised text-text-primary rounded px-2 py-1.5 outline-none border border-border-subtle focus:border-blue-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void saveKey(key)}
                disabled={isSaving || !draft.path.trim()}
                className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
              >
                {isSaving ? '…' : t('known_paths_save')}
              </button>
              <button
                onClick={cancelEdit}
                className="text-xs px-2 py-1 rounded bg-surface-hover hover:bg-gray-600 text-text-primary"
              >
                {t('known_paths_cancel')}
              </button>
            </div>
          </div>
        ) : entry ? (
          <div className="space-y-1">
            <div className="text-xs text-text-primary font-mono break-all">{entry.path}</div>
            {entry.description && (
              <div className="text-xs text-text-muted">{entry.description}</div>
            )}
          </div>
        ) : (
          <div className="text-xs text-text-muted italic">{t('known_paths_empty')}</div>
        )}
      </div>
    )
  }

  return (
    <div ref={rootRef} className="bg-surface-overlay rounded-lg p-3 space-y-3">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-text-muted uppercase">{t('known_paths_section')}</h3>
          {loading && <span className="text-xs text-text-muted">{t('settings_loading')}</span>}
        </div>
        <p className="text-xs text-text-muted leading-relaxed">{t('known_paths_section_desc')}</p>
      </div>

      {error && (
        <div className="text-xs text-red-400">{error}</div>
      )}
      {actionError && (
        <div className="text-xs text-red-400">{actionError}</div>
      )}

      <div className="space-y-2">
        <div className="space-y-1">
          <h4 className="text-xs font-semibold text-text-primary">{t('known_paths_primary')}</h4>
          <p className="text-xs text-text-muted">{t('known_paths_primary_desc')}</p>
        </div>
        <div className="space-y-2">
          {primaryDefs.map((def) => renderRow({ ...def, entry: entryByKey[def.key] }))}
        </div>
      </div>

      <div className="border-t border-border-subtle/60 pt-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-text-primary">{t('known_paths_legacy')}</h4>
            <p className="text-xs text-text-muted">{t('known_paths_legacy_desc')}</p>
          </div>
          <button
            onClick={() => setLegacyExpanded((prev) => !prev)}
            className="text-xs text-blue-400 hover:text-blue-300 shrink-0"
          >
            {legacyExpanded ? t('known_paths_hide_advanced') : t('known_paths_show_advanced')}
          </button>
        </div>
        {legacyExpanded && (
          <div className="space-y-2">
            {legacyDefs.map((def) => renderRow({ ...def, entry: entryByKey[def.key] }))}
          </div>
        )}
      </div>

      {(customEntries.length > 0 || customExpanded) && (
        <div className="border-t border-border-subtle/60 pt-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="space-y-1">
              <h4 className="text-xs font-semibold text-text-primary">{t('known_paths_custom')}</h4>
              <p className="text-xs text-text-muted">{t('known_paths_custom_desc')}</p>
            </div>
            <button
              onClick={() => setCustomExpanded((prev) => !prev)}
              className="text-xs text-blue-400 hover:text-blue-300 shrink-0"
            >
              {customExpanded ? t('known_paths_hide_custom') : t('known_paths_show_custom')}
            </button>
          </div>
          {customExpanded && (
            <div className="space-y-2">
              {customEntries.length > 0 ? (
                customEntries.map((entry) => renderRow({
                  key: entry.key,
                  label: entry.key,
                  description: t('known_paths_custom_desc'),
                  classification: 'custom',
                  entry,
                }))
              ) : (
                <div className="text-xs text-text-muted italic">{t('known_paths_empty')}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Custom fields manager (used in all three tabs)
// ---------------------------------------------------------------------------

function SampleFieldsManager({
  project,
  fieldType,
  onRefresh,
}: {
  project: Project
  fieldType: 'project_fields' | 'sample_fields' | 'experiment_fields'
  onRefresh: () => void
}) {
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState(false)
  const [addingField, setAddingField] = useState(false)
  const [newFieldKey, setNewFieldKey] = useState('')
  const [newFieldLabel, setNewFieldLabel] = useState('')

  const fieldLabel = {
    project_fields: t('custom_fields_project'),
    sample_fields: t('custom_fields_sample'),
    experiment_fields: t('custom_fields_experiment'),
  }[fieldType]

  const currentFields = Object.entries(project.schema_extensions?.[fieldType] || {})

  const addField = async () => {
    if (!newFieldKey.trim()) return
    const key = newFieldKey.trim().toLowerCase().replace(/\s+/g, '_')
    const label = newFieldLabel.trim() || key
    const se = { ...(project.schema_extensions || {}) }
    se[fieldType] = { ...(se[fieldType] || {}), [key]: { label, type: 'string' } }
    await fetch(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schema_extensions: se }),
    })
    setNewFieldKey('')
    setNewFieldLabel('')
    setAddingField(false)
    onRefresh()
  }

  const removeField = async (key: string) => {
    const se = { ...(project.schema_extensions || {}) }
    const fields = { ...(se[fieldType] || {}) }
    delete fields[key]
    se[fieldType] = fields
    await fetch(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schema_extensions: se }),
    })
    onRefresh()
  }

  return (
    <div className="border-t border-border-subtle/40 text-xs">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2 text-text-muted hover:text-text-primary hover:bg-surface-hover"
      >
        <span className="font-semibold uppercase">
          {fieldLabel}
          {currentFields.length > 0 && <span className="ml-1 normal-case">({currentFields.length})</span>}
        </span>
        <span>{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-1">
          {currentFields.length === 0 ? (
            <p className="text-text-muted py-1">{t('data_no_custom_fields')}</p>
          ) : (
            currentFields.map(([key, v]) => (
              <div key={key} className="flex items-center gap-2 group">
                <span className="text-text-muted w-20 shrink-0">{v.label ?? key}</span>
                <span className="text-text-muted flex-1 font-mono">{key}</span>
                <button
                  onClick={() => removeField(key)}
                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-red-400 transition-opacity"
                >✕</button>
              </div>
            ))
          )}
          {addingField ? (
            <div className="flex flex-col gap-1 pt-1">
              <div className="flex gap-1">
                <input
                  autoFocus
                  value={newFieldKey}
                  onChange={e => setNewFieldKey(e.target.value)}
                  placeholder={t('custom_fields_key_placeholder')}
                  className="flex-1 bg-surface-overlay text-text-primary rounded px-2 py-0.5 outline-none border border-border-subtle text-xs"
                />
                <input
                  value={newFieldLabel}
                  onChange={e => setNewFieldLabel(e.target.value)}
                  placeholder={t('custom_fields_label_placeholder')}
                  className="flex-1 bg-surface-overlay text-text-primary rounded px-2 py-0.5 outline-none border border-border-subtle text-xs"
                />
              </div>
              <div className="flex gap-1">
                <button
                  onClick={addField}
                  disabled={!newFieldKey.trim()}
                  className="px-2 py-0.5 bg-blue-600 hover:bg-blue-500 rounded text-white disabled:opacity-50"
                >
                  {t('data_add_confirm_btn')}
                </button>
                <button
                  onClick={() => { setAddingField(false); setNewFieldKey(''); setNewFieldLabel('') }}
                  className="px-2 py-0.5 bg-surface-hover hover:bg-gray-600 rounded"
                >
                  {t('data_cancel_edit')}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddingField(true)} className="text-blue-400 hover:text-blue-300 mt-1">
              + {t('custom_fields_add')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// FileDetail (unchanged logic, kept here)
// ---------------------------------------------------------------------------

interface FileDetailFull {
  id: string
  filename: string
  path: string
  file_type: string
  size_bytes: number
  md5: string | null
  mtime: string | null
  preview: string | null
  metadata_status: string
  enhanced_metadata: Array<{ key: string; value: string | null; source: string }>
}

function FileDetail({
  file,
  onClose,
  onMetadataSaved,
  onOpenMetadataAssistant,
}: {
  file: FileNode
  onClose: () => void
  onMetadataSaved: () => void
  onOpenMetadataAssistant: () => void
}) {
  const { t } = useLanguage()
  const [detail, setDetail] = useState<FileDetailFull | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`/api/files/${file.id}`).then((r) => r.json()).then(setDetail).catch(() => {})
  }, [file.id])

  const enterEdit = () => {
    if (!detail) return
    const vals: Record<string, string> = {}
    for (const m of detail.enhanced_metadata) vals[m.key] = m.value ?? ''
    setEditValues(vals)
    setEditMode(true)
  }

  const saveMetadata = async () => {
    setSaving(true)
    try {
      await fetch(`/api/metadata/files/${file.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: editValues }),
      })
      const updated = await fetch(`/api/files/${file.id}`).then((r) => r.json())
      setDetail(updated)
      setEditMode(false)
      onMetadataSaved()
    } finally {
      setSaving(false)
    }
  }

  const fillWithAI = () => {
    onOpenMetadataAssistant()
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="font-semibold text-white">{file.filename}</h2>
          <p className="text-xs text-text-muted mt-0.5">{file.path}</p>
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-white text-sm">✕</button>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6 text-xs">
        {[
          [t('data_field_type'), file.file_type],
          [t('data_field_metadata'), file.metadata_status],
        ].map(([k, v]) => (
          <div key={k} className="bg-surface-overlay rounded p-2">
            <div className="text-text-muted">{k}</div>
            <div className="text-white mt-0.5">{v}</div>
          </div>
        ))}
      </div>

      {detail && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-text-muted uppercase">{t('data_enhanced_metadata')}</h3>
            {!editMode ? (
              <button onClick={enterEdit} className="text-xs px-2 py-1 bg-surface-hover hover:bg-gray-600 rounded text-text-primary">
                {t('data_edit_metadata')}
              </button>
            ) : (
              <div className="flex gap-1.5">
                <button onClick={fillWithAI} className="text-xs px-2 py-1 bg-purple-700 hover:bg-purple-600 rounded text-white">
                  {t('data_fill_with_ai')}
                </button>
                <button onClick={saveMetadata} disabled={saving} className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-white disabled:opacity-50">
                  {saving ? '…' : t('data_save_metadata')}
                </button>
                <button onClick={() => setEditMode(false)} className="text-xs px-2 py-1 bg-surface-hover hover:bg-gray-600 rounded text-text-primary">
                  {t('data_cancel_edit')}
                </button>
              </div>
            )}
          </div>

          {editMode ? (
            <div className="space-y-2">
              {Object.entries(editValues).map(([key, val]) => (
                <div key={key} className="flex items-center gap-3 text-xs">
                  <span className="text-text-muted w-32 shrink-0">{key}</span>
                  <input
                    value={val}
                    onChange={(e) => setEditValues((prev) => ({ ...prev, [key]: e.target.value }))}
                    placeholder={t('data_field_value_placeholder')}
                    className="flex-1 bg-surface-raised border border-gray-700 rounded px-2 py-1 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {detail.enhanced_metadata.map((m) => (
                <div key={m.key} className="flex items-start gap-3 text-xs">
                  <span className="text-text-muted w-32 shrink-0">{m.key}</span>
                  <span className="text-white flex-1">{m.value || <em className="text-text-muted">—</em>}</span>
                  <span className="text-text-muted">{m.source}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
