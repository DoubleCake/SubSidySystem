#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  上传更新文件到服务器
#  用法: bash upload-update.sh
# ═══════════════════════════════════════════════════════════

# ── 配置：修改为你的服务器信息 ──
SERVER="root@你的服务器IP"              # 用户名@IP
REMOTE_DIR="/opt/updates"              # 服务器更新目录

echo "========================================"
echo "  上传更新到服务器"
echo "  $SERVER:$REMOTE_DIR"
echo "========================================"

# 检查产物
if [ ! -f "dist/latest.yml" ]; then
    echo "❌ 未找到 dist/latest.yml"
    echo "   请先运行: npm run dist"
    exit 1
fi

# 上传
echo ""
echo "📤 上传中..."
scp dist/latest.yml "dist/农户补贴管理系统 Setup"*.exe* "$SERVER:$REMOTE_DIR/"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ 上传完成！"
    echo "   版本: $(grep version dist/latest.yml)"
    echo "   验证: curl http://$(echo $SERVER | cut -d@ -f2):8080/latest.yml"
else
    echo ""
    echo "❌ 上传失败，请检查:"
    echo "   1. 服务器 IP 是否正确"
    echo "   2. SSH 密钥是否配置"
    echo "   3. 远程目录是否存在: $REMOTE_DIR"
fi
