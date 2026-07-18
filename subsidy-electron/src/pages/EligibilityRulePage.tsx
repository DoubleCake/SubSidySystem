/**
 * 补贴资格规则配置页（嵌入补贴项目页的侧边面板，也可独立访问）
 * 展示某个补贴项目的所有资格规则，支持新增/编辑/删除
 */
import { useState, useEffect, useCallback } from 'react'
import Modal from '../components/Modal'
import Tag from '../components/Tag'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import * as api from '../api'

interface Rule {
  id: number; subsidy_type_id: number; rule_name: string; rule_desc: string | null
  require_farmer_status: number | null
  require_age_min: number | null; require_age_max: number | null
  require_land_type: string | null
  require_min_area: number | null; require_max_area: number | null
  require_not_idle: number; require_contract_valid: number
  can_combine_with_others: number; exclusive_with: number[]
  is_active: number
}

interface RuleTemplate {
  name: string; desc: string
  preset: Partial<Rule>
}

interface Props {
  subsidyTypeId: number
  subsidyName: string
}

const FARMER_STATUS_OPTS = [
  { val: 1, label: '在册' }, { val: 2, label: '注销' },
  { val: 3, label: '迁出' }, { val: 4, label: '死亡' },
]

const LAND_TYPE_OPTS = [
  { val: 'PADDY', label: '水田' }, { val: 'DRY', label: '旱地' },
  { val: 'GARDEN', label: '园地' }, { val: 'POND', label: '鱼塘' },
]

const emptyForm = (): Partial<Rule> => ({
  rule_name: '', rule_desc: '',
  require_farmer_status: 1,
  require_age_min: null, require_age_max: null,
  require_land_type: null,
  require_min_area: null, require_max_area: null,
  require_not_idle: 0, require_contract_valid: 0,
  can_combine_with_others: 1, exclusive_with: [],
})

