# 代码规范与约定

## Python 代码风格

### 基本规则
- 遵循 PEP 8 规范
- 缩进使用 4 个空格
- 函数和变量使用 `snake_case`
- 类名使用 `PascalCase`
- 常量使用 `UPPER_SNAKE_CASE`

### 类型注解

函数参数和返回值应添加类型注解：

```python
def create_task_record(
    user_id: str,
    task_id: str,
    task_type: str = "image_edit",
) -> dict:
    ...
```

### Pydantic 模型

请求/响应模型使用 Pydantic BaseModel：

```python
class UserCreate(BaseModel):
    username: str
    email: Optional[str] = None
    password: str
    tenant_id: int = 1
```

### 异步函数

FastAPI 路由函数使用 `async def`：

```python
@router.post("/example")
async def create_example(data: ExampleModel):
    ...
```

### 日志

使用项目统一的 logger，不使用 print：

```python
from ..services.logger import get_main_logger
logger = get_main_logger()
```

## TypeScript 代码风格

### 基本规则
- 使用 TypeScript 严格模式（tsconfig 中 `strict: true`）
- 组件使用 `PascalCase`，文件名使用 `kebab-case`
- 变量和函数使用 `camelCase`
- 接口/类型使用 `PascalCase`
- 路径别名使用 `@/` 前缀

### React 组件

函数式组件 + hooks：

```typescript
'use client';

import { useState } from 'react';

export default function ExamplePage() {
  const [data, setData] = useState<string>('');
  return <div>{data}</div>;
}
```

### 导入顺序

```typescript
// 1. React/Next.js
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

// 2. 第三方库
import { Button } from '@/components/ui/button';

// 3. 项目内部
import { useAuth } from '@/contexts/auth-context';
import { submitRedesign } from '@/lib/redesign-api-client';
```

## 命名约定

### 文件命名

| 类型 | 命名规则 | 示例 |
|------|----------|------|
| React 页面 | `page.tsx`（Next.js App Router） | `app/redesign/page.tsx` |
| React 组件 | `kebab-case.tsx` | `login-modal.tsx` |
| API Route | `route.ts` | `app/api/auth/login/route.ts` |
| Python 模块 | `snake_case.py` | `task_record_service.py` |
| 工作流 | `snake_case_workflow.py` | `text_to_image_workflow.py` |

### API 路径

- 前端 API Route: `/api/{module}/{action}`
- Tenant Service: `/{module}/{action}`（如 `/proxy/complete_image_edit`）
- RunningHub: `/v1/{action}`（如 `/v1/generate/{workflow_name}`）

## Git 规范

### 分支命名

```
main          # 主分支
feature/xxx   # 功能分支
fix/xxx       # 修复分支
```

### 提交信息

使用中文或英文均可，格式简洁明了：

```
功能描述（简短）

# 示例
添加视频生成工作流
修复任务轮询超时问题
优化图片存储清理逻辑
```

## 存储模式兼容

后端代码需同时兼容 JSON 和数据库两种存储模式：

```python
if settings.is_database_storage():
    # SQLAlchemy ORM 操作
    user = db.query(User).filter(User.username == name).first()
else:
    # JSON 存储操作
    user = db.get_user_by_username(name)
```
