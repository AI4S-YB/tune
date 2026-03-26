import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'

interface Thread {
  id: string
  title: string | null
  project_id: string | null
  project_name: string | null
  created_at: string
  updated_at: string
}

interface Project {
  id: string
  name: string
}

interface Props {
  activeThreadId: string | null
  activeProjectId: string | null
  onSelectThread: (thread: Thread | null) => void
  onThreadsChanged?: () => void
  onClose?: () => void
}

export default function ThreadSidebar({ activeThreadId, activeProjectId, onSelectThread, onThreadsChanged, onClose }: Props) {
  const { t } = useLanguage()
  const [threads, setThreads] = useState<Thread[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<{ threadId: string; threadTitle: string } | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    const [thr, proj] = await Promise.all([
      fetch('/api/threads/').then((r) => r.json()).catch(() => []),
      fetch('/api/projects/').then((r) => r.json()).catch(() => []),
    ])
    setThreads(thr)
    setProjects(proj)
    onThreadsChanged?.()
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  const createThread = async (projectId?: string) => {
    const res = await fetch('/api/threads/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId ?? null }),
    }).then((r) => r.json())
    await load()
    onSelectThread(res)
  }

  const renameThread = async (id: string, title: string) => {
    const original = threads.find((t) => t.id === id)?.title ?? ''
    const newTitle = title.trim() || original
    await fetch(`/api/threads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle }),
    })
    setRenamingId(null)
    await load()
  }

  const deleteThread = async (threadId: string) => {
    await fetch(`/api/threads/${threadId}`, { method: 'DELETE' })
    setDeleteConfirm(null)
    // If the deleted thread was active, select the next available one
    if (activeThreadId === threadId) {
      const remaining = threads.filter((t) => t.id !== threadId)
      onSelectThread(remaining[0] ?? null)
    }
    await load()
  }

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const unassignedThreads = threads.filter((thr) => !thr.project_id)

  return (
    <div className="flex flex-col h-full bg-surface-raised text-text-primary overflow-hidden">
      {/* Header */}
      <div className="flex items-center px-3 py-2 border-b border-border-subtle shrink-0 gap-2">
        <span className="flex-1 text-xs font-semibold text-text-muted uppercase tracking-wide">{t('thread_heading')}</span>
        <button
          onClick={() => createThread(activeProjectId ?? undefined)}
          title={t('thread_new')}
          className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
        >
          <span className="text-sm leading-none">+</span>
        </button>
        {onClose && (
          <button
            onClick={onClose}
            title={t('close_panel_title')}
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Unassigned threads */}
        {unassignedThreads.length > 0 && (
          <div>
            <button
              onClick={() => toggleCollapse('__unassigned')}
              className="w-full flex items-center gap-1 px-3 py-1.5 text-xs text-text-muted hover:bg-surface-hover"
            >
              <span>{collapsed.has('__unassigned') ? '▸' : '▾'}</span>
              <span className="font-medium">{t('thread_unassigned')}</span>
              <span className="ml-auto text-text-muted">{unassignedThreads.length}</span>
            </button>
            {!collapsed.has('__unassigned') && unassignedThreads.map((thr) => (
              <ThreadRow
                key={thr.id}
                thread={thr}
                active={thr.id === activeThreadId}
                renaming={renamingId === thr.id}
                renameValue={renameValue}
                renameInputRef={renameInputRef}
                untitledLabel={t('thread_untitled')}
                onSelect={() => onSelectThread(thr)}
                onRenameStart={() => { setRenamingId(thr.id); setRenameValue(thr.title ?? '') }}
                onRenameChange={setRenameValue}
                onRenameCommit={() => renameThread(thr.id, renameValue)}
                onRenameCancel={() => setRenamingId(null)}
                onDeleteClick={() => setDeleteConfirm({ threadId: thr.id, threadTitle: thr.title ?? t('thread_untitled') })}
              />
            ))}
          </div>
        )}

        {/* Projects */}
        {projects.map((proj) => {
          const projThreads = threads.filter((thr) => thr.project_id === proj.id)
          const isCollapsed = collapsed.has(proj.id)
          return (
            <div key={proj.id}>
              <button
                onClick={() => toggleCollapse(proj.id)}
                className="w-full flex items-center gap-1 px-3 py-1.5 text-xs text-text-muted hover:bg-surface-hover"
              >
                <span>{isCollapsed ? '▸' : '▾'}</span>
                <span className="font-medium truncate">{proj.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); createThread(proj.id) }}
                  title={t('thread_new_in_project')}
                  className="ml-auto px-1 opacity-30 group-hover:opacity-100 hover:text-text-primary"
                >
                  +
                </button>
                <span className="text-text-muted ml-1">{projThreads.length}</span>
              </button>
              {!isCollapsed && projThreads.map((thr) => (
                <ThreadRow
                  key={thr.id}
                  thread={thr}
                  active={thr.id === activeThreadId}
                  renaming={renamingId === thr.id}
                  renameValue={renameValue}
                  renameInputRef={renameInputRef}
                  untitledLabel={t('thread_untitled')}
                  onSelect={() => onSelectThread(thr)}
                  onRenameStart={() => { setRenamingId(thr.id); setRenameValue(thr.title ?? '') }}
                  onRenameChange={setRenameValue}
                  onRenameCommit={() => renameThread(thr.id, renameValue)}
                  onRenameCancel={() => setRenamingId(null)}
                  onDeleteClick={() => setDeleteConfirm({ threadId: thr.id, threadTitle: thr.title ?? t('thread_untitled') })}
                />
              ))}
            </div>
          )
        })}
      </div>

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-surface-raised border border-border-subtle rounded-lg p-5 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-sm font-semibold text-white mb-2">{t('thread_delete_confirm')}</h3>
            <p className="text-xs text-text-primary mb-1 font-medium">{deleteConfirm.threadTitle}</p>
            <p className="text-xs text-yellow-400 mb-4">{t('thread_delete_warning')}</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="text-xs px-3 py-1.5 rounded border border-border-subtle text-text-muted hover:text-text-primary"
              >
                {t('chat_cancel')}
              </button>
              <button
                onClick={() => deleteThread(deleteConfirm.threadId)}
                className="text-xs px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white font-medium"
              >
                {t('thread_delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ThreadRow({
  thread,
  active,
  renaming,
  renameValue,
  renameInputRef,
  untitledLabel,
  onSelect,
  onRenameStart,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onDeleteClick,
}: {
  thread: Thread
  active: boolean
  renaming: boolean
  renameValue: string
  renameInputRef: React.RefObject<HTMLInputElement>
  untitledLabel: string
  onSelect: () => void
  onRenameStart: () => void
  onRenameChange: (v: string) => void
  onRenameCommit: () => void
  onRenameCancel: () => void
  onDeleteClick: () => void
}) {
  const title = thread.title || untitledLabel
  return (
    <div
      className={`group flex items-center pl-6 pr-1 py-1 text-xs cursor-pointer ${
        active ? 'bg-surface-overlay text-text-primary' : 'hover:bg-surface-hover text-text-muted'
      }`}
      onClick={onSelect}
    >
      {renaming ? (
        <input
          ref={renameInputRef}
          className="flex-1 bg-surface-overlay text-text-primary rounded px-1 py-0.5 outline-none text-xs"
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onBlur={onRenameCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRenameCommit()
            if (e.key === 'Escape') onRenameCancel()
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <>
          <span
            className="truncate flex-1"
            onClick={(e) => {
              if (active) {
                e.stopPropagation()
                onRenameStart()
              }
            }}
          >
            {title}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onDeleteClick() }}
            className="opacity-30 group-hover:opacity-100 hover:text-red-400 transition-opacity px-1 shrink-0"
          >
            🗑
          </button>
        </>
      )}
    </div>
  )
}
