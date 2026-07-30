/**
 * 预检规则配置面板
 *
 * 用户可开关每项检查规则，调整阈值参数
 */
import { useState, useEffect, useCallback } from 'react'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'

interface RuleConfig {
  id: number
  rule_key: string
  rule_name: string
  description: string
  enabled: number
  threshold_json: string
  sort_order: number
}

const RULE_LABELS: Record<string, { name: string; desc: string }> = {
  format_errors:        { name: '格式错误', desc: '身份证长度(18位)/校验码/姓名必填' },
  village_errors:       { name: '村组不存在', desc: '填写的村名在系统中不存在' },
  duplicate_errors:     { name: '重复身份证', desc: '同一身份证在Excel中出现多次' },
  gender_mismatch:      { name: '性别不符', desc: '身份证第17位与数据库性别不一致' },
  error_library_hits:   { name: '错误库命中', desc: '身份证在历史错误库中有记录' },
  area_anomalies:       { name: '面积异常', desc: '申报面积超出参考面积指定倍数' },
  area_missing:         { name: '承包面积缺失', desc: '有申报面积但数据库无承包地记录' },
  age_anomaly:          { name: '年龄异常', desc: '年龄不在合理范围内' },
  deceased_farmers:     { name: '死亡农户', desc: '已标记为离世(farmer_status=4)' },
  restricted_farmers:   { name: '受限身份农户', desc: '状态为迁出等' },
  household_duplicates: { name: '同一家庭多成员', desc: '一户多人申请同一补贴' },
  new_farmers:          { name: '新增农户', desc: 'Excel有但数据库中不存在的农户' },
  removed_farmers:      { name: '减少农户', desc: '数据库中在册但Excel未出现' },
  changed_farmers:      { name: '字段变更', desc: '姓名/电话与数据库不一致' },
}

export default function PrecheckConfigPanel() {
  const { toast, show } = useToast()
  const [rules, setRules] = useState<(RuleConfig & { _orig: string })[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const raw = await window.electronAPI.invoke('precheck:listRules')
      const data = (raw as any)?.data ?? raw
      const arr = (Array.isArray(data) ? data : []) as RuleConfig[]
      setRules(arr.map(r => ({ ...r, _orig: JSON.stringify({ enabled: r.enabled, threshold_json: r.threshold_json }) })))
    } catch { show('加载规则失败', 'err') }
    finally { setLoading(false) }
  }, [show])

  useEffect(() => { load() }, [load])

  const toggleRule = (key: string) => {
    setRules(prev => prev.map(r => r.rule_key === key ? { ...r, enabled: r.enabled ? 0 : 1 } : r))
  }

  const updateThreshold = (key: string, field: string, value: number) => {
    setRules(prev => prev.map(r => {
      if (r.rule_key !== key) return r
      let t: Record<string, number> = {}
      try { t = JSON.parse(r.threshold_json) } catch {}
      t[field] = value
      return { ...r, threshold_json: JSON.stringify(t) }
    }))
  }

  const hasChanges = rules.some(r => JSON.stringify({ enabled: r.enabled, threshold_json: r.threshold_json }) !== r._orig)

  const save = async () => {
    setSaving(true)
    try {
      await window.electronAPI.invoke('precheck:saveRules', rules.map(r => ({
        rule_key: r.rule_key, rule_name: r.rule_name, description: r.description,
        enabled: r.enabled, threshold_json: r.threshold_json,
      })))
      show('✓ 已保存')
      setRules(prev => prev.map(r => ({ ...r, _orig: JSON.stringify({ enabled: r.enabled, threshold_json: r.threshold_json }) })))
    } catch { show('保存失败', 'err') }
    finally { setSaving(false) }
  }

  const reset = async () => {
    if (!confirm('恢复默认规则？所有自定义更改将丢失。')) return
    await window.electronAPI.invoke('precheck:resetRules')
    show('已恢复默认')
    load()
  }

  if (loading) return <div className="text-center py-8 text-text-muted text-sm">加载中…</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-text-primary">预检规则配置</h3>
          <p className="text-xs text-text-muted mt-1">勾选需要执行的检查项，调整参数后保存。下次预检生效。</p>
        </div>
        <div className="flex gap-2">
          <button onClick={reset} className="px-3 py-1.5 text-xs border border-red-200 text-red-500 rounded-btn hover:bg-red-50">恢复默认</button>
          <button onClick={save} disabled={!hasChanges || saving}
            className={`px-4 py-1.5 text-xs rounded-btn font-medium ${
              hasChanges ? 'bg-primary-500 text-white hover:bg-primary-600' : 'bg-stone-100 text-text-muted cursor-not-allowed'
            }`}>
            {saving ? '保存中…' : '保存配置'}
          </button>
        </div>
      </div>

      <div className="space-y-1">
        {rules.map(r => {
          const info = RULE_LABELS[r.rule_key] || { name: r.rule_name || r.rule_key, desc: r.description || '' }
          let t: Record<string, number> = {}
          try { t = JSON.parse(r.threshold_json) } catch {}

          return (
            <div key={r.rule_key} className={`border rounded-btn px-4 py-2.5 flex items-center gap-3 transition-colors
              ${r.enabled ? 'bg-white border-border/50' : 'bg-warm/10 border-border/30 opacity-60'}`}>
              {/* 开关 */}
              <button onClick={() => toggleRule(r.rule_key)}
                className={`shrink-0 w-10 h-5 rounded-full transition-colors relative ${
                  r.enabled ? 'bg-primary-500' : 'bg-stone-300'
                }`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  r.enabled ? 'left-[22px]' : 'left-0.5'
                }`} />
              </button>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-text-primary">{info.name}</div>
                <div className="text-xs text-text-muted">{info.desc}</div>
              </div>

              {/* 参数调整 */}
              {r.rule_key === 'area_anomalies' && r.enabled ? (
                <div className="flex items-center gap-1.5 text-xs shrink-0">
                  <span className="text-text-muted">阈值</span>
                  <input type="number" min={1} max={5} step={0.1} value={t.ratio || 1.1}
                    onChange={e => updateThreshold(r.rule_key, 'ratio', Number(e.target.value) || 1.1)}
                    className="w-16 border border-border rounded-btn px-2 py-1 text-xs outline-none text-center" />
                  <span className="text-text-muted">倍</span>
                </div>
              ) : r.rule_key === 'age_anomaly' && r.enabled ? (
                <div className="flex items-center gap-1.5 text-xs shrink-0">
                  <span className="text-text-muted">{t.min || 16}</span>
                  <span className="text-text-muted/50">~</span>
                  <span className="text-text-muted">{t.max || 100}</span>
                  <span className="text-text-muted">岁</span>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <Toast {...toast} />
    </div>
  )
}
