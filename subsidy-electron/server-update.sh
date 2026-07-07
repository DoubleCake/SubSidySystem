#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  农户补贴管理系统 — 更新服务器管理脚本
#  优先使用 nginx，fallback 到 Python http.server
#  用法:
#    bash server-update.sh start         启动服务
#    bash server-update.sh stop          停止服务
#    bash server-update.sh restart       重启服务
#    bash server-update.sh status        查看状态
#    bash server-update.sh logs          查看日志
#    bash server-update.sh install       安装 nginx + 配置站点 (推荐)
# ═══════════════════════════════════════════════════════════

# ── 配置 ──
PORT=8080
UPDATE_DIR="/opt/updates"
NGINX_CONF="/etc/nginx/sites-available/update-server"
NGINX_ENABLED="/etc/nginx/sites-enabled/update-server"
LOG_FILE="/var/log/update-server.log"
PID_FILE="/var/run/update-server.pid"

mkdir -p "$UPDATE_DIR"

# ── 检测服务类型 ──
detect_server() {
  if command -v nginx &>/dev/null && [ -f "$NGINX_ENABLED" ]; then
    echo "nginx"
  elif [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
    echo "python"
  else
    # 默认优先 nginx
    command -v nginx &>/dev/null && echo "nginx" || echo "python"
  fi
}

# ── nginx 操作 ──
nginx_start() {
  if systemctl is-active --quiet nginx 2>/dev/null; then
    echo "nginx 已在运行"
  else
    systemctl start nginx
    echo "nginx 已启动"
  fi
  IP=$(hostname -I | awk '{print $1}')
  echo "地址: http://$IP:$PORT/"
  echo "目录: $UPDATE_DIR"
}

nginx_stop() {
  systemctl stop nginx
  echo "nginx 已停止"
}

nginx_restart() {
  systemctl restart nginx
  IP=$(hostname -I | awk '{print $1}')
  echo "nginx 已重启"
  echo "地址: http://$IP:$PORT/"
}

nginx_status() {
  systemctl status nginx --no-pager 2>/dev/null | head -6
  IP=$(hostname -I | awk '{print $1}')
  echo ""
  echo "验证: curl http://$IP:$PORT/latest.yml"
}

# ── Python fallback 操作 ──
python_start() {
  if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
    echo "更新服务已在运行 (PID: $(cat $PID_FILE))"
    return 1
  fi

  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  if [ -f "$SCRIPT_DIR/update-server.py" ]; then
    CMD="python3 $SCRIPT_DIR/update-server.py $PORT $UPDATE_DIR"
  else
    CMD="python3 -m http.server $PORT --bind 0.0.0.0 -d $UPDATE_DIR"
  fi

  echo "启动更新服务 (Python)..."
  cd "$UPDATE_DIR"
  nohup $CMD >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 1

  if kill -0 $(cat "$PID_FILE") 2>/dev/null; then
    IP=$(hostname -I | awk '{print $1}')
    echo "更新服务启动成功"
    echo "地址: http://$IP:$PORT/"
  else
    echo "启动失败，查看日志: tail $LOG_FILE"
    rm -f "$PID_FILE"
    return 1
  fi
}

python_stop() {
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

python_status() {
  if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
    IP=$(hostname -I | awk '{print $1}')
    echo "更新服务运行中 (PID: $(cat $PID_FILE))"
    echo "地址: http://$IP:$PORT/"
    echo "类型: Python http.server"
  else
    echo "更新服务未运行"
  fi
}

# ── 公共入口 ──
SERVER=$(detect_server)

start()   { [ "$SERVER" = "nginx" ] && nginx_start   || python_start; }
stop()    { [ "$SERVER" = "nginx" ] && nginx_stop    || python_stop; }
restart() { [ "$SERVER" = "nginx" ] && nginx_restart || (python_stop; sleep 1; python_start); }
status()  { [ "$SERVER" = "nginx" ] && nginx_status  || python_status; }

logs() {
  if [ "$SERVER" = "nginx" ]; then
    echo "=== Nginx 访问日志 ==="
    tail -f /var/log/nginx/access.log
  else
    tail -f "$LOG_FILE"
  fi
}

# ── 安装 nginx 并配置站点 ──
install() {
  if [ -f "$NGINX_ENABLED" ]; then
    echo "nginx 站点已配置"
    echo "重启: bash server-update.sh restart"
    return 0
  fi

  # 安装 nginx
  if ! command -v nginx &>/dev/null; then
    echo "安装 nginx..."
    apt update && apt install nginx -y || {
      echo "nginx 安装失败，回退到 Python 模式"
      SERVER="python"
      python_start
      return 1
    }
  fi

  # 配置站点
  cat > "$NGINX_CONF" << EOF
# 农户补贴管理系统 — 更新服务器
server {
    listen $PORT;
    server_name _;
    root $UPDATE_DIR;
    autoindex on;
    charset utf-8;

    # 大文件下载优化
    sendfile on;
    tcp_nopush on;
    aio threads;
    directio 5m;
    output_buffers 2 1m;

    # 允许跨域 (Electron fetch 需要)
    add_header Access-Control-Allow-Origin *;
}
EOF

  # 启用站点
  mkdir -p /etc/nginx/sites-enabled
  ln -sf "$NGINX_CONF" "$NGINX_ENABLED"
  rm -f /etc/nginx/sites-enabled/default

  # 测试配置并重载
  if nginx -t 2>&1; then
    # 释放 8080 端口（如果有旧进程）
    fuser -k $PORT/tcp 2>/dev/null
    systemctl restart nginx
    systemctl enable nginx
    IP=$(hostname -I | awk '{print $1}')
    echo ""
    echo "=== 安装完成 ==="
    echo "地址: http://$IP:$PORT/"
    echo "目录: $UPDATE_DIR"
    echo "管理: systemctl {start|stop|restart} nginx"
  else
    echo "nginx 配置测试失败，请检查 $NGINX_CONF"
    return 1
  fi
}

# ── CLI ──
case "${1:-start}" in
  start)   start   ;;
  stop)    stop    ;;
  restart) restart ;;
  status)  status  ;;
  logs)    logs    ;;
  install) install ;;
  *)
    echo "用法: bash server-update.sh {start|stop|restart|status|logs|install}"
    echo ""
    echo "  start    启动更新服务 (nginx 优先)"
    echo "  stop     停止更新服务"
    echo "  restart  重启更新服务"
    echo "  status   查看服务状态"
    echo "  logs     查看访问日志"
    echo "  install  安装 nginx + 配置更新站点"
    echo ""
    echo "模式: $(detect_server)"
    ;;
esac