export default function EligibilityRulePage({ subsidyTypeId, subsidyName }: Props) {
  const { toast, show } = useToast()
  const [rules, setRules] = useState<Rule[]>([])
  const [templates, setTemplates] = useState<RuleTemplate[]>([])
  const [editOpen, setEditOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Rule | null>(null)
  const [form, setForm] = useState<Partial<Rule>>(emptyForm())
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [r, t] = await Promise.all([
        api.getEligibilityRules(subsidyTypeId),
        api.getEligibilityRuleTemplates(),
      ])
      setRules(r); setTemplates(t)
    } finally { setLoading(false) }
  }, [subsidyTypeId])

  useEffect(() => { load() }, [load])

  const openAdd = (preset?: Partial<Rule>) => {
    setEditTarget(null)
    setForm({ ...emptyForm(), ...preset, subsidy_type_id: subsidyTypeId })
    setEditOpen(true)
  }

  const openEdit = (r: Rule) => {
    setEditTarget(r); setForm({ ...r }); setEditOpen(true)
  }

  const submit = async () => {
    if (!form.rule_name?.trim()) return show('请填写规则名称', 'err')
    try {
      const payload = { ...form, subsidy_type_id: subsidyTypeId }
      if (editTarget) {
        await api.updateEligibilityRule(editTarget.id, payload)
        show('✓ 规则已更新')
      } else {
        await api.createEligibilityRule(payload)
        show('✓ 规则已创建')
      }
      setEditOpen(false); load()
    } catch (e: unknown) { show((e as Error).message, 'err') }
  }

  const del = async (id: number) => {
    if (!confirm('确认删除此规则？')) return
    await api.deleteEligibilityRule(id)
    show('✓ 已删除'); load()
  }

  const sf = (field: keyof Rule, val: unknown) => setForm(f => ({ ...f, [field]: val }))

  const ruleDesc = (r: Rule): string[] => {
    const lines: string[] = []
    if (r.require_farmer_status !== null)
      lines.push(`农户状态：${FARMER_STATUS_OPTS.find(o => o.val === r.require_farmer_status)?.label ?? r.require_farmer_status}`)
    if (r.require_age_min || r.require_age_max)
      lines.push(`年龄：${r.require_age_min ?? '不限'}～${r.require_age_max ?? '不限'} 岁`)
    if (r.require_land_type)
      lines.push(`地块类型：${LAND_TYPE_OPTS.find(o => o.val === r.require_land_type)?.label ?? r.require_land_type}`)
    if (r.require_min_area || r.require_max_area)
      lines.push(`面积：${r.require_min_area ?? '不限'}～${r.require_max_area ?? '不限'} 亩`)
    if (r.require_not_idle) lines.push('要求土地未撂荒')
    if (r.require_contract_valid) lines.push('要求承包合同在有效期内')
    if (!r.can_combine_with_others) lines.push('不可与其他补贴叠加')
    return lines
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-text-primary">资格规则配置</h3>
          <p className="text-xs text-text-muted mt-0.5">「{subsidyName}」的发放资格条件，导入时自动校验</p>
        </div>
        <button onClick={() => openAdd()}
          className="px-3 py-1.5 text-sm bg-primary-500  rounded-btn hover:bg-primary-500/90">
          ＋ 新增规则
        </button>
      </div>

      {/* 快速模板 */}
      {rules.length === 0 && !loading && (
        <div className="mb-4">
          <p className="text-xs text-text-muted mb-2">📌 快速添加常用规则：</p>
          <div className="flex flex-wrap gap-2">
            {templates.map(t => (
              <button key={t.name} onClick={() => openAdd(t.preset)}
                className="text-xs border border-primary-500/20 text-primary px-3 py-1.5 rounded-btn hover:bg-primary-500/5">
                + {t.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 规则列表 */}
      {loading && <div className="py-8 text-center text-text-muted/50 text-sm">加载中…</div>}
      {!loading && rules.length === 0 && (
        <div className="py-10 text-center bg-warm/30 border border-dashed border-border rounded-card">
          <div className="text-3xl mb-2">📋</div>
          <p className="text-sm text-text-muted mb-1">暂无资格规则</p>
          <p className="text-xs text-text-muted/50">不配置规则时，所有农户均可通过资格检查</p>
        </div>
      )}
      <div className="space-y-2">
        {rules.map(r => (
          <div key={r.id} className="bg-white border border-border rounded-card p-4 hover:border-border transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="font-semibold text-text-primary text-sm">{r.rule_name}</span>
                  <Tag label="启用" color="green" />
                  {!r.can_combine_with_others && <Tag label="不可叠加" color="red" />}
                </div>
                {r.rule_desc && <p className="text-xs text-text-muted mb-2">{r.rule_desc}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {ruleDesc(r).map((line, i) => (
                    <span key={i} className="text-xs bg-primary-500/5 border border-primary-500/20 text-primary px-2 py-0.5 rounded">
                      {line}
                    </span>
                  ))}
                  {ruleDesc(r).length === 0 && (
                    <span className="text-xs text-text-muted/50">（无具体条件限制）</span>
                  )}
                </div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button onClick={() => openEdit(r)}
                  className="text-xs border border-border text-text-muted px-2.5 py-1 rounded hover:border-border">
                  编辑
                </button>
                <button onClick={() => del(r.id)}
                  className="text-xs border border-red-100 text-red-400 px-2.5 py-1 rounded hover:bg-red-50">
                  删除
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 编辑弹窗 */}
      <Modal open={editOpen} title={editTarget ? '编辑资格规则' : '新增资格规则'}
        onClose={() => setEditOpen(false)} onConfirm={submit}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-text-muted mb-1">规则名称 *</label>
              <input value={form.rule_name ?? ''} onChange={e => sf('rule_name', e.target.value)}
                placeholder="如：在册状态检查、高龄条件检查"
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-text-muted mb-1">规则说明（给操作员看）</label>
              <input value={form.rule_desc ?? ''} onChange={e => sf('rule_desc', e.target.value)}
                placeholder="简单描述这条规则的作用"
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" />
            </div>
          </div>

          <div className="border-t border-border/50 pt-3">
            <p className="text-xs font-semibold text-text-muted mb-2">人员条件</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">要求农户状态</label>
                <select value={form.require_farmer_status ?? ''} onChange={e => sf('require_farmer_status', e.target.value ? Number(e.target.value) : null)}
                  className="w-full border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none">
                  <option value="">不限</option>
                  {FARMER_STATUS_OPTS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">最小年龄（岁）</label>
                <input type="number" value={form.require_age_min ?? ''} onChange={e => sf('require_age_min', e.target.value ? Number(e.target.value) : null)}
                  placeholder="不限" className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">最大年龄（岁）</label>
                <input type="number" value={form.require_age_max ?? ''} onChange={e => sf('require_age_max', e.target.value ? Number(e.target.value) : null)}
                  placeholder="不限" className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" />
              </div>
            </div>
          </div>

          <div className="border-t border-border/50 pt-3">
            <p className="text-xs font-semibold text-text-muted mb-2">土地条件</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">地块类型</label>
                <select value={form.require_land_type ?? ''} onChange={e => sf('require_land_type', e.target.value || null)}
                  className="w-full border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none">
                  <option value="">不限</option>
                  {LAND_TYPE_OPTS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">最小面积（亩）</label>
                <input type="number" step="0.01" value={form.require_min_area ?? ''} onChange={e => sf('require_min_area', e.target.value ? Number(e.target.value) : null)}
                  placeholder="不限" className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">最大面积（亩）</label>
                <input type="number" step="0.01" value={form.require_max_area ?? ''} onChange={e => sf('require_max_area', e.target.value ? Number(e.target.value) : null)}
                  placeholder="不限" className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary-500" />
              </div>
            </div>
            <div className="flex gap-4 mt-2">
              <label className="flex items-center gap-1.5 text-sm text-text-primary cursor-pointer">
                <input type="checkbox" checked={!!form.require_not_idle} onChange={e => sf('require_not_idle', e.target.checked ? 1 : 0)} />
                要求土地未撂荒
              </label>
              <label className="flex items-center gap-1.5 text-sm text-text-primary cursor-pointer">
                <input type="checkbox" checked={!!form.require_contract_valid} onChange={e => sf('require_contract_valid', e.target.checked ? 1 : 0)} />
                要求承包合同在有效期内
              </label>
            </div>
          </div>

          <div className="border-t border-border/50 pt-3">
            <p className="text-xs font-semibold text-text-muted mb-2">叠加规则</p>
            <label className="flex items-center gap-1.5 text-sm text-text-primary cursor-pointer">
              <input type="checkbox" checked={!!form.can_combine_with_others} onChange={e => sf('can_combine_with_others', e.target.checked ? 1 : 0)} />
              允许与其他补贴叠加（同一年度同一农户）
            </label>
          </div>
        </div>
      </Modal>

      <Toast {...toast} />
    </div>
  )
}
