#!/bin/bash
# ══════════════════════════════════════════════════════
# 发布更新到服务器 — 一键上传脚本
# 用法: bash deploy-update.sh
# ══════════════════════════════════════════════════════

# ── 配置：修改为你的服务器信息 ──
SERVER="user@your-server.com"
REMOTE_DIR="/var/www/updates/"          # 服务器上的更新目录
SERVER_URL="https://your-server.com/updates/"  # 用户访问的 URL

echo "========================================"
echo "  农户补贴管理系统 — 发布更新"
echo "========================================"

# 1. 构建安装包（生成 latest.yml + .exe + .blockmap）
echo ""
echo "[1/3] 构建安装包..."
npm run dist
if [ $? -ne 0 ]; then
  echo "❌ 构建失败"
  exit 1
fi

# 2. 检查产物
echo ""
echo "[2/3] 检查产物..."
cd dist
ls -lh *.exe *.yml *.blockmap 2>/dev/null
if [ $? -ne 0 ]; then
  echo "❌ 缺少产物文件，请确认 dist/ 目录"
  exit 1
fi

# 3. 上传到服务器
echo ""
echo "[3/3] 上传到服务器: $SERVER:$REMOTE_DIR"
echo "  如果使用 scp:"
echo "  scp dist/*.exe dist/*.yml dist/*.blockmap $SERVER:$REMOTE_DIR"
echo ""
echo "  如果使用 rsync:"
echo "  rsync -avz dist/*.exe dist/*.yml dist/*.blockmap $SERVER:$REMOTE_DIR"
echo ""
echo "========================================"
echo "  发布完成"
echo "  更新 URL: $SERVER_URL"
echo "========================================"
