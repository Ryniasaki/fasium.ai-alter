# FasiumV2部署文档（JOTO服务器）

## 1. 服务器信息
- 服务器：`10.200.0.18`
- 登录用户：`appadmin`（通过 `sudo` 执行 Docker）
- ssh服务器密码!QAZxsw2

## 2. 当前正式环境
运行中的容器：
- `fasium-frontend` -> `harbor.jototech.cn/fasium/code-frontend:latest`
- `fasium-tenant` -> `harbor.jototech.cn/fasium/code-tenant-service:latest`
- `fasium-tenant-worker` -> `harbor.jototech.cn/fasium/code-tenant-worker:latest`
- `fasium-runninghub` -> `harbor.jototech.cn/fasium/code-runninghub-service:latest`
- `fasium-postgres` -> `postgres:16-alpine`
- `fasium-redis` -> `redis:7-alpine`

## 3. 持久化目录
以下目录为服务器本地持久化数据：
- `/data/fasium/postgres` -> `/var/lib/postgresql/data`
- `/data/fasium/redis` -> `/data`
- `/data/fasium/tenant/output` -> `/app/output`（图片/生成物）
- `/data/fasium/tenant/database` -> `/app/database`
- `/data/fasium/tenant/tenant_service.db` -> `/app/tenant_service.db`

### JOTO 服务器存储约束
- `10.200.0.18` 这台 JOTO 服务器部署时必须使用本地持久化目录，不要配置 `OUTPUT_STORAGE_BACKEND=cos`
- 图片、缩略图和生成物都应直接落在 `/data/fasium/tenant/output`
- 如果改成 COS，画板里的静态图片代理会因为找不到本地文件而返回 `404`
- 如非必要，不要修改服务器上的.env，如果必须要修改，应该需要备份服务器上的.env以方便必要时回退。

## 4. 数据库说明与防踩坑

### 4.1 当前 JOTO 线上必须使用的数据库
- 当前正式环境的 PostgreSQL 数据目录必须是：
  - `/data/fasium/postgres` -> `/var/lib/postgresql/data`
- 当前 `fasium-postgres` 正在使用的是这份本地目录，不要切回 Docker 命名卷
- `users`、`tenants`、`billing_usage`、`tenant_projects` 等正式账号与业务数据都在这份目录里

### 4.2 不要再用的挂载方式
- 不要再把 JOTO 服务器的 PostgreSQL 挂到 `postgres_data`、`app_postgres_data` 或其他新建的 Docker 命名卷
- 这些命名卷很容易在重新部署、改 compose 文件、改项目名之后变成一套新的空库
- 这次排查中发现，空库问题就是因为服务曾经启动到了新的命名卷上，PostgreSQL 在空目录里执行了 `initdb`

### 4.3 已确认的风险操作
- 只要执行了会重建数据库卷的部署，就有可能把账号库切到空库
- 需要特别小心这些动作：
  - 改 `docker-compose.yml` 的 postgres volume
  - 改 `COMPOSE_PROJECT_NAME`
  - 重新执行可能重建 volume 的 `docker compose up -d`
  - 使用会清理卷的命令
    - `docker compose down -v`
    - `docker volume rm ...`
    - `docker system prune --volumes`
- 迁移脚本 `comfyui-tenant-service/scripts/sqlite_to_postgres.py` 会先清空目标表再导入源 sqlite，源文件选错会导致 PG 用户表被覆盖为空

### 4.4 以后排查数据库是否接对时的最小检查
```bash
docker exec fasium-postgres psql -U postgres -d comfyui_tenant_service -c "SELECT COUNT(*) FROM users;"
docker exec fasium-postgres psql -U postgres -d comfyui_tenant_service -c "SELECT username FROM users ORDER BY id LIMIT 10;"
```
- 如果 `users` 数量明显是 0，优先检查是不是挂到了新卷，而不是先怀疑账号密码
- 如果查到老账号存在，说明当前已经接回旧库

### 4.5 这次问题的结论
- 6 月 4 日那次 1Panel 同步/部署后，PostgreSQL 曾经被拉起到新的空数据目录上
- 旧数据目录 `/data/fasium/postgres` 仍然存在，后续已经切回这份老库
- 以后若再次变更部署文件，优先保持这条挂载不变
