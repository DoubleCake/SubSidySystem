import { ipcMain } from 'electron'
import { getDb } from '../database/connection'
import { desensitizeFarmer, desensitizeText } from '../utils/masking'
import { success, errorResponse } from './response'

export function registerAiHandlers(): void {
  const db = () => getDb()

  ipcMain.handle('ai:analyze', async (_e, data: { year: number; village_name?: string; question: string }) => {
    try {
      const { year, village_name, question } = data

      // 收集数据并脱敏
      let appsQuery = `
        SELECT sa.*, fp.real_name, fp.id_card, fp.phone, fp.bank_card,
               st.subsidy_name, st.season,
               v.village_name, hh.group_no
        FROM subsidy_application sa
        JOIN farmer_profile fp ON sa.farmer_id = fp.id
        JOIN subsidy_type st ON sa.subsidy_type_id = st.id
        LEFT JOIN family_household hh ON fp.household_id = hh.id
        LEFT JOIN village v ON hh.village_id = v.id
        WHERE sa.apply_year = ?
      `
      const params: unknown[] = [year]

      if (village_name) {
        appsQuery += ` AND v.village_name = ?`
        params.push(village_name)
      }

      const apps = db().allRaw<Record<string, unknown>>(appsQuery, ...params)

      // 构建脱敏数据
      const desensitizedApps = apps.map(a => desensitizeFarmer({
        farmer_name: a.real_name,
        farmer_id_masked: a.id_card,
        village: `${a.village_name || ''}${a.group_no || ''}`,
        subsidy_name: a.subsidy_name,
        apply_amount: Number(a.apply_amount || 0),
        actual_amount: Number(a.actual_amount || 0),
        pay_status: a.pay_status,
        season: a.season,
      }))

      const stats = {
        year,
        village_filter: village_name || '全部',
        record_count: apps.length,
        total_amount: apps.reduce((s, a) => s + Number(a.actual_amount || 0), 0),
        farmer_count: new Set(apps.map(a => a.farmer_id)).size,
      }

      // 尝试调用 Claude API
      let aiResult = 'AI 分析功能需要配置 ANTHROPIC_API_KEY 环境变量。\n\n请在系统环境变量中设置 ANTHROPIC_API_KEY 后重启应用。\n\n以下为数据摘要：\n'
      aiResult += `\n年度：${year}\n筛选：${stats.village_filter}\n`
      aiResult += `记录数：${stats.record_count}\n涉及农户：${stats.farmer_count}人\n`
      aiResult += `总金额：${stats.total_amount.toFixed(2)}元\n`

      try {
        const Anthropic = require('@anthropic-ai/sdk').default
        const apiKey = process.env.ANTHROPIC_API_KEY

        if (apiKey) {
          const client = new Anthropic({ apiKey })
          const safeQuestion = desensitizeText(question)

          const prompt = `你是一位农村补贴管理专家助手。以下是${year}年度的补贴发放脱敏数据（所有身份证、手机号均已脱敏处理）：

\`\`\`json
${JSON.stringify({ statistics: stats, records: desensitizedApps.slice(0, 50) }, null, 2)}
\`\`\`

请根据以上数据回答：${safeQuestion}

要求：
1. 用简洁的中文回答，分点列出
2. 重点关注：金额异常、新增/退出农户原因推断、与上年对比变化
3. 如有疑似异常数据请明确指出
4. 最后给出1-2条管理建议`

          const message = await client.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1500,
            messages: [{ role: 'user', content: prompt }],
          })

          aiResult = message.content[0].text
        }
      } catch {
        // AI SDK 未安装或 API key 未配置，使用默认摘要
      }

      return success({
        result: aiResult,
        data_preview: { year: stats.year, statistics: stats, record_count: stats.record_count },
      })
    } catch (e) {
      return errorResponse(String(e))
    }
  })
}
