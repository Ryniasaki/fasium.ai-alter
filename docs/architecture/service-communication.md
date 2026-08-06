# 服务间通信与数据流

## 请求链路

所有用户请求均遵循以下链路，前端不直接访问后端服务：

```
浏览器 JavaScript
    ↓  fetch()
Next.js API Route (/api/*)
    ↓  httpx / fetch (携带 Authorization header)
Tenant Service (/proxy/*, /auth/*, ...)
    ↓  httpx (无 Authorization header)
RunningHub Service (/v1/*)
    ↓  httpx
Runninghub.cn 云端 API
```

### 关键约定
- 前端 → Tenant Service 的 Base URL 由环境变量 `NEXT_PUBLIC_TENANT_API_URL` 配置
- Tenant Service → RunningHub 的 Base URL 由 `RUNNINGHUB_SERVICE_URL` 配置
- RunningHub → Runninghub.cn 的 Host 由 `RUNNINGHUB_HOST` 配置

## 端到端流程：图片改款（Redesign）

```
1. 用户上传图片 + 手绘覆盖层
   ↓ 浏览器合并覆盖层到底图
2. POST /api/proxy/complete_image_edit (multipart: file, prompt)
   ↓ Next.js 转发
3. POST {TENANT}/proxy/complete_image_edit
   ↓ 验证用户 → 创建任务记录 → 转发
4. POST {RUNNINGHUB}/v1/complete_image_edit
   ↓ 上传文件 → 构建 node_info_list → 提交任务
5. 返回 { taskId } → Tenant 添加 tenantTaskId → 返回前端

6. 前端轮询: GET /api/proxy/tasks/{taskId}
   ↓ → GET {TENANT}/proxy/tasks/{taskId}
   ↓ → GET {RUNNINGHUB}/v1/tasks/{taskId}
   ↓ 返回 { status: "RUNNING" | "SUCCESS" | "FAILED" }

7. 完成时: POST /api/proxy/tasks/{taskId}/complete
   ↓ Tenant 调用 RunningHub 获取 outputs
   ↓ 下载图片至 output/{username}/{taskId}/
   ↓ 更新任务记录，返回 storagePaths

8. 前端通过 GET /api/proxy/static/images/{path} 展示结果
```

## 端到端流程：花型提取（Extract）

```
1. 用户上传服装/模特图片
2. POST /api/proxy/complete_pattern_extract (multipart: file)
   ↓ 同链路转发
3. RunningHub 构建 extract 工作流，提交任务
4. 前端轮询 → 完成 → 下载存储 → 返回
```

## 任务生命周期

```
PENDING → RUNNING → SUCCESS / FAILED
                      ↓
              COMPLETE (前端确认，Tenant 下载并存储结果)
```

| 状态 | 说明 |
|------|------|
| PENDING | 任务已提交，等待执行 |
| RUNNING | Runninghub.cn 正在处理 |
| SUCCESS | 处理完成，结果就绪 |
| FAILED | 处理失败 |
| COMPLETE | 前端已调用 complete 端点，结果已下载到本地存储 |

## WebSocket 通信

Tenant Service 提供 WebSocket 端点用于实时推送积分变动：

```
WS /ws/{user_id}
```

前端 `auth-context.tsx` 在登录后建立 WebSocket 连接，接收积分余额更新。

## 错误传播

```
RunningHub 异常
  → Tenant Service 捕获 → 返回 HTTP 502/504 + 日志记录
    → Next.js API Route 透传错误响应
      → 前端展示错误提示并停止轮询
```

Tenant Service 提供诊断端点可检查 RunningHub 的可用性（health、docs、API prefix）。

## 图片存储与代理

生成结果的存储与访问路径：

```
Runninghub.cn 输出 URL
  ↓ Tenant Service 下载
output/{username}/{taskId}/image_0.png
  ↓ 对外提供
GET /proxy/static/images/{username}/{taskId}/image_0.png
  ↓ Next.js 代理
GET /api/proxy/static/images/{username}/{taskId}/image_0.png
```
