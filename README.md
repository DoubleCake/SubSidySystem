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
  本地部署，数据脱敏，AI数据分析,简单高效，开箱即用。
</p>

---

## 📖 目录

- [功能特色](#-功能特色)
- [技术栈](#-技术栈)
- [快速开始](#-快速开始)
  - [环境要求](#环境要求)
  - [安装步骤](#安装步骤)
  - [启动服务](#启动服务)
- [使用指南](#-使用指南)
  - [农户档案管理](#农户档案管理)
  - [补贴类型与申请](#补贴类型与申请)
  - [数据统计与查询](#数据统计与查询)
  - [AI 智能分析](#ai-智能分析)
- [项目结构](#-项目结构)
- [贡献指南](#-贡献指南)
- [许可证](#-许可证)
- [联系我们](#-联系我们)

---

## ✨ 功能特色

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

---

## 🛠 技术栈

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

---

## 🚀 快速开始

### 环境要求

- Python 3.11+
- Node.js 18+ 和 npm / pnpm
- Git（可选）

### 安装步骤

1. **克隆仓库**
   ```bash
   git clone https://github.com/your-org/subsidy-system.git
   cd subsidy-system