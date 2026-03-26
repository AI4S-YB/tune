import { Menu } from 'lucide-react'
import { Sheet, SheetContent } from './ui/sheet'
import ThreadSidebar from './ThreadSidebar'
import type { Lang } from '../i18n/translations'
import { useLanguage } from '../i18n/LanguageContext'

type View = 'home' | 'chat' | 'data' | 'tasks' | 'skills' | 'settings'

interface Thread {
  id: string
  title: string | null
  project_id: string | null
  project_name: string | null
  created_at: string
  updated_at: string
}

interface Props {
  activeView: View
  threadTitle?: string | null
  wsConnected: boolean
  lang: Lang
  onSetLang: (lang: Lang) => void
  activeThreadId: string | null
  activeProjectId: string | null
  onSelectThread: (thread: Thread | null) => void
  threadDrawerOpen: boolean
  onThreadDrawerChange: (open: boolean) => void
}

export default function TopHeader({
  activeView,
  threadTitle,
  wsConnected,
  lang,
  onSetLang,
  activeThreadId,
  activeProjectId,
  onSelectThread,
  threadDrawerOpen,
  onThreadDrawerChange,
}: Props) {
  const { t } = useLanguage()
  const viewTitles: Record<View, string> = {
    home: t('header_home'),
    chat: t('header_chat'),
    data: t('header_data'),
    tasks: t('header_tasks'),
    skills: t('header_skills'),
    settings: t('header_settings'),
  }
  return (
    <header className="h-14 shrink-0 flex items-center px-5 gap-3 bg-surface-raised border-b border-border-subtle select-none">
      {/* Thread drawer trigger — only in Chat view */}
      {activeView === 'chat' && (
        <>
          <button
            onClick={() => onThreadDrawerChange(true)}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
            title={t('header_thread_history')}
          >
            <Menu size={16} />
          </button>
          <Sheet open={threadDrawerOpen} onOpenChange={onThreadDrawerChange}>
            <SheetContent side="left" className="w-72 sm:max-w-xs p-0" hideClose>
              <ThreadSidebar
                activeThreadId={activeThreadId}
                activeProjectId={activeProjectId}
                onSelectThread={(thread) => {
                  onSelectThread(thread ?? null)
                  onThreadDrawerChange(false)
                }}
                onClose={() => onThreadDrawerChange(false)}
              />
            </SheetContent>
          </Sheet>
        </>
      )}

      {/* View title */}
      <h1 className="text-sm font-semibold text-text-primary">
        {viewTitles[activeView]}
      </h1>

      {/* Thread title — shown in chat view when a thread is active */}
      {activeView === 'chat' && threadTitle && (
        <span className="text-xs text-text-muted bg-surface-overlay px-2 py-0.5 rounded-md truncate max-w-[200px]">
          {threadTitle}
        </span>
      )}

      {/* Right side: lang toggle + WS status */}
      <div className="ml-auto flex items-center gap-2">
        <div className="flex items-center rounded-lg bg-surface-overlay p-0.5 gap-0.5">
          <button
            onClick={() => onSetLang('en')}
            className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors ${
              lang === 'en' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            EN
          </button>
          <button
            onClick={() => onSetLang('zh')}
            className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors ${
              lang === 'zh' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            中
          </button>
        </div>
        <span
          className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-400' : 'bg-red-400'}`}
          title={wsConnected ? t('header_ws_connected') : t('header_ws_disconnected')}
        />
      </div>
    </header>
  )
}
