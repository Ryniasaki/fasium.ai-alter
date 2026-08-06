# 前端 API 路由映射

Next.js API Routes 作为代理层，将前端请求转发至 Tenant Service。前端 JavaScript 不直接访问后端服务。

**代理目标:** `NEXT_PUBLIC_TENANT_API_URL`（默认 `http://localhost:8081`）

## 认证路由

| 前端路由 | 方法 | → Tenant Service | 说明 |
|----------|------|------------------|------|
| `/api/auth/login` | POST | `/auth/token` | 用户登录 |
| `/api/auth/register` | POST | `/auth/register` | 用户注册（手机号必填，不校验格式） |
| `/api/auth/me` | GET | `/auth/me` | 获取当前用户 |
| `/api/auth/change-password` | POST | `/auth/change-password` | 修改密码 |

## 反馈路由

| 前端路由 | 方法 | → Tenant Service | 说明 |
|----------|------|------------------|------|
| `/api/feedback` | GET | `/feedback` | 获取当前用户可见的反馈列表和月度奖励状态 |
| `/api/feedback` | POST | `/feedback` | 提交反馈并按月度上限发放点数 |

## 工作流代理路由

| 前端路由 | 方法 | → Tenant Service | 说明 |
|----------|------|------------------|------|
| `/api/proxy/complete_image_edit` | POST | `/proxy/complete_image_edit` | 图片改款 |
| `/api/proxy/complete_image_edit_poloapi` | POST | `/proxy/complete_image_edit_poloapi` | 改款（PoloAPI） |
| `/api/proxy/complete_pattern_extract` | POST | `/proxy/complete_pattern_extract` | 花型提取 |
| `/api/proxy/complete_seamless_pattern` | POST | `/proxy/complete_seamless_pattern` | 无缝花型 |
| `/api/proxy/complete_video_generation` | POST | `/proxy/complete_video_generation` | 视频生成 |
| `/api/proxy/complete_image_layer` | POST | `/proxy/complete_image_layer` | 分层编辑 |
| `/api/proxy/text_to_image` | POST | `/proxy/text_to_image` | 文生服装 |
| `/api/proxy/remove_background` | POST | `/proxy/remove_background` | 背景移除 |
| `/api/proxy/super_resolution` | POST | `/proxy/super_resolution` | 超分辨率 |
| `/api/proxy/svg_vectorization` | POST | `/proxy/svg_vectorization` | SVG 矢量化 |
| `/api/proxy/variant_overlay` | POST | `/proxy/variant_overlay` | 配色叠加 |

## 任务管理路由

| 前端路由 | 方法 | → Tenant Service | 说明 |
|----------|------|------------------|------|
| `/api/proxy/tasks/{taskId}` | GET | `/proxy/tasks/{taskId}` | 查询任务状态 |
| `/api/proxy/tasks/{taskId}/complete` | POST | `/proxy/tasks/{taskId}/complete` | 完成任务 |
| `/api/proxy/tasks/history` | GET | `/proxy/tasks/history` | 任务历史 |
| `/api/proxy/tasks/history-count` | GET | `/proxy/tasks/history-count` | 历史数量 |
| `/api/proxy/tasks/refresh-status` | GET | `/proxy/tasks/refresh-status` | 刷新状态 |
| `/api/proxy/upload` | POST | `/proxy/upload` | 文件上传 |

## 静态资源路由

| 前端路由 | 方法 | → Tenant Service | 说明 |
|----------|------|------------------|------|
| `/api/proxy/static/images/{...path}` | GET | `/proxy/static/images/{path}` | 生成图片 |
| `/api/proxy/static/markdown/{...path}` | GET | `/proxy/static/markdown/{path}` | Markdown 文件 |

## 项目管理路由

