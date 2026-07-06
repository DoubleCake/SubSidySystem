#!/bin/bash
# ══════════════════════════════════════════════════════
# 发布更新到服务器 — 自动对齐文件名 + latest.yml
# 用法: bash deploy-update.sh
# ══════════════════════════════════════════════════════

set -e

# ── 配置：修改为你的服务器信息 ──
SERVER="root@8.137.8.78"
REMOTE_DIR="/opt/updates/"
SERVER_URL="http://8.137.8.78:8080/"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 1. 读取版本号
VERSION=$(node -p "require('./package.json').version")
echo "========================================"
echo "  发布更新 v$VERSION"
echo "  目标: $SERVER:$REMOTE_DIR"
echo "========================================"

# 2. 构建
echo ""
echo "[1/4] 构建应用..."
npx electron-vite build
echo "✅ 构建完成"

# 3. 打包
echo ""
echo "[2/4] 打包 (electron-builder --dir)..."
rm -rf dist
npx electron-builder --dir --win
echo "✅ 打包完成"

# 4. 标准化文件名
echo ""
echo "[3/4] 准备上传文件..."

APP_EXE="SubsidySystem.exe"
RELEASE_DIR="dist/release"
mkdir -p "$RELEASE_DIR"

# 复制 exe 为标准名称
cp "dist/win-unpacked/$APP_EXE" "$RELEASE_DIR/$APP_EXE"

# 计算 sha512（base64 默认每76字符换行，用 tr -d '\n' 去掉）
if command -v sha512sum &>/dev/null; then
  SHA512=$(sha512sum "$RELEASE_DIR/$APP_EXE" | awk '{print $1}' | xxd -r -p | base64 | tr -d '\n')
elif command -v shasum &>/dev/null; then
  SHA512=$(shasum -a 512 "$RELEASE_DIR/$APP_EXE" | awk '{print $1}' | xxd -r -p | base64 | tr -d '\n')
else
  SHA512="SKIP"
fi

EXE_SIZE=$(stat -f%z "$RELEASE_DIR/$APP_EXE" 2>/dev/null || stat -c%s "$RELEASE_DIR/$APP_EXE" 2>/dev/null)

# 生成 latest.yml（文件名自动对齐）
cat > "$RELEASE_DIR/latest.yml" << YEOF
version: $VERSION
files:
  - url: $APP_EXE
    sha512: $SHA512
    size: $EXE_SIZE
path: $APP_EXE
sha512: $SHA512
releaseDate: $(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
YEOF

# 同时复制到 resources/ 作为 app-update.yml（electron-updater 需要）
cp "$RELEASE_DIR/latest.yml" "dist/win-unpacked/resources/app-update.yml"

echo "✅ 准备完成:"
echo "   $APP_EXE ($(numfmt --to=iec $EXE_SIZE 2>/dev/null || echo ${EXE_SIZE} bytes))"
echo "   latest.yml (version: $VERSION)"
echo "   dist/win-unpacked/resources/app-update.yml (已创建)"

# 5. 上传
echo ""
echo "[4/4] 上传到 $SERVER:$REMOTE_DIR"
scp "$RELEASE_DIR/$APP_EXE" "$RELEASE_DIR/latest.yml" "$SERVER:$REMOTE_DIR"

echo ""
echo "========================================"
echo "  发布完成!"
echo "  验证: curl $SERVER_URL/latest.yml"
echo "========================================"
