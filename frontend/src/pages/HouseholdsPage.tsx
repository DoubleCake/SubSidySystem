/**
 * 家庭户管理页 — 含批量组建 Excel 导入
 */
import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import Tag from '../components/Tag'
import Modal from '../components/Modal'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'

interface HH {
  id: number; household_code: string; household_name: string
  village_full_name: string; land_area: string | null
  contracted_area: number; used_area: number; remaining_area: number
  is_overdrawn: boolean; member_count: number; status: number
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!r.ok) { const e = await r.json().catch(()=>({})) as {detail?:string}; throw new Error(e.detail||'请求失败') }
  return r.json() as Promise<T>
}

const STATUS_MAP: Record<number,{label:string;color:'green'|'amber'|'red'|'gray'}> = {
  1:{label:'正常',color:'green'}, 2:{label:'注销',color:'red'},
  3:{label:'迁出',color:'amber'}, 4:{label:'冻结',color:'gray'},
}

export default function HouseholdsPage() {
  const { toast, show } = useToast()
  const [list, setList] = useState<HH[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear())
  const [overdrawnOnly, setOverdrawnOnly] = useState(false)
  const [buildOpen, setBuildOpen] = useState(false)
  const [buildFile, setBuildFile] = useState<File|null>(null)
  const [buildPreview, setBuildPreview] = useState<Record<string,unknown>[]>([])
  const [buildResult, setBuildResult] = useState<{built:number;updated:number;errors:string[];total_groups:number}|null>(null)
  const [buildLoading, setBuildLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ page: String(page), page_size: '20', year: String(yearFilter) })
      if (search)       p.set('search', search)
      if (overdrawnOnly) p.set('overdrawn_only', '1')
      const r = await req<{ total: number; items: HH[] }>(`/api/households?${p}`)
      setList(r.items); setTotal(r.total)
    } finally { setLoading(false) }
  }, [page, search, yearFilter, overdrawnOnly])

  useEffect(() => { load() }, [load])

  // ── Excel 家庭户组建模板下载 ──
  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['家庭户编号*', '身份证号*', '姓名（可选，仅供核对）', '是否户主*', '与户主关系', '土地面积(亩，户主行填写)'],
      ['HH001', '510123196503154231', '张国强', '1', '本人', '3.5'],
      ['HH001', '510123197808224567', '李秀英', '0', '妻子', ''],
      ['HH001', '510123200212153456', '张小明', '0', '儿子', ''],
      ['HH002', '510123197012185678', '王建国', '1', '本人', '2.8'],
      ['HH002', '510123197305224321', '陈凤英', '0', '妻子', ''],
    ])
    ws['!cols'] = [14,20,14,10,12,16].map(w=>({wch:w}))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '家庭户组建模板')
    XLSX.writeFile(wb, '家庭户组建模板.xlsx')
  }

  // ── 解析 Excel ──
  const handleFileChange = (file: File) => {
    setBuildFile(file); setBuildResult(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const wb = XLSX.read(e.target?.result, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string,unknown>[]
      setBuildPreview(rows.slice(0, 5))
    }
    reader.readAsArrayBuffer(file)
  }

  // ── 提交组建 ──
  const submitBuild = async () => {
    if (!buildFile) return show('请先上传 Excel 文件', 'err')
    setBuildLoading(true)
    try {
      const reader = new FileReader()
      reader.onload = async (e) => {
        const wb = XLSX.read(e.target?.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string,unknown>[]

        const rows = raw.map(r => ({
          household_id: String(r['家庭户编号*'] || r['家庭户编号'] || '').trim(),
          id_card:      String(r['身份证号*']   || r['身份证号']   || '').trim(),
          real_name:    String(r['姓名（可选，仅供核对）'] || r['姓名'] || '').trim() || undefined,
          is_head:      Number(r['是否户主*'] || r['是否户主'] || 0),
          relation:     String(r['与户主关系'] || '成员').trim() || '成员',
          land_area:    Number(r['土地面积(亩，户主行填写)'] || r['土地面积'] || 0) || undefined,
        })).filter(r => r.household_id && r.id_card)

        const res = await req<{built:number;updated:number;errors:string[];total_groups:number}>(
          '/api/households/batch-build', { method:'POST', body: JSON.stringify({ rows }) }
        )
        setBuildResult(res)
        if (res.built + res.updated > 0) { show(`✓ 组建 ${res.built} 个，更新 ${res.updated} 个`); load() }
        else show('没有成功组建任何家庭户，请查看错误信息', 'err')
        setBuildLoading(false)
      }
      reader.readAsArrayBuffer(buildFile)
    } catch (e: unknown) { show((e as Error).message, 'err'); setBuildLoading(false) }
  }

  return (
    <div>
      {/* 工具栏 */}
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索家庭户…"
          className="border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400 bg-white w-52" />
        <select value={yearFilter} onChange={e => setYearFilter(Number(e.target.value))}
          className="border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
          {Array.from({length:6},(_,i)=>new Date().getFullYear()-i).map(y=><option key={y} value={y}>{y}年</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-stone-600 cursor-pointer">
          <input type="checkbox" checked={overdrawnOnly} onChange={e=>setOverdrawnOnly(e.target.checked)} />
          仅看超领
        </label>
        <span className="text-xs text-stone-400">共 {total} 户</span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => { setBuildOpen(true); setBuildFile(null); setBuildPreview([]); setBuildResult(null) }}
            className="px-3 py-2 text-sm border border-emerald-200 text-emerald-700 rounded-lg hover:bg-emerald-50">
            🏠 批量组建家庭户
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full border-collapse">
          <thead><tr className="bg-stone-50 border-b-2 border-stone-200">
            {['户编码','户名','所在位置','成员','承包面积','已用面积','剩余','状态'].map(h=>(
              <th key={h} className="px-3.5 py-2.5 text-left text-xs text-stone-400 font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="text-center py-12 text-stone-300">加载中…</td></tr>}
            {!loading && list.length===0 && <tr><td colSpan={8} className="text-center py-12 text-stone-300 text-sm">暂无数据</td></tr>}
            {list.map(h=>(
              <tr key={h.id} className="border-b border-stone-50 hover:bg-stone-50">
                <td className="px-3.5 py-2.5 text-xs font-mono text-blue-600">{h.household_code}</td>
                <td className="px-3.5 py-2.5 text-sm font-semibold">{h.household_name}</td>
                <td className="px-3.5 py-2.5 text-xs text-stone-500">{h.village_full_name}</td>
                <td className="px-3.5 py-2.5 text-sm">{h.member_count}人</td>
                <td className="px-3.5 py-2.5 text-sm font-mono">{h.contracted_area>0?`${h.contracted_area}亩`:'—'}</td>
                <td className="px-3.5 py-2.5 text-sm font-mono">{h.used_area>0?`${h.used_area}亩`:'—'}</td>
                <td className="px-3.5 py-2.5 text-sm font-mono">
                  {h.is_overdrawn
                    ? <span className="text-red-600 font-bold">超 {(h.used_area-h.contracted_area).toFixed(2)}亩</span>
                    : h.remaining_area>0?`${h.remaining_area.toFixed(2)}亩`:'—'}
                </td>
                <td className="px-3.5 py-2.5">
                  <Tag label={STATUS_MAP[h.status]?.label||'正常'} color={STATUS_MAP[h.status]?.color||'green'} />
                  {h.is_overdrawn && <span className="ml-1 text-xs text-red-500">⚠️</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-2 border-t border-stone-100 bg-stone-50/50 flex justify-between text-xs text-stone-400">
          <span>共{total}条</span>
          <div className="flex gap-1">
            <button disabled={page<=1} onClick={()=>setPage(p=>p-1)} className="px-2.5 py-1 border border-stone-200 rounded disabled:opacity-40">‹</button>
            <span className="px-2">{page}/{Math.max(1,Math.ceil(total/20))}</span>
            <button disabled={page*20>=total} onClick={()=>setPage(p=>p+1)} className="px-2.5 py-1 border border-stone-200 rounded disabled:opacity-40">›</button>
          </div>
        </div>
      </div>

      {/* 批量组建弹窗 */}
      <Modal open={buildOpen} title="批量组建家庭户" onClose={()=>setBuildOpen(false)}
        onConfirm={buildResult?undefined:submitBuild} confirmText={buildLoading?'处理中…':'开始组建'}>
        <div className="space-y-4">
          {!buildResult ? (
            <>
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-700">
                <p className="font-semibold mb-2">📋 使用步骤</p>
                <ol className="list-decimal ml-4 space-y-1 text-xs">
                  <li>下载模板，按格式填写：每行一人，同一家庭户填相同的「家庭户编号」</li>
                  <li>is_head=1 表示户主，每个家庭户只能有一个户主</li>
                  <li>土地面积只需在户主那行填写</li>
                  <li>上传填好的 Excel，系统自动按身份证号匹配已有农户并完成组建</li>
                </ol>
              </div>
              <button onClick={downloadTemplate}
                className="w-full py-2.5 border-2 border-dashed border-emerald-300 text-emerald-700 rounded-xl text-sm hover:bg-emerald-50 flex items-center justify-center gap-2">
                ⬇️ 下载家庭户组建模板 (.xlsx)
              </button>
              <div>
                <label className="block text-xs text-stone-400 mb-1">上传填写好的 Excel *</label>
                <input type="file" accept=".xlsx,.xls"
                  onChange={e => { if(e.target.files?.[0]) handleFileChange(e.target.files[0]) }}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              {buildPreview.length>0&&(
                <div>
                  <p className="text-xs text-stone-400 mb-1">预览（前{buildPreview.length}行）</p>
                  <div className="overflow-x-auto rounded-lg border border-stone-200">
                    <table className="text-xs w-full border-collapse">
                      <thead><tr className="bg-stone-50">{Object.keys(buildPreview[0]).map(k=>(
                        <th key={k} className="px-2 py-1.5 text-left text-stone-400 whitespace-nowrap border-b border-stone-200">{k}</th>
                      ))}</tr></thead>
                      <tbody>{buildPreview.map((r,i)=>(
                        <tr key={i} className="border-b border-stone-100">{Object.values(r).map((v,j)=>(
                          <td key={j} className="px-2 py-1.5 text-stone-600 whitespace-nowrap">{String(v)}</td>
                        ))}</tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3 text-center">
                {[
                  { label:'识别家庭户', val:buildResult.total_groups, color:'text-blue-600' },
                  { label:'成功组建',   val:buildResult.built,        color:'text-emerald-700' },
                  { label:'更新已有',   val:buildResult.updated,      color:'text-amber-600' },
                ].map(s=>(
                  <div key={s.label} className="bg-stone-50 rounded-xl p-3">
                    <div className={`text-2xl font-bold font-mono ${s.color}`}>{s.val}</div>
                    <div className="text-xs text-stone-400 mt-1">{s.label}</div>
                  </div>
                ))}
              </div>
              {buildResult.errors.length>0&&(
                <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                  <p className="text-xs font-semibold text-red-700 mb-2">⚠️ {buildResult.errors.length} 条错误：</p>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {buildResult.errors.map((e,i)=>(
                      <p key={i} className="text-xs text-red-600">{e}</p>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={()=>{ setBuildResult(null); setBuildFile(null); setBuildPreview([]) }}
                className="w-full py-2 border border-stone-200 text-stone-500 rounded-lg text-sm hover:bg-stone-50">
                重新上传
              </button>
            </div>
          )}
        </div>
      </Modal>

      <Toast {...toast} />
    </div>
  )
}
