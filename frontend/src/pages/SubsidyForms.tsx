/**
 * 补贴项目表单组件
 * 包含新增/编辑补贴项目的Modal表单 + 预检查方案配置
 */
import { useState, useEffect } from 'react'
import Modal from '../components/Modal'
import type { SubsidyType, SubsidyTypeCreate } from '../types'
import type { CheckConfig } from '../types'
import { years } from '../utils'
import { getCheckConfig, updateCheckConfig } from '../api'

const FUND_SOURCES = ['中央', '省级', '市级', '县级', '镇级']
const UNITS = ['元/亩', '元/人', '元/户']

// 预检检查项定义
type CheckItemKey = keyof CheckConfig['checks'] | 'check_trust_deduction'
const CHECK_ITEMS: { key: CheckItemKey; label: string; desc: string }[] = [
  { key: 'format', label: '格式检查', desc: '姓名/身份证/手机号合法性' },
  { key: 'village', label: '村组存在性', desc: '检查村组在数据库中是否存在' },
  { key: 'duplicate', label: '身份证重复', desc: 'Excel 内部重复身份证号' },
  { key: 'gender', label: '性别一致性', desc: 'Excel性别与身份证是否一致' },
  { key: 'error_library', label: '错误库命中', desc: '与历史错误记录交叉比对' },
  { key: 'area_anomaly', label: '面积异常', desc: '面积超限/逻辑校验' },
  { key: 'check_trust_deduction', label: '流转出扣减', desc: '流转出+不补贴面积是否超过承包地' },
  { key: 'db_compare', label: '数据库比对', desc: '新增/减少/变更农户' },
  { key: 'year_compare', label: '年度对比', desc: '与指定年度的历史补贴数据对比' },
]

const AREA_MODES: { val: CheckConfig['area_mode']; label: string; desc: string }[] = [
  { val: 'disabled', label: '不检查', desc: '固定金额类' },
  { val: 'seasonal', label: '按季节累计', desc: '大春/小春类' },
  { val: 'standalone', label: '单独计算', desc: '耕地地力保护/临时' },
]

interface SubsidyFormProps {
  open: boolean
  editing: SubsidyType | null
  form: Partial<SubsidyTypeCreate>
  onFormChange: (form: Partial<SubsidyTypeCreate>) => void
  onSubmit: () => void
  onClose: () => void
  thisYear: number
  onCheckConfigChange?: (config: CheckConfig) => void
}

// 默认检查配置
const DEFAULT_CHECK_CONFIG: CheckConfig = {
  checks: {
    format: true, village: true, duplicate: true,
    gender: true, error_library: true, area_anomaly: true,
    db_compare: true, year_compare: false,
  },
  area_mode: 'disabled',
  check_trust_deduction: false,
}

