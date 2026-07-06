#!/bin/bash
# ══════════════════════════════════════════════════════
# 发布更新到服务器 — 构建 NSIS 安装包 + latest.yml + blockmap
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
echo "[1/5] 构建应用..."
npx electron-vite build
echo "✅ 构建完成"

# 3. 打包为 NSIS 安装包（不用 --dir，确保生成 .exe 安装包）
echo ""
echo "[2/5] 打包 NSIS 安装包..."
rm -rf dist
npx electron-builder --win --publish never
echo "✅ 打包完成"

# 4. 准备发布文件
echo ""
echo "[3/5] 准备发布文件..."

RELEASE_DIR="dist/release"
mkdir -p "$RELEASE_DIR"

# 查找 NSIS 安装包（文件名格式: SubsidySystem Setup X.Y.Z.exe）
SETUP_FILE=$(ls dist/"SubsidySystem Setup $VERSION.exe" 2>/dev/null || echo "")
if [ -z "$SETUP_FILE" ]; then
  # 尝试模糊匹配
  SETUP_FILE=$(ls dist/SubsidySystem*.exe 2>/dev/null | head -1 || echo "")
fi
if [ -z "$SETUP_FILE" ]; then
  echo "❌ 错误: 未找到 NSIS 安装包！"
  echo "dist/ 目录中的 .exe 文件:"
  ls -la dist/*.exe 2>/dev/null || echo "  (无)"
  exit 1
fi

SETUP_NAME=$(basename "$SETUP_FILE")
cp "$SETUP_FILE" "$RELEASE_DIR/$SETUP_NAME"
echo "安装包: $SETUP_NAME"

# 复制 blockmap（用于差量更新，后续更新只需下载差异部分）
BLOCKMAP_FILE="${SETUP_NAME}.blockmap"
if [ -f "dist/$BLOCKMAP_FILE" ]; then
  cp "dist/$BLOCKMAP_FILE" "$RELEASE_DIR/$BLOCKMAP_FILE"
  echo "blockmap: $BLOCKMAP_FILE"
else
  echo "⚠️  警告: blockmap 未找到，差量更新不可用"
fi

# 计算 sha512（base64，electron-updater 用于完整性校验和差量更新）
if command -v sha512sum &>/dev/null; then
  SHA512=$(sha512sum "$RELEASE_DIR/$SETUP_NAME" | awk '{print $1}' | xxd -r -p | base64 | tr -d '\n')
elif command -v shasum &>/dev/null; then
  SHA512=$(shasum -a 512 "$RELEASE_DIR/$SETUP_NAME" | awk '{print $1}' | xxd -r -p | base64 | tr -d '\n')
else
  echo "❌ 错误: 需要 sha512sum 或 shasum 来计算文件哈希"
  exit 1
fi

EXE_SIZE=$(stat -c%s "$RELEASE_DIR/$SETUP_NAME" 2>/dev/null || stat -f%z "$RELEASE_DIR/$SETUP_NAME" 2>/dev/null)

echo "文件大小: $EXE_SIZE bytes ($(numfmt --to=iec $EXE_SIZE 2>/dev/null || echo ${EXE_SIZE}))"
echo "SHA512: $SHA512"

# 生成 latest.yml
cat > "$RELEASE_DIR/latest.yml" << YEOF
version: $VERSION
files:
  - url: $SETUP_NAME
    sha512: $SHA512
    size: $EXE_SIZE
path: $SETUP_NAME
sha512: $SHA512
releaseDate: $(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
YEOF

# 复制 versions.json（版本更新日志）
if [ -f "versions.json" ]; then
  cp versions.json "$RELEASE_DIR/versions.json"
  echo "✅ versions.json 已复制"
fi

echo "✅ latest.yml 已生成"

# 同时复制到 resources/ 作为 app-update.yml
if [ -d "dist/win-unpacked" ]; then
  cp "$RELEASE_DIR/latest.yml" "dist/win-unpacked/resources/app-update.yml"
  echo "✅ app-update.yml 已复制到 win-unpacked"
fi

echo ""
echo "================================================"
echo "  准备完成:"
echo "    $SETUP_NAME ($EXE_SIZE bytes)"
echo "    $BLOCKMAP_FILE"
echo "    latest.yml (v$VERSION)"
echo "================================================"

# 5. 上传
echo ""
echo "[4/5] 上传到 $SERVER:$REMOTE_DIR ..."
UPLOAD_FILES=("$RELEASE_DIR/$SETUP_NAME" "$RELEASE_DIR/$BLOCKMAP_FILE" "$RELEASE_DIR/latest.yml")
[ -f "$RELEASE_DIR/versions.json" ] && UPLOAD_FILES+=("$RELEASE_DIR/versions.json")
scp "${UPLOAD_FILES[@]}" "$SERVER:$REMOTE_DIR"

echo ""
echo "[5/5] 验证..."
echo "  $SERVER_URL/latest.yml"
curl -s "$SERVER_URL/latest.yml" || echo "  ⚠️ 无法访问，请检查服务器"

echo ""
echo "========================================"
echo "  发布完成!"
echo "========================================"
