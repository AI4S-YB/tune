import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { MessageSquare, Database, Activity, FileText, Layers, FlaskConical, Zap } from 'lucide-react'
import { useProjectTaskFeed, type ProjectTaskJob } from '../hooks/useProjectTaskFeed'
import type { SystemHealth } from '../hooks/useSystemHealth'
import { useLanguage } from '../i18n/LanguageContext'
import type { TranslationKey } from '../i18n/translations'

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

interface ProjectDetail {
  id: string
  name: string
  file_count: number
  health: ProjectHealth | undefined
}

type Job = ProjectTaskJob

interface Props {
  selectedProject: string | null
  onNavigate: (view: string) => void
  health: SystemHealth
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useLanguage()
  const map: Record<string, string> = {
    running:     'bg-indigo-500/15 text-indigo-400',
    completed:   'bg-emerald-500/12 text-emerald-400',
    failed:      'bg-red-500/12 text-red-400',
    cancelled:   'bg-amber-500/12 text-amber-400',
    interrupted: 'bg-amber-500/12 text-amber-400',
    queued:      'bg-surface-overlay text-text-muted',
  }
  const labelMap: Record<string, string> = {
    running:     t('status_running'),
    completed:   t('status_completed'),
    failed:      t('status_failed'),
    cancelled:   t('status_cancelled'),
    interrupted: t('status_interrupted'),
    queued:      t('status_queued'),
  }
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${map[status] ?? 'bg-surface-overlay text-text-muted'}`}>
      {labelMap[status] ?? status}
    </span>
  )
}

function timeAgo(dateStr: string, t: (k: TranslationKey) => string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('time_just_now')
  if (mins < 60) return `${mins}${t('time_ago_m')}`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}${t('time_ago_h')}`
  return `${Math.floor(hrs / 24)}${t('time_ago_d')}`
}

