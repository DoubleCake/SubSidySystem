# 🌾 农户补贴管理系统

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License">
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome">
  <img src="https://img.shields.io/badge/React-18.3.1-61dafb.svg" alt="React">
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
  - [安装步骤](#安装步骤)
  - [启动服务](#启动服务)
- [📘 使用指南](#使用指南)
  - [农户档案管理](#农户档案管理)
  - [补贴类型与申请](#补贴类型与申请)
  - [数据统计与查询](#数据统计与查询)
  - [AI 智能分析](#ai-智能分析)
- [📂 项目结构](#项目结构)
- [🤝 贡献指南](#贡献指南)
- [📄 许可证](#许可证)
- [📢 关注我们](#关注我们)
- [☕ 赞赏支持](#赞赏支持)

---

<h2 id="功能特色">✨ 功能特色</h2>

✅ **完整的农户档案管理**  
支持家庭户、农户信息增删改查，身份证自动解析出生日期与性别，银行卡号脱敏展示。

✅ **灵活的补贴类型配置**  
可按年度设定补贴标准（元/亩、元/户），支持中央/省级/县级资金来源。

✅ **补贴申请全流程跟踪**  
从申请到发放，状态一目了然（待审核、已发放、驳回），支持金额批量计算。

✅ **强大的数据统计仪表盘**  
总览卡片、月度趋势、村组对比，一键掌握补贴发放全局。

✅ **智能查询与记录**  
- **本地查询**：姓名/身份证/手机号模糊搜索，支持保存查询日志并添加备注。  
- **批量查询**：上传 Excel 一键查询多农户信息。  
- **外网查询**：内嵌 iframe，直接访问外部网站（如工商、法院查询）。  

✅ **AI 年度分析**（需配置 Claude API）  
自动分析年度补贴数据，指出异常并与上年对比，生成自然语言报告。

✅ **内网友好部署**  
一键启动脚本（`start.bat`）自动安装依赖、初始化数据、打开浏览器，无需复杂配置。

<h2 id="技术栈">🛠 技术栈</h2>

| 部分       | 技术                                                                                     |
|------------|------------------------------------------------------------------------------------------|
| 后端框架   | [FastAPI](https://fastapi.tiangolo.com/) + [SQLAlchemy 2.0](https://www.sqlalchemy.org/) |
| 数据库     | SQLite（默认） / 可替换为 PostgreSQL / MySQL                                             |
| 前端框架   | [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)           |
| 样式       | [Tailwind CSS](https://tailwindcss.com/) + [Ant Design](https://ant.design/)（可选）     |
| 构建工具   | [Vite](https://vitejs.dev/)                                                              |
| 状态管理   | [Zustand](https://github.com/pmndrs/zustand)                                             |
| 表格处理   | [xlsx](https://sheetjs.com/) 用于 Excel 导入导出                                         |
| AI 分析    | [Anthropic Claude API](https://www.anthropic.com/)（可选）                               |
| 部署       | Uvicorn + 静态文件托管                                                                    |

<h2 id="快速开始">🚀 快速开始</h2>

### 环境要求
- Python 3.11+
- Node.js 18+ 和 npm / pnpm
- Git（可选）

### 安装步骤
1. **克隆仓库**
   ```bash
   git clone https://github.com/your-org/subsidy-system.git
   cd subsidy-system
安装后端依赖
bash
运行
pip install -r requirements.txt
安装前端依赖
bash
运行
cd frontend   # 假设前端代码在 frontend 目录，若在根目录则直接执行
npm install   # 或 pnpm install
初始化数据库（可选）
bash
运行
python seed_data.py
该脚本会创建 SQLite 数据库并填充模拟数据（农户、补贴类型、申请记录）。
启动服务
方式一：一键启动（推荐）
双击运行 start.bat（Windows），将自动：
安装 Python 依赖（首次）
初始化数据库（首次）
构建前端并启动后端服务
打开浏览器访问 http://localhost:8000
方式二：手动启动
构建前端
bash
运行
cd frontend
npm run build   # 构建产物将输出到后端 static/ 目录
启动后端服务
bash
运行
cd ..
python main.py
服务默认运行在 http://localhost:8000，API 文档访问 http://localhost:8000/docs。
注意：开发时前后端分离运行，可分别执行：
后端：python main.py
前端：cd frontend && npm run dev
<h2 id="使用指南">📘 使用指南</h2>
<h2 id="项目结构">📂 项目结构</h2>

```bash
    subsidy-system/
    ├── backend/                   # 后端代码（或根目录）
    │   ├── main.py               # 应用入口
    │   ├── models.py             # SQLAlchemy 模型
    │   ├── schemas.py            # Pydantic 数据模型
    │   ├── routers/              # 路由模块
    │   │   ├── farmers.py
    │   │   ├── subsidies.py
    │   │   ├── ai_analyze.py
    │   │   ├── stats.py          # 统计接口
    │   │   └── query.py          # 查询接口
    │   ├── utils.py              # 工具函数（脱敏、身份证解析）
    │   ├── database.py           # 数据库连接
    │   ├── seed_data.py          # 模拟数据填充
    │   └── requirements.txt      # Python 依赖
    ├── frontend/                  # 前端代码
    │   ├── index.html
    │   ├── package.json
    │   ├── vite.config.ts
    │   ├── src/
    │   │   ├── pages/
    │   │   ├── api/
    │   │   ├── store/
    │   │   └── ...
    ├── static/                    # 前端构建产物（自动生成）
    ├── .gitignore
    ├── .gitattributes
    ├── start.bat                  # Windows 启动脚本

<h2 id="使用指南">📘 使用指南</h2>
<h2 id="项目结构">📂 项目结构</h2>

```bash
   git clone https://github.com/your-org/subsidy-system.git
   cd subsidy-system

安装后端依赖
<h2 id ="" > xce </h2> 
<h2 id="贡献指南">🤝 贡献指南</h2>

我们欢迎任何形式的贡献！如果您想参与：

Fork 本仓库
创建您的特性分支 (git checkout -b feature/AmazingFeature)
提交您的修改 (git commit -m 'Add some AmazingFeature')
推送到分支 (git push origin feature/AmazingFeature)
打开一个 Pull Request
请确保代码风格符合项目规范（ESLint + Prettier + Black），并添加必要的单元测试。

<h2 id="许可证">📄 许可证</h2>


本项目采用 MIT 许可证，详情请参阅 LICENSE 文件。
<h2 id="关注我们">📢 关注我们</h2>


<p align="center"><a href="https://www.douyin.com/user/your-douyin-id" target="_blank"><img src="https://img.icons8.com/color/48/000000/douyin--v1.png" alt="抖音" width="48" height="48"/></a><a href="https://space.bilibili.com/your-bilibili-id" target="_blank"><img src="https://img.icons8.com/color/48/000000/bilibili.png" alt="B站" width="48" height="48"/></a></p>
<p align="center">在抖音/B站搜索 <b>@你的账号名</b> 观看项目开发日志、功能演示与技术分享！</p>
<h2 id="赞赏支持">☕ 赞赏支持</h2>
<p align="center">如果这个项目对您有帮助，欢迎请我喝杯咖啡，您的支持是我持续更新的动力！</p>
<p align="center"><img src="https://your-domain.com/path/to/alipay-qrcode.png" alt="支付宝赞赏码" width="200"/><br/><em>支付宝扫码赞赏</em></p>
<p align="center"><strong>或者通过以下方式支持：</strong><br/><a href="https://afdian.net/a/your-id">爱发电</a> · <a href="https://patreon.com/your-id">Patreon</a></p>
<p align="center">⭐️ 如果这个项目对您有帮助，请给我们一个 Star！ ⭐️</p>```