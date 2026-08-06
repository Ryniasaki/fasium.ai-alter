# Fasium 腾讯云部署文档

## 1. 适用范围
这份文档记录的是 `2026-05-18` 实际执行并验证通过的一次腾讯云部署流程，目标机器为腾讯云正式服务器：

- 服务器 IP：`110.40.229.145`
- SSH 用户：`ubuntu`
- 应用目录：`/data/fasium/app`
- 运行时数据目录：`/data/fasium/runtime`

服务器的ssh账号和密码：
ubuntu
!QAZxsw2

这次采用的是“服务器本地源码 + Docker Compose 直接 build”的发布方式

## 2. 当前部署拓扑
腾讯云线上当前采用以下容器拓扑：

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

## 3. 部署原则
这次实测后，推荐固定使用下面这套原则：

1. 不直接整份覆盖服务器上的 `.env.tencent`。
2. 服务器上的 `.env.tencent` 视为线上真实配置源，尤其要保留支付相关配置。
3. 代码和 `docker-compose.tencent.yml` 可以更新，但环境变量只做增量合并。
4. 发布顺序固定为：
   1. `tenant-service` + `tenant-worker`
   2. `frontend`
5. 每次发布前先做备份。

## 4. 发布前检查

### 4.1 本地检查
先确认本地部署文件可被 compose 正常解析：

```bash
docker compose --env-file .env.tencent -f docker-compose.tencent.yml config
```

如果这里失败，先修复 `docker-compose.tencent.yml`，不要带着错误文件上服务器。

### 4.2 服务器检查
登录腾讯云服务器后确认磁盘、内存和当前容器状态：

```bash
ssh ubuntu@110.40.229.145

df -h / /data
free -h
docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' | grep '^fasium-'
```

## 5. 目录约定

### 5.1 应用目录
```bash
/data/fasium/app
```

这里放源码、`docker-compose.tencent.yml`、`.env.tencent`。

### 5.2 持久化目录
```bash
/data/fasium/runtime/tenant/database
/data/fasium/runtime/tenant/output
/data/fasium/runtime/tenant/tenant_service.db
```

### 5.3 备份目录
每次部署前在这里创建一次备份：

```bash
/data/fasium/backups/
```

本次实际备份目录为：

```bash
/data/fasium/backups/deploy_20260518_085106
```

## 6. 这次发布涉及的关键配置结论

### 6.1 PostgreSQL 连接
`.env.tencent` 里可以保留：

```env
POSTGRES_HOST=172.17.0.7
```

但线上实际运行时，compose 中 `tenant-service` / `tenant-worker` 使用的是：

```env
POSTGRES_HOST=postgres
```

也就是说，容器内部最终走的是本地 `fasium-postgres` 服务。

### 6.2 `.env.tencent` 不要直接覆盖
服务器上的 `.env.tencent` 比本地更完整，尤其包含：

- `ALIPAY_ENV`
- `ALIPAY_APP_ID`
- `ALIPAY_GATEWAY`
- `ALIPAY_PUBLIC_KEY`
- `ALIPAY_PRIVATE_KEY_BASE64`
- `ALIPAY_NOTIFY_URL`
- `ALIPAY_RETURN_URL`
- `PUBLIC_BASE_URL`

所以不要用本地 `.env.tencent` 直接覆盖远端文件。


## 8. 推荐发布流程

### 8.1 备份远端当前版本
在服务器上执行：

```bash
cd /data/fasium
TS=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/data/fasium/backups/deploy_$TS"
mkdir -p "$BACKUP_DIR"

cd /data/fasium/app
cp docker-compose.tencent.yml "$BACKUP_DIR/docker-compose.tencent.yml"
cp .env.tencent "$BACKUP_DIR/.env.tencent"
tar -czf "$BACKUP_DIR/app-code-before-update.tar.gz" \
  comfyui-tenant-service \
  comfyui-clothing \
  comfyui-runninghub \
  scripts
```

### 8.2 同步源码到服务器
推荐只同步当前仓库需要部署的源码，不要把本地 `node_modules`、`.next` 一类构建垃圾也传上去。

建议同步这些内容：

- `docker-compose.tencent.yml`
- `.env.tencent.example`
- `scripts/`
- `comfyui-clothing/`
- `comfyui-tenant-service/`
- `comfyui-runninghub/`

同步完成后解压到：

```bash
/data/fasium/app
```

### 8.3 合并 `.env.tencent`
同步代码后，不覆盖远端 `.env.tencent`，只增量更新必要键。


```

## 10. 回滚方式
如果新版本异常，按下面顺序回滚：

1. 进入最近一次备份目录。
2. 恢复 `docker-compose.tencent.yml`。
3. 恢复 `.env.tencent`。
4. 恢复代码快照。
5. 重新 `docker compose up -d`。

示例：

```bash
BACKUP_DIR=/data/fasium/backups/deploy_YYYYMMDD_HHMMSS

