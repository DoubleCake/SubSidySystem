#!/usr/bin/env node
/**
 * 批量替换旧色值 → 新色板（见 src/theme/tokens.ts）
 *
 * 用法: node scripts/replace-colors.mjs <目录> [--dry]
 * 只替换十六进制色值字面量，不改动其他内容。
 */
import fs from 'fs'
import path from 'path'

const MAP = {
  // 墨绿主色
  '#0F3D2E': '#1A3A2C',
  '#1A4D3A': '#234A38',
  '#2C6B52': '#2F5C46',
  '#2C7A63': '#234A38',
  '#EDF3EF': '#E2EDE6',
  '#DCE9E1': '#C4DACC',
  '#C9DCC9': '#C4DACC',

  // 中性暖灰
  '#F8F5F0': '#F3EFE7',
  '#F7F3E7': '#FFFFFF',
  '#F6F1E7': '#F3EFE7',
  '#EFE7D8': '#F3EFE7',
  '#F2EDE3': '#E6E0D4',
  '#F0EBE1': '#E6E0D4',
  '#E8E2D9': '#E6E0D4',
  '#E4DCCD': '#E6E0D4',
  '#DDD3C2': '#D2CBBC',
  '#8C877A': '#7A7466',
  '#9A9588': '#7A7466',
  '#6B6B60': '#5C5749',
  '#5A5A4F': '#5C5749',

  // 谷金强调
  '#E6C288': '#DDBE84',
  '#F6EEDC': '#FBF3E2',
  '#F2E0B8': '#F2E0B8',
  '#E8D8B8': '#F2E0B8',
  '#FDFAF3': '#FBF3E2',
  '#8A6620': '#8A6118',
  '#5A4215': '#6B4A0F',

  // 语义色
  '#FDECEA': '#FCEAE8',
  '#F9D9D4': '#F5D3CF',
  '#E8C9C2': '#F5D3CF',
  '#D32F2F': '#B91C1C',

  // 信息蓝
  '#E3EEF2': '#E7EFF4',
  '#C9DCE2': '#C4D9E4',
  '#D3E4EA': '#D2E2EA',
  '#2E6478': '#1F4F63',

  // 悬停/浅底
  '#F7FAF8': '#F2F7F4',
  '#F3F7F4': '#F2F7F4',
  '#F0F5F2': '#F2F7F4',
  '#F4F8F5': '#F2F7F4',
  '#F2B8A8': '#F5D3CF',
}

const target = process.argv[2]
const dry = process.argv.includes('--dry')
if (!target) { console.error('用法: node scripts/replace-colors.mjs <目录> [--dry]'); process.exit(1) }

const exts = ['.tsx', '.ts', '.css', '.jsx', '.js']
let totalFiles = 0, totalRepl = 0

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue }
    if (!exts.includes(path.extname(e.name))) continue
    // 色板定义文件本身不能被替换
    if (e.name === 'tokens.ts' && p.includes('theme')) continue
    let t = fs.readFileSync(p, 'utf8')
    let n = 0
    for (const [from, to] of Object.entries(MAP)) {
      const re = new RegExp(from.replace('#', '#'), 'gi')
      const hits = (t.match(re) || []).length
      if (hits > 0) { t = t.replace(re, to); n += hits }
    }
    if (n > 0) {
      totalFiles++
      totalRepl += n
      if (!dry) fs.writeFileSync(p, t, 'utf8')
      console.log(`${dry ? '[dry] ' : ''}${path.relative(process.cwd(), p)} : ${n}`)
    }
  }
}

walk(target)
console.log(`\n${dry ? '将' : '已'}修改 ${totalFiles} 个文件，共 ${totalRepl} 处`)
