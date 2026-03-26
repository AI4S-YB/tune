import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Home, MessageSquare, Database, Activity, Puzzle, Settings, ChevronLeft, ChevronRight, ChevronDown, type LucideIcon } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'

type View = 'home' | 'chat' | 'data' | 'tasks' | 'skills' | 'settings'

interface Project {
  id: string
  name: string
}

interface NavItem {
  view: View
  icon: LucideIcon
  label: string
}

interface Props {
  activeView: View
  collapsed: boolean
  projects: Project[]
  currentProjectId: string | null
  currentProjectName: string | null
  onProjectSelect: (id: string | null, name: string | null) => void
  onNavigate: (view: View) => void
  onToggleCollapse: () => void
}

export default function Sidebar({
  activeView,
  collapsed,
  projects,
  currentProjectId,
  currentProjectName,
  onProjectSelect,
  onNavigate,
  onToggleCollapse,
}: Props) {
  const { t } = useLanguage()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [search, setSearch] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  )

  const PROJECT_SCOPED_ITEMS: NavItem[] = [
    { view: 'home',  icon: Home,          label: t('nav_home')  },
    { view: 'chat',  icon: MessageSquare, label: t('nav_chat')  },
    { view: 'data',  icon: Database,      label: t('nav_data')  },
    { view: 'tasks', icon: Activity,      label: t('nav_tasks') },
  ]

  const GLOBAL_ITEMS: NavItem[] = [
    { view: 'skills', icon: Puzzle, label: t('nav_skills') },
  ]

  const renderNavButton = ({ view, icon: Icon, label }: NavItem) => {
    const active = activeView === view
    return (
      <button
        key={view}
        onClick={() => onNavigate(view)}
        title={collapsed ? label : undefined}
        className={`flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-colors w-full text-left ${
          active
            ? 'bg-accent/15 text-accent'
            : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
        }`}
      >
        <Icon size={16} className="shrink-0" />
        {!collapsed && <span className="truncate">{label}</span>}
      </button>
    )
  }

  return (
    <motion.aside
      animate={{ width: collapsed ? 56 : 220 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="h-full shrink-0 overflow-hidden flex flex-col bg-surface-raised border-r border-border-subtle"
    >
      {/* Logo + collapse toggle */}
      <div className={`flex items-center h-14 shrink-0 px-3 ${collapsed ? 'justify-center' : 'justify-between'}`}>
        {!collapsed && (
          <span className="text-accent font-bold text-sm tracking-wide">Tune</span>
        )}
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          title={collapsed ? t('sidebar_expand') : t('sidebar_collapse')}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* Project picker */}
      {!collapsed && (
        <div className="px-2 pb-2 shrink-0 relative" ref={dropdownRef}>
          <button
            onClick={() => { setDropdownOpen((o) => !o); setSearch('') }}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-surface-overlay hover:bg-surface-hover transition-colors text-left"
          >
            <span className="flex-1 truncate text-xs font-medium text-text-primary">
              {currentProjectName ?? t('project_picker_all')}
            </span>
            <ChevronDown size={12} className={`shrink-0 text-text-muted transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {dropdownOpen && (
            <div className="absolute left-2 right-2 top-full mt-1 z-50 bg-surface-overlay border border-border-subtle rounded-lg shadow-lg overflow-hidden">
              <div className="p-1.5">
                <input
                  autoFocus
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('sidebar_search_projects')}
                  className="w-full bg-surface-base border border-border-subtle rounded px-2 py-1 text-xs text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              <div className="max-h-48 overflow-y-auto">
                {/* "All Projects" fixed entry — always visible, not affected by search */}
                <button
                  onClick={() => {
                    onProjectSelect(null, null)
                    setDropdownOpen(false)
                    setSearch('')
                  }}
                  className={`w-full text-left px-3 py-2 text-xs transition-colors truncate border-b border-border-subtle ${
                    currentProjectId === null
                      ? 'bg-accent/15 text-accent font-medium'
                      : 'text-text-primary hover:bg-surface-hover'
                  }`}
                >
                  {t('project_picker_all')}
                </button>
                {filteredProjects.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-text-muted">{t('sidebar_search_projects')}</div>
                ) : (
                  filteredProjects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        onProjectSelect(p.id, p.name)
                        setDropdownOpen(false)
                        setSearch('')
                      }}
                      className={`w-full text-left px-3 py-2 text-xs transition-colors truncate ${
                        currentProjectId === p.id
                          ? 'bg-accent/15 text-accent font-medium'
                          : 'text-text-primary hover:bg-surface-hover'
                      }`}
                    >
                      {p.name}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Project-scoped nav */}
      <nav className="flex flex-col gap-1 px-2 pt-1 overflow-hidden">
        {PROJECT_SCOPED_ITEMS.map(renderNavButton)}
      </nav>

      {/* Divider */}
      <div className="mx-3 my-2 border-t border-border-subtle shrink-0" />

      {/* Global nav (Skills) */}
      <nav className="flex flex-col gap-1 px-2 overflow-hidden">
        {GLOBAL_ITEMS.map(renderNavButton)}
      </nav>

      {/* Settings — pinned to bottom */}
      <div className="px-2 pb-3 mt-auto shrink-0">
        <button
          onClick={() => onNavigate('settings')}
          title={collapsed ? t('nav_settings') : undefined}
          className={`flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-colors w-full text-left ${
            activeView === 'settings'
              ? 'bg-accent/15 text-accent'
              : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
          }`}
        >
          <Settings size={16} className="shrink-0" />
          {!collapsed && <span className="truncate">{t('nav_settings')}</span>}
        </button>
      </div>
    </motion.aside>
  )
}
