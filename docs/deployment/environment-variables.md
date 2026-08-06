# 环境变量参考

## 前端 (comfyui-clothing)

配置文件：`.env` 或 `.env.local`

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NEXT_PUBLIC_TENANT_API_URL` | `http://localhost:8081` | Tenant Service 地址 |
| `NEXT_PUBLIC_DEV_MODE` | `false` | 开发模式（跳过认证） |

## Tenant Service (comfyui-tenant-service)

配置文件：`.env`

### JWT 认证

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SECRET_KEY` | `your-secret-key-change-in-production` | JWT 签名密钥（**生产环境必须修改**） |
| `ALGORITHM` | `HS256` | JWT 签名算法 |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | Token 过期时间（分钟） |

### 服务连接

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `RUNNINGHUB_SERVICE_URL` | `http://localhost:8080` | RunningHub 服务地址 |
| `RUNNINGHUB_TASK_TIMEOUT_SECONDS` | `2400` | RunningHub 任务超时兜底（秒） |

### 存储配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `STORAGE_TYPE` | `json` | 存储模式：`json` / `sqlite` / `mysql` |

### JSON 存储

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `JSON_STORAGE_PATH` | `./database` | JSON 文件存储路径 |

### SQLite 存储

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SQLITE_PATH` | `./tenant_service.db` | SQLite 数据库文件路径 |

### MySQL 存储

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MYSQL_HOST` | `localhost` | MySQL 地址 |
| `MYSQL_PORT` | `3306` | MySQL 端口 |
| `MYSQL_USER` | `root` | MySQL 用户名 |
| `MYSQL_PASSWORD` | _(空)_ | MySQL 密码 |
| `MYSQL_DATABASE` | `comfyui_tenant_service` | MySQL 数据库名 |

### LLM 服务

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LLM_SERVICE_URL` | _(空)_ | LLM 服务地址 |
| `LLM_API_KEY` | _(空)_ | LLM API 密钥 |
| `LLM_DEFAULT_MODEL` | `gpt-4.1` | 默认 LLM 模型 |
| `GEMINI_API_KEY` | _(空)_ | Gemini API 密钥 |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` | Gemini 地址 |
| `GEMINI_DEFAULT_MODEL` | `google/gemini-2.5-flash` | 默认 Gemini 模型 |
| `OPENROUTER_REFERER` | _(空)_ | OpenRouter Referer |
| `OPENROUTER_TITLE` | _(空)_ | OpenRouter Title |
| `POLOAPI_APIKEY` | _(空)_ | PoloAPI 密钥 |
| `POLOAPI_TEXT_BASE_URL` | _(空)_ | PoloAPI 文本/对话链路地址，主流程可指向 Cherry |
| `POLOAPI_TEXT_APIKEY` | _(空)_ | PoloAPI 文本/对话链路密钥；为空时回退到 `POLOAPI_APIKEY` |
| `POLOAPI_TEXT_MODEL` | _(空)_ | 文本/对话默认模型 |
| `POLOAPI_AUDIT_BASE_URL` | _(空)_ | 安全审核专用地址，建议 `https://api.deepseek.com` |
| `POLOAPI_AUDIT_APIKEY` | _(空)_ | 安全审核专用 API Key |
| `POLOAPI_AUDIT_MODEL` | _(空)_ | 安全审核专用模型，建议 `deepseek-v4-pro` |
| `POLOAPI_NANOBANANA_APIKEY` | _(空)_ | gemini-2.5-flash-image / gemini-3-pro-image-preview 专用 PoloAPI 密钥 |
| `POLOAPI_DEFAULT_MODEL` | `gemini-2.5-flash-image` | PoloAPI 默认模型 |
| `POLOAPI_BAOKUAN_MODEL` | `gemini-2.5-flash-image-preview` | 爆款模型 |

### VOD 图像服务

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VOD_MODEL_NAME` | `GEM` | 默认 VOD 图像模型名称 |
| `VOD_MODEL_VERSION` | `3.1` | 默认 VOD 图像模型版本 |
| `VOD_IMAGE2_MODEL_VERSION` | `image2_medium` | `Image2` 入口使用的模型版本 |
| `VOD_IMAGE2_RESOLUTION` | `1K` | `Image2` 入口默认分辨率 |
| `VOD_IMAGE2_ASPECT_RATIO` | _(空)_ | `Image2` 入口可选宽高比，留空则不显式传入 |

### 输出存储

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OUTPUT_STORAGE_PATH` | `./output` | 生成结果存储路径 |

### 用户默认值

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `USER_DEFAULT_CREDIT` | `2000` | 新用户默认积分 |
| `USER_DEFAULT_GROUP` | `1001` | 新用户默认组 |

### 其他

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `RATE_LIMIT_PER_MINUTE` | `60` | 每分钟请求限制 |
| `LOG_LEVEL` | `INFO` | 日志级别 |

## RunningHub Service (comfyui-runninghub)

配置文件：`.env`

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `RUNNINGHUB_API_KEY` | _(必填)_ | Runninghub.cn API 密钥 |
| `RUNNINGHUB_HOST` | `https://www.runninghub.cn` | Runninghub.cn 地址 |
| `REQUEST_TIMEOUT_SECONDS` | `60` | HTTP 请求超时（秒） |
| `POLL_INTERVAL_SECONDS` | `8` | 任务状态轮询间隔（秒） |
| `MAX_POLL_SECONDS` | `300` | 最大轮询等待时间（秒） |
