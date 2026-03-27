import type { Lang } from '../i18n/translations'

export type TaskAttentionSignal = 'idle' | 'running' | 'warning' | 'attention'
export type TaskAttentionReason = 'authorization' | 'repair' | 'confirmation' | 'clarification' | 'warning'

export interface TaskAttentionReminder {
  key: string
  jobId: string
  jobName: string
  incidentType: string
  reason: TaskAttentionReason
  ageSeconds: number
  summary: string
  severity: 'info' | 'warning' | 'critical'
  owner: 'user' | 'system'
}

export function formatTaskAttentionReason(reason: TaskAttentionReason, lang: Lang): string {
  const labels: Record<TaskAttentionReason, { zh: string; en: string }> = {
    authorization: { zh: '命令授权', en: 'authorization' },
    repair: { zh: '人工修复', en: 'repair' },
    confirmation: { zh: '确认', en: 'confirmation' },
    clarification: { zh: '资源澄清', en: 'resource clarification' },
    warning: { zh: '检查', en: 'review' },
  }
  return labels[reason][lang]
}
