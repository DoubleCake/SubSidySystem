# 农户补贴管理系统 — Electron 桌面版 开发文档

## 快速命令

```bash
cd subsidy-electron

# 开发模式（热重载）
npm run dev

# 生产构建
npm run build

# 打包为文件夹（发给朋友用）
npm run pack
# 产物: dist/win-unpacked/

# 构建 + 打包（完整流程）
npm run dist

# 生成种子数据
npm run db:seed
```

## 目录结构

```
subsidy-electron/
├── electron/                  # 主进程 (Node.js)
│   ├── main.ts                # 窗口管理、应用生命周期
│   ├── preload.ts             # contextBridge 安全桥接
│   ├── database/
│   │   ├── connection.ts      # sql.js 封装 (SqlJsWrapper)
│   │   ├── migrate.ts         # 建表 + 增量迁移 (25张表)
│   │   └── seed.ts            # 种子数据
│   ├── ipc/                   # IPC 处理器 (替代 FastAPI router)
│   │   ├── index.ts           # 注册中心
│   │   ├── farmers.ts         # 农户 CRUD
│   │   ├── households.ts      # 家庭户 + 成员 + 历史
│   │   ├── subsidies.ts       # 补贴类型/申请/发放/汇总
│   │   ├── auth.ts            # 本地认证 (admin/admin123)
│   │   ├── land.ts            # 土地流转 + 大户
│   │   ├── settings.ts        # 村组 + 备份迁移
│   │   ├── ai.ts              # AI 分析
│   │   ├── precheck.ts        # 数据预检
│   │   ├── excel-templates.ts # Excel 模板
│   │   ├── error-library.ts   # 错误库
│   │   ├── household-import.ts # 家庭户批量导入
│   │   ├── agri-tasks.ts      # 农业任务
│   │   ├── external-links.ts  # 外联查询
│   │   └── eligibility.ts     # 资格规则
│   └── utils/                 # 工具函数
│       ├── id-card.ts         # 身份证解析/校验
│       ├── masking.ts         # 脱敏打码
│       ├── format.ts          # 村组格式化
│       └── area-check.ts      # 面积异常检查
├── src/                       # 渲染进程 (React)
│   ├── api/index.ts           # IPC API 层 (替代 fetch)
│   ├── pages/                 # 40+ 页面组件
│   ├── components/            # 10+ 共享组件
│   ├── types/                 # TypeScript 类型
│   └── utils/                 # 前端工具
├── static/images/             # 图片资源 (16张)
├── resources/                 # 应用图标
├── dist/win-unpacked/         # 打包产物
├── electron-vite.config.ts    # 构建配置
├── electron-builder.yml       # 打包配置
└── tailwind.config.js         # 完整色阶配置
```

## 数据库

### 存储位置

```
优先级: 应用同目录/subsidy.db > %APPDATA%/subsidy-electron/subsidy.db
```

### 兼容 Python 旧数据

直接把 Python 项目的 `subsidy.db` 复制到 `dist/win-unpacked/` 下即可使用。

迁移脚本自动处理：
- `CREATE TABLE IF NOT EXISTS` — 25 张表
- `ALTER TABLE ADD COLUMN` — 35 条增量列补充
- 30+ 性能索引

### sql.js 注意事项

- 使用 WASM 版 SQLite，**纯 JS 无需编译**
- 数据库加载到内存，每次写操作自动保存到磁盘
- 打包时从 asar 解包 (`asarUnpack: node_modules/sql.js/**`)

## 迁移修复记录

### 启动问题
| 问题 | 原因 | 修复 |
|------|------|------|
| `ELECTRON_RUN_AS_NODE=1` | 环境变量导致 Electron 以 Node 模式运行 | `unset` 该变量 |
| `import { app } from 'electron'` 失败 | Electron 33 不支持 ESM import | 主进程/preload 用 CJS 格式 |
| sql-wasm `module.exports` 错误 | 打包 sql.js 导致 CJS 冲突 | externalize sql.js, `require()` 加载 |

