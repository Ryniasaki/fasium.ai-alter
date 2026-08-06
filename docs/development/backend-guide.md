# 后端开发规范

## Tenant Service 目录结构

```
comfyui-tenant-service/
├── app/
│   ├── main.py              # FastAPI 应用创建、中间件、路由注册
│   ├── routers/             # API 路由定义
│   │   ├── auth.py          # 认证（注册/登录/密码修改）
│   │   ├── proxy.py         # 核心代理（改款/提取/任务管理）
│   │   ├── tenants.py       # 租户管理
│   │   ├── admin.py         # 管理端（用户/计费/数据库）
│   │   ├── models.py        # LoRA 模型管理
│   │   ├── sheet.py         # 工艺单生成
│   │   ├── reports.py       # 报告与趋势
│   │   └── ws.py            # WebSocket
│   ├── services/            # 业务逻辑层
│   │   ├── auth.py          # JWT 创建与验证
│   │   ├── config.py        # 配置管理（Settings）
│   │   ├── database_init.py # 数据库初始化
│   │   ├── json_storage.py  # JSON 文件存储实现
│   │   ├── task_record_service.py # 任务记录 CRUD
│   │   ├── image_storage.py # 图片存储与缩略图
│   │   ├── billing_service.py # 计费逻辑
│   │   ├── credit_code_service.py # 积分兑换码
│   │   ├── project_team_service.py # 项目与团队
│   │   ├── lora_service.py  # LoRA 管理
│   │   ├── llm_client.py    # LLM 调用客户端
│   │   ├── poloapi_client.py # PoloAPI 客户端
│   │   ├── sheet_ai_service.py # AI 工艺单
│   │   ├── sheet_markdown_storage.py # Markdown 存储
│   │   ├── report_converter.py # PDF → Markdown
│   │   ├── ws_manager.py    # WebSocket 管理
│   │   └── logger.py        # 日志配置
│   ├── models/
│   │   └── database.py      # SQLAlchemy ORM 模型定义
│   └── schemas/
│       └── sheet.py         # Pydantic Schema
├── autorun/                 # 后台定时任务
│   ├── running_tasks_monitor.py  # 运行中任务监控
│   ├── report_auto_converter.py  # PDF 报告自动转换
│   └── database_backup.py        # 数据库定时备份
├── database/                # JSON 存储数据文件
├── output/                  # 生成结果存储
└── logs/                    # 日志文件
```

## RunningHub 目录结构

```
comfyui-runninghub/
├── app/
│   ├── main.py              # FastAPI 应用创建
│   ├── routers/
│   │   ├── v1.py            # 核心端点（upload/tasks）
│   │   └── workflow_endpoints.py # 动态工作流端点
│   └── services/
│       ├── config.py        # 配置（API Key、Host）
│       ├── runninghub_client.py # Runninghub.cn HTTP 客户端
│       ├── task_manager.py  # 任务状态轮询
│       └── logger.py        # 日志
├── workflows/               # 工作流定义
│   ├── workflow_manager.py  # 工作流管理器
│   ├── complete_image_edit_workflow.py
│   ├── text_to_image_workflow.py
│   └── ...
└── input/                   # 上传文件临时存储
```

## 分层架构

```
Router (routers/)
  ↓ 接收请求、参数校验、认证
Service (services/)
  ↓ 业务逻辑
Storage (models/database.py 或 json_storage.py)
  ↓ 数据持久化
```

### Router 层
- 定义 API 端点
- 使用 `Depends(get_current_user)` 进行认证
- 使用 `Depends(get_db)` 注入数据库会话
- 只做参数校验和转发，不包含业务逻辑

### Service 层
- 封装业务逻辑
- 同时支持 JSON 和 数据库两种存储模式
- 通过 `settings.is_database_storage()` 分支处理

### Storage 层
- `database.py` — SQLAlchemy ORM 模型（SQLite/MySQL）
- `json_storage.py` — JSON 文件读写实现
- `get_db()` 根据配置自动返回对应的存储实例

## 新增 API 端点

1. 在 `routers/` 下对应文件添加路由函数
2. 使用 `Depends(get_current_user)` 认证
3. 业务逻辑放到 `services/` 对应文件
4. 若需要新的数据模型，在 `models/database.py` 添加 SQLAlchemy 模型
5. 若使用 JSON 存储，同步更新 `json_storage.py`

示例：

```python
# routers/example.py
from fastapi import APIRouter, Depends
from ..routers.auth import get_current_user

router = APIRouter()

@router.get("/example")
async def get_example(current_user=Depends(get_current_user)):
    # 业务逻辑
    return {"data": "example"}
```

在 `main.py` 注册路由：

```python
app.include_router(example.router, prefix="/example", tags=["example"])
```

## 认证装饰器

所有需要认证的端点使用 `Depends(get_current_user)`：

```python
from ..routers.auth import get_current_user

@router.get("/protected")
async def protected_route(current_user=Depends(get_current_user)):
    # current_user 在数据库模式下是 SQLAlchemy User 对象
    # 在 JSON 模式下是 dict
    username = current_user.username if hasattr(current_user, 'username') else current_user["username"]
```

## 日志规范

使用 `services/logger.py` 提供的日志器：

```python
from ..services.logger import get_main_logger

logger = get_main_logger()
logger.info("操作描述")
logger.error(f"错误详情: {error}")
```

日志文件输出至 `logs/` 目录。

## autorun 后台任务

在 `main.py` 的 `startup` 事件中启动，`shutdown` 事件中停止：

| 任务 | 功能 |
|------|------|
| `running_tasks_monitor` | 定期检查运行中的任务状态 |
| `report_auto_converter` | 自动将 PDF 报告转为 Markdown |
| `database_backup_scheduler` | 定期备份数据库 |
