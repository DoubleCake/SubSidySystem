import { useEffect, useRef, useMemo } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom'
import FarmersPage from './pages/FarmersPage'
import SubsidyProjectsPage from './pages/SubsidyProjectsPage'
import DashboardPage from './pages/DashboardPage'
import { AIPage } from './pages/SummaryAndAI'
import SettingsPage from './pages/SettingsPage'
import PreCheckPage from './pages/PreCheckPage'
import ExternalLinksPage from './pages/ExternalLinksPage'
import BackupPage from './pages/BackupPage'
import ExcelTemplatePage from './pages/ExcelTemplatePage'
import LandTrustPage from './pages/LandTrustPage'
import HouseholdImportPage from './pages/HouseholdImportPage'
import FamilyRelationImportPage from './pages/FamilyRelationImportPage'
import ProxyManagePage from './pages/ProxyManagePage'
import AgriTaskPage from './pages/AgriTaskPage'
import LargeFarmersPage from './pages/LargeFarmersPage'
import { healthCheck } from './api'
import { useState } from 'react'
import { QUOTES, COLOR_THEMES } from './utils/quotes'

const mainNav = [
  { to: '/',                        label: '首页',       icon: '📊', end: true },
  { to: '/farmers',                 label: '户籍管理',   icon: '👤' },
  { to: '/projects',                label: '补贴管理',   icon: '💰' },
  { to: '/agri-tasks',              label: '任务分解',   icon: '🌱' },
  { to: '/land',                    label: '土地与大户', icon: '🌾' },
]

// 系统设置下拉菜单分组
const settingNavBasic = [  // 基础配置
  { to: '/settings/village-groups', label: '村组管理',   icon: '🏘️' },
]

const settingNavData = [  // 数据工具
  { to: '/precheck',                label: '数据预检',   icon: '🔍' },
  { to: '/ai',                     label: 'AI 分析',    icon: '🤖' },
  { to: '/settings/excel-templates', label: 'Excel模板', icon: '📋' },
]

const settingNavSystem = [  // 系统
  { to: '/settings/backup',         label: '备份迁移',   icon: '💾' },
]

function Layout() {
  const [online, setOnline]       = useState<boolean | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)
  const navigate    = useNavigate()
  const location    = useLocation()

  const isSettings = location.pathname.startsWith('/settings')

  // 随机选择一条语录和颜色主题（页面加载时确定，保持不变）
  const { quote, colorTheme } = useMemo(() => {
    const randomQuote = QUOTES[Math.floor(Math.random() * QUOTES.length)]
    const randomColor = COLOR_THEMES[Math.floor(Math.random() * COLOR_THEMES.length)]
    return { quote: randomQuote, colorTheme: randomColor }
  }, [])

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
    <div className="min-h-screen bg-stone-100 flex flex-col" style={{ fontFamily: "'Noto Serif SC','SimSun',Georgia,serif" }}>
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
                <div className="absolute right-0 top-full mt-1.5 bg-white rounded-xl shadow-xl border border-stone-200 overflow-hidden w-52 z-50">
                  {settingNavBasic.length > 0 && (
                    <>
                      <div className="px-3 py-2 text-xs text-stone-400 border-b border-stone-100 bg-stone-50">基础配置</div>
                      {settingNavBasic.map(({ to, label, icon }) => (
                        <NavLink key={to} to={to} onClick={() => setSettingsOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-stone-50 transition-colors
                            ${isActive ? 'text-emerald-700 font-semibold bg-emerald-50' : 'text-stone-700'}`
                          }>
                          <span>{icon}</span><span>{label}</span>
                        </NavLink>
                      ))}
                    </>
                  )}
                  {settingNavData.length > 0 && (
                    <>
                      <div className="px-3 py-2 text-xs text-stone-400 border-b border-stone-100 bg-stone-50">数据工具</div>
                      {settingNavData.map(({ to, label, icon }) => (
                        <NavLink key={to} to={to} onClick={() => setSettingsOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-stone-50 transition-colors
                            ${isActive ? 'text-emerald-700 font-semibold bg-emerald-50' : 'text-stone-700'}`
                          }>
                          <span>{icon}</span><span>{label}</span>
                        </NavLink>
                      ))}
                    </>
                  )}
                  {settingNavSystem.length > 0 && (
                    <>
                      <div className="px-3 py-2 text-xs text-stone-400 border-b border-stone-100 bg-stone-50">系统</div>
                      {settingNavSystem.map(({ to, label, icon }) => (
                        <NavLink key={to} to={to} onClick={() => setSettingsOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-stone-50 transition-colors
                            ${isActive ? 'text-emerald-700 font-semibold bg-emerald-50' : 'text-stone-700'}`
                          }>
                          <span>{icon}</span><span>{label}</span>
                        </NavLink>
                      ))}
                    </>
                  )}
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
              {[...settingNavBasic, ...settingNavData, ...settingNavSystem].map(({ to, label, icon }) => (
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

      <main className="flex-1">
        <div className="max-w-screen-xl mx-auto px-5 py-5 pb-8">
          <Routes>
            <Route path="/"          element={<DashboardPage onGoTab={(t) => navigate(`/${t === 'projects' ? 'projects' : t}`)} />} />
            <Route path="/farmers"   element={<FarmersPage />} />
            <Route path="/projects"  element={<SubsidyProjectsPage />} />
            <Route path="/agri-tasks" element={<AgriTaskPage />} />
            <Route path="/land"      element={<LandTrustPage />} />
            <Route path="/precheck"  element={<PreCheckPage />} />
            <Route path="/ai"        element={<AIPage />} />
            <Route path="/settings/village-groups" element={<SettingsPage />} />
            <Route path="/settings/backup" element={<BackupPage />} />
            <Route path="/settings/excel-templates" element={<ExcelTemplatePage />} />
            <Route path="/settings/land-trust" element={<LandTrustPage />} />
            <Route path="/settings/household-import" element={<HouseholdImportPage />} />
            <Route path="/settings/family-relation-import" element={<FamilyRelationImportPage />} />
            <Route path="/settings/large-farmers" element={<LargeFarmersPage />} />
            <Route path="/proxy/application/:applicationId" element={<ProxyManagePage />} />
            {/* 404 fallback */}
            <Route path="*" element={
              <div className="text-center py-24 text-stone-300">
                <div className="text-5xl mb-3">🌾</div>
                <p className="text-sm">页面不存在，<button className="text-emerald-600 hover:underline" onClick={() => navigate('/')}>返回首页</button></p>
              </div>
            } />
          </Routes>
        </div>
      </main>

      {/* 底部语录展示 */}
      <footer>
        <div className={`w-full py-6 ${colorTheme.bg} ${colorTheme.text}`}>
          <div className="max-w-screen-xl mx-auto px-5 text-center">
            <div className="text-lg font-medium italic">
              " {quote} "
            </div>
          </div>
        </div>
      </footer>
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
