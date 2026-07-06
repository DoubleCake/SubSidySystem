# 更新服务器配置指南

## 你需要准备

- 一台有公网 IP 的服务器（你自己的云服务器）
- 一个域名（可选，直接用 IP 也行）
- 服务器上已安装 Nginx（推荐）或 Python3

---

## 方案一：Python 一键启动（最简单，适合测试）

只需 Python3，无需安装任何东西。

### 1. 创建更新目录并上传文件

```bash
# SSH 登录服务器
ssh root@你的服务器IP

# 创建目录
mkdir -p /opt/updates

# （从本地电脑上传）在本地执行：
scp dist/latest.yml "dist/农户补贴管理系统 Setup 3.*.exe*" root@你的服务器IP:/opt/updates/
```

### 2. 启动 HTTP 服务

```bash
# 方式 A: 前台运行
cd /opt/updates && python3 -m http.server 8080 --bind 0.0.0.0

# 方式 B: 后台运行
cd /opt/updates && nohup python3 -m http.server 8080 --bind 0.0.0.0 &

# 方式 C: 用 systemd 持久运行
cat > /etc/systemd/system/update-server.service << 'EOF'
[Unit]
Description=Update Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/updates
ExecStart=/usr/bin/python3 -m http.server 8080 --bind 0.0.0.0
Restart=always

[Install]
WantedBy=multi-user.target
EOF

systemctl enable update-server
systemctl start update-server
```

### 3. 用户配置

软件中填写：`http://你的服务器IP:8080/`

---

## 方案二：Nginx 静态站点（推荐，专业稳定）

### 1. 安装 Nginx

```bash
# Ubuntu/Debian
apt update && apt install nginx -y

# CentOS/RHEL
yum install nginx -y
```

### 2. 创建更新目录

```bash
mkdir -p /var/www/updates
chmod 755 /var/www/updates
```

### 3. 上传文件

```bash
# 本地执行
scp dist/latest.yml "dist/农户补贴管理系统 Setup 3.*.exe*" root@你的服务器IP:/var/www/updates/
```

### 4. 配置 Nginx

```bash
cat > /etc/nginx/sites-available/updates << 'EOF'
server {
    listen 80;
    server_name 你的域名.com;   # 或用 _ 匹配所有

    # 更新文件目录
    location /updates/ {
        alias /var/www/updates/;
        add_header Access-Control-Allow-Origin *;
        autoindex on;  # 浏览器中可以看到文件列表
    }
}
EOF

# 启用站点
ln -s /etc/nginx/sites-available/updates /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 5. 验证

```bash
curl http://你的服务器IP/updates/latest.yml
# 应返回 latest.yml 内容
```

### 6. 用户配置

软件中填写：`http://你的服务器IP/updates/`

---

## 方案三：Nginx + HTTPS（生产环境推荐）

更新文件涉及软件分发，建议启用 HTTPS 防止篡改。

### 1. 完成方案二的前 4 步

### 2. 配置 HTTPS（Let's Encrypt 免费证书）

```bash
# 安装 certbot
apt install certbot python3-certbot-nginx -y

# 自动获取证书并配置 nginx
certbot --nginx -d 你的域名.com

# 证书会自动续期
```

### 3. 用户配置

软件中填写：`https://你的域名.com/updates/`

---

## 每次发布新版本时

无论用哪种方案，只需 3 步：

```bash
# 1. 本地修改版本号（package.json: "version": "3.2.0"）
# 2. 构建
cd subsidy-electron && npm run dist

# 3. 上传到服务器（覆盖旧文件）
scp dist/latest.yml "dist/农户补贴管理系统 Setup 3.2.0.exe*" root@你的服务器IP:/更新目录/
```

不需要重启服务器。旧版本安装包可以保留不删，用户可以选择性回滚。

---

## 防火墙配置

如果服务器有防火墙，需要开放对应端口：

```bash
# 方案一 (Python 8080 端口)
ufw allow 8080

# 方案二/三 (Nginx 80/443)
ufw allow 80
ufw allow 443
```

---

## 常见问题

**Q: 用户连不上服务器？**
```bash
# 在服务器上检查端口是否监听
netstat -tlnp | grep -E '80|443|8080'

# 检查防火墙
ufw status
```

**Q: latest.yml 返回 404？**
```bash
# 确认文件存在且 Nginx 用户可读
ls -la /var/www/updates/
chmod 644 /var/www/updates/*
```

**Q: 客户端报 "checking for update" 超时？**
可能是 HTTPS 证书问题或 DNS 解析问题。先用方案一 IP:端口 测试，确认网络通后再切 HTTPS。
