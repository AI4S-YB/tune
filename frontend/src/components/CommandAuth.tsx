import { useLanguage } from '../i18n/LanguageContext'

interface Props {
  command: string
  onAuthorize: () => void
  onReject: () => void
}

export default function CommandAuth({ command, onAuthorize, onReject }: Props) {
  const { t } = useLanguage()
  return (
    <div className="mx-4 mb-3 border border-yellow-600 rounded-lg p-4 bg-yellow-950/40">
      <p className="text-yellow-300 text-xs font-semibold mb-2">
        {t('auth_heading')}
      </p>
      <pre className="bg-gray-900 rounded p-3 text-xs text-green-300 overflow-x-auto mb-3 whitespace-pre-wrap">
        {command}
      </pre>
      <p className="text-gray-400 text-xs mb-3 whitespace-pre-wrap">
        {t('auth_notice')}
      </p>
      <div className="flex gap-2">
        <button
          onClick={onAuthorize}
          className="px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded text-xs font-medium"
        >
          {t('auth_authorize')}
        </button>
        <button
          onClick={onReject}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs font-medium"
        >
          {t('auth_reject')}
        </button>
      </div>
    </div>
  )
}
