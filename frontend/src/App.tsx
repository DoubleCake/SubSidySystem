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
import WorkflowDocPage from './pages/WorkflowDocPage'
import { healthCheck } from './api'
import { useState } from 'react'
import { QUOTES } from './utils/quotes'
import Icon from './components/Icon'

const mainNav = [
  { to: '/',                        label: '首页',       icon: 'dashboard' as const, end: true },
  { to: '/farmers',                 label: '户籍管理',   icon: 'farmers' as const },
  { to: '/projects',                label: '补贴项目',   icon: 'subsidies' as const },
  { to: '/land',                    label: '土地与大户', icon: 'land' as const },
  { to: '/agri-tasks',              label: '任务分解',   icon: 'tasks' as const },
  { to: '/settings/village-groups', label: '村组管理',   icon: 'village' as const },
  { to: '/precheck',                label: '数据预检',   icon: 'search' as const },
  { to: '/links',                   label: '补贴查询',   icon: 'link' as const },
  { to: '/workflow',                label: '操作流程',   icon: 'menu' as const },
]

// 系统设置下拉菜单分组
const settingNavBasic = [  // 基础配置
  { to: '/settings/village-groups', label: '村组管理',   icon: 'village' as const },
]

const settingNavData = [  // 数据工具
  { to: '/precheck',                label: '数据预检',   icon: 'search' as const },
  { to: '/ai',                     label: 'AI 分析',    icon: 'ai' as const },
  { to: '/settings/excel-templates', label: 'Excel模板', icon: 'export' as const },
]

const settingNavSystem = [  // 系统
  { to: '/settings/backup',         label: '备份迁移',   icon: 'download' as const },
]

