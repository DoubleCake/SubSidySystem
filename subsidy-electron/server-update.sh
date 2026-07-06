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
PORT=8080
UPDATE_DIR="/opt/updates"
LOG_FILE="/var/log/update-server.log"
PID_FILE="/var/run/update-server.pid"

mkdir -p "$UPDATE_DIR"
touch "$LOG_FILE"

start() {
    if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
        echo "更新服务已在运行 (PID: $(cat $PID_FILE))"
        return 1
    fi

    echo "启动更新服务..."
    cd "$UPDATE_DIR"
    nohup python3 -m http.server $PORT --bind 0.0.0.0 >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 1

    if kill -0 $(cat "$PID_FILE") 2>/dev/null; then
        IP=$(hostname -I | awk '{print $1}')
        echo "更新服务启动成功"
        echo "地址: http://$IP:$PORT/"
        echo "目录: $UPDATE_DIR"
        echo "日志: $LOG_FILE"
    else
        echo "启动失败，查看日志: tail -f $LOG_FILE"
        rm -f "$PID_FILE"
        return 1
    fi
}

stop() {
    if [ ! -f "$PID_FILE" ]; then
        echo "更新服务未运行"
        return 1
    fi
    PID=$(cat "$PID_FILE")
    echo "停止更新服务 (PID: $PID)..."
    kill $PID 2>/dev/null
    sleep 1
    kill -0 $PID 2>/dev/null && kill -9 $PID 2>/dev/null
    rm -f "$PID_FILE"
    echo "更新服务已停止"
}

restart() { stop; sleep 1; start; }

status() {
    if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
        IP=$(hostname -I | awk '{print $1}')
        echo "更新服务运行中 (PID: $(cat $PID_FILE))"
        echo "地址: http://$IP:$PORT/"
        echo "验证: curl http://$IP:$PORT/latest.yml"
    else
        echo "更新服务未运行"
    fi
}

logs() { tail -f "$LOG_FILE"; }

install() {
    if [ -f /etc/systemd/system/update-server.service ]; then
        echo "systemd 服务已安装"
        echo "重启: systemctl restart update-server"
        return 0
    fi

    cat > /etc/systemd/system/update-server.service << 'EOF'
[Unit]
Description=更新服务
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/updates
ExecStart=/usr/bin/python3 -m http.server 8080 --bind 0.0.0.0
Restart=always
RestartSec=5
StandardOutput=append:/var/log/update-server.log
StandardError=append:/var/log/update-server.log

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable update-server
    systemctl start update-server

    IP=$(hostname -I | awk '{print $1}')
    echo "systemd 服务安装完成"
    echo "地址: http://$IP:$PORT/"
    echo "命令: systemctl {start|stop|status|restart} update-server"
}

case "${1:-start}" in
    start)   start   ;;
    stop)    stop    ;;
    restart) restart ;;
    status)  status  ;;
    logs)    logs    ;;
    install) install ;;
    *)
        echo "用法: bash server-update.sh {start|stop|restart|status|logs|install}"
        echo "  start    启动服务"
        echo "  stop     停止服务"
        echo "  install  安装为 systemd 服务(开机自启)"
        exit 1
        ;;
esac