export default function DashboardHome({ selectedProject, onNavigate, health }: Props) {
  const { t } = useLanguage()
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const { jobs } = useProjectTaskFeed()

  useEffect(() => {
    if (!selectedProject) { setProject(null); return }
    fetch(`/api/projects/${selectedProject}`)
      .then((r) => r.json())
      .then(setProject)
      .catch(() => {})
  }, [selectedProject])

  const ph = project?.health
  const recentJobs = jobs.slice(0, 5) as Job[]

  const quickActions = [
    { label: t('dashboard_new_analysis'),   desc: t('dashboard_new_analysis_desc'),   icon: MessageSquare, view: 'chat'  },
    { label: t('dashboard_browse_data_action'), desc: t('dashboard_browse_data_desc'), icon: Database,      view: 'data'  },
    { label: t('dashboard_view_tasks'),     desc: t('dashboard_view_tasks_desc'),     icon: Zap,           view: 'tasks' },
  ]

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Project health cards */}
        <section>
          <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">{t('dashboard_overview')}</h2>
          {!selectedProject ? (
            <div className="bg-surface-raised rounded-xl p-6 text-center">
              <Database size={24} className="mx-auto mb-2 text-text-muted" />
              <p className="text-sm text-text-muted">{t('dashboard_no_project')}</p>
              <button
                onClick={() => onNavigate('data')}
                className="mt-3 text-xs text-accent hover:text-accent-hover transition-colors"
              >
                {t('dashboard_browse_data')}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {/* Files card */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0 }}
                className="bg-surface-raised rounded-xl p-5"
              >
                <div className="flex items-center gap-2 mb-3">
                  <FileText size={14} className="text-text-muted" />
                  <span className="text-xs font-medium text-text-secondary">{t('dashboard_dataset')}</span>
                </div>
                <p className="text-2xl font-semibold text-text-primary">{project?.file_count ?? '—'}</p>
                <p className="text-xs text-text-muted mt-1">
                  {ph
                    ? `${ph.files_total_fastq} ${t('dashboard_fastq')} · ${ph.files_unlinked} ${t('dashboard_unlinked')}`
                    : t('dashboard_files_total')}
                </p>
              </motion.div>

              {/* Samples card */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="bg-surface-raised rounded-xl p-5"
              >
                <div className="flex items-center gap-2 mb-3">
                  <Layers size={14} className="text-text-muted" />
                  <span className="text-xs font-medium text-text-secondary">{t('dashboard_samples')}</span>
                </div>
                <p className="text-2xl font-semibold text-text-primary">{ph?.sample_count ?? '—'}</p>
                {ph && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-xs text-emerald-400">{ph.sample_complete} {t('dashboard_complete')}</span>
                    {ph.sample_partial > 0 && <span className="text-xs text-amber-400">· {ph.sample_partial} {t('dashboard_partial')}</span>}
                    {ph.sample_missing > 0 && <span className="text-xs text-red-400">· {ph.sample_missing} {t('dashboard_missing')}</span>}
                  </div>
                )}
              </motion.div>

              {/* Experiments card */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="bg-surface-raised rounded-xl p-5"
              >
                <div className="flex items-center gap-2 mb-3">
                  <FlaskConical size={14} className="text-text-muted" />
                  <span className="text-xs font-medium text-text-secondary">{t('dashboard_experiments')}</span>
                </div>
                <p className="text-2xl font-semibold text-text-primary">{ph?.experiment_count ?? '—'}</p>
                {ph && (
                  <p className="text-xs text-text-muted mt-1">
                    {ph.files_linked}/{ph.files_total_fastq} {t('dashboard_files_linked')}
                  </p>
                )}
              </motion.div>
            </div>
          )}
        </section>

        {/* Recent analyses */}
        <section>
          <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">{t('dashboard_recent')}</h2>
          <div className="bg-surface-raised rounded-xl overflow-hidden">
            {recentJobs.length === 0 ? (
              <div className="p-6 text-center">
                <Activity size={24} className="mx-auto mb-2 text-text-muted" />
                <p className="text-sm text-text-muted">{t('dashboard_no_jobs')}</p>
                <p className="text-xs text-text-muted mt-1">{t('dashboard_start_pipeline')}</p>
                <button
                  onClick={() => onNavigate('chat')}
                  className="mt-3 text-xs text-accent hover:text-accent-hover transition-colors"
                >
                  {t('dashboard_open_chat')}
                </button>
              </div>
            ) : (
              <div className="divide-y divide-border-subtle">
                {recentJobs.map((job) => (
                  <div key={job.id} className="flex items-center gap-4 px-5 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">{job.name ?? job.id}</p>
                      <p className="text-xs text-text-muted mt-0.5">{job.created_at ? timeAgo(job.created_at, t) : t('time_just_now')}</p>
                    </div>
                    <StatusBadge status={job.status} />
                    <button
                      onClick={() => onNavigate('tasks')}
                      className="text-xs text-accent hover:text-accent-hover transition-colors shrink-0"
                    >
                      {job.status === 'running' ? t('dashboard_view_progress') : t('dashboard_view_logs')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Quick actions */}
        <section>
          <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">{t('dashboard_quick_actions')}</h2>
          <div className="grid grid-cols-3 gap-3">
            {quickActions.map(({ label, desc, icon: Icon, view }) => (
              <button
                key={view}
                onClick={() => onNavigate(view)}
                className="bg-surface-raised hover:bg-surface-overlay rounded-xl p-5 text-left transition-colors group"
              >
                <Icon size={18} className="text-accent mb-3" />
                <p className="text-sm font-medium text-text-primary">{label}</p>
                <p className="text-xs text-text-muted mt-0.5">{desc}</p>
              </button>
            ))}
          </div>
        </section>

        {/* LLM not configured callout */}
        {!health.llm_reachable && (
          <div className="bg-red-500/8 border border-red-500/20 rounded-xl px-5 py-4 flex items-center gap-4">
            <div className="flex-1">
              <p className="text-sm font-medium text-red-300">{t('dashboard_llm_not_configured')}</p>
              <p className="text-xs text-text-muted mt-0.5">{health.llm_error ?? t('dashboard_llm_error_default')}</p>
            </div>
            <button
              onClick={() => onNavigate('settings')}
              className="text-xs text-accent hover:text-accent-hover transition-colors shrink-0"
            >
              {t('dashboard_go_settings')}
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
