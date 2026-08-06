# Fasium EU 腾讯云部署文档

## 1. 适用范围

这份文档记录的是当前 Fasium 项目在法兰克福腾讯云服务器上的独立部署方式。
登录EU服务器的ssh账号和密码：
ubuntu
!QAZxsw2

当前 EU 环境的部署方式是：

- 服务器上保留一份独立源码
- 通过 `docker compose` 直接 `build` 和 `up -d`
- 前端由 Nginx 统一反代到 `3000`
- 输出文件默认写入腾讯云 COS

## 2. 服务器信息

- 服务器 IP：`162.62.63.71`
- SSH 用户：`ubuntu`
- 应用目录：`/data/fasium/app`
- 运行时数据目录：`/data/fasium/runtime`
- 前端入口：`80 / 443 -> 127.0.0.1:3000`

说明：

- 当前这台机器上已经安装了 Docker、Docker Compose 和 Nginx
- 线上访问建议走域名 `fasium.ai`，也可以临时直接用 IP 验证
- `ubuntu` 账号通常需要 `sudo` 才能执行 Docker 命令

## 3. 当前部署拓扑

EU 环境的容器拓扑如下：

- `fasium-frontend`
- `fasium-tenant`
- `fasium-tenant-worker`
- `fasium-runninghub`
- `fasium-postgres`
- `fasium-redis`

对外端口：

- `3000`：frontend
- `8081`：tenant-service
- `8080`：runninghub-service
- `5432`：PostgreSQL
- `6379`：Redis

## 4. 部署原则

EU 环境遵循下面这几条原则：

1. 不直接用上海环境的 `.env.tencent` 覆盖 EU 环境。
2. EU 环境使用自己独立的 `.env.tencent`。
3. EU 环境的 COS、VOD、域名和 Nginx 都按法兰克福这台机器单独配置。
4. 发布顺序固定为：
   1. `tenant-service` + `tenant-worker`
   2. `frontend`
5. 变更前先备份远端配置文件。

## 5. 目录约定

### 5.1 应用目录

```bash
/data/fasium/app
```

这里放：

- 源码
- `docker-compose.tencent.yml`
- `.env.tencent`

### 5.2 持久化目录

```bash
/data/fasium/runtime/tenant/database
/data/fasium/runtime/tenant/output
/data/fasium/runtime/tenant/tenant_service.db
```

### 5.3 Nginx 配置

仓库里保留了一份可复用配置：

- `deploy/nginx/fasium.conf`

线上实际安装时可以放到：

```bash
/etc/nginx/sites-available/fasium.conf
```

再链接到：

```bash
/etc/nginx/sites-enabled/fasium.conf
```

## 6. EU 环境变量要点

EU 环境的 `.env.tencent` 里，重点关注这些项：

```env
STORAGE_TYPE=postgresql
POSTGRES_HOST=172.17.0.7
POSTGRES_PORT=5432
POSTGRES_USER=...
POSTGRES_PASSWORD=...
POSTGRES_DATABASE=postgres

REDIS_URL=redis://redis:6379/0
TASK_QUEUE_ENABLED=true
TASK_QUEUE_NAME=tenant-task-completion

OUTPUT_STORAGE_BACKEND=cos
OUTPUT_COS_BUCKET=fasiumeu-1408534747
OUTPUT_COS_REGION=eu-frankfurt
OUTPUT_COS_PREFIX=root/fasium/output
OUTPUT_COS_PUBLIC_BASE_URL=https://fasiumeu-1408534747.cos.eu-frankfurt.myqcloud.com

IMAGE_PROVIDER=vod
VOD_REGION=ap-guangzhou
VOD_ENDPOINT=vod.tencentcloudapi.com
VOD_SUB_APP_ID=1408534747
VOD_TASK_POLL_INTERVAL_SECONDS=2
VOD_TASK_TIMEOUT_SECONDS=300
VOD_HTTP_TIMEOUT_MS=300000

POLL_INTERVAL_SECONDS=8
MAX_POLL_SECONDS=300
REQUEST_TIMEOUT_SECONDS=60
```

说明：

- `OUTPUT_COS_PREFIX` 是 COS 桶里的目录前缀，当前默认是 `root/fasium/output`
- `VOD_TASK_TIMEOUT_SECONDS` 建议至少 `300`
- `VOD_HTTP_TIMEOUT_MS` 建议至少 `300000`
- 真正的密钥值不要写进文档正文，放在远端 `.env.tencent` 即可

## 7. 推荐发布流程

### 7.1 本地先校验 compose

在仓库根目录执行：

```bash
docker compose --env-file .env.tencent -f docker-compose.tencent.yml config
```

如果这里报错，先修复 compose 或环境变量，再同步到服务器。

### 7.2 同步源码到服务器

建议只同步需要部署的内容：

