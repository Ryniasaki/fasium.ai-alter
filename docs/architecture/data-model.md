# 数据模型与存储方案

## 存储方案

Tenant Service 支持三种存储后端，通过环境变量 `STORAGE_TYPE` 切换：

| 模式 | 适用场景 | 配置值 |
|------|----------|--------|
| JSON | 开发/演示 | `json`（默认） |
| SQLite | 小型部署 | `sqlite` |
| MySQL | 生产环境 | `mysql` |

### JSON 存储

文件位于 `comfyui-tenant-service/database/` 目录：

```
database/
├── tenants.json           # 租户列表
├── users.json             # 用户列表
├── task_records.json      # 任务记录
├── project.json           # 项目数据
├── project_share.json     # 项目共享权限
├── project_invite.json    # 项目邀请
├── credit-code.json       # 积分兑换码
├── library/               # LoRA 模型文件
└── report/                # PDF 报告文件
```

### SQLite 存储

单文件数据库 `tenant_service.db`，路径由 `SQLITE_PATH` 指定。

### MySQL 存储

配置项：`MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`

## 核心实体

### Tenant（租户）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Integer PK | 租户 ID |
| name | String(100) | 租户名称（唯一） |
| api_key | String(255) | API 密钥（唯一） |
| is_active | Boolean | 是否启用 |
| settings | Text (JSON) | 租户级配置 |
| created_at | DateTime | 创建时间 |
| updated_at | DateTime | 更新时间 |

### User（用户）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Integer PK | 用户 ID |
| username | String(50) | 用户名（唯一） |
| email | String(100) | 邮箱（可选，唯一） |
| hashed_password | String(255) | 密码哈希 |
| tenant_id | Integer | 所属租户 ID |
| is_active | Boolean | 是否启用 |
| credit | Integer | 积分余额（默认 500） |
| group | Integer | 用户组（默认 1001） |
| created_at | DateTime | 注册时间 |
| last_login | DateTime | 最后登录时间 |

### TenantTaskRecord（任务记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Integer PK | 自增 ID |
| tenant_task_id | String(100) | 租户任务 ID（唯一） |
| user_id | String(100) | 用户标识 |
| runninghub_task_id | String(100) | RunningHub 任务 ID |
| task_type | String(50) | 任务类型（targeted_redesign、pattern_extract 等） |
| status | String(50) | 状态（PENDING / RUNNING / SUCCESS / FAILED） |
| result_data | Text (JSON) | 结果数据 |
| storage_paths | Text (JSON) | 本地存储路径 |
| error_message | Text | 错误信息 |
| created_at | DateTime | 创建时间 |
| completed_at | DateTime | 完成时间 |

### ProjectRecord（项目）

| 字段 | 类型 | 说明 |
|------|------|------|
| project_id | String(100) PK | 项目 ID（project_<uuid>） |
| user_id | String(100) | 所有者用户 ID |
| project_content | Text (JSON) | 项目内容（含 task_ids 数组） |
| created_at | DateTime | 创建时间 |
| updated_at | DateTime | 更新时间 |

### ModelBillingRate（计费费率）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Integer PK | 自增 ID |
| model | String(200) | 模型/工作流名称（唯一） |
| credit | Integer | 每次消耗积分数 |

### BillingUsage（计费记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Integer PK | 自增 ID |
| tenant_id | Integer | 租户 ID |
| user_id | Integer | 用户 ID |
| tenant_task_id | String(100) | 关联任务 ID |
| endpoint | String(200) | 调用端点 |
| model | String(200) | 模型名称 |
| credits | Integer | 消耗积分 |
| status | String(40) | 状态（success / failed） |
| balance_before | Integer | 消费前余额 |
| balance_after | Integer | 消费后余额 |

### TenantLoraRecord（LoRA 模型）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Integer PK | 自增 ID |
| lora_id | String(120) | LoRA ID（唯一） |
| owner_user_id | String(100) | 所有者 |
| name | String(200) | 名称 |
| description | Text | 描述 |
| access_user_ids | Text (JSON) | 可访问用户列表 |
| file_entries | Text (JSON) | 文件列表 |
| directory | String(500) | 文件目录 |
| training_status | Integer | 训练状态（默认 1） |
| preview_entry | Text | 预览信息 |

### 其他实体

- **ProjectShareRecord** — 项目共享权限（access_id、project_id、user_id、permission）
- **ProjectInviteRecord** — 项目邀请（invite_id、invite_token、status、expires_at）
- **PoloAPIUsageRecord** — PoloAPI 调用记录
- **APIUsage** — API 调用统计

## 文件存储

### 生成结果

```
output/
└── {username}/
    └── {taskId}/
        ├── image_0.png
        ├── image_1.png
        └── ...
```

通过 `/proxy/static/images/{path}` 对外提供访问。

### LoRA 模型

```
database/library/
└── {lora_id}/
    ├── model_file.safetensors
    └── preview.png
```

### 数据库迁移

启动时会自动检查并添加缺失的列（`_ensure_user_columns`、`_ensure_lora_columns` 等），支持从 JSON 存储迁移至数据库存储。
