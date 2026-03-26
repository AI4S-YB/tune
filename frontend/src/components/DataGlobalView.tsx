import { useEffect, useState } from 'react'
import { useLanguage } from '../i18n/LanguageContext'

interface Project {
  id: string
  name: string
  project_dir: string
  health?: {
    sample_count: number
    experiment_count: number
  }
}

interface GlobalStats {
  project_count: number
  sample_count: number
  experiment_count: number
  fastq_count: number
}

interface Props {
  projects: Project[]
  onProjectSelect: (id: string, name: string) => void
}

export default function DataGlobalView({ projects, onProjectSelect }: Props) {
  const { t } = useLanguage()
  const [stats, setStats] = useState<GlobalStats | null>(null)

  useEffect(() => {
    fetch('/api/projects/stats')
      .then(r => r.json())
      .catch(() => null)
      .then((data: GlobalStats | null) => {
        if (data) {
          setStats(data)
        } else {
          // Fallback: derive from projects list if stats endpoint unavailable
          let sampleCount = 0
          let experimentCount = 0
          projects.forEach(p => {
            sampleCount += p.health?.sample_count ?? 0
            experimentCount += p.health?.experiment_count ?? 0
          })
          setStats({
            project_count: projects.length,
            sample_count: sampleCount,
            experiment_count: experimentCount,
            fastq_count: 0,
          })
        }
      })
  }, [projects])

  if (projects.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-12">
        <div className="text-4xl">🗂</div>
        <p className="text-text-muted text-sm">{t('data_global_no_projects')}</p>
        <p className="text-text-muted text-xs">{t('data_global_create_hint')}</p>
      </div>
    )
  }

  const statCards = stats
    ? [
        { label: t('data_global_projects'), value: stats.project_count, icon: '📁' },
        { label: t('data_global_samples'), value: stats.sample_count, icon: '🧬' },
        { label: t('data_global_experiments'), value: stats.experiment_count, icon: '🔬' },
        { label: t('data_global_fastq'), value: stats.fastq_count, icon: '🗃' },
      ]
    : []

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-4 gap-3">
          {statCards.map(card => (
            <div
              key={card.label}
              className="bg-surface-raised rounded-lg px-4 py-3 flex items-center gap-3"
            >
              <span className="text-2xl">{card.icon}</span>
              <div>
                <div className="text-xl font-bold text-text-primary">{card.value}</div>
                <div className="text-xs text-text-muted">{card.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent projects */}
      <div>
        <h2 className="text-xs font-semibold text-text-muted uppercase mb-2">
          {t('data_global_recent_projects')}
        </h2>
        <div className="space-y-1">
          {projects.slice(0, 8).map(p => (
            <button
              key={p.id}
              onClick={() => onProjectSelect(p.id, p.name)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-hover text-left transition-colors"
            >
              <span className="text-lg shrink-0">📁</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-text-primary truncate">{p.name}</div>
                <div className="text-xs text-text-muted font-mono">{p.project_dir}</div>
              </div>
              <div className="text-xs text-text-muted shrink-0 text-right">
                {p.health?.sample_count ?? 0} {t('data_global_samples_abbr')}
                {' · '}
                {p.health?.experiment_count ?? 0} {t('data_global_exp_abbr')}
              </div>
              <span className="text-text-muted text-xs shrink-0">→</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
