# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
用中文回复我所有的交互
不需要回复我太多的思考流程
身份证号、手机号、人名 上传到AI模型前都要进行自动打码处理

## 农户补贴管理系统 — Electron 桌面版

基于 Electron + React + Tailwind CSS + sql.js 的桌面端补贴管理应用。适用于基层政府/合作社的农户管理、补贴申报、土地流转、AI分析等场景。

## Tech Stack

- **Runtime**: Electron (主进程 + 渲染进程)
- **前端**: React 18 + TypeScript + Tailwind CSS + Vite (electron-vite)
- **数据库**: sql.js (SQLite WebAssembly, 本地内嵌)
- **IPC通信**: Electron IPC (contextBridge + invoke/handle)
- **UI组件**: 自定义 (无第三方 UI 库)
- **Excel**: xlsx (sheetjs)
- **图表**: Recharts
- **AI分析**: Anthropic Claude API (可选)
- **打包**: electron-builder

## 启动项目

```bash
cd subsidy-electron
npm install
npm run dev      # 开发模式 (electron-vite dev)
npm run build    # 构建生产版本
npm run dist     # 打包可分发的安装包
```

**首次运行需初始化数据库:**
```bash
npm run db:seed  # 填充测试数据到 SQLite
```

## 项目结构

### subsidy-electron/
```
subsidy-electron/
├── electron/               # 主进程 (Node.js)
│   ├── main.ts             # Electron 入口
│   ├── preload.ts          # contextBridge 预加载
│   ├── store.ts            # electron-store 持久化
│   ├── updater.ts          # 自动更新
│   ├── database/           # 数据库层 (sql.js)
│   │   ├── connection.ts   # 数据库连接
│   │   ├── schema.ts       # 表结构定义
│   │   ├── migrate.ts      # 迁移脚本
│   │   └── seed.ts         # 测试数据
│   ├── ipc/                # IPC handlers (替代 FastAPI routers)
│   │   ├── index.ts        # 注册所有 handler
│   │   ├── farmers.ts      # 农户相关
│   │   ├── households.ts   # 家庭户
│   │   ├── subsidies.ts    # 补贴申请/发放
│   │   ├── land.ts         # 土地流转
│   │   └── ...
│   └── utils/              # 主进程工具
│       ├── masking.ts      # 脱敏工具
│       ├── id-card.ts      # 身份证解析
│       ├── format.ts       # 格式化
│       └── area-check.ts   # 面积校验
├── src/                    # 渲染进程 (React)
│   ├── main.tsx            # React 入口
│   ├── App.tsx             # 路由配置
│   ├── index.css           # Tailwind + 全局样式
│   ├── api/index.ts        # IPC 调用封装 (替代 fetch API)
│   ├── pages/              # 页面组件
│   │   ├── SubsidyProjectsPage.tsx   # 补贴项目管理
│   │   ├── SubsidyRecordsPage.tsx    # 项目明细
│   │   ├── FarmersPage.tsx           # 农户列表
│   │   ├── DashboardPage.tsx         # 仪表盘
│   │   └── ...
│   ├── components/         # 共享组件
│   │   ├── Table.tsx, Modal.tsx, Tag.tsx, Toast.tsx
│   │   ├── ExcelImport.tsx, ExcelImportWithMapping.tsx
│   │   └── ...
│   ├── hooks/              # 自定义 hooks
│   ├── types/              # TypeScript 类型
│   └── utils/              # 渲染进程工具
├── index.html              # HTML 入口
├── electron.vite.config.ts # Vite 配置
├── tailwind.config.js      # Tailwind 主题
├── electron-builder.yml    # 打包配置
└── package.json
```

### IPC 通信模式
渲染进程通过 `window.electronAPI.invoke(channel, data)` 调用主进程：
```typescript
// src/api/index.ts
async function req<T>(channel: string, data?: unknown): Promise<T> {
  return await window.electronAPI.invoke(channel, data)
}
// 使用: const types = await req<SubsidyType[]>('subsidies:listTypes', { year })
```

主进程在 `electron/ipc/` 下处理：
```typescript
// electron/ipc/subsidies.ts
ipcMain.handle('subsidies:listTypes', async (_, params) => {
  const rows = db.exec(`SELECT * FROM subsidy_type WHERE ...`)
  return { code: 0, data: rows }
})
```

## 关键模型
- **subsidy_type** — 补贴项目类型 (名称、年度、季节、计算模式、标准金额)
- **farmer_profile** — 农户档案 (姓名、身份证、电话、状态)
- **family_household** — 家庭户 (户主、承包面积、村组)
- **subsidy_application** — 补贴申请 (农户-项目关联、面积、金额)
- **subsidy_payment** — 发放记录 (实发金额、日期)
- **land_trust** — 土地流转台账
- **household_event** — 家庭户变更历史

## 季节分类
`subsidy_type.season` 字段: 耕地地力保护 | 大春 | 小春 | 全年单补 | 临时

## 开发约定
- IPC channel 命名: `<domain>:<action>` (如 `farmers:list`, `subsidies:createType`)
- 所有响应格式: `{ code: 0, data: ... }` 成功 / `{ code: 1, message: ... }` 错误
- 渲染进程不直接操作数据库，全部走 IPC
- 身份证/手机号/银行卡号在渲染进程显示前必须脱敏
