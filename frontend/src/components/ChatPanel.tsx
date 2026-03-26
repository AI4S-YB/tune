import { useEffect, useRef, useState } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { WSMessage } from '../hooks/useWebSocket'
import ErrorRecoveryPanel from './ErrorRecoveryPanel'
import ResultViewer, { type ResultItem } from './ResultViewer'
import { useLanguage } from '../i18n/LanguageContext'
import type { Lang } from '../i18n/translations'

type ConfirmationPhase = 'abstract' | 'execution'

interface PlanSummary {
  has_execution_ir?: boolean
  has_expanded_dag?: boolean
  node_count?: number
  group_count?: number
}

interface PlanItem {
  step_key?: string
  step_type?: string
  display_name?: string
  name?: string
  description?: string
}

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  plan?: PlanItem[]
  requiresConfirmation?: boolean
  confirmationPhase?: ConfirmationPhase
  executionPlanSummary?: PlanSummary | null
  results?: ResultItem[]
  newFilesEvent?: { count: number; types: Record<string, number> }
}

interface TaskAttentionReminder {
  key: string
  jobId: string
  jobName: string
  incidentType: string
  ageSeconds: number
}

interface Props {
  ws: ReturnType<typeof import('../hooks/useWebSocket').useWebSocket>
  projectId: string | null
  projectName: string | null
  lang: Lang
  threadTitle?: string | null
  llmReachable?: boolean
  onJobStarted?: (jobId: string) => void
  onAnalysisResult?: () => void
  onNavigateToSettings?: () => void
  onNavigateToData?: () => void
  onOpenThreadDrawer?: () => void
  taskAttentionReminders?: TaskAttentionReminder[]
}

function formatTaskReminderReason(incidentType: string, lang: Lang) {
  const labels: Record<string, { zh: string; en: string }> = {
    authorization: { zh: '命令授权', en: 'authorization' },
    repair: { zh: '人工修复', en: 'repair' },
    plan_confirmation: { zh: '分析计划确认', en: 'plan confirmation' },
    execution_confirmation: { zh: '执行图确认', en: 'execution confirmation' },
    resource_clarification: { zh: '资源澄清', en: 'resource clarification' },
  }
  if (labels[incidentType]) {
    return labels[incidentType][lang]
  }
  switch (incidentType) {
    default:
      return incidentType
  }
}