cd /data/fasium/app
cp "$BACKUP_DIR/docker-compose.tencent.yml" ./docker-compose.tencent.yml
cp "$BACKUP_DIR/.env.tencent" ./.env.tencent
tar -xzf "$BACKUP_DIR/app-code-before-update.tar.gz" -C /data/fasium/app

docker compose --env-file .env.tencent -f docker-compose.tencent.yml up -d
```

如果只是前端异常，也可以只重建前端，不动 tenant：

```bash
docker compose --env-file .env.tencent -f docker-compose.tencent.yml up -d --build frontend
```

## 11. 常见注意事项

### 11.1 不要整份覆盖 `.env.tencent`
这是本次部署里最重要的一条，尤其要避免把线上支付配置覆盖掉。

### 11.2 先 tenant 后 frontend
这样即使前端更新失败，tenant 也已经是新版本，排查更清楚，风险更可控。

### 11.3 `docker compose up -d --build frontend` 会带出依赖校验
虽然命令只指定 `frontend`，compose 仍会检查依赖服务状态，所以 tenant 和 runninghub 最好先是健康的。

### 11.4 前端构建日志里的 Next.js `Dynamic server usage` 提示
本次构建中出现过这类提示，但最终构建成功，容器也健康。当前它是“构建提示”，不是本次发布阻塞项。

### 11.5 `sharp` 缺失提示
前端构建会提示生产环境建议安装 `sharp`，但本次没有阻塞部署。

## 11. 如果部署到云服务器，这是腾讯云服务器的认证信息
- 云服务器厂商：腾讯云
- 服务器 IP：`110.40.229.145`
- SSH 用户名：`ubuntu`
- SSH 密码：`!QAZxsw2`
- SSH 连接命令：`ssh ubuntu@110.40.229.145`
- 云数据库地址：`sh-postgres-1ik934jk.sql.tencentcdb.com:26287`
- 云数据库内网地址：`172.17.0.7:5432`
- 云数据库用户名：`Jototech`
- 云数据库密码：`!QAZxsw2`

### 云数据库内网连通性验证方式
先登录腾讯云服务器：

```bash
ssh ubuntu@110.40.229.145
```

在云服务器上用 Python 测试 PostgreSQL 内网端口是否可达：

```bash
python3 - <<'PY'
import socket, time
host='172.17.0.7'
port=5432
s=socket.socket()
s.settimeout(5)
t=time.time()
try:
    s.connect((host, port))
    print('TCP_OK', round(time.time()-t, 2))
except Exception as e:
    print('TCP_FAIL', type(e).__name__, str(e))
finally:
    s.close()
PY
```

返回 `TCP_OK` 表示云服务器已经可以通过内网访问 PostgreSQL 端口。

如需进一步验证账号密码，可在具备 PostgreSQL 客户端的环境中执行：

```bash
psql "host=172.17.0.7 port=5432 user=Jototech password=!QAZxsw2 dbname=postgres"
```

本次已验证结果：
- 从腾讯云服务器访问 `172.17.0.7:5432` 返回 `TCP_OK`
- 使用用户 `Jototech` 可成功登录数据库 `postgres`

## 12. 腾讯云 COS（对象存储）已验证配置
- 存储桶：`fasium-cos-1408534747`
- 地域：`ap-shanghai`
- 公网域名：`https://fasium-cos-1408534747.cos.ap-shanghai.myqcloud.com`
- 公开读目录前缀：`root/fasium/`
- SecretId：`YOUR_TENCENT_CLOUD_SECRET_ID`
- SecretKey：`YOUR_TENCENT_CLOUD_SECRET_KEY`

### 公网访问验证
已验证以下目录和文件可直接公网访问：

```bash
curl -I "https://fasium-cos-1408534747.cos.ap-shanghai.myqcloud.com/root/fasium/"
curl -I "https://fasium-cos-1408534747.cos.ap-shanghai.myqcloud.com/root/fasium/79a6eaj12.png"
```

验证结果：
- 目录 `root/fasium/` 返回 `HTTP 200`
- 文件 `79a6eaj12.png` 返回 `HTTP 200`

### Python SDK 上传方式
本地先安装腾讯云 COS Python SDK：

```bash
python -m pip install cos-python-sdk-v5
```

上传示例：

```python
from qcloud_cos import CosConfig, CosS3Client

secret_id = "YOUR_TENCENT_CLOUD_SECRET_ID"
secret_key = "YOUR_TENCENT_CLOUD_SECRET_KEY"
region = "ap-shanghai"
bucket = "fasium-cos-1408534747"
object_key = "root/fasium/example.txt"

config = CosConfig(Region=region, SecretId=secret_id, SecretKey=secret_key, Scheme="https")
client = CosS3Client(config)

with open("example.txt", "rb") as fp:
    client.put_object(Bucket=bucket, Body=fp, Key=object_key, EnableMD5=False)

print(f"https://{bucket}.cos.{region}.myqcloud.com/{object_key}")
```

