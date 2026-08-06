# 部署指南

## 开发环境

本地开发需要同时运行三个服务，详见 [环境搭建与快速启动](../development/getting-started.md)。

端口规划：

| 服务 | 端口 |
|------|------|
| 前端 (Next.js dev) | 3000 |
| RunningHub | 8080 |
| Tenant Service | 8081 |

## 生产环境部署（Linux）

### 1. 环境准备

```bash
# 安装 Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# 安装 pnpm
npm install -g pnpm

# 安装 Python 3.10+
sudo apt install -y python3 python3-venv python3-pip
```

### 2. 部署目录结构

```
/home/appadmin/Fasium/
├── comfyui-clothing/
├── comfyui-tenant-service/
└── comfyui-runninghub/
```

### 3. 配置各服务

#### RunningHub

```bash
cd /home/appadmin/Fasium/comfyui-runninghub
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 编辑 .env
# RUNNINGHUB_API_KEY=你的API密钥
# RUNNINGHUB_HOST=https://www.runninghub.cn
```

#### Tenant Service

```bash
cd /home/appadmin/Fasium/comfyui-tenant-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 编辑 .env
# SECRET_KEY=生产环境密钥（随机字符串）
# STORAGE_TYPE=mysql
# MYSQL_HOST=localhost
# MYSQL_PORT=3306
# MYSQL_USER=fasium
# MYSQL_PASSWORD=密码
# MYSQL_DATABASE=comfyui_tenant_service
```

#### 前端

```bash
cd /home/appadmin/Fasium/comfyui-clothing
pnpm install

# 编辑 .env
# NEXT_PUBLIC_TENANT_API_URL=http://localhost:8081
```

### 4. 使用一键脚本启动

```bash
# 启动所有服务
./start_fashion_ai.sh start

# 查看状态
./start_fashion_ai.sh status

# 停止所有服务
./start_fashion_ai.sh stop

# 重启
./start_fashion_ai.sh restart
```

启动顺序：RunningHub (8080) → Tenant Service (8081) → 前端构建 + 启动 (3000)

### 5. 日志查看

```bash
# RunningHub 日志
tail -f /home/appadmin/Fasium/comfyui-runninghub/uvicorn.log

# Tenant Service 日志
tail -f /home/appadmin/Fasium/comfyui-tenant-service/uvicorn.log

# 前端日志
tail -f /home/appadmin/Fasium/comfyui-clothing/output.log
```

## 存储模式选择

| 模式 | 适用场景 | 优势 | 限制 |
|------|----------|------|------|
| JSON | 开发/演示 | 无需数据库，零配置 | 无并发支持 |
| SQLite | 小型部署 | 单文件，易备份 | 并发写入有限 |
| MySQL | 生产环境 | 高并发，可靠性强 | 需要独立数据库服务 |

生产环境推荐使用 MySQL。

## CORS 与域名绑定

后端服务的 CORS 白名单在 `main.py` 中配置。若绑定新域名，需更新：

- `comfyui-tenant-service/app/main.py` 的 `allow_origins`
- `comfyui-runninghub/app/main.py` 的 `allow_origins`

当前已配置的域名：
- `https://fashion.jototech.cn`
- `https://fasium.cn`
- `https://fasium.ai`

## 反向代理（可选）

如使用 Nginx 反向代理：

```nginx
server {
    listen 80;
    server_name fasium.cn;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

前端的 Next.js standalone 模式（`output: 'standalone'`）已在 `next.config.mjs` 中配置。
