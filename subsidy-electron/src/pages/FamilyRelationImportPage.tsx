/**
 * 家庭关系导入页
 * 功能：
 * 1. 上传Excel，根据身份证号匹配农户，更新relation字段
 * 2. 对指定村庄执行多户主家庭拆分
 */
import { useState, useRef, useEffect } from 'react'
import * as XLSX from 'xlsx'
import * as api from '../api'
import type { FamilyRelationRow } from '../api'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'

export default function FamilyRelationImportPage() {
  const { toast, show } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<api.ImportFamilyRelationsResult | null>(null)
  const [previewRows, setPreviewRows] = useState<FamilyRelationRow[]>([])
  const [headers, setHeaders] = useState<string[]>([])

  // 村庄多选
  const [villages, setVillages] = useState<string[]>([])
  const [selectedVillages, setSelectedVillages] = useState<Set<string>>(new Set())
  const [villageLoading, setVillageLoading] = useState(false)

  // 加载村庄列表
  useEffect(() => {
    api.getVillageGroups().then(groups => {
      // 提取唯一村名
      const unique = [...new Set(groups.map(g => g.village_name))].sort()
      setVillages(unique)
    }).catch(() => {
      show('加载村庄列表失败', 'err')
    })
  }, [])

  // 切换村庄选择
  const toggleVillage = (v: string) => {
    const next = new Set(selectedVillages)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    setSelectedVillages(next)
  }

  // 全选/取消全选
  const selectAll = (select: boolean) => {
    if (select) setSelectedVillages(new Set(villages))
    else setSelectedVillages(new Set())
  }

  // 读取Excel文件
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (ev) => {
      const data = new Uint8Array(ev.target!.result as ArrayBuffer)
      const wb = XLSX.read(data, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const json = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '', raw: false })
      if (json.length === 0) { show('Excel为空', 'err'); return }

      const hdrs = Object.keys(json[0])
      setHeaders(hdrs)

      // 自动匹配列
      const findCol = (candidates: string[]) =>
        hdrs.find(h => candidates.some(c => h.includes(c))) || ''

      const nameCol = findCol(['姓名', '名字'])
      const idCardCol = findCol(['身份证号', '身份证', '证件号'])
      const relationCol = findCol(['与户主关系', '关系', '称谓'])
      const ageCol = findCol(['年龄'])
      const addressCol = findCol(['地址', '住址', '家庭住址'])

      if (!nameCol || !idCardCol || !relationCol) {
        const info = `未找到必要的列。\n实际列名: ${hdrs.join(', ')}\n匹配: 姓名=${nameCol}, 身份证=${idCardCol}, 关系=${relationCol}`
        show(info, 'err')
        return
      }

      const rows: FamilyRelationRow[] = json.map((r, idx) => ({
        row_index: idx + 2, // Excel行号从2开始（1是表头）
        real_name: (r[nameCol] || '').trim(),
        id_card: (r[idCardCol] || '').trim().toUpperCase(),
        relation: (r[relationCol] || '').trim(),
        age: ageCol ? parseInt(r[ageCol]) || undefined : undefined,
        address: addressCol ? (r[addressCol] || '').trim() : undefined,
      }))

      setPreviewRows(rows)
      show(`已解析 ${rows.length} 行数据`, 'ok')
    }
    reader.readAsArrayBuffer(file)
  }

  // 执行导入
  const handleImport = async () => {
    if (previewRows.length === 0) {
      show('请先上传Excel文件', 'err')
      return
    }

    setLoading(true)
    try {
      const splitVillages = selectedVillages.size > 0 ? Array.from(selectedVillages) : undefined
      const res = await api.importFamilyRelations(previewRows, splitVillages)
      setResult(res)

      if (res.stage1_updated > 0) {
        show(`成功更新 ${res.stage1_updated} 条关系记录`, 'ok')
      }
      if (res.stage1_not_found.length > 0) {
        show(`有 ${res.stage1_not_found.length} 条记录未找到匹配农户`, 'err')
      }
      if (res.stage2_split) {
        show(`拆分完成：新建 ${res.stage2_split.created_households} 个家庭户，移动 ${res.stage2_split.migrated_members} 人`, 'ok')
      }
    } catch (err: any) {
      show(err.message || '导入失败', 'err')
    } finally {
      setLoading(false)
    }
  }

  // 预览多户主家庭
  const [multiHeadPreview, setMultiHeadPreview] = useState<api.MultiHeadHouseholdInfo[]>([])
  const handlePreviewSplit = async () => {
    if (selectedVillages.size === 0) {
      show('请选择要预览的村庄', 'err')
      return
    }

    if (previewRows.length === 0) {
      show('请先上传Excel文件', 'err')
      return
    }

    setVillageLoading(true)
    try {
      const res = await api.previewMultiHeadHouseholds(Array.from(selectedVillages), previewRows)
      setMultiHeadPreview(res.households)
      if (res.households.length === 0) {
        show('这些村庄在Excel中没有发现多户主家庭（或Excel中只有1个户主标记）', 'ok')
      }
    } catch (err: any) {
      show(err.message || '预览失败', 'err')
    } finally {
      setVillageLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">家庭关系导入</h1>

      <div className="bg-white rounded-btn shadow p-6 space-y-6">
        {/* 文件上传 */}
        <div>
          <label className="block text-sm font-medium mb-2">上传Excel文件</label>
          <input
            type="file"
            ref={fileRef}
            accept=".xlsx,.xls"
            onChange={handleFile}
            className="block w-full text-sm border rounded p-2"
          />
          <p className="text-xs text-gray-500 mt-1">
            Excel表头需包含：姓名、身份证号、与户主关系（可选：年龄、地址）
          </p>
        </div>

        {/* 村庄选择（多选框） */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium">
              选择村庄（用于多户主拆分，不选则只更新关系不拆分）
            </label>
            <div className="flex gap-2 text-xs">
              <button onClick={() => selectAll(true)} className="text-blue-600 hover:underline">全选</button>
              <span className="text-gray-400">|</span>
              <button onClick={() => selectAll(false)} className="text-blue-600 hover:underline">取消全选</button>
            </div>
          </div>
          <div className="border rounded p-3 max-h-48 overflow-y-auto">
            {villages.length === 0 ? (
              <div className="text-sm text-gray-400">加载中...</div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {villages.map(v => (
                  <label key={v} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 rounded px-2 py-1">
                    <input
                      type="checkbox"
                      checked={selectedVillages.has(v)}
                      onChange={() => toggleVillage(v)}
                      className="rounded"
                    />
                    <span>{v}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          {selectedVillages.size > 0 && (
            <div className="text-xs text-gray-500 mt-1">已选择 {selectedVillages.size} 个村庄</div>
          )}
        </div>

        {/* 预览数据 */}
        {previewRows.length > 0 && (
          <div>
            <h3 className="font-medium mb-2">预览数据（前10行）</h3>
            <div className="overflow-x-auto border rounded">
              <table className="text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">行号</th>
                    <th className="px-3 py-2 text-left">姓名</th>
                    <th className="px-3 py-2 text-left">身份证号</th>
                    <th className="px-3 py-2 text-left">与户主关系</th>
                    <th className="px-3 py-2 text-left">年龄</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.slice(0, 10).map(row => (
                    <tr key={row.row_index} className="border-t">
                      <td className="px-3 py-2">{row.row_index}</td>
                      <td className="px-3 py-2">{row.real_name}</td>
                      <td className="px-3 py-2">{row.id_card ? row.id_card.slice(0, 6) + '***' : '-'}</td>
                      <td className="px-3 py-2">{row.relation}</td>
                      <td className="px-3 py-2">{row.age || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500 mt-1">共 {previewRows.length} 行</p>
          </div>
        )}

        {/* 预览多户主家庭 */}
        <div className="flex gap-2">
          <button
            onClick={handlePreviewSplit}
            disabled={villageLoading || selectedVillages.size === 0}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm disabled:opacity-50"
          >
            {villageLoading ? '加载中...' : '预览多户主家庭'}
          </button>
        </div>

        {/* 多户主家庭预览 */}
        {multiHeadPreview.length > 0 && (
          <div>
            <h3 className="font-medium mb-2 text-amber-600">发现 {multiHeadPreview.length} 个多户主家庭（将执行拆分）</h3>
            <div className="space-y-3">
              {multiHeadPreview.map(hh => (
                <div key={hh.household_id} className="border rounded p-3 bg-amber-50">
                  <div className="font-medium">{hh.household_name} (ID:{hh.household_id})</div>
                  <div className="text-sm text-gray-600">{hh.village_name} - {hh.head_count}个户主</div>
                  <div className="text-sm mt-1">
                    户主：{hh.heads.map(h => h.real_name).join(', ')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 执行按钮 */}
        <div className="flex gap-3">
          <button
            onClick={handleImport}
            disabled={loading || previewRows.length === 0}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
          >
            {loading ? '导入中...' : '执行导入'}
          </button>
        </div>

        {/* 结果 */}
        {result && (
          <div className="mt-6 p-4 bg-gray-50 rounded space-y-3">
            <h3 className="font-medium">导入结果</h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-primary/5 p-3 rounded">
                <div className="text-2xl font-bold text-primary">{result.stage1_updated}</div>
                <div className="text-sm text-gray-600">成功更新记录</div>
              </div>
              <div className="bg-amber-50 p-3 rounded">
                <div className="text-2xl font-bold text-amber-700">{result.stage1_not_found.length}</div>
                <div className="text-sm text-gray-600">未匹配到农户</div>
              </div>
            </div>

            {result.stage1_not_found.length > 0 && (
              <div>
                <div className="text-sm font-medium">未找到的记录：</div>
                <ul className="text-xs text-gray-600 max-h-32 overflow-y-auto">
                  {result.stage1_not_found.slice(0, 20).map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                  {result.stage1_not_found.length > 20 && (
                    <li>...还有 {result.stage1_not_found.length - 20} 条</li>
                  )}
                </ul>
              </div>
            )}

            {result.stage2_split && (
              <div className="bg-blue-50 p-3 rounded">
                <div className="font-medium text-blue-700">多户主拆分结果</div>
                <div className="text-sm mt-1">
                  拆分家庭数：{result.stage2_split.split_count}，
                  新建家庭户：{result.stage2_split.created_households}，
                  迁移人数：{result.stage2_split.migrated_members}
                </div>
                {result.stage2_split.details.length > 0 && (
                  <ul className="text-xs mt-2 space-y-1">
                    {result.stage2_split.details.map((d, i) => (
                      <li key={i}>
                        {d.原家庭} → {d.新家庭}（{d.新户主}，移动{d.迁移人数}人）
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <Toast {...toast} />
    </div>
  )
}