| 前端路由 | 方法 | → Tenant Service | 说明 |
|----------|------|------------------|------|
| `/api/proxy/projects/{projectId}` | GET/PUT/DELETE | `/proxy/projects/{projectId}` | 项目 CRUD |
| `/api/proxy/projects/{projectId}/tasks` | GET/POST | `/proxy/projects/{projectId}/tasks` | 项目任务 |
| `/api/proxy/projects/{projectId}/team` | GET | `/proxy/projects/{projectId}/team` | 团队信息 |
| `/api/proxy/projects/{projectId}/team/members` | POST/DELETE | `/proxy/projects/{projectId}/team/members` | 成员管理 |
| `/api/proxy/projects/{projectId}/team/invites` | POST | `/proxy/projects/{projectId}/team/invites` | 发送邀请 |
| `/api/proxy/projects/shared` | GET | `/proxy/projects/shared` | 共享项目 |

## LLM 相关路由

| 前端路由 | 方法 | → Tenant Service | 说明 |
|----------|------|------------------|------|
| `/api/proxy/llm/palette_from_image` | POST | `/proxy/llm/palette_from_image` | 图片色板提取 |
| `/api/proxy/llm/poloapi/chat` | POST | `/proxy/llm/poloapi/chat` | AI 对话 |
| `/api/proxy/llm/poloapi/chat_form` | POST | `/proxy/llm/poloapi/chat_form` | AI 对话（表单） |
| `/api/proxy/llm/sheet/*` | POST | `/proxy/llm/sheet/*` | 工艺单 AI |
| `/api/proxy/llm/stripe_variations` | POST | `/proxy/llm/stripe_variations` | 条纹变化 |

## 模型管理路由

| 前端路由 | 方法 | → Tenant Service | 说明 |
|----------|------|------------------|------|
| `/api/models/lora` | GET/POST | `/models/lora/*` | LoRA 列表/上传 |
| `/api/models/lora/{loraId}` | GET/DELETE | `/models/lora/{loraId}` | LoRA 详情 |
| `/api/models/lora/{loraId}/preview` | GET | `/models/lora/{loraId}/preview` | LoRA 预览 |

## 管理端路由

| 前端路由 | 方法 | → Tenant Service | 说明 |
|----------|------|------------------|------|
| `/api/admin/users` | GET | `/admin/users` | 用户列表 |
| `/api/admin/users/{userId}/apply-credit-code` | POST | `/admin/users/{userId}/apply-credit-code` | 应用积分码 |
| `/api/admin/users/{userId}/reset-password` | POST | `/admin/users/{userId}/reset-password` | 管理员重置密码 |
| `/api/admin/billing-rates` | GET/POST | `/admin/billing-rates` | 计费费率 |
| `/api/admin/credit-codes` | GET/POST | `/admin/credit-codes` | 积分兑换码 |
| `/api/admin/db/{table}/{recordId}` | GET | `/admin/db/{table}/{recordId}` | 数据查看 |

## 其他路由

| 前端路由 | 方法 | → Tenant Service | 说明 |
|----------|------|------------------|------|
| `/api/tenants/me` | GET | `/tenants/me` | 租户信息 |
| `/api/trending/baokuan` | GET | `/reports/trending?type=baokuan` | 爆款 |
| `/api/trending/tongkuan` | GET | `/reports/trending?type=tongkuan` | 同款 |
| `/api/trending/reports` | GET | `/reports/*` | 报告 |
| `/api/chatbot/recommend` | POST | chatbot 服务 | AI 推荐 |

## 认证头传递规则

所有 API Route 从请求中提取 `Authorization` header 并透传至 Tenant Service：

```typescript
const token = request.headers.get('authorization');
const response = await fetch(`${TENANT_API_URL}/proxy/...`, {
  headers: { 'Authorization': token },
});
```

## FormData 与 JSON 的区别

- **FormData（multipart）:** 用于包含文件上传的请求（改款、提取等）
- **JSON:** 用于纯数据请求（登录、查询、设置等）

API Route 会根据请求类型自动处理 Content-Type。