export default function ChatPanel({ ws, projectId, lang, threadTitle, llmReachable = true, onJobStarted, onAnalysisResult, onNavigateToSettings, onNavigateToData, onOpenThreadDrawer, taskAttentionReminders = [] }: Props) {
  const { t } = useLanguage()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [skillSaveOffer, setSkillSaveOffer] = useState<{ jobId: string; jobName: string } | null>(null)
  const [errorRecovery, setErrorRecovery] = useState<{
    jobId: string
    step: string
    command: string
    stderr: string
    attemptHistory: { command: string; stderr: string }[]
  } | null>(null)
  const [memorySavePrompt, setMemorySavePrompt] = useState<{
    jobId: string
    trigger: string
    approach: string
  } | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const currentAssistant = useRef('')
  const redirectTimerRef = useRef<number | null>(null)
  const seenCommandAuthNoticesRef = useRef<Set<string>>(new Set())
  const seenTaskReminderKeysRef = useRef<Set<string>>(new Set())

  const upsertLastAssistant = (
    prev: Message[],
    updater: (message: Message) => void,
  ) => {
    const updated = [...prev]
    const last = updated[updated.length - 1]
    if (last?.role === 'assistant') {
      updater(last)
      return updated
    }
    const nextMessage: Message = {
      id: Date.now().toString(),
      role: 'assistant',
      content: '',
    }
    updater(nextMessage)
    updated.push(nextMessage)
    return updated
  }

  const clearConfirmationCards = (prev: Message[]) =>
    prev.map((message) => (
      message.requiresConfirmation
        ? {
            ...message,
            requiresConfirmation: false,
          }
        : message
    ))

  const formatPlanTitle = (item: PlanItem) =>
    item.display_name || item.name || item.step_key || item.step_type || t('chat_plan_step_fallback')

  const formatPlanMeta = (item: PlanItem) => {
    const parts = [item.step_type, item.description].filter(Boolean)
    return parts.join(' · ')
  }

  useEffect(() => {
    // subscribe is a stable useCallback ref — this effect runs once
    const unsub = ws.subscribe((msg: WSMessage) => {
      if (msg.type === 'history') {
        // Pre-populate messages from thread history
        const hist = (msg.messages as Array<{ role: string; content: string }>) || []
        setMessages(hist.map((m, i) => ({
          id: `hist-${i}`,
          role: m.role as Message['role'],
          content: m.content,
        })))
      } else if (msg.type === 'start') {
        currentAssistant.current = ''
        setMessages((prev) => [
          ...prev,
          { id: Date.now().toString(), role: 'assistant', content: '' },
        ])
        setStreaming(true)
      } else if (msg.type === 'token') {
        currentAssistant.current += (msg.content as string) || ''
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role === 'assistant') last.content = currentAssistant.current
          return updated
        })
      } else if (msg.type === 'end') {
        setStreaming(false)
      } else if (msg.type === 'analysis_result') {
        const item: ResultItem = {
          kind: msg.kind as ResultItem['kind'],
          path: msg.path as string,
          filename: msg.filename as string,
          step: msg.step as string,
        }
        onAnalysisResult?.()
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role === 'assistant') {
            last.results = [...(last.results ?? []), item]
          } else {
            updated.push({ id: Date.now().toString(), role: 'assistant', content: '', results: [item] })
          }
          return [...updated]
        })
      } else if (msg.type === 'command_auth') {
        const authKey = String((msg.auth_request_id as string) || (msg.job_id as string) || (msg.command as string) || Date.now())
        if (!seenCommandAuthNoticesRef.current.has(authKey)) {
          seenCommandAuthNoticesRef.current.add(authKey)
          setMessages((prev) => [
            ...prev,
            {
              id: `command-auth-${authKey}`,
              role: 'system',
              content: lang === 'zh'
                ? '任务需要命令授权。请在右侧任务面板中处理，主聊天窗口可继续对话。'
                : 'A task is waiting for command authorization. Use the task tray on the right to respond; chat can continue here.',
            },
          ])
        }
      } else if (msg.type === 'pending_state_cleared') {
        const fields = Array.isArray(msg.fields) ? msg.fields.map((item) => String(item)) : []
        if (fields.includes('error_recovery')) {
          setErrorRecovery(null)
        }
        if (fields.includes('analysis_plan')) {
          setMessages((prev) => clearConfirmationCards(prev))
        }
      } else if (msg.type === 'error_recovery_human') {
        setErrorRecovery({
          jobId: msg.job_id as string,
          step: msg.step as string,
          command: msg.command as string,
          stderr: msg.stderr as string,
          attemptHistory: (msg.attempt_history as { command: string; stderr: string }[]) || [],
        })
      } else if (msg.type === 'suggest_memory_save') {
        setMemorySavePrompt({
          jobId: msg.job_id as string,
          trigger: msg.trigger_suggestion as string,
          approach: msg.approach_suggestion as string,
        })
      } else if (msg.type === 'offer_skill_save') {
        setSkillSaveOffer({ jobId: msg.job_id as string, jobName: msg.job_name as string })
      } else if (msg.type === 'job_started') {
        setMessages((prev) => clearConfirmationCards(prev))
        onJobStarted?.(msg.job_id as string)
      } else if (msg.type === 'analysis_complete') {
        setMessages((prev) => clearConfirmationCards(prev))
        const status = msg.status as string
        const steps = msg.steps_total as number
        const outDir = msg.output_dir as string | null
        const err = msg.error as string | null
        const jobName = msg.job_name as string
        let summary: string
        if (status === 'completed') {
          summary = `✅ **${jobName}** complete — ${steps} step${steps !== 1 ? 's' : ''} ran.${outDir ? `\n📁 Outputs: \`${outDir}\`` : ''}`
        } else if (status === 'failed') {
          summary = `❌ **${jobName}** failed after ${steps} step${steps !== 1 ? 's' : ''}.${err ? `\n${err}` : ''}`
        } else {
          summary = `⚠️ **${jobName}** ended with status: ${status}.`
        }
        setMessages((prev) => [
          ...prev,
          { id: Date.now().toString(), role: 'assistant', content: summary },
        ])
      } else if (msg.type === 'plan') {
        setMessages((prev) => upsertLastAssistant(clearConfirmationCards(prev), (last) => {
          last.plan = ((msg.plan as PlanItem[]) || []).filter((item): item is PlanItem => Boolean(item))
          last.requiresConfirmation = true
          last.confirmationPhase = last.confirmationPhase || 'abstract'
        }))
      } else if (msg.type === 'execution_plan') {
        setMessages((prev) => upsertLastAssistant(clearConfirmationCards(prev), (last) => {
          last.requiresConfirmation = true
          last.confirmationPhase = 'execution'
          last.executionPlanSummary = (
            (msg.execution_plan_summary as PlanSummary | undefined)
            ?? ((msg.execution_plan as { summary?: PlanSummary } | undefined)?.summary)
            ?? null
          )
        }))
      } else if (msg.type === 'new_files_discovered') {
        // New file notification bubble (task 9.1 + 9.2)
        const count = msg.count as number
        const types = msg.types as Record<string, number>
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            role: 'system',
            content: '',
            newFilesEvent: { count, types },
          },
        ])
      } else if (msg.type === 'ui_redirect') {
        if (redirectTimerRef.current !== null) {
          window.clearTimeout(redirectTimerRef.current)
          redirectTimerRef.current = null
        }

        if (msg.target === 'data') {
          const surface = (msg.surface as string | undefined) ?? ''
          const delayMs = surface === 'metadata' ? 3200 : 1500

          if (surface === 'metadata') {
            setMessages((prev) => [
              ...prev,
              {
                id: Date.now().toString(),
                role: 'system',
                content: lang === 'zh'
                  ? '请到数据页面使用「元数据助手」或相关元数据面板完成填写与管理。即将自动跳转。'
                  : "Please use the Data page's Metadata Assistant or metadata panels to manage metadata. Redirecting shortly.",
              },
            ])
          }

          redirectTimerRef.current = window.setTimeout(() => {
            onNavigateToData?.()
            redirectTimerRef.current = null
          }, delayMs)
        }
      } else if (msg.type === 'binding_required' || msg.type === 'resource_clarification_required') {
        const issues = (msg.issues as string[]) || []
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            role: 'assistant',
            content: `⚠️ **${t('chat_binding_required_title')}**\n${issues.map((s) => `- ${s}`).join('\n')}\n\n${t('chat_binding_required_resume')}`,
          },
        ])
      }
    })
    return () => { unsub() }
  }, [ws.subscribe])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const activeKeys = new Set(taskAttentionReminders.map((item) => item.key))
    for (const key of Array.from(seenTaskReminderKeysRef.current)) {
      if (!activeKeys.has(key)) {
        seenTaskReminderKeysRef.current.delete(key)
      }
    }

    if (taskAttentionReminders.length === 0) return

    const nextMessages: Message[] = []
    for (const reminder of taskAttentionReminders) {
      if (seenTaskReminderKeysRef.current.has(reminder.key)) continue
      seenTaskReminderKeysRef.current.add(reminder.key)
      const waitMinutes = Math.max(1, Math.floor(reminder.ageSeconds / 60))
      nextMessages.push({
        id: `task-reminder-${reminder.key}`,
        role: 'system',
        content: lang === 'zh'
          ? `任务“${reminder.jobName}”仍在等待${formatTaskReminderReason(reminder.incidentType, lang)}，已超过 ${waitMinutes} 分钟。请打开右侧任务面板处理。`
          : `Task "${reminder.jobName}" is still waiting on ${formatTaskReminderReason(reminder.incidentType, lang)} after ${waitMinutes} minute(s). Open the task tray on the right to continue.`,
      })
    }

    if (nextMessages.length > 0) {
      setMessages((prev) => [...prev, ...nextMessages])
    }
  }, [lang, taskAttentionReminders])

  useEffect(() => () => {
    if (redirectTimerRef.current !== null) {
      window.clearTimeout(redirectTimerRef.current)
    }
  }, [])

  const send = () => {
    if (!input.trim() || streaming) return
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input }
    setMessages((prev) => [...prev, userMsg])
    ws.send({ type: 'chat', content: input, project_id: projectId, language: lang })
    setInput('')
  }

  return (
    <div className="flex flex-col h-full bg-surface-base">
      {/* Thread title strip (only when a thread is active) */}
      {threadTitle && (
        <div className="px-4 py-1.5 border-b border-border-subtle flex items-center gap-2 bg-surface-raised">
          <span className="text-xs text-text-muted truncate flex-1">{threadTitle}</span>
          {onOpenThreadDrawer && (
            <button
              onClick={onOpenThreadDrawer}
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors shrink-0"
              title={t('switch_thread_title')}
            >
              <ChevronsUpDown size={12} />
            </button>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
        {messages.map((m) => {
          if (m.role === 'system' && m.newFilesEvent) {
            const { count, types } = m.newFilesEvent
            const typeSummary = Object.entries(types).map(([k, v]) => `${v} ${k}`).join(', ')
            return (
              <div key={m.id} className="flex justify-center">
                <div className="bg-indigo-500/8 border border-indigo-500/20 rounded-xl px-4 py-3 text-xs text-indigo-300 max-w-[90%]">
                  <p>
                    {t('chat_new_files')
                      .replace('{count}', String(count))
                      .replace('{types}', typeSummary)}
                  </p>
                  {onNavigateToData && (
                    <button
                      onClick={onNavigateToData}
                      className="mt-2 text-xs px-2 py-1 bg-accent hover:bg-accent-hover rounded-md transition-colors"
                    >
                      {t('chat_open_data')}
                    </button>
                  )}
                </div>
              </div>
            )
          }

          return (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                m.role === 'user'
                  ? 'bg-accent/15 text-text-primary'
                  : 'bg-surface-raised text-text-primary'
              }`}>
                {m.role === 'assistant' ? (
                  <div className="prose-chat">
                    {!m.content && streaming ? (
                      <span className="flex items-center gap-1.5 text-text-muted text-xs">
                        <span className="inline-flex gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: '300ms' }} />
                        </span>
                        {t('chat_thinking')}
                      </span>
                    ) : (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeHighlight]}
                      >
                        {m.content}
                      </ReactMarkdown>
                    )}
                  </div>
                ) : (
                  <span className="whitespace-pre-wrap">{m.content}</span>
                )}
                {m.results && m.results.map((r, i) => <ResultViewer key={i} {...r} />)}
                {m.requiresConfirmation && (
                  <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/8 px-3 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-200">
                        {m.confirmationPhase === 'execution'
                          ? t('chat_plan_phase_execution')
                          : t('chat_plan_phase_abstract')}
                      </span>
                      {m.confirmationPhase === 'execution' && m.executionPlanSummary && (
                        <span className="text-[11px] text-amber-100/90">
                          {t('chat_execution_summary')
                            .replace('{groups}', String(m.executionPlanSummary.group_count ?? 0))
                            .replace('{nodes}', String(m.executionPlanSummary.node_count ?? 0))}
                        </span>
                      )}
                    </div>
                    {m.plan && m.plan.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {m.plan.map((item, index) => {
                          const meta = formatPlanMeta(item)
                          return (
                            <div
                              key={`${m.id}-plan-${item.step_key ?? item.step_type ?? index}`}
                              className="rounded-lg border border-amber-500/10 bg-surface-base/70 px-3 py-2"
                            >
                              <div className="text-xs font-medium text-text-primary">
                                {index + 1}. {formatPlanTitle(item)}
                              </div>
                              {meta && (
                                <div className="mt-1 text-[11px] text-text-muted break-words">
                                  {meta}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
                {m.requiresConfirmation && (
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => ws.send({ type: 'confirm_plan', confirm: true })}
                      className="px-3 py-1 bg-emerald-700/60 hover:bg-emerald-600/60 rounded-lg text-xs transition-colors"
                    >
                      {t('chat_proceed')}
                    </button>
                    <button
                      onClick={() => ws.send({ type: 'confirm_plan', confirm: false })}
                      className="px-3 py-1 bg-surface-overlay hover:bg-surface-hover rounded-lg text-xs transition-colors"
                    >
                      {t('chat_cancel')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Human error recovery panel */}
      {errorRecovery && (
        <ErrorRecoveryPanel
          jobId={errorRecovery.jobId}
          step={errorRecovery.step}
          command={errorRecovery.command}
          stderr={errorRecovery.stderr}
          attemptHistory={errorRecovery.attemptHistory}
          onSendRetry={(_jobId, text) => {
            ws.send({ type: 'chat', content: text, project_id: projectId, language: lang })
            setErrorRecovery(null)
          }}
          onStop={(jobId) => {
            ws.send({ type: 'terminate_error_recovery', job_id: jobId })
            setErrorRecovery(null)
          }}
        />
      )}

      {/* Memory save prompt (after human-assisted recovery) */}
      {memorySavePrompt && (
        <div className="mx-4 mb-3 border border-purple-500/30 rounded-xl p-4 bg-purple-500/8">
          <p className="text-purple-300 text-xs font-semibold mb-2">{t('memory_save_heading')}</p>
          <p className="text-text-muted text-xs mb-0.5">{t('memory_save_trigger_label')}</p>
          <p className="text-text-secondary text-xs mb-2 font-mono">{memorySavePrompt.trigger}</p>
          <p className="text-text-muted text-xs mb-0.5">{t('memory_save_approach_label')}</p>
          <p className="text-text-secondary text-xs mb-3 font-mono">{memorySavePrompt.approach}</p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                ws.send({
                  type: 'save_memory',
                  trigger: memorySavePrompt.trigger,
                  approach: memorySavePrompt.approach,
                })
                setMemorySavePrompt(null)
              }}
              className="px-3 py-1.5 bg-purple-600/60 hover:bg-purple-500/60 rounded-lg text-xs font-medium transition-colors"
            >
              {t('memory_save_confirm')}
            </button>
            <button
              onClick={() => setMemorySavePrompt(null)}
              className="px-3 py-1.5 bg-surface-overlay hover:bg-surface-hover rounded-lg text-xs font-medium transition-colors"
            >
              {t('chat_dismiss')}
            </button>
          </div>
        </div>
      )}

      {/* Skill save offer */}
      {skillSaveOffer && (
        <div className="mx-4 mb-3 border border-emerald-500/30 rounded-xl p-4 bg-emerald-500/8">
          <p className="text-emerald-300 text-sm mb-2">
            ✓ {t('chat_skill_save_offer').replace('{name}', skillSaveOffer.jobName)}
          </p>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                const name = window.prompt(t('chat_skill_name_prompt'), skillSaveOffer.jobName) ?? skillSaveOffer.jobName
                await fetch(`/api/skills/from-job/${skillSaveOffer.jobId}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name }),
                })
                setSkillSaveOffer(null)
                setMessages((prev) => [
                  ...prev,
                  { id: Date.now().toString(), role: 'assistant', content: t('chat_skill_saved').replace('{name}', name) },
                ])
              }}
              className="px-3 py-1.5 bg-emerald-700/60 hover:bg-emerald-600/60 rounded-lg text-xs font-medium transition-colors"
            >
              {t('chat_save_as_skill')}
            </button>
            <button
              onClick={() => setSkillSaveOffer(null)}
              className="px-3 py-1.5 bg-surface-overlay hover:bg-surface-hover rounded-lg text-xs font-medium transition-colors"
            >
              {t('chat_dismiss')}
            </button>
          </div>
        </div>
      )}

      {/* LLM not configured callout */}
      {!llmReachable && (
        <div className="mx-4 mb-3 bg-red-500/8 border border-red-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
          <div className="flex-1">
            <p className="text-sm font-medium text-red-300">{t('chat_llm_not_configured')}</p>
            <p className="text-xs text-text-muted mt-0.5">{t('chat_llm_not_configured_desc')}</p>
          </div>
          {onNavigateToSettings && (
            <button
              onClick={onNavigateToSettings}
              className="text-xs text-accent hover:text-accent-hover transition-colors shrink-0"
            >
              {t('chat_go_settings')}
            </button>
          )}
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-border-subtle px-4 py-3 flex gap-2">
        <input
          className="flex-1 bg-surface-overlay rounded-xl px-4 py-2.5 text-sm text-text-primary outline-none focus:ring-1 focus:ring-accent placeholder-text-muted"
          placeholder={!llmReachable ? t('chat_placeholder_llm_disabled') : streaming ? t('chat_placeholder_idle') : t('chat_placeholder_idle')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
          disabled={streaming || !llmReachable}
        />
        <button
          onClick={send}
          disabled={streaming || !input.trim() || !llmReachable}
          className="px-4 py-2 bg-accent hover:bg-accent-hover rounded-xl text-sm font-medium disabled:opacity-40 transition-colors text-white"
        >
          {t('chat_send')}
        </button>
      </div>
    </div>
  )
}
