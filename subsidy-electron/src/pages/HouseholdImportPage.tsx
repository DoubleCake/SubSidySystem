/**
 * 家庭户批量导入 — 智能导入 + 预览 + 结果
 */
import { useState, useCallback, useEffect } from 'react'
import * as XLSX from 'xlsx'
import ExcelImportWithMapping from '../components/ExcelImportWithMapping'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import * as api from '../api'

const FIELDS = [
  { field: 'real_name',       label: '姓名', required: true,  type: 'string' },
  { field: 'id_card',         label: '身份证号', required: true,  type: 'id_card' },
  { field: 'head_relation',   label: '成员身份（户主/成员）', required: false, type: 'string' },
  { field: 'household_code',  label: '家庭户编码', required: false, type: 'string' },
  { field: 'village_name',    label: '所在村', required: false, type: 'string' },
  { field: 'group_no',        label: '所在组', required: false, type: 'string' },
  { field: 'address',         label: '家庭住址', required: false, type: 'string' },
  { field: 'phone',           label: '手机号', required: false, type: 'string' },
  { field: 'bank_card',       label: '银行卡号', required: false, type: 'string' },
  { field: 'bank_name',       label: '开户行', required: false, type: 'string' },
  { field: 'gender',          label: '性别', required: false, type: 'string' },
  { field: 'farmer_status',   label: '人员状态', required: false, type: 'string' },
]

const buildRows = (rows: Record<string, unknown>[]) =>
  rows.map(r => ({
    real_name: String(r.real_name || ''),
    id_card: String(r.id_card || ''),
    address: String(r.address || '未指定'),
    head_relation: String(r.head_relation || '') || undefined,
    phone: String(r.phone || '') || undefined,
    household_code: String(r.household_code || '') || undefined,
    village_name: String(r.village_name || '') || undefined,
    group_no: String(r.group_no || '') || undefined,
    gender: String(r.gender || '') || undefined,
    farmer_status: String(r.farmer_status || '') || undefined,
  }))

