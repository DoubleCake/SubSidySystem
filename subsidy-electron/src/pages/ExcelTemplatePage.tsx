/**
 * Excel 智能导入管理页
 * Tab 1: 模板列表 —— 管理列映射模板，查看使用记录
 * Tab 2: 智能识别 —— 上传 Excel，系统识别列名，配置并保存模板
 * Tab 3: 导入日志 —— 历史导入记录
 */
import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import Tag from '../components/Tag'
import Modal from '../components/Modal'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import * as api from '../api'

// ── 类型定义 ──
interface ColumnTemplate {
  id: number; template_name: string; template_year: number | null
  region_name: string | null; business_type: string; subsidy_type_id: number | null
  header_row: number; data_start_row: number
  column_mapping: MappingItem[]; skip_rules: SkipRule[]; value_mapping: Record<string, Record<string, unknown>>
  use_count: number; last_used_at: string | null; created_at: string
}

interface MappingItem {
  excel_column: string; system_field: string | null
  aliases?: string[]; required?: boolean; transform?: string
  confidence?: number; auto_confirm?: boolean
}

interface SkipRule { field: string; condition: string; value?: string }

interface DetectResult {
  columns: Array<{
    excel_column: string; suggested_field: string | null
    suggested_confidence: number; match_type: string | null
    alternatives: Array<{field: string; confidence: number}>
    auto_confirm: boolean
  }>
  recommended_templates: Array<{id: number; template_name: string; match_rate: number; use_count: number}>
  system_fields: Array<{field: string; label: string; required: boolean; type: string}>
  auto_confirm_count: number; unrecognized_count: number
}

interface ImportLog {
  id: number; template_name: string | null; file_name: string
  business_type: string; region_name: string | null; import_year: number | null
  total_rows: number; created_count: number; skipped_count: number
  error_count: number; rule_failed_count: number
  operator: string | null; import_duration_ms: number | null; created_at: string
}

const BT_LABEL: Record<string, string> = { SUBSIDY: '补贴发放', FARMER: '农户档案', PLANTING: '种植记录' }
const FIELD_TYPE_COLOR: Record<string, string> = {
  id_card: 'bg-amber-100 text-amber-700', string: 'bg-warm/30 text-text-primary',
  decimal: 'bg-blue-100 text-blue-700', date: 'bg-purple-100 text-purple-700',
  phone: 'bg-green-100 text-green-700', status: 'bg-rose-100 text-rose-700',
}

