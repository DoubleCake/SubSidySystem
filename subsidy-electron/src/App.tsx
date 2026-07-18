import { useEffect, useRef, useMemo } from 'react'
import { HashRouter, Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom'
import FarmersPage from './pages/FarmersPage'
import SubsidyProjectsPage from './pages/SubsidyProjectsPage'
import DashboardPage from './pages/DashboardPage'
import { AIPage } from './pages/SummaryAndAI'
import SettingsPage from './pages/SettingsPage'
import ExternalLinksPage from './pages/ExternalLinksPage'
import BackupPage from './pages/BackupPage'
import ExcelTemplatePage from './pages/ExcelTemplatePage'
import LandTrustPage from './pages/LandTrustPage'
import HouseholdImportPage from './pages/HouseholdImportPage'
import FamilyRelationImportPage from './pages/FamilyRelationImportPage'
import ProxyManagePage from './pages/ProxyManagePage'
import AgriTaskPage from './pages/AgriTaskPage'
import LargeFarmersPage from './pages/LargeFarmersPage'
import ProjectProgressPage from './pages/ProjectProgressPage'
import WorkflowDocPage from './pages/WorkflowDocPage'
import ToolsPage from './pages/ToolsPage'
import DataVerifyPage from './pages/DataVerifyPage'
import UserManagementPage from './pages/UserManagementPage'
import PeopleMatchPage from './pages/PeopleMatchPage'
import UpdatePage from './pages/UpdatePage'
import LoginPage, { getAuth, clearAuth, isAuthDisabled, setAuthDisabled } from './pages/LoginPage'
import { healthCheck } from './api'
import { useState } from 'react'
import { QUOTES } from './utils/quotes'
import Icon from './components/Icon'

const mainNav = [
  { to: '/',          label: '首页',     icon: 'dashboard' as const, end: true },
  { to: '/farmers',   label: '户籍管理', icon: 'farmers' as const },
  { to: '/projects',  label: '补贴项目', icon: 'subsidies' as const },
  { to: '/links',     label: '补贴查询', icon: 'link' as const },
  { to: '/tools',     label: '数据工具', icon: 'menu' as const },
]

// 系统设置下拉菜单分组
const settingNavBiz = [  // 业务管理
  { to: '/settings/land-trust',    label: '土地流转', icon: 'land' as const },
  { to: '/settings/large-farmers', label: '大户管理', icon: 'household' as const },
  { to: '/agri-tasks',             label: '任务分解', icon: 'tasks' as const },
]

const settingNavBasic = [  // 基础配置
  { to: '/settings/village-groups', label: '村组管理',   icon: 'village' as const },
]

const settingNavData = [  // 数据工具
  { to: '/settings/excel-templates', label: 'Excel模板', icon: 'export' as const },
]

const settingNavSystem = [  // 系统
  { to: '/settings/users',          label: '用户管理',   icon: 'person' as const },
  { to: '/settings/backup',         label: '备份迁移',   icon: 'download' as const },
  { to: '/settings/update',         label: '软件更新',   icon: 'settings' as const },
]

function Layout() {
  const auth = getAuth()
  const [online, setOnline]       = useState<boolean | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)
  const navigate    = useNavigate()
  const location    = useLocation()

  // 启动时检测认证状态（与 LoginPage 共享模块变量）
  useEffect(() => {
    window.electronAPI.invoke<{ code: number; data: { auth_enabled: boolean } }>('auth:status')
      .then(result => { setAuthDisabled(!result?.data?.auth_enabled); setAuthChecked(true) })
      .catch(() => setAuthChecked(true))
  }, [])

  // 鉴权：非登录页且未登录则跳转（认证关闭时跳过）
  useEffect(() => {
    if (!authChecked) return
    if (!isAuthDisabled() && !auth && location.pathname !== '/login') navigate('/login', { replace: true })
  }, [auth, location.pathname, navigate, authChecked])

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
      {/* 顶部横幅 — 原始尺寸，超宽完整显示，窄屏横向滚动 */}
      <header className="overflow-x-auto" style={{ height: 100 }}>
        <img
          src="images/head.png"
          alt=""
          style={{ height: 100, width: 'auto', maxWidth: 'none', display: 'block' }}
        />
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
                <span>{label}</span>
              </NavLink>
            ))}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {auth && (
              <>
                <span className="text-white/70 text-xs">{auth.display_name}</span>
                <button onClick={() => { clearAuth(); navigate('/login') }}
                  className="text-white/50 hover:text-white text-xs">退出</button>
                <div className="w-px h-5 bg-white/20" />
              </>
            )}
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
                  {settingNavBiz.length > 0 && (
                    <>
                      <div className="px-3.5 py-2 text-meta text-text-muted border-b border-border bg-warm/30">业务管理</div>
                      {settingNavBiz.map(({ to, label, icon }) => (
                        <NavLink key={to} to={to} onClick={() => setSettingsOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-2.5 px-3.5 py-2.5 text-body transition-colors
                            ${isActive ? 'text-primary font-semibold bg-primary-500/5' : 'text-text-primary hover:bg-warm/30'}`
                          }>
                          <Icon name={icon} size={16} className="text-text-muted" />
                          <span>{label}</span>
                        </NavLink>
                      ))}
                    </>
                  )}
                  {settingNavBasic.length > 0 && (
                    <>
                      <div className="px-3.5 py-2 text-meta text-text-muted border-b border-border bg-warm/30">基础配置</div>
                      {settingNavBasic.map(({ to, label, icon }) => (
                        <NavLink key={to} to={to} onClick={() => setSettingsOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-2.5 px-3.5 py-2.5 text-body transition-colors
                            ${isActive ? 'text-primary font-semibold bg-primary-500/5' : 'text-text-primary hover:bg-warm/30'}`
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
                            ${isActive ? 'text-primary font-semibold bg-primary-500/5' : 'text-text-primary hover:bg-warm/30'}`
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
                            ${isActive ? 'text-primary font-semibold bg-primary-500/5' : 'text-text-primary hover:bg-warm/30'}`
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

      </nav>

      <main className="flex-1">
        <div className="max-w-screen-xl mx-auto px-6 py-6 pb-10">
          <Routes>
            <Route path="/"          element={<DashboardPage onGoTab={(t) => navigate(`/${t === 'projects' ? 'projects' : t}`)} />} />
            <Route path="/farmers"   element={<FarmersPage />} />
            <Route path="/match-people" element={<PeopleMatchPage />} />
            <Route path="/projects"  element={<SubsidyProjectsPage />} />
            <Route path="/project-progress" element={<ProjectProgressPage />} />
            <Route path="/agri-tasks" element={<AgriTaskPage />} />
            <Route path="/land"      element={<LandTrustPage />} />
            <Route path="/links"     element={<ExternalLinksPage />} />
            <Route path="/tools"     element={<ToolsPage />} />
            <Route path="/data-verify" element={<DataVerifyPage />} />
            <Route path="/ai"        element={<AIPage />} />
            <Route path="/settings/village-groups" element={<SettingsPage />} />
            <Route path="/settings/backup" element={<BackupPage />} />
            <Route path="/settings/excel-templates" element={<ExcelTemplatePage />} />
            <Route path="/settings/land-trust" element={<LandTrustPage />} />
            <Route path="/settings/household-import" element={<HouseholdImportPage />} />
            <Route path="/settings/family-relation-import" element={<FamilyRelationImportPage />} />
            <Route path="/settings/large-farmers" element={<LargeFarmersPage />} />
            <Route path="/settings/users" element={<UserManagementPage />} />
            <Route path="/settings/update" element={<UpdatePage />} />
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

      {/* 底部 — 原始尺寸，超宽完整显示，窄屏横向滚动 */}
      <footer>
        <div className="relative overflow-x-auto" style={{ height: 120 }}>
          <img
            src="images/foot.png"
            alt=""
            style={{ height: 120, width: 'auto', maxWidth: 'none', display: 'block' }}
            className="absolute top-0 left-0"
          />
          <div className="relative max-w-screen-xl mx-auto px-16 text-center flex items-center justify-center z-10" style={{ height: '100%' }}>
            <div className="text-m opacity-80 text-[#2A4B3C]">
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
    <HashRouter>
      <Routes>
        {/* 登录页独立于主布局，全屏显示 */}
        <Route path="/login" element={<LoginPage />} />
        {/* 其他所有页面包裹在主布局中 */}
        <Route path="/*" element={<Layout />} />
      </Routes>
    </HashRouter>
  )
}
