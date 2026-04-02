# 🌾 农户补贴管理系统

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License">
  <img src="https://img.shields.io/badge/Python-3.11+-3776AB.svg" alt="Python">
  <img src="https://img.shields.io/badge/React-18-61dafb.svg" alt="React">
  <img src="https://img.shields.io/badge/FastAPI-0.111.0-009688.svg" alt="FastAPI">
  <img src="https://img.shields.io/badge/SQLite-3-07405E.svg" alt="SQLite">
</p>

<p align="center">
  一个为基层政府/合作社量身定制的<b>农户补贴管理</b>系统，提供农户档案、补贴发放、数据统计、AI分析及便捷查询功能。<br />
  内网本地部署，简单高效，开箱即用。
</p>

---

## 📖 目录
- [✨ 功能特色](#功能特色)
- [🛠 技术栈](#技术栈)
- [🚀 快速开始](#快速开始)
  - [环境要求](#环境要求)
  - [一键启动](#一键启动)
  - [手动启动](#手动启动)
  - [开发模式](#开发模式)
- [📂 项目结构](#项目结构)
- [🏗️ 架构设计](#架构设计)
  - [核心模型](#核心模型)
  - [补贴季节分类](#补贴季节分类)
  - [村组快照机制](#村组快照机制)
  - [API设计](#api设计)
- [🤝 贡献指南](#贡献指南)
- [📄 许可证](#许可证)

---

<h2 id="功能特色">✨ 功能特色</h2>

✅ **完整的农户档案管理**  
支持家庭户、农户信息增删改查，身份证自动解析出生日期与性别，银行卡号脱敏展示。农户可独立于家庭户设置个人所属村组。

✅ **灵活的补贴类型配置**  
可按年度设定补贴标准（元/亩、元/户），支持中央/省级/县级资金来源，支持补贴季节分类（大春/小春/全年单补/临时）。

✅ **补贴申请全流程跟踪**  
从申请到发放，状态一目了然（待审核、已发放、驳回），支持金额批量计算。**新增村组快照机制**，固化申请时的村组归属，解决跨年度村组变更统计失真问题。

✅ **强大的数据统计仪表盘**  
总览卡片、月度趋势、村组对比，一键掌握补贴发放全局。支持按村、组、补贴类型多维度分析。

✅ **Excel批量处理**  
- **导入**：支持农户信息、补贴申请批量导入，自动数据校验和预检报告
- **导出**：使用openpyxl生成美观的Excel报表，包含数据汇总和错误明细
- **预检报告**：导入前自动检查格式错误、村组不存在、身份证重复、面积异常等问题

✅ **土地流转台账管理**  
记录承包地流转关系（流出/流入），支持按年度查询，与补贴面积计算联动。

✅ **智能查询与记录**  
- **本地查询**：姓名/身份证/手机号模糊搜索，支持保存查询日志并添加备注
- **批量查询**：上传Excel一键查询多农户信息
- **外网查询**：内嵌iframe直接访问外部网站（如工商、法院查询）

✅ **AI年度分析**（需配置Claude API）  
自动分析年度补贴数据，指出异常并与上年对比，生成自然语言报告。

✅ **错误库管理**  
维护常见错误类型库，导入时自动匹配并提示历史类似错误。

✅ **内网友好部署**  
一键启动脚本（`start.bat`）自动安装依赖、初始化数据、打开浏览器，无需复杂配置。单进程同时服务API和前端SPA。

<h2 id="技术栈">🛠 技术栈</h2>

| 部分       | 技术                                                                                     |
|------------|------------------------------------------------------------------------------------------|
| 后端框架   | [FastAPI](https://fastapi.tiangolo.com/) + [SQLAlchemy 2.0](https://www.sqlalchemy.org/) |
| 数据库     | SQLite（默认），支持 PostgreSQL / MySQL                                                  |
| 前端框架   | [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)           |
| 样式       | [Tailwind CSS](https://tailwindcss.com/) + [Ant Design](https://ant.design/)             |
| 构建工具   | [Vite](https://vitejs.dev/)                                                              |
| 状态管理   | [Zustand](https://github.com/pmndrs/zustand)                                             |
| Excel处理  | [openpyxl](https://openpyxl.readthedocs.io/)（导出）+ [xlsx](https://sheetjs.com/)（导入）|
| AI分析     | [Anthropic Claude API](https://www.anthropic.com/)（可选）                               |
| 部署       | Uvicorn + 静态文件托管（单进程同时服务API和SPA）                                         |

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
1. 安装Python依赖（requirements.txt）
2. 初始化SQLite数据库（seed_data.py）
3. 构建前端（npm run build）
4. 启动后端服务（uvicorn）
5. 打开浏览器访问 http://localhost:8000

### 手动启动
1. **安装依赖**
   ```bash
   # 后端
   pip install -r requirements.txt
   
   # 前端
   cd frontend
   npm install
   ```
   
2. **初始化数据库**（可选，创建示例数据）
   ```bash
   python seed_data.py
   ```

3. **构建前端**
   ```bash
   cd frontend
   npm run build
   ```

4. **启动服务**
   ```bash
   cd ..
   python main.py
   ```
   
服务运行在 http://localhost:8000
- 前端页面：http://localhost:8000
- API文档：http://localhost:8000/docs
- 健康检查：http://localhost:8000/api/health

### 开发模式
开发时可前后端分离运行，支持热重载：
```bash
# 终端1：后端
python main.py

# 终端2：前端
cd frontend && npm run dev
```
<h2 id="使用指南">📘 使用指南</h2>
<h2 id="项目结构">📂 项目结构</h2>

```
subsidy-system/
├── main.py                      # FastAPI应用入口，包含数据库迁移和索引创建
├── models.py                    # SQLAlchemy数据模型（村、家庭户、农户、补贴等）
├── schemas.py                   # Pydantic请求/响应模型
├── database.py                  # 数据库连接引擎和会话管理
├── utils.py                     # 工具函数（身份证解析、脱敏处理、组号格式化）
├── export_utils.py              # Excel导出工具（使用openpyxl，支持美观样式）
├── seed_data.py                 # 数据库初始化脚本（创建表并填充示例数据）
├── requirements.txt             # Python依赖包列表
├── routers/                     # API路由模块
│   ├── farmers.py              # 农户管理接口
│   ├── subsidies.py            # 补贴申请和发放接口
│   ├── ai_analyze.py           # AI分析接口
│   ├── settings.py             # 系统设置接口
│   ├── precheck.py             # Excel预检接口
│   ├── households.py           # 家庭户管理接口
│   ├── external_links.py       # 外网查询接口
│   ├── backup.py               # 数据备份接口
│   ├── eligibility.py          # 补贴资格规则接口
│   ├── excel_templates.py      # Excel模板管理接口
│   ├── land.py                 # 土地流转台账接口
│   └── error_library.py        # 错误库管理接口
├── frontend/                    # 前端React应用
│   ├── src/
│   │   ├── pages/              # 页面组件
│   │   ├── api/                # API客户端
│   │   ├── components/         # 公共组件
│   │   ├── hooks/              # 自定义Hooks
│   │   ├── utils/              # 前端工具函数
│   │   └── types/              # TypeScript类型定义
│   ├── package.json
│   ├── vite.config.ts
│   └── index.html
├── static/                      # 前端构建产物（自动生成，由main.py托管）
├── start.bat                    # Windows一键启动脚本
├── CLAUDE.md                    # Claude Code项目指导文档
└── README.md                    # 项目说明文档
```

 
<h2 id="架构设计">🏗️ 架构设计</h2>

### 核心模型
- **Village** - 行政村，管理村组结构
- **FamilyHousehold** - 家庭户，包含 `village_id`、`group_no`（整数，1=一组）、`head_farmer_id`（户主）
- **FarmerProfile** - 农户，关联家庭户 (`household_id`)，可独立设置个人所属村组 (`own_village_id`/`own_group_no`)
- **SubsidyType** - 补贴类型，按年度配置，支持季节分类
- **SubsidyApplication** - 补贴申请，关联农户+补贴类型+年度，包含承包地面积、流转面积等
- **SubsidyPayment** - 补贴发放记录，关联申请记录
- **LandTrust** - 土地流转台账，记录户间流转关系（流出/流入）
- **HouseholdEvent** - 家庭户变更事件，记录历史变化
- **ErrorLibrary** - 错误类型库，用于导入预检

### 补贴季节分类
补贴类型通过 `season` 字段进行分类，用于面积计算和统计分组：
- **大春** - 主要作物季节
- **小春** - 次要作物季节  
- **全年单补** - 全年一次性补贴
- **临时** - 临时性补贴

### 村组快照机制
为解决农户跨年度村组变更导致的统计失真问题，系统实现了**村组快照**：

**快照字段**（在创建时固化）：
- `apply_village_id` / `apply_group_no` - 申请时村组ID（快照）
- `apply_village_name` / `apply_group_display` - 冗余存储显示名称
- `payment_village_id` / `payment_group_no` - 发放时村组ID（快照）

**快照策略**：
1. 优先使用农户个人村组 (`own_village_id`/`own_group_no`)
2. 否则使用家庭户村组 (`household.village_id`/`household.group_no`)

**历史数据回填**：
- 系统启动时自动用当前农户状态回填历史记录的村组快照
- 确保历史统计数据的准确性

**数据库迁移**：
- 启动时自动执行 `ALTER TABLE` 添加新列（幂等操作）
- 自动创建性能索引

### API设计
- 所有接口使用 `/api/<domain>` 前缀（如 `/api/farmers`、`/api/subsidies`）
- 使用原生SQL + LEFT JOIN 代替ORM关系，避免懒加载问题
- 统一的错误处理和响应格式

<h2 id="贡献指南">🤝 贡献指南</h2>

欢迎提交 Issue 和 Pull Request 来改进项目！

1. **Fork 本仓库**
2. **创建特性分支** (`git checkout -b feature/your-feature`)
3. **提交更改** (`git commit -m 'Add some feature'`)
4. **推送到分支** (`git push origin feature/your-feature`)
5. **打开 Pull Request**

请确保代码风格符合项目规范，并添加必要的测试。

<h2 id="许可证">📄 许可证</h2>

本项目采用 MIT 许可证，详情请参阅 LICENSE 文件。

---

<p align="center">
  <strong>农户补贴管理系统 v2.0.0</strong><br/>
  基于 FastAPI + React 的基层补贴管理解决方案<br/>
  ⭐️ 如果您觉得这个项目有用，请给我们一个 Star！ ⭐️
</p>```