export default function ExcelTemplatePage() {
  const { toast, show } = useToast()
  const [tab, setTab] = useState<'templates'|'detect'|'logs'>('templates')
  const [templates, setTemplates] = useState<ColumnTemplate[]>([])
  const [logs, setLogs] = useState<ImportLog[]>([])
  const [logsTotal, setLogsTotal] = useState(0)

  // 识别流程状态
  const [detectFile, setDetectFile] = useState<File|null>(null)
  const [detectResult, setDetectResult] = useState<DetectResult|null>(null)
  const [mappings, setMappings] = useState<MappingItem[]>([])
  const [detecting, setDetecting] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveForm, setSaveForm] = useState({ name: '', year: '', region: '', btype: 'SUBSIDY' })

  // 模板编辑
  const [editOpen, setEditOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ColumnTemplate|null>(null)

  const loadTemplates = useCallback(async () => {
    const list = await api.getExcelTemplates().catch(()=>[])
    setTemplates(list as ColumnTemplate[])
  }, [])

  const loadLogs = useCallback(async () => {
    const r = await api.getExcelTemplateLogs({ page_size: 30 }).catch(()=>({total:0,items:[]}))
    setLogs(r.items as ImportLog[]); setLogsTotal(r.total)
  }, [])

  useEffect(() => {
    loadTemplates()
    if (tab === 'logs') loadLogs()
  }, [tab, loadTemplates, loadLogs])

  // ── 识别列名 ──
  const detectColumns = async (file: File) => {
    setDetectFile(file); setDetecting(true); setDetectResult(null); setMappings([])
    const reader = new FileReader()
    reader.onload = async e => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string,unknown>[]
        const columns = rows.length > 0 ? Object.keys(rows[0]) : []
        const sampleRows = rows.slice(0, 3)

        const raw = await api.detectExcelColumns(columns, 'SUBSIDY', sampleRows)
        const result: DetectResult = {
          columns: raw.columns.map(c => ({
            excel_column: c.excel_column,
            suggested_field: c.suggested_field,
            suggested_confidence: c.confidence,
            match_type: null,
            alternatives: c.alternatives,
            auto_confirm: false,
          })),
          recommended_templates: (raw.recommended_templates || []).map(t => ({ ...t, use_count: 0 })),
          system_fields: [],
          auto_confirm_count: raw.auto_confirm_count || 0,
          unrecognized_count: raw.unrecognized_count || 0,
        }
        setDetectResult(result)
        setMappings(result.columns.map(c => ({
          excel_column: c.excel_column,
          system_field: c.auto_confirm ? c.suggested_field : (c.suggested_confidence > 0.5 ? c.suggested_field : null),
          confidence: c.suggested_confidence,
          auto_confirm: c.auto_confirm,
        })))
      } catch (err: unknown) { show((err as Error).message, 'err') }
      finally { setDetecting(false) }
    }
    reader.readAsArrayBuffer(file)
  }

  // ── AI 识别 ──
  const runAiDetect = async () => {
    if (!detectFile) return
    setAiLoading(true)
    const reader = new FileReader()
    reader.onload = async e => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string,unknown>[]
        const columns = rows.length > 0 ? Object.keys(rows[0]) : []
        const r = await api.aiDetectColumns({ columns, business_type: 'SUBSIDY', sample_rows: rows.slice(0,3) })
        // 更新映射
        setMappings(prev => prev.map(m => {
          const aiResult = r.results.find(a => a.excel_column === m.excel_column)
          if (aiResult && aiResult.confidence > (m.confidence || 0)) {
            return { ...m, system_field: aiResult.system_field, confidence: aiResult.confidence }
          }
          return m
        }))
        show(`✓ AI 识别完成（来源：${r.source}）`)
      } catch (err: unknown) { show((err as Error).message, 'err') }
      finally { setAiLoading(false) }
    }
    reader.readAsArrayBuffer(detectFile)
  }

  // ── 保存模板 ──
  const saveTemplate = async () => {
    if (!saveForm.name.trim()) return show('请填写模板名称', 'err')
    const mapping = mappings.filter(m => m.system_field).map(m => ({
      excel_column: m.excel_column, system_field: m.system_field,
      aliases: [m.excel_column], required: false, transform: '',
    }))
    await api.saveExcelTemplate({
      template_name: saveForm.name, template_year: saveForm.year ? Number(saveForm.year) : null,
      region_name: saveForm.region || null, business_type: saveForm.btype,
      column_mapping: mapping,
    })
    show('✓ 模板保存成功'); setSaveOpen(false); loadTemplates()
  }

  const deleteTemplate = async (id: number) => {
    if (!confirm('确认删除此模板？')) return
    await api.deleteExcelTemplate(id)
    show('✓ 已删除'); loadTemplates()
  }

  const systemFields = detectResult?.system_fields || []
  const confirmed   = mappings.filter(m => m.system_field).length
  const unconfirmed = mappings.filter(m => !m.system_field).length

  return (
    <div>
      {/* Tab 导航 */}
      <div className="flex items-center gap-2 mb-4">
        {[
          { id: 'templates', label: '📋 列映射模板', count: templates.length },
          { id: 'detect',    label: '🔍 智能识别',   count: null },
          { id: 'logs',      label: '📜 导入日志',   count: logsTotal },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as typeof tab)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-btn border transition-colors
              ${tab === t.id ? 'bg-primary-500 text-white border-emerald-700' : 'bg-white border-border text-text-primary hover:border-border'}`}>
            {t.label}
            {t.count !== null && <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${tab===t.id?'bg-white/20 ':'bg-warm/30 text-text-muted'}`}>{t.count}</span>}
          </button>
        ))}
      </div>

      {/* ── 模板列表 ── */}
      {tab === 'templates' && (
        <div>
          <div className="bg-blue-50 border border-blue-100 rounded-card px-4 py-3 mb-4 text-xs text-blue-700">
            列映射模板记录了「Excel列名」到「系统字段」的对应关系。配置一次，以后相同格式的 Excel 直接复用，无需重复配置。
          </div>
          {templates.length === 0
            ? <div className="bg-white border border-border rounded-card py-16 text-center text-text-muted/50">
                <div className="text-4xl mb-3">📋</div>
                <p className="text-sm mb-2">暂无列映射模板</p>
                <p className="text-xs">点击「🔍 智能识别」上传 Excel 自动生成模板</p>
              </div>
            : <div className="grid gap-3">
                {templates.map(t => (
                  <div key={t.id} className="bg-white border border-border rounded-card p-5 shadow-card hover:border-border transition-colors">
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className="font-bold text-text-primary">{t.template_name}</span>
                          <Tag label={BT_LABEL[t.business_type] || t.business_type} color="blue" />
                          {t.template_year && <Tag label={`${t.template_year}年`} color="gray" />}
                          {t.region_name && <Tag label={t.region_name} color="gray" />}
                          {t.use_count > 0 && <span className="text-xs text-text-muted">已使用 {t.use_count} 次</span>}
                        </div>
                        {/* 映射预览 */}
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {t.column_mapping.slice(0,8).map((m,i) => (
                            <span key={i} className="text-xs bg-warm/30 border border-border rounded px-2 py-0.5 font-mono">
                              <span className="text-text-muted">{m.excel_column}</span>
                              <span className="text-text-muted/50 mx-1">→</span>
                              <span className="text-primary">{m.system_field || '忽略'}</span>
                            </span>
                          ))}
                          {t.column_mapping.length > 8 && (
                            <span className="text-xs text-text-muted">…共{t.column_mapping.length}列</span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => deleteTemplate(t.id)}
                          className="text-xs text-red-400 border border-red-100 px-2.5 py-1 rounded-btn hover:bg-red-50">删除</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
          }
        </div>
      )}

      {/* ── 智能识别 ── */}
      {tab === 'detect' && (
        <div>
          {!detectResult ? (
            <div>
              <div className="bg-white border border-border rounded-card p-6 mb-4 shadow-card">
                <h3 className="font-semibold text-text-primary mb-3">上传 Excel 文件进行列名识别</h3>
                <div
                  className="border-2 border-dashed border-border rounded-card p-10 text-center cursor-pointer hover:border-primary-500/30 hover:bg-primary-500/5/30 transition-colors"
                  onClick={() => document.getElementById('detect-file')?.click()}>
                  <div className="text-4xl mb-3">📊</div>
                  <p className="text-text-muted text-sm">拖拽或点击选择 Excel 文件</p>
                  <p className="text-text-muted/50 text-xs mt-1">支持 .xlsx / .xls，系统将自动分析列名并建议映射关系</p>
                  <input id="detect-file" type="file" accept=".xlsx,.xls" className="hidden"
                    onChange={e => { if (e.target.files?.[0]) detectColumns(e.target.files[0]) }} />
                </div>
                {detecting && (
                  <div className="mt-4 flex items-center gap-2 text-sm text-text-muted">
                    <span className="w-4 h-4 border-2 border-border border-t-emerald-500 rounded-full animate-spin inline-block"/>
                    正在分析列名…
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div>
              {/* 识别结果头部 */}
              <div className="bg-white border border-border rounded-card p-4 mb-4 shadow-card">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-text-primary">识别结果：{detectFile?.name}</span>
                    <span className="text-xs bg-emerald-100 text-primary px-2 py-0.5 rounded">
                      {confirmed} 列已映射
                    </span>
                    {unconfirmed > 0 && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">
                        {unconfirmed} 列未映射
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={runAiDetect} disabled={aiLoading}
                      className="text-xs border border-purple-200 text-purple-700 px-3 py-1.5 rounded-btn hover:bg-purple-50 disabled:opacity-60">
                      {aiLoading ? '🤖 AI识别中…' : '🤖 AI辅助识别'}
                    </button>
                    <button onClick={() => setSaveOpen(true)}
                      className="text-xs bg-primary-500  px-3 py-1.5 rounded-btn hover:bg-primary-500/90">
                      💾 保存为模板
                    </button>
                    <button onClick={() => { setDetectResult(null); setMappings([]); setDetectFile(null) }}
                      className="text-xs border border-border text-text-muted px-3 py-1.5 rounded-btn hover:bg-warm/30">
                      重新上传
                    </button>
                  </div>
                </div>

                {/* 推荐模板 */}
                {detectResult.recommended_templates.length > 0 && (
                  <div className="bg-amber-50 border border-amber-100 rounded-card p-3 mb-3">
                    <p className="text-xs text-amber-700 font-semibold mb-2">找到相似模板，可直接复用：</p>
                    <div className="flex gap-2 flex-wrap">
                      {detectResult.recommended_templates.map(t => (
                        <button key={t.id}
                          onClick={async () => {
                            const tmpl = await api.getExcelTemplate(t.id)
                            setMappings(tmpl.column_mapping.map(m => ({
                              excel_column: m.excel_column, system_field: m.system_field,
                              confidence: 1, auto_confirm: true,
                            })))
                            show(`✓ 已应用模板「${tmpl.template_name}」`)
                          }}
                          className="text-xs bg-white border border-amber-200 text-amber-700 px-3 py-1.5 rounded-btn hover:bg-amber-50">
                          {t.template_name} <span className="text-amber-400 ml-1">匹配度 {Math.round(t.match_rate*100)}%</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 列映射配置表格 */}
              <div className="bg-white border border-border rounded-card overflow-hidden shadow-card">
                <div className="px-4 py-3 bg-warm/30 border-b border-border grid grid-cols-[220px_1fr_160px_80px] gap-4 text-xs font-semibold text-text-muted">
                  <span>Excel 列名</span><span>数据示例</span><span>映射到系统字段</span><span>操作</span>
                </div>
                {mappings.map((m, idx) => {
                  const detected = detectResult.columns.find(c => c.excel_column === m.excel_column)
                  return (
                    <div key={idx} className={`px-4 py-3 border-b border-border/50 grid grid-cols-[220px_1fr_160px_80px] gap-4 items-center
                      ${!m.system_field ? 'bg-amber-50/30' : m.auto_confirm ? 'bg-primary-500/5/20' : ''}`}>
                      <div>
                        <span className="text-sm font-semibold text-text-primary">{m.excel_column}</span>
                        {m.confidence !== undefined && m.confidence > 0 && (
                          <span className={`ml-2 text-xs ${m.confidence >= 0.9 ? 'text-primary' : m.confidence >= 0.6 ? 'text-amber-600' : 'text-red-400'}`}>
                            {Math.round(m.confidence * 100)}%
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-text-muted font-mono truncate">
                        {/* 示例数据从 detect result 里拿 */}
                        {detected?.alternatives?.[0] ? `建议：${detected.alternatives.map(a=>a.field).join(' / ')}` : ''}
                      </div>
                      <select
                        value={m.system_field || ''}
                        onChange={e => setMappings(prev => prev.map((p,i) => i===idx ? {...p, system_field: e.target.value||null, auto_confirm: true} : p))}
                        className={`border rounded-btn px-2 py-1 text-sm outline-none bg-white
                          ${m.system_field ? 'border-primary-500/30 text-primary' : 'border-amber-300 text-amber-600'}`}>
                        <option value="">— 忽略此列 —</option>
                        {systemFields.map(f => (
                          <option key={f.field} value={f.field}>
                            {f.label}（{f.field}）{f.required ? ' *' : ''}
                          </option>
                        ))}
                      </select>
                      <span className={`text-xs px-2 py-0.5 rounded text-center ${
                        !m.system_field ? 'bg-warm/30 text-text-muted' :
                        m.auto_confirm ? 'bg-emerald-100 text-primary' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {!m.system_field ? '忽略' : m.auto_confirm ? '自动' : '手动'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 导入日志 ── */}
      {tab === 'logs' && (
        <div>
          <div className="bg-white border border-border rounded-card overflow-hidden shadow-card">
            <div className="px-4 py-3 bg-warm/30 border-b border-border flex justify-between items-center">
              <span className="font-semibold text-text-primary text-sm">导入历史记录</span>
              <span className="text-xs text-text-muted">共 {logsTotal} 条</span>
            </div>
            {logs.length === 0
              ? <div className="py-12 text-center text-text-muted/50 text-sm">暂无导入记录</div>
              : <table className="w-full border-collapse">
                  <thead><tr className="border-b border-border/50">
                    {['文件名','业务类型','年度/村组','导入结果','耗时','操作员','时间'].map(h=>(
                      <th key={h} className="px-3.5 py-2.5 text-left text-xs text-text-muted font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {logs.map(l => (
                      <tr key={l.id} className="border-b border-border/50 hover:bg-warm/30">
                        <td className="px-3.5 py-2.5 text-xs font-mono text-text-primary max-w-xs truncate">{l.file_name}</td>
                        <td className="px-3.5 py-2.5"><Tag label={BT_LABEL[l.business_type]||l.business_type} color="blue"/></td>
                        <td className="px-3.5 py-2.5 text-xs text-text-muted">{l.import_year||'—'} / {l.region_name||'—'}</td>
                        <td className="px-3.5 py-2.5 text-xs">
                          <span className="text-primary font-semibold">+{l.created_count}</span>
                          {l.skipped_count>0 && <span className="text-text-muted ml-1">跳{l.skipped_count}</span>}
                          {l.error_count>0 && <span className="text-red-500 ml-1">错{l.error_count}</span>}
                          {l.rule_failed_count>0 && <span className="text-amber-600 ml-1">规则拒{l.rule_failed_count}</span>}
                        </td>
                        <td className="px-3.5 py-2.5 text-xs text-text-muted">{l.import_duration_ms ? `${l.import_duration_ms}ms` : '—'}</td>
                        <td className="px-3.5 py-2.5 text-xs text-text-muted">{l.operator||'—'}</td>
                        <td className="px-3.5 py-2.5 text-xs text-text-muted">{l.created_at?.slice(0,16)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            }
          </div>
        </div>
      )}

      {/* 保存模板弹窗 */}
      <Modal open={saveOpen} title="保存列映射模板" onClose={() => setSaveOpen(false)} onConfirm={saveTemplate}>
        <div className="space-y-3">
          <div className="bg-primary-500/5 border border-primary-500/10 rounded-card p-3 text-xs text-primary">
            将保存 {confirmed} 列的映射关系。下次相同格式的 Excel 可直接复用此模板。
          </div>
          <div><label className="block text-xs text-text-muted mb-1">模板名称 *</label>
            <input value={saveForm.name} onChange={e=>setSaveForm(f=>({...f,name:e.target.value}))}
              placeholder="如：红星村粮食直补导入模板"
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500"/></div>
          <div className="grid grid-cols-3 gap-2">
            <div><label className="block text-xs text-text-muted mb-1">适用年度</label>
              <input value={saveForm.year} onChange={e=>setSaveForm(f=>({...f,year:e.target.value}))} placeholder="如2025"
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500"/></div>
            <div><label className="block text-xs text-text-muted mb-1">适用村组</label>
              <input value={saveForm.region} onChange={e=>setSaveForm(f=>({...f,region:e.target.value}))} placeholder="如红星村"
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500"/></div>
            <div><label className="block text-xs text-text-muted mb-1">业务类型</label>
              <select value={saveForm.btype} onChange={e=>setSaveForm(f=>({...f,btype:e.target.value}))}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none">
                <option value="SUBSIDY">补贴发放</option>
                <option value="FARMER">农户档案</option>
              </select></div>
          </div>
        </div>
      </Modal>

      <Toast {...toast}/>
    </div>
  )
}
