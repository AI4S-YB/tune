import { useEffect, useState } from 'react'
import { useLanguage } from '../i18n/LanguageContext'
import type { WSMessage } from '../hooks/useWebSocket'

interface Skill {
  id: string
  name: string
  description?: string
  skill_type: string
  current_version: string
  versions: string[]
  created_at: string
}

interface SkillVersionSummary {
  version: string
  input_params?: unknown[]
  steps: Array<{ name?: string; description?: string; tool?: string }>
  tags?: string[]
  has_pixi: boolean
  created_at: string
}

interface SkillDetailData {
  id: string
  name: string
  description?: string
  skill_type: string
  current_version: string
  created_at: string
  versions: SkillVersionSummary[]
}

interface Props {
  ws?: { send: (msg: WSMessage) => void }
}

export default function SkillLibrary({ ws }: Props) {
  const { t } = useLanguage()
  const [skills, setSkills] = useState<Skill[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const loadSkills = () => {
    fetch('/api/skills/').then((r) => r.json()).then((data) => setSkills(data || [])).catch(() => {})
  }

  useEffect(() => { loadSkills() }, [])

  const handleSelect = (skillId: string) => {
    const newSelected = skillId === selected ? null : skillId
    setSelected(newSelected)
    ws?.send({ type: 'set_current_skill', skill_id: newSelected })
  }

  const handleDeleteConfirm = async () => {
    if (!confirmDeleteId) return
    await fetch(`/api/skills/${confirmDeleteId}`, { method: 'DELETE' })
    if (selected === confirmDeleteId) {
      setSelected(null)
      ws?.send({ type: 'set_current_skill', skill_id: null })
    }
    setConfirmDeleteId(null)
    loadSkills()
  }

  const confirmSkill = skills.find((s) => s.id === confirmDeleteId)

  return (
    <div className="flex h-full">
      <div className="w-72 border-r border-border-subtle overflow-y-auto">
        <div className="px-4 py-3 border-b border-border-subtle text-xs font-semibold text-text-muted uppercase">
          {t('skills_heading')}
        </div>

        {confirmDeleteId && confirmSkill && (
          <div className="px-4 py-3 border-b border-border-subtle bg-surface-raised text-xs">
            <div className="text-text-primary mb-1">{t('skills_delete_confirm').replace('{name}', confirmSkill.name)}</div>
            <div className="text-text-muted mb-3">{t('skills_delete_warning')}</div>
            <div className="flex gap-2">
              <button
                onClick={handleDeleteConfirm}
                className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs"
              >
                {t('skills_delete_btn')}
              </button>
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-3 py-1 bg-surface-hover hover:bg-surface-overlay text-text-primary rounded text-xs"
              >
                {t('skills_cancel_btn')}
              </button>
            </div>
          </div>
        )}

        {skills.map((s) => (
          <div
            key={s.id}
            className={`flex items-center border-b border-border-subtle hover:bg-surface-hover ${
              selected === s.id ? 'bg-surface-overlay' : ''
            }`}
          >
            <button
              onClick={() => handleSelect(s.id)}
              className="flex-1 text-left px-4 py-3 text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-text-primary">{s.name}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded border font-semibold uppercase bg-gray-700/30 text-gray-300 border-gray-600/30">
                  {s.skill_type}
                </span>
              </div>
              <div className="text-text-muted mt-0.5">v{s.current_version}</div>
            </button>
            <button
              onClick={() => setConfirmDeleteId(s.id)}
              className="px-3 py-3 text-text-muted hover:text-red-400 text-xs shrink-0"
              title={t('skills_delete_skill_title')}
            >
              ✕
            </button>
          </div>
        ))}
        {skills.length === 0 && (
          <div className="px-4 py-8 text-xs text-text-muted text-center">
            {t('skills_empty')}
          </div>
        )}
      </div>

      {selected && <SkillDetail id={selected} />}
    </div>
  )
}

function SkillDetail({ id }: { id: string }) {
  const { t } = useLanguage()
  const [detail, setDetail] = useState<SkillDetailData | null>(null)

  useEffect(() => {
    fetch(`/api/skills/${id}`).then((r) => r.json()).then(setDetail).catch(() => {})
  }, [id])

  if (!detail) return null

  const latest = detail.versions[detail.versions.length - 1]

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h2 className="font-semibold text-text-primary text-lg mb-1">{detail.name}</h2>
      <p className="text-text-muted text-xs mb-4">{detail.description || t('skills_no_description')}</p>

      <div className="flex gap-2 mb-6">
        {detail.versions.map((v) => (
          <span key={v.version} className="px-2 py-0.5 bg-surface-overlay rounded text-xs text-text-primary">
            v{v.version}
          </span>
        ))}
      </div>

      {latest && Array.isArray(latest.steps) && latest.steps.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-text-muted uppercase mb-2">{t('skills_steps_heading')}</h3>
          <div className="space-y-2">
            {latest.steps.map((step, i) => (
              <div key={i} className="bg-surface-raised rounded p-3 text-xs">
                <div className="font-medium text-text-primary">{i + 1}. {step.name}</div>
                <div className="text-text-muted mt-1">{step.description}</div>
                {step.tool && <div className="text-blue-400 mt-1">{t('skills_tool_label')} {step.tool}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