- `docker-compose.tencent.yml`
- `.env.tencent.example`
- `deploy/nginx/fasium.conf`
- `comfyui-clothing/`
- `comfyui-tenant-service/`
- `comfyui-runninghub/`
- `scripts/`

同步到：

```bash
/data/fasium/app
```

### 7.3 备份远端配置

在服务器上先备份当前版本：

```bash
cd /data/fasium
TS=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/data/fasium/backups/deploy_$TS"
mkdir -p "$BACKUP_DIR"

cd /data/fasium/app
cp docker-compose.tencent.yml "$BACKUP_DIR/docker-compose.tencent.yml"
cp .env.tencent "$BACKUP_DIR/.env.tencent"
```

### 7.4 发布 tenant

先更新后端服务：

```bash
cd /data/fasium/app
sudo docker compose --env-file .env.tencent -f docker-compose.tencent.yml up -d --build tenant-service tenant-worker
```

验证：

```bash
sudo docker compose --env-file .env.tencent -f docker-compose.tencent.yml ps
curl http://127.0.0.1:8081/health
curl http://127.0.0.1:8080/health
```

### 7.5 发布 frontend

tenant 正常后，再更新前端：

```bash
cd /data/fasium/app
sudo docker compose --env-file .env.tencent -f docker-compose.tencent.yml up -d --build frontend
```

验证：

```bash
curl -I http://127.0.0.1:3000/
sudo docker compose --env-file .env.tencent -f docker-compose.tencent.yml ps
```

## 8. Nginx 入口配置

线上建议把 `fasium.ai` 和 `www.fasium.ai` 都指向这台服务器，然后由 Nginx 统一反代到 `3000`。

仓库中的参考配置是：

- `deploy/nginx/fasium.conf`

关键点：

- `80` 端口反代到 `127.0.0.1:3000`
- `443` 端口反代到 `127.0.0.1:3000`
- `server_name` 建议显式写成 `fasium.ai www.fasium.ai`
- 如果要让用户访问 `3001` 上的落地页，不要直接放行 `3001`，建议单独配置子域名，例如 `landing.fasium.ai`，再由 Nginx 反代到 `127.0.0.1:3001`
- `landing.fasium.ai` 需要先在 DNS 里指向 `162.62.63.71`，并且 HTTPS 证书要覆盖这个子域名
- 证书可以继续沿用这台机器上现有的 Let\'s Encrypt 体系，但需要重新签发/扩展到包含 `landing.fasium.ai`
- 证书扩展只能解决 TLS 校验，不能替代 DNS 解析；如果 `landing.fasium.ai` 没有先解析到这台机器，浏览器仍然无法访问
- 如果 `landing.fasium.ai` 前面还有一层 ELB / CDN / 反向代理，务必透传 `X-Forwarded-Host`，否则应用里的 HTTPS 跳转可能会把 URL 改成源站 IP
- 如果访问 `https://landing.fasium.ai/` 后地址栏变成 `https://162.62.63.71/`，先查公网最前面那一层的返回头；如果 `Server` 不是 `nginx/1.18.0 (Ubuntu)` 而是 AWS/ELB/内部主机名，说明改写发生在上游，不是 `162.62.63.71:3001` 容器本身
- 这种情况下，最短修复路径通常是：让 `landing.fasium.ai` 的公网 DNS 直接指向 `162.62.63.71`，或者修改上游代理不要重定向到 IP，并在真正终止 TLS 的那一层安装 `landing.fasium.ai` 证书

常用命令：

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl status nginx
```

## 9. COS 配置说明

EU 环境当前使用腾讯云 COS 作为输出存储。

建议配置：

```env
OUTPUT_STORAGE_BACKEND=cos
OUTPUT_COS_BUCKET=fasiumeu-1408534747
OUTPUT_COS_REGION=eu-frankfurt
OUTPUT_COS_PREFIX=root/fasium/output
OUTPUT_COS_PUBLIC_BASE_URL=https://fasiumeu-1408534747.cos.eu-frankfurt.myqcloud.com
```

注意：

- 如果桶是私有读，前端直接访问 COS 对象会 403
- 如果浏览器要直接读取图片，需要桶对象可读，并且 COS 需要正确配置 CORS
- 如果后续改成后端代理或预签名 URL，也可以保持桶私有


## 11. 回滚建议

如果发布后要快速回滚：

1. 先保留备份目录里的 `.env.tencent` 和 `docker-compose.tencent.yml`
2. 回到上一个源码版本
3. 用原来的 compose 重新 `up -d --build`

建议至少保留：

- `/data/fasium/runtime/tenant/database`
- `/data/fasium/runtime/tenant/output`
- `/data/fasium/runtime/tenant/tenant_service.db`

---

这份文档的目标是让 EU 与上海两套部署真正独立：

- 各自有自己的 compose
- 各自有自己的 `.env`
- 各自有自己的 COS 配置
- 各自有自己的域名和 Nginx 入口
