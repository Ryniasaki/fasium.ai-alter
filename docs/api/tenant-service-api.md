# 租户服务 API 文档

**Base URL:** `http://localhost:8081`
**Swagger 文档:** `http://localhost:8081/docs`
**认证方式:** Bearer Token（JWT）

---

## 认证 (Auth)

### POST /auth/register — 用户注册

**请求体 (JSON):**

```json
{
  "username": "string",
  "email": "string (可选)",
  "phone": "string",
  "password": "string",
  "tenant_id": 1
}
```

- `phone` 为必填项，仅要求非空，不做格式校验

**响应:**

```json
{
  "id": 1,
  "username": "string",
  "email": "string",
  "tenant_id": 1,
  "is_active": true,
  "credit": 500,
  "group": 1001
}
```

### POST /auth/token — 用户登录

**请求体 (x-www-form-urlencoded):**

| 字段 | 类型 | 说明 |
|------|------|------|
| username | string | 用户名 |
| password | string | 密码 |

**响应:**

```json
{
  "access_token": "eyJhbGciOi...",
  "token_type": "bearer"
}
```

### GET /auth/me — 获取当前用户信息

**需要认证**

**响应:**

```json
{
  "id": 1,
  "username": "string",
  "email": "string",
  "tenant_id": 1,
  "is_active": true,
  "credit": 500,
  "group": 1001
}
```

### POST /auth/change-password — 修改密码

**需要认证**

**请求体:**

```json
{
  "current_password": "string",
  "new_password": "string"
}
```

---

## 代理 (Proxy)

### POST /proxy/complete_image_edit — 图片改款

**需要认证 | multipart/form-data**

| 字段 | 类型 | 说明 |
|------|------|------|
| file | File | 主图片 |
| file_2 | File (可选) | 第 2 张图片 |
| file_3 | File (可选) | 第 3 张图片 |
| file_4 | File (可选) | 第 4 张图片 |
| prompt | string | 提示词 |

**响应:**

```json
{
  "taskId": "runninghub_task_id",
  "tenantTaskId": "tenant_task_id"
}
```

### POST /proxy/complete_pattern_extract — 花型提取

**需要认证 | multipart/form-data**

| 字段 | 类型 | 说明 |
|------|------|------|
| file | File | 图片文件 |

**响应:** 同 complete_image_edit

### POST /proxy/complete_seamless_pattern — 无缝花型

**需要认证 | multipart/form-data**

### POST /proxy/complete_video_generation — 视频生成

**需要认证 | multipart/form-data**

### GET /proxy/tasks/{taskId} — 查询任务状态

**需要认证**

**响应:**

```json
{
  "taskId": "string",
  "status": "PENDING | RUNNING | SUCCESS | FAILED"
}
```

### POST /proxy/tasks/{taskId}/complete — 完成任务并下载结果

**需要认证**

**响应:**

```json
{
  "taskId": "string",
  "tenantTaskId": "string",
  "storagePaths": ["output/user/taskId/image_0.png"]
}
```

### GET /proxy/tasks/history — 任务历史

**需要认证**

**查询参数:**

| 参数 | 类型 | 说明 |
|------|------|------|
| task_type | string (可选) | 按类型筛选（targeted_redesign / pattern_extract 等） |

### GET /proxy/static/images/{path} — 静态图片访问

**需要认证**

返回 `output/` 目录下的图片文件。

---

## 模型 (Models)

### POST /models/lora/upload — 上传 LoRA 模型

**需要认证 | multipart/form-data**

### GET /models/lora/list — LoRA 模型列表

**需要认证**

### POST /models/lora/{loraId}/analyze — 图片分析

**需要认证**

---

## 工艺单 (Sheet)

### POST /sheet/* — 工艺单相关操作

包括技术图生成、里布图、技术包、成本估算等功能。

---

## 报告 (Reports)

### GET /reports/trending — 趋势图片

返回爆款/同款趋势图片列表。

---

## 反馈 (Feedback)

### GET /feedback — 获取可见反馈列表

**需要认证**

- 普通用户：只返回自己的反馈
- 管理员：返回当前权限范围内的全部反馈

**响应:**

```json
{
  "monthlyRewardLimit": 3,
  "rewardPointsPerFeedback": 500,
  "rewardedThisMonth": 2,
  "remainingRewardSlots": 1,
  "isAdminView": false,
  "items": [
    {
      "id": 1,
      "tenantId": 1,
      "userId": 2,
      "username": "string",
      "content": "string",
      "createdAt": "2026-06-18T08:00:00Z",
      "rewardPoints": 500,
      "rewardedAt": "2026-06-18T08:00:00Z",
      "rewardGranted": true,
      "attachments": []
    }
  ]
}
```

### POST /feedback — 提交反馈并发放点数

**需要认证 | multipart/form-data**

| 字段 | 类型 | 说明 |
|------|------|------|
| content | string | 反馈内容 |
| files | File[] (可选) | 图片或视频附件，最多 6 个 |

**说明**

- 每次成功提交反馈奖励 500 点
- 每个自然月最多奖励 3 次，按 Asia/Shanghai 口径统计
- 超过奖励上限后仍然可以继续提交反馈，但 `rewardGranted` 会返回 `false`

**响应:**

```json
{
  "monthlyRewardLimit": 3,
  "rewardPointsPerFeedback": 500,
  "rewardedThisMonth": 2,
  "remainingRewardSlots": 1,
  "rewardGranted": true,
  "item": {
    "id": 2,
    "tenantId": 1,
    "userId": 2,
    "username": "string",
    "content": "string",
    "createdAt": "2026-06-18T08:00:00Z",
    "rewardPoints": 500,
    "rewardedAt": "2026-06-18T08:00:00Z",
    "rewardGranted": true,
    "attachments": []
  }
}
```

---

## 管理 (Admin)

### GET /admin/users — 用户列表

**需要管理员权限**

### POST /admin/users/{userId}/apply-credit-code — 应用积分兑换码

**需要管理员权限**

### POST /admin/users/{userId}/reset-password — 重置密码

**需要管理员权限**

将目标用户密码重置为固定值 `00000000`。

### GET /admin/billing-rates — 获取计费费率

### POST /admin/billing-rates — 设置计费费率

**请求体:**

```json
{
  "model": "complete_image_edit",
  "credit": 5
}
```

### GET /admin/credit-codes — 积分兑换码列表

### GET /admin/db/tables — 数据库表列表

### GET /admin/db/{table}/{recordId} — 查看记录详情

---

## WebSocket

### WS /ws/{user_id} — 实时积分更新

连接后自动推送用户积分变动消息。

---

## 错误码

| HTTP 状态码 | 说明 |
|-------------|------|
| 400 | 请求参数错误 |
| 401 | 未认证或 Token 过期 |
| 403 | 权限不足 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |
| 502 | RunningHub 服务不可用 |
| 504 | RunningHub 请求超时 |
