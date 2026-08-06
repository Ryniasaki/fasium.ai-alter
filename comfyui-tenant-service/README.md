# ComfyUI Tenant Service

Multi-tenant microservice for ComfyUI Runninghub integration.

## Architecture

```
comfyui-clothing (Frontend) 
    ↓
comfyui-tenant-service (Multi-tenant Layer)
    ↓
comfyui-runninghub (Backend Service)
```

## Features

- **Multi-tenant isolation**: Each tenant has separate API keys and settings
- **User authentication**: JWT-based authentication system
- **Request proxying**: Transparent proxy to backend Runninghub service
- **Usage tracking**: Monitor API usage per tenant/user
- **Rate limiting**: Prevent abuse with configurable limits

## API Endpoints

### Authentication
- `POST /auth/register` - User registration (phone required, format not validated)
- `POST /auth/token` - User login (OAuth2)
- `GET /tenants/me` - Get tenant info

### Proxy API (requires authentication)
- `POST /api/upload` - File upload
- `POST /api/generate` - AI image generation
- `GET /api/tasks/{task_id}` - Task status
- `GET /api/tasks/{task_id}/outputs` - Task results

## Quick Start

### 1. 配置存储方式
```bash
# 复制配置文件
cp .env.example .env

# 选择存储方式 (编辑 .env 文件)
STORAGE_TYPE=json      # JSON 存储 (默认，最简单)
STORAGE_TYPE=sqlite    # SQLite 存储
STORAGE_TYPE=mysql     # MySQL 存储 (生产环境)
```

### 2. 安装依赖
```bash
pip install -r requirements.txt
```

### 2.1 可选：将 output 迁移到腾讯云 COS
服务支持继续使用本地 `output/`，也支持将新写入文件保存到腾讯云 COS：

```bash
OUTPUT_STORAGE_BACKEND=cos
OUTPUT_COS_SECRET_ID=...
OUTPUT_COS_SECRET_KEY=...
OUTPUT_COS_BUCKET=fasium-cos-1408534747
OUTPUT_COS_REGION=ap-shanghai
OUTPUT_COS_PREFIX=root/fasium/output
OUTPUT_COS_PUBLIC_BASE_URL=https://fasium-cos-1408534747.cos.ap-shanghai.myqcloud.com
```

启用后，新生成/上传文件会写入 `root/fasium/output/...`，历史接口会直接返回公网 URL；旧的本地 `output/` 文件仍可继续读取。

### 3. 测试配置
```bash
python test_config.py
```

### 4. 启动服务
```bash
# Windows
start.bat

# Linux/Mac
uvicorn app.main:app --reload --port 8081
```

### 5. PDF 报告转换
```bash
# 需要先配置好 .env 中的 LLM_SERVICE_URL/LLM_API_KEY
python scripts/convert_reports.py --overwrite
```
该脚本会扫描 `database/report/pdf` 中的 PDF 文件，生成对应的 Markdown 摘要到 `database/report/html`，
并刷新 `database/report/report_index.json`，供前端或其他服务读取 pdf ↔ markdown 对应关系。

## 存储配置

### JSON 存储 (默认，推荐开发)
- ✅ 无需数据库
- ✅ 数据存储在 JSON 文件中
- ✅ 适合开发和测试
- ❌ 不支持高并发

### SQLite 存储
- ✅ 轻量级数据库
- ✅ 单文件存储
- ✅ 适合小型部署
- ❌ 不支持高并发写入

#### JSON → SQLite 数据迁移
当你已经使用 JSON 存储一段时间，可以通过内置脚本将现有数据迁移到 SQLite：

1. 备份 `./database` 目录（或者你自定义的 `JSON_STORAGE_PATH`）。
2. 运行迁移脚本（支持 `--dry-run` 先查看预期结果）：
   ```bash
   cd comfyui-tenant-service
   python scripts/json_to_sqlite.py \
     --json-path ./database \
     --sqlite-path ./tenant_service.db \
     --force
   ```
   - `--force`：如果目标 sqlite 文件已存在则覆盖。
   - `--dry-run`：只打印统计信息，不写入 sqlite。
3. 修改 `.env`，设置 `STORAGE_TYPE=sqlite` 并确认 `SQLITE_PATH` 指向迁移生成的文件。
4. 重启服务。

### MySQL 存储 (生产环境推荐)
- ✅ 支持高并发
- ✅ 适合生产环境
- ✅ 支持复杂查询
- ❌ 需要安装 MySQL

## 详细配置

查看 [STORAGE_CONFIG.md](./STORAGE_CONFIG.md) 了解详细的存储配置说明。

## 数据库表结构

### tenants 表
- `id` - 租户ID
- `name` - 租户名称
- `api_key` - 租户API密钥
- `is_active` - 是否激活
- `created_at` - 创建时间
- `updated_at` - 更新时间
- `settings` - 租户设置 (JSON)

### users 表
- `id` - 用户ID
- `username` - 用户名
- `email` - 邮箱 (可选)
- `hashed_password` - 密码哈希
- `tenant_id` - 所属租户ID
- `is_active` - 是否激活
- `created_at` - 创建时间
- `last_login` - 最后登录时间

### api_usage 表
- `id` - 使用记录ID
- `tenant_id` - 租户ID
- `user_id` - 用户ID
- `endpoint` - API端点
- `request_count` - 请求次数
- `created_at` - 创建时间
