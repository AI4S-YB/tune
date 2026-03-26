import { useState } from 'react'
import { useLanguage } from '../i18n/LanguageContext'

interface AttemptEntry {
  command: string
  stderr: string
}

interface Props {
  jobId: string
  step: string
  command: string
  stderr: string
  attemptHistory: AttemptEntry[]
  onSendRetry: (jobId: string, text: string) => void
  onStop: (jobId: string) => void
}

export default function ErrorRecoveryPanel({
  jobId,
  step,
  command,
  stderr,
  attemptHistory,
  onSendRetry,
  onStop,
}: Props) {
  const { t } = useLanguage()
  const [diagnosis, setDiagnosis] = useState('')

  const handleSend = () => {
    if (!diagnosis.trim()) return
    onSendRetry(jobId, diagnosis.trim())
    setDiagnosis('')
  }

  return (
    <div className="mx-4 mb-3 border border-red-700 rounded-lg p-4 bg-red-950/30">
      <p className="text-red-300 text-xs font-semibold mb-2">
        🔄 {t('recovery_heading')} — <span className="font-normal">{step}</span>
      </p>

      <p className="text-gray-400 text-xs mb-1 font-medium">{t('recovery_failing_command')}</p>
      <pre className="bg-gray-900 rounded p-2 text-xs text-green-300 overflow-x-auto mb-3 whitespace-pre-wrap">
        {command}
      </pre>

      <p className="text-gray-400 text-xs mb-1 font-medium">{t('recovery_stderr')}</p>
      <pre className="bg-gray-900 rounded p-2 text-xs text-red-300 overflow-x-auto mb-3 whitespace-pre-wrap max-h-32">
        {stderr}
      </pre>

      {attemptHistory.length > 0 && (
        <>
          <p className="text-gray-400 text-xs mb-1 font-medium">
            {t('recovery_attempts').replace('{n}', String(attemptHistory.length))}
          </p>
          <div className="mb-3 space-y-1 max-h-24 overflow-y-auto">
            {attemptHistory.map((a, i) => (
              <div key={i} className="bg-gray-900 rounded p-2 text-xs text-gray-400">
                <span className="text-gray-500">#{i + 1}</span>{' '}
                <code className="text-yellow-400">{a.command}</code>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="text-gray-400 text-xs mb-2">{t('recovery_prompt')}</p>
      <textarea
        className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-text-primary outline-none focus:ring-1 focus:ring-red-500 placeholder-gray-600 resize-none mb-2"
        rows={2}
        placeholder={t('recovery_input_placeholder')}
        value={diagnosis}
        onChange={(e) => setDiagnosis(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
      />
      <div className="flex gap-2">
        <button
          onClick={handleSend}
          disabled={!diagnosis.trim()}
          className="px-3 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-40 rounded text-xs font-medium"
        >
          {t('recovery_send_retry')}
        </button>
        <button
          onClick={() => onStop(jobId)}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs font-medium"
        >
          {t('recovery_stop_job')}
        </button>
      </div>
    </div>
  )
}
