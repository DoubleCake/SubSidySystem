import { useEffect, useMemo } from 'react'
import { HashRouter, Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom'
import FarmersPage from './pages/FarmersPage'
import SubsidyProjectsPage from './pages/SubsidyProjectsPage'
import DashboardPage from './pages/DashboardPage'
import { AIPage } from './pages/SummaryAndAI'
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
import VillageContactsPage from './pages/VillageContactsPage'
import UserManagementPage from './pages/UserManagementPage'
import PeopleMatchPage from './pages/PeopleMatchPage'
import UpdatePage from './pages/UpdatePage'
import LoginPage, { getAuth, clearAuth, isAuthDisabled, setAuthDisabled } from './pages/LoginPage'
import { healthCheck } from './api'
import { useState } from 'react'
import { QUOTES } from './utils/quotes'
import Icon from './components/Icon'
import SidebarNav from './components/SidebarNav'
import ErrorBoundary from './components/ErrorBoundary'

const mainNav = [
  { to: '/',             label: '首页',     icon: 'dashboard' as const, end: true },
  { to: '/farmers',      label: '农户列表',  icon: 'farmers' as const },
  { to: '/projects',     label: '补贴总览',  icon: 'subsidies' as const },
  { to: '/land',         label: '土地流转',  icon: 'land' as const },
  { to: '/large-farmers',label: '大户管理',  icon: 'household' as const },
  { to: '/links',        label: '补贴查询',  icon: 'link' as const },
  { to: '/tools',        label: '数据工具',  icon: 'menu' as const },
]

function Layout() {
  const auth = getAuth()
  const [online, setOnline]       = useState<boolean | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [dbOk, setDbOk]           = useState<boolean | null>(null)
  const [isFirstRun, setIsFirstRun] = useState(false)
  const [dbReloading, setDbReloading] = useState(false)

  // 首次运行设置
  const [setupOpen, setSetupOpen]     = useState(false)
  const [setupUser, setSetupUser]     = useState('admin')
  const [setupPass, setSetupPass]     = useState('admin123')
  const [setupLoading, setSetupLoading] = useState(false)
  const [setupError, setSetupError]   = useState('')

  const navigate    = useNavigate()
  const location    = useLocation()

  // 定期检测数据库状态（含首次运行检测）
  const checkDb = async () => {
    const res = await window.electronAPI.invoke<{ ok: boolean; firstRun?: boolean }>('db:status').catch(() => ({ ok: false, firstRun: false }))
    const ok = res?.ok ?? false
    setDbOk(ok)
    if (ok && res?.firstRun) { setIsFirstRun(true); setSetupOpen(true) }
    else { setIsFirstRun(false) }
  }
  useEffect(() => { checkDb(); const t = setInterval(checkDb, 10000); return () => clearInterval(t) }, [])

  // 数据库就绪后检测认证
  useEffect(() => {
    if (!dbOk) { setAuthDisabled(true); setAuthChecked(true); return }
    window.electronAPI.invoke<{ code: number; data: { auth_enabled: boolean } }>('auth:status')
      .then(result => { setAuthDisabled(!result?.data?.auth_enabled); setAuthChecked(true) })
      .catch(() => { setAuthDisabled(true); setAuthChecked(true) })
  }, [dbOk])

  // 鉴权
  useEffect(() => {
    if (!authChecked) return
    if (!isAuthDisabled() && !auth && location.pathname !== '/login') navigate('/login', { replace: true })
    if (isFirstRun && dbOk && setupOpen) navigate('/', { replace: true })
  }, [auth, location.pathname, navigate, authChecked, isFirstRun, dbOk, setupOpen])

  // 完成首次设置
  const handleSetup = async () => {
    if (!setupUser.trim() || !setupPass.trim()) { setSetupError('用户名和密码不能为空'); return }
    setSetupLoading(true); setSetupError('')
    try {
      const res = await window.electronAPI.invoke<{ ok: boolean; error?: string }>('auth:setup', setupUser.trim(), setupPass)
      if (!res?.ok) throw new Error(res?.error || '设置失败')
      setSetupOpen(false)
      setIsFirstRun(false)
      // 重新检测 DB 状态（会返回 firstRun=false）
      await checkDb()
      showToast('✓ 管理员账号创建成功，请登录')
      navigate('/login', { replace: true })
    } catch (e) { setSetupError((e as Error).message) }
    finally { setSetupLoading(false) }
  }

  const [toastMsg, setToastMsg] = useState('')
  const showToast = (msg: string) => { setToastMsg(msg); setTimeout(() => setToastMsg(''), 3000) }

  // 随机选择一条语录和颜色主题
  const { quote } = useMemo(() => {
    const randomQuote = QUOTES[Math.floor(Math.random() * QUOTES.length)]
    return { quote: randomQuote }
  }, [])

  useEffect(() => {
    healthCheck().then(() => setOnline(true)).catch(() => setOnline(false))
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

      {/* 数据库异常横幅（dbOk===null 时不显示，等待首次检测） */}
      {dbOk === false && (
        <div className="bg-red-500 text-white px-6 py-2.5 flex items-center justify-center gap-4 text-sm">
          <span>⚠️ 数据库未就绪，数据相关功能暂不可用</span>
          <button onClick={async () => {
              setDbReloading(true)
              const res = await window.electronAPI.invoke<{ ok: boolean; error?: string }>('db:reload').catch(() => ({ ok: false }))
              if (res?.ok) { await checkDb() } else { setDbOk(false) }
              setDbReloading(false)
            }}
            disabled={dbReloading}
            className="px-3 py-1 bg-white text-red-600 rounded-btn text-xs font-bold hover:bg-red-50 disabled:opacity-50"
          >
            {dbReloading ? '重试中…' : '🔄 重试连接数据库'}
          </button>
        </div>
      )}

      {/* 首次运行设置向导 */}
      {setupOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md mx-4">
            <div className="text-center mb-6">
              <div className="text-5xl mb-3">🌾</div>
              <h2 className="text-xl font-bold text-text-primary">欢迎使用农户补贴管理系统</h2>
              <p className="text-sm text-text-muted mt-2">首次使用，请设置管理员账号</p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-text-muted mb-1">用户名</label>
                <input value={setupUser} onChange={e => setSetupUser(e.target.value)}
                  className="w-full border border-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-primary-500"
                  autoFocus />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">密码</label>
                <input type="password" value={setupPass} onChange={e => setSetupPass(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSetup() }}
                  className="w-full border border-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-primary-500" />
              </div>
              <p className="text-xs text-text-muted/60">默认建议：admin / admin123，可自行修改</p>
              {setupError && <div className="bg-red-50 border border-red-100 rounded-btn px-3 py-2 text-sm text-red-600">{setupError}</div>}
              <button onClick={handleSetup} disabled={setupLoading}
                className="w-full py-2.5 bg-primary-500 text-white rounded-btn font-medium hover:bg-primary-600 disabled:opacity-50 text-sm">
                {setupLoading ? '设置中…' : '确认设置'}
              </button>
              <p className="text-xs text-text-muted/40 text-center">设置完成后请重新登录</p>
            </div>
          </div>
        </div>
      )}

      {/* 全局 toast */}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] bg-primary-500 text-white px-5 py-2.5 rounded-btn shadow-lg text-sm animate-pulse">
          {toastMsg}
        </div>
      )}

      <main className="flex-1">
        <div className="max-w-screen-xl mx-auto px-6 py-6 pb-10">
          <div className="flex gap-6">
            <SidebarNav />
            <div className="flex-1 min-w-0">
              <ErrorBoundary>
              <Routes>
            <Route path="/"          element={<DashboardPage onGoTab={(t) => navigate(`/${t === 'projects' ? 'projects' : t}`)} />} />
            <Route path="/farmers"   element={<FarmersPage />} />
            <Route path="/village-contacts" element={<VillageContactsPage />} />
            <Route path="/match-people" element={<PeopleMatchPage />} />
            <Route path="/projects"  element={<SubsidyProjectsPage />} />
            <Route path="/project-progress" element={<ProjectProgressPage />} />
            <Route path="/agri-tasks" element={<AgriTaskPage />} />
            <Route path="/land"      element={<LandTrustPage />} />
            <Route path="/large-farmers" element={<LargeFarmersPage />} />
            <Route path="/links"     element={<ExternalLinksPage />} />
            <Route path="/tools"     element={<ToolsPage />} />
            <Route path="/data-verify" element={<DataVerifyPage />} />
            <Route path="/ai"        element={<AIPage />} />
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
              </ErrorBoundary>
            </div>
          </div>
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
