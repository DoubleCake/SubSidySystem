# 🌾 农户补贴管理系统（Electron 桌面版）

面向基层政府 / 合作社的农户补贴管理桌面应用：农户档案、家庭户、补贴申报与发放、土地流转、数据分析、Excel 批量导入导出，数据全部保存在本地 SQLite，无需部署后端。

> 分支说明：`feat/electron-only` 是当前开发主线（Electron 版）；`main` 保留已归档的 Python/FastAPI 版本，仅作历史参考。Windows 便携版与安装包通过 `electron-builder` 产出。

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面容器 | Electron 33（主进程 CJS + contextBridge） |
| 前端 | React 18 + TypeScript + Tailwind CSS + Vite（electron-vite） |
| 数据库 | sql.js（SQLite WASM，本地单文件，运行时全量载入内存） |
| 通信 | Electron IPC（`invoke/handle`），统一 `{ code, data, message }` 响应 |
| Excel | SheetJS (xlsx) |
| 图表 | Recharts |
| 打包 / 更新 | electron-builder + electron-updater（自建静态更新服务器） |

## 快速开始

```bash
cd subsidy-electron
npm install
npm run dev      # 开发模式（热重载）
npm run build    # 编译到 out/
npm run dist     # 构建 + 打安装包（dist/）
npm run pack     # 只打便携目录（dist/win-unpacked/）
```

- 首次启动会自动建表并弹出「管理员账号设置」向导；默认账号 `admin / admin123`，登录后请尽快修改。
- 可选种子数据：`npm run db:seed`（需先启动过一次应用以完成建表）。

## 数据库位置

优先级：`应用同目录/subsidy.db`（便携模式，兼容旧 Python 版数据） > `%APPDATA%/subsidy-electron/subsidy.db`。

- 每次写操作后整库导出落盘；启动后每 4 小时自动备份到 `%APPDATA%/subsidy-electron/backups/`，保留最近 7 份。
- 迁移在启动时自动执行（`CREATE TABLE IF NOT EXISTS` + 增量 `ALTER TABLE`），备份页也可手动导出/恢复。

## 目录结构

```
SubSidySystem/
├── subsidy-electron/          # 应用主体（真正的开发区）
│   ├── electron/              # 主进程：main / preload / database / ipc / utils
│   ├── src/                   # 渲染进程：pages / components / api / types / utils
│   ├── static/                # 运行时图片资源（源码，需入库）
│   ├── resources/             # 应用图标
│   ├── dist/                  # 打包产物（已忽略）
│   └── out/                   # 编译产物（已忽略）
├── CLAUDE.md                  # 开发约定与架构说明
├── PLAN.md                    # 待办计划与历史性能分析
├── UI_DESIGN_SPEC.md          # UI 色值/字号/布局规范
└── README.md
```

技术细节（sql.js 注意事项、打包、自动更新发布流程、`.bat` 编码坑）见 [subsidy-electron/DEVELOPMENT.md](subsidy-electron/DEVELOPMENT.md)。

## 开发约定（摘要）

- IPC 通道命名 `<domain>:<action>`（如 `farmers:list`、`subsidies:createType`）。
- 渲染进程不直接访问数据库，一律走 IPC；列名动态拼接必须过 `safeUpdate/safeInsert` 白名单。
- 身份证、手机号、银行卡号在渲染进程展示前必须脱敏；上传 AI 模型前姓名同样需要打码。
- 数据库结构变更必须同时写入 `electron/database/migrate.ts`（幂等），不能只改建表语句。
