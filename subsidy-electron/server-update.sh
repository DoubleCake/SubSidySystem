#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  农户补贴管理系统 — 更新服务器启动脚本
#  用法:
#    bash server-update.sh start         启动服务 (后台)
#    bash server-update.sh stop          停止服务
#    bash server-update.sh restart       重启服务
#    bash server-update.sh status        查看状态
#    bash server-update.sh logs          查看日志
#    bash server-update.sh install       安装为 systemd 服务 (推荐)
# ═══════════════════════════════════════════════════════════

# ── 配置 ──
PORT=8080                                # 监听端口
UPDATE_DIR="/opt/updates"                 # 更新文件目录
LOG_FILE="/var/log/update-server.log"     # 日志文件
PID_FILE="/var/run/update-server.pid"     # PID 文件

# ── 确保目录和文件存在 ──
mkdir -p "$UPDATE_DIR"
touch "$LOG_FILE"

# ── 启动 ──
start() {
    if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
        echo "⚠️  更新服务已在运行 (PID: $(cat $PID_FILE))"
        echo "   地址: http://$(hostname -I | awk '{print $1}'):$PORT/"
        return 1
    fi

    echo "🚀 启动更新服务..."
    cd "$UPDATE_DIR"
    nohup python3 -m http.server $PORT --bind 0.0.0.0 >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 1

    if kill -0 $(cat "$PID_FILE") 2>/dev/null; then
        echo "✅ 更新服务启动成功"
        echo "   地址: http://$(hostname -I | awk '{print $1}'):$PORT/"
        echo "   目录: $UPDATE_DIR"
        echo "   日志: $LOG_FILE"
    else
        echo "❌ 启动失败，查看日志: tail -f $LOG_FILE"
        rm -f "$PID_FILE"
        return 1
    fi
}

# ── 停止 ──
stop() {
    if [ ! -f "$PID_FILE" ]; then
        echo "⚠️  更新服务未运行"
        return 1
    fi

    PID=$(cat "$PID_FILE")
    echo "⏸️  停止更新服务 (PID: $PID)..."
    kill $PID 2>/dev/null
    sleep 1

    if kill -0 $PID 2>/dev/null; then
        echo "⚠️  进程未响应，强制终止..."
        kill -9 $PID 2>/dev/null
    fi

    rm -f "$PID_FILE"
    echo "✅ 更新服务已停止"
}

# ── 重启 ──
restart() {
    stop
    sleep 1
    start
}

# ── 状态 ──
status() {
    if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
        PID=$(cat "$PID_FILE")
        IP=$(hostname -I | awk '{print $1}')
        echo "✅ 更新服务运行中"
        echo "   PID: $PID"
        echo "   地址: http://$IP:$PORT/"
        echo "   目录: $UPDATE_DIR"
        echo ""
        echo "   验证: curl http://$IP:$PORT/latest.yml"
    else
        echo "❌ 更新服务未运行"
        echo "   启动: bash server-update.sh start"
    fi
}

# ── 查看日志 ──
logs() {
    tail -f "$LOG_FILE"
}

# ── 安装 systemd 服务 ──
install() {
    SERVICE_FILE="/etc/systemd/system/update-server.service"

    if [ -f "$SERVICE_FILE" ]; then
        echo "⚠️  systemd 服务已存在"
        echo "   重启: systemctl restart update-server"
        echo "   查看: systemctl status update-server"
        return 0
    fi

    SCRIPT_PATH=$(readlink -f "$0")

    cat > "$SERVICE_FILE" << SERVICE_EOF
[Unit]
Description=农户补贴管理系统更新服务
After=network.target

[Service]
Type=simple
WorkingDirectory=$UPDATE_DIR
ExecStart=/usr/bin/python3 -m http.server $PORT --bind 0.0.0.0
Restart=always
RestartSec=5
StandardOutput=append:$LOG_FILE
StandardError=append:$LOG_FILE

[Install]
WantedBy=multi-user.target
SERVICE_EOF

    systemctl daemon-reload
    systemctl enable update-server
    systemctl start update-server

    echo "✅ systemd 服务安装完成"
    echo "   启动: systemctl start update-server"
    echo "   停止: systemctl stop update-server"
    echo "   状态: systemctl status update-server"
    echo "   开机自启: 已启用"
    echo "   地址: http://$(hostname -I | awk '{print $1}'):$PORT/"
}

# ── 主入口 ──
case "${1:-start}" in
    start)    start    ;;
    stop)     stop     ;;
    restart)  restart  ;;
    status)   status   ;;
    logs)     logs     ;;
    install)  install  ;;
    *)
        echo "用法: bash server-update.sh {start|stop|restart|status|logs|install}"
        echo ""
        echo "  start     启动服务 (后台运行)"
        echo "  stop      停止服务"
        echo "  restart   重启服务"
        echo "  status    查看运行状态"
        echo "  logs      实时查看访问日志"
        echo "  install   安装为 systemd 服务 (开机自启, 推荐)"
        exit 1
        ;;
esac