### 页面加载
| 问题 | 原因 | 修复 |
|------|------|------|
| "页面不存在" | `BrowserRouter` 不支持 `file://` 协议 | 改为 `HashRouter` |
| 图片不显示 | `/images/head.png` 解析为文件系统根目录 | 改为相对路径 `images/head.png` |
| `bg-primary-500` 等类名无效 | tailwind.config 只有单色无完整色阶 | 同步 9 色阶 + 扩展配置 |
| Google Fonts 阻塞 | `@import` 访问外部网络 | 移除，使用系统字体 |
| CSP 过严 | `default-src 'self'` 限制 `file://` | 添加 `unsafe-inline` `unsafe-eval` |

### 数据层
| 问题 | 原因 | 修复 |
|------|------|------|
| 47 处 `fetch()` 调用失败 | 页面仍用 HTTP 调用 API | `main.tsx` 覆盖 `window.fetch` 自动转 IPC |
| 备份页恢复失败 | `dialog:selectFile` 返回值误读 | 直接取字符串路径 |
| 补贴项目筛选/删除失效 | 缺少 `deleteType` handler + 参数不匹配 | 补全 handler + status 参数 |

### 登录
| 问题 | 原因 | 修复 |
|------|------|------|
| 登录功能缺失 | 无 auth handler | IPC auth handler，默认 admin/admin123 |

## IPC 通信模式

```
渲染进程                         主进程
────────                        ──────
import * as api from '../api'    ipcMain.handle('channel', handler)
api.getFarmers(params)      →    farmers:list
api.createFarmer(data)      →    farmers:create
```

### 全局 fetch 兜底

`main.tsx` 覆盖了 `window.fetch`，所有 `/api/` 路径自动转 IPC：

```typescript
// 页面中无需改动，自动工作
fetch('/api/farmers?page=1')  →  window.electronAPI.invoke('farmers:list', { page: 1 })
```

## 打包分发

### 生成便携版
```bash
npm run pack
# 产物: dist/win-unpacked/ (330MB)
```

将 `win-unpacked/` 文件夹压缩为 zip 发给朋友即可。无需安装，解压后双击 `农户补贴管理系统.exe`。

### 配置说明
- 跳过代码签名 (`sign: null`) — 个人分发不需要
- 包格式: NSIS → 便携文件夹
- asar 解包: `sql.js` WASM 文件

## 环境变量

| 变量 | 说明 |
|------|------|
| `ELECTRON_RUN_AS_NODE` | **必须清除**，否则 Electron 以 Node 模式运行 |
| `HTTP_PROXY` / `HTTPS_PROXY` | npm/electron 下载代理 |

## 自动更新

### 架构

```
用户电脑                        云服务器 (用户自有)
────────                       ─────────
electron-updater ──HTTP──→  https://your-server.com/updates/
  (检查 latest.yml)            ├── latest.yml
  (下载 .exe + .blockmap)       ├── 农户补贴管理系统 Setup 3.1.0.exe
                               ├── 农户补贴管理系统 Setup 3.1.0.exe.blockmap
                               └── ... (历史版本)

用户设置: 更新服务器地址 → 存储在 %APPDATA%/subsidy-electron/user-settings.json
```

### 发布新版本流程

```bash
# 1. 修改 package.json 版本号
# 2. 构建 + 打包
npm run dist
# 产物在 dist/ 下: .exe, .blockmap, latest.yml

# 3. 上传 dist/ 下所有文件到云服务器
# 例如: scp dist/* user@your-server.com:/var/www/updates/

# 4. 用户下次启动时会自动检测到新版本
```

### 用户在软件中配置

在 **设置 > 更新** 中填写更新服务器地址，例如：
```
https://your-server.com/updates/
```

### 相关文件

| 文件 | 作用 |
|------|------|
| `electron/updater.ts` | 检查/下载/安装逻辑 |
| `electron/store.ts` | 持久化用户设置 (electron-store) |
| `electron/ipc/settings.ts` | `getUpdateConfig` / `setUpdateConfig` / `checkForUpdate` |
| `electron/preload.ts` | 暴露更新事件监听 (status/available/progress/error) |

### 手动触发检查

```javascript
// 渲染进程中
const result = await window.electronAPI.invoke('settings:checkForUpdate')
// result: { message, version } 或 { error }
```

## 默认账号

- 用户名: `admin`
- 密码: `admin123`
