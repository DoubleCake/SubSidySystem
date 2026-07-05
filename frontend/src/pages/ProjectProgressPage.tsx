/**
 * 补贴项目进度跟踪页 — 独立页面入口（带项目选择器）
 * 从项目列表页进入时使用，核心内容由 ProjectProgressTab 渲染
 */
import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import ProjectProgressTab from '../components/ProjectProgressTab'

export default function ProjectProgressPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const urlProjectId = Number(searchParams.get('subsidy_type_id')) || null

  const [projectId, setProjectId] = useState<number | null>(urlProjectId)
  const [projectList, setProjectList] = useState<{ id: number; subsidy_name: string; subsidy_year: number }[]>([])
  const [projectName, setProjectName] = useState('')

  useEffect(() => {
    fetch('/api/subsidies/types')
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data) ? data : []
        setProjectList(list)
        if (urlProjectId) {
          const p = list.find((t: any) => t.id === urlProjectId)
          setProjectName(p ? `${p.subsidy_name}（${p.subsidy_year}年）` : `项目 #${urlProjectId}`)
        } else if (list.length > 0) {
          setProjectId(list[0].id)
        }
      })
      .catch(() => {})
  }, [urlProjectId])

  useEffect(() => {
    if (projectId && projectList.length > 0) {
      const p = projectList.find(t => t.id === projectId)
      setProjectName(p ? `${p.subsidy_name}（${p.subsidy_year}年）` : `项目 #${projectId}`)
    }
  }, [projectId, projectList])

  const selectedProject = projectList.find(p => p.id === projectId)

  return (
    <div className="p-4 max-w-full mx-auto">
      {/* 顶部导航 */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(-1)} className="text-text-muted hover:text-text-primary">← 返回</button>
        <h1 className="text-lg font-bold">📋 {projectName || '项目进度'}</h1>
      </div>

      {/* 项目选择器 */}
      <div className="bg-white border border-border rounded-card p-3 mb-3 flex items-center gap-3 shadow-sm">
        <select value={projectId ?? ''} onChange={e => setProjectId(Number(e.target.value))}
          className="border border-border rounded-btn px-2 py-1.5 text-[11px] outline-none bg-white">
          {projectList.map(p => (
            <option key={p.id} value={p.id}>{p.subsidy_name}（{p.subsidy_year}年）</option>
          ))}
        </select>
        {!selectedProject && (
          <span className="text-xs text-text-muted">请选择一个项目</span>
        )}
      </div>

      {selectedProject ? (
        <ProjectProgressTab subsidyType={selectedProject} />
      ) : (
        <div className="text-center text-text-muted py-16 text-sm">请在补贴项目页面点击"管理进度"进入</div>
      )}
    </div>
  )
}