### Python SDK 删除方式
删除对象示例：

```python
from qcloud_cos import CosConfig, CosS3Client

secret_id = "YOUR_TENCENT_CLOUD_SECRET_ID"
secret_key = "YOUR_TENCENT_CLOUD_SECRET_KEY"
region = "ap-shanghai"
bucket = "fasium-cos-1408534747"
object_key = "root/fasium/example.txt"

config = CosConfig(Region=region, SecretId=secret_id, SecretKey=secret_key, Scheme="https")
client = CosS3Client(config)
client.delete_object(Bucket=bucket, Key=object_key)
```

### 本次已验证结果
- 可使用上述 `SecretId` / `SecretKey` 向 `fasium-cos-1408534747/root/fasium/` 上传文件
- 上传后的文件可通过公网域名直接访问
- 可使用同一组凭证删除已上传对象
- 测试文件 `codex-upload-test-1773308414.txt` 已上传并成功删除，删除后访问返回 `HTTP 404`

## 13. 腾讯云 tenant 服务器部署步骤
这部分是按当前仓库里的 `docker-compose.tencent.yml` 和 `.env.tencent` 来走的，适合把 tenant 服务、worker、frontend 一起部署到腾讯云。

> 说明：腾讯云实例上最终验证通过的拓扑是“应用容器 + 本地 PostgreSQL 容器 + Redis 容器”。  
> 之前尝试直接连外部 `172.17.0.7:5432`，在容器内不可达，所以现在 compose 已经切回本地 `postgres` 服务。  
> `POSTGRES_HOST` 在 `.env.tencent` 里可以继续保留，但实际连接目标由 compose 中的 `postgres` 服务接管。

### 13.1 目录和环境变量
- 建议部署目录：`/data/fasium`
- 腾讯云 compose 默认数据根目录：`DEPLOY_DATA_ROOT=/data/fasium/runtime`
- 当前腾讯云实际部署目录是 `/data/fasium/app`
- 如果你想直接沿用文档里原来的目录布局，可以把 `.env.tencent` 里的 `DEPLOY_DATA_ROOT` 改成 `/data/fasium`
- 需要确认的核心变量：
  - `POSTGRES_HOST`
  - `POSTGRES_PORT`
  - `POSTGRES_USER`
  - `POSTGRES_PASSWORD`
  - `POSTGRES_DATABASE`
  - `OUTPUT_STORAGE_BACKEND=cos`
  - `OUTPUT_COS_SECRET_ID`
  - `OUTPUT_COS_SECRET_KEY`
  - `OUTPUT_COS_BUCKET`
  - `OUTPUT_COS_REGION`
  - `OUTPUT_COS_PUBLIC_BASE_URL`

### 13.2 启动前准备
```bash
ssh ubuntu@110.40.229.145
sudo -s

mkdir -p /data/fasium/app
mkdir -p /data/fasium/runtime/tenant/database
mkdir -p /data/fasium/runtime/tenant/output
mkdir -p /data/fasium/runtime
```

把仓库代码放到服务器上后，在仓库根目录执行：
```bash
cp .env.tencent.example .env.tencent
# 按实际腾讯云环境补齐 .env.tencent
```

### 13.3 启动服务
```bash
cd /data/fasium/app
docker compose --env-file .env.tencent -f docker-compose.tencent.yml up -d --build
```

### 13.4 验证
```bash
docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' | grep '^fasium-'
curl -I http://127.0.0.1:3000/
curl http://127.0.0.1:8081/health
curl http://127.0.0.1:8080/health
```

### 13.5 这个腾讯云 compose 的关键点
- tenant-service 和 tenant-worker 会共享同一套 `database`、`output`、`tenant_service.db` 挂载
- 前端通过 `NEXT_PUBLIC_TENANT_API_URL=http://tenant-service:8081` 在容器内访问 tenant-service
- 现在 compose 不再依赖外部 `app_default` 网络，直接 `docker compose up` 就能完成服务间通信

## 14. 腾讯云线上压测方案
这部分用于正式服务器上的压测，不建议直接拿当前正式 `.env.tencent` 原地开打。原则是：
- 压测窗口内先做一次配置隔离
- 所有可能触发外部模型计费的 key 都先清空或改成 mock
- 压测完成后立刻恢复原配置

### 14.1 压测前先备份
先把当前环境变量文件备份一份，避免回滚时找不到原配置：

```bash
cd /data/fasium
cp .env.tencent .env.tencent.bak.$(date +%Y%m%d_%H%M%S)
```