export default function SubsidyForms({
  open, editing, form, onFormChange, onSubmit, onClose, thisYear, onCheckConfigChange
}: SubsidyFormProps) {
  const [checkConfig, setCheckConfig] = useState<CheckConfig>(DEFAULT_CHECK_CONFIG)
  const [loadingConfig, setLoadingConfig] = useState(false)

  // 编辑时加载已有配置；新增时根据 season+calc_mode 自动生成合理的默认值
  useEffect(() => {
    if (!open) return
    if (editing) {
      setLoadingConfig(true)
      getCheckConfig(editing.id)
        .then(res => setCheckConfig(res.check_config))
        .catch(() => setCheckConfig(DEFAULT_CHECK_CONFIG))
        .finally(() => setLoadingConfig(false))
    } else {
      // 新增：根据当前表单值生成默认
      setCheckConfig(genDefaultConfig(form.season ?? '耕地地力保护', form.category, form.calc_mode ?? 'fixed'))
    }
  }, [open, editing?.id])

  // 通知父组件配置变化（用于新建时保存）
  useEffect(() => {
    onCheckConfigChange?.(checkConfig)
  }, [checkConfig])

  // 当 season / calc_mode 变化时更新默认配置（仅新建模式）
  useEffect(() => {
    if (editing || !open) return
    setCheckConfig(genDefaultConfig(form.season ?? '耕地地力保护', form.category, form.calc_mode ?? 'fixed'))
  }, [form.season, form.calc_mode, form.category])

  // 切换某个检查项的开关（处理两种层级：checks.xxx 和 check_trust_deduction）
  const toggleCheck = (key: string) => {
    setCheckConfig(prev => {
      if (key === 'check_trust_deduction') {
        return { ...prev, check_trust_deduction: !prev.check_trust_deduction }
      }
      return {
        ...prev,
        checks: { ...prev.checks, [key as keyof CheckConfig['checks']]: !prev.checks[key as keyof CheckConfig['checks']] },
      }
    })
  }

  // 提交时同步保存预检配置
  const handleConfirm = async () => {
    if (editing) {
      try { await updateCheckConfig(editing.id, checkConfig) } catch { /* ignore */ }
    }
    onSubmit()
  }

  // 判断某项是否选中
  const isChecked = (key: string): boolean => {
    if (key === 'check_trust_deduction') return checkConfig.check_trust_deduction
    return checkConfig.checks[key as keyof CheckConfig['checks']] ?? true
  }

  const isPerMu = form.calc_mode === 'per_mu'

  return (
    <Modal open={open} title={editing ? '编辑补贴项目' : '新增补贴项目'} onClose={onClose} onConfirm={handleConfirm}>
      <div className="space-y-4">
        {/* ── 基础信息 ── */}
        <div><label className="block text-xs text-text-muted mb-1.5">补贴季节 <span className="text-text-muted/50">（同季面积累加判断是否超承包面积）</span></label>
          <div className="flex gap-2">
            {[['大春', '🌻'], ['小春', '🌾'], ['耕地地力保护', '📅'], ['临时', '📌']].map(([s, icon]) => (
              <div key={s} onClick={() => onFormChange({ ...form, season: s })}
                className={`flex-1 border-2 rounded-btn p-2.5 cursor-pointer transition-colors text-center
                  ${(form.season ?? '耕地地力保护') === s ? 'border-primary bg-emerald-50' : 'border-border hover:border-border'}`}>
                <div className="text-base mb-0.5">{icon}</div>
                <div className={`text-xs font-medium ${(form.season ?? '耕地地力保护') === s ? 'text-primary' : ''}`}>{s}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[{ val: 'fixed', title: '固定金额', desc: '每户/每人发固定金额', icon: '💰' },
            { val: 'per_mu', title: '按亩计算', desc: '每亩金额 × 土地面积', icon: '🌾' }].map(opt => (
            <div key={opt.val} onClick={() => onFormChange({ ...form, calc_mode: opt.val as 'fixed' | 'per_mu' })}
              className={`border-2 rounded-card p-3 cursor-pointer transition-colors
                ${form.calc_mode === opt.val ? 'border-primary bg-emerald-50' : 'border-border hover:border-border'}`}>
              <div className="text-xl mb-1">{opt.icon}</div>
              <div className={`font-semibold text-sm ${form.calc_mode === opt.val ? 'text-primary' : ''}`}>{opt.title}</div>
              <div className="text-xs text-text-muted">{opt.desc}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs text-text-muted mb-1">补贴名称 *</label>
            <input value={form.subsidy_name ?? ''} onChange={e => onFormChange({ ...form, subsidy_name: e.target.value })}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
          <div><label className="block text-xs text-text-muted mb-1">补贴年度 *</label>
            <select value={form.subsidy_year ?? thisYear} onChange={e => onFormChange({ ...form, subsidy_year: Number(e.target.value) })}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select></div>
          <div><label className="block text-xs text-text-muted mb-1">{form.calc_mode === 'per_mu' ? '每亩金额(元)' : '标准金额(元)'}</label>
            <input type="number" step="0.01" value={form.standard_amount ?? ''} onChange={e => onFormChange({ ...form, standard_amount: Number(e.target.value) || undefined })}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary" /></div>
          {form.calc_mode === 'fixed' && (
            <div><label className="block text-xs text-text-muted mb-1">发放单位</label>
              <select value={form.standard_unit ?? '元/户'} onChange={e => onFormChange({ ...form, standard_unit: e.target.value })}
                className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select></div>
          )}
          
          <div><label className="block text-xs text-text-muted mb-1">是否计入当季补贴面积累计</label>
            <select value={form.count_toward_area ?? 1} onChange={e => onFormChange({ ...form, count_toward_area: Number(e.target.value) })}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none bg-white">
              <option value={1}>是</option>
              <option value={0}>否（一般不考虑面积类补贴不需计入）</option>
            </select>
            <p className="text-xs text-text-muted/50 mt-1">影响家庭户超领预警的计算</p>
          </div>
          <div className="col-span-2"><label className="block text-xs text-text-muted mb-1">补贴说明</label>
            <textarea rows={2} value={form.description ?? ''} onChange={e => onFormChange({ ...form, description: e.target.value || undefined })}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none focus:border-primary resize-none" /></div>
        </div>

        {/* ── 预检查方案配置 ── */}
        <hr className="border-border/50" />
        <div>
          <h4 className="font-semibold text-text-primary text-sm mb-1">🛡 预检查方案</h4>
          <p className="text-xs text-text-muted/50 mb-3">点击切换需要检查的项目，自动关联到补贴类型</p>

          {loadingConfig ? (
            <div className="text-xs text-text-muted/50 py-2">加载配置中…</div>
          ) : (
            <>
              {/* 已启用的检查项 */}
              {CHECK_ITEMS.filter(item => isChecked(item.key)).length > 0 && (
                <div className="mb-3">
                  <label className="block text-xs text-text-muted mb-1.5">已启用</label>
                  <div className="flex flex-wrap gap-1.5">
                    {CHECK_ITEMS.filter(item => isChecked(item.key)).map(item => (
                      <span key={item.key}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-btn text-xs font-medium bg-primary-400 shadow-sm hover:bg-white/20">
                        {item.label}
                        <button type="button" onClick={() => toggleCheck(item.key)}
                          className="ml-0.5 w-4 h-4 rounded-full hover:bg-white/20 flex items-center justify-center leading-none text-sm font-bold">
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 备选检查项 */}
              {CHECK_ITEMS.filter(item => !isChecked(item.key)).length > 0 && (
                <div className="mb-3">
                  <label className="block text-xs text-text-muted mb-1.5">备选检查项</label>
                  <div className="flex flex-wrap gap-1.5">
                    {CHECK_ITEMS.filter(item => !isChecked(item.key)).map(item => (
                      <span key={item.key}
                        onClick={() => toggleCheck(item.key)}
                        title={item.desc}
                        className="px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer select-none transition-all
                          bg-white text-text-muted border border-border hover:border-primary/40 hover:text-text-primary">
                        + {item.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 面积检查模式（按亩补贴时才有意义） */}
              {isPerMu && (
                <div className="mb-2">
                  <label className="block text-xs text-text-muted mb-1.5">面积检查模式</label>
                  <div className="flex flex-wrap gap-2">
                    {AREA_MODES.map(opt => (
                      <div key={opt.val}
                        onClick={() => setCheckConfig(prev => ({ ...prev, area_mode: opt.val }))}
                        title={opt.desc}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer select-none transition-all
                          ${checkConfig.area_mode === opt.val
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'bg-white text-text-muted border border-border hover:border-blue-400 hover:text-text-primary'
                          }`}>
                        {checkConfig.area_mode === opt.val ? '◉ ' : '○ '}{opt.label}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ── 根据 season + calc_mode 生成默认配置 ──
function genDefaultConfig(season: string, category?: string, calcMode?: string): CheckConfig {
  const config: CheckConfig = {
    checks: {
      format: true, village: true, duplicate: true,
      gender: true, error_library: true, area_anomaly: true,
      db_compare: true, year_compare: false,
    },
    area_mode: 'disabled',
    check_trust_deduction: false,
  }
  if (calcMode === 'fixed') {
    config.checks.area_anomaly = false
    return config
  }
  if (season === '耕地地力保护') {
    config.area_mode = 'standalone'
    if (category === '耕地保护') config.check_trust_deduction = true
  } else if (season === '大春' || season === '小春') {
    config.area_mode = 'seasonal'
  }
  return config
}
