/**
 * 家庭户批量导入页
 * 步骤：上传 Excel → 列映射 → 预览（分组/匹配结果）→ 确认执行
 */
import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import * as api from '../api'
import type { HouseholdImportRow, HouseholdImportPreview, HouseholdImportResult } from '../api'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'

// ── 工具 ──
const ACTION_LABEL: Record<string, { label: string; color: string }> = {
  create:      { label: '新建家庭户', color: 'bg-emerald-100 text-primary' },
  merge_one:   { label: '并入已有户', color: 'bg-blue-100 text-blue-700' },
  merge_multi: { label: '合并多个户', color: 'bg-amber-100 text-amber-700' },
}

// ── 组件 ──
export default function HouseholdImportPage() {
  const { toast, show } = useToast()

  // Excel 解析结果
  const [headers, setHeaders] = useState<string[]>([])
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  // 列映射
  const [colMap, setColMap] = useState({
    real_name:    '',
    id_card:      '',
    address:      '',
    head_relation: '',
    phone:        '',
    bank_card:    '',
    bank_name:    '',
    gender:       '',
  })

  // 步骤：1=上传, 2=列映射, 3=预览, 4=结果
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [preview, setPreview] = useState<HouseholdImportPreview | null>(null)
  const [result, setResult] = useState<HouseholdImportResult | null>(null)
  const [loading, setLoading] = useState(false)

  // 展开/折叠预览行
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set())

  // ── 读取 Excel ──
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const data = new Uint8Array(ev.target!.result as ArrayBuffer)
      const wb = XLSX.read(data, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const json = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '', raw: false })
      if (json.length === 0) { show('Excel 为空', 'err'); return }
      const hdrs = Object.keys(json[0])
      setHeaders(hdrs)
      setRawRows(json)
      // 自动猜测列映射
      const guess = (candidates: string[]) => hdrs.find(h => candidates.some(c => h.includes(c))) || ''
      setColMap({
        real_name:    guess(['姓名', '名字', '户主姓名']),
        id_card:      guess(['身份证', '证号', 'ID']),
        address:      guess(['地址', '住址', '户籍']),
        head_relation: guess(['关系', '户主', '称谓']),
        phone:        guess(['电话', '手机', '联系']),
        bank_card:    guess(['银行卡', '卡号']),
        bank_name:    guess(['开户行', '银行名']),
        gender:       guess(['性别', '男女']),
      })
      setStep(2)
    }
    reader.readAsArrayBuffer(file)
  }

  // ── 构建导入行 ──
  const buildRows = (): HouseholdImportRow[] =>
    rawRows.map(r => ({
      real_name:    (r[colMap.real_name] || '').trim(),
      id_card:      (r[colMap.id_card] || '').trim().toUpperCase(),
      address:      (r[colMap.address] || '').trim(),
      head_relation: colMap.head_relation ? (r[colMap.head_relation] || '').trim() : undefined,
      phone:        colMap.phone ? (r[colMap.phone] || '').trim() || undefined : undefined,
      bank_card:    colMap.bank_card ? (r[colMap.bank_card] || '').trim() || undefined : undefined,
      bank_name:    colMap.bank_name ? (r[colMap.bank_name] || '').trim() || undefined : undefined,
      gender:       colMap.gender ? (r[colMap.gender] || '').trim() || undefined : undefined,
    }))

  // ── 预览 ──
  const handlePreview = async () => {
    if (!colMap.real_name || !colMap.id_card || !colMap.address) {
      show('姓名、身份证号、家庭住址列为必填', 'err'); return
    }
    setLoading(true)
    try {
      const rows = buildRows()
      const res = await api.previewHouseholdImport(rows)
      setPreview(res)
      setStep(3)
    } catch (e: unknown) {
      show((e as Error).message, 'err')
    } finally {
      setLoading(false)
    }
  }

  // ── 执行导入 ──
  const handleExecute = async () => {
    setLoading(true)
    try {
      const rows = buildRows()
      const res = await api.executeHouseholdImport(rows)
      setResult(res)
      setStep(4)
    } catch (e: unknown) {
      show((e as Error).message, 'err')
    } finally {
      setLoading(false)
    }
  }

  const toggleGroup = (i: number) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  const resetAll = () => {
    setStep(1); setHeaders([]); setRawRows([]); setPreview(null); setResult(null)
    setExpandedGroups(new Set())
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── 步骤进度条 ──
  const STEPS = ['上传 Excel', '列映射', '预览结果', '导入完成']

  return (
    <div className="space-y-5">
      <Toast msg={toast?.msg} type={toast?.type} />

      {/* 标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">家庭户批量导入</h1>
          <p className="text-sm text-text-muted mt-0.5">
            按家庭住址聚合分组，自动匹配/合并数据库已有家庭户
          </p>
        </div>
        {step > 1 && (
          <button onClick={resetAll}
            className="text-sm text-text-muted bg-danger-200 hover:text-text-primary border border-border rounded-btn px-3 py-1.5">
            重新上传
          </button>
        )}
      </div>

      {/* 步骤条 */}
      <div className="flex items-center gap-0 bg-white rounded-card border border-border p-4">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-center flex-1">
            <div className={`flex items-center gap-2 ${i + 1 === step ? 'text-primary font-semibold' : i + 1 < step ? 'text-primary/70' : 'text-text-muted/50'}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                ${i + 1 === step ? 'bg-primary/90 ' : i + 1 < step ? 'bg-emerald-100 text-primary' : 'bg-warm/30 text-text-muted'}`}>
                {i + 1 < step ? '✓' : i + 1}
              </div>
              <span className="text-sm whitespace-nowrap">{s}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-3 ${i + 1 < step ? 'bg-emerald-200' : 'bg-warm/30'}`} />
            )}
          </div>
        ))}
      </div>

      {/* ── Step 1: 上传文件 ── */}
      {step === 1 && (
        <div className="bg-white rounded-card border border-border p-8 flex flex-col items-center gap-4">
          <div className="text-4xl">📂</div>
          <p className="text-text-primary text-sm">上传包含家庭户信息的 Excel 文件（.xlsx / .xls）</p>
          <p className="text-text-muted text-xs">必须包含：姓名、身份证号、家庭住址；建议包含：户主关系</p>
          <label className="cursor-pointer bg-primary/90  px-6 py-2 rounded-btn text-sm hover:bg-primary transition-colors">
            选择文件
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
          </label>
        </div>
      )}

      {/* ── Step 2: 列映射 ── */}
      {step === 2 && (
        <div className="bg-white rounded-card border border-border p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-text-primary">列映射配置</h2>
            <span className="text-xs text-text-muted">已读取 {rawRows.length} 行数据，{headers.length} 列</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {[
              { key: 'real_name',    label: '姓名', required: true },
              { key: 'id_card',      label: '身份证号', required: true },
              { key: 'address',      label: '家庭住址（分组依据）', required: true },
              { key: 'head_relation',label: '户主关系', required: false },
              { key: 'phone',        label: '手机号', required: false },
              { key: 'bank_card',    label: '银行卡号', required: false },
              { key: 'bank_name',    label: '开户行', required: false },
              { key: 'gender',       label: '性别', required: false },
            ].map(({ key, label, required }) => (
              <div key={key}>
                <label className="block text-sm text-text-primary mb-1">
                  {label} {required && <span className="text-red-500">*</span>}
                </label>
                <select
                  value={colMap[key as keyof typeof colMap]}
                  onChange={e => setColMap(prev => ({ ...prev, [key]: e.target.value }))}
                  className="w-full border border-border rounded-btn px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">
                  <option value="">— 不映射 —</option>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>

          {/* 数据预览 */}
          <div>
            <p className="text-xs text-text-muted mb-2">前 3 行预览：</p>
            <div className="overflow-x-auto border border-border/50 rounded-btn">
              <table className="text-xs w-full">
                <thead className="bg-warm/30">
                  <tr>{headers.map(h => <th key={h} className="px-3 py-2 text-left text-text-muted font-normal whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rawRows.slice(0, 3).map((r, i) => (
                    <tr key={i} className="border-t border-border/50">
                      {headers.map(h => <td key={h} className="px-3 py-1.5 text-text-primary whitespace-nowrap">{r[h]}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={handlePreview} disabled={loading}
              className="bg-primary/90  px-6 py-2 rounded-btn text-sm hover:bg-primary disabled:opacity-50 transition-colors">
              {loading ? '分析中…' : '预览导入结果 →'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: 预览 ── */}
      {step === 3 && preview && (
        <div className="space-y-4">
          {/* 汇总卡片 */}
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: '总行数', value: preview.summary.total_rows, color: 'text-text-primary' },
              { label: '家庭户组', value: preview.summary.total_groups, color: 'text-text-primary' },
              { label: '新建', value: preview.summary.new_households, color: 'text-primary' },
              { label: '并入已有', value: preview.summary.merge_single, color: 'text-blue-600' },
              { label: '需合并', value: preview.summary.merge_multi, color: 'text-amber-600' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white rounded-card border border-border p-4 text-center">
                <div className={`text-2xl font-bold ${color}`}>{value}</div>
                <div className="text-xs text-text-muted mt-1">{label}</div>
              </div>
            ))}
          </div>

          {/* 行级错误 */}
          {preview.row_errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-card p-4">
              <p className="text-sm font-semibold text-red-700 mb-2">格式错误行（已排除，不会导入）</p>
              <ul className="text-xs text-red-600 space-y-1">
                {preview.row_errors.map((e, i) => (
                  <li key={i}>第 {e.row} 行「{e.name}」: {e.errors.join('；')}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 家庭户列表 */}
          <div className="bg-white rounded-card border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
              <span className="font-semibold text-text-primary text-sm">
                家庭户分组预览（{preview.groups.length} 组）
              </span>
              <div className="flex gap-2">
                <button onClick={() => setExpandedGroups(new Set(preview.groups.map((_, i) => i)))}
                  className="text-xs text-primary hover:underline">全部展开</button>
                <button onClick={() => setExpandedGroups(new Set())}
                  className="text-xs text-text-muted hover:underline">全部折叠</button>
              </div>
            </div>

            <div className="divide-y divide-stone-100">
              {preview.groups.map((g, i) => {
                const expanded = expandedGroups.has(i)
                const ac = ACTION_LABEL[g.action]
                return (
                  <div key={i} className={g.has_errors ? 'bg-red-50' : ''}>
                    {/* 行摘要 */}
                    <div
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-warm/30"
                      onClick={() => toggleGroup(i)}>
                      <span className="text-text-muted text-xs w-4">{expanded ? '▾' : '▸'}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ac.color}`}>{ac.label}</span>
                      <span className="text-sm text-text-primary flex-1 truncate">{g.address}</span>
                      <span className="text-xs text-text-muted">{g.member_count} 人</span>
                      <span className="text-xs text-text-muted">户主：{g.head_name}</span>
                      {g.target_village_name && (
                        <span className="text-xs text-blue-500">{g.target_village_name}{g.target_group_display}</span>
                      )}
                      {!g.target_village_name && (
                        <span className="text-xs text-amber-500">村组待分配</span>
                      )}
                      {g.warnings.length > 0 && <span className="text-amber-500 text-xs">⚠ {g.warnings.length}</span>}
                    </div>

                    {/* 展开详情 */}
                    {expanded && (
                      <div className="px-10 pb-3 space-y-3">
                        {/* 警告 */}
                        {g.warnings.map((w, wi) => (
                          <div key={wi} className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-1">{w}</div>
                        ))}

                        {/* 匹配到的已有家庭户 */}
                        {g.matched_hh_info.length > 0 && (
                          <div>
                            <p className="text-xs text-text-muted mb-1">匹配到的已有家庭户：</p>
                            <div className="flex flex-wrap gap-2">
                              {g.matched_hh_info.map(hh => (
                                <span key={hh.id} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                                  {hh.household_code} {hh.household_name}
                                  （{hh.village_name}{hh.group_display}
                                  {hh.contract_area != null ? `，${hh.contract_area}亩` : ''}）
                                </span>
                              ))}
                            </div>
                            {g.total_area_after_merge != null && (
                              <p className="text-xs text-text-muted mt-1">合并后承包面积（均值）：<b className="text-text-primary">{g.total_area_after_merge} 亩</b></p>
                            )}
                          </div>
                        )}

                        {/* 成员列表 */}
                        <table className="text-xs w-full">
                          <thead>
                            <tr className="text-text-muted">
                              <th className="text-left py-1 font-normal">姓名</th>
                              <th className="text-left py-1 font-normal">身份证号</th>
                              <th className="text-left py-1 font-normal">角色</th>
                              <th className="text-left py-1 font-normal">DB状态</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.members.map((m, mi) => (
                              <tr key={mi} className={m.has_errors ? 'text-red-500' : 'text-text-primary'}>
                                <td className="py-0.5">{m.real_name}</td>
                                <td className="py-0.5 font-mono">{m.id_card.slice(0, 6)}****{m.id_card.slice(-4)}</td>
                                <td className="py-0.5">{m.is_head ? <span className="text-primary font-medium">户主</span> : '成员'}</td>
                                <td className="py-0.5">{m.in_db ? <span className="text-blue-500">已存在（跳过）</span> : <span className="text-primary/70">新增</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-between items-center">
            <button onClick={() => setStep(2)}
              className="text-sm text-text-muted border border-border rounded-btn px-4 py-2 hover:text-text-primary">
              ← 返回列映射
            </button>
            <button onClick={handleExecute} disabled={loading}
              className="bg-primary/90  px-8 py-2 rounded-btn text-sm hover:bg-primary disabled:opacity-50 transition-colors font-medium">
              {loading ? '导入中…' : '确认导入'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: 结果 ── */}
      {step === 4 && result && (
        <div className="bg-white rounded-card border border-border p-8 space-y-6">
          <div className="text-center">
            <div className="text-4xl mb-2">✅</div>
            <h2 className="font-bold text-text-primary text-lg">导入完成</h2>
          </div>

          <div className="grid grid-cols-4 gap-4">
            {[
              { label: '新建家庭户', value: result.created_households, color: 'text-primary' },
              { label: '合并/更新户', value: result.merged_households, color: 'text-blue-600' },
              { label: '新增成员', value: result.created_farmers, color: 'text-primary' },
              { label: '跳过成员', value: result.skipped_farmers, color: 'text-text-muted' },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center border border-border/50 rounded-card p-4">
                <div className={`text-3xl font-bold ${color}`}>{value}</div>
                <div className="text-xs text-text-muted mt-1">{label}</div>
              </div>
            ))}
          </div>

          {result.errors.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-card p-4">
              <p className="text-sm font-semibold text-amber-700 mb-2">部分记录未导入（{result.errors.length} 条）</p>
              <ul className="text-xs text-amber-600 space-y-1 max-h-40 overflow-y-auto">
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          <div className="flex justify-center gap-3">
            <button onClick={resetAll}
              className="border border-border text-text-primary px-6 py-2 rounded-btn text-sm hover:bg-warm/30">
              继续导入
            </button>
            <a href="/farmers"
              className="bg-primary/90  px-6 py-2 rounded-btn text-sm hover:bg-primary">
              前往户籍管理查看
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
