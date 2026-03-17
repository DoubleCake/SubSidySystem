import { useState, useEffect, useRef } from 'react'
import FarmersPage from './pages/FarmersPage'
import SubsidyProjectsPage from './pages/SubsidyProjectsPage'
import DashboardPage from './pages/DashboardPage'
import { AIPage } from './pages/SummaryAndAI'
import SettingsPage from './pages/SettingsPage'
import PreCheckPage from './pages/PreCheckPage'
import ExternalLinksPage from './pages/ExternalLinksPage'
import HouseholdsPage from './pages/HouseholdsPage'
import { healthCheck } from './api'

type MainTab = 'dashboard' | 'farmers' | 'projects' | 'precheck' | 'ai' | 'links'
type SettingTab = 'village-groups' | 'households'
type Tab = MainTab | SettingTab

const mainTabs: { id: MainTab; label: string; icon: string }[] = [
  { id: 'dashboard', label: '首页',     icon: '📊' },
  { id: 'farmers',   label: '农户档案', icon: '👤' },
  { id: 'projects',  label: '补贴项目', icon: '💰' },
  { id: 'precheck',  label: '数据预检', icon: '🔍' },
  { id: 'links',     label: '外联查询', icon: '🔗' },
  { id: 'ai',        label: 'AI 分析',  icon: '🤖' },
]

const settingTabs: { id: SettingTab; label: string; icon: string }[] = [
  { id: 'households',     label: '家庭户管理', icon: '🏠' },
  { id: 'village-groups', label: '村组管理',   icon: '🏘️' },
]

const PAGE_TITLES: Record<Tab, string> = {
  'dashboard':     '首页概览',
  'farmers':       '农户档案',
  'projects':      '补贴项目管理',
  'precheck':      '数据预检查',
  'links':         '外联查询',
  'ai':            'AI 智能分析',
  'households':    '家庭户管理',
  'village-groups':'村组管理',
}

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [online, setOnline] = useState<boolean | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)

  const isSettingTab = (t: Tab): t is SettingTab =>
    t === 'village-groups' || t === 'households'

  useEffect(() => {
    healthCheck().then(() => setOnline(true)).catch(() => setOnline(false))
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node))
        setSettingsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const goTab = (t: Tab) => { setTab(t); setSettingsOpen(false) }

  return (
    <div className="min-h-screen bg-stone-100" style={{ fontFamily: "'Noto Serif SC', 'SimSun', Georgia, serif" }}>
      <header className="bg-emerald-800 text-white sticky top-0 z-40 shadow-lg">
        <div className="max-w-screen-xl mx-auto px-5 flex items-center gap-4" style={{ height: 52 }}>
          <div className="font-bold text-base tracking-wide whitespace-nowrap flex items-center gap-2 shrink-0">
            <span>🌾</span><span>农户补贴管理系统</span>
          </div>
          <nav className="flex gap-0.5 flex-1">
            {mainTabs.map(t => (
              <button key={t.id} onClick={() => goTab(t.id)}
                className={`px-3.5 py-2 text-sm rounded transition-colors whitespace-nowrap flex items-center gap-1.5
                  ${tab === t.id ? 'bg-white/20 text-white font-semibold' : 'text-emerald-200 hover:text-white hover:bg-white/10'}`}>
                <span>{t.icon}</span><span>{t.label}</span>
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-3 shrink-0">
            <div className="relative" ref={settingsRef}>
              <button onClick={() => setSettingsOpen(o => !o)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition-colors
                  ${isSettingTab(tab) ? 'bg-white/20 text-white font-semibold' : 'text-emerald-200 hover:text-white hover:bg-white/10'}`}>
                <span>⚙️</span><span>系统设置</span>
                <span style={{ display:'inline-block', transition:'transform 0.15s', transform: settingsOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
              </button>
              {settingsOpen && (
                <div className="absolute right-0 top-full mt-1.5 bg-white rounded-xl shadow-xl border border-stone-200 overflow-hidden w-48 z-50">
                  <div className="px-3 py-2 text-xs text-stone-400 border-b border-stone-100 bg-stone-50">基础配置</div>
                  {settingTabs.map(t => (
                    <button key={t.id} onClick={() => goTab(t.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-stone-50 transition-colors
                        ${tab === t.id ? 'text-emerald-700 font-semibold bg-emerald-50' : 'text-stone-700'}`}>
                      <span>{t.icon}</span><span>{t.label}</span>
                      {tab === t.id && <span className="ml-auto text-emerald-500 text-xs">●</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className={`text-xs font-mono whitespace-nowrap ${online === true ? 'text-emerald-300' : online === false ? 'text-red-300' : 'text-emerald-500'}`}>
              {online === null ? '○ 连接中' : online ? '● 已连接' : '● 离线'}
            </div>
          </div>
        </div>
        {isSettingTab(tab) && (
          <div className="bg-emerald-900/50 border-t border-emerald-700/50">
            <div className="max-w-screen-xl mx-auto px-5 flex items-center gap-1" style={{ height: 36 }}>
              <span className="text-xs text-emerald-400 mr-2">系统设置 /</span>
              {settingTabs.map(t => (
                <button key={t.id} onClick={() => goTab(t.id)}
                  className={`px-3 py-1 text-xs rounded transition-colors
                    ${tab === t.id ? 'bg-white/15 text-white font-medium' : 'text-emerald-400 hover:text-white hover:bg-white/10'}`}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      <main className="max-w-screen-xl mx-auto px-5 py-5">
        <div className="flex items-center gap-3 mb-4">
          <h1 className="text-sm font-semibold text-stone-500 tracking-wide">{PAGE_TITLES[tab]}</h1>
          {tab === 'precheck' && <span className="text-xs text-stone-300">— 正式申请前请先通过预检查，确保数据零错误</span>}
        </div>
        {tab === 'dashboard'      && <DashboardPage onGoTab={goTab} />}
        {tab === 'farmers'        && <FarmersPage />}
        {tab === 'projects'       && <SubsidyProjectsPage />}
        {tab === 'precheck'       && <PreCheckPage />}
        {tab === 'links'          && <ExternalLinksPage />}
        {tab === 'ai'             && <AIPage />}
        {tab === 'households'     && <HouseholdsPage />}
        {tab === 'village-groups' && <SettingsPage />}
      </main>
    </div>
  )
}