export default function HouseholdImportPage() {
  const { toast, show } = useToast()
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<any>(null)
  const [result, setResult] = useState<any>(null)
  const [defaultVillage, setDefaultVillage] = useState('')
  const [defaultGroup, setDefaultGroup] = useState('')
  const [villageList, setVillageList] = useState<string[]>([])

  useEffect(() => {
    api.getVillages().then(data => {
      setVillageList((data || []).map((v: any) => v.village_name).filter(Boolean))
    }).catch(() => {})
  }, [])

  const preCheck = useCallback(async (rows: Record<string, unknown>[], _mapping?: Record<string, string>) => {
    const importRows = buildRows(rows)
    const res = await api.previewHouseholdImport(importRows)
    setPreview(res)
    const conflicts = new Set((res.conflicts || []).map((c: any) => c.row - 1))
    const failed = (res.conflicts || []).map((c: any) => ({
      index: c.row - 1, real_name: c.real_name, id_card_masked: c.id_card,
      issues: [`已在「${c.db_name}」的家庭户中存在`],
    }))
    return { passed_rows: rows.map((_, i) => i).filter(i => !conflicts.has(i)), failed_rows: failed, warning_rows: [] }
  }, [])

  const handleImport = useCallback(async (rows: Record<string, unknown>[], _mapping?: Record<string, string>, _overwrite?: boolean) => {
    const importRows = buildRows(rows)
    const res = await api.executeHouseholdImport(importRows, defaultVillage.trim() || undefined, defaultGroup.trim() || undefined)
    setResult(res)
    show(`新建户 ${res.created_households} · 合并 ${res.merged_households} · 成员 ${res.created_farmers} · 跳过 ${res.skipped_farmers}`, 'ok')
    return { created: res.created_farmers || 0, skipped: res.skipped_farmers || 0, errors: res.errors || [] }
  }, [show, defaultVillage, defaultGroup])

  const detectColumns = useCallback(async (columns: string[]) => ({
    columns: columns.map(col => {
      const g = (cs: string[]) => columns.find(h => cs.some(c => h.includes(c))) || null
      const field =
        g(['姓名', '名字', '户主']) === col ? 'real_name' :
        g(['身份证', '证号']) === col ? 'id_card' :
        g(['关系', '户主', '称谓', '成员身份', '身份']) === col ? 'head_relation' :
        g(['编码', '户号', '户编码', '家庭编码', '家庭户ID']) === col ? 'household_code' :
        g(['村', '村庄', '所在村', '村名']) === col ? 'village_name' :
        g(['组', '所在组', '组名']) === col ? 'group_no' :
        g(['地址', '住址', '户籍']) === col ? 'address' :
        g(['电话', '手机', '联系']) === col ? 'phone' :
        g(['银行卡', '卡号']) === col ? 'bank_card' :
        g(['开户行', '银行名']) === col ? 'bank_name' :
        g(['性别', '男女']) === col ? 'gender' :
        g(['状态', '人员状态', '农户状态']) === col ? 'farmer_status' : null
      return { excel_column: col, suggested_field: field, confidence: field ? 0.9 : 0, alternatives: [] }
    }),
    recommended_templates: [],
  }), [])

  return (
    <div className="space-y-5">
      <Toast msg={toast?.msg} type={toast?.type} />

      {/* 标题 + 导入按钮 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">家庭户批量导入</h1>
          <p className="text-sm text-text-muted mt-0.5">智能识别表格列，自动匹配/合并数据库家庭户</p>
        </div>
        <button onClick={() => setOpen(true)}
          className="bg-green-500 text-white px-6 py-3 rounded-btn text-sm hover:bg-green-600 shadow-md transition-all font-bold text-base flex items-center gap-2">
          📥 导入家庭户
        </button>
      </div>

      {/* 预览区域 */}
      {preview && (
        <div className="bg-white rounded-card border border-border p-5 space-y-4">
          <h2 className="font-semibold text-text-primary">📊 导入数据预览</h2>
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: '总行数', v: preview.summary.total_rows },
              { label: '家庭户组', v: preview.summary.total_groups },
              { label: '新建户', v: preview.summary.new_households, c: 'text-primary' },
              { label: '并入已有', v: preview.summary.merge_single, c: 'text-blue-600' },
              { label: '需合并', v: preview.summary.merge_multi, c: 'text-amber-600' },
            ].map(({ label, v, c }) => (
              <div key={label} className="border border-border/50 rounded-card p-4 text-center">
                <div className={`text-2xl font-bold ${c || 'text-text-primary'}`}>{v}</div>
                <div className="text-xs text-text-muted mt-1">{label}</div>
              </div>
            ))}
          </div>

          {preview.conflicts?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-card p-4">
              <div className="flex justify-between mb-2">
                <span className="font-semibold text-amber-700 text-sm">⚠ 人员冲突（{preview.conflicts.length} 条）— 身份证号已存在</span>
                <button onClick={() => {
                  const hdr = ['行号', '姓名', '身份证', '导入村', '导入组', '电话', 'DB姓名', 'DB户ID']
                  const data = preview.conflicts.map((c: any) => hdr.reduce((o, k, i) => ({ ...o, [k]: [c.row, c.real_name, c.id_card, c.village_name, c.group_no, c.phone, c.db_name, c.db_household_id][i] }), {}))
                  const ws = XLSX.utils.json_to_sheet(data); ws['!cols'] = hdr.map(() => ({ wch: 16 }))
                  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '冲突')
                  XLSX.writeFile(wb, `人员冲突_${new Date().toISOString().slice(0, 10)}.xlsx`)
                }} className="text-xs bg-amber-200 text-amber-800 px-3 py-1.5 rounded-btn hover:bg-amber-300 font-medium">📥 导出冲突</button>
              </div>
              <div className="max-h-32 overflow-y-auto text-xs text-amber-700 space-y-0.5">
                {preview.conflicts.map((c: any, i: number) => <div key={i}>第{c.row}行: {c.real_name}（{c.id_card}）→ DB已有「{c.db_name}」</div>)}
              </div>
            </div>
          )}

          {/* 全局默认村组设置 */}
          <div className="bg-blue-50 border border-blue-200 rounded-card p-4">
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-sm font-semibold text-blue-700">🏘 全局默认村组</span>
              <span className="text-xs text-blue-600">Excel中未填村组的行将使用此默认值</span>
            </div>
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-text-muted">村：</span>
                <select value={defaultVillage} onChange={e => setDefaultVillage(e.target.value)}
                  className="border border-border rounded-btn px-3 py-1.5 text-sm bg-white outline-none min-w-[140px]">
                  <option value="">— 不指定 —</option>
                  {villageList.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-text-muted">组：</span>
                <input value={defaultGroup} onChange={e => setDefaultGroup(e.target.value)}
                  placeholder="如：一组 或 1"
                  className="border border-border rounded-btn px-3 py-1.5 text-sm outline-none w-32" />
              </div>
              {(defaultVillage || defaultGroup) && (
                <button onClick={() => { setDefaultVillage(''); setDefaultGroup('') }}
                  className="text-xs text-blue-500 hover:text-blue-700">清除</button>
              )}
            </div>
          </div>

          <div className="border border-border/50 rounded-btn overflow-hidden">
            <div className="px-4 py-2 bg-warm/30 text-xs font-semibold text-text-primary">分组明细（{preview.groups?.length || 0} 组）</div>
            <div className="divide-y divide-stone-100 max-h-48 overflow-y-auto">
              {(preview.groups || []).map((g: any, i: number) => {
                const al = g.action === 'create' ? '新建' : g.action === 'merge_one' ? '并入' : '合并多个户'
                const ac = g.action === 'create' ? 'bg-primary-500/10 text-primary' : g.action === 'merge_one' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'
                return (
                  <div key={i} className="px-4 py-2 flex items-center gap-3 text-sm">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ac}`}>{al}</span>
                    <span className="text-text-primary truncate flex-1">
                      {g.household_code && <span className="font-mono text-primary mr-2">{g.household_code}</span>}{g.address}
                    </span>
                    <span className="text-xs text-text-muted">{g.member_count}人 · 户主：{g.head_name}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* 结果展示区域 */}
      {result && (
        <div className="bg-white rounded-card border border-border p-5 space-y-4">
          <h2 className="font-semibold text-text-primary">✅ 导入结果</h2>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: '新建家庭户', v: result.created_households },
              { label: '合并/更新户', v: result.merged_households },
              { label: '新增成员', v: result.created_farmers },
              { label: '跳过成员', v: result.skipped_farmers },
            ].map(({ label, v }) => (
              <div key={label} className="border border-border/50 rounded-card p-4 text-center">
                <div className="text-2xl font-bold text-primary">{v}</div>
                <div className="text-xs text-text-muted mt-1">{label}</div>
              </div>
            ))}
          </div>
          {result.errors?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-card p-3 text-xs text-amber-700 max-h-32 overflow-y-auto">
              {result.errors.map((e: string, i: number) => <div key={i}>{e}</div>)}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => { setResult(null); setOpen(true) }} className="text-sm bg-primary-500 text-white px-4 py-2 rounded-btn">继续导入</button>
            <a href="/farmers" className="text-sm border border-border px-4 py-2 rounded-btn hover:bg-warm/30">前往户籍管理 →</a>
          </div>
        </div>
      )}

      {/* 智能导入弹窗 */}
      <ExcelImportWithMapping
        open={open} onClose={() => setOpen(false)}
        title="家庭户批量导入"
        templateHeaders={['姓名*', '身份证号*', '成员身份', '家庭户编码', '所在村', '所在组', '手机号', '家庭住址']}
        templateExample={[{ '姓名*': '张三', '身份证号*': '510123196503154231', '成员身份': '户主', '家庭户编码': 'HH0001', '所在村': '红星村', '所在组': '一组', '手机号': '13800000000', '家庭住址': '红星村一组' }]}
        systemFields={FIELDS}
        templates={[]} overwriteOption={false}
        onDetectColumns={detectColumns}
        onSaveTemplate={async () => ({ id: 0 })}
        onImport={handleImport}
        onSuccess={() => setOpen(false)}
        preCheck={preCheck}
      />
    </div>
  )
}
