import { useEffect, useRef } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom'
import FarmersPage from './pages/FarmersPage'
import SubsidyProjectsPage from './pages/SubsidyProjectsPage'
import DashboardPage from './pages/DashboardPage'
import { AIPage } from './pages/SummaryAndAI'
import SettingsPage from './pages/SettingsPage'
import PreCheckPage from './pages/PreCheckPage'
import ExternalLinksPage from './pages/ExternalLinksPage'
import HouseholdsPage from './pages/HouseholdsPage'
import BackupPage from './pages/BackupPage'
import { healthCheck } from './api'
import { useState } from 'react'

const mainNav = [
  { to: '/',         label: '首页',     icon: '📊', end: true },
  { to: '/farmers',  label: '农户档案', icon: '👤' },
  { to: '/projects', label: '补贴项目', icon: '💰' },
  { to: '/precheck', label: '数据预检', icon: '🔍' },
  { to: '/links',    label: '外联查询', icon: '🔗' },
  { to: '/ai',       label: 'AI 分析',  icon: '🤖' },
]

const settingNav = [
  { to: '/settings/households',    label: '家庭户管理', icon: '🏠' },
  { to: '/settings/village-groups',label: '村组管理',   icon: '🏘️' },
  { to: '/settings/backup',          label: '备份迁移',   icon: '💾' },
]

function Layout() {
  const [online, setOnline]       = useState<boolean | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)
  const navigate    = useNavigate()
  const location    = useLocation()

  const isSettings = location.pathname.startsWith('/settings')

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

  return (
    <div className="min-h-screen bg-stone-100" style={{ fontFamily: "'Noto Serif SC','SimSun',Georgia,serif" }}>
      <header className="bg-emerald-800 text-white sticky top-0 z-40 shadow-lg">
        <div className="max-w-screen-xl mx-auto px-5 flex items-center gap-4" style={{ height: 52 }}>
          {/* Logo */}
          <div className="font-bold text-base tracking-wide whitespace-nowrap flex items-center gap-2 shrink-0 cursor-pointer"
            onClick={() => navigate('/')}>
            <span>🌾</span><span>农户补贴管理系统</span>
          </div>

          {/* 主导航 */}
          <nav className="flex gap-0.5 flex-1">
            {mainNav.map(({ to, label, icon, end }) => (
              <NavLink key={to} to={to} end={end}
                className={({ isActive }) =>
                  `px-3.5 py-2 text-sm rounded transition-colors whitespace-nowrap flex items-center gap-1.5
                  ${isActive ? 'bg-white/20 text-white font-semibold' : 'text-emerald-200 hover:text-white hover:bg-white/10'}`
                }>
                <span>{icon}</span><span>{label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            {/* 设置下拉 */}
            <div className="relative" ref={settingsRef}>
              <button onClick={() => setSettingsOpen(o => !o)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition-colors
                  ${isSettings ? 'bg-white/20 text-white font-semibold' : 'text-emerald-200 hover:text-white hover:bg-white/10'}`}>
                <span>⚙️</span><span>系统设置</span>
                <span style={{ display:'inline-block', transition:'transform .15s', transform: settingsOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
              </button>
              {settingsOpen && (
                <div className="absolute right-0 top-full mt-1.5 bg-white rounded-xl shadow-xl border border-stone-200 overflow-hidden w-48 z-50">
                  <div className="px-3 py-2 text-xs text-stone-400 border-b border-stone-100 bg-stone-50">基础配置</div>
                  {settingNav.map(({ to, label, icon }) => (
                    <NavLink key={to} to={to} onClick={() => setSettingsOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-stone-50 transition-colors
                        ${isActive ? 'text-emerald-700 font-semibold bg-emerald-50' : 'text-stone-700'}`
                      }>
                      <span>{icon}</span><span>{label}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
            {/* 连接状态 */}
            <div className={`text-xs font-mono whitespace-nowrap
              ${online === true ? 'text-emerald-300' : online === false ? 'text-red-300' : 'text-emerald-500'}`}>
              {online === null ? '○ 连接中' : online ? '● 已连接' : '● 离线'}
            </div>
          </div>
        </div>

        {/* 设置子标签栏 */}
        {isSettings && (
          <div className="bg-emerald-900/50 border-t border-emerald-700/50">
            <div className="max-w-screen-xl mx-auto px-5 flex items-center gap-1" style={{ height: 36 }}>
              <span className="text-xs text-emerald-400 mr-2">系统设置 /</span>
              {settingNav.map(({ to, label, icon }) => (
                <NavLink key={to} to={to}
                  className={({ isActive }) =>
                    `px-3 py-1 text-xs rounded transition-colors
                    ${isActive ? 'bg-white/15 text-white font-medium' : 'text-emerald-400 hover:text-white hover:bg-white/10'}`
                  }>
                  {icon} {label}
                </NavLink>
              ))}
            </div>
          </div>
        )}
      </header>

      <main className="max-w-screen-xl mx-auto px-5 py-5">
        <Routes>
          <Route path="/"          element={<DashboardPage onGoTab={(t) => navigate(`/${t === 'projects' ? 'projects' : t}`)} />} />
          <Route path="/farmers"   element={<FarmersPage />} />
          <Route path="/projects"  element={<SubsidyProjectsPage />} />
          <Route path="/precheck"  element={<PreCheckPage />} />
          <Route path="/links"     element={<ExternalLinksPage />} />
          <Route path="/ai"        element={<AIPage />} />
          <Route path="/settings/households"     element={<HouseholdsPage />} />
          <Route path="/settings/village-groups" element={<SettingsPage />} />
          <Route path="/settings/backup" element={<BackupPage />} />
          {/* 404 fallback */}
          <Route path="*" element={
            <div className="text-center py-24 text-stone-300">
              <div className="text-5xl mb-3">🌾</div>
              <p className="text-sm">页面不存在，<button className="text-emerald-600 hover:underline" onClick={() => navigate('/')}>返回首页</button></p>
            </div>
          } />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  )
}
