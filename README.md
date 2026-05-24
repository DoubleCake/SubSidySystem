# 🌾 农户补贴管理系统

<p align="center">
  <img src="https://img.shields.io/badge/version-2.1.0-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License">
  <img src="https://img.shields.io/badge/Python-3.11+-3776AB.svg" alt="Python">
  <img src="https://img.shields.io/badge/React-18-61dafb.svg" alt="React">
  <img src="https://img.shields.io/badge/FastAPI-0.111-009688.svg" alt="FastAPI">
  <img src="https://img.shields.io/badge/SQLite-3-07405E.svg" alt="SQLite">
</p>

<p align="center">
  一个为基层政府/合作社量身定制的<b>农户补贴管理</b>系统，提供农户档案、补贴发放、土地流转、数据统计及 AI 分析等全流程功能。<br />
  内网本地部署，简单高效，开箱即用。
</p>

---

## 📖 目录

- [功能特色](#功能特色)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [使用指南](#使用指南)
- [项目结构](#项目结构)
- [架构设计](#架构设计)
- [开发计划](#开发计划)
- [许可证](#许可证)

---

<h2 id="功能特色">✨ 功能特色</h2>

### 👨‍👩‍👧‍👦 农户与家庭户管理
- **家庭户管理** — 增删改查、分户合户、成员迁移、历史事件回溯
- **农户信息管理** — 身份证自动解析出生日期与性别，手机号/银行卡号脱敏展示
- **农户受限身份标记** — 可标记公务员/事业人员等受限身份，限制其享受补贴
- **农户独立村组** — 农户可独立于家庭户设置个人所属村组（出嫁/迁居等场景）
- **人工确认机制** — 家庭户信息人工核准确认，确保数据准确性
- **批量导入** — Excel 批量导入农户信息，支持自动数据校验和预检报告
- **家庭关系导入** — 按住址自动聚合家庭成员，智能识别户主与成员关系

### 💰 补贴管理
- **补贴类型配置** — 按年度设定补贴标准，支持大春/小春/耕地地力保护/临时四种季节分类
- **补贴申请全流程跟踪** — 从申请到发放，状态一目了然（待审核/已发放/驳回）
- **补贴发放管理** — 独立于申请的发放记录管理，支持代领/换人领取
- **代领（Proxy）管理** — 完整的代领关系管理，补贴统计自动区分实际受益人与领款人
- **村组快照机制** — 固化申请时的村组归属，解决跨年度村组变更统计失真问题
- **预检配置** — 每个项目可独立配置面积异常检查规则，导入时自动校验

### 🌱 土地流转与面积计算
- **土地流转台账** — 记录户间/村间土地流转关系（流出/流入），支持一年一签
- **多方流转** — 流出方/流入方支持家庭户、村集体、村组三种实体类型
- **补贴享受配置** — 每条流转记录可独立配置耕地地力/经济作物补贴的享受方
- **撂荒地管理** — 撂荒面积自动扣减耕地地力保护补贴
- **面积缓存机制** — 三级缓存 O(1) 增量更新，面积变更后台异步重算，页面操作无需等待
- **超领预警** — 按家庭户维度监控各季节补贴面积占用，自动提示超领风险

### 📊 统计与分析
- **仪表盘总览** — 补贴金额/面积/受益户数一览，月度趋势、村组对比
- **多维统计** — 按村、按组、按补贴类型、按季节多维度聚合
- **年度对比** — 跨年度数据同比分析
- **AI 年度分析** — （可选，需 Claude API）自动分析补贴数据，生成自然语言报告
- **项目进度矩阵** — 按村+项目维度跟踪各阶段工作进度（宣传/申报/公示/发放等）

### 📂 Excel 导入导出
- **智能列映射** — 自动识别 Excel 列名与系统字段的对应关系，支持模板保存复用
- **批量导入** — 支持农户信息、补贴申请、发放记录、确权面积等多种业务导入
- **导出报表** — 生成美观的 Excel 报表，包含数据汇总和错误明细
- **错误库** — 存储已验证的错误人员信息，导入时自动匹配并提示历史类似错误

### 🔌 系统功能
- **JWT 用户认证** — 用户名/密码登录，支持管理员与操作员角色
- **AUTH_DISABLED 本地模式** — 设置环境变量 `AUTH_DISABLED=1` 可跳过登录，本地使用更方便
- **用户管理** — 管理员可创建/启用/禁用用户账号
- **数据备份/恢复** — 一键备份与恢复，支持自动定时备份
- **外网查询集成** — 内嵌 iframe 直接访问工商、法院等外部查询网站
- **操作日志审计** — 记录关键操作（CRUD/导出/AI分析）的详细日志

### 🎨 界面与体验
- **新中式极简设计** — 深青绿主题色 + 水墨风格背景装饰
- **响应式布局** — 适配不同屏幕尺寸
- **连接状态指示** — 实时显示前后端连接状态
- **一键启动** — `start.bat` 自动安装依赖、初始化数据、打开浏览器

<h2 id="技术栈">🛠 技术栈</h2>

| 部分       | 技术                                                                                  |
|------------|---------------------------------------------------------------------------------------|
| 后端框架   | [FastAPI](https://fastapi.tiangolo.com/) + [SQLAlchemy 2.0](https://www.sqlalchemy.org/) |
| 数据库     | SQLite（默认），可扩展支持 PostgreSQL / MySQL                                          |
| 前端框架   | [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)          |
| 样式       | [Tailwind CSS](https://tailwindcss.com/)                                                 |
| 构建工具   | [Vite](https://vitejs.dev/)                                                             |
| 状态管理   | [Zustand](https://github.com/pmndrs/zustand)                                            |
| Excel 处理 | [openpyxl](https://openpyxl.readthedocs.io/)（导出）+ [SheetJS](https://sheetjs.com/)（导入） |
| AI 分析    | [Anthropic Claude API](https://www.anthropic.com/)（可选）                              |
| 认证       | JWT（PyJWT + bcrypt）                                                                   |
| 部署       | Uvicorn + 静态文件托管（单进程同时服务 API 和 SPA）                                      |

<h2 id="快速开始">🚀 快速开始</h2>

### 环境要求
- Python 3.11+
- Node.js 18+ 和 npm / pnpm
- Git（可选）

### 一键启动
```bash
start.bat
```
首次运行会自动：
1. 安装 Python 依赖
2. 初始化 SQLite 数据库
3. 构建前端
4. 启动后端服务
5. 打开浏览器访问 http://localhost:8000

### 手动启动
1. **安装依赖**
   ```bash
   # 后端
   pip install -r requirements.txt

   # 前端
   cd frontend && npm install
   ```

2. **构建前端**
   ```bash
   cd frontend && npm run build
   ```

3. **启动服务**
   ```bash
   cd .. && python main.py
   ```

服务运行在 http://localhost:8000
- 前端页面：http://localhost:8000
- API 文档：http://localhost:8000/docs
- 健康检查：http://localhost:8000/api/health

### 本地模式（免登录）
```bash
AUTH_DISABLED=1 python main.py
```
认证关闭后所有页面可直接访问，适合内网单机使用。

### 开发模式
前后端分离运行，支持热重载：
```bash
# 终端1：后端
python main.py

# 终端2：前端
cd frontend && npm run dev
```

### 配置 AI 分析（可选）
设置 Anthropic API Key 后可使用 AI 年度数据分析功能：
```bash
set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
```

<h2 id="使用指南">📘 使用指南</h2>

### 首次登录
- 默认管理员账号：`admin` / `admin123`
- 登录后可进入「系统设置 → 用户管理」创建操作员账号
- 本地模式（`AUTH_DISABLED=1`）无需登录

### 业务流程
```
村组管理 → 家庭户建档 → 农户信息录入 → 补贴类型配置 → 补贴申报/发放
                ↓                              ↑
           土地流转台账 ─── 面积联动 ────────┘
```

### 补贴季节说明
| 季节 | 说明 | 面积计算方式 |
|------|------|-------------|
| 大春 | 主要作物季节（水稻/玉米/大豆） | 种植面积（耕地保护面积+农户流入的种植面积），扣除撂荒 |
| 小春 | 次要作物季节（小麦/油菜） | 同上 |
| 耕地地力保护 | 全年一次性补贴 | 按承包地面积，扣除撂荒 |
| 临时 | 应急/临时性补贴 | 不纳入面积超领计算 |

### 面积计算逻辑
```
实发面积 = min(申报面积, 家庭可用面积上限 - 同季节已占用面积)
家庭可用面积上限 = 承包地面积 + 流入面积 - 流出面积 - 撂荒面积
```

<h2 id="项目结构">📂 项目结构</h2>

```
subsidy-system/
├── main.py                   # FastAPI 应用入口，启动迁移 + 索引
├── models.py                 # SQLAlchemy 数据模型（20+ 表）
├── schemas.py                # Pydantic 请求/响应模型
├── database.py               # 数据库引擎和会话管理
├── utils.py                  # 工具函数（身份证解析、脱敏、组号格式化）
├── export_utils.py           # Excel 导出工具
├── seed_data.py              # 示例数据初始化脚本
├── requirements.txt          # Python 依赖
├── routers/                  # API 路由模块
│   ├── auth.py              # JWT 认证 / 用户管理
│   ├── farmers.py           # 农户管理
│   ├── subsidies.py         # 补贴申请 + 发放（核心业务，80K+）
│   ├── households.py        # 家庭户管理
│   ├── land.py              # 土地流转台账
│   ├── large_farmers.py     # 大户管理
│   ├── project_progress.py  # 项目进度矩阵
│   ├── agri_tasks.py        # 农业任务分解
│   ├── ai_analyze.py        # AI 分析
│   ├── settings.py          # 系统设置
│   ├── backup.py            # 数据备份/恢复
│   ├── eligibility.py       # 补贴资格规则
│   ├── excel_templates.py   # Excel 模板管理
│   ├── error_library.py     # 错误库管理
│   ├── household_import.py  # 家庭户批量导入
│   └── external_links.py    # 外网查询
├── services/                 # 业务逻辑层
│   ├── subsidy_service.py   # 补贴计算核心逻辑
│   ├── household_service.py # 家庭户业务逻辑
│   ├── farmer_service.py    # 农户业务逻辑
│   └── check_config.py      # 预检配置规则
├── migrations/               # SQL 迁移脚本
│   ├── 001_split_village_group.sql
│   ├── 002_rename_season_quannian.sql
│   ├── 003_add_performance_indexes.sql
│   ├── 004_project_progress.sql
│   └── 005_village_leader.sql
├── frontend/                 # 前端 React 应用
│   ├── src/
│   │   ├── pages/           # 30+ 页面组件
│   │   ├── api/             # API 客户端
│   │   ├── components/      # 公共组件（Modal/Table/Toast/Icon）
│   │   ├── utils/           # 前端工具函数
│   │   └── types/           # TypeScript 类型定义
│   ├── public/images/       # UI 背景图片资源
│   ├── package.json
│   └── vite.config.ts
├── static/                   # 前端构建产物
├── tests/                    # 测试
│   ├── test_area_anomaly.py # 面积异常检查测试
│   └── __init__.py
├── docs/                     # 项目文档
│   ├── improvement_plan.md  # 改进方案
│   └── 大户管理扩展功能设计.md
├── start.bat                 # Windows 一键启动
├── UI_DESIGN_SPEC.md         # UI 设计规范
└── DEVELOPMENT.md            # 开发计划
```

<h2 id="架构设计">🏗️ 架构设计</h2>

### 核心数据模型

```
Village（村）→ VillageGroup（村组）
     ↓
FamilyHousehold（家庭户）→ FarmerProfile（农户成员）
     ↓                                ↓
LandTrust（土地流转）        SubsidyApplication（补贴申请）
                                  ↓
                            SubsidyPayment（补贴发放）

其他辅助模型：
User（用户） | AuditLog（操作日志） | HouseholdEvent（户事件）
SubsidyType（补贴类型） | SubsidyEligibilityRule（资格规则）
ExcelColumnTemplate（列模板） | ExcelImportLog（导入日志）
ErrorLibrary（错误库） | HouseholdAreaUsageCache（面积缓存）
LargeFarmer（大户） | LargeFarmerTrust（大户代耕关联）
LargeFarmerParcel（大户地块） | ProjectProgress（项目进度）
AgriTask（农业任务） | AgriTaskAllocation（任务分解）
```

### 认证与授权
- JWT Token 认证，支持 `admin`（管理员）和 `operator`（操作员）两种角色
- 依赖注入 `get_current_user` / `get_admin_user` 进行权限控制
- 环境变量 `AUTH_DISABLED` 支持本地免登录模式

### 村组快照机制
补贴申请/发放时，通过快照字段固化当时的村组归属：
1. 优先使用农户个人村组（`own_village_id`）
2. 否则使用家庭户所属村组
3. 启动时自动回填历史数据



<h2 id="许可证">📄 许可证</h2>

本项目采用 MIT 许可证。

---

<p align="center">
  <strong>农户补贴管理系统 v2.1.0</strong><br/>
  基于 FastAPI + React 的基层补贴管理解决方案<br/>
</p>