function Layout() {
  const [online, setOnline]       = useState<boolean | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)
  const navigate    = useNavigate()
  const location    = useLocation()

  const isSettings = location.pathname.startsWith('/settings')

  // 随机选择一条语录和颜色主题
  const { quote } = useMemo(() => {
    const randomQuote = QUOTES[Math.floor(Math.random() * QUOTES.length)]
    return { quote: randomQuote }
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
    <div className="min-h-screen bg-bg-main flex flex-col">
      {/* 顶部图片横幅 */}
      <header
        style={{
          backgroundImage: 'url(/images/head.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}>
        <div className="max-w-screen-xl mx-auto px-6 flex items-center" style={{ height: 100 }}>
          {/* Logo */}
          <div className="shrink-0 cursor-pointer flex items-center"
            onClick={() => navigate('/')}>
            <img src="/images/Logo.png" alt="Logo"
              className="h-14 w-auto"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
            <span className="font-bold text-base tracking-wider text-primary ml-2.5"
              style={{ display: 'none' }}>农户补贴管理系统</span>
          </div>
        </div>
      </header>

      {/* 墨绿色导航栏 */}
      <nav className="bg-primary-500 text-white sticky top-0 z-40 shadow-card">
        <div className="max-w-screen-xl mx-auto px-6 flex items-center gap-6" style={{ height: 50 }}>
          {/* 主导航 */}
          <div className="flex gap-1 flex-1">
            {mainNav.map(({ to, label, icon, end }) => (
              <NavLink key={to} to={to} end={end}
                className={({ isActive }) =>
                  `px-3.5 py-1.5 text-sm rounded-btn transition-colors whitespace-nowrap flex items-center gap-2
                  ${isActive ? 'bg-white/15 text-white font-semibold' : 'text-white/80 hover:text-white hover:bg-white/10'}`
                }>
                <Icon name={icon} size={16} />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* 设置下拉 */}
            <div className="relative" ref={settingsRef}>
              <button onClick={() => setSettingsOpen(o => !o)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-btn text-sm transition-colors
                  ${isSettings ? 'bg-white/15 text-white font-semibold' : 'text-white/80 hover:text-white hover:bg-white/10'}`}>
                <Icon name="settings" size={16} />
                <span>系统设置</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  className="w-3.5 h-3.5 transition-transform duration-150"
                  style={{ transform: settingsOpen ? 'rotate(180deg)' : 'none' }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {settingsOpen && (
                <div className="absolute right-0 top-full mt-2 bg-white rounded-card shadow-card border border-border overflow-hidden w-52 z-50">
                  {settingNavBasic.length > 0 && (
                    <>
                      <div className="px-3.5 py-2 text-meta text-text-muted border-b border-border bg-warm/30">基础配置</div>
                      {settingNavBasic.map(({ to, label, icon }) => (
                        <NavLink key={to} to={to} onClick={() => setSettingsOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-2.5 px-3.5 py-2.5 text-body transition-colors
                            ${isActive ? 'text-primary font-semibold bg-primary/5' : 'text-text-primary hover:bg-warm/30'}`
                          }>
                          <Icon name={icon} size={16} className="text-text-muted" />
                          <span>{label}</span>
                        </NavLink>
                      ))}
                    </>
                  )}
                  {settingNavData.length > 0 && (
                    <>
                      <div className="px-3.5 py-2 text-meta text-text-muted border-b border-border bg-warm/30">数据工具</div>
                      {settingNavData.map(({ to, label, icon }) => (
                        <NavLink key={to} to={to} onClick={() => setSettingsOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-2.5 px-3.5 py-2.5 text-body transition-colors
                            ${isActive ? 'text-primary font-semibold bg-primary/5' : 'text-text-primary hover:bg-warm/30'}`
                          }>
                          <Icon name={icon} size={16} className="text-text-muted" />
                          <span>{label}</span>
                        </NavLink>
                      ))}
                    </>
                  )}
                  {settingNavSystem.length > 0 && (
                    <>
                      <div className="px-3.5 py-2 text-meta text-text-muted border-b border-border bg-warm/30">系统</div>
                      {settingNavSystem.map(({ to, label, icon }) => (
                        <NavLink key={to} to={to} onClick={() => setSettingsOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-2.5 px-3.5 py-2.5 text-body transition-colors
                            ${isActive ? 'text-primary font-semibold bg-primary/5' : 'text-text-primary hover:bg-warm/30'}`
                          }>
                          <Icon name={icon} size={16} className="text-text-muted" />
                          <span>{label}</span>
                        </NavLink>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
            {/* 连接状态 */}
            <div className={`text-meta font-mono whitespace-nowrap flex items-center gap-1.5
              ${online === null ? 'text-white/60' : online === false ? 'text-red-300' : 'text-white/80'}`}>
              <span className={`inline-block w-2 h-2 rounded-full
                ${online === null ? 'bg-white/40' : online ? 'bg-green-300' : 'bg-red-300'}`} />
              {online === null ? '连接中' : online ? '已连接' : '离线'}
            </div>
          </div>
        </div>

        {/* 设置子标签栏 */}
        {isSettings && (
          <div className="bg-warm/50 border-t border-border">
            <div className="max-w-screen-xl mx-auto px-6 flex items-center gap-1" style={{ height: 36 }}>
              <span className="text-meta text-text-muted mr-2 shrink-0">系统设置 /</span>
              {[...settingNavBasic, ...settingNavData, ...settingNavSystem].map(({ to, label, icon }) => (
                <NavLink key={to} to={to}
                  className={({ isActive }) =>
                    `px-3 py-1 text-meta rounded-btn transition-colors flex items-center gap-1.5
                    ${isActive ? 'bg-primary/10 text-primary font-medium' : 'text-text-muted hover:text-primary hover:bg-primary/5'}`
                  }>
                  <Icon name={icon} size={12} />
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
        )}
      </nav>

      <main className="flex-1">
        <div className="max-w-screen-xl mx-auto px-6 py-6 pb-10">
          <Routes>
            <Route path="/"          element={<DashboardPage onGoTab={(t) => navigate(`/${t === 'projects' ? 'projects' : t}`)} />} />
            <Route path="/farmers"   element={<FarmersPage />} />
            <Route path="/projects"  element={<SubsidyProjectsPage />} />
            <Route path="/agri-tasks" element={<AgriTaskPage />} />
            <Route path="/land"      element={<LandTrustPage />} />
            <Route path="/links"     element={<ExternalLinksPage />} />
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
            <Route path="/workflow" element={<WorkflowDocPage />} />
            {/* 404 fallback */}
            <Route path="*" element={
              <div className="text-center py-24 text-text-muted">
                <div className="mb-4 flex justify-center">
                  <Icon name="question" size={48} className="text-border" />
                </div>
                <p className="text-body">页面不存在，<button className="text-primary hover:underline font-medium" onClick={() => navigate('/')}>返回首页</button></p>
              </div>
            } />
          </Routes>
        </div>
      </main>

      {/* 底部 */}
      <footer>
        <div className="w-full py-5 text-[#2A4B3C]"
          style={{
            backgroundImage: 'url(/images/foot.png)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}>
          <div className="max-w-screen-xl mx-auto px-12 text-center">
            <div className="text-sm opacity-80" >
